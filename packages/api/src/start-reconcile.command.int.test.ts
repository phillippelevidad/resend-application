// Slice 4 D18, D6, Ships 2, as the runtime role: runs never overlap. Two concurrent starts on two
// size-1 pools (one per API container, ADR-005) serialize on the start lock, so one inserts and the
// other is refused `reconcile_in_progress`. A refused hand-off finishes the row, so the next start
// is accepted. Concurrency is interleaved by polling `pg_stat_activity`, never by sleeping
// (pp-testing → Faults and concurrency).
import { createDatabase, type Database, reconcileRunsRepository } from '@ledger/db';
import { createTestDatabase, type TestDatabase } from '@ledger/db/testing';
import { type AsyncFunctionInvokePort, LedgerError } from '@ledger/shared';
import { FakeAsyncFunctionInvoke, FakeQueueAttributes } from '@ledger/shared/testing';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { StartReconcileCommand } from './start-reconcile.command.ts';

const silent = { info: () => {}, warn: () => {}, error: () => {} };
const clock = { now: () => new Date() };

let t: TestDatabase;
let apiA: Database;
let apiB: Database;

function named(url: string, applicationName: string): string {
  const parsed = new URL(url);
  parsed.searchParams.set('application_name', applicationName);
  return parsed.toString();
}

beforeAll(async () => {
  t = await createTestDatabase();
  apiA = createDatabase({ url: named(t.runtimeUrl, 'start_a'), max: 1, logger: silent });
  apiB = createDatabase({ url: named(t.runtimeUrl, 'start_b'), max: 1, logger: silent });
});

afterAll(async () => {
  await Promise.all([apiA.pool.end(), apiB.pool.end()]);
  await t.drop();
});

// Every test starts from no unfinished run.
beforeEach(async () => {
  await t.owner.execute(
    `update reconcile_runs set finished_at = now(), error_code = 'internal_error' where finished_at is null`,
  );
});

const command = (db: Database, reconcilerInvoke: AsyncFunctionInvokePort) =>
  new StartReconcileCommand({
    db: db.db,
    queueAttributes: new FakeQueueAttributes(),
    reconcilerInvoke,
    clock,
  });

const unfinishedCount = async (): Promise<number> => {
  const { rows } = await t.owner.execute<{ n: number }>(
    'select count(*)::int as n from reconcile_runs where finished_at is null',
  );
  return rows[0]?.n ?? 0;
};

// Polls until the named session waits on a lock, with a deadline.
async function waitUntilBlocked(applicationName: string): Promise<void> {
  const deadline = Date.now() + 3_000;
  while (Date.now() < deadline) {
    const { rows } = await t.owner.execute<{ wait_event_type: string | null }>(
      `select wait_event_type from pg_stat_activity where application_name = '${applicationName}'`,
    );
    if (rows.some((row) => row.wait_event_type === 'Lock')) return;
  }
  throw new TypeError(`${applicationName} never waited on a lock.`);
}

describe('StartReconcileCommand (D18)', () => {
  it('two concurrent starts yield one run and one reconcile_in_progress', async () => {
    const invoke = new FakeAsyncFunctionInvoke();
    // A holds the start lock and its insert in an open transaction; B's start begins only once A
    // holds it, so B always queues behind A, and A is released whatever happens.
    let releaseA: () => void = () => {};
    const held = new Promise<void>((resolve) => {
      releaseA = resolve;
    });
    let signalLocked: () => void = () => {};
    const locked = new Promise<void>((resolve) => {
      signalLocked = resolve;
    });
    const holder = apiA.db.transaction(async (tx) => {
      await reconcileRunsRepository.lockReconcileStart(tx);
      const inserted = await reconcileRunsRepository.insert(tx, {
        trigger: 'manual',
        dryRun: false,
        horizonStart: new Date(Date.now() - 3_600_000),
        horizonEnd: new Date(Date.now() - 600_000),
        claimed: false,
      });
      signalLocked();
      await held;
      return inserted;
    });
    let refused: unknown;
    try {
      await locked;
      const second = command(apiB, invoke)
        .execute({ dryRun: false, lookbackMs: undefined })
        .catch((error: unknown) => error);
      await waitUntilBlocked('start_b');
      releaseA();
      await holder;
      refused = await second;
    } finally {
      releaseA();
    }

    expect(refused).toBeInstanceOf(LedgerError);
    expect((refused as LedgerError).code).toBe('reconcile_in_progress');
    expect(await unfinishedCount()).toBe(1);
    expect(invoke.payloads).toEqual([]);
  });

  it('two starts racing through the command itself leave exactly one row', async () => {
    const invoke = new FakeAsyncFunctionInvoke();
    const results = await Promise.allSettled([
      command(apiA, invoke).execute({ dryRun: false, lookbackMs: undefined }),
      command(apiB, invoke).execute({ dryRun: false, lookbackMs: undefined }),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(((rejected[0] as PromiseRejectedResult).reason as LedgerError).code).toBe(
      'reconcile_in_progress',
    );
    expect(await unfinishedCount()).toBe(1);
    expect(invoke.payloads).toHaveLength(1);
  });

  it('hands the inserted run to the reconciler once, with its id', async () => {
    const invoke = new FakeAsyncFunctionInvoke();

    const run = await command(apiA, invoke).execute({ dryRun: true, lookbackMs: 6 * 3_600_000 });

    expect(run).toMatchObject({
      trigger: 'manual',
      dryRun: true,
      claimedAt: null,
      finishedAt: null,
    });
    expect(run.horizonEnd.getTime() - run.horizonStart.getTime()).toBeLessThanOrEqual(
      6 * 3_600_000,
    );
    expect(invoke.payloads).toEqual([{ ledger: 'reconcile-run', run_id: run.id }]);
  });

  it('a rejected hand-off finishes the row internal_error, and the next start is accepted', async () => {
    const invoke = new FakeAsyncFunctionInvoke();
    invoke.failNext();

    const failure = await command(apiA, invoke)
      .execute({ dryRun: false, lookbackMs: undefined })
      .catch((error: unknown) => error);

    expect((failure as LedgerError).code).toBe('internal_error');
    const [failed] = await reconcileRunsRepository
      .listSince(t.db, {
        since: new Date(Date.now() - 60_000),
        limit: 1,
      })
      .then((page) => page.rows);
    expect(failed?.errorCode).toBe('internal_error');
    expect(failed?.finishedAt).toBeInstanceOf(Date);

    const next = await command(apiA, invoke).execute({ dryRun: false, lookbackMs: undefined });
    expect(next.id).toBeGreaterThan(failed?.id ?? 0);
  });
});
