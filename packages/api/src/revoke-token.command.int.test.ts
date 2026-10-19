// Ships 5, R12 (D21), the concurrent form, through the command `token.revoke` runs: two revokes of
// the last two active `operate` tokens, each on its own runtime-role connection, serialize on
// `lockActiveOperate`, so exactly one revokes and the other answers `last_operate_token`. The owner
// holds both rows until both revokes wait on them, so they start together instead of one after the
// other; sessions are observed by polling `pg_stat_activity` against a deadline, never by sleeping.
import { apiTokensRepository, createDatabase, type Database } from '@ledger/db';
import { createTestDatabase, type TestDatabase } from '@ledger/db/testing';
import { LedgerError, type Logger } from '@ledger/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RevokeTokenCommand } from './revoke-token.command.ts';
import { issueTestToken } from './testing.ts';

const silent: Logger = { info: () => {}, warn: () => {}, error: () => {} };
const WAIT_DEADLINE_MS = 10_000;

let t: TestDatabase;
let apiA: Database;
let apiB: Database;

function runtimePool(applicationName: string): Database {
  const url = new URL(t.runtimeUrl);
  url.searchParams.set('application_name', applicationName);
  return createDatabase({ url: url.toString(), max: 1, logger: silent });
}

beforeAll(async () => {
  t = await createTestDatabase();
  apiA = runtimePool('revoke_a');
  apiB = runtimePool('revoke_b');
});

afterAll(async () => {
  await Promise.all([apiA.pool.end(), apiB.pool.end()]);
  await t.drop();
});

async function waitUntilBothWaitOnLocks(): Promise<void> {
  const deadline = Date.now() + WAIT_DEADLINE_MS;
  while (Date.now() < deadline) {
    const { rows } = await t.owner.execute<{ waiting: number }>(
      `select count(*)::int as waiting from pg_stat_activity
        where application_name in ('revoke_a', 'revoke_b') and wait_event_type = 'Lock'`,
    );
    if (rows[0]?.waiting === 2) {
      return;
    }
  }
  throw new TypeError('The two revokes never both waited on a lock.');
}

const outcomeOf = (run: Promise<unknown>): Promise<string> =>
  run.then(
    () => 'revoked',
    (err: unknown) => (err instanceof LedgerError ? err.code : String(err)),
  );

describe('RevokeTokenCommand under concurrency', () => {
  it('two concurrent revokes of the last two operate tokens: exactly one revokes', async () => {
    const { tokenId: first } = await issueTestToken(t.db, { scope: 'operate', name: 'operate-1' });
    const { tokenId: second } = await issueTestToken(t.db, { scope: 'operate', name: 'operate-2' });

    let release = (): void => {};
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    let locked = (): void => {};
    const lockTaken = new Promise<void>((resolve) => {
      locked = resolve;
    });
    const holder = t.owner.transaction(async (tx) => {
      // Both ids are integers this test inserted, so the text holds no outside input.
      await tx.execute(`select id from api_tokens where id in (${first}, ${second}) for update`);
      locked();
      await released;
    });
    await Promise.race([lockTaken, holder]);

    const outcomes = Promise.all([
      outcomeOf(new RevokeTokenCommand(apiA.db).execute({ tokenId: first })),
      outcomeOf(new RevokeTokenCommand(apiB.db).execute({ tokenId: second })),
    ]);
    try {
      await waitUntilBothWaitOnLocks();
    } finally {
      release();
      await holder;
    }

    expect((await outcomes).sort()).toEqual(['last_operate_token', 'revoked']);
    const active = await t.db.transaction((tx) => apiTokensRepository.lockActiveOperate(tx));
    expect(active).toHaveLength(1);
  });
});
