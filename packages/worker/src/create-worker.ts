import { type EventSourceState, type ResumeOutcome, resumeOutcomes } from '@ledger/core';
import {
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
};

// D16: what the resume event answers; the outcomes live in `@ledger/core`, shared with the read API.
export { type ResumeOutcome, resumeOutcomes };
export type ResumeResult = { outcome: ResumeOutcome; state: EventSourceState };

export type Worker = {
  processBatch(messages: readonly QueueMessage[]): Promise<BatchResponse>;
  resume(): Promise<ResumeResult>;
};

// One message's result: committed, failed alone (ADR-008), or the database is out (ADR-015).
type MessageResult = 'committed' | 'failed' | 'database_unavailable';

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
}: WorkerDeps): Worker {
  const recordEvent = new RecordEventCommand({ database, clock, metrics, addressHashKey });

  // D15 steps 1, 2 and 4. A connection-class failure runs the message once more; `runTransaction`
  // discarded the connection that failed, so the retry connects afresh (a Neon suspend can drop one,
  // PG-U04). Any other error fails this message alone.
  async function record(message: QueueMessage): Promise<MessageResult> {
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      try {
        await recordEvent.execute({ body: message.body });
        return 'committed';
      } catch (error) {
        if (classifyDatabaseError(error) === undefined) {
          // Name, registry code and SQLSTATE only: a parse or Postgres error can quote the row.
          logger.error('worker.message_failed', errorFields(error));
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
    async processBatch(messages) {
      // ADR-008, AWS-05: built from each message's own result, never assumed. An id left out is
      // acknowledged, so a failure is never swallowed: it is listed and redelivered.
      const batchItemFailures: { itemIdentifier: string }[] = [];
      for (const message of messages) {
        const result = await record(message);
        if (result === 'failed') {
          batchItemFailures.push({ itemIdentifier: message.messageId });
        } else if (result === 'database_unavailable') {
          // D15 step 3, ADR-015: every message of the batch is listed, so the outage costs each one
          // receive and moves none to the DLQ; a message already committed here comes back as a
          // duplicate, absorbed on `svix_id`. Then the worker pauses its own event source and stops.
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
