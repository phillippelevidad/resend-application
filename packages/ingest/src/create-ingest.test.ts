// Ships 1 (slice 1), the Mandatory verify-before-enqueue tier: a forged, stale, unsigned or
// non-JSON request never reaches the queue port; `200` follows only a resolved enqueue; every
// configured secret verifies during a rotation (ADR-001, ADR-009, RS-04). Slice 2, Ships 2 and
// RS-U07 (D13, D43): the secret set is read through the port, cached 5 minutes, and an unreadable,
// unparseable or empty set answers `503`, never `401`. Time for `receivedAt` and the cache moves
// through `FakeClock`; `svix-timestamp` is wall-clock seconds, because `webhooks.verify` checks its
// 5-minute window against the wall clock (RS-02).
import { Buffer } from 'node:buffer';
import { type IngestEnvelope, ingestEnvelopeSchema } from '@ledger/core';
import { type SvixHeaders, signWebhook } from '@ledger/core/testing';
import { createLogger, InProcessQueueAdapter, type QueuePort } from '@ledger/shared';
import { FakeClock, FakeSecretReader, RecordingMetrics } from '@ledger/shared/testing';
import { describe, expect, it } from 'vitest';
import { createIngest, SECRET_SET_TTL_MS } from './create-ingest.ts';
import {
  INGEST_BODY_OK,
  INGEST_BODY_UNAUTHORIZED,
  INGEST_BODY_UNAVAILABLE,
  INGEST_CONTENT_TYPE,
} from './ingest-bodies.ts';

// Built at run time from a label, so no `whsec_` literal sits in the source (the gitleaks rule).
const testSecret = (label: string) =>
  `whsec_${Buffer.from(`ledger-ingest-test-${label}`).toString('base64')}`;
const oldSecret = testSecret('old');
const newSecret = testSecret('new');
const simulatorSecret = testSecret('simulator');
const unconfiguredSecret = testSecret('forger');

// What the stored set holds (`resend`, written to the fake store as the JSON array Secrets Manager
// holds, D13) and the simulator secret ingest takes as config.
type TestSecrets = { readonly resend: readonly string[]; readonly simulator: string | undefined };

const rotation: TestSecrets = { resend: [oldSecret, newSecret], simulator: undefined };
const signingSecretsId = 'ledger/webhook-signing-secrets';

const nowSeconds = () => Math.floor(Date.now() / 1000);

let lastId = 0;
const freshSvixId = () => {
  lastId += 1;
  return `msg_ingest_${lastId}`;
};

const eventBody = (type = 'email.delivered') =>
  JSON.stringify({
    type,
    created_at: '2026-10-17T12:00:01.000Z',
    data: { email_id: 'e_ingest', to: ['delivered@resend.dev'], subject: 'Order confirmation' },
  });

const signed = (
  secret: string,
  body = eventBody(),
  { svixId = freshSvixId(), timestamp = nowSeconds() } = {},
): { rawBody: string; headers: SvixHeaders } => ({
  rawBody: body,
  headers: signWebhook({ secret, svixId, timestamp, body }),
});

// One macrotask turn lets the in-process queue deliver everything waiting (its pump runs on
// promise callbacks only).
const settle = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

// The real slice 1 queue (pp-testing → fakes: the queue port's double is the in-process queue),
// drained by a consumer that keeps each body as SQS would hold it; or, for the `503` path, a queue
// whose `enqueue` rejects.
const harness = (secrets: TestSecrets, queueOverride?: QueuePort) => {
  const clock = new FakeClock('2026-10-17T12:00:05.000Z');
  const secretReader = new FakeSecretReader({
    [signingSecretsId]: JSON.stringify(secrets.resend),
  });
  const lines: string[] = [];
  const logger = createLogger({
    functionName: 'ingest',
    stream: { write: (chunk: string) => lines.push(chunk) },
  });
  const metrics = new RecordingMetrics();
  const queue = new InProcessQueueAdapter({
    clock,
    logger: createLogger({ functionName: 'queue', stream: { write: () => undefined } }),
    sleep: clock.sleep,
  });
  const bodies: string[] = [];
  queue.start(async (messages) => {
    bodies.push(...messages.map((message) => message.body));
    return { batchItemFailures: [] };
  });
  const ingest = createIngest({
    secretReader,
    signingSecretsId,
    simulatorSecret: secrets.simulator,
    queue: queueOverride ?? queue,
    clock,
    logger,
    metrics,
  });
  const queued = async (): Promise<Record<string, unknown>[]> => {
    await settle();
    return bodies.map((body) => JSON.parse(body) as Record<string, unknown>);
  };
  const logged = () => lines.map((line) => JSON.parse(line) as Record<string, unknown>);
  return { clock, ingest, logged, metrics, queued, secretReader };
};

const rejectingQueue: QueuePort = {
  enqueue: () => Promise.reject(new TypeError('queue unreachable: delivered@resend.dev')),
};

describe('createIngest', () => {
  describe('rotation: every configured secret verifies, first match wins', () => {
    it('accepts a delivery signed by the old secret only and enqueues it', async () => {
      const { ingest, queued } = harness(rotation);
      const request = signed(oldSecret);

      const response = await ingest(request);

      expect(response).toEqual({ status: 200, body: INGEST_BODY_OK });
      expect((await queued()).map((envelope) => envelope.svixId)).toEqual([
        request.headers['svix-id'],
      ]);
    });

    it('accepts a delivery signed by the new secret only and enqueues it', async () => {
      const { ingest, queued } = harness(rotation);
      const request = signed(newSecret);

      const response = await ingest(request);

      expect(response).toEqual({ status: 200, body: INGEST_BODY_OK });
      expect((await queued()).map((envelope) => envelope.svixId)).toEqual([
        request.headers['svix-id'],
      ]);
    });

    it('accepts one svix-signature header carrying both v1 signatures (RS-03, RS-04)', async () => {
      const { ingest, queued } = harness(rotation);
      const body = eventBody();
      const svixId = freshSvixId();
      const timestamp = nowSeconds();
      const byOld = signWebhook({ secret: oldSecret, svixId, timestamp, body });
      const byNew = signWebhook({ secret: newSecret, svixId, timestamp, body });

      const response = await ingest({
        rawBody: body,
        headers: {
          ...byOld,
          'svix-signature': `${byOld['svix-signature']} ${byNew['svix-signature']}`,
        },
      });

      expect(response).toEqual({ status: 200, body: INGEST_BODY_OK });
      expect(await queued()).toHaveLength(1);
    });
  });

  describe('rejection: 401, nothing enqueued', () => {
    it('rejects a delivery signed with a secret that is not configured', async () => {
      const { ingest, queued } = harness(rotation);

      const response = await ingest(signed(unconfiguredSecret));

      expect(response).toEqual({ status: 401, body: INGEST_BODY_UNAUTHORIZED });
      expect(await queued()).toEqual([]);
    });

    it('rejects a correctly signed delivery whose svix-timestamp is 6 minutes old (RS-02)', async () => {
      const { ingest, queued } = harness(rotation);

      const response = await ingest(
        signed(oldSecret, eventBody(), { timestamp: nowSeconds() - 360 }),
      );

      expect(response).toEqual({ status: 401, body: INGEST_BODY_UNAUTHORIZED });
      expect(await queued()).toEqual([]);
    });

    it.each(['svix-id', 'svix-timestamp', 'svix-signature'] as const)(
      'rejects a signed delivery missing the %s header',
      async (header) => {
        const { ingest, queued } = harness(rotation);
        const request = signed(oldSecret);
        const headers = { ...request.headers, [header]: undefined };

        const response = await ingest({ rawBody: request.rawBody, headers });

        expect(response).toEqual({ status: 401, body: INGEST_BODY_UNAUTHORIZED });
        expect(await queued()).toEqual([]);
      },
    );

    it('rejects a delivery whose body changed by one byte after signing (RS-01)', async () => {
      const { ingest, queued } = harness(rotation);
      const request = signed(oldSecret);

      const response = await ingest({
        ...request,
        rawBody: request.rawBody.replace('e_ingest', 'e_ingesu'),
      });

      expect(response).toEqual({ status: 401, body: INGEST_BODY_UNAUTHORIZED });
      expect(await queued()).toEqual([]);
    });

    it('rejects a correctly signed body that is not JSON (D11)', async () => {
      const { ingest, queued } = harness(rotation);

      const response = await ingest(signed(oldSecret, 'not json {'));

      expect(response).toEqual({ status: 401, body: INGEST_BODY_UNAUTHORIZED });
      expect(await queued()).toEqual([]);
    });

    it('rejects a correctly signed empty body, which verify returns without parsing', async () => {
      const { ingest, queued } = harness(rotation);

      const response = await ingest(signed(oldSecret, ''));

      expect(response).toEqual({ status: 401, body: INGEST_BODY_UNAUTHORIZED });
      expect(await queued()).toEqual([]);
    });

    it('logs one ingest.request_rejected line with no field, never the unverified svix-id', async () => {
      const { ingest, logged } = harness(rotation);
      const request = signed(unconfiguredSecret);

      await ingest(request);

      expect(logged()).toEqual([
        {
          level: 'warn',
          timestamp: expect.any(String),
          function_name: 'ingest',
          message: 'ingest.request_rejected',
        },
      ]);
      expect(JSON.stringify(logged())).not.toContain(request.headers['svix-id']);
    });
  });

  describe('enqueue: 200 only after it resolved', () => {
    it('answers only once the enqueue has resolved', async () => {
      let release: () => void = () => undefined;
      const heldQueue: QueuePort = {
        enqueue: () => new Promise<void>((resolve) => (release = resolve)),
      };
      const { ingest } = harness(rotation, heldQueue);
      let answered = false;

      const pending = ingest(signed(oldSecret)).then((response) => {
        answered = true;
        return response;
      });
      await settle();
      expect(answered).toBe(false);
      release();

      expect(await pending).toEqual({ status: 200, body: INGEST_BODY_OK });
    });

    it('answers 503 when the enqueue rejects, logging only the svix_id and the error name', async () => {
      const { ingest, logged, metrics } = harness(rotation, rejectingQueue);
      const request = signed(oldSecret);

      const response = await ingest(request);

      expect(response).toEqual({ status: 503, body: INGEST_BODY_UNAVAILABLE });
      expect(logged()).toEqual([
        {
          level: 'error',
          timestamp: expect.any(String),
          function_name: 'ingest',
          message: 'ingest.enqueue_failed',
          svix_id: request.headers['svix-id'],
          error_name: 'TypeError',
        },
      ]);
      expect(metrics.recorded).toEqual([]);
    });
  });

  describe('the envelope', () => {
    it('stamps source live for a Resend secret and simulated for the simulator secret', async () => {
      const { ingest, queued } = harness({ resend: [newSecret], simulator: simulatorSecret });
      const live = signed(newSecret);
      const simulated = signed(simulatorSecret);

      await ingest(live);
      await ingest(simulated);

      const bySvixId = new Map((await queued()).map((envelope) => [envelope.svixId, envelope]));
      expect(bySvixId.get(live.headers['svix-id'])?.source).toBe('live');
      expect(bySvixId.get(simulated.headers['svix-id'])?.source).toBe('simulated');
    });

    it('carries the raw body byte for byte, the clock time and svix-timestamp, and no signature', async () => {
      const { clock, ingest, queued } = harness(rotation);
      // Key order and spacing a re-serialization would change (RS-01).
      const body = '{ "type":"email.sent",  "data":{"to":["delivered@resend.dev"]}}';
      const request = signed(oldSecret, body);

      await ingest(request);

      const [envelope] = await queued();
      expect(envelope).toEqual({
        svixId: request.headers['svix-id'],
        receivedAt: clock.now().toISOString(),
        source: 'live',
        rawBody: body,
        headers: { 'svix-timestamp': request.headers['svix-timestamp'] },
      } satisfies IngestEnvelope);
      expect(ingestEnvelopeSchema.safeParse(envelope).success).toBe(true);
      expect(JSON.stringify(envelope)).not.toContain(request.headers['svix-signature'].slice(3));
    });
  });

  describe('accepted deliveries are counted', () => {
    it('emits ingest.accepted with the svix_id and the payload type', async () => {
      const { ingest, metrics } = harness(rotation);
      const request = signed(oldSecret, eventBody('email.bounced'));

      await ingest(request);

      expect(metrics.recorded).toEqual([
        {
          kind: 'count',
          name: 'ingest.accepted',
          value: 1,
          fields: { svix_id: request.headers['svix-id'], type: 'email.bounced' },
        },
      ]);
    });

    it.each([
      ['null', 'null'],
      ['an array', '[]'],
    ])('accepts and enqueues a signed %s payload, counted with no type (D9)', async (_, body) => {
      const { ingest, metrics, queued } = harness(rotation);
      const request = signed(oldSecret, body);

      const response = await ingest(request);

      expect(response).toEqual({ status: 200, body: INGEST_BODY_OK });
      expect((await queued()).map((envelope) => envelope.rawBody)).toEqual([body]);
      expect(metrics.recorded).toEqual([
        {
          kind: 'count',
          name: 'ingest.accepted',
          value: 1,
          fields: { svix_id: request.headers['svix-id'] },
        },
      ]);
    });
  });

  describe('the secret set: 503, never 401, when it cannot be read or holds no secret (D13, D43)', () => {
    it.each([
      [
        'the secret read rejects',
        rotation,
        (reader: FakeSecretReader) => {
          reader.failing = true;
        },
        'FakeFailure',
      ],
      [
        'the stored value is not JSON',
        rotation,
        (reader: FakeSecretReader) => {
          reader.secrets.set(signingSecretsId, 'not json [');
        },
        'ZodError',
      ],
      [
        'a stored entry lacks the whsec_ prefix',
        rotation,
        (reader: FakeSecretReader) => {
          reader.secrets.set(signingSecretsId, JSON.stringify([oldSecret.slice('whsec_'.length)]));
        },
        'ZodError',
      ],
      [
        'the stored list is empty and no simulator secret is configured',
        { resend: [], simulator: undefined },
        () => undefined,
        'LedgerError',
      ],
    ] as const)(
      'answers 503 unavailable when %s, enqueues nothing and logs the error name only',
      async (_, secrets, breakStore, errorName) => {
        const { ingest, logged, metrics, queued, secretReader } = harness(secrets);
        breakStore(secretReader);

        const response = await ingest(signed(oldSecret));

        expect(response).toEqual({ status: 503, body: INGEST_BODY_UNAVAILABLE });
        expect(await queued()).toEqual([]);
        expect(logged()).toEqual([
          {
            level: 'error',
            timestamp: expect.any(String),
            function_name: 'ingest',
            message: 'ingest.secrets_unavailable',
            error_name: errorName,
          },
        ]);
        expect(metrics.recorded).toEqual([]);
      },
    );

    it('accepts a simulator-signed delivery when the stored list is empty but the simulator secret is set', async () => {
      const { ingest, queued } = harness({ resend: [], simulator: simulatorSecret });

      const response = await ingest(signed(simulatorSecret));

      expect(response).toEqual({ status: 200, body: INGEST_BODY_OK });
      expect(await queued()).toHaveLength(1);
    });
  });

  describe('the secret set is cached for 5 minutes, then read again (ADR-009, D13)', () => {
    const minutes = (count: number) => count * 60_000;

    it('reads the set once for two requests 4 minutes apart', async () => {
      const { clock, ingest, secretReader } = harness(rotation);

      const first = await ingest(signed(oldSecret));
      clock.advance(minutes(4));
      const second = await ingest(signed(newSecret));

      expect([first.status, second.status]).toEqual([200, 200]);
      expect(secretReader.reads).toBe(1);
    });

    it('reads the set again 5 minutes after the last read, so a secret added in between verifies', async () => {
      const { clock, ingest, secretReader } = harness(rotation);
      const addedSecret = testSecret('added');

      await ingest(signed(oldSecret));
      secretReader.secrets.set(signingSecretsId, JSON.stringify([oldSecret, addedSecret]));
      clock.advance(minutes(4));
      const withinWindow = await ingest(signed(addedSecret));
      clock.advance(SECRET_SET_TTL_MS - minutes(4));
      const afterWindow = await ingest(signed(addedSecret));

      expect(withinWindow).toEqual({ status: 401, body: INGEST_BODY_UNAUTHORIZED });
      expect(afterWindow).toEqual({ status: 200, body: INGEST_BODY_OK });
      expect(secretReader.reads).toBe(2);
    });

    it('answers 503 when the expired set fails to refresh, even for a request the old set verifies', async () => {
      const { clock, ingest, queued, secretReader } = harness(rotation);

      const before = await ingest(signed(oldSecret));
      clock.advance(SECRET_SET_TTL_MS);
      secretReader.failing = true;
      const request = signed(oldSecret);
      const after = await ingest(request);

      expect(before).toEqual({ status: 200, body: INGEST_BODY_OK });
      expect(after).toEqual({ status: 503, body: INGEST_BODY_UNAVAILABLE });
      expect((await queued()).map((envelope) => envelope.svixId)).not.toContain(
        request.headers['svix-id'],
      );
      expect(secretReader.reads).toBe(2);
    });
  });

  it('answers only the three fixed bodies, as text/plain (D11, RS-12)', async () => {
    const accepted = await harness(rotation).ingest(signed(oldSecret));
    const rejected = await harness(rotation).ingest(signed(unconfiguredSecret));
    const unavailable = await harness(rotation, rejectingQueue).ingest(signed(oldSecret));

    expect([accepted.body, rejected.body, unavailable.body]).toEqual([
      'ok',
      'unauthorized',
      'unavailable',
    ]);
    expect(INGEST_CONTENT_TYPE).toBe('text/plain; charset=utf-8');
  });
});
