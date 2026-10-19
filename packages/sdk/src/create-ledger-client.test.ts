import { createServer, type IncomingHttpHeaders, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { apiUnavailable, createLedgerClient, type LedgerClient } from './create-ledger-client.ts';

// D26: the client's wire behavior and its one error mapping, against a real HTTP server on a
// loopback port (Ships 8). The SDK ↔ API round trip is apps/local's contract test (D41).

type Received = { method: string; url: string; headers: IncomingHttpHeaders; body: string };
type Reply = { status: number; contentType: string; body: string };

const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map((server) => new Promise((resolve) => server.close(resolve))),
  );
});

// Answers every request with `reply` and records what it received.
async function serve(reply: Reply): Promise<{ baseUrl: string; received: Received[] }> {
  const received: Received[] = [];
  const server = createServer((request, response) => {
    let body = '';
    request.setEncoding('utf8');
    request.on('data', (chunk: string) => {
      body += chunk;
    });
    request.on('end', () => {
      received.push({
        method: request.method ?? '',
        url: request.url ?? '',
        headers: request.headers,
        body,
      });
      response.writeHead(reply.status, { 'content-type': reply.contentType });
      response.end(reply.body);
    });
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return { baseUrl: `http://127.0.0.1:${port}`, received };
}

// A port that was just bound and released: nothing listens on it.
async function closedPort(): Promise<string> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  await new Promise((resolve) => server.close(resolve));
  return `http://127.0.0.1:${port}`;
}

const json = (status: number, value: unknown): Reply => ({
  status,
  contentType: 'application/json',
  body: JSON.stringify(value),
});

const recipient = {
  object: 'recipient',
  address_masked: 'd*******d@resend.dev',
  deliverability: 'ok',
  since: '2026-10-17T12:00:01.000Z',
  cause_email_id: null,
};

const emailNotFound = {
  code: 'email_not_found',
  message: 'No event has been recorded for this email id.',
  hint: 'Events may still be queued, or missed: run `ledger gaps`.',
  docs: 'https://github.com/phillippelevidad/resend-application/blob/main/docs/runbook.md#email_not_found',
};

describe('createLedgerClient', () => {
  it('sends the bearer header on every method', async () => {
    const { baseUrl, received } = await serve(json(200, recipient));
    const ledger = createLedgerClient({ baseUrl, token: 'local-loopback-no-auth' });

    await ledger.emails.get('e1');
    await ledger.recipients.get('delivered@resend.dev');

    expect(received.map((request) => request.headers.authorization)).toEqual([
      'Bearer local-loopback-no-auth',
      'Bearer local-loopback-no-auth',
    ]);
  });

  it('puts the address in the JSON body and never in the URL', async () => {
    const { baseUrl, received } = await serve(json(200, recipient));
    const ledger = createLedgerClient({ baseUrl, token: 't' });

    const result = await ledger.recipients.get('delivered@resend.dev');

    expect(result).toEqual({ data: recipient, error: null });
    const [request] = received;
    expect(request?.method).toBe('POST');
    expect(request?.url).toBe('/recipients/lookup');
    expect(request?.url).not.toMatch(/delivered|resend\.dev|%40/);
    expect(request?.headers['content-type']).toBe('application/json');
    expect(JSON.parse(request?.body ?? '')).toEqual({ address: 'delivered@resend.dev' });
  });

  it('returns the email id in the path and the 200 body as data', async () => {
    const email = { object: 'email', email_id: 'e1', recipients: [], timeline: [] };
    const { baseUrl, received } = await serve(json(200, email));
    const ledger = createLedgerClient({ baseUrl, token: 't' });

    const result = await ledger.emails.get('e1');

    expect(received[0]?.method).toBe('GET');
    expect(received[0]?.url).toBe('/emails/e1');
    expect(result).toEqual({ data: email, error: null });
  });

  it('returns a registry error unchanged and does not throw', async () => {
    const { baseUrl } = await serve(json(404, { error: emailNotFound }));
    const ledger = createLedgerClient({ baseUrl, token: 't' });

    expect(await ledger.emails.get('e1')).toEqual({ data: null, error: emailNotFound });
  });

  it('passes an unknown error code through unchanged', async () => {
    const unknown = { code: 'not_in_registry', message: 'm', hint: 'h', docs: 'https://d' };
    const { baseUrl } = await serve(json(409, { error: unknown }));
    const ledger = createLedgerClient({ baseUrl, token: 't' });

    expect(await ledger.recipients.get('bounced@resend.dev')).toEqual({
      data: null,
      error: unknown,
    });
  });

  it.each<[string, Reply]>([
    ['a shapeless 502', { status: 502, contentType: 'text/plain', body: 'Bad Gateway' }],
    ['a 429 from the HTTP API', json(429, { message: 'Too Many Requests' })],
    ['a 200 that is not a JSON object', { status: 200, contentType: 'text/plain', body: 'ok' }],
  ])('maps %s to api_unavailable', async (_case, reply) => {
    const { baseUrl } = await serve(reply);
    const ledger = createLedgerClient({ baseUrl, token: 't' });

    expect(await ledger.emails.get('e1')).toEqual({ data: null, error: apiUnavailable });
  });

  it('maps a closed port to api_unavailable without throwing', async () => {
    const ledger = createLedgerClient({ baseUrl: await closedPort(), token: 't' });

    const email = ledger.emails.get('e1');
    const lookup = ledger.recipients.get('delivered@resend.dev');

    await expect(email).resolves.toEqual({ data: null, error: apiUnavailable });
    await expect(lookup).resolves.toEqual({ data: null, error: apiUnavailable });
  });

  describe('health, worker and token methods (D24)', () => {
    const token = {
      object: 'token',
      token_id: 3,
      name: 'review-2026-10-20',
      scope: 'read',
      created_at: '2026-10-20T09:00:00.000Z',
      revoked_at: null,
    };
    const forbidden = {
      code: 'forbidden',
      message: 'The token is valid but lacks the scope this operation needs.',
      hint: 'Use an `operate` token, or ask its owner for one.',
      docs: 'https://github.com/phillippelevidad/resend-application/blob/main/docs/runbook.md#forbidden',
    };

    type Case = [string, (ledger: LedgerClient) => Promise<unknown>, string, string, unknown];
    const cases: Case[] = [
      ['health.get', (ledger) => ledger.health.get(), 'GET', '/health', ''],
      [
        'worker.resumeEventSource',
        (ledger) => ledger.worker.resumeEventSource(),
        'POST',
        '/worker/resume',
        '',
      ],
      ['tokens.getCurrent', (ledger) => ledger.tokens.getCurrent(), 'GET', '/tokens/current', ''],
      ['tokens.list()', (ledger) => ledger.tokens.list(), 'GET', '/tokens', ''],
      [
        'tokens.list({ limit, after })',
        (ledger) => ledger.tokens.list({ limit: 100, after: 42 }),
        'GET',
        '/tokens?limit=100&after=42',
        '',
      ],
      [
        'tokens.create',
        (ledger) => ledger.tokens.create({ name: 'review-walk', scope: 'read' }),
        'POST',
        '/tokens',
        { name: 'review-walk', scope: 'read' },
      ],
      ['tokens.revoke', (ledger) => ledger.tokens.revoke('7'), 'POST', '/tokens/7/revoke', ''],
    ];

    it.each(cases)(
      '%s sends its method, path and body with the bearer header and returns the body as data',
      async (_name, call, method, url, body) => {
        const { baseUrl, received } = await serve(json(200, token));
        const ledger = createLedgerClient({ baseUrl, token: 'ldg_contract' });

        const result = await call(ledger);

        expect(result).toEqual({ data: token, error: null });
        expect(received).toHaveLength(1);
        expect(received[0]?.method).toBe(method);
        expect(received[0]?.url).toBe(url);
        expect(received[0]?.headers.authorization).toBe('Bearer ldg_contract');
        if (body === '') expect(received[0]?.body).toBe('');
        else expect(JSON.parse(received[0]?.body ?? '')).toEqual(body);
      },
    );

    it.each(cases)('%s returns a registry error as a value and does not throw', async (...c) => {
      const { baseUrl } = await serve(json(403, { error: forbidden }));
      const ledger = createLedgerClient({ baseUrl, token: 't' });

      await expect(c[1](ledger)).resolves.toEqual({ data: null, error: forbidden });
    });

    it.each(cases)('%s maps a closed port to api_unavailable without throwing', async (...c) => {
      const ledger = createLedgerClient({ baseUrl: await closedPort(), token: 't' });

      await expect(c[1](ledger)).resolves.toEqual({ data: null, error: apiUnavailable });
    });

    it('tokens.create sends exactly one request when the response is lost, and retries nothing', async () => {
      const received: string[] = [];
      const server = createServer((request) => {
        received.push(`${request.method} ${request.url}`);
        // The request arrived; its answer never does.
        request.socket.destroy();
      });
      servers.push(server);
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
      const { port } = server.address() as AddressInfo;
      const ledger = createLedgerClient({ baseUrl: `http://127.0.0.1:${port}`, token: 't' });

      const result = await ledger.tokens.create({ name: 'review-walk', scope: 'read' });

      expect(result).toEqual({ data: null, error: apiUnavailable });
      expect(received).toEqual(['POST /tokens']);
    });

    it('tokens.create sends exactly one request on a shapeless 503, and retries nothing', async () => {
      const { baseUrl, received } = await serve({
        status: 503,
        contentType: 'text/plain',
        body: 'Service Unavailable',
      });
      const ledger = createLedgerClient({ baseUrl, token: 't' });

      const result = await ledger.tokens.create({ name: 'review-walk', scope: 'operate' });

      expect(result).toEqual({ data: null, error: apiUnavailable });
      expect(received).toHaveLength(1);
    });
  });

  describe('dlq methods (slice 3 D10)', () => {
    const list = {
      object: 'list',
      has_more: true,
      depth: 3,
      data: [
        {
          object: 'dlq_message',
          svix_id: 'msg_dlq_sdk',
          type: 'email.delivered',
          email_id: 'em_dlq_sdk',
          event_created_at: '2026-10-19T12:00:00.000Z',
          enqueued_at: '2026-10-19T12:00:01.000Z',
          receive_count: 6,
        },
      ],
    };
    const redriveInProgress = {
      code: 'redrive_in_progress',
      message: 'A DLQ redrive task is already running; SQS allows one per queue.',
      hint: 'Wait for the DLQ depth in `ledger health` to fall.',
      docs: 'https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-configure-dead-letter-queue-redrive.html',
    };

    type Case = [string, (ledger: LedgerClient) => Promise<unknown>, string, string];
    const cases: Case[] = [
      ['dlq.listMessages()', (ledger) => ledger.dlq.listMessages(), 'GET', '/dlq/messages'],
      [
        'dlq.listMessages({ limit })',
        (ledger) => ledger.dlq.listMessages({ limit: 5 }),
        'GET',
        '/dlq/messages?limit=5',
      ],
      ['dlq.startRedrive', (ledger) => ledger.dlq.startRedrive(), 'POST', '/dlq/redrive'],
    ];

    it.each(cases)(
      '%s sends its method and path with the bearer header and no body, and returns the body as data',
      async (_name, call, method, url) => {
        const { baseUrl, received } = await serve(json(200, list));
        const ledger = createLedgerClient({ baseUrl, token: 'ldg_contract' });

        const result = await call(ledger);

        expect(result).toEqual({ data: list, error: null });
        expect(received).toHaveLength(1);
        expect(received[0]?.method).toBe(method);
        expect(received[0]?.url).toBe(url);
        expect(received[0]?.headers.authorization).toBe('Bearer ldg_contract');
        expect(received[0]?.body).toBe('');
      },
    );

    it.each(cases)('%s returns a registry error as a value and does not throw', async (...c) => {
      const { baseUrl } = await serve(json(409, { error: redriveInProgress }));
      const ledger = createLedgerClient({ baseUrl, token: 't' });

      await expect(c[1](ledger)).resolves.toEqual({ data: null, error: redriveInProgress });
    });

    it.each(cases)('%s maps a closed port to api_unavailable without throwing', async (...c) => {
      const ledger = createLedgerClient({ baseUrl: await closedPort(), token: 't' });

      await expect(c[1](ledger)).resolves.toEqual({ data: null, error: apiUnavailable });
    });

    it('dlq.startRedrive returns a 202 started body as data', async () => {
      const started = { object: 'dlq_redrive', status: 'started', depth: 3 };
      const { baseUrl } = await serve(json(202, started));
      const ledger = createLedgerClient({ baseUrl, token: 't' });

      expect(await ledger.dlq.startRedrive()).toEqual({ data: started, error: null });
    });

    it.each(cases)(
      '%s sends exactly one request when the response is lost, and retries nothing',
      async (_name, call, method, url) => {
        const received: string[] = [];
        const server = createServer((request) => {
          received.push(`${request.method} ${request.url}`);
          // The request arrived; its answer never does.
          request.socket.destroy();
        });
        servers.push(server);
        await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
        const { port } = server.address() as AddressInfo;
        const ledger = createLedgerClient({ baseUrl: `http://127.0.0.1:${port}`, token: 't' });

        expect(await call(ledger)).toEqual({ data: null, error: apiUnavailable });
        expect(received).toEqual([`${method} ${url}`]);
      },
    );

    it.each(cases)(
      '%s sends exactly one request on a shapeless 503, and retries nothing',
      async (_name, call) => {
        const { baseUrl, received } = await serve({
          status: 503,
          contentType: 'text/plain',
          body: 'Service Unavailable',
        });
        const ledger = createLedgerClient({ baseUrl, token: 't' });

        expect(await call(ledger)).toEqual({ data: null, error: apiUnavailable });
        expect(received).toHaveLength(1);
      },
    );
  });

  it('exports api_unavailable with its registry message, hint and docs', () => {
    expect(apiUnavailable).toEqual({
      code: 'api_unavailable',
      message: 'The Ledger API did not answer with a Ledger response.',
      hint: 'Check `LEDGER_URL`. The kill switch may be tripped: check the budget alerts, then run the re-arm script.',
      docs: 'https://github.com/phillippelevidad/resend-application/blob/main/docs/runbook.md#api_unavailable',
    });
  });
});
