import {
  RECONCILE_FINISH_RESERVE_MS,
  RECONCILE_RUN_BUDGET_MS,
  type ReconcileRunErrorCode,
  reconcileRunErrorCodes,
} from '@ledger/core';
import type { ReconcileRunOutcome } from '@ledger/db';
import type { ResendClient } from '@ledger/resend-client';
import { type ClockPort, LedgerError, type Logger } from '@ledger/shared';

// What a run reads of its row: its id, its fixed window and its budget's origin.
export type RunToExecute = {
  readonly id: number;
  readonly dryRun: boolean;
  readonly startedAt: Date;
  readonly horizonStart: Date;
  readonly horizonEnd: Date;
};

export type ExecuteRunDeps = {
  resend: ResendClient;
  webhookId: string;
  // Which of a page's ids `webhook_events` holds (`webhookEventsRepository.presentSvixIds`).
  presentSvixIds: (svixIds: readonly string[]) => Promise<ReadonlySet<string>>;
  clock: ClockPort;
  logger: Logger;
};

const storedCodes: ReadonlySet<string> = new Set(reconcileRunErrorCodes);

// D15: the replay errors that stop the run; any other counts in `failed` and the run goes on.
const STOPPING_REPLAY_CODES: ReadonlySet<string> = new Set(['resend_auth_failed', 'rate_limited']);

// A stored outcome stopping the run; never leaves this module.
class RunStopped {
  readonly code: ReconcileRunErrorCode;

  constructor(code: ReconcileRunErrorCode) {
    this.code = code;
  }
}

// Slice 4 D15, ADR-007, steps 2–6, for a claimed and configured run: the webhook's status first
// (RS-11), then List Events newest first inside the horizon fixed at start, each page diffed by id
// and its missing ids replayed through Resend, so they re-enter through ingest and dedupe on
// `svix_id`. A Resend call's stored code stops the run with the counts it reached; anything else
// is unexpected and rethrown for the factory's edge.
export async function executeRun(
  run: RunToExecute,
  { resend, webhookId, presentSvixIds, clock, logger }: ExecuteRunDeps,
): Promise<ReconcileRunOutcome> {
  const counts = { checked: 0, missing: 0, replayed: 0, failed: 0 };
  const deadline = new Date(
    run.startedAt.getTime() + RECONCILE_RUN_BUDGET_MS - RECONCILE_FINISH_RESERVE_MS,
  );
  const opts = { deadline };
  const call = async <T>(fn: () => Promise<T>): Promise<T> => {
    try {
      return await fn();
    } catch (error) {
      if (error instanceof LedgerError && storedCodes.has(error.code)) {
        throw new RunStopped(error.code as ReconcileRunErrorCode);
      }
      throw error;
    }
  };

  try {
    const { status } = await call(() => resend.retrieveWebhook(webhookId, opts));
    if (status === 'disabled') return { ...counts, errorCode: 'webhook_disabled' };

    const horizonStart = run.horizonStart.getTime();
    const horizonEnd = run.horizonEnd.getTime();
    let after: string | undefined;
    for (;;) {
      // PP C2: the budget reached with paging unfinished is `rate_limited`, never an anchor.
      if (clock.now().getTime() >= deadline.getTime()) {
        return { ...counts, errorCode: 'rate_limited' };
      }
      const page = await call(() => resend.listWebhookEvents(webhookId, { after }, opts));
      // Every item is filtered, so an unsorted page hides nothing: one younger than the horizon's
      // end is skipped, one older than its start is outside.
      const inWindow = page.events
        .filter((event) => {
          const at = event.createdAt.getTime();
          return at >= horizonStart && at <= horizonEnd;
        })
        .map((event) => event.id);
      const reachedStart = page.events.some((event) => event.createdAt.getTime() < horizonStart);
      counts.checked += inWindow.length;

      const present = await presentSvixIds(inWindow);
      const missingIds = inWindow.filter((svixId) => !present.has(svixId));
      counts.missing += missingIds.length;

      if (!run.dryRun) {
        for (const svixId of missingIds) {
          try {
            await resend.replayWebhookEvent(webhookId, svixId, opts);
            counts.replayed += 1;
          } catch (error) {
            if (!(error instanceof LedgerError)) throw error;
            if (STOPPING_REPLAY_CODES.has(error.code)) {
              throw new RunStopped(error.code as ReconcileRunErrorCode);
            }
            counts.failed += 1;
            logger.warn('reconcile.replay_failed', {
              run_id: String(run.id),
              svix_id: svixId,
              error_code: error.code,
            });
          }
        }
      }

      const last = page.events.at(-1);
      if (reachedStart || !page.hasMore || last === undefined) break;
      after = last.id;
    }
    return { ...counts, errorCode: null };
  } catch (error) {
    if (error instanceof RunStopped) return { ...counts, errorCode: error.code };
    throw error;
  }
}
