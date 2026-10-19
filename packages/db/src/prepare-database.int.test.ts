// D10: every `prepareDatabase` call re-asserts the runtime role's timeouts, and an existing role's
// password changes only when `resetPassword` is true (the deploy command's step 6). Role settings are
// cluster-wide, so this file re-runs `prepareDatabase` on its own container, never on the shared one.
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prepareDatabase, RUNTIME_ROLE } from './prepare-database.ts';
import { type OutageDatabase, startOutageDatabase } from './testing.ts';

let own: OutageDatabase;

beforeAll(async () => {
  own = await startOutageDatabase();
}, 120_000);

afterAll(async () => {
  await own.close();
}, 60_000);

function withPassword(url: string, password: string): string {
  const parsed = new URL(url);
  parsed.password = encodeURIComponent(password);
  return parsed.toString();
}

// Resolves the SQLSTATE a runtime-role connection attempt failed with, or `undefined` on success.
async function connectAs(password: string): Promise<string | undefined> {
  const client = new Client({ connectionString: withPassword(own.runtimeUrl, password) });
  try {
    await client.connect();
    return undefined;
  } catch (err) {
    return typeof err === 'object' && err !== null && 'code' in err ? String(err.code) : 'unknown';
  } finally {
    await client.end().catch(() => {});
  }
}

async function roleConfig(): Promise<string[]> {
  const client = new Client({ connectionString: own.ownerUrl });
  await client.connect();
  try {
    const { rows } = await client.query<{ rolconfig: string[] | null }>(
      'select rolconfig from pg_roles where rolname = $1',
      [RUNTIME_ROLE],
    );
    return rows[0]?.rolconfig ?? [];
  } finally {
    await client.end();
  }
}

describe('prepareDatabase on an existing runtime role', () => {
  it('keeps the password unless resetPassword is true, and re-sets both timeouts on every call', async () => {
    const current = decodeURIComponent(new URL(own.runtimeUrl).password);
    const replacement = 'replacement-password-for-this-test';

    await prepareDatabase({
      ownerUrl: own.ownerUrl,
      runtimePassword: replacement,
      roleTimeouts: { idleInTransactionMs: 3_000, lockTimeoutMs: 7_000 },
      resetPassword: false,
    });
    expect(await connectAs(current)).toBeUndefined();
    expect(await connectAs(replacement)).toBe('28P01');
    expect(await roleConfig()).toEqual(
      expect.arrayContaining(['idle_in_transaction_session_timeout=3000ms', 'lock_timeout=7000ms']),
    );

    await prepareDatabase({
      ownerUrl: own.ownerUrl,
      runtimePassword: replacement,
      roleTimeouts: { idleInTransactionMs: 4_000, lockTimeoutMs: 8_000 },
      resetPassword: true,
    });
    expect(await connectAs(replacement)).toBeUndefined();
    expect(await connectAs(current)).toBe('28P01');
    expect(await roleConfig()).toEqual(
      expect.arrayContaining(['idle_in_transaction_session_timeout=4000ms', 'lock_timeout=8000ms']),
    );
  }, 30_000);
});
