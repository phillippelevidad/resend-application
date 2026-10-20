import { errorRegistry, RECONCILE_DEFAULT_LOOKBACK_MS, reconcileHorizon } from '@ledger/core';
import { type Executor, type ReconcileRunRow, reconcileRunsRepository } from '@ledger/db';
import {
  type AsyncFunctionInvokePort,
  type ClockPort,
  LedgerError,
  type QueueAttributesPort,
} from '@ledger/shared';

export type StartReconcileInput = { dryRun: boolean; lookbackMs: number | undefined };

export type StartReconcileDeps = {
  db: Executor;
  queueAttributes: QueueAttributesPort;
  reconcilerInvoke: AsyncFunctionInvokePort;
  clock: ClockPort;
};

const internalError = (cause: unknown): LedgerError =>
  new LedgerError('internal_error', errorRegistry.internal_error.message, { cause });

// `reconcile.start` (api-contract.md, slice 4 D18, D6): the manual run's start, the same steps as
// `startScheduledRun` in `packages/reconciler`. The queue snapshot is read first, outside the
// transaction; then the lock, the overlap check issued after it, the anchor, the horizon and the
// insert, unclaimed. After the commit the run is handed to the reconciler, which claims it before
// any Resend call (D16). A refused hand-off finishes the row `internal_error`, so it neither blocks
// the next start for its budget nor runs late.
export class StartReconcileCommand {
  readonly #deps: StartReconcileDeps;

  constructor(deps: StartReconcileDeps) {
    this.#deps = deps;
  }

  async execute({ dryRun, lookbackMs }: StartReconcileInput): Promise<ReconcileRunRow> {
    const { db, queueAttributes, reconcilerInvoke, clock } = this.#deps;
    // An AWS read failure answers `500`, logged by the cause's name, as `health.get` does (D19).
    const snapshot = await queueAttributes.read().catch((err: unknown) => {
      throw internalError(err);
    });
    const run = await db.transaction(async (tx) => {
      await reconcileRunsRepository.lockReconcileStart(tx);
      if (await reconcileRunsRepository.hasUnfinishedRun(tx)) {
        throw new LedgerError('reconcile_in_progress', errorRegistry.reconcile_in_progress.message);
      }
      const anchorHorizonEnd = await reconcileRunsRepository.anchorHorizonEnd(tx);
      const { horizonStart, horizonEnd } = reconcileHorizon({
        now: clock.now(),
        lookbackMs: lookbackMs ?? RECONCILE_DEFAULT_LOOKBACK_MS,
        anchorHorizonEnd,
        oldestQueueAgeSeconds: snapshot.oldestAgeSeconds ?? undefined,
      });
      return reconcileRunsRepository.insert(tx, {
        trigger: 'manual',
        dryRun,
        horizonStart,
        horizonEnd,
        claimed: false,
      });
    });

    try {
      await reconcilerInvoke.invokeAsync({ ledger: 'reconcile-run', run_id: run.id });
    } catch (err) {
      await reconcileRunsRepository.finish(db, run.id, {
        checked: 0,
        missing: 0,
        replayed: 0,
        failed: 0,
        errorCode: 'internal_error',
      });
      throw internalError(err);
    }
    return run;
  }
}
