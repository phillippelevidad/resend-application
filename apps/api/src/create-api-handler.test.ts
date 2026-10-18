import type { LambdaContext, LambdaEvent } from '@hono/aws-lambda';
import { createApi } from '@ledger/api';
import { bearer, TEST_TOKEN_TAG_KEY, testApiDeps } from '@ledger/api/testing';
import type { Executor } from '@ledger/db';
import { createLogger, LedgerError, type Logger, mintApiToken } from '@ledger/shared';
import { describe, expect, it } from 'vitest';
import { createApiHandler, type InvocationFields, lambdaRequestId } from './create-api-handler.ts';

// D6, D22, D23: the adapter alone, with no AWS client, no environment and no database. A tag-valid
// token over a database that throws a non-connection error makes the app answer `500` and log one
// line, which shows the request id that reached the app.

function recordingLogger(invocation?: InvocationFields): {
  logger: Logger;
  lines: () => Record<string, unknown>[];
} {
  const written: string[] = [];
  const logger = createLogger({
    functionName: 'api',
    stream: { write: (chunk) => written.push(chunk) },
    ...(invocation === undefined ? {} : { context: () => invocation }),
  });
  return { logger, lines: () => written.map((line) => JSON.parse(line)) };
}

const broken = {
  select: () => {
    throw new TypeError('unexpected');
  },
} as unknown as Executor;

function event(path: string, headers: Record<string, string>): LambdaEvent {
  return {
    version: '2.0',
    routeKey: '$default',
    rawPath: path,
    rawQueryString: '',
    headers,
    body: null,
    isBase64Encoded: false,
    requestContext: {
      domainName: '127.0.0.1',
      http: { method: 'GET', path, protocol: 'HTTP/1.1', sourceIp: '127.0.0.1', userAgent: '' },
    },
  } as unknown as LambdaEvent;
}

const context = (awsRequestId: string): LambdaContext =>
  ({ awsRequestId }) as unknown as LambdaContext;

describe('createApiHandler', () => {
  it("answers through the app, its log lines carrying Lambda's request id and the cold-start flag", async () => {
    const invocation: InvocationFields = { request_id: undefined, cold_start: true };
    const { logger, lines } = recordingLogger(invocation);
    const app = createApi(testApiDeps(broken, { logger, requestId: lambdaRequestId }));
    const handler = createApiHandler({ app: async () => app, logger, invocation });
    const token = mintApiToken(TEST_TOKEN_TAG_KEY).token;

    const first = await handler(event('/emails/e1', bearer(token)), context('aws-req-1'));
    const second = await handler(event('/emails/e1', bearer(token)), context('aws-req-2'));

    expect(first.statusCode).toBe(500);
    expect(JSON.parse(first.body)).toMatchObject({ error: { code: 'internal_error' } });
    expect(second.statusCode).toBe(500);
    expect(lines()).toEqual([
      expect.objectContaining({
        message: 'api.internal_error',
        request_id: 'aws-req-1',
        cold_start: true,
      }),
      expect.objectContaining({
        message: 'api.internal_error',
        request_id: 'aws-req-2',
        cold_start: false,
      }),
    ]);
  });

  it('a failed build throws a constant internal_error with no cause and logs only the error name', async () => {
    const { logger, lines } = recordingLogger();
    const secretText = 'postgres://ledger:s3cret@db.example/ledger';
    const handler = createApiHandler({
      app: () => Promise.reject(new SyntaxError(`Unexpected token in ${secretText}`)),
      logger,
      invocation: { request_id: undefined, cold_start: true },
    });

    const failure = await handler(event('/health', {}), context('aws-req-3')).then(
      () => undefined,
      (error: unknown) => error,
    );

    expect(failure).toBeInstanceOf(LedgerError);
    expect(failure).toMatchObject({
      code: 'internal_error',
      message: 'An unexpected error occurred.',
    });
    expect((failure as Error).cause).toBeUndefined();
    expect(lines()).toEqual([
      expect.objectContaining({ message: 'api.internal_error', error_name: 'SyntaxError' }),
    ]);
    expect(JSON.stringify(lines())).not.toContain('s3cret');
  });
});
