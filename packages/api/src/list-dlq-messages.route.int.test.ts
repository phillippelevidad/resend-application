import type { IngestEnvelope } from '@ledger/core';
import { createDatabase, type Database } from '@ledger/db';
import { type OutageDatabase, startOutageDatabase } from '@ledger/db/testing';
import {
  createLogger,
  type DlqPort,
  type DlqRawMessage,
  type DlqSample,
  InProcessQueueAdapter,
  type Logger,
  type RedriveStart,
} from '@ledger/shared';
import { FakeClock } from '@ledger/shared/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApi } from './create-api.ts';
import type { DlqMessageListResponse } from './dlq-message-response.schema.ts';
import type { DlqRedriveResponse } from './dlq-redrive-response.schema.ts';
import type { ErrorResponse } from './error-response.schema.ts';
import { bearer, issueTestToken, testApiDeps } from './testing.ts';

// Ships 2 (D5, D6), through the real middleware: `dlq.listMessages` returns ids, timestamps and
// counts only, whatever the dead message's payload holds, lists an unreadable message instead of
// failing, and validates `limit` with its own range. One case stops the server, so this file runs
// its own container for every case (pp-testing → Outage tests).

const runbook = 'https://github.com/phillippelevidad/resend-application/blob/main/docs/runbook.md';

let outage: OutageDatabase;
let database: Database;
let read: string;

const silent: Logger = { info: () => {}, warn: () => {}, error: () => {} };

beforeAll(async () => {
  outage = await startOutageDatabase();
  database = createDatabase({ url: outage.runtimeUrl, max: 1, logger: silent });
  ({ token: read } = await issueTestToken(database.db, { scope: 'read' }));
}, 120_000);

afterAll(async () => {
  await database.pool.end();
  await outage.close();
}, 60_000);

// A dead store holding exactly these messages: `sample` honours `limit` and removes nothing, as the
// port's contract says; `depth` defaults to their count.
class StubDlq implements DlqPort {
  readonly #messages: readonly DlqRawMessage[];
  readonly #depth: number;
  failing = false;

  constructor(messages: readonly DlqRawMessage[], depth = messages.length) {
    this.#messages = messages;
    this.#depth = depth;
  }

  async sample(limit: number): Promise<DlqSample> {
    if (this.failing) throw Object.assign(new Error('queue read failed'), { name: 'FakeFailure' });
    return { depth: this.#depth, messages: this.#messages.slice(0, limit) };
  }

  async startRedrive(): Promise<RedriveStart> {
    return { status: 'empty', depth: 0 };
  }
}

// A dead message's body as ingest enqueued it: the envelope, its raw body the payload serialized.
const deadBody = (svixId: string, payload: unknown): string =>
  JSON.stringify({
    svixId,
    receivedAt: '2026-10-19T12:00:01.000Z',
    source: 'live',
    rawBody: typeof payload === 'string' ? payload : JSON.stringify(payload),
    headers: { 'svix-timestamp': '1792411201' },
  } satisfies IngestEnvelope);

const delivered = (emailId: string) => ({
  type: 'email.delivered',
  created_at: '2026-10-19T12:00:00.000Z',
  data: { email_id: emailId, to: ['delivered@resend.dev'] },
});

async function list(
  dlq: DlqPort,
  query = '',
  token = read,
  logger: Logger = silent,
): Promise<{ status: number; text: string; body: DlqMessageListResponse & ErrorResponse }> {
  const api = createApi(testApiDeps(database.db, { dlq, logger }));
  const response = await api.request(`/dlq/messages${query}`, { headers: bearer(token) });
  const text = await response.text();
  return {
    status: response.status,
    text,
    body: JSON.parse(text) as DlqMessageListResponse & ErrorResponse,
  };
}

describe('dlq.listMessages', () => {
  it('one dead message answers 200 with its ids, timestamps and receive count, depth 1 and has_more false', async () => {
    const dlq = new StubDlq([
      { body: deadBody('msg_dlq_one', delivered('em_dlq_one')), receiveCount: 6 },
    ]);

    const { status, body } = await list(dlq);

    expect(status).toBe(200);
    expect(body).toEqual({
      object: 'list',
      has_more: false,
      depth: 1,
      data: [
        {
          object: 'dlq_message',
          svix_id: 'msg_dlq_one',
          type: 'email.delivered',
          email_id: 'em_dlq_one',
          event_created_at: '2026-10-19T12:00:00.000Z',
          enqueued_at: '2026-10-19T12:00:01.000Z',
          receive_count: 6,
        },
      ],
    });
  });

  // The mandatory redaction test (pp-workflow → Test tiers, RS-32): the payload's address, `from`,
  // subject and tags never reach the response, raw or masked.
  it('a payload naming delivered@resend.dev in to and from with a subject answers neither, and items hold only the seven keys', async () => {
    const subject = 'Invoice 2026-10 for the DLQ redaction case';
    const dlq = new StubDlq([
      {
        body: deadBody('msg_dlq_redact', {
          type: 'email.bounced',
          created_at: '2026-10-19T12:00:00.000Z',
          data: {
            email_id: 'em_dlq_redact',
            from: 'Acme <delivered@resend.dev>',
            to: ['delivered@resend.dev'],
            subject,
            tags: { campaign: 'dlq-redaction' },
            bounce: { message: 'Mailbox delivered@resend.dev does not exist', type: 'Permanent' },
          },
        }),
        receiveCount: 5,
      },
    ]);

    const { status, text, body } = await list(dlq);

    expect(status).toBe(200);
    expect(text).not.toContain('delivered@resend.dev');
    expect(text).not.toContain('resend.dev');
    expect(text).not.toContain(subject);
    expect(text).not.toContain('dlq-redaction');
    expect(text).not.toContain('Mailbox');
    expect(body.data).toHaveLength(1);
    for (const item of body.data) {
      expect(Object.keys(item).sort()).toEqual(
        [
          'object',
          'svix_id',
          'type',
          'email_id',
          'event_created_at',
          'enqueued_at',
          'receive_count',
        ].sort(),
      );
    }
    expect(body.data[0]).toMatchObject({ svix_id: 'msg_dlq_redact', email_id: 'em_dlq_redact' });
  });

  it.each([
    ['a body that is not JSON', 'not json at all'],
    [
      'a JSON body that is not an ingest envelope',
      JSON.stringify({ hello: 'delivered@resend.dev' }),
    ],
    ['an envelope missing its svixId', JSON.stringify({ receivedAt: '2026-10-19T12:00:01.000Z' })],
  ])('%s is listed with every field null but its receive_count', async (_case, rawBody) => {
    const dlq = new StubDlq([{ body: rawBody, receiveCount: 7 }]);

    const { status, text, body } = await list(dlq);

    expect(status).toBe(200);
    expect(body).toEqual({
      object: 'list',
      has_more: false,
      depth: 1,
      data: [
        {
          object: 'dlq_message',
          svix_id: null,
          type: null,
          email_id: null,
          event_created_at: null,
          enqueued_at: null,
          receive_count: 7,
        },
      ],
    });
    expect(text).not.toContain('delivered@resend.dev');
  });

  it('an envelope whose payload is not JSON keeps its svix_id and enqueue time, the payload fields null', async () => {
    const dlq = new StubDlq([{ body: deadBody('msg_dlq_text', 'plain text'), receiveCount: 5 }]);

    const { body } = await list(dlq);

    expect(body.data).toEqual([
      {
        object: 'dlq_message',
        svix_id: 'msg_dlq_text',
        type: null,
        email_id: null,
        event_created_at: null,
        enqueued_at: '2026-10-19T12:00:01.000Z',
        receive_count: 5,
      },
    ]);
  });

  it('a payload path whose value is not a string answers null for that field only', async () => {
    const dlq = new StubDlq([
      {
        body: deadBody('msg_dlq_types', {
          type: 5,
          created_at: '2026-10-19T12:00:00.000Z',
          data: { email_id: { id: 'em_nested' } },
        }),
        receiveCount: 5,
      },
      { body: deadBody('msg_dlq_array', ['email.delivered']), receiveCount: 5 },
    ]);

    const { body } = await list(dlq);

    expect(body.data.map((item) => [item.type, item.email_id, item.event_created_at])).toEqual([
      [null, null, '2026-10-19T12:00:00.000Z'],
      [null, null, null],
    ]);
  });

  it('a depth above the sample answers at most 10 items by default, the depth, and has_more true', async () => {
    const messages = Array.from({ length: 12 }, (_, index) => ({
      body: deadBody(`msg_dlq_many_${index}`, delivered(`em_dlq_many_${index}`)),
      receiveCount: 5,
    }));

    const { status, body } = await list(new StubDlq(messages));

    expect(status).toBe(200);
    expect(body.data).toHaveLength(10);
    expect(body.depth).toBe(12);
    expect(body.has_more).toBe(true);
  });

  // AWS-62: the approximate depth can read 0 while the receive returns the message. The depth then
  // counts the sample, so the CLI never prints `empty` above an item it lists.
  it('a depth that under-reads the sample answers the sample count as the depth, has_more false', async () => {
    const dlq = new StubDlq(
      [
        { body: deadBody('msg_dlq_lag_a', delivered('em_dlq_lag_a')), receiveCount: 6 },
        { body: deadBody('msg_dlq_lag_b', delivered('em_dlq_lag_b')), receiveCount: 6 },
      ],
      0,
    );

    const { status, body } = await list(dlq);

    expect(status).toBe(200);
    expect(body.data).toHaveLength(2);
    expect(body.depth).toBe(2);
    expect(body.has_more).toBe(false);
  });

  it.each([
    ['1', 1],
    ['10', 10],
  ])('limit %s answers that many items', async (limit, expected) => {
    const messages = Array.from({ length: 12 }, (_, index) => ({
      body: deadBody(`msg_dlq_limit_${index}`, delivered(`em_dlq_limit_${index}`)),
      receiveCount: 5,
    }));

    const { status, body } = await list(new StubDlq(messages), `?limit=${limit}`);

    expect(status).toBe(200);
    expect(body.data).toHaveLength(expected);
    expect(body.has_more).toBe(true);
  });

  it.each(['0', '11', '100', 'abc', '1.5', '-1', ''])(
    'limit %j answers 400 validation_failed with the route-scoped message',
    async (limit) => {
      const { status, body } = await list(new StubDlq([]), `?limit=${limit}`);

      expect(status).toBe(400);
      expect(body).toEqual({
        error: {
          code: 'validation_failed',
          message: 'limit must be an integer from 1 to 10.',
          hint: 'Fix the field the message names, then retry.',
          docs: `${runbook}#validation_failed`,
        },
      });
    },
  );

  it('items repeating one svix_id collapse to the first, null-id items are all kept, and has_more counts what remains', async () => {
    const dlq = new StubDlq(
      [
        { body: deadBody('msg_dlq_twice', delivered('em_dlq_twice')), receiveCount: 5 },
        { body: 'unreadable one', receiveCount: 6 },
        { body: deadBody('msg_dlq_twice', delivered('em_dlq_twice')), receiveCount: 7 },
        { body: 'unreadable two', receiveCount: 8 },
      ],
      3,
    );

    const { body } = await list(dlq);

    expect(body.data.map((item) => [item.svix_id, item.receive_count])).toEqual([
      ['msg_dlq_twice', 5],
      [null, 6],
      [null, 8],
    ]);
    expect(body.depth).toBe(3);
    expect(body.has_more).toBe(false);
  });

  it('an empty in-process dead list answers 200 with depth 0, has_more false and no items', async () => {
    const api = createApi(testApiDeps(database.db));

    const response = await api.request('/dlq/messages', { headers: bearer(read) });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ object: 'list', has_more: false, depth: 0, data: [] });
  });

  // The spec's "Inspect then redrive", over local mode's real `DlqPort`: three inspects of a depth-2
  // dead list each answer depth 2, and the redrive that follows moves both.
  it('inspecting three times removes nothing: each answers depth 2, and a redrive then starts with depth 2', async () => {
    const clock = new FakeClock();
    const queue = new InProcessQueueAdapter({ clock, logger: silent, sleep: clock.sleep });
    queue.start(async (messages) => ({
      batchItemFailures: messages.map((message) => ({ itemIdentifier: message.messageId })),
    }));
    const settle = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));
    for (const svixId of ['msg_dlq_kept_a', 'msg_dlq_kept_b']) {
      await queue.enqueue(JSON.parse(deadBody(svixId, delivered(`em_${svixId}`))));
    }
    await settle();
    for (let receive = 1; receive < 5; receive += 1) {
      clock.advance(1_000);
      await settle();
    }
    const { token: operate } = await issueTestToken(database.db, { scope: 'operate' });
    const api = createApi(testApiDeps(database.db, { dlq: queue }));

    for (let call = 0; call < 3; call += 1) {
      const response = await api.request('/dlq/messages', { headers: bearer(read) });
      const body = (await response.json()) as DlqMessageListResponse;
      expect(body.depth).toBe(2);
      expect(body.data.map((item) => item.svix_id).sort()).toEqual([
        'msg_dlq_kept_a',
        'msg_dlq_kept_b',
      ]);
    }
    const redrive = await api.request('/dlq/redrive', { method: 'POST', headers: bearer(operate) });
    expect(redrive.status).toBe(202);
    expect((await redrive.json()) as DlqRedriveResponse).toEqual({
      object: 'dlq_redrive',
      status: 'started',
      depth: 2,
    });
  });

  it('a failing queue read answers 500 internal_error and logs the error name only', async () => {
    const dlq = new StubDlq([]);
    dlq.failing = true;
    const written: string[] = [];
    const logger = createLogger({
      functionName: 'api',
      stream: { write: (chunk) => written.push(chunk) },
    });

    const { status, body } = await list(dlq, '', read, logger);

    expect(status).toBe(500);
    expect(body.error.code).toBe('internal_error');
    expect(body.error.message).toBe('An unexpected error occurred.');
    const lines = written.map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(lines).toEqual([
      expect.objectContaining({ message: 'api.internal_error', error_name: 'FakeFailure' }),
    ]);
    expect(written.join('')).not.toContain('queue read failed');
  });

  it('no token answers 401 unauthorized', async () => {
    const api = createApi(testApiDeps(database.db, { dlq: new StubDlq([]) }));

    const response = await api.request('/dlq/messages');

    expect(response.status).toBe(401);
    expect(((await response.json()) as ErrorResponse).error.code).toBe('unauthorized');
  });
});

describe('dlq.listMessages with Postgres stopped', () => {
  it('a tagged token answers 503 database_unavailable from the token lookup', async () => {
    const api = createApi(testApiDeps(database.db, { dlq: new StubDlq([]) }));
    // Opens the pooled connection, so the shutdown ends a live session too.
    expect((await api.request('/dlq/messages', { headers: bearer(read) })).status).toBe(200);

    await outage.stop();
    try {
      const response = await api.request('/dlq/messages', { headers: bearer(read) });
      expect(response.status).toBe(503);
      expect(((await response.json()) as ErrorResponse).error.code).toBe('database_unavailable');
    } finally {
      await outage.start();
    }
  }, 60_000);
});
