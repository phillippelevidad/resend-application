import { errorFields, type Logger } from '@ledger/shared';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

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
  const pool = new Pool({ connectionString: url, max });
  // An idle client dropped by the backend emits here after the pool has removed it; with no
  // listener Node raises an uncaught error that kills the process. Name and SQLSTATE only: a driver
  // error's `message` or `detail` can quote a row.
  pool.on('error', (err) => {
    const { error_name, pg_code } = errorFields(err);
    logger.error('db.pool_error', pg_code === undefined ? { error_name } : { error_name, pg_code });
  });
  return { db: drizzle({ client: pool }), pool };
}
