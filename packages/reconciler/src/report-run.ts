import type { ReconcileRunOutcome } from '@ledger/db';
import type { Logger, MetricsPort } from '@ledger/shared';

// Slice 4 D19: one constant log line per finished run, allow-listed fields only, and the three
// `reconcile.*` metrics only for a run with no error, dry runs included: the gap alarm reads an
// errored run's silence as breaching (D24). `run_id` is a string field, so the id is a string.
export function reportRunFinished(
  { logger, metrics }: { logger: Logger; metrics: MetricsPort },
  runId: number,
  outcome: ReconcileRunOutcome,
): void {
  const run_id = String(runId);
  logger.info('reconcile.run_finished', {
    run_id,
    checked_count: outcome.checked,
    missing_count: outcome.missing,
    replayed_count: outcome.replayed,
    failed_count: outcome.failed,
    ...(outcome.errorCode === null ? {} : { error_code: outcome.errorCode }),
  });
  if (outcome.errorCode !== null) return;
  metrics.count('reconcile.missing', outcome.missing, { run_id });
  metrics.count('reconcile.replayed', outcome.replayed, { run_id });
  metrics.count('reconcile.failed', outcome.failed, { run_id });
}
