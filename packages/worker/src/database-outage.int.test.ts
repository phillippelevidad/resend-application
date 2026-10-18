// Slice 2, Ships 4 (R6, R7; ADR-015): on a database outage the worker retries once on a fresh
// connection, then lists every message of the batch, pauses its own event source and stops, so the
// outage costs each message one receive and none reaches the DLQ. A connection the server drops
// mid-transaction (a Neon suspend, PG-U04) is retried and commits; any other error fails its
// message alone (ADR-008). The server is stopped, so this file runs its own container
// (pp-testing → Outage tests); sessions are observed by polling `pg_stat_activity`, never by
// sleeping.
import type { IngestEnvelope } from '@ledger/core';
import {
  createDatabase,
  type Database,
  emailStateRepository,
  STORAGE_LIMIT_BYTES,
  type Transaction,
  webhookEventsRepository,
} from '@ledger/db';
import { type OutageDatabase, startOutageDatabase } from '@ledger/db/testing';
import { createLogger, type Logger } from '@ledger/shared';
import { FakeClock, FakeEventSourceControl, RecordingMetrics } from '@ledger/shared/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createWorker, type Worker } from './create-worker.ts';

// AWS-09: SQS moves a message to the DLQ once its receive count passes `maxReceiveCount`, 5 here.
const MAX_RECEIVE_COUNT = 5;
const WORKER_APPLICATION = 'outage_worker';

const silentLogger: Logger = { info: () => {}, warn: () => {}, error: () => {} };

let outage: OutageDatabase;
// The worker container's one size-1 pool, as the runtime role, built with the deployed factory's
// connect and query timeouts (ADR-005, D9).
let database: Database;
// The owner on the same database: fault injection and `pg_stat_activity` only. Two connections: one
// holds a lock while the other polls. The factory's error listener absorbs the sessions a stop ends.
let owner: Database;

beforeAll(async () => {
  outage = await startOutageDatabase();
  const url = new URL(outage.runtimeUrl);
  url.searchParams.set('application_name', WORKER_APPLICATION);
  database = createDatabase({ url: url.toString(), max: 1, logger: silentLogger });
  owner = createDatabase({ url: outage.ownerUrl, max: 2, logger: silentLogger });
}, 120_000);

afterAll(async () => {
  await Promise.all([database.pool.end(), owner.pool.end()]);
  await outage.close();
}, 60_000);

// Fresh ids per test: the tests share this file's database and assert only on their own ids.
let lastId = 0;
const fresh = (label: string): string => {
  lastId += 1;
  return `${label}_${lastId}`;
};

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

type Harness = { worker: Worker; eventSource: FakeEventSourceControl; lines: () => string[] };

function harness(eventSource = new FakeEventSourceControl()): Harness {
  const lines: string[] = [];
  const worker = createWorker({
    database,
    eventSource,
    storageLimitBytes: STORAGE_LIMIT_BYTES,
    clock: new FakeClock('2026-10-17T12:01:00.000Z'),
    logger: createLogger({ functionName: 'worker', stream: { write: (line) => lines.push(line) } }),
    metrics: new RecordingMetrics(),
    addressHashKey: new Uint8Array(32).fill(7),
  });
  return { worker, eventSource, lines: () => lines };
}

const messagesNamed = (lines: string[], message: string) =>
  lines
    .map((line) => JSON.parse(line) as Record<string, unknown>)
    .filter((line) => line.message === message);

// The server is always started again, so a failing assertion never strands the next test.
async function whileStopped<T>(run: () => Promise<T>): Promise<T> {
  await outage.stop();
  try {
    return await run();
  } finally {
    await outage.start();
  }
}

type Batch = { messageId: string; body: string }[];

function batchOfThree(label: string): { batch: Batch; svixIds: string[] } {
  const svixIds = [fresh(`msg_${label}`), fresh(`msg_${label}`), fresh(`msg_${label}`)];
  const batch = svixIds.map((svixId, index) => ({
    messageId: `sqs-${label}-${index + 1}`,
    body: body(svixId, fresh(`e_${label}`)),
  }));
  return { batch, svixIds };
}

const allListed = (batch: Batch) => ({
  batchItemFailures: batch.map(({ messageId }) => ({ itemIdentifier: messageId })),
});

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
  const done = owner.db.transaction(async (tx: Transaction) => {
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

// Polls, with a bound, until the worker's session waits on a lock, and answers its pid.
async function workerWaitingOnLock(): Promise<number> {
  for (let attempt = 0; attempt < 2_000; attempt += 1) {
    const { rows } = await owner.pool.query<{ pid: number }>(
      `select pid from pg_stat_activity
        where application_name = $1 and wait_event_type = 'Lock'`,
      [WORKER_APPLICATION],
    );
    const pid = rows[0]?.pid;
    if (pid !== undefined) {
      return pid;
    }
  }
  throw new TypeError('The worker never waited on the lock.');
}

describe('database outage (ADR-015)', () => {
  it('a batch of three with Postgres stopped lists all three, pauses after that one batch, and none reaches the DLQ', async () => {
    const { worker, eventSource, lines } = harness();
    const { batch, svixIds } = batchOfThree('outage');
    const receives = new Map<string, number>();
    const deliver = async () => {
      for (const { messageId } of batch)
        receives.set(messageId, (receives.get(messageId) ?? 0) + 1);
      return worker.processBatch(batch);
    };

    const response = await whileStopped(deliver);

    expect(response).toEqual(allListed(batch));
    expect(eventSource.state).toBe('paused');
    expect(messagesNamed(lines(), 'worker.database_unavailable')).toHaveLength(1);
    expect(messagesNamed(lines(), 'worker.message_failed')).toEqual([]);

    // A paused event source receives nothing more (AWS-18), so the receive count stops at one
    // until the resume re-enables it; the redelivered batch then commits every event.
    expect(await worker.resume()).toEqual({ outcome: 'resumed', state: 'enabled' });
    expect(await deliver()).toEqual({ batchItemFailures: [] });
    expect(await webhookEventsRepository.countPresent(database.db, svixIds)).toBe(3);
    expect(Math.max(...receives.values())).toBeLessThan(MAX_RECEIVE_COUNT);
  }, 60_000);

  it('a connection dropped mid-transaction is retried on a fresh connection and commits; the source stays enabled', async () => {
    const { worker, eventSource, lines } = harness();
    const emailId = fresh('e_dropped');
    expect(
      await worker.processBatch([
        { messageId: 'sqs-seed', body: body(fresh('msg_seed'), emailId) },
      ]),
    ).toEqual({ batchItemFailures: [] });

    const delivered = fresh('msg_dropped');
    const release = await holdEmailLock(emailId);
    const running = worker.processBatch([
      { messageId: 'sqs-dropped', body: body(delivered, emailId, 'email.delivered', 1) },
    ]);
    // PG-U04's case: the server ends the session while the message's transaction is open.
    const pid = await workerWaitingOnLock();
    await owner.pool.query('select pg_terminate_backend($1)', [pid]);
    await release();

    expect(await running).toEqual({ batchItemFailures: [] });
    expect(eventSource.state).toBe('enabled');
    expect(await webhookEventsRepository.countPresent(database.db, [delivered])).toBe(1);
    expect((await emailStateRepository.get(database.db, emailId))?.status).toBe('delivered');
    expect(messagesNamed(lines(), 'worker.database_unavailable')).toEqual([]);
  }, 30_000);

  // D15 through the worker: the message's transaction must run on a client `runTransaction` checked
  // out itself. A socket that dies mid-transaction with no ErrorResponse first makes pg emit `error`
  // on the checked-out client; through Drizzle's own `transaction()` that emit is uncaught and fails
  // this run (on Lambda it kills the process before the retry or the pause).
  it('a socket reset mid-transaction is retried on a fresh connection and commits; the source stays enabled', async () => {
    const { worker, eventSource } = harness();
    const emailId = fresh('e_reset');
    expect(
      await worker.processBatch([
        { messageId: 'sqs-seed', body: body(fresh('msg_seed'), emailId) },
      ]),
    ).toEqual({ batchItemFailures: [] });

    let client: { connection: { stream: { destroy(err: Error): void } } } | undefined;
    const onAcquire = (acquired: unknown): void => {
      client = acquired as typeof client;
    };
    database.pool.on('acquire', onAcquire);
    try {
      const delivered = fresh('msg_reset');
      const release = await holdEmailLock(emailId);
      const running = worker.processBatch([
        { messageId: 'sqs-reset', body: body(delivered, emailId, 'email.delivered', 1) },
      ]);
      await workerWaitingOnLock();
      client?.connection.stream.destroy(
        Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' }),
      );
      await release();

      expect(await running).toEqual({ batchItemFailures: [] });
      expect(eventSource.state).toBe('enabled');
      expect(await webhookEventsRepository.countPresent(database.db, [delivered])).toBe(1);
    } finally {
      database.pool.off('acquire', onAcquire);
    }
  }, 30_000);

  it('a non-connection failure with Postgres up lists only that message and leaves the source enabled', async () => {
    const { worker, eventSource } = harness();
    const { batch, svixIds } = batchOfThree('poison');
    const poisoned = batch.map((message, index) =>
      index === 1 ? { ...message, body: '{"not":"an envelope"}' } : message,
    );

    const response = await worker.processBatch(poisoned);

    expect(response).toEqual({ batchItemFailures: [{ itemIdentifier: 'sqs-poison-2' }] });
    expect(eventSource.state).toBe('enabled');
    expect(
      await webhookEventsRepository.countPresent(database.db, [svixIds[0] ?? '', svixIds[2] ?? '']),
    ).toBe(2);
  });

  it('a failing disable logs worker.pause_failed by name and leaves the response unchanged', async () => {
    const eventSource = new FakeEventSourceControl();
    eventSource.failDisable = true;
    const { worker, lines } = harness(eventSource);
    const { batch } = batchOfThree('pause_failed');

    const response = await whileStopped(() => worker.processBatch(batch));

    expect(response).toEqual(allListed(batch));
    expect(eventSource.state).toBe('enabled');
    expect(messagesNamed(lines(), 'worker.pause_failed')).toEqual([
      expect.objectContaining({ level: 'error', error_name: 'FakeFailure' }),
    ]);
  }, 60_000);
});
