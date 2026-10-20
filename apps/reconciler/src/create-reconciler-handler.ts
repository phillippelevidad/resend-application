import {
  errorRegistry,
  reconcileRunEventSchema,
  reconcileScheduledEventSchema,
} from '@ledger/core';
import type { Reconciler } from '@ledger/reconciler';
import { errorFields, LedgerError, type Logger } from '@ledger/shared';

// The one member of the Lambda context object the adapter reads: the request id for the log lines.
export type LambdaContext = { readonly awsRequestId: string };

// The per-container holder the logger's `context` reads on every line. One invocation runs per
// container at a time, so the handler overwrites it at the start of each one.
export type InvocationFields = { request_id: string | undefined; cold_start: boolean };

export type ReconcilerHandlerDeps = {
  reconciler: Reconciler;
  logger: Logger;
  invocation: InvocationFields;
};

// Slice 4 D20: event adaptation only (ADR-013), apart from the composition root so a test drives it
// with no AWS client and no environment. The hourly schedule sends `RECONCILE_SCHEDULED_EVENT`; the
// read API's async invoke sends `{ ledger: 'reconcile-run', run_id }`. Anything else is rejected.
// Nothing is returned: an `Event` invoke's result reaches no one.
export function createReconcilerHandler({ reconciler, logger, invocation }: ReconcilerHandlerDeps) {
  let coldStart = true;

  return async (event: unknown, context: LambdaContext): Promise<void> => {
    invocation.request_id = context.awsRequestId;
    invocation.cold_start = coldStart;
    coldStart = false;

    try {
      if (reconcileScheduledEventSchema.safeParse(event).success) {
        await reconciler.runScheduled();
        return;
      }
      const manual = reconcileRunEventSchema.safeParse(event);
      if (manual.success) {
        await reconciler.runClaimed(manual.data.run_id);
        return;
      }
      throw new LedgerError(
        'internal_error',
        'The reconciler received an event it does not handle.',
      );
    } catch (error) {
      // Logged by name; the rethrown error is a constant with no `cause`, so nothing from a driver or
      // an SDK message reaches Lambda's own error output, and Lambda's `Errors` counts it.
      logger.error('reconcile.handler_failed', { error_name: errorFields(error).error_name });
      throw new LedgerError('internal_error', errorRegistry.internal_error.message);
    }
  };
}
