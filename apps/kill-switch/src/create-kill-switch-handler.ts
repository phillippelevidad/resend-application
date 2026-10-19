import { errorRegistry } from '@ledger/core';
import { errorFields, LedgerError, type Logger } from '@ledger/shared';
import { z } from 'zod';

// The one field of the Lambda context object the adapter reads (D6).
export type LambdaContext = { readonly awsRequestId: string };

// D6: the per-container holder the logger's `context` reads on every line.
export type InvocationFields = { request_id: string | undefined; cold_start: boolean };

// D29: the trip's outcome as the handler logs it; `tripKillSwitch`'s report satisfies it.
export type TripReport = { readonly changed: readonly string[] };

export type KillSwitchHandlerDeps = {
  // `tripKillSwitch` bound by `main.ts` to its clients and the app stack's names (D29).
  trip: () => Promise<TripReport>;
  logger: Logger;
  invocation: InvocationFields;
};

// The fields of an SNS-to-Lambda event this adapter reads. A narrow local declaration, not
// `@types/aws-lambda` (design Non-Goals). Any message on the trip topic trips (D29), so the message
// body is never read: a budget notification and the usage-trip alarm both arrive here.
const snsEventSchema = z.object({
  Records: z.array(z.object({ EventSource: z.literal('aws:sns'), Sns: z.object({}) })).min(1),
});

// D29: event adaptation only (ADR-013), apart from the composition root so a test drives it with no
// AWS client and no environment. `kill-switch.handler.ts` binds it to what `main.ts` built.
export function createKillSwitchHandler({ trip, logger, invocation }: KillSwitchHandlerDeps) {
  let coldStart = true;

  return async (event: unknown, context: LambdaContext): Promise<void> => {
    invocation.request_id = context.awsRequestId;
    invocation.cold_start = coldStart;
    coldStart = false;

    // A non-SNS payload is refused before any AWS call. The trip drill invokes the function with one
    // to force a failure and observe the `Errors` alarm (D36 step 4, aws.md → Budget alarms item 8).
    if (!snsEventSchema.safeParse(event).success) {
      logger.error('kill_switch.unexpected_event');
      throw new LedgerError('internal_error', errorRegistry.internal_error.message);
    }

    try {
      const report = await trip();
      logger.info('kill_switch.tripped', { changed_count: report.changed.length });
    } catch (error) {
      // AWS-U12: caught at the edge and logged by name; the rethrown error is a constant with no
      // `cause`, so no SDK message (which can quote an ARN) reaches Lambda's own error output. The
      // failed invocation counts toward the `Errors` alarm, and Lambda retries it (AWS-53).
      logger.error('kill_switch.internal_error', { error_name: errorFields(error).error_name });
      throw new LedgerError('internal_error', errorRegistry.internal_error.message);
    }
  };
}
