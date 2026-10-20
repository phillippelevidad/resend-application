// Slice 4 D6, as the runtime role: the closed sets and checks of `reconcile_runs`, the anchor
// choice (D4), the guarded claim and finish (D16), and `gaps.list`'s keyset page. The tests share
// one clone and run in order, so each asserts only on the rows it inserted.
import { reconcileRunErrorCodes, reconcileTriggers } from '@ledger/core';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Transaction } from './executor.ts';
import { type ReconcileRunStart, reconcileRunsRepository } from './reconcile-runs.repository.ts';
import { createTestDatabase, sqlStateOf, type TestDatabase } from './testing.ts';

let t: TestDatabase;

beforeAll(async () => {
  t = await createTestDatabase();
});

afterAll(async () => {
  await t.drop();
});

const HOUR_MS = 3_600_000;
const base = new Date('2026-10-21T12:00:00.000Z');

function start(overrides: Partial<ReconcileRunStart> = {}): ReconcileRunStart {
  return {
    trigger: 'manual',
    dryRun: false,
    horizonStart: new Date(base.getTime() - 72 * HOUR_MS),
    horizonEnd: base,
    claimed: false,
    ...overrides,
  };
}

const clean = { checked: 3, missing: 0, replayed: 0, failed: 0, errorCode: null };

async function inTx<T>(fn: (tx: Transaction) => Promise<T>): Promise<T> {
  return t.db.transaction(fn);
}

async function insertRun(overrides: Partial<ReconcileRunStart> = {}) {
  return inTx((tx) => reconcileRunsRepository.insert(tx, start(overrides)));
}

describe('reconcile_runs as the runtime role', () => {
  it.each(reconcileTriggers)('inserts a %s run', async (trigger) => {
    const row = await insertRun({ trigger });
    expect(row.trigger).toBe(trigger);
    expect(row.id).toBeGreaterThan(0);
    expect(row.finishedAt).toBeNull();
    expect([row.checked, row.missing, row.replayed, row.failed]).toEqual([0, 0, 0, 0]);
  });

  it('refuses a trigger outside the closed set with 23514', async () => {
    const state = await sqlStateOf(insertRun({ trigger: 'cron' as never }));
    expect(state).toBe('23514');
  });

  it('claims a scheduled run at insert and leaves a manual one unclaimed', async () => {
    const scheduled = await insertRun({ trigger: 'scheduled', claimed: true });
    const manual = await insertRun({ trigger: 'manual', claimed: false });
    expect(scheduled.claimedAt).toBeInstanceOf(Date);
    expect(manual.claimedAt).toBeNull();
  });

  it.each(reconcileRunErrorCodes)('finishes a run with the stored outcome %s', async (code) => {
    const run = await insertRun();
    const finished = await reconcileRunsRepository.finish(t.db, run.id, {
      ...clean,
      errorCode: code,
    });
    expect(finished?.errorCode).toBe(code);
    expect(finished?.finishedAt).toBeInstanceOf(Date);
  });

  it('refuses run_abandoned, derived on read and never stored (ADR-007), and any other code', async () => {
    const run = await insertRun();
    for (const code of ['run_abandoned', 'database_unavailable', 'nope']) {
      const state = await sqlStateOf(
        reconcileRunsRepository.finish(t.db, run.id, { ...clean, errorCode: code as never }),
      );
      expect(state, code).toBe('23514');
    }
  });

  it('refuses a negative count', async () => {
    const run = await insertRun();
    const state = await sqlStateOf(
      reconcileRunsRepository.finish(t.db, run.id, { ...clean, missing: -1 }),
    );
    expect(state).toBe('23514');
  });

  it('refuses a horizon that starts after it ends', async () => {
    const state = await sqlStateOf(
      insertRun({ horizonStart: new Date(base.getTime() + 1), horizonEnd: base }),
    );
    expect(state).toBe('23514');
  });

  it('anchors on the newest clean run with nothing missing, over a newer run with missing events and a newer errored one', async () => {
    const anchorEnd = new Date(base.getTime() + 1 * HOUR_MS);
    const good = await insertRun({ horizonEnd: anchorEnd });
    await reconcileRunsRepository.finish(t.db, good.id, clean);

    const foundMissing = await insertRun({ horizonEnd: new Date(base.getTime() + 2 * HOUR_MS) });
    await reconcileRunsRepository.finish(t.db, foundMissing.id, { ...clean, missing: 2 });

    const errored = await insertRun({ horizonEnd: new Date(base.getTime() + 3 * HOUR_MS) });
    await reconcileRunsRepository.finish(t.db, errored.id, {
      ...clean,
      errorCode: 'rate_limited',
    });

    // Unfinished: never an anchor.
    await insertRun({ horizonEnd: new Date(base.getTime() + 4 * HOUR_MS) });

    expect(await inTx((tx) => reconcileRunsRepository.anchorHorizonEnd(tx))).toEqual(anchorEnd);
  });

  it('anchors on a clean dry run too', async () => {
    const dryEnd = new Date(base.getTime() + 5 * HOUR_MS);
    const dry = await insertRun({ dryRun: true, horizonEnd: dryEnd });
    await reconcileRunsRepository.finish(t.db, dry.id, clean);
    expect(await inTx((tx) => reconcileRunsRepository.anchorHorizonEnd(tx))).toEqual(dryEnd);
  });

  it('claims an unclaimed run once; a claimed or finished row returns none', async () => {
    const run = await insertRun();
    const claimed = await reconcileRunsRepository.claim(t.db, run.id);
    expect(claimed?.claimedAt).toBeInstanceOf(Date);
    expect(await reconcileRunsRepository.claim(t.db, run.id)).toBeUndefined();

    const finishedUnclaimed = await insertRun();
    await reconcileRunsRepository.finish(t.db, finishedUnclaimed.id, {
      ...clean,
      errorCode: 'internal_error',
    });
    expect(await reconcileRunsRepository.claim(t.db, finishedUnclaimed.id)).toBeUndefined();

    expect(await reconcileRunsRepository.claim(t.db, 9_999_999)).toBeUndefined();
  });

  it('finishes once: a second finish changes no row', async () => {
    const run = await insertRun();
    const first = await reconcileRunsRepository.finish(t.db, run.id, { ...clean, missing: 1 });
    const second = await reconcileRunsRepository.finish(t.db, run.id, {
      ...clean,
      errorCode: 'internal_error',
    });
    expect(first?.missing).toBe(1);
    expect(second).toBeUndefined();
    const stored = await reconcileRunsRepository.get(t.db, run.id);
    expect(stored?.missing).toBe(1);
    expect(stored?.errorCode).toBeNull();
  });

  it('sees an unfinished run inside its budget, and not one past it', async () => {
    const run = await insertRun();
    expect(await inTx((tx) => reconcileRunsRepository.hasUnfinishedRun(tx))).toBe(true);
    // Every unfinished row from the earlier tests is moved past the budget by the owner.
    await t.owner.execute(
      sql`update reconcile_runs set started_at = now() - interval '15 minutes' where finished_at is null`,
    );
    expect(await inTx((tx) => reconcileRunsRepository.hasUnfinishedRun(tx))).toBe(false);
    expect((await reconcileRunsRepository.get(t.db, run.id))?.finishedAt).toBeNull();
  });

  it('pages runs since a time newest first by id, with has_more', async () => {
    const since = new Date();
    const ids: number[] = [];
    for (let i = 0; i < 5; i += 1) {
      ids.push((await insertRun()).id);
    }
    const first = await reconcileRunsRepository.listSince(t.db, { since, limit: 2 });
    expect(first.rows.map((r) => r.id)).toEqual([ids[4], ids[3]]);
    expect(first.hasMore).toBe(true);

    const second = await reconcileRunsRepository.listSince(t.db, {
      since,
      limit: 2,
      after: ids[3],
    });
    expect(second.rows.map((r) => r.id)).toEqual([ids[2], ids[1]]);
    expect(second.hasMore).toBe(true);

    const last = await reconcileRunsRepository.listSince(t.db, { since, limit: 2, after: ids[1] });
    expect(last.rows.map((r) => r.id)).toEqual([ids[0]]);
    expect(last.hasMore).toBe(false);

    const latest = await reconcileRunsRepository.latest(t.db);
    expect(latest?.id).toBe(ids[4]);
  });

  it('serializes two starts on the advisory lock', async () => {
    // The lock is transaction-scoped: a second transaction's try-lock fails while the first holds it.
    await t.db.transaction(async (tx) => {
      await reconcileRunsRepository.lockReconcileStart(tx);
      const other = await t.owner.execute(
        sql`select pg_try_advisory_xact_lock(4200000000000004::bigint) as got`,
      );
      expect(other.rows[0]?.got).toBe(false);
    });
  });
});
