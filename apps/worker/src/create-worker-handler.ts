import { errorRegistry, RESUME_EVENT } from '@ledger/core';
import { type BatchResponse, errorFields, LedgerError, type Logger } from '@ledger/shared';
import type { ResumeResult, Worker } from '@ledger/worker';
import { z } from 'zod';

// AWS-05: the fields of an SQS event this adapter reads. A narrow local declaration, not
// `@types/aws-lambda` (design Non-Goals).
const sqsEventSchema = z.object({
  Records: z.array(
    z.object({ eventSource: z.literal('aws:sqs'), messageId: z.string(), body: z.string() }),
  ),
});

// D17: the resume event, sent asynchronously by the hourly schedule and synchronously by the read
// API's `worker.resumeEventSource` (D20).
const resumeEventSchema = z.object({ ledger: z.literal(RESUME_EVENT.ledger) });

// The two members of the Lambda context object the adapter reads: the request id for the log lines
// (D6), and the time left, from which `processBatch` sets its deadline (D15).
export type LambdaContext = {
  readonly awsRequestId: string;
  getRemainingTimeInMillis(): number;
};

// D6: the per-container holder the logger's `context` reads on every line. One invocation runs per
// container at a time, so the handler overwrites it at the start of each one and lines never mix.
export type InvocationFields = { request_id: string | undefined; cold_start: boolean };

export type WorkerHandlerDeps = {
  worker: Worker;
  logger: Logger;
  invocation: InvocationFields;
};

// D17: event adaptation only (ADR-013), apart from the composition root so a test drives it with no
// AWS client and no environment. `worker.handler.ts` binds it to what `main.ts` built.
export function createWorkerHandler({ worker, logger, invocation }: WorkerHandlerDeps) {
  let coldStart = true;

  return async (event: unknown, context: LambdaContext): Promise<BatchResponse | ResumeResult> => {
    invocation.request_id = context.awsRequestId;
    invocation.cold_start = coldStart;
    coldStart = false;

    try {
      const batch = sqsEventSchema.safeParse(event);
      if (batch.success) {
        // ADR-008, AWS-05: the failure list exactly as `processBatch` built it from each message's
        // own result, never assumed or emptied here. D15: the context's clock bounds the batch, read
        // through a closure so the runtime's method keeps its receiver.
        return await worker.processBatch(
          batch.data.Records.map(({ messageId, body }) => ({ messageId, body })),
          { getRemainingTimeInMillis: () => context.getRemainingTimeInMillis() },
        );
      }
      if (resumeEventSchema.safeParse(event).success) {
        return await worker.resume();
      }
      throw new LedgerError('internal_error', 'The worker received an event it does not handle.');
    } catch (error) {
      // AWS-05: a thrown error fails the whole batch, which is redelivered and never acknowledged.
      // Logged by name; the rethrown error is a constant with no `cause`, so nothing from a payload,
      // a driver or an SDK message reaches Lambda's own error output (AWS-U12).
      logger.error('worker.internal_error', { error_name: errorFields(error).error_name });
      throw new LedgerError('internal_error', errorRegistry.internal_error.message);
    }
  };
}
