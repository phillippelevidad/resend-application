import { createDatabase, type Executor } from '@ledger/db';
import { createLogger, type Logger } from '@ledger/shared';
import { afterAll, describe, expect, it } from 'vitest';
import { createApi } from './create-api.ts';

// D22 and D23: the read API's one error mapping, with no database behind it. Ships 8.

const addressHashKey = new Uint8Array(32).fill(3);
const runbook = 'https://github.com/phillippelevidad/resend-application/blob/main/docs/runbook.md';

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
  headers: { 'content-type': 'application/json' },
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
    ['email.get', '/emails/e1', undefined],
    ['recipient.get', '/recipients/lookup', lookup('delivered@resend.dev')],
  ] as const)(
    '%s with the database unreachable answers 503 database_unavailable',
    async (_operation, path, init) => {
      const { logger } = recordingLogger();
      const api = createApi({ db: unreachable.db, logger, addressHashKey, requestId: () => 'r1' });

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
    // A reader failure that is neither connection-class nor a registry error, its text quoting
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
    const api = createApi({ db: broken, logger, addressHashKey, requestId: () => 'req-500' });

    const response = await api.request('/emails/e1');
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

  it.each([
    ['GET', '/nope'],
    ['GET', '/'],
    ['DELETE', '/emails/e1'],
    ['GET', '/recipients/lookup'],
  ])('%s %s, served by no operation, answers 404 route_not_found', async (method, path) => {
    const api = createApi({
      db: unreachable.db,
      logger: recordingLogger().logger,
      addressHashKey,
      requestId: () => 'r2',
    });

    const response = await api.request(path, { method });

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      error: {
        code: 'route_not_found',
        message: 'No operation at this method and path.',
        hint: "Check `LEDGER_URL`, and that the CLI or SDK version matches the API's.",
        docs: `${runbook}#route_not_found`,
      },
    });
  });

  it('sets no request-id response header: the request id is a log field only', async () => {
    const api = createApi({
      db: unreachable.db,
      logger: recordingLogger().logger,
      addressHashKey,
      requestId: () => 'r3',
    });

    const response = await api.request('/nope', { headers: { 'x-request-id': 'client-chosen' } });

    expect(response.headers.get('x-request-id')).toBeNull();
  });
});
