// Slice 2, Ships 10 (D10; pp-database → grants): a runtime-role session frozen inside its
// transaction (a Lambda frozen or killed mid-transaction) holds its row locks until the role's
// `idle_in_transaction_session_timeout` ends it. That bound sits below the role's `lock_timeout`, so
// the holder is terminated before a waiting worker's lock wait expires, and the worker commits. The
// harness role carries 2 s idle and 5 s lock. Sessions are observed by polling `pg_stat_activity`,
// never by sleeping.
import type { IngestEnvelope } from '@ledger/core';
import { hashAddress } from '@ledger/core';
import {
  createDatabase,
  type Database,
  emailRecipientsRepository,
  emailStateRepository,
  recipientStateRepository,
  STORAGE_LIMIT_BYTES,
  webhookEventsRepository,
} from '@ledger/db';
import { createTestDatabase, type TestDatabase } from '@ledger/db/testing';
import type { Logger } from '@ledger/shared';
import { FakeClock, FakeEventSourceControl, RecordingMetrics } from '@ledger/shared/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createWorker } from './create-worker.ts';

const silentLogger: Logger = { info: () => {}, warn: () => {}, error: () => {} };
const key = new Uint8Array(32).fill(17);
const recipient = 'delivered+idle-holder@resend.dev';
const WORKER_APPLICATION = 'idle_worker';
const HOLDER_APPLICATION = 'idle_holder';

let t: TestDatabase;
// The worker container's size-1 pool, and the frozen session's, both as the runtime role.
let workerDatabase: Database;
let holderDatabase: Database;

function named(url: string, applicationName: string): string {
  const parsed = new URL(url);
  parsed.searchParams.set('application_name', applicationName);
  return parsed.toString();
}

beforeAll(async () => {
  t = await createTestDatabase();
  workerDatabase = createDatabase({
    url: named(t.runtimeUrl, WORKER_APPLICATION),
    max: 1,
    logger: silentLogger,
  });
  holderDatabase = createDatabase({
    url: named(t.runtimeUrl, HOLDER_APPLICATION),
    max: 1,
    logger: silentLogger,
  });
});

afterAll(async () => {
  await Promise.all([workerDatabase.pool.end(), holderDatabase.pool.end()]);
  await t.drop();
});

function body(svixId: string, emailId: string, type: string, second: number): string {
  const envelope: IngestEnvelope = {
    svixId,
    receivedAt: '2026-10-17T12:01:00.000Z',
    source: 'simulated',
    rawBody: JSON.stringify({
      type,
      created_at: new Date(Date.UTC(2026, 9, 17, 12, 0, second)).toISOString(),
      data: { email_id: emailId, to: [recipient], subject: 'Order confirmation' },
    }),
    headers: { 'svix-timestamp': '1792238460' },
  };
  return JSON.stringify(envelope);
}

// Polls, with a bound, for a session of the named application matching the predicate.
async function pidOf(applicationName: string, predicate: string): Promise<number | undefined> {
  const { rows } = await t.owner.execute<{ pid: number }>(
    `select pid from pg_stat_activity where application_name = '${applicationName}' and ${predicate}`,
  );
  return rows[0]?.pid;
}

async function waitFor(applicationName: string, predicate: string): Promise<number> {
  for (let attempt = 0; attempt < 2_000; attempt += 1) {
    const pid = await pidOf(applicationName, predicate);
    if (pid !== undefined) {
      return pid;
    }
  }
  throw new TypeError(`No ${applicationName} session matched.`);
}

describe('role timeouts end an idle lock holder (D10)', () => {
  it('a runtime session idling on the email row is terminated and the worker commits one row of everything', async () => {
    const worker = createWorker({
      database: workerDatabase,
      eventSource: new FakeEventSourceControl(),
      storageLimitBytes: STORAGE_LIMIT_BYTES,
      clock: new FakeClock('2026-10-17T12:01:00.000Z'),
      logger: silentLogger,
      metrics: new RecordingMetrics(),
      addressHashKey: key,
    });
    const emailId = 'e_idle_holder';
    expect(
      await worker.processBatch([
        { messageId: 'sqs-sent', body: body('msg_idle_sent', emailId, 'email.sent', 0) },
      ]),
    ).toEqual({ batchItemFailures: [] });

    // The frozen holder: it takes the email row's lock and then sends nothing more.
    const holder = await holderDatabase.pool.connect();
    // The server's termination arrives while no query runs; the test reads it from the sessions.
    holder.on('error', () => {});
    await holder.query('BEGIN');
    await holder.query('select email_id from email_state where email_id = $1 for update', [
      emailId,
    ]);
    const holderPid = await waitFor(HOLDER_APPLICATION, `state = 'idle in transaction'`);

    const running = worker.processBatch([
      {
        messageId: 'sqs-delivered',
        body: body('msg_idle_delivered', emailId, 'email.delivered', 1),
      },
    ]);
    // Not vacuous: the worker does wait on the holder's lock.
    await waitFor(WORKER_APPLICATION, `wait_event_type = 'Lock'`);

    expect(await running).toEqual({ batchItemFailures: [] });
    expect(await pidOf(HOLDER_APPLICATION, `pid = ${holderPid}`)).toBeUndefined();
    holder.release(true);

    const hash = hashAddress(key, recipient);
    expect(
      await webhookEventsRepository.countPresent(t.db, ['msg_idle_sent', 'msg_idle_delivered']),
    ).toBe(2);
    const state = await emailStateRepository.get(t.db, emailId);
    expect(state).toMatchObject({ status: 'delivered', eventCount: 2 });
    expect(await emailRecipientsRepository.listByEmail(t.db, emailId)).toEqual([
      expect.objectContaining({ addressHash: hash, status: 'delivered' }),
    ]);
    expect(await recipientStateRepository.listByAddressHashes(t.db, [hash])).toHaveLength(1);
  }, 20_000);
});
