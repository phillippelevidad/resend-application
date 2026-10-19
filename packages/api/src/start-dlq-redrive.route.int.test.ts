import { errorRegistry } from '@ledger/core';
import { createDatabase, type Database } from '@ledger/db';
import { type OutageDatabase, startOutageDatabase } from '@ledger/db/testing';
import {
  type DlqPort,
  type DlqSample,
  LedgerError,
  type Logger,
  type RedriveStart,
} from '@ledger/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApi } from './create-api.ts';
import type { DlqRedriveResponse } from './dlq-redrive-response.schema.ts';
import type { ErrorResponse } from './error-response.schema.ts';
import { bearer, issueTestToken, testApiDeps } from './testing.ts';

// Ships 2 (D7), through the real auth middleware: `dlq.startRedrive` needs `operate`, answers `202`
// when a redrive starts and `200` when the DLQ is empty, and maps a running task to `409` in the
// error shape. One case stops the server, so this file runs its own container for every case
// (pp-testing → Outage tests).

const runbook = 'https://github.com/phillippelevidad/resend-application/blob/main/docs/runbook.md';

let outage: OutageDatabase;
let database: Database;
let operate: string;
let read: string;

const silent: Logger = { info: () => {}, warn: () => {}, error: () => {} };

beforeAll(async () => {
  outage = await startOutageDatabase();
  database = createDatabase({ url: outage.runtimeUrl, max: 1, logger: silent });
  ({ token: operate } = await issueTestToken(database.db, { scope: 'operate' }));
  ({ token: read } = await issueTestToken(database.db, { scope: 'read' }));
}, 120_000);

afterAll(async () => {
  await database.pool.end();
  await outage.close();
}, 60_000);

// The port double: `startRedrive` answers what the case scripts, or throws it, and counts the
// starts, so a refused call can show that nothing started.
class ScriptedDlq implements DlqPort {
  readonly #answer: () => RedriveStart;
  starts = 0;

  constructor(answer: () => RedriveStart) {
    this.#answer = answer;
  }

  async sample(): Promise<DlqSample> {
    return { depth: 0, messages: [] };
  }

  async startRedrive(): Promise<RedriveStart> {
    this.starts += 1;
    return this.#answer();
  }
}

async function redrive(
  dlq: DlqPort,
  headers: Record<string, string> = bearer(operate),
): Promise<{ status: number; body: DlqRedriveResponse & ErrorResponse }> {
  const api = createApi(testApiDeps(database.db, { dlq }));
  const response = await api.request('/dlq/redrive', { method: 'POST', headers });
  return {
    status: response.status,
    body: (await response.json()) as DlqRedriveResponse & ErrorResponse,
  };
}

describe('dlq.startRedrive', () => {
  it('an operate token on a DLQ of 3 answers 202 started with depth 3, and no task handle', async () => {
    const dlq = new ScriptedDlq(() => ({ status: 'started', depth: 3 }));

    const { status, body } = await redrive(dlq);

    expect(status).toBe(202);
    expect(body).toEqual({ object: 'dlq_redrive', status: 'started', depth: 3 });
    expect(dlq.starts).toBe(1);
  });

  // The mapper picks fields by name, so a handle an adapter leaked would still stay off the wire
  // (AWS-61).
  it('a port answer carrying an extra field answers only object, status and depth', async () => {
    const dlq = new ScriptedDlq(
      () =>
        ({
          status: 'started',
          depth: 2,
          taskHandle: 'eyJ0YXNrSWQiOiJ4In0=',
        }) as RedriveStart,
    );

    const { status, body } = await redrive(dlq);

    expect(status).toBe(202);
    expect(body).toEqual({ object: 'dlq_redrive', status: 'started', depth: 2 });
  });

  it('an empty DLQ answers 200 empty with depth 0', async () => {
    const { status, body } = await redrive(new ScriptedDlq(() => ({ status: 'empty', depth: 0 })));

    expect(status).toBe(200);
    expect(body).toEqual({ object: 'dlq_redrive', status: 'empty', depth: 0 });
  });

  it('an empty in-process dead list answers 200 empty', async () => {
    const api = createApi(testApiDeps(database.db));

    const response = await api.request('/dlq/redrive', {
      method: 'POST',
      headers: bearer(operate),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ object: 'dlq_redrive', status: 'empty', depth: 0 });
  });

  it('a running redrive answers 409 redrive_in_progress in the error shape with the registry text', async () => {
    const dlq = new ScriptedDlq(() => {
      throw new LedgerError('redrive_in_progress', errorRegistry.redrive_in_progress.message);
    });

    const { status, body } = await redrive(dlq);

    expect(status).toBe(409);
    expect(body).toEqual({
      error: {
        code: 'redrive_in_progress',
        message: 'A DLQ redrive task is already running; SQS allows one per queue.',
        hint: 'Wait for the DLQ depth in `ledger health` to fall.',
        docs: 'https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-configure-dead-letter-queue-redrive.html',
      },
    });
    expect(dlq.starts).toBe(1);
  });

  it('a start the queue rejects for another reason answers 500 internal_error, with one start attempted', async () => {
    const dlq = new ScriptedDlq(() => {
      throw Object.assign(new Error('UnsupportedOperation'), { name: 'UnsupportedOperation' });
    });

    const { status, body } = await redrive(dlq);

    expect(status).toBe(500);
    expect(body).toEqual({
      error: {
        code: 'internal_error',
        message: 'An unexpected error occurred.',
        hint: 'Retry; if it persists, read the API logs by request id.',
        docs: `${runbook}#internal_error`,
      },
    });
    expect(dlq.starts).toBe(1);
  });

  it('a read token answers 403 forbidden and starts no redrive', async () => {
    const dlq = new ScriptedDlq(() => ({ status: 'started', depth: 3 }));

    const { status, body } = await redrive(dlq, bearer(read));

    expect(status).toBe(403);
    expect(body.error.code).toBe('forbidden');
    expect(dlq.starts).toBe(0);
  });

  it('no token answers 401 unauthorized and starts no redrive', async () => {
    const dlq = new ScriptedDlq(() => ({ status: 'started', depth: 3 }));

    const { status, body } = await redrive(dlq, {});

    expect(status).toBe(401);
    expect(body.error.code).toBe('unauthorized');
    expect(dlq.starts).toBe(0);
  });
});

describe('dlq.startRedrive with Postgres stopped', () => {
  it('an operate token answers 503 database_unavailable from the token lookup and starts no redrive', async () => {
    const dlq = new ScriptedDlq(() => ({ status: 'empty', depth: 0 }));
    const api = createApi(testApiDeps(database.db, { dlq }));
    const post = () => api.request('/dlq/redrive', { method: 'POST', headers: bearer(operate) });
    // Opens the pooled connection, so the shutdown ends a live session too.
    expect((await post()).status).toBe(200);

    await outage.stop();
    try {
      const response = await post();
      expect(response.status).toBe(503);
      expect(((await response.json()) as ErrorResponse).error.code).toBe('database_unavailable');
      expect(dlq.starts).toBe(1);
    } finally {
      await outage.start();
    }
  }, 60_000);
});
