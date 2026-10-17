// @ledger/db/testing: the int harness's per-file handle (pp-testing → Postgres harness). Only
// `*.int.test.ts` files import it; the `int` project's global setup provides what it injects.
import { randomUUID } from 'node:crypto';
import type { Logger } from '@ledger/shared';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Client, escapeIdentifier, Pool } from 'pg';
import { inject } from 'vitest';
import { createDatabase } from './create-database.ts';

export type TestDatabase = {
  // Connected as the runtime role, through the deployed factory: what tests pass to repositories,
  // commands and readers, so a missing grant fails as `permission denied`.
  db: NodePgDatabase;
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

function withDatabase(url: string, database: string): string {
  const parsed = new URL(url);
  parsed.pathname = `/${database}`;
  return parsed.toString();
}

function withCredentials(url: string, user: string, password: string): string {
  const parsed = new URL(url);
  parsed.username = encodeURIComponent(user);
  parsed.password = encodeURIComponent(password);
  return parsed.toString();
}
