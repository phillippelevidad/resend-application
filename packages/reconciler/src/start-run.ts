import {
  errorRegistry,
  RECONCILE_DEFAULT_LOOKBACK_MS,
  type ReconcileTrigger,
  reconcileHorizon,
} from '@ledger/core';
import { type Executor, type ReconcileRunRow, reconcileRunsRepository } from '@ledger/db';
import { type ClockPort, LedgerError, type QueueAttributesPort } from '@ledger/shared';

export type StartRunDeps = {
  db: Executor;
  queueAttributes: QueueAttributesPort;
  clock: ClockPort;
};

// Slice 4 D6, ADR-007: the hourly run's start, the same steps `StartReconcileCommand` takes in
// `packages/api` (a shared command here would pull the `resend` SDK into the read API's bundle). The
// queue snapshot is read first, outside the transaction (no external call inside it); then the lock,
// the overlap check issued after it, the anchor, the horizon and the insert, claimed at insert,
// because no invoke stands between this start and its run.
export async function startScheduledRun({
  db,
  queueAttributes,
  clock,
}: StartRunDeps): Promise<ReconcileRunRow> {
  const snapshot = await queueAttributes.read();
  const trigger: ReconcileTrigger = 'scheduled';
  return db.transaction(async (tx) => {
    await reconcileRunsRepository.lockReconcileStart(tx);
    if (await reconcileRunsRepository.hasUnfinishedRun(tx)) {
      throw new LedgerError('reconcile_in_progress', errorRegistry.reconcile_in_progress.message);
    }
    const anchorHorizonEnd = await reconcileRunsRepository.anchorHorizonEnd(tx);
    const { horizonStart, horizonEnd } = reconcileHorizon({
      now: clock.now(),
      lookbackMs: RECONCILE_DEFAULT_LOOKBACK_MS,
      anchorHorizonEnd,
      oldestQueueAgeSeconds: snapshot.oldestAgeSeconds ?? undefined,
    });
    return reconcileRunsRepository.insert(tx, {
      trigger,
      dryRun: false,
      horizonStart,
      horizonEnd,
      claimed: true,
    });
  });
}
