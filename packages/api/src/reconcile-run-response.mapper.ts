import { runOutcome } from '@ledger/core';
import type { ReconcileRunRow } from '@ledger/db';
import { errorResponseMapper } from './error-response.mapper.ts';
import type { ReconcileRunListResponse } from './reconcile-run-list-response.schema.ts';
import type { ReconcileRunResponse } from './reconcile-run-response.schema.ts';

// What the readers and the command hand the mapper: the row without `claimed_at` and `updated_at`,
// so neither can leak by passthrough.
export type ReconcileRunRead = Omit<ReconcileRunRow, 'claimedAt' | 'updatedAt'>;

export type ReconcileRunListRead = { hasMore: boolean; runs: ReconcileRunRead[] };

// Slice 4 D27: the one run mapper, for all three routes and `health.get`. `now` is the clock port's,
// so `run_abandoned` is derived on read from the shared budget constant and never stored (ADR-007).
export function reconcileRunResponseMapper(run: ReconcileRunRead, now: Date): ReconcileRunResponse {
  const outcome = runOutcome(run, now);
  return {
    object: 'reconcile_run',
    run_id: run.id,
    trigger: run.trigger,
    dry_run: run.dryRun,
    started_at: run.startedAt.toISOString(),
    finished_at: run.finishedAt === null ? null : run.finishedAt.toISOString(),
    horizon_start: run.horizonStart.toISOString(),
    horizon_end: run.horizonEnd.toISOString(),
    checked: run.checked,
    missing: run.missing,
    replayed: run.replayed,
    failed: run.failed,
    error: outcome === null ? null : errorResponseMapper(outcome.code).error,
  };
}

export function reconcileRunListResponseMapper(
  read: ReconcileRunListRead,
  now: Date,
): ReconcileRunListResponse {
  return {
    object: 'list',
    has_more: read.hasMore,
    data: read.runs.map((run) => reconcileRunResponseMapper(run, now)),
  };
}
