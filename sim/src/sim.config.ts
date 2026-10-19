import { Buffer } from 'node:buffer';
import type { Env } from '@ledger/shared';

// D37: the run's mode, read once from `process.env` by `main.ts`. Live iff `LEDGER_URL` is set and
// non-empty; a shell value, even empty, wins over `.env.local` because Node's `--env-file-if-exists`
// never overrides a variable already in the environment (pp-general → config-and-env.md).
export type SimConfig =
  | { mode: 'offline' }
  | {
      mode: 'live';
      // `LEDGER_URL` as given, which an AWS run's guard compares with `ApiUrl` (D23). Never printed.
      ledgerUrl: string;
      // `$LEDGER_URL/webhooks/resend` (D32), never printed: it is the user's own value.
      ingestUrl: string;
      // The `whsec_` simulator secret `signWebhook` signs with (ADR-016).
      simulatorSecret: string;
      databaseUrl: string;
      // D2: 64 lowercase hex characters, decoded to 32 bytes.
      addressHashKey: Uint8Array;
    };

// The spec's order, so the first missing name is always the same one.
const liveNames = ['LEDGER_SIMULATOR_SECRET', 'DATABASE_URL', 'LEDGER_ADDRESS_HASH_KEY'] as const;

const hexKey = /^[0-9a-f]{64}$/;

// `sim` is not a surface: a bad environment throws `Error` with `<NAME> <reason>`, which `main.ts`
// prints as `sim: <NAME> <reason>` and exits 2, as it does a bad flag. A reason names the variable
// and what it expects, never its value, which can be a secret or a database URL (D6).
function reject(name: string, reason: string): never {
  throw new Error(`${name} ${reason}`);
}

function ingestUrlOf(ledgerUrl: string): string {
  if (!URL.canParse(ledgerUrl)) {
    reject('LEDGER_URL', 'must be an http or https URL');
  }
  const base = new URL(ledgerUrl);
  if (base.protocol !== 'http:' && base.protocol !== 'https:') {
    reject('LEDGER_URL', 'must be an http or https URL');
  }
  // A trailing slash keeps a base path: `http://host/ledger` posts to `/ledger/webhooks/resend`.
  if (!base.pathname.endsWith('/')) {
    base.pathname = `${base.pathname}/`;
  }
  return new URL('webhooks/resend', base).toString();
}

export function readSimConfig(env: Env): SimConfig {
  const ledgerUrl = env.LEDGER_URL;
  if (ledgerUrl === undefined || ledgerUrl === '') {
    return { mode: 'offline' };
  }
  for (const name of liveNames) {
    if (env[name] === undefined || env[name] === '') {
      reject(name, 'is required when LEDGER_URL is set');
    }
  }
  const key = env.LEDGER_ADDRESS_HASH_KEY ?? '';
  if (!hexKey.test(key)) {
    // D2: an invalid key would hash under the wrong key silently and fail invariant 2 for no
    // reason the run could name.
    reject('LEDGER_ADDRESS_HASH_KEY', 'must be 64 lowercase hex characters');
  }
  return {
    mode: 'live',
    ledgerUrl,
    ingestUrl: ingestUrlOf(ledgerUrl),
    simulatorSecret: env.LEDGER_SIMULATOR_SECRET ?? '',
    databaseUrl: env.DATABASE_URL ?? '',
    addressHashKey: new Uint8Array(Buffer.from(key, 'hex')),
  };
}
