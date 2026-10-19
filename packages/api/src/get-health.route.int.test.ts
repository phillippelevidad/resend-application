import { createDatabase, type Database, STORAGE_LIMIT_BYTES } from '@ledger/db';
import { type OutageDatabase, startOutageDatabase } from '@ledger/db/testing';
import { createLogger, type Logger, mintApiToken, type QueueAttributesPort } from '@ledger/shared';
import { FakeEventSourceControl, FakeQueueAttributes } from '@ledger/shared/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApi } from './create-api.ts';
import type { ErrorResponse } from './error-response.schema.ts';
import type { HealthResponse } from './health-response.schema.ts';
import { bearer, issueTestToken, testApiDeps } from './testing.ts';

// Ships 6, R10 (D18, D19): `health.get` answers during a database outage on the token's tag alone,
// through the real middleware, while every other route answers `503`. The server stops, so this
// file runs its own container (pp-testing → Outage tests).

const runbook = 'https://github.com/phillippelevidad/resend-application/blob/main/docs/runbook.md';

let outage: OutageDatabase;
let database: Database;
let token: string;

const silent: Logger = { info: () => {}, warn: () => {}, error: () => {} };

beforeAll(async () => {
  outage = await startOutageDatabase();
  database = createDatabase({ url: outage.runtimeUrl, max: 1, logger: silent });
  ({ token } = await issueTestToken(database.db, { scope: 'read' }));
}, 120_000);

afterAll(async () => {
  await database.pool.end();
  await outage.close();
}, 60_000);

function recordingLogger(): { logger: Logger; lines: () => Record<string, unknown>[] } {
  const written: string[] = [];
  const logger = createLogger({
    functionName: 'api',
    stream: { write: (chunk) => written.push(chunk) },
  });
  return { logger, lines: () => written.map((line) => JSON.parse(line)) };
}

async function get(
  api: ReturnType<typeof createApi>,
  path: string,
  bearerToken: string,
): Promise<{ status: number; body: HealthResponse & ErrorResponse }> {
  const response = await api.request(path, { headers: bearer(bearerToken) });
  return {
    status: response.status,
    body: (await response.json()) as HealthResponse & ErrorResponse,
  };
}

describe('health.get with Postgres up', () => {
  it('reports the storage used and its limit, and passes the queue and event-source values through', async () => {
    const queueAttributes = new FakeQueueAttributes({
      visible: 3,
      inFlight: 2,
      oldestAgeSeconds: 41,
      dlqVisible: 1,
      dlqInFlight: 0,
    });
    const api = createApi(
      testApiDeps(database.db, {
        queueAttributes,
        eventSource: new FakeEventSourceControl('paused'),
      }),
    );

    const { status, body } = await get(api, '/health', token);

    expect(status).toBe(200);
    expect(body).toEqual({
      object: 'health',
      queue: { visible: 3, in_flight: 2, oldest_age_seconds: 41 },
      dlq: { visible: 1, in_flight: 0 },
      event_source: { state: 'paused' },
      database: {
        reachable: true,
        storage_bytes: expect.any(Number),
        storage_limit_bytes: STORAGE_LIMIT_BYTES,
      },
    });
    expect(body.database.storage_bytes).toBeGreaterThan(0);
  });

  it('a failing queue read answers 500 internal_error and logs the error name', async () => {
    const queueAttributes = new FakeQueueAttributes();
    queueAttributes.failing = true;
    const { logger, lines } = recordingLogger();
    const api = createApi(
      testApiDeps(database.db, { queueAttributes, logger, requestId: () => 'req-health-500' }),
    );

    const { status, body } = await get(api, '/health', token);

    expect(status).toBe(500);
    expect(body).toEqual({
      error: {
        code: 'internal_error',
        message: 'An unexpected error occurred.',
        hint: 'Retry; if it persists, read the API logs by request id.',
        docs: `${runbook}#internal_error`,
      },
    });
    expect(lines()).toEqual([
      expect.objectContaining({
        message: 'api.internal_error',
        request_id: 'req-health-500',
        error_name: 'FakeFailure',
      }),
    ]);
  });

  it('a failing event-source read answers 500 internal_error and logs the error name', async () => {
    const eventSource = new FakeEventSourceControl();
    eventSource.failGetState = true;
    const { logger, lines } = recordingLogger();
    const api = createApi(testApiDeps(database.db, { eventSource, logger }));

    const { status, body } = await get(api, '/health', token);

    expect(status).toBe(500);
    expect(body.error.code).toBe('internal_error');
    expect(lines()).toEqual([
      expect.objectContaining({ message: 'api.internal_error', error_name: 'FakeFailure' }),
    ]);
  });

  // An SDK network failure carries a socket code, which the database classifier matches only with a
  // pg origin; D19 answers an AWS read error `500`, never `503 database_unavailable`, which the route
  // does not declare.
  it('a queue read failing with a socket error code answers 500 internal_error, not 503', async () => {
    const queueAttributes: QueueAttributesPort = {
      read: async () => {
        throw Object.assign(new Error('getaddrinfo ENOTFOUND'), { code: 'ENOTFOUND' });
      },
    };
    const api = createApi(testApiDeps(database.db, { queueAttributes }));

    const { status, body } = await get(api, '/health', token);

    expect(status).toBe(500);
    expect(body.error.code).toBe('internal_error');
  });
});

describe('health.get with Postgres stopped', () => {
  it('a tagged token answers 200 reachable: false, a bad tag 401, and email.get 503', async () => {
    const api = createApi(testApiDeps(database.db));
    // Opens the pooled connection, so the shutdown ends a live session too.
    expect((await get(api, '/health', token)).status).toBe(200);

    await outage.stop();
    try {
      const health = await get(api, '/health', token);
      expect(health.status).toBe(200);
      expect(health.body.database).toEqual({
        reachable: false,
        storage_bytes: null,
        storage_limit_bytes: STORAGE_LIMIT_BYTES,
      });

      const badTag = mintApiToken(new Uint8Array(32).fill(0x11)).token;
      const forged = await get(api, '/health', badTag);
      expect(forged.status).toBe(401);
      expect(forged.body.error.code).toBe('unauthorized');

      const email = await get(api, '/emails/e1', token);
      expect(email.status).toBe(503);
      expect(email.body.error.code).toBe('database_unavailable');
    } finally {
      await outage.start();
    }
  }, 60_000);
});
