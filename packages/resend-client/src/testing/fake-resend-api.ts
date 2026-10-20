import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

// The routes the fake answers, one per `ResendClient` method's endpoint (RS-13 to RS-16, RS-24).
export type FakeResendRoute =
  | 'retrieveWebhook'
  | 'listEvents'
  | 'retrieveEvent'
  | 'replayEvent'
  | 'sendEmail';

// One scripted answer: the status, the RS-22 error body (or a success body) and the
// `ratelimit-*` / `retry-after` headers.
export type ScriptedResponse = {
  readonly status: number;
  readonly body?: unknown;
  readonly headers?: Readonly<Record<string, string>>;
};

// An event the fake's webhook holds. `payload` is what Retrieve Event returns; fixtures use Resend's
// test addresses only.
export type FakeWebhookEvent = {
  readonly id: string;
  readonly type: string;
  readonly createdAt: Date;
  readonly payload?: unknown;
};

export type RecordedRequest = {
  readonly method: string;
  readonly path: string;
  readonly userAgent: string | undefined;
  readonly idempotencyKey: string | undefined;
  readonly body: unknown;
};

export type FakeResendApi = {
  readonly baseUrl: string;
  // Answers the route's next requests with these, in order, before falling back to the defaults.
  script(route: FakeResendRoute, responses: readonly ScriptedResponse[]): void;
  // The webhook's events, which unscripted List Events pages newest first.
  events: FakeWebhookEvent[];
  // What unscripted Retrieve Webhook answers.
  webhookStatus: 'enabled' | 'disabled';
  // Called on each unscripted replay of a held event, before the `200`.
  onReplay: (eventId: string) => Promise<void> | void;
  readonly requests: RecordedRequest[];
  close(): Promise<void>;
};

const PAGE_LIMIT_MAX = 100;

const routeOf = (method: string, path: string): FakeResendRoute | undefined => {
  if (method === 'POST' && path === '/emails') return 'sendEmail';
  if (method === 'GET' && /^\/webhooks\/[^/]+$/.test(path)) return 'retrieveWebhook';
  if (method === 'GET' && /^\/webhooks\/[^/]+\/events$/.test(path)) return 'listEvents';
  if (method === 'GET' && /^\/webhooks\/[^/]+\/events\/[^/]+$/.test(path)) return 'retrieveEvent';
  if (method === 'POST' && /^\/webhooks\/[^/]+\/events\/[^/]+\/replay$/.test(path)) {
    return 'replayEvent';
  }
  return undefined;
};

const readBody = async (request: IncomingMessage): Promise<unknown> => {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  const text = Buffer.concat(chunks).toString('utf8');
  if (text === '') return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
};

const send = (
  response: ServerResponse,
  status: number,
  body: unknown,
  headers: Readonly<Record<string, string>> = {},
): void => {
  response.writeHead(status, { 'content-type': 'application/json', ...headers });
  response.end(body === undefined ? '' : JSON.stringify(body));
};

const notFound = { statusCode: 404, name: 'not_found', message: 'Not found' };

// What Retrieve Webhook returns beside its status (RS-13), so a test can prove it never leaves the
// client. Built at run time, so no `whsec_` literal sits in the source (the gitleaks rule).
export const FAKE_SIGNING_SECRET = [
  'whsec',
  Buffer.from('fake-signing-secret').toString('base64'),
].join('_');

// Slice 4 D13: a local stand-in for Resend's API, reached through `baseUrl` exactly as the real one
// is. It answers scripted responses first, then pages `events` itself; it never decides what is
// missing. `node:http` on `127.0.0.1:0`, so files run in parallel.
export async function startFakeResendApi(): Promise<FakeResendApi> {
  const scripts = new Map<FakeResendRoute, ScriptedResponse[]>();
  let emailCount = 0;

  const api: FakeResendApi = {
    baseUrl: '',
    script(route, responses) {
      scripts.set(route, [...(scripts.get(route) ?? []), ...responses]);
    },
    events: [],
    webhookStatus: 'enabled',
    onReplay: () => {},
    requests: [],
    close: () =>
      new Promise((resolve, reject) => {
        server.closeAllConnections();
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };

  const byId = (id: string): FakeWebhookEvent | undefined => api.events.find((e) => e.id === id);

  const answerDefault = async (
    route: FakeResendRoute,
    url: URL,
    response: ServerResponse,
  ): Promise<void> => {
    const segments = url.pathname.split('/');
    const eventId = segments[4] ?? '';
    switch (route) {
      case 'retrieveWebhook':
        send(response, 200, {
          object: 'webhook',
          id: segments[2],
          created_at: '2026-10-18T00:00:00.000Z',
          status: api.webhookStatus,
          endpoint: 'https://ingest.invalid/webhooks/resend',
          events: null,
          signing_secret: FAKE_SIGNING_SECRET,
        });
        return;
      case 'listEvents': {
        const limit = Math.min(Number(url.searchParams.get('limit') ?? '20'), PAGE_LIMIT_MAX);
        const after = url.searchParams.get('after');
        const ordered = [...api.events].sort(
          (a, b) => b.createdAt.getTime() - a.createdAt.getTime() || (a.id < b.id ? 1 : -1),
        );
        const start = after === null ? 0 : ordered.findIndex((e) => e.id === after) + 1;
        const page = ordered.slice(start, start + limit);
        send(response, 200, {
          object: 'list',
          has_more: start + limit < ordered.length,
          data: page.map((e) => ({
            id: e.id,
            type: e.type,
            created_at: e.createdAt.toISOString(),
            status: 'success',
          })),
        });
        return;
      }
      case 'retrieveEvent': {
        const event = byId(eventId);
        if (event === undefined) return send(response, 404, notFound);
        send(response, 200, {
          object: 'webhook_event',
          id: event.id,
          type: event.type,
          created_at: event.createdAt.toISOString(),
          status: 'success',
          next_attempt_at: null,
          payload: event.payload ?? { type: event.type, created_at: event.createdAt.toISOString() },
        });
        return;
      }
      case 'replayEvent': {
        if (byId(eventId) === undefined) return send(response, 404, notFound);
        await api.onReplay(eventId);
        send(response, 200, { object: 'webhook_event', id: eventId });
        return;
      }
      case 'sendEmail':
        emailCount += 1;
        send(response, 200, { id: `fake-email-${emailCount}` });
        return;
    }
  };

  const server = createServer((request, response) => {
    void (async () => {
      const url = new URL(request.url ?? '/', 'http://127.0.0.1');
      const method = request.method ?? 'GET';
      const body = await readBody(request);
      api.requests.push({
        method,
        path: url.pathname,
        userAgent: request.headers['user-agent'],
        idempotencyKey: request.headers['idempotency-key'] as string | undefined,
        body,
      });
      const route = routeOf(method, url.pathname);
      if (route === undefined) return send(response, 404, notFound);
      const scripted = scripts.get(route)?.shift();
      if (scripted !== undefined) {
        return send(response, scripted.status, scripted.body ?? {}, scripted.headers);
      }
      await answerDefault(route, url, response);
    })().catch(() => {
      if (!response.headersSent)
        send(response, 500, { statusCode: 500, name: 'application_error' });
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return Object.assign(api, { baseUrl: `http://127.0.0.1:${port}` });
}
