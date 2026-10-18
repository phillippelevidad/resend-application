// ADR-015, D9: what a stopped Postgres actually raises is classified `database_unavailable`, both on
// a pooled connection the shutdown ended and on a new connection it refuses, and a fresh connection
// works again once the server is back. The server stops, so this file runs its own container
// (pp-testing → Outage tests).
import { sql } from 'drizzle-orm';
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
