import {
  type ReconcileRunErrorCode,
  type ReconcileTrigger,
  reconcileRunErrorCodes,
  reconcileTriggers,
} from '@ledger/core';
import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';
import { closedSetCheck } from './closed-set-check.ts';

// One row per recovery run (ADR-007, slice 4): an ops record, inserted, claimed once, finished once,
// each transition a guarded UPDATE. No index beyond the primary key: ≈ 24 rows a day, and `gaps.list`
// and the anchor page backward on `id`.
export const reconcileRuns = pgTable(
  'reconcile_runs',
  {
    // `run_id` on the wire and the page key. `mode: 'number'`: ids stay below 2^53.
    id: bigint('id', { mode: 'number' }).generatedAlwaysAsIdentity(),
    trigger: text('trigger').$type<ReconcileTrigger>().notNull(),
    dryRun: boolean('dry_run').notNull(),
    // The row time, the time budget's origin and `gaps.list`'s filter. Postgres's `now()`, so the
    // start check (`hasUnfinishedRun`) and the budget agree on one clock.
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    // Set by the claim (a manual run) or at insert (a scheduled run); null until then.
    claimedAt: timestamp('claimed_at', { withTimezone: true }),
    // Null while the run is running; a null past the budget reads `run_abandoned` (never stored).
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    // The window the run set out to check, fixed at start.
    horizonStart: timestamp('horizon_start', { withTimezone: true }).notNull(),
    horizonEnd: timestamp('horizon_end', { withTimezone: true }).notNull(),
    checked: integer('checked').notNull().default(0),
    missing: integer('missing').notNull().default(0),
    replayed: integer('replayed').notNull().default(0),
    failed: integer('failed').notNull().default(0),
    // Null for a clean run, else a stored run outcome.
    errorCode: text('error_code').$type<ReconcileRunErrorCode>(),
    // Set by every claim and finish, never by a trigger.
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ name: 'reconcile_runs_pkey', columns: [t.id] }),
    closedSetCheck('reconcile_runs_trigger_check', t.trigger, reconcileTriggers),
    closedSetCheck('reconcile_runs_error_code_check', t.errorCode, reconcileRunErrorCodes),
    check(
      'reconcile_runs_counts_check',
      sql`${t.checked} >= 0 and ${t.missing} >= 0 and ${t.replayed} >= 0 and ${t.failed} >= 0`,
    ),
    check('reconcile_runs_horizon_check', sql`${t.horizonStart} <= ${t.horizonEnd}`),
  ],
);

export type ReconcileRunRow = typeof reconcileRuns.$inferSelect;
export type NewReconcileRun = typeof reconcileRuns.$inferInsert;
