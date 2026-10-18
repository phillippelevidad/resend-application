// Ships 4 (D15): after a `Query read timeout`, the retry runs on a fresh connection and the one that
// timed out is closed, never handed back to the pool. The owner holds the email row's lock, and this
// file's pool times queries out below the harness role's `lock_timeout` (5 s), so the first attempt
// fails on the client side first, as an unanswered query does in production. Sessions are observed
// by polling `pg_stat_activity` from the owner connection, never by sleeping.
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { classifyDatabaseError } from './classify-database-error.ts';
import type { Database } from './create-database.ts';
import { DatabaseUnavailableError } from './database-unavailable.error.ts';
import { emailStateRepository } from './email-state.repository.ts';
import type { Executor, Transaction } from './executor.ts';
import { runTransaction } from './run-transaction.ts';
import { createTestDatabase, type TestDatabase } from './testing.ts';

// Below the harness `lock_timeout`, so the client gives up while the server still waits.
const QUERY_TIMEOUT_MS = 1_000;

let t: TestDatabase;
let worker: Database;

beforeAll(async () => {
  t = await createTestDatabase();
  // A size-1 pool as the runtime role, like a worker container's (ADR-005), with a short read timeout.
  const pool = new Pool({
    connectionString: t.runtimeUrl,
    max: 1,
    query_timeout: QUERY_TIMEOUT_MS,
  });
  // A discarded client's late socket error lands here; the test asserts on sessions instead.
  pool.on('error', () => {});
  worker = { db: drizzle({ client: pool }), pool };
});

afterAll(async () => {
  await worker.pool.end();
  await t.drop();
});

async function backendPid(db: Executor): Promise<number> {
  const { rows } = await db.execute<{ pid: number }>(sql`select pg_backend_pid() as pid`);
  const pid = rows[0]?.pid;
  if (pid === undefined) {
    throw new TypeError('pg_backend_pid() returned no row.');
  }
  return pid;
}

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

// Polls, with a bound, until the backend no longer appears in `pg_stat_activity`.
async function waitUntilGone(pid: number): Promise<void> {
  for (let attempt = 0; attempt < 2_000; attempt += 1) {
    const { rows } = await t.owner.execute<{ present: boolean }>(
      sql`select exists (select 1 from pg_stat_activity where pid = ${pid}) as present`,
    );
    if (rows[0]?.present === false) {
      return;
    }
  }
  throw new TypeError(`Backend ${pid} is still connected.`);
}

function messagesOf(err: unknown): string[] {
  const messages: string[] = [];
  let e: unknown = err;
  for (let depth = 0; depth < 8 && e instanceof Error; depth += 1) {
    messages.push(e.message);
    e = e.cause;
  }
  return messages;
}

describe('runTransaction', () => {
  it('retries a Query read timeout on a different backend and closes the one that timed out', async () => {
    const emailId = 'email-run-transaction-timeout';
    const lastEventAt = new Date('2026-10-17T12:00:00.000Z');
    await emailStateRepository.createIfAbsent(t.db, { emailId, lastEventAt });

    const release = await holdEmailLock(emailId);
    let failedPid: number | undefined;
    const failure = await runTransaction(worker, async (tx) => {
      failedPid = await backendPid(tx);
      await emailStateRepository.lockEmail(tx, emailId);
    }).then(
      () => undefined,
      (err: unknown) => err,
    );
    await release();

    expect(messagesOf(failure)).toContain('Query read timeout');
    expect(classifyDatabaseError(failure)).toBeInstanceOf(DatabaseUnavailableError);
    expect(failedPid).toBeTypeOf('number');

    const retryPid = await runTransaction(worker, async (tx) => {
      await emailStateRepository.lockEmail(tx, emailId);
      return backendPid(tx);
    });
    expect(retryPid).not.toBe(failedPid);
    await waitUntilGone(failedPid ?? 0);
  }, 15_000);

  it('rolls back on an ordinary error and keeps the connection for the next transaction', async () => {
    const emailId = 'email-run-transaction-rollback';
    const lastEventAt = new Date('2026-10-17T12:00:00.000Z');
    let firstPid: number | undefined;
    const failure = await runTransaction(worker, async (tx) => {
      firstPid = await backendPid(tx);
      await emailStateRepository.createIfAbsent(tx, { emailId, lastEventAt });
      throw new TypeError('not a connection error');
    }).then(
      () => undefined,
      (err: unknown) => err,
    );

    expect(failure).toBeInstanceOf(TypeError);
    expect(await emailStateRepository.get(t.db, emailId)).toBeUndefined();
    expect(await runTransaction(worker, (tx) => backendPid(tx))).toBe(firstPid);
  });

  it('commits what the function wrote', async () => {
    const emailId = 'email-run-transaction-commit';
    const lastEventAt = new Date('2026-10-17T12:00:00.000Z');
    await runTransaction(worker, (tx) =>
      emailStateRepository.createIfAbsent(tx, { emailId, lastEventAt }),
    );
    expect((await emailStateRepository.get(t.db, emailId))?.emailId).toBe(emailId);
  });
});
