import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';
import {
  apiTokensRepository,
  classifyDatabaseError,
  createDatabase,
  prepareDatabase,
  RUNTIME_ROLE_TIMEOUTS,
} from '@ledger/db';
import { createLogger, mintApiToken } from '@ledger/shared';
import {
  isWorkingLocalToken,
  type LocalEnvName,
  type MergedLocalEnv,
  type MergeLocalEnvOptions,
  mergeLocalEnv,
  type SetOnceEnvName,
  setOnceEnvNames,
} from './merge-local-env.ts';

// `pnpm db:setup` (D31, D41): fill `.env.local` with every set-once name still unset (the two keys
// included) before the database is touched, then ensure the runtime role and its timeouts and apply
// every pending migration through `prepareDatabase`, the path the harness and the deploy command
// share (D10), then write a working `LEDGER_TOKEN` when the current one is not. Output names
// variables only, never a value, and ends in exactly one of `db:setup: ready` or
// `db:setup: failed: <constant reason>`.

// The repo root's `.env.local`, wherever pnpm starts the script from.
const ENV_FILE = fileURLToPath(new URL('../../../../.env.local', import.meta.url));

// The compose Postgres (compose.yaml): throwaway local credentials, loopback port 55432
// (scripts/dev-processes.mjs).
const COMPOSE_DATABASE_URL = 'postgres://ledger:ledger@127.0.0.1:55432/ledger';

// D3: the tag key's one form.
const TAG_KEY_FORM = /^[0-9a-f]{64}$/;

// D41: the bootstrap row's name, and the name of a token setup mints once a bootstrap row exists.
const BOOTSTRAP_TOKEN_NAME = 'bootstrap';
const SETUP_TOKEN_NAME = 'local-setup';

// D31's and D41's generators for the set-once names. Both keys are written once and never changed
// (data-modeling.md → PII & retention; D41). `LEDGER_TOKEN` is minted after the database is ready.
function generate(name: SetOnceEnvName): string {
  switch (name) {
    case 'DATABASE_URL':
      return COMPOSE_DATABASE_URL;
    case 'LEDGER_ADDRESS_HASH_KEY':
    case 'LEDGER_TOKEN_TAG_KEY':
      return randomBytes(32).toString('hex');
    case 'LEDGER_SIMULATOR_SECRET':
      return `whsec_${randomBytes(32).toString('base64')}`;
    case 'LEDGER_URL':
      return 'http://127.0.0.1:3200';
  }
}

// Merge, write the file only when a name was written, and print one line per name. Returns the
// merged text, or undefined when the file could not be written.
function writeLocalEnv<N extends LocalEnvName>(
  before: string,
  names: readonly N[],
  values: (name: N) => string,
  options: MergeLocalEnvOptions = {},
): string | undefined {
  let merged: MergedLocalEnv<N>;
  try {
    merged = mergeLocalEnv(before, names, values, options);
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

function readLocalEnv(): string | undefined {
  try {
    return existsSync(ENV_FILE) ? readFileSync(ENV_FILE, 'utf8') : '';
  } catch {
    return undefined;
  }
}

// D41: keep a working `LEDGER_TOKEN`; otherwise insert the bootstrap `operate` token, or a
// `local-setup` one when a bootstrap row already exists, and return its plaintext to write. Locally
// the insert runs as the owner on `DATABASE_URL`, as every local function connects (D30).
async function mintWhenNotWorking(
  ownerUrl: string,
  current: string | undefined,
  tagKey: Uint8Array,
): Promise<string | undefined> {
  const { db, pool } = createDatabase({
    url: ownerUrl,
    max: 1,
    logger: createLogger({ functionName: 'setup' }),
  });
  try {
    const working = await isWorkingLocalToken(
      current,
      tagKey,
      async (tokenHash) =>
        (await apiTokensRepository.findActiveByHash(db, tokenHash)) !== undefined,
    );
    if (working) {
      return undefined;
    }
    const { token, tokenHash } = mintApiToken(tagKey);
    const bootstrap = await apiTokensRepository.insertBootstrapIfAbsent(db, {
      name: BOOTSTRAP_TOKEN_NAME,
      tokenHash,
      scope: 'operate',
    });
    if (bootstrap === undefined) {
      await apiTokensRepository.insert(db, { name: SETUP_TOKEN_NAME, tokenHash, scope: 'operate' });
    }
    return token;
  } finally {
    await pool.end();
  }
}

// Returns a constant failure reason, or undefined when the database and the token are ready. No
// reason carries an error's text, which can hold the URL and its password.
async function setup(): Promise<string | undefined> {
  const before = readLocalEnv();
  // Step 1 (D41): the set-once names, both keys included, before the database is touched.
  const envText =
    before === undefined ? undefined : writeLocalEnv(before, setOnceEnvNames, generate);
  if (envText === undefined) {
    return 'could not read or write .env.local';
  }
  const fileEnv = parseEnv(envText);
  // A first run starts with no `.env.local`, so `process.env` cannot be the only source. A
  // non-empty shell value still wins, as it does under `node --env-file`
  // (pp-general → config-and-env.md), so setup prepares the database `apps/local` connects to.
  const ownerUrl = process.env.DATABASE_URL || fileEnv.DATABASE_URL;
  if (!ownerUrl) {
    return 'DATABASE_URL is empty';
  }
  // D41: the token is checked and minted under the file's tag key.
  const tagKeyHex = fileEnv.LEDGER_TOKEN_TAG_KEY ?? '';
  if (!TAG_KEY_FORM.test(tagKeyHex)) {
    return 'LEDGER_TOKEN_TAG_KEY in .env.local is not 64 lowercase hex';
  }
  const tagKey = Buffer.from(tagKeyHex, 'hex');

  // Step 2. Used only when the role is created. Locally, functions connect as the owner (D30), so
  // this password is never needed again.
  const runtimePassword = randomBytes(24).toString('hex');
  let token: string | undefined;
  try {
    await prepareDatabase({
      ownerUrl,
      runtimePassword,
      roleTimeouts: RUNTIME_ROLE_TIMEOUTS,
      resetPassword: false,
    });
    // Step 3 (D41).
    token = await mintWhenNotWorking(ownerUrl, fileEnv.LEDGER_TOKEN, tagKey);
  } catch (error) {
    return classifyDatabaseError(error)
      ? 'Postgres is unreachable at DATABASE_URL; start it with pnpm db:up'
      : 'preparing the database failed (runtime role, migrations or token)';
  }
  if (token !== undefined) {
    const minted = token;
    const written = writeLocalEnv(envText, ['LEDGER_TOKEN'], () => minted, {
      replaceToken: true,
    });
    if (written === undefined) {
      return 'could not read or write .env.local';
    }
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
