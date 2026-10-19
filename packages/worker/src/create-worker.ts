import { setTimeout as sleepFor } from 'node:timers/promises';
import {
  type EventSourceState,
  parseIngestEnvelope,
  type ResumeOutcome,
  resumeOutcomes,
} from '@ledger/core';
import {
  CONNECTION_TIMEOUT_MS,
  classifyDatabaseError,
  type Database,
  databaseRepository,
  STORAGE_PROBE_THRESHOLD,
} from '@ledger/db';
import {
  type BatchResponse,
  type ClockPort,
  type EventSourceControlPort,
  errorFields,
  type Logger,
  type MetricsPort,
  type QueueMessage,
} from '@ledger/shared';
import { RecordEventCommand } from './record-event.command.ts';

export type WorkerDeps = {
  // The function's one size-1 pool and its Drizzle handle (ADR-005, D15).
  database: Database;
  // ADR-015: the worker's own event source, disabled on an outage and re-enabled by `resume`.
  eventSource: EventSourceControlPort;
  // D11: the resume probe fails at `STORAGE_PROBE_THRESHOLD` of this.
  storageLimitBytes: number;
  clock: ClockPort;
  logger: Logger;
  metrics: MetricsPort;
  // D2: the 32-byte address-hash key the composition root decoded.
  addressHashKey: Uint8Array;
  // How the batch deadline waits (D15); `FakeClock.sleep` in tests, so no test waits in real time.
  // The signal cancels the wait when the batch ends first.
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
};

// D16: what the resume event answers; the outcomes live in `@ledger/core`, shared with the read API.
export { type ResumeOutcome, resumeOutcomes };
export type ResumeResult = { outcome: ResumeOutcome; state: EventSourceState };

// D15: how long the invocation has left, the Lambda context's own reading. Read once, when the batch
// starts. Local mode passes none: its in-process consumer has no timeout that kills it mid-batch.
export type BatchDeadline = { readonly getRemainingTimeInMillis: () => number };

// D15: one `UpdateEventSourceMapping`, plus a container's first `ListEventSourceMappings` (D16).
const PAUSE_BUDGET_MS = 5_000;
// D15: what the batch deadline holds back from the invocation's remaining time, so the pause always
// runs before the function's timeout: a `pool.connect()` already under way when the deadline passes
// cannot be cut short (at most `CONNECTION_TIMEOUT_MS`, 5 s), then the pause's own budget. Listing
// the failures costs no I/O. 10 s of the worker's 60 s (D27).
export const BATCH_DEADLINE_RESERVE_MS = CONNECTION_TIMEOUT_MS + PAUSE_BUDGET_MS;

export type Worker = {
  processBatch(messages: readonly QueueMessage[], deadline?: BatchDeadline): Promise<BatchResponse>;
  resume(): Promise<ResumeResult>;
};

// One message's result: committed, failed alone (ADR-008), or the database is out (ADR-015).
type MessageResult = 'committed' | 'failed' | 'database_unavailable';

// The batch's deadline, armed when the batch starts: `signal` aborts at the deadline and ends the
// transaction in flight (`runTransaction`), `passed` reads it between attempts.
type ArmedDeadline = {
  readonly signal: AbortSignal | undefined;
  passed(): boolean;
  disarm(): void;
};

const NO_DEADLINE: ArmedDeadline = { signal: undefined, passed: () => false, disarm: () => {} };

// A cancelled wait settles quietly: the batch that cancelled it has already finished.
const realSleep = (ms: number, signal: AbortSignal): Promise<void> =>
  sleepFor(ms, undefined, { signal }).catch(() => {});

// An object because one Lambda serves two event kinds: the SQS batch and the resume event (ADR-015).
// Messages run one at a time on the function's single size-1 pool (ADR-005).
export function createWorker({
  database,
  eventSource,
  storageLimitBytes,
  clock,
  logger,
  metrics,
  addressHashKey,
  sleep = realSleep,
}: WorkerDeps): Worker {
  const recordEvent = new RecordEventCommand({ database, clock, metrics, addressHashKey });

  // D15: the cold outage path alone (a connect and a query timeout, twice) is 40 s, and a database
  // that is slow but answering is never classified at all, so one message's statements can outlast
  // the 60 s timeout; the Lambda would then die before the pause and five receives would reach the
  // DLQ (ADR-015). The deadline makes running out of time an outage too.
  function armDeadline(deadline: BatchDeadline | undefined): ArmedDeadline {
    if (deadline === undefined) {
      return NO_DEADLINE;
    }
    const startedAt = clock.now().getTime();
    const deadlineAt = startedAt + deadline.getRemainingTimeInMillis() - BATCH_DEADLINE_RESERVE_MS;
    const expired = new AbortController();
    const disarmed = new AbortController();
    const passed = (): boolean => expired.signal.aborted || clock.now().getTime() >= deadlineAt;
    if (deadlineAt <= startedAt) {
      expired.abort();
    } else {
      void sleep(deadlineAt - startedAt, disarmed.signal).then(() => {
        if (!disarmed.signal.aborted) {
          expired.abort();
        }
      });
    }
    return { signal: expired.signal, passed, disarm: () => disarmed.abort() };
  }

  // D15 steps 1, 2 and 4. A connection-class failure runs the message once more; `runTransaction`
  // discarded the connection that failed, so the retry connects afresh (a Neon suspend can drop one,
  // PG-U04). Any other error fails this message alone. A passed deadline is an outage, before an
  // attempt or during one: the retry never starts on time the pause needs.
  async function record(message: QueueMessage, deadline: ArmedDeadline): Promise<MessageResult> {
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      if (deadline.passed()) {
        logger.error('worker.database_unavailable', { error_code: 'database_unavailable' });
        return 'database_unavailable';
      }
      try {
        await recordEvent.execute({ body: message.body, signal: deadline.signal });
        return 'committed';
      } catch (error) {
        if (deadline.passed()) {
          logger.error('worker.database_unavailable', errorFields(error));
          return 'database_unavailable';
        }
        if (classifyDatabaseError(error) === undefined) {
          // Name, registry code and SQLSTATE only: a parse or Postgres error can quote the row. Plus
          // the message's `svix_id`, an id and not row content, so an operator finds a dead
          // message's failure by it (runbook: LedgerApp-dlq-depth). A body that is not an envelope
          // yields none: its fields are unchecked, so none is logged.
          logger.error('worker.message_failed', {
            svix_id: parseIngestEnvelope(message.body)?.svixId,
            ...errorFields(error),
          });
          return 'failed';
        }
        if (attempt === 2) {
          logger.error('worker.database_unavailable', errorFields(error));
        }
      }
    }
    return 'database_unavailable';
  }

  return {
    async processBatch(messages, deadline) {
      const armed = armDeadline(deadline);
      try {
        // ADR-008, AWS-05: built from each message's own result, never assumed. An id left out is
        // acknowledged, so a failure is never swallowed: it is listed and redelivered.
        const batchItemFailures: { itemIdentifier: string }[] = [];
        for (const message of messages) {
          const result = await record(message, armed);
          if (result === 'failed') {
            batchItemFailures.push({ itemIdentifier: message.messageId });
          } else if (result === 'database_unavailable') {
            // D15 step 3, ADR-015: every message of the batch is listed, so the outage costs each
            // one receive and moves none to the DLQ; a message already committed here comes back as
            // a duplicate, absorbed on `svix_id`. Then the worker pauses its own event source and
            // stops, inside the reserve the deadline kept for it.
            try {
              await eventSource.disable();
            } catch (error) {
              // The response is unchanged: the messages are redelivered either way.
              logger.error('worker.pause_failed', { error_name: errorFields(error).error_name });
            }
            return {
              batchItemFailures: messages.map((each) => ({ itemIdentifier: each.messageId })),
            };
          }
        }
        return { batchItemFailures };
      } finally {
        armed.disarm();
      }
    },

    // D16: an enabled source is left alone with no database connection, so a healthy stack's hourly
    // resume wakes nothing. A paused one is re-enabled only after the probe connects and reads
    // storage below the threshold: a read succeeds on a full database too (ADR-015).
    async resume() {
      const before = await eventSource.getState();
      if (before === 'enabled') {
        return { outcome: 'already_enabled', state: before };
      }
      let bytes: number;
      try {
        bytes = await databaseRepository.storageBytes(database.db);
      } catch (error) {
        if (classifyDatabaseError(error) === undefined) {
          throw error;
        }
        logger.warn('worker.resume_probe_failed', errorFields(error));
        return { outcome: 'probe_failed', state: before };
      }
      if (bytes >= storageLimitBytes * STORAGE_PROBE_THRESHOLD) {
        logger.warn('worker.resume_probe_failed');
        return { outcome: 'probe_failed', state: before };
      }
      await eventSource.enable();
      return { outcome: 'resumed', state: await eventSource.getState() };
    },
  };
}
