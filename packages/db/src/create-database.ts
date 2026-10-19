import { errorFields, type Logger } from '@ledger/shared';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { DatabaseClient } from './database-client.ts';

// D9: both bounds sit below every function timeout, so a blackholed connect or an unanswered query
// ends as an error the classifier sees, never as a Lambda timeout that drains the batch to the DLQ.
// No `statement_timeout` or `lock_timeout` here: `pg` sends those as startup parameters, which a
// pooler may reject; the runtime role carries them instead (D10).
export const CONNECTION_TIMEOUT_MS = 5_000;
// Above the role's `lock_timeout` (10 s), which ends every lock wait server-side first, so a query
// unanswered for this long means the server is unreachable (D9).
export const QUERY_TIMEOUT_MS = 15_000;

export type CreateDatabaseOptions = {
  url: string;
  // ADR-005: one connection per function instance.
  max: number;
  logger: Logger;
};

export type Database = {
  db: NodePgDatabase;
  pool: Pool;
};

// The one connection factory, called once by a composition root with typed config; it never reads
// `process.env` (pp-general → Config).
export function createDatabase({ url, max, logger }: CreateDatabaseOptions): Database {
  const pool = new Pool({
    // Marks each socket error its connections raise, so the classifier counts it (D9).
    Client: DatabaseClient,
    connectionString: url,
    max,
    connectionTimeoutMillis: CONNECTION_TIMEOUT_MS,
    query_timeout: QUERY_TIMEOUT_MS,
  });
  // An idle client dropped by the backend emits here after the pool has removed it; with no
  // listener Node raises an uncaught error that kills the process. Name and SQLSTATE only: a driver
  // error's `message` or `detail` can quote a row.
  pool.on('error', (err) => {
    const { error_name, pg_code } = errorFields(err);
    logger.error('db.pool_error', pg_code === undefined ? { error_name } : { error_name, pg_code });
  });
  return { db: drizzle({ client: pool }), pool };
}
