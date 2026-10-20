import { z } from 'zod';
import type { ErrorCode, ReconcileRunErrorCode } from './error-codes.ts';

// Slice 4 D2: ADR-007's one time-budget constant, below the 900 s Lambda maximum (AWS-03); the start
// check, the run's deadline and the `run_abandoned` read share it. integrations.md rule 2's
// ≈ 85 min over ≈ 6 runs assumes it.
export const RECONCILE_RUN_BUDGET_MS = 840_000;

// D2: Resend calls stop at `started_at + budget − reserve`, so the finish lands inside the budget
// and no live run reads abandoned.
export const RECONCILE_FINISH_RESERVE_MS = 60_000;

// D2: ADR-007's grace window. An event younger than this may still be in Resend's first attempts.
export const RECONCILE_GRACE_MS = 600_000;

// D2: ADR-007's default lookback, 72 h, above Resend's ≈ 27.6 h retry schedule (RS-09).
export const RECONCILE_DEFAULT_LOOKBACK_MS = 259_200_000;

// D2: 30 days. Resend keeps email data 30 days (RS-31); api-contract's validation bound.
export const RECONCILE_MAX_LOOKBACK_MS = 2_592_000_000;

// D5: what started a run, the closed set of `reconcile_runs.trigger`.
export const reconcileTriggers = ['scheduled', 'manual'] as const;

export type ReconcileTrigger = (typeof reconcileTriggers)[number];

// D5: the hourly schedule's input, beside `RESUME_EVENT`. One definition for infra's schedule and the
// reconciler handler's match, so neither can drift and silently stop the hourly run.
export const RECONCILE_SCHEDULED_EVENT = { ledger: 'reconcile-scheduled' } as const;

export const reconcileScheduledEventSchema = z.object({
  ledger: z.literal(RECONCILE_SCHEDULED_EVENT.ledger),
});

// D5, D18: the read API's async invoke payload for one manual run, already inserted.
export const reconcileRunEventSchema = z.object({
  ledger: z.literal('reconcile-run'),
  run_id: z.number().int().positive(),
});

export type ReconcileRunEvent = z.infer<typeof reconcileRunEventSchema>;

// The fields of a run its outcome depends on.
export type ReconcileRunTimes = {
  readonly startedAt: Date;
  readonly finishedAt: Date | null;
  readonly errorCode: ReconcileRunErrorCode | null;
};

// D3: the stored code wins; an unfinished run past its budget reads `run_abandoned`, derived here and
// never written (ADR-007); otherwise no error.
export const runOutcome = (run: ReconcileRunTimes, now: Date): { code: ErrorCode } | null => {
  if (run.errorCode !== null) return { code: run.errorCode };
  if (
    run.finishedAt === null &&
    now.getTime() - run.startedAt.getTime() > RECONCILE_RUN_BUDGET_MS
  ) {
    return { code: 'run_abandoned' };
  }
  return null;
};
