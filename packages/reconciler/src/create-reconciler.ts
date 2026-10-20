import {
  type Executor,
  type ReconcileRunOutcome,
  type ReconcileRunRow,
  reconcileRunsRepository,
  webhookEventsRepository,
} from '@ledger/db';
import type { ResendClient } from '@ledger/resend-client';
import {
  type ClockPort,
  errorFields,
  LedgerError,
  type Logger,
  type MetricsPort,
  type QueueAttributesPort,
} from '@ledger/shared';
import { executeRun } from './execute-run.ts';
import { reportRunFinished } from './report-run.ts';
import { startScheduledRun } from './start-run.ts';

export type ReconcilerDeps = {
  db: Executor;
  // Both `undefined` when not configured (no key, no webhook id, or local mode): every run then ends
  // `reconciler_not_configured` with no Resend call (D15 step 1, D23).
  resend: ResendClient | undefined;
  webhookId: string | undefined;
  // The source queue's oldest-message age, for the grace window (D3, AWS-22).
  queueAttributes: QueueAttributesPort;
  clock: ClockPort;
  logger: Logger;
  metrics: MetricsPort;
};

export type Reconciler = {
  // The hourly tick: starts a scheduled run, then runs it. A refused start logs and returns none.
  runScheduled(): Promise<ReconcileRunRow | undefined>;
  // The read API's async invoke: claims the manual run, then runs it. A run already claimed or
  // finished, or no row, logs and returns none.
  runClaimed(runId: number): Promise<ReconcileRunRow | undefined>;
};

const NOT_CONFIGURED: ReconcileRunOutcome = {
  checked: 0,
  missing: 0,
  replayed: 0,
  failed: 0,
  errorCode: 'reconciler_not_configured',
};

const INTERNAL_ERROR: ReconcileRunOutcome = { ...NOT_CONFIGURED, errorCode: 'internal_error' };

// Slice 4 D14–D19, ADR-007: recovery by id diff, replayed through ingest. Each run is claimed before
// its first Resend call (D16), then executed (D15) and finished once with a stored outcome, never a
// throw that loses the row.
export function createReconciler({
  db,
  resend,
  webhookId,
  queueAttributes,
  clock,
  logger,
  metrics,
}: ReconcilerDeps): Reconciler {
  const presentSvixIds = (svixIds: readonly string[]) =>
    webhookEventsRepository.presentSvixIds(db, svixIds);

  // D15's edge: an unexpected throw after the claim is finished best-effort `internal_error`, logged
  // by name, and rethrown as a constant so Lambda's `Errors` counts it. A failed finish leaves the
  // row unfinished; it reads `run_abandoned` past its budget.
  const run = async (claimed: ReconcileRunRow): Promise<ReconcileRunRow | undefined> => {
    logger.info('reconcile.run_started', { run_id: String(claimed.id) });
    let outcome: ReconcileRunOutcome;
    try {
      outcome =
        resend === undefined || webhookId === undefined
          ? NOT_CONFIGURED
          : await executeRun(claimed, { resend, webhookId, presentSvixIds, clock, logger });
      const finished = await reconcileRunsRepository.finish(db, claimed.id, outcome);
      if (finished === undefined) {
        // Zero rows: the row was finished elsewhere (D18's refused hand-off, say, whose invoke landed
        // anyway), so this outcome is not stored. Nothing is reported: a `reconcile.*`
        // datapoint the gap alarm reads must describe an outcome `reconcile_runs` holds (D19, D24).
        logger.warn('reconcile.already_finished', { run_id: String(claimed.id) });
        return undefined;
      }
      reportRunFinished({ logger, metrics }, claimed.id, outcome);
      return finished;
    } catch (error) {
      logger.error('reconcile.internal_error', {
        run_id: String(claimed.id),
        error_name: errorFields(error).error_name,
      });
      try {
        await reconcileRunsRepository.finish(db, claimed.id, INTERNAL_ERROR);
      } catch {
        // Best effort: the row stays unfinished and reads `run_abandoned` past its budget.
      }
      throw new LedgerError('internal_error', 'The reconcile run failed unexpectedly.');
    }
  };

  return {
    async runScheduled() {
      let started: ReconcileRunRow;
      try {
        started = await startScheduledRun({ db, queueAttributes, clock });
      } catch (error) {
        if (error instanceof LedgerError && error.code === 'reconcile_in_progress') {
          logger.info('reconcile.start_refused', { error_code: error.code });
          return undefined;
        }
        throw error;
      }
      return run(started);
    },

    async runClaimed(runId) {
      const claimed = await reconcileRunsRepository.claim(db, runId);
      if (claimed === undefined) {
        // D16: a duplicate invoke (AWS-53), a finished row or no row: nothing to do.
        logger.info('reconcile.duplicate_invoke', { run_id: String(runId) });
        return undefined;
      }
      return run(claimed);
    },
  };
}
