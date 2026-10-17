import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';
import { classifyDatabaseError, prepareDatabase } from '@ledger/db';
import { type LocalEnvName, mergeLocalEnv } from './merge-local-env.ts';

// `pnpm db:setup` (D31): fill `.env.local` with every local name still unset, then ensure the
// runtime role and apply every pending migration through `prepareDatabase`, the path the harness
// and slice 2's deploy command share (D20). Output names variables only, never a value, and ends in
// exactly one of `db:setup: ready` or `db:setup: failed: <constant reason>`.

// The repo root's `.env.local`, wherever pnpm starts the script from.
const ENV_FILE = fileURLToPath(new URL('../../../../.env.local', import.meta.url));

// The compose Postgres (compose.yaml): throwaway local credentials, loopback port 55432
// (scripts/dev-processes.mjs).
const COMPOSE_DATABASE_URL = 'postgres://ledger:ledger@127.0.0.1:55432/ledger';

// D31's generators. The address-hash key is written once and never changed (data-modeling.md →
// PII & retention); the token is the placeholder the loopback server accepts while it skips auth.
function generate(name: LocalEnvName): string {
  switch (name) {
    case 'DATABASE_URL':
      return COMPOSE_DATABASE_URL;
    case 'LEDGER_ADDRESS_HASH_KEY':
      return randomBytes(32).toString('hex');
    case 'LEDGER_SIMULATOR_SECRET':
      return `whsec_${randomBytes(32).toString('base64')}`;
    case 'LEDGER_URL':
      return 'http://127.0.0.1:3200';
    case 'LEDGER_TOKEN':
      return 'local-loopback-no-auth';
  }
}

// Steps 1–2: merge, write the file only when a name was filled, and print one line per name.
// Returns the merged text, or undefined when the file could not be read or written.
function writeLocalEnv(): string | undefined {
  let merged: ReturnType<typeof mergeLocalEnv>;
  try {
    const before = existsSync(ENV_FILE) ? readFileSync(ENV_FILE, 'utf8') : '';
    merged = mergeLocalEnv(before, generate);
    if (merged.written.length > 0) {
      writeFileSync(ENV_FILE, merged.text, { encoding: 'utf8', mode: 0o600 });
    }
  } catch {
    return undefined;
  }
  for (const name of merged.written) {
    process.stdout.write(`db:setup: wrote ${name} to .env.local\n`);
  }
  return merged.text;
}

// Steps 3–4. Returns a constant failure reason, or undefined when the database is ready. No reason
// carries an error's text, which can hold the URL and its password.
async function setup(): Promise<string | undefined> {
  const envText = writeLocalEnv();
  if (envText === undefined) {
    return 'could not read or write .env.local';
  }
  // A first run starts with no `.env.local`, so `process.env` cannot be the only source. A
  // non-empty shell value still wins, as it does under `node --env-file`
  // (pp-general → config-and-env.md), so setup prepares the database `apps/local` connects to.
  const ownerUrl = process.env.DATABASE_URL || parseEnv(envText).DATABASE_URL;
  if (!ownerUrl) {
    return 'DATABASE_URL is empty';
  }
  // Used only when the role is created. Locally, functions connect as the owner (D30), so this
  // password is never needed again.
  const runtimePassword = randomBytes(24).toString('hex');
  try {
    await prepareDatabase({ ownerUrl, runtimePassword });
  } catch (error) {
    return classifyDatabaseError(error)
      ? 'Postgres is unreachable at DATABASE_URL; start it with pnpm db:up'
      : 'preparing the database failed (runtime role or migrations)';
  }
  return undefined;
}

const reason = await setup().catch(() => 'unexpected error');
if (reason === undefined) {
  process.stdout.write('db:setup: ready\n');
} else {
  process.stderr.write(`db:setup: failed: ${reason}\n`);
  process.exitCode = 1;
}
