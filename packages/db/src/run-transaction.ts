import type { ExtractTablesWithRelations } from 'drizzle-orm';
import { NodePgSession, NodePgTransaction } from 'drizzle-orm/node-postgres';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { PoolClient } from 'pg';
import { classifyDatabaseError } from './classify-database-error.ts';
import type { Database } from './create-database.ts';
import { DatabaseUnavailableError } from './database-unavailable.error.ts';
import type { Transaction } from './executor.ts';

// As in `executor.ts`: no relational-query schema is registered.
type NoSchema = Record<string, never>;

export type RunTransactionOptions = {
  // D15: the worker's batch deadline. Aborting ends the transaction at once, whatever statement is
  // in flight: the checked-out client's socket is destroyed, so pg rejects the pending query on the
  // next tick, and the client is discarded like a connection-class failure. The one wait an abort
  // cannot cut short is a `pool.connect()` already under way, bounded by `CONNECTION_TIMEOUT_MS`.
  signal?: AbortSignal | undefined;
};

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
  { signal }: RunTransactionOptions = {},
): Promise<T> {
  if (signal?.aborted) {
    throw new DatabaseUnavailableError(signal.reason);
  }
  const client = await database.pool.connect();
  // pg-pool removes its idle `error` listener at checkout and restores it on release. A socket the
  // server drops mid-query (`ECONNRESET`, a Neon restart) makes pg 8.23.1 emit `error` on the client
  // synchronously, before the query's own rejection, which it defers to the next tick
  // (`lib/client.js` `_handleErrorEvent`, `_errorAllQueries`). With no listener that emit is an
  // uncaught exception that kills the Lambda before D15 can retry or pause, so the batch drains to
  // the DLQ (ADR-015). The rejection still reaches the catch below, which classifies it.
  client.on('error', ignoreClientError);
  // The deadline passed while the connect was under way: the client is healthy, so it goes back.
  if (signal?.aborted) {
    release(client);
    throw new DatabaseUnavailableError(signal.reason);
  }
  // Attached until the client is released, so the deadline also cuts a hung `COMMIT` or `ROLLBACK`.
  const abort = (): void => {
    client.connection.stream.destroy(new DatabaseUnavailableError(signal?.reason));
  };
  const detach = (): void => signal?.removeEventListener('abort', abort);
  signal?.addEventListener('abort', abort, { once: true });
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
    release(client, undefined, detach);
    return result;
  } catch (err) {
    if (signal?.aborted) {
      // The socket is gone, so the server rolls back; the caller sees `database_unavailable`, never
      // the driver error the destroyed stream raised.
      release(client, err instanceof Error ? err : true, detach);
      throw new DatabaseUnavailableError(signal.reason);
    }
    if (classifyDatabaseError(err) !== undefined) {
      release(client, err instanceof Error ? err : true, detach);
    } else {
      await rollbackAndRelease(client, detach);
    }
    throw err;
  }
}

function ignoreClientError(): void {}

// Hands the client back with the pool's own idle listener restored, so a late socket error after
// release reaches the pool's `error` handler (`createDatabase`'s `db.pool_error`) instead.
function release(client: PoolClient, err?: Error | true, detach?: () => void): void {
  detach?.();
  client.removeListener('error', ignoreClientError);
  client.release(err);
}

// Any other error leaves a healthy connection: roll back and return it to the pool. A rollback that
// fails discards the client too, and the caller still sees the original error.
async function rollbackAndRelease(client: PoolClient, detach: () => void): Promise<void> {
  try {
    await client.query('ROLLBACK');
  } catch (rollbackError) {
    release(client, rollbackError instanceof Error ? rollbackError : true, detach);
    return;
  }
  release(client, undefined, detach);
}
