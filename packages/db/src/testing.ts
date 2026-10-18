// @ledger/db/testing: the int harness's per-file handle (pp-testing → Postgres harness). Only
// `*.int.test.ts` files import it; the `int` project's global setup provides what it injects.
import { randomUUID } from 'node:crypto';
import { LedgerError, type Logger } from '@ledger/shared';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Client, escapeIdentifier, Pool } from 'pg';
import { inject } from 'vitest';
import { createDatabase, type Database } from './create-database.ts';
import { RUNTIME_ROLE } from './prepare-database.ts';
import {
  preparePostgres,
  startPostgresContainer,
  withCredentials,
  withDatabase,
} from './testing/postgres-container.ts';

export type TestDatabase = {
  // Connected as the runtime role, through the deployed factory: what tests pass to repositories,
  // commands and readers, so a missing grant fails as `permission denied`.
  db: NodePgDatabase;
  // The same size-1 pool as `db` with its Drizzle handle, for code that takes the whole `Database`:
  // the worker's `runTransaction` checks clients out of the pool itself (D15).
  database: Database;
  // The runtime role's URL for this clone, for a test that opens its own size-1 pools (a
  // concurrency test simulates one per Lambda container, ADR-005).
  runtimeUrl: string;
  // The owner on the same clone, for fault injection and `pg_stat_activity` polling only.
  owner: NodePgDatabase;
  // Closes both pools, then drops the clone.
  drop: () => Promise<void>;
};

// The factory's pool-error listener needs a logger; a test asserts on its own effects instead.
const silentLogger: Logger = {
  info: () => {},
  warn: () => {},
  error: () => {},
};

// One clone of the migrated template per test file: never truncated, never shared, so files run
// in parallel and each test asserts only on its own ids.
export async function createTestDatabase(): Promise<TestDatabase> {
  const { maintenanceUrl, runtimeUser, runtimePassword, template } = inject('postgresHarness');
  const name = `test_${randomUUID().replaceAll('-', '')}`;

  await onMaintenance(
    maintenanceUrl,
    `CREATE DATABASE ${escapeIdentifier(name)} TEMPLATE ${escapeIdentifier(template)}`,
  );

  const ownerUrl = withDatabase(maintenanceUrl, name);
  const runtimeUrl = withCredentials(ownerUrl, runtimeUser, runtimePassword);
  const runtime = createDatabase({ url: runtimeUrl, max: 1, logger: silentLogger });
  const ownerPool = new Pool({ connectionString: ownerUrl });
  // The pool has already dropped the client; without a listener a backend a test terminated
  // would crash the run (pp-database → Connection).
  ownerPool.on('error', () => {});

  return {
    db: runtime.db,
    database: runtime,
    runtimeUrl,
    owner: drizzle({ client: ownerPool }),
    drop: async () => {
      await Promise.all([runtime.pool.end(), ownerPool.end()]);
      await onMaintenance(maintenanceUrl, `DROP DATABASE ${escapeIdentifier(name)} WITH (FORCE)`);
    },
  };
}

// The SQLSTATE a rejected database call carried, read through Drizzle's `DrizzleQueryError`
// wrapper (the driver error is its `cause`). Resolves `undefined` when the call succeeded.
export async function sqlStateOf(call: Promise<unknown>): Promise<string | undefined> {
  try {
    await call;
    return undefined;
  } catch (err) {
    let e: unknown = err;
    for (let depth = 0; depth < 8 && typeof e === 'object' && e !== null; depth += 1) {
      if ('code' in e && typeof e.code === 'string') {
        return e.code;
      }
      e = 'cause' in e ? e.cause : undefined;
    }
    return undefined;
  }
}

async function onMaintenance(maintenanceUrl: string, statement: string): Promise<void> {
  const client = new Client({ connectionString: maintenanceUrl });
  await client.connect();
  try {
    await client.query(statement);
  } finally {
    await client.end();
  }
}

export type OutageDatabase = {
  // The runtime role's URL on the container's own database, for the pools the test composes. It
  // stays valid across `stop` and `start`: the container, its port and its data persist.
  runtimeUrl: string;
  // The owner on the same database: fault injection and re-running `prepareDatabase` only.
  ownerUrl: string;
  // A fast shutdown: every open session ends with `57P01`, every new connection then fails.
  stop: () => Promise<void>;
  // Starts Postgres again and resolves once it accepts connections.
  start: () => Promise<void>;
  // Removes the container.
  close: () => Promise<void>;
};

const OUTAGE_DATABASE = 'ledger_outage';

// pp-testing → Outage tests: a test that stops the server gets its own container, prepared through
// the same steps as the shared one (role, timeouts, migrations), so stopping it breaks no other
// file. The one exception to one container per run. Its start costs seconds: one per file, in
// `beforeAll`.
export async function startOutageDatabase(): Promise<OutageDatabase> {
  const container = await startPostgresContainer(OUTAGE_DATABASE, { stoppable: true });
  try {
    const ownerUrl = container.getConnectionUri();
    const runtimePassword = await preparePostgres(ownerUrl);
    // `pg_ctl` runs as the server's own user, against the image's `PGDATA`.
    const pgCtl = async (args: string[]): Promise<void> => {
      const result = await container.exec(['pg_ctl', ...args], { user: 'postgres' });
      if (result.exitCode !== 0) {
        throw new LedgerError('internal_error', 'pg_ctl failed in the outage container.');
      }
    };
    return {
      runtimeUrl: withCredentials(ownerUrl, RUNTIME_ROLE, runtimePassword),
      ownerUrl,
      stop: () => pgCtl(['stop', '-m', 'fast', '-w']),
      start: () => pgCtl(['start', '-w', '-l', '/tmp/postgres.log']),
      close: async () => {
        await container.stop();
      },
    };
  } catch (err) {
    await container.stop();
    throw err;
  }
}
