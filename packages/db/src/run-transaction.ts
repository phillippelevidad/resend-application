import type { ExtractTablesWithRelations } from 'drizzle-orm';
import { NodePgSession, NodePgTransaction } from 'drizzle-orm/node-postgres';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { PoolClient } from 'pg';
import { classifyDatabaseError } from './classify-database-error.ts';
import type { Database } from './create-database.ts';
import type { Transaction } from './executor.ts';

// As in `executor.ts`: no relational-query schema is registered.
type NoSchema = Record<string, never>;

// D15: one transaction on a client this function checks out itself, so a connection-class failure
// discards that client instead of handing it back to the pool. Drizzle 0.45.4's `transaction()`
// rolls back on the failed client and then releases it with no error, and pg-pool keeps a released
// client that is still queryable, which a `Query read timeout` leaves it (D9). On a size-1 pool the
// retry would then wait on the same hung socket. Here a classified error releases the client with
// the error, so pg-pool closes it, and sends no `ROLLBACK`: the server rolls back when the
// connection closes. The retry costs one connect and one query timeout, nothing more.
export async function runTransaction<T>(
  database: Database,
  fn: (tx: Transaction) => Promise<T>,
): Promise<T> {
  const client = await database.pool.connect();
  // The same dialect and session `drizzle({ client })` builds, bound to this one client.
  const dialect = new PgDialect();
  const tx: Transaction = new NodePgTransaction<NoSchema, ExtractTablesWithRelations<NoSchema>>(
    dialect,
    new NodePgSession(client, dialect, undefined),
    undefined,
  );
  try {
    await client.query('BEGIN');
    const result = await fn(tx);
    await client.query('COMMIT');
    client.release();
    return result;
  } catch (err) {
    if (classifyDatabaseError(err) !== undefined) {
      client.release(err instanceof Error ? err : true);
    } else {
      await rollbackAndRelease(client);
    }
    throw err;
  }
}

// Any other error leaves a healthy connection: roll back and return it to the pool. A rollback that
// fails discards the client too, and the caller still sees the original error.
async function rollbackAndRelease(client: PoolClient): Promise<void> {
  try {
    await client.query('ROLLBACK');
  } catch (rollbackError) {
    client.release(rollbackError instanceof Error ? rollbackError : true);
    return;
  }
  client.release();
}
