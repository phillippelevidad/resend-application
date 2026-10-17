import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Client, escapeIdentifier, escapeLiteral } from 'pg';

// The DML-only role every runtime connects as. drizzle/0001_grant-ledger-tables.sql spells the
// same literal (SQL cannot import it), so a mismatch fails as `permission denied` in the harness.
export const RUNTIME_ROLE = 'ledger_runtime';

const MIGRATIONS_FOLDER = fileURLToPath(new URL('../drizzle', import.meta.url));

export type PrepareDatabaseOptions = {
  // The owner role on the direct URL, never the pooled one (ADR-018).
  ownerUrl: string;
  // Used only when the role is created; an existing role keeps its password.
  runtimePassword: string;
};

// D20: the one entry point the local setup command, the int harness and slice 2's deploy command
// call, so the tested path is the deployed path. It ensures the runtime role, then applies every
// pending migration through drizzle-orm's programmatic `migrate()`, which keeps drizzle-kit out of
// every runtime. The role's server-side timeouts are slice 2's (C13).
export async function prepareDatabase({
  ownerUrl,
  runtimePassword,
}: PrepareDatabaseOptions): Promise<void> {
  // A DDL statement waiting behind a live transaction would queue every later statement on its
  // table; `lock_timeout` fails the run instead, with nothing applied. The one session setting
  // allowed, because this connection never goes through the pooler (pp-database → Running migrations).
  const client = new Client({ connectionString: ownerUrl, options: '-c lock_timeout=5s' });
  await client.connect();
  try {
    await ensureRuntimeRole(client, runtimePassword);
    await migrate(drizzle({ client }), { migrationsFolder: MIGRATIONS_FOLDER });
  } finally {
    await client.end();
  }
}

async function ensureRuntimeRole(client: Client, runtimePassword: string): Promise<void> {
  const existing = await client.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [RUNTIME_ROLE]);
  if (existing.rowCount !== 0) {
    return;
  }
  // `CREATE ROLE` is a utility statement and takes no bind parameters, so the name and the
  // password go through pg's own quoting.
  await client.query(
    `CREATE ROLE ${escapeIdentifier(RUNTIME_ROLE)} LOGIN PASSWORD ${escapeLiteral(runtimePassword)}`,
  );
}
