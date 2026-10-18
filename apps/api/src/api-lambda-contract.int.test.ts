// ADR-019 Evidence, D23: the shared SDK ↔ API suite run through the Lambda adapter. A loopback
// `node:http` server stands in for API Gateway: it turns each request into a synthetic payload-2.0
// event (AWS-01), calls the handler `api.handler.ts` binds, and writes its result back. The app is
// built with this function's own `requestId` generator; `main.ts` is never loaded, so no AWS client
// or environment is needed.
import { randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { LambdaContext, LambdaEvent } from '@hono/aws-lambda';
import { createApi } from '@ledger/api';
import { readApiContract } from '@ledger/api/testing';
import { createApiHandler, lambdaRequestId } from './create-api-handler.ts';

type ApiHandler = ReturnType<typeof createApiHandler>;

async function readBody(request: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

// The payload-2.0 fields `@hono/aws-lambda` 1.0.1 reads; header names arrive lowercase, as API
// Gateway sends them in 2.0. A request body travels base64-encoded, the form API Gateway uses for a
// body it does not treat as text, so the adapter's decode path is exercised too.
function toEvent(request: IncomingMessage, body: Buffer): LambdaEvent {
  const url = new URL(request.url ?? '/', 'http://127.0.0.1');
  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(request.headers)) {
    if (value !== undefined) headers[name] = Array.isArray(value) ? value.join(',') : value;
  }
  const method = request.method ?? 'GET';
  return {
    version: '2.0',
    routeKey: '$default',
    rawPath: url.pathname,
    rawQueryString: url.search.slice(1),
    headers,
    body: body.length === 0 ? null : body.toString('base64'),
    isBase64Encoded: body.length > 0,
    requestContext: {
      accountId: '000000000000',
      apiId: 'contract',
      domainName: '127.0.0.1',
      domainPrefix: 'contract',
      http: {
        method,
        path: url.pathname,
        protocol: 'HTTP/1.1',
        sourceIp: '127.0.0.1',
        userAgent: headers['user-agent'] ?? '',
      },
      requestId: randomUUID(),
      routeKey: '$default',
      stage: '$default',
      time: new Date().toUTCString(),
      timeEpoch: Date.now(),
    },
  } as unknown as LambdaEvent;
}

const contextFor = (awsRequestId: string): LambdaContext =>
  ({ awsRequestId, functionName: 'LedgerApp-api' }) as unknown as LambdaContext;

function bridge(handler: ApiHandler) {
  return async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    const result = await handler(
      toEvent(request, await readBody(request)),
      contextFor(randomUUID()),
    );
    for (const [name, value] of Object.entries(result.headers ?? {})) {
      response.setHeader(name, value);
    }
    response.statusCode = result.statusCode;
    response.end(result.isBase64Encoded ? Buffer.from(result.body, 'base64') : result.body);
  };
}

readApiContract('@hono/aws-lambda', async (deps) => {
  const app = createApi({ ...deps, requestId: lambdaRequestId });
  const handler = createApiHandler({
    app: async () => app,
    logger: deps.logger,
    invocation: { request_id: undefined, cold_start: true },
  });
  const server = createServer((request, response) => {
    bridge(handler)(request, response).catch(() => {
      response.statusCode = 502;
      response.end();
    });
  });
  server.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));
  const { port } = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
});
