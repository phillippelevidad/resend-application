import { fileURLToPath } from 'node:url';
import { LedgerError } from '@ledger/shared';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { type Client, escapeIdentifier, escapeLiteral } from 'pg';
import { DatabaseClient } from './database-client.ts';

// The DML-only role every runtime connects as. drizzle/0001_grant-ledger-tables.sql spells the
// same literal (SQL cannot import it), so a mismatch fails as `permission denied` in the harness.
export const RUNTIME_ROLE = 'ledger_runtime';

export const MIGRATIONS_FOLDER = fileURLToPath(new URL('../drizzle', import.meta.url));

// The runtime role's server-side bounds on a frozen or killed function's open transaction (D10,
// PG-U06): role-level settings, never a session `SET`, so they hold through a pooler.
export type RoleTimeouts = {
  idleInTransactionMs: number;
  lockTimeoutMs: number;
};

// What the deploy command and `pnpm db:setup` pass (D10): both below the worker's 60 s timeout,
// and the idle bound below the lock bound, so an idle holder is ended before a waiter's lock wait
// expires. The int harness passes shorter ones of its own.
export const RUNTIME_ROLE_TIMEOUTS: RoleTimeouts = {
  idleInTransactionMs: 5_000,
  lockTimeoutMs: 10_000,
};

export type PrepareDatabaseOptions = {
  // The owner role on the direct URL, never the pooled one (ADR-018).
  ownerUrl: string;
  // Set when the role is created, and on an existing role only when `resetPassword` is true.
  runtimePassword: string;
  // Applied to the role on every call, so each deploy and setup re-asserts them.
  roleTimeouts: RoleTimeouts;
  // The deploy command passes true only when no usable password is stored (D33 step 6).
  resetPassword: boolean;
};

// D20: the one entry point the local setup command, the int harness and the deploy command call,
// so the tested path is the deployed path. It ensures the runtime role and its timeouts, then
// applies every pending migration through drizzle-orm's programmatic `migrate()`, which keeps
// drizzle-kit out of every runtime.
export async function prepareDatabase({
  ownerUrl,
  runtimePassword,
  roleTimeouts,
  resetPassword,
}: PrepareDatabaseOptions): Promise<void> {
  // A DDL statement waiting behind a live transaction would queue every later statement on its
  // table; `lock_timeout` fails the run instead, with nothing applied. The one session setting
  // allowed, because this connection never goes through the pooler (pp-database → Running migrations).
  // A `DatabaseClient`, so a refused connect classifies (`pnpm db:setup`'s unreachable reason).
  const client = new DatabaseClient({ connectionString: ownerUrl, options: '-c lock_timeout=5s' });
  await client.connect();
  try {
    await ensureRuntimeRole(client, runtimePassword, resetPassword);
    await setRoleTimeouts(client, roleTimeouts);
    await migrate(drizzle({ client }), { migrationsFolder: MIGRATIONS_FOLDER });
  } finally {
    await client.end();
  }
}

// `CREATE ROLE` and `ALTER ROLE` are utility statements and take no bind parameters, so every name
// and value below goes through pg's own quoting.
async function ensureRuntimeRole(
  client: Client,
  runtimePassword: string,
  resetPassword: boolean,
): Promise<void> {
  const role = escapeIdentifier(RUNTIME_ROLE);
  const password = escapeLiteral(runtimePassword);
  const existing = await client.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [RUNTIME_ROLE]);
  if (existing.rowCount === 0) {
    await client.query(`CREATE ROLE ${role} LOGIN PASSWORD ${password}`);
  } else if (resetPassword) {
    await client.query(`ALTER ROLE ${role} PASSWORD ${password}`);
  }
}

async function setRoleTimeouts(client: Client, timeouts: RoleTimeouts): Promise<void> {
  const role = escapeIdentifier(RUNTIME_ROLE);
  await client.query(
    `ALTER ROLE ${role} SET idle_in_transaction_session_timeout = ${milliseconds(timeouts.idleInTransactionMs)}`,
  );
  await client.query(
    `ALTER ROLE ${role} SET lock_timeout = ${milliseconds(timeouts.lockTimeoutMs)}`,
  );
}

// A positive whole number of milliseconds as a quoted setting value (`'5000ms'`).
function milliseconds(value: number): string {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new LedgerError(
      'internal_error',
      'A role timeout must be a positive whole number of milliseconds.',
    );
  }
  return escapeLiteral(`${value}ms`);
}
