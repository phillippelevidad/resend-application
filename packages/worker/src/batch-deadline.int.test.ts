// D15, ADR-015: the batch deadline. A database that is slow but still answering is never classified
// as an outage, so without a deadline one message's statements can outlast the worker's 60 s
// timeout: the Lambda dies before the pause, and five such receives move the batch to the DLQ. With
// it, running out of time is an outage: every message of the batch is listed and the worker pauses
// its own event source, between messages and in the middle of a transaction alike. Time is the fake
// clock's, so no test waits for a real deadline; sessions are observed by polling
// `pg_stat_activity`, never by sleeping. The harness role carries a 5 s `lock_timeout`.
import type { IngestEnvelope } from '@ledger/core';
import {
  createDatabase,
  type Database,
  emailStateRepository,
  STORAGE_LIMIT_BYTES,
  type Transaction,
  webhookEventsRepository,
} from '@ledger/db';
import { createTestDatabase, type TestDatabase } from '@ledger/db/testing';
import { createLogger, type Logger, type MetricsPort } from '@ledger/shared';
import { FakeClock, FakeEventSourceControl, RecordingMetrics } from '@ledger/shared/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BATCH_DEADLINE_RESERVE_MS, type BatchDeadline, createWorker } from './create-worker.ts';

const silentLogger: Logger = { info: () => {}, warn: () => {}, error: () => {} };
const WORKER_APPLICATION = 'deadline_worker';
// The worker's 60 s timeout (D27), as the Lambda context reports it when the batch starts.
const LAMBDA_TIMEOUT_MS = 60_000;
const DEADLINE_AFTER_MS = LAMBDA_TIMEOUT_MS - BATCH_DEADLINE_RESERVE_MS;

let t: TestDatabase;
// The worker container's size-1 pool as the runtime role, named so its session can be found.
let workerDatabase: Database;

beforeAll(async () => {
  t = await createTestDatabase();
  const url = new URL(t.runtimeUrl);
  url.searchParams.set('application_name', WORKER_APPLICATION);
  workerDatabase = createDatabase({ url: url.toString(), max: 1, logger: silentLogger });
});

afterAll(async () => {
  await workerDatabase.pool.end();
  await t.drop();
});

function body(svixId: string, emailId: string, type = 'email.sent', second = 0): string {
  const envelope: IngestEnvelope = {
    svixId,
    receivedAt: '2026-10-17T12:01:00.000Z',
    source: 'simulated',
    rawBody: JSON.stringify({
      type,
      created_at: new Date(Date.UTC(2026, 9, 17, 12, 0, second)).toISOString(),
      data: { email_id: emailId, to: ['delivered@resend.dev'], subject: 'Order confirmation' },
    }),
    headers: { 'svix-timestamp': '1792238460' },
  };
  return JSON.stringify(envelope);
}

const fullInvocation: BatchDeadline = { getRemainingTimeInMillis: () => LAMBDA_TIMEOUT_MS };

type Harness = {
  clock: FakeClock;
  eventSource: FakeEventSourceControl;
  lines: string[];
  processBatch: ReturnType<typeof createWorker>['processBatch'];
};

function harness(database: Database, metrics?: (clock: FakeClock) => MetricsPort): Harness {
  const clock = new FakeClock('2026-10-17T12:01:00.000Z');
  const eventSource = new FakeEventSourceControl();
  const lines: string[] = [];
  const worker = createWorker({
    database,
    eventSource,
    storageLimitBytes: STORAGE_LIMIT_BYTES,
    clock,
    logger: createLogger({ functionName: 'worker', stream: { write: (line) => lines.push(line) } }),
    metrics: metrics?.(clock) ?? new RecordingMetrics(),
    addressHashKey: new Uint8Array(32).fill(9),
    sleep: clock.sleep,
  });
  return { clock, eventSource, lines, processBatch: worker.processBatch };
}

const messagesNamed = (lines: string[], message: string) =>
  lines
    .map((line) => JSON.parse(line) as Record<string, unknown>)
    .filter((line) => line.message === message);

// Locks the email row in an owner transaction and holds it until the returned release is called.
async function holdEmailLock(emailId: string): Promise<() => Promise<void>> {
  let locked = (): void => {};
  const lockTaken = new Promise<void>((resolve) => {
    locked = resolve;
  });
  let release = (): void => {};
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  const done = t.owner.transaction(async (tx: Transaction) => {
    await emailStateRepository.lockEmail(tx, emailId);
    locked();
    await released;
  });
  await Promise.race([lockTaken, done]);
  return async () => {
    release();
    await done;
  };
}

async function workerSessions(predicate: string): Promise<number[]> {
  const { rows } = await t.owner.execute<{ pid: number }>(
    `select pid from pg_stat_activity where application_name = '${WORKER_APPLICATION}' and ${predicate}`,
  );
  return rows.map((row) => row.pid);
}

// Polls, with a bound, until the worker's session waits on a lock, and answers its pid.
async function workerWaitingOnLock(): Promise<number> {
  for (let attempt = 0; attempt < 2_000; attempt += 1) {
    const [pid] = await workerSessions(`wait_event_type = 'Lock'`);
    if (pid !== undefined) {
      return pid;
    }
  }
  throw new TypeError('The worker never waited on the lock.');
}

// Polls, with a bound, until the server has ended the session whose socket the worker destroyed.
async function sessionEnded(pid: number): Promise<void> {
  for (let attempt = 0; attempt < 2_000; attempt += 1) {
    if ((await workerSessions(`pid = ${pid}`)).length === 0) {
      return;
    }
  }
  throw new TypeError('The abandoned session never ended.');
}

describe('the batch deadline (D15, ADR-015)', () => {
  it('a deadline passed between messages lists every message, starts no further one, and pauses the source', async () => {
    // Each committed message takes 30 s of the fake clock (its lag metric is the last thing it
    // emits), so the third starts past the deadline.
    const { eventSource, lines, processBatch } = harness(t.database, (clock) => ({
      count: () => {},
      duration: (name) => {
        if (name === 'worker.processing_lag') clock.advance(30_000);
      },
    }));
    const svixIds = ['msg_between_1', 'msg_between_2', 'msg_between_3'];
    const batch = svixIds.map((svixId, index) => ({
      messageId: `sqs-between-${index + 1}`,
      body: body(svixId, `e_between_${index + 1}`),
    }));

    const response = await processBatch(batch, fullInvocation);

    expect(response).toEqual({
      batchItemFailures: batch.map(({ messageId }) => ({ itemIdentifier: messageId })),
    });
    expect(eventSource.state).toBe('paused');
    // The two that committed come back as duplicates, absorbed on `svix_id`; the third never ran.
    expect(await webhookEventsRepository.countPresent(t.db, svixIds.slice(0, 2))).toBe(2);
    expect(await webhookEventsRepository.countPresent(t.db, svixIds.slice(2))).toBe(0);
    expect(messagesNamed(lines, 'worker.database_unavailable')).toEqual([
      expect.objectContaining({ level: 'error', error_code: 'database_unavailable' }),
    ]);
    expect(messagesNamed(lines, 'worker.message_failed')).toEqual([]);
  });

  it('a transaction slowed below the query timeout is cut at the deadline: the batch is listed, the source pauses, and the redelivery commits', async () => {
    const { clock, eventSource, lines, processBatch } = harness(workerDatabase);
    const emailId = 'e_slow';
    expect(
      await processBatch(
        [{ messageId: 'sqs-slow-seed', body: body('msg_slow_seed', emailId) }],
        fullInvocation,
      ),
    ).toEqual({ batchItemFailures: [] });

    // The slow database: the message's lock wait answers, eventually, well inside the 15 s query
    // timeout, so nothing classifies it. The owner's lock stands in for the slow statement.
    const slowIds = ['msg_slow', 'msg_slow_other'];
    const batch = [
      { messageId: 'sqs-slow', body: body('msg_slow', emailId, 'email.delivered', 1) },
      { messageId: 'sqs-slow-other', body: body('msg_slow_other', 'e_slow_other') },
    ];
    const release = await holdEmailLock(emailId);
    let response: Awaited<ReturnType<typeof processBatch>>;
    let abandoned: number;
    let stillWaiting: number[];
    try {
      const running = processBatch(batch, fullInvocation);
      abandoned = await workerWaitingOnLock();
      // The invocation reaches its deadline while the statement is still in flight.
      clock.advance(DEADLINE_AFTER_MS);
      response = await running;
      // The worker answered while its statement still waited server-side: the deadline cut the one
      // transaction, rather than waiting for the database to end it (here the 5 s `lock_timeout`; a
      // statement answering at 14 s would end it past the Lambda's timeout).
      stillWaiting = await workerSessions(`pid = ${abandoned} and wait_event_type = 'Lock'`);
    } finally {
      await release();
    }

    expect(stillWaiting).toEqual([abandoned]);
    expect(response).toEqual({
      batchItemFailures: batch.map(({ messageId }) => ({ itemIdentifier: messageId })),
    });
    expect(eventSource.state).toBe('paused');
    expect(await webhookEventsRepository.countPresent(t.db, slowIds)).toBe(0);
    expect(messagesNamed(lines, 'worker.database_unavailable')).toEqual([
      expect.objectContaining({
        level: 'error',
        error_name: 'DatabaseUnavailableError',
        error_code: 'database_unavailable',
      }),
    ]);

    // The cut connection was discarded, not handed back: after the resume the redelivered batch
    // commits on a fresh one, so the deadline lost nothing.
    await sessionEnded(abandoned);
    await eventSource.enable();
    expect(await processBatch(batch, fullInvocation)).toEqual({ batchItemFailures: [] });
    expect(await webhookEventsRepository.countPresent(t.db, slowIds)).toBe(2);
    expect((await emailStateRepository.get(t.db, emailId))?.status).toBe('delivered');
  }, 30_000);
});
