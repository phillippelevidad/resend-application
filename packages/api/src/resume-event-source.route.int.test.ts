import { createTestDatabase, type TestDatabase } from '@ledger/db/testing';
import { FakeFunctionInvoke } from '@ledger/shared/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApi } from './create-api.ts';
import type { ErrorResponse } from './error-response.schema.ts';
import type { EventSourceResponse } from './event-source-response.schema.ts';
import { bearer, issueTestToken, testApiDeps } from './testing.ts';

// D20, through the real middleware: `worker.resumeEventSource` needs `operate`, sends the worker
// the resume event, and parses its answer before trusting it.

const runbook = 'https://github.com/phillippelevidad/resend-application/blob/main/docs/runbook.md';

let t: TestDatabase;
let operate: string;
let read: string;

beforeAll(async () => {
  t = await createTestDatabase();
  ({ token: operate } = await issueTestToken(t.db, { scope: 'operate' }));
  ({ token: read } = await issueTestToken(t.db, { scope: 'read' }));
});

afterAll(async () => {
  await t.drop();
});

async function resume(
  workerInvoke: FakeFunctionInvoke,
  token: string,
): Promise<{ status: number; body: EventSourceResponse & ErrorResponse }> {
  const api = createApi(testApiDeps(t.db, { workerInvoke }));
  const response = await api.request('/worker/resume', { method: 'POST', headers: bearer(token) });
  return {
    status: response.status,
    body: (await response.json()) as EventSourceResponse & ErrorResponse,
  };
}

describe('worker.resumeEventSource', () => {
  it('an operate token answers 200 with the resulting state and resumed: true, having sent the resume event', async () => {
    const workerInvoke = new FakeFunctionInvoke({ outcome: 'resumed', state: 'changing' });

    const { status, body } = await resume(workerInvoke, operate);

    expect(status).toBe(200);
    expect(body).toEqual({ object: 'event_source', state: 'changing', resumed: true });
    expect(workerInvoke.payloads).toEqual([{ ledger: 'resume-event-source' }]);
  });

  it('an already enabled source answers 200 with state enabled and resumed: false', async () => {
    const workerInvoke = new FakeFunctionInvoke({ outcome: 'already_enabled', state: 'enabled' });

    const { status, body } = await resume(workerInvoke, operate);

    expect(status).toBe(200);
    expect(body).toEqual({ object: 'event_source', state: 'enabled', resumed: false });
  });

  it('a read token answers 403 forbidden and never invokes the worker', async () => {
    const workerInvoke = new FakeFunctionInvoke({ outcome: 'resumed', state: 'enabled' });

    const { status, body } = await resume(workerInvoke, read);

    expect(status).toBe(403);
    expect(body.error.code).toBe('forbidden');
    expect(workerInvoke.payloads).toEqual([]);
  });

  it('a failed probe answers 503 database_unavailable with the override message', async () => {
    const workerInvoke = new FakeFunctionInvoke({ outcome: 'probe_failed', state: 'paused' });

    const { status, body } = await resume(workerInvoke, operate);

    expect(status).toBe(503);
    expect(body).toEqual({
      error: {
        code: 'database_unavailable',
        message:
          'The database is unreachable or at its storage limit, so the event source stays paused.',
        hint: 'The queue holds events meanwhile (ADR-015); retry, then `ledger worker resume`. `ledger health` shows storage used.',
        docs: `${runbook}#database_unavailable`,
      },
    });
  });

  it.each([
    ['an unknown outcome', { outcome: 'enabled', state: 'enabled' }],
    ['an unknown state', { outcome: 'resumed', state: 'Enabled' }],
    ['no answer', undefined],
  ])('%s from the worker answers 500 internal_error', async (_case, answer) => {
    const { status, body } = await resume(new FakeFunctionInvoke(answer), operate);

    expect(status).toBe(500);
    expect(body.error.code).toBe('internal_error');
    expect(body.error.message).toBe('An unexpected error occurred.');
  });

  it('a failing invoke answers 500 internal_error', async () => {
    const workerInvoke = new FakeFunctionInvoke();
    workerInvoke.failing = true;

    const { status, body } = await resume(workerInvoke, operate);

    expect(status).toBe(500);
    expect(body.error.code).toBe('internal_error');
  });

  // An SDK network failure carries a socket code, which the database classifier matches only with a
  // pg origin; D20 answers it `500`, never `503 database_unavailable`.
  it('an invoke failing with a socket error code answers 500 internal_error, not 503', async () => {
    class SocketFailingInvoke extends FakeFunctionInvoke {
      override async invoke(payload: unknown): Promise<unknown> {
        this.payloads.push(payload);
        throw Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' });
      }
    }

    const { status, body } = await resume(new SocketFailingInvoke(), operate);

    expect(status).toBe(500);
    expect(body.error.code).toBe('internal_error');
  });
});
