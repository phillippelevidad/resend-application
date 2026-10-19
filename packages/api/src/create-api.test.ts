import { createDatabase, type Executor } from '@ledger/db';
import { createLogger, LedgerError, type Logger, mintApiToken } from '@ledger/shared';
import { afterAll, describe, expect, it } from 'vitest';
import { createApi } from './create-api.ts';
import { bearer, TEST_TOKEN_TAG_KEY, testApiDeps } from './testing/api-test-deps.ts';

// D22 and D23: the read API's one error mapping, with no database behind it. Ships 8. A case that
// needs a token to pass the lookup is in `create-api.int.test.ts`: the lookup needs the database.

const runbook = 'https://github.com/phillippelevidad/resend-application/blob/main/docs/runbook.md';

// Tag-valid, so the middleware goes on to its lookup, which these tests make fail.
const token = mintApiToken(TEST_TOKEN_TAG_KEY).token;

function recordingLogger(): { logger: Logger; lines: () => Record<string, unknown>[] } {
  const written: string[] = [];
  const logger = createLogger({
    functionName: 'api',
    stream: { write: (chunk) => written.push(chunk) },
  });
  return { logger, lines: () => written.map((line) => JSON.parse(line)) };
}

const lookup = (address: string): RequestInit => ({
  method: 'POST',
  headers: { ...bearer(token), 'content-type': 'application/json' },
  body: JSON.stringify({ address }),
});

describe('createApi error mapping', () => {
  // Nothing listens on port 1: the pool's connect fails with ECONNREFUSED, a connection-class error.
  const unreachable = createDatabase({
    url: 'postgres://ledger:ledger@127.0.0.1:1/ledger',
    max: 1,
    logger: recordingLogger().logger,
  });

  afterAll(async () => {
    await unreachable.pool.end();
  });

  it.each([
    ['email.get', '/emails/e1', { headers: bearer(token) }],
    ['recipient.get', '/recipients/lookup', lookup('delivered@resend.dev')],
    ['token.list', '/tokens', { headers: bearer(token) }],
  ] as const)(
    '%s with the database unreachable answers 503 database_unavailable',
    async (_operation, path, init) => {
      const api = createApi(testApiDeps(unreachable.db, { requestId: () => 'r1' }));

      const response = await api.request(path, init);

      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({
        error: {
          code: 'database_unavailable',
          message: 'The database is unreachable.',
          hint: 'The queue holds events meanwhile (ADR-015); retry, then `ledger worker resume`. `ledger health` shows storage used.',
          docs: `${runbook}#database_unavailable`,
        },
      });
    },
  );

  it('an unexpected throw answers 500 internal_error with no internals, and logs one api.internal_error line', async () => {
    // A database failure that is neither connection-class nor a registry error, its text quoting
    // what a driver error can quote: a row value.
    const failure = Object.assign(new TypeError('Failing row contains (delivered@resend.dev)'), {
      detail: 'Key (address)=(delivered@resend.dev)',
    });
    const broken = {
      select: () => {
        throw failure;
      },
    } as unknown as Executor;
    const { logger, lines } = recordingLogger();
    const api = createApi(testApiDeps(broken, { logger, requestId: () => 'req-500' }));

    const response = await api.request('/emails/e1', { headers: bearer(token) });
    const text = await response.text();

    expect(response.status).toBe(500);
    expect(JSON.parse(text)).toEqual({
      error: {
        code: 'internal_error',
        message: 'An unexpected error occurred.',
        hint: 'Retry; if it persists, read the API logs by request id.',
        docs: `${runbook}#internal_error`,
      },
    });
    expect(text).not.toContain('delivered@resend.dev');
    expect(text).not.toContain('Failing row');
    expect(lines()).toEqual([
      expect.objectContaining({
        level: 'error',
        message: 'api.internal_error',
        request_id: 'req-500',
        error_name: 'TypeError',
      }),
    ]);
    expect(JSON.stringify(lines())).not.toContain('delivered@resend.dev');
  });

  // Issue 8: a socket code with no pg origin is not the database. An AWS port error reaching
  // `onError` unwrapped (as `@smithy/node-http-handler` 4.12.1 rejects it: Node's error renamed
  // `TimeoutError`, with the retry strategy's `$metadata`) answers `500`, never `503`. Raised here
  // from the token lookup, the first throw every route reaches, so no route's own wrapping helps.
  it.each([
    ['raw', (sdk: Error): Error => sdk],
    [
      'as the cause of an internal_error',
      (sdk: Error): Error =>
        new LedgerError('internal_error', 'An unexpected error occurred.', { cause: sdk }),
    ],
  ])(
    'an AWS SDK socket error, %s, answers 500 internal_error, not 503, and logs its name',
    async (_shape, raise) => {
      const sdkError = Object.assign(new Error('read ECONNRESET'), {
        code: 'ECONNRESET',
        name: 'TimeoutError',
        $metadata: { attempts: 3, totalRetryDelay: 0 },
      });
      const broken = {
        select: () => {
          throw raise(sdkError);
        },
      } as unknown as Executor;
      const { logger, lines } = recordingLogger();
      const api = createApi(testApiDeps(broken, { logger, requestId: () => 'req-sdk' }));

      const response = await api.request('/emails/e1', { headers: bearer(token) });

      expect(response.status).toBe(500);
      expect(((await response.json()) as { error: { code: string } }).error.code).toBe(
        'internal_error',
      );
      expect(lines()).toEqual([
        expect.objectContaining({
          message: 'api.internal_error',
          request_id: 'req-sdk',
          error_name: 'TimeoutError',
        }),
      ]);
    },
  );

  it.each([
    ['GET', '/nope'],
    ['GET', '/'],
    ['DELETE', '/emails/e1'],
  ])('%s %s without a token answers 401 unauthorized, not 404', async (method, path) => {
    const api = createApi(testApiDeps(unreachable.db));

    const response = await api.request(path, { method });

    expect(response.status).toBe(401);
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe(
      'unauthorized',
    );
  });

  it('sets no request-id response header: the request id is a log field only', async () => {
    const api = createApi(testApiDeps(unreachable.db, { requestId: () => 'r3' }));

    const response = await api.request('/nope', { headers: { 'x-request-id': 'client-chosen' } });

    expect(response.headers.get('x-request-id')).toBeNull();
  });
});

// read-api spec → OpenAPI document, "Exported document". The drift stage only byte-compares the
// regenerated document with the committed one, so a route that lost its `401` or its security entry,
// re-exported, would pass it; this reads what the routes declare.
describe('the OpenAPI document', () => {
  const inert = createDatabase({
    url: 'postgres://inert@127.0.0.1:1/inert',
    max: 1,
    logger: recordingLogger().logger,
  });

  afterAll(async () => {
    await inert.pool.end();
  });

  it('holds the ten operations, each requiring bearerAuth and listing a 401, token.create documents 201, and dlq.startRedrive 202 and 200', () => {
    type Operation = {
      operationId?: string;
      security?: Record<string, string[]>[];
      responses?: Record<string, unknown>;
    };
    const document = createApi(testApiDeps(inert.db)).getOpenAPI31Document({
      openapi: '3.1.0',
      info: { title: 'Ledger read API', version: '0.0.0' },
    });
    const operations = Object.values(document.paths ?? {}).flatMap(
      (item) => Object.values(item as Record<string, Operation>) as Operation[],
    );

    expect(operations.map((operation) => operation.operationId).sort()).toEqual(
      [
        'dlq.listMessages',
        'dlq.startRedrive',
        'email.get',
        'health.get',
        'recipient.get',
        'token.create',
        'token.getCurrent',
        'token.list',
        'token.revoke',
        'worker.resumeEventSource',
      ].sort(),
    );
    expect(Object.keys(document.components?.securitySchemes ?? {})).toEqual(['bearerAuth']);
    for (const operation of operations) {
      expect(operation.security, operation.operationId).toEqual([{ bearerAuth: [] }]);
      expect(Object.keys(operation.responses ?? {}), operation.operationId).toContain('401');
    }
    const create = operations.find((operation) => operation.operationId === 'token.create');
    expect(Object.keys(create?.responses ?? {})).toContain('201');
    const redrive = operations.find((operation) => operation.operationId === 'dlq.startRedrive');
    expect(Object.keys(redrive?.responses ?? {})).toEqual(expect.arrayContaining(['202', '200']));
  });
});
