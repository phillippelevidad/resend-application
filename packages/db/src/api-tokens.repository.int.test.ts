// Ships 5 (D7, D8), as the runtime role: the identity insert, the scope CHECK against `tokenScopes`,
// the bootstrap key that lets a re-run insert no second first token, and the lock that keeps two
// concurrent revokes from removing the last `operate` token. Concurrency is interleaved by polling
// `pg_stat_activity`, never by sleeping (pp-testing → Faults and concurrency).
import { randomBytes } from 'node:crypto';
import { type TokenScope, tokenScopes } from '@ledger/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { apiTokensRepository } from './api-tokens.repository.ts';
import { createDatabase, type Database } from './create-database.ts';
import type { Transaction } from './executor.ts';
import { createTestDatabase, sqlStateOf, type TestDatabase } from './testing.ts';

const silentLogger = { info: () => {}, warn: () => {}, error: () => {} };

let t: TestDatabase;
// Two size-1 pools as the runtime role, one per simulated API container (ADR-005), each named so
// `pg_stat_activity` tells their sessions apart.
let apiA: Database;
let apiB: Database;

beforeAll(async () => {
  t = await createTestDatabase();
  apiA = createDatabase({ url: named(t.runtimeUrl, 'api_a'), max: 1, logger: silentLogger });
  apiB = createDatabase({ url: named(t.runtimeUrl, 'api_b'), max: 1, logger: silentLogger });
});

afterAll(async () => {
  await Promise.all([apiA.pool.end(), apiB.pool.end()]);
  await t.drop();
});

function named(url: string, applicationName: string): string {
  const parsed = new URL(url);
  parsed.searchParams.set('application_name', applicationName);
  return parsed.toString();
}

// A fresh 64-hex value in the `token_hash` shape; never a real token's hash.
function freshHash(): string {
  return randomBytes(32).toString('hex');
}

describe('api_tokens as the runtime role', () => {
  it('inserts through the identity column without a sequence grant, each row a new id', async () => {
    const first = await apiTokensRepository.insert(t.db, {
      name: 'identity-a',
      tokenHash: freshHash(),
      scope: 'read',
    });
    const second = await apiTokensRepository.insert(t.db, {
      name: 'identity-b',
      tokenHash: freshHash(),
      scope: 'read',
    });
    expect(first.id).toBeGreaterThan(0);
    expect(second.id).toBeGreaterThan(first.id);
    expect(first.bootstrap).toBe(false);
    expect(first.revokedAt).toBeNull();
  });

  it.each(tokenScopes)('accepts every tokenScopes member: %s', async (scope) => {
    const tokenHash = freshHash();
    const row = await apiTokensRepository.insert(t.db, {
      name: `scope-${scope}`,
      tokenHash,
      scope,
    });
    expect((await apiTokensRepository.findById(t.db, row.id))?.scope).toBe(scope);
  });

  it('refuses a scope outside tokenScopes with SQLSTATE 23514', async () => {
    const tokenHash = freshHash();
    const scope = 'admin' as unknown as TokenScope;
    const insert = apiTokensRepository.insert(t.db, { name: 'scope-outsider', tokenHash, scope });
    expect(await sqlStateOf(insert)).toBe('23514');
    expect(await apiTokensRepository.findActiveByHash(t.db, tokenHash)).toBeUndefined();
  });

  it('refuses a second row with the same token_hash with SQLSTATE 23505', async () => {
    const tokenHash = freshHash();
    await apiTokensRepository.insert(t.db, { name: 'hash-a', tokenHash, scope: 'read' });
    const again = apiTokensRepository.insert(t.db, { name: 'hash-b', tokenHash, scope: 'read' });
    expect(await sqlStateOf(again)).toBe('23505');
  });

  it('inserts the bootstrap token once: a second attempt inserts no row and returns undefined', async () => {
    const first = await apiTokensRepository.insertBootstrapIfAbsent(t.db, {
      name: 'bootstrap',
      tokenHash: freshHash(),
      scope: 'operate',
    });
    const secondHash = freshHash();
    const second = await apiTokensRepository.insertBootstrapIfAbsent(t.db, {
      name: 'bootstrap',
      tokenHash: secondHash,
      scope: 'operate',
    });
    expect(first?.bootstrap).toBe(true);
    expect(second).toBeUndefined();
    expect(await apiTokensRepository.findActiveByHash(t.db, secondHash)).toBeUndefined();
    const { rows } = await t.db.execute<{ count: string }>(
      'select count(*)::text as count from api_tokens where bootstrap',
    );
    expect(rows[0]?.count).toBe('1');
  });

  it('findActiveByHash answers an active token and stops answering once it is revoked', async () => {
    const tokenHash = freshHash();
    const row = await apiTokensRepository.insert(t.db, {
      name: 'revoke-me',
      tokenHash,
      scope: 'read',
    });
    expect(await apiTokensRepository.findActiveByHash(t.db, tokenHash)).toEqual({
      id: row.id,
      name: 'revoke-me',
      scope: 'read',
    });

    await t.db.transaction((tx) => apiTokensRepository.markRevoked(tx, row.id));
    const revoked = await apiTokensRepository.findById(t.db, row.id);
    expect(await apiTokensRepository.findActiveByHash(t.db, tokenHash)).toBeUndefined();
    expect(revoked?.revokedAt).toBeInstanceOf(Date);
    // C11: `updated_at` moves with `revoked_at`.
    expect(revoked?.updatedAt.getTime()).toBe(revoked?.revokedAt?.getTime());

    // Set once: a second revoke leaves the row as it is.
    await t.db.transaction((tx) => apiTokensRepository.markRevoked(tx, row.id));
    expect(await apiTokensRepository.findById(t.db, row.id)).toEqual(revoked);
  });

  it('listPage pages newest first by id, after the given id', async () => {
    const insert = async (name: string): Promise<number> =>
      (await apiTokensRepository.insert(t.db, { name, tokenHash: freshHash(), scope: 'read' })).id;
    const oldest = await insert('page-1');
    const middle = await insert('page-2');
    const newest = await insert('page-3');
    const firstPage = await apiTokensRepository.listPage(t.db, { limit: 2 });
    expect(firstPage.map((row) => row.id)).toEqual([newest, middle]);
    const nextPage = await apiTokensRepository.listPage(t.db, { limit: 2, afterId: middle });
    expect(nextPage[0]?.id).toBe(oldest);
  });
});

type RevokeOutcome = 'revoked' | 'last_operate_token';

// The guard `token.revoke` runs (D21), in one transaction: every active `operate` row locked first,
// then the target; the last active `operate` row is never revoked. `afterLocks` lets a test hold
// the transaction open once its locks are taken.
async function revokeUnlessLastOperate(
  tx: Transaction,
  id: number,
  afterLocks: () => Promise<void> = async () => {},
): Promise<RevokeOutcome> {
  const activeOperate = await apiTokensRepository.lockActiveOperate(tx);
  const target = await apiTokensRepository.lockById(tx, id);
  await afterLocks();
  const isActiveOperate = target?.scope === 'operate' && target.revokedAt === null;
  if (isActiveOperate && activeOperate.length === 1) {
    return 'last_operate_token';
  }
  await apiTokensRepository.markRevoked(tx, id);
  return 'revoked';
}

function gate(): { open: () => void; opened: Promise<void> } {
  let open = (): void => {};
  const opened = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { open, opened };
}

// Polls, with a bound, until the named session waits on a heavyweight lock or `done` reports true.
async function waitUntilBlockedOnLockOr(
  applicationName: string,
  done: () => boolean,
): Promise<void> {
  for (let attempt = 0; attempt < 2_000; attempt += 1) {
    if (done()) {
      return;
    }
    const { rows } = await t.owner.execute<{ wait_event_type: string | null }>(
      `select wait_event_type from pg_stat_activity where application_name = '${applicationName}'`,
    );
    if (rows.some((row) => row.wait_event_type === 'Lock')) {
      return;
    }
  }
  throw new TypeError(`${applicationName} neither waited on a lock nor finished.`);
}

describe('two concurrent revokes of the last two operate tokens', () => {
  it('serialize on lockActiveOperate: exactly one revokes, the other answers last_operate_token', async () => {
    // Earlier tests left active `operate` rows in this file's clone; revoke them so exactly two remain.
    await t.db.transaction(async (tx) => {
      for (const row of await apiTokensRepository.lockActiveOperate(tx)) {
        await apiTokensRepository.markRevoked(tx, row.id);
      }
    });
    const first = await apiTokensRepository.insert(t.db, {
      name: 'operate-1',
      tokenHash: freshHash(),
      scope: 'operate',
    });
    const second = await apiTokensRepository.insert(t.db, {
      name: 'operate-2',
      tokenHash: freshHash(),
      scope: 'operate',
    });

    // A takes its locks and holds its transaction open; B starts its own revoke meanwhile.
    const locked = gate();
    const proceed = gate();
    const outcomeA = apiA.db.transaction((tx) =>
      revokeUnlessLastOperate(tx, first.id, async () => {
        locked.open();
        await proceed.opened;
      }),
    );
    await locked.opened;
    let finishedB = false;
    const outcomeB = apiB.db
      .transaction((tx) => revokeUnlessLastOperate(tx, second.id))
      .finally(() => {
        finishedB = true;
      });

    await waitUntilBlockedOnLockOr('api_b', () => finishedB);
    proceed.open();

    const outcomes = await Promise.all([outcomeA, outcomeB]);
    expect(outcomes.sort()).toEqual(['last_operate_token', 'revoked']);
    const remaining = await t.db.transaction((tx) => apiTokensRepository.lockActiveOperate(tx));
    expect(remaining).toHaveLength(1);
  });
});
