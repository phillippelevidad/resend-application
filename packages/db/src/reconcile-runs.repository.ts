import { RECONCILE_RUN_BUDGET_MS, type ReconcileRunErrorCode } from '@ledger/core';
import { LedgerError } from '@ledger/shared';
import { and, desc, eq, gte, isNotNull, isNull, lt, sql } from 'drizzle-orm';
import type { Executor, Transaction } from './executor.ts';
import {
  type NewReconcileRun,
  type ReconcileRunRow,
  reconcileRuns,
} from './schema/reconcile-runs.ts';

// Slice 4 D6: the one advisory-lock key both starts take, so a manual and a scheduled start
// serialize and never insert two unfinished runs. Fixed once here; no other lock uses it.
export const RECONCILE_START_LOCK_KEY = 4_200_000_000_000_004n;

// What a start inserts: the database owns `id`, `started_at`, the counts and `updated_at`. A
// scheduled start is claimed at insert (`claimed_at = now()`); a manual one waits for its invoke.
export type ReconcileRunStart = Pick<
  NewReconcileRun,
  'trigger' | 'dryRun' | 'horizonStart' | 'horizonEnd'
> & { claimed: boolean };

// What a finish records. `errorCode` null is a clean run.
export type ReconcileRunOutcome = {
  checked: number;
  missing: number;
  replayed: number;
  failed: number;
  errorCode: ReconcileRunErrorCode | null;
};

export const reconcileRunsRepository = {
  // Transaction-scoped, so it releases at commit or rollback and is safe over the pooled URL
  // (integrations.md → Decision — Neon).
  async lockReconcileStart(tx: Transaction): Promise<void> {
    await tx.execute(
      sql`select pg_advisory_xact_lock(${RECONCILE_START_LOCK_KEY.toString()}::bigint)`,
    );
  },

  // ADR-007: runs never overlap. An unfinished run past its budget is abandoned and blocks nothing.
  // `started_at` and this `now()` are Postgres's clock, so the two agree.
  async hasUnfinishedRun(tx: Transaction): Promise<boolean> {
    const [row] = await tx
      .select({ id: reconcileRuns.id })
      .from(reconcileRuns)
      .where(
        and(
          isNull(reconcileRuns.finishedAt),
          sql`${reconcileRuns.startedAt} > now() - make_interval(secs => ${RECONCILE_RUN_BUDGET_MS / 1000})`,
        ),
      )
      .limit(1);
    return row !== undefined;
  },

  // D4: the newest finished run with no error and nothing missing, dry or not. A run that found
  // something missing never anchors, so the next run re-checks its span.
  async anchorHorizonEnd(tx: Transaction): Promise<Date | undefined> {
    const [row] = await tx
      .select({ horizonEnd: reconcileRuns.horizonEnd })
      .from(reconcileRuns)
      .where(
        and(
          isNotNull(reconcileRuns.finishedAt),
          isNull(reconcileRuns.errorCode),
          eq(reconcileRuns.missing, 0),
        ),
      )
      .orderBy(desc(reconcileRuns.id))
      .limit(1);
    return row?.horizonEnd;
  },

  async insert(tx: Transaction, { claimed, ...row }: ReconcileRunStart): Promise<ReconcileRunRow> {
    const [inserted] = await tx
      .insert(reconcileRuns)
      .values({ ...row, claimedAt: claimed ? sql`now()` : null })
      .returning();
    // Unreachable: an INSERT without ON CONFLICT either returns its row or throws.
    if (inserted === undefined) {
      throw new LedgerError('internal_error', 'The reconcile run insert returned no row.');
    }
    return inserted;
  },

  // D16: before any Resend call. A claimed or finished row, or no row, changes nothing and returns
  // `undefined`, so a duplicate invoke exits here (ADR-007).
  async claim(db: Executor, runId: number): Promise<ReconcileRunRow | undefined> {
    const [row] = await db
      .update(reconcileRuns)
      .set({ claimedAt: sql`now()`, updatedAt: sql`now()` })
      .where(
        and(
          eq(reconcileRuns.id, runId),
          isNull(reconcileRuns.claimedAt),
          isNull(reconcileRuns.finishedAt),
        ),
      )
      .returning();
    return row;
  },

  // Set once: a finished row is left as it is, so a late or repeated finish changes nothing.
  async finish(
    db: Executor,
    runId: number,
    outcome: ReconcileRunOutcome,
  ): Promise<ReconcileRunRow | undefined> {
    const [row] = await db
      .update(reconcileRuns)
      .set({ ...outcome, finishedAt: sql`now()`, updatedAt: sql`now()` })
      .where(and(eq(reconcileRuns.id, runId), isNull(reconcileRuns.finishedAt)))
      .returning();
    return row;
  },

  async get(db: Executor, runId: number): Promise<ReconcileRunRow | undefined> {
    const [row] = await db.select().from(reconcileRuns).where(eq(reconcileRuns.id, runId));
    return row;
  },

  // `gaps.list`: runs started at or after `since`, newest first, keyset on the PK (`id < after`).
  // One extra row tells whether another page exists.
  async listSince(
    db: Executor,
    { since, limit, after }: { since: Date; limit: number; after?: number | undefined },
  ): Promise<{ rows: ReconcileRunRow[]; hasMore: boolean }> {
    const rows = await db
      .select()
      .from(reconcileRuns)
      .where(
        and(
          gte(reconcileRuns.startedAt, since),
          after === undefined ? undefined : lt(reconcileRuns.id, after),
        ),
      )
      .orderBy(desc(reconcileRuns.id))
      .limit(limit + 1);
    return { rows: rows.slice(0, limit), hasMore: rows.length > limit };
  },

  // `health.get`'s last run.
  async latest(db: Executor): Promise<ReconcileRunRow | undefined> {
    const [row] = await db.select().from(reconcileRuns).orderBy(desc(reconcileRuns.id)).limit(1);
    return row;
  },
};
