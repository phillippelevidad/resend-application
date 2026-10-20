// Slice 4 D9–D13, ADR-012: the client over the pinned SDK against the fake Resend API, on a fake
// clock whose sleep advances it (D47). Error bodies follow RS-22's shape; the SDK's console logger
// must stay silent (PP C9).
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { LedgerError, type LogFields } from '@ledger/shared';
import { FakeClock } from '@ledger/shared/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createResendClient } from './create-resend-client.ts';
import { FAKE_SIGNING_SECRET, type FakeResendApi, startFakeResendApi } from './testing.ts';

const WEBHOOK_ID = 'wh_fake_ledger';
// A key shape only; never a real key, and below the gitleaks rule's 20 characters.
const API_KEY = 're_fake_key';
const SECRET_BODY_TEXT = 'body text that names delivered@resend.dev';

let api: FakeResendApi;
let clock: FakeClock;
let sleeps: number[];
let logLines: { message: string; fields: LogFields | undefined }[];
let consoleError: ReturnType<typeof vi.spyOn>;

beforeEach(async () => {
  api = await startFakeResendApi();
  clock = new FakeClock('2026-10-21T13:00:00.000Z');
  sleeps = [];
  logLines = [];
  consoleError = vi.spyOn(console, 'error');
});

afterEach(async () => {
  consoleError.mockRestore();
  await api.close();
});

const client = (baseUrl = api.baseUrl) =>
  createResendClient({
    apiKey: API_KEY,
    baseUrl,
    userAgent: 'ledger-reconciler',
    clock,
    sleep: async (ms) => {
      sleeps.push(ms);
      clock.advance(ms);
    },
    logger: {
      info: () => {},
      warn: () => {},
      error: (message, fields) => logLines.push({ message, fields }),
    },
  });

const opts = () => ({ deadline: new Date(clock.now().getTime() + 600_000) });

const failureOf = async (call: Promise<unknown>): Promise<LedgerError> => {
  try {
    await call;
  } catch (error) {
    if (error instanceof LedgerError) return error;
    throw error;
  }
  throw new TypeError('the call did not fail');
};

const errorBody = (statusCode: number, name: string, message = SECRET_BODY_TEXT) => ({
  statusCode,
  name,
  message,
});

describe('createResendClient', () => {
  it('sends to the configured baseUrl with its User-Agent and returns only the webhook status', async () => {
    const result = await client().retrieveWebhook(WEBHOOK_ID, opts());

    expect(result).toEqual({ status: 'enabled' });
    expect(JSON.stringify(result)).not.toContain(FAKE_SIGNING_SECRET);
    expect(api.requests).toEqual([
      expect.objectContaining({
        method: 'GET',
        path: `/webhooks/${WEBHOOK_ID}`,
        userAgent: 'ledger-reconciler',
      }),
    ]);
  });

  it('lists a page of events newest first, 100 a page, following after', async () => {
    api.events = [
      { id: 'evt_old', type: 'email.sent', createdAt: new Date('2026-10-20T10:00:00.000Z') },
      { id: 'evt_new', type: 'email.delivered', createdAt: new Date('2026-10-20T11:00:00.000Z') },
    ];
    const first = await client().listWebhookEvents(WEBHOOK_ID, {}, opts());
    expect(first).toEqual({
      hasMore: false,
      events: [
        { id: 'evt_new', type: 'email.delivered', createdAt: new Date('2026-10-20T11:00:00.000Z') },
        { id: 'evt_old', type: 'email.sent', createdAt: new Date('2026-10-20T10:00:00.000Z') },
      ],
    });
    await client().listWebhookEvents(WEBHOOK_ID, { after: 'evt_new' }, opts());
    expect(api.requests.map((r) => r.path)).toEqual([
      `/webhooks/${WEBHOOK_ID}/events`,
      `/webhooks/${WEBHOOK_ID}/events`,
    ]);
  });

  it('replays an event through the replay endpoint', async () => {
    api.events = [{ id: 'evt_1', type: 'email.sent', createdAt: new Date() }];
    const replayed: string[] = [];
    api.onReplay = (id) => {
      replayed.push(id);
    };
    await client().replayWebhookEvent(WEBHOOK_ID, 'evt_1', opts());
    expect(replayed).toEqual(['evt_1']);
    expect(api.requests[0]).toMatchObject({
      method: 'POST',
      path: `/webhooks/${WEBHOOK_ID}/events/evt_1/replay`,
    });
  });

  it("returns only the payload's top-level created_at from Retrieve Event (RS-15)", async () => {
    api.events = [
      {
        id: 'evt_1',
        type: 'email.sent',
        createdAt: new Date('2026-10-20T10:00:01.000Z'),
        payload: {
          type: 'email.sent',
          created_at: '2026-10-20T10:00:00.500Z',
          data: { to: ['delivered@resend.dev'], subject: 'Ledger gap drill' },
        },
      },
    ];
    const result = await client().retrieveWebhookEventCreatedAt(WEBHOOK_ID, 'evt_1', opts());
    expect(result).toEqual({ createdAt: new Date('2026-10-20T10:00:00.500Z') });
  });

  it('sends an email with its Idempotency-Key and returns the id', async () => {
    const result = await client().sendEmail(
      {
        from: 'onboarding@resend.dev',
        to: 'delivered@resend.dev',
        subject: 'Ledger gap drill',
        text: 'One send.',
      },
      { idempotencyKey: 'ledger-gap-drill-20261021T130000Z' },
      opts(),
    );
    expect(result).toEqual({ emailId: 'fake-email-1' });
    expect(api.requests[0]).toMatchObject({
      method: 'POST',
      path: '/emails',
      idempotencyKey: 'ledger-gap-drill-20261021T130000Z',
    });
  });

  it.each([
    [401, 'missing_api_key'],
    [403, 'validation_error'],
    [409, 'concurrent_idempotent_requests'],
  ])('hands a %i %s from Send Email back by status and name', async (status, name) => {
    api.script('sendEmail', [{ status, body: errorBody(status, name) }]);
    const result = await client().sendEmail(
      { from: 'onboarding@resend.dev', to: 'delivered@resend.dev', subject: 's', text: 't' },
      { idempotencyKey: 'k' },
      opts(),
    );
    expect(result).toEqual({ rejected: { status, name } });
  });

  it.each([
    ['retrieveWebhook', 401, 'missing_api_key', 'resend_auth_failed'],
    ['retrieveWebhook', 403, 'restricted_api_key', 'resend_auth_failed'],
    ['listEvents', 401, 'invalid_api_key', 'resend_auth_failed'],
    ['replayEvent', 403, 'invalid_access', 'resend_auth_failed'],
    ['retrieveWebhook', 404, 'not_found', 'reconciler_not_configured'],
    ['listEvents', 404, 'not_found', 'internal_error'],
    ['replayEvent', 422, 'validation_error', 'internal_error'],
    ['listEvents', 400, 'validation_error', 'internal_error'],
  ] as const)('maps %s %i %s to %s', async (route, status, name, code) => {
    api.events = [{ id: 'evt_1', type: 'email.sent', createdAt: new Date() }];
    api.script(route, [{ status, body: errorBody(status, name) }]);
    const c = client();
    const call =
      route === 'retrieveWebhook'
        ? c.retrieveWebhook(WEBHOOK_ID, opts())
        : route === 'listEvents'
          ? c.listWebhookEvents(WEBHOOK_ID, {}, opts())
          : c.replayWebhookEvent(WEBHOOK_ID, 'evt_1', opts());
    const failure = await failureOf(call);
    expect(failure.code).toBe(code);
    expect(api.requests).toHaveLength(1);
  });

  it('maps 400 validation_error "API key is invalid" to resend_auth_failed (RS-U17, Constraint 14)', async () => {
    api.script('retrieveWebhook', [
      { status: 400, body: errorBody(400, 'validation_error', 'API key is invalid') },
    ]);
    const failure = await failureOf(client().retrieveWebhook(WEBHOOK_ID, opts()));
    expect(failure.code).toBe('resend_auth_failed');
  });

  it('logs the default branch once by error_name and error_code, never the message', async () => {
    api.script('listEvents', [{ status: 422, body: errorBody(422, 'invalid_parameter') }]);
    await failureOf(client().listWebhookEvents(WEBHOOK_ID, {}, opts()));
    expect(logLines).toEqual([
      {
        message: 'resend.request_failed',
        fields: { error_name: 'invalid_parameter', error_code: 'internal_error' },
      },
    ]);
  });

  it('retries a 5xx twice after 1 s and 2 s, then throws resend_unavailable', async () => {
    api.script('listEvents', [
      { status: 500, body: errorBody(500, 'internal_server_error') },
      { status: 502, body: errorBody(502, 'application_error') },
      { status: 503, body: errorBody(503, 'application_error') },
    ]);
    const failure = await failureOf(client().listWebhookEvents(WEBHOOK_ID, {}, opts()));
    expect(failure.code).toBe('resend_unavailable');
    expect(api.requests).toHaveLength(3);
    expect(sleeps).toEqual([1_000, 2_000]);
  });

  it('recovers when a 5xx is followed by a success', async () => {
    api.script('retrieveWebhook', [{ status: 500, body: errorBody(500, 'internal_server_error') }]);
    await expect(client().retrieveWebhook(WEBHOOK_ID, opts())).resolves.toEqual({
      status: 'enabled',
    });
    expect(api.requests).toHaveLength(2);
  });

  it('treats a refused connection as a network failure: three attempts, then resend_unavailable', async () => {
    const closed = createServer();
    await new Promise<void>((resolve) => closed.listen(0, '127.0.0.1', resolve));
    const { port } = closed.address() as AddressInfo;
    await new Promise<void>((resolve) => closed.close(() => resolve()));

    const failure = await failureOf(
      client(`http://127.0.0.1:${port}`).retrieveWebhook(WEBHOOK_ID, opts()),
    );
    expect(failure.code).toBe('resend_unavailable');
    expect(sleeps).toEqual([1_000, 2_000]);
  });

  it('waits out a 429 retry-after inside the deadline, then succeeds', async () => {
    api.script('retrieveWebhook', [
      {
        status: 429,
        body: errorBody(429, 'rate_limit_exceeded'),
        headers: { 'retry-after': '1' },
      },
    ]);
    await expect(client().retrieveWebhook(WEBHOOK_ID, opts())).resolves.toEqual({
      status: 'enabled',
    });
    expect(sleeps).toContain(1_000);
  });

  it('never writes to console.error on a 4xx, a 5xx or a refused connection (PP C9)', async () => {
    api.script('listEvents', [{ status: 422, body: errorBody(422, 'invalid_parameter') }]);
    await failureOf(client().listWebhookEvents(WEBHOOK_ID, {}, opts()));

    api.script('listEvents', [
      { status: 500, body: errorBody(500, 'internal_server_error') },
      { status: 500, body: errorBody(500, 'internal_server_error') },
      { status: 500, body: errorBody(500, 'internal_server_error') },
    ]);
    await failureOf(client().listWebhookEvents(WEBHOOK_ID, {}, opts()));

    await failureOf(client('http://127.0.0.1:1').retrieveWebhook(WEBHOOK_ID, opts()));

    expect(consoleError).not.toHaveBeenCalled();
  });

  it("puts none of Resend's body text in a thrown error or its cause", async () => {
    const cases = [
      { status: 422, name: 'invalid_parameter' },
      { status: 401, name: 'missing_api_key' },
      { status: 500, name: 'internal_server_error' },
    ];
    for (const { status, name } of cases) {
      api.script('listEvents', [
        { status, body: errorBody(status, name) },
        { status, body: errorBody(status, name) },
        { status, body: errorBody(status, name) },
      ]);
      const failure = await failureOf(client().listWebhookEvents(WEBHOOK_ID, {}, opts()));
      expect(failure.message).not.toContain('resend.dev');
      expect(String(failure.cause ?? '')).not.toContain('resend.dev');
      expect(JSON.stringify(failure)).not.toContain('resend.dev');
    }
  });
});
