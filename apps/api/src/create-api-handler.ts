import {
  type APIGatewayProxyResult,
  handle,
  type LambdaContext,
  type LambdaEvent,
} from '@hono/aws-lambda';
import type { createApi } from '@ledger/api';
import { errorRegistry } from '@ledger/core';
import { errorFields, LedgerError, type Logger } from '@ledger/shared';
import type { Context } from 'hono';

type Api = ReturnType<typeof createApi>;

// D6: the per-container holder the logger's `context` reads on every line. One invocation runs per
// container at a time, so the handler overwrites it at the start of each one and lines never mix.
export type InvocationFields = { request_id: string | undefined; cold_start: boolean };

export type ApiHandlerDeps = {
  // The app, built on the first invocation from the memoized `ledger/database` secret (D23, D32).
  app: () => Promise<Api>;
  logger: Logger;
  invocation: InvocationFields;
};

// D22: `createApi`'s `requestId`. `@hono/aws-lambda` 1.0.1 passes `{ event, requestContext,
// lambdaContext }` as the app's env, so the API's log lines carry Lambda's own request id.
export function lambdaRequestId(c: Context): string {
  const env = c.env as { lambdaContext?: { awsRequestId?: unknown } } | undefined;
  const id = env?.lambdaContext?.awsRequestId;
  return typeof id === 'string' ? id : 'unknown';
}

// D23: event adaptation only (ADR-013), apart from the composition root so a test drives it with no
// AWS client and no environment. `api.handler.ts` binds it to what `main.ts` built. Every request
// the app answers, an error included, is a response in the one error shape (its `onError`); only a
// failed build has no app to answer it.
export function createApiHandler({ app, logger, invocation }: ApiHandlerDeps) {
  let coldStart = true;
  let served: { app: Api; handler: ReturnType<typeof handle> } | undefined;

  return async (event: LambdaEvent, context: LambdaContext): Promise<APIGatewayProxyResult> => {
    invocation.request_id = context.awsRequestId;
    invocation.cold_start = coldStart;
    coldStart = false;

    let built: Api;
    try {
      built = await app();
    } catch (error) {
      // Logged by name; the rethrown error is a constant with no `cause`, so nothing from a secret
      // value, a driver or an SDK message reaches Lambda's own error output (AWS-U12).
      logger.error('api.internal_error', { error_name: errorFields(error).error_name });
      throw new LedgerError('internal_error', errorRegistry.internal_error.message);
    }
    if (served?.app !== built) {
      served = { app: built, handler: handle(built) };
    }
    return served.handler(event, context);
  };
}
