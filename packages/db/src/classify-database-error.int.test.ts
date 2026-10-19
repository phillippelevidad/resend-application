// ADR-015, D9: what a stopped Postgres actually raises is classified `database_unavailable`, both on
// a pooled connection the shutdown ended and on a new connection it refuses, and a fresh connection
// works again once the server is back. The server stops, so this file runs its own container
// (pp-testing → Outage tests).
import { request } from 'node:http';
import { DrizzleQueryError, sql } from 'drizzle-orm';
import type { PoolClient } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { classifyDatabaseError } from './classify-database-error.ts';
import { createDatabase, type Database } from './create-database.ts';
import { DatabaseUnavailableError } from './database-unavailable.error.ts';
import { type OutageDatabase, startOutageDatabase } from './testing.ts';

const silentLogger = { info: () => {}, warn: () => {}, error: () => {} };

let outage: OutageDatabase;
let database: Database;

beforeAll(async () => {
  outage = await startOutageDatabase();
  database = createDatabase({ url: outage.runtimeUrl, max: 1, logger: silentLogger });
}, 120_000);

afterAll(async () => {
  await database.pool.end();
  await outage.close();
}, 60_000);

async function failureOf(call: Promise<unknown>): Promise<unknown> {
  return call.then(
    () => undefined,
    (err: unknown) => err,
  );
}

describe('a stopped Postgres', () => {
  it('fails every query as database_unavailable, and a fresh connection succeeds once it is back', async () => {
    // A pooled connection is open before the shutdown.
    await database.db.execute(sql`select 1`);

    await outage.stop();
    const whileStopped = await failureOf(database.db.execute(sql`select 1`));
    const again = await failureOf(database.db.execute(sql`select 1`));
    expect(classifyDatabaseError(whileStopped)).toBeInstanceOf(DatabaseUnavailableError);
    expect(classifyDatabaseError(again)).toBeInstanceOf(DatabaseUnavailableError);

    await outage.start();
    const { rows } = await database.db.execute<{ one: number }>(sql`select 1 as one`);
    expect(rows[0]?.one).toBe(1);
  }, 60_000);
});

// Issue 8: a socket code counts only with a pg origin. A socket error a `createDatabase` pool's
// connection raised still classifies, inside Drizzle's wrapper and raw from pg-pool's checked-out
// client (`runTransaction`'s `BEGIN` and `COMMIT`); the same server's socket failure raised by any
// other client, in the shape the AWS SDK rejects with, does not.
type PooledClient = PoolClient & { connection: { stream: { destroy(err: Error): void } } };

const SOCKET_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  'EPIPE',
  'ENOTFOUND',
  'EAI_AGAIN',
  'EHOSTUNREACH',
  'ENETUNREACH',
]);

function codeOf(err: unknown): unknown {
  return typeof err === 'object' && err !== null && 'code' in err ? err.code : undefined;
}

// Destroys the socket of the pool's next checked-out client with `ECONNRESET`, as a peer reset
// does. `setImmediate` runs after the microtasks that issue the caller's query, so the query is
// queued or in flight on that socket when it drops.
function resetNextCheckout(): void {
  database.pool.once('acquire', (acquired) => {
    setImmediate(() =>
      (acquired as PooledClient).connection.stream.destroy(
        Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' }),
      ),
    );
  });
}

// As `@smithy/node-http-handler` 4.12.1 rejects a socket error (`dist-cjs/index.js:360-366`), plus
// the retry strategy's `$metadata` (`@smithy/core` 3.36.0 `submodules/retry`).
async function httpSocketError(url: URL): Promise<Error> {
  const err = await new Promise<Error>((resolve) => {
    const req = request({ host: url.hostname, port: url.port, path: '/' });
    req.on('error', resolve);
    req.end();
  });
  const renamed = ['ECONNRESET', 'EPIPE', 'ETIMEDOUT'].includes(String(codeOf(err)))
    ? { name: 'TimeoutError' }
    : {};
  return Object.assign(err, renamed, { $metadata: { attempts: 3, totalRetryDelay: 0 } });
}

describe('a socket code is the database only when pg raised it', () => {
  it('a reset under a Drizzle query classifies: the cause is the socket error itself', async () => {
    resetNextCheckout();
    const failure = await failureOf(database.db.execute(sql`select pg_sleep(0.5)`));

    expect(failure).toBeInstanceOf(DrizzleQueryError);
    expect(codeOf((failure as DrizzleQueryError).cause)).toBe('ECONNRESET');
    expect(classifyDatabaseError(failure)).toBeInstanceOf(DatabaseUnavailableError);
  });

  it("a reset on pg-pool's checked-out client classifies raw, with no Drizzle wrapper", async () => {
    resetNextCheckout();
    const client = await database.pool.connect();
    // pg-pool removes its idle listener at checkout; the client re-emits the socket error.
    client.on('error', () => {});
    const failure = await failureOf(client.query('select pg_sleep(0.5)'));
    client.release(true);

    expect(failure).not.toBeInstanceOf(DrizzleQueryError);
    expect(codeOf(failure)).toBe('ECONNRESET');
    expect(classifyDatabaseError(failure)).toBeInstanceOf(DatabaseUnavailableError);
  });

  it("the stopped server's connect failure classifies from pg-pool, and the same server's socket error from an HTTP client does not", async () => {
    await outage.stop();
    try {
      const connectFailure = await failureOf(database.pool.connect());
      const sdkShaped = await httpSocketError(new URL(outage.runtimeUrl));

      expect(connectFailure).not.toBeInstanceOf(DrizzleQueryError);
      expect(classifyDatabaseError(connectFailure)).toBeInstanceOf(DatabaseUnavailableError);
      expect(SOCKET_CODES.has(String(codeOf(sdkShaped)))).toBe(true);
      expect(classifyDatabaseError(sdkShaped)).toBeUndefined();
    } finally {
      await outage.start();
    }
  }, 60_000);
});
