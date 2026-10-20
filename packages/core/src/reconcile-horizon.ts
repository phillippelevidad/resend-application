import { RECONCILE_GRACE_MS, RECONCILE_MAX_LOOKBACK_MS } from './reconcile-run.ts';

export type ReconcileHorizonInput = {
  readonly now: Date;
  readonly lookbackMs: number;
  // The `horizon_end` of the newest finished run with no error and nothing missing (D4), if any.
  readonly anchorHorizonEnd: Date | undefined;
  // The source queue's oldest-message age, so an event still queued is never counted missing.
  readonly oldestQueueAgeSeconds: number | undefined;
};

export type ReconcileHorizon = { readonly horizonStart: Date; readonly horizonEnd: Date };

// Slice 4 D3: the window a run sets out to check, fixed at its start (ADR-007). The end leaves the
// grace window, or the queue's backlog when longer. The start reaches back to the anchor when it is
// older than the lookback, so a span of missed runs needs no `--lookback`, and never past 30 days
// (RS-31) or after the end.
export const reconcileHorizon = ({
  now,
  lookbackMs,
  anchorHorizonEnd,
  oldestQueueAgeSeconds,
}: ReconcileHorizonInput): ReconcileHorizon => {
  const nowMs = now.getTime();
  const horizonEndMs = nowMs - Math.max(RECONCILE_GRACE_MS, (oldestQueueAgeSeconds ?? 0) * 1000);
  const horizonStartMs = Math.max(
    nowMs - RECONCILE_MAX_LOOKBACK_MS,
    Math.min(
      nowMs - lookbackMs,
      anchorHorizonEnd?.getTime() ?? Number.POSITIVE_INFINITY,
      horizonEndMs,
    ),
  );
  return { horizonStart: new Date(horizonStartMs), horizonEnd: new Date(horizonEndMs) };
};
