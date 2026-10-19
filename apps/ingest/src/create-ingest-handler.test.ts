// Slice 2, Ships 2 (R1, R4) and AWS-U12: the Lambda adapter decodes a base64 body to its exact bytes
// before verifying, so one signed request answers the same in either encoding (RS-01, AWS-U04 safe
// either way); a forged one never reaches the queue port in either (ADR-001); the answer is one of
// ingest's fixed bodies; anything thrown leaves as a constant `internal_error` with no `cause`. The
// real `createIngest` runs over the in-process queue and `FakeSecretReader`; no AWS client and no
// environment are involved, because `main.ts` is never imported.
import { Buffer } from 'node:buffer';
import { errorRegistry } from '@ledger/core';
import { signWebhook } from '@ledger/core/testing';
import { createIngest } from '@ledger/ingest';
import {
  ConfigError,
  createLogger,
  InProcessQueueAdapter,
  LedgerError,
  loadConfig,
  type QueuePort,
} from '@ledger/shared';
import { FakeClock, FakeSecretReader, RecordingMetrics } from '@ledger/shared/testing';
import { describe, expect, it } from 'vitest';
import {
  createIngestHandler,
  type HttpApiEvent,
  type InvocationFields,
} from './create-ingest-handler.ts';
import { ingestConfigSchema } from './ingest.config.ts';

// Built at run time from a label, so no `whsec_` literal sits in the source (the gitleaks rule).
const testSecret = (label: string) =>
  `whsec_${Buffer.from(`ledger-ingest-handler-test-${label}`).toString('base64')}`;
const secret = testSecret('configured');
const forger = testSecret('forger');
const signingSecretsId = 'ledger/webhook-signing-secrets';

// RS-02: `webhooks.verify` checks the window against the wall clock, so the signer reads it too.
const nowSeconds = () => Math.floor(Date.now() / 1000);

let lastId = 0;
const freshSvixId = () => {
  lastId += 1;
  return `msg_ingest_handler_${lastId}`;
};

// Non-ASCII bytes and spacing a lossy decode or a re-serialization would change (RS-01).
const body = JSON.stringify({
  type: 'email.delivered',
  created_at: '2026-10-17T12:00:01.000Z',
  data: { email_id: 'e_handler', to: ['delivered@resend.dev'], subject: 'Olá — confirmação ✓' },
});

const signedEvent = (
  signer: string,
  { encoded }: { encoded: boolean },
): { event: HttpApiEvent; svixId: string } => {
  const svixId = freshSvixId();
  const headers = signWebhook({ secret: signer, svixId, timestamp: nowSeconds(), body });
  return {
    svixId,
    event: {
      body: encoded ? Buffer.from(body, 'utf8').toString('base64') : body,
      isBase64Encoded: encoded,
      headers: { ...headers, 'content-type': 'application/json', 'user-agent': 'Svix-Webhooks' },
    },
  };
};

let lastRequest = 0;
const lambdaContext = () => {
  lastRequest += 1;
  return { awsRequestId: `req-${lastRequest}` };
};

const settle = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

const harness = (queueOverride?: QueuePort) => {
  const clock = new FakeClock('2026-10-17T12:00:05.000Z');
  const lines: string[] = [];
  const invocation: InvocationFields = { request_id: undefined, cold_start: true };
  const logger = createLogger({
    functionName: 'ingest',
    stream: { write: (chunk: string) => lines.push(chunk) },
    context: () => invocation,
  });
  const queue = new InProcessQueueAdapter({
    clock,
    logger: createLogger({ functionName: 'queue', stream: { write: () => undefined } }),
    sleep: clock.sleep,
  });
  const envelopes: Record<string, unknown>[] = [];
  queue.start(async (messages) => {
    envelopes.push(...messages.map((message) => JSON.parse(message.body)));
    return { batchItemFailures: [] };
  });
  const ingest = createIngest({
    secretReader: new FakeSecretReader({ [signingSecretsId]: JSON.stringify([secret]) }),
    signingSecretsId,
    simulatorSecretId: undefined,
    queue: queueOverride ?? queue,
    clock,
    logger,
    metrics: new RecordingMetrics(),
  });
  const handler = createIngestHandler({ ingest, logger, invocation });
  const queued = async () => {
    await settle();
    return envelopes;
  };
  const logged = () => lines.map((line) => JSON.parse(line) as Record<string, unknown>);
  return { handler, logged, logger, invocation, queued };
};

const answer = (statusCode: number, text: string) => ({
  statusCode,
  headers: { 'content-type': 'text/plain; charset=utf-8' },
  body: text,
  isBase64Encoded: false,
});

describe('createIngestHandler', () => {
  describe('both body encodings verify identically', () => {
    it.each([
      ['plain', false],
      ['base64-encoded', true],
    ])('answers 200 ok to a signed %s body and enqueues its exact bytes', async (_, encoded) => {
      const { handler, queued } = harness();
      const { event, svixId } = signedEvent(secret, { encoded });

      const result = await handler(event, lambdaContext());

      expect(result).toEqual(answer(200, 'ok'));
      expect(await queued()).toEqual([expect.objectContaining({ svixId, rawBody: body })]);
    });

    it('enqueues byte-identical raw bodies for the same request sent in both encodings', async () => {
      const { handler, queued } = harness();
      const plain = signedEvent(secret, { encoded: false });
      const encoded = signedEvent(secret, { encoded: true });

      await handler(plain.event, lambdaContext());
      await handler(encoded.event, lambdaContext());

      const rawBodies = (await queued()).map((envelope) => envelope.rawBody);
      expect(rawBodies).toHaveLength(2);
      expect(rawBodies[0]).toBe(rawBodies[1]);
      expect(Buffer.from(String(rawBodies[1]), 'utf8').equals(Buffer.from(body, 'utf8'))).toBe(
        true,
      );
    });

    it.each([
      ['plain', false],
      ['base64-encoded', true],
    ])('answers 401 unauthorized to a forged %s body and enqueues nothing', async (_, encoded) => {
      const { handler, queued } = harness();

      const result = await handler(signedEvent(forger, { encoded }).event, lambdaContext());

      expect(result).toEqual(answer(401, 'unauthorized'));
      expect(await queued()).toEqual([]);
    });

    it('answers 401 to a request with no body and no headers, and enqueues nothing', async () => {
      const { handler, queued } = harness();

      const result = await handler({ isBase64Encoded: false }, lambdaContext());

      expect(result).toEqual(answer(401, 'unauthorized'));
      expect(await queued()).toEqual([]);
    });
  });

  it('answers 503 unavailable when the enqueue rejects', async () => {
    const rejectingQueue: QueuePort = {
      enqueue: () => Promise.reject(new TypeError('SendMessage failed')),
    };
    const { handler } = harness(rejectingQueue);

    const result = await handler(signedEvent(secret, { encoded: true }).event, lambdaContext());

    expect(result).toEqual(answer(503, 'unavailable'));
  });

  it.each([
    [false, 0],
    [true, 1],
  ])(
    'logs one ingest.request_decoded line (isBase64Encoded %s → body_base64_count %i) and no request data',
    async (encoded, count) => {
      const { handler, logged } = harness();
      const { event, svixId } = signedEvent(secret, { encoded });
      const context = lambdaContext();

      await handler(event, context);

      const decoded = logged().filter((line) => line.message === 'ingest.request_decoded');
      expect(decoded).toEqual([
        {
          level: 'info',
          timestamp: expect.any(String),
          function_name: 'ingest',
          message: 'ingest.request_decoded',
          request_id: context.awsRequestId,
          cold_start: true,
          body_base64_count: count,
        },
      ]);
      expect(JSON.stringify(decoded)).not.toContain(svixId);
    },
  );

  it('marks only the first invocation of a container as a cold start, with each request id (D6)', async () => {
    const { handler, logged } = harness();
    const first = lambdaContext();
    const second = lambdaContext();

    await handler(signedEvent(secret, { encoded: false }).event, first);
    await handler(signedEvent(secret, { encoded: false }).event, second);

    expect(
      logged()
        .filter((line) => line.message === 'ingest.request_decoded')
        .map((line) => [line.request_id, line.cold_start]),
    ).toEqual([
      [first.awsRequestId, true],
      [second.awsRequestId, false],
    ]);
  });

  it('rethrows anything ingest throws as a constant internal_error with no cause, logged by name only', async () => {
    const lines: string[] = [];
    const invocation: InvocationFields = { request_id: undefined, cold_start: true };
    const logger = createLogger({
      functionName: 'ingest',
      stream: { write: (chunk: string) => lines.push(chunk) },
      context: () => invocation,
    });
    const handler = createIngestHandler({
      ingest: () => Promise.reject(new RangeError('payload quoted: delivered@resend.dev')),
      logger,
      invocation,
    });
    const context = lambdaContext();

    const thrown = await handler(signedEvent(secret, { encoded: false }).event, context).catch(
      (error: unknown) => error,
    );

    expect(thrown).toBeInstanceOf(LedgerError);
    expect(thrown).toMatchObject({
      code: 'internal_error',
      message: errorRegistry.internal_error.message,
    });
    expect((thrown as LedgerError).cause).toBeUndefined();
    const failures = lines
      .map((line) => JSON.parse(line) as Record<string, unknown>)
      .filter((line) => line.level === 'error');
    expect(failures).toEqual([
      {
        level: 'error',
        timestamp: expect.any(String),
        function_name: 'ingest',
        message: 'ingest.internal_error',
        request_id: context.awsRequestId,
        cold_start: true,
        error_name: 'RangeError',
      },
    ]);
    expect(lines.join('')).not.toContain('delivered@resend.dev');
  });
});

// D12, D13: `main.ts` passes `simulatorSecretArn` as ingest's `simulatorSecretId`, so its absence is
// what makes a simulator-signed request answer `401` on a stack deployed without the simulator.
describe('ingestConfigSchema', () => {
  const required = {
    SIGNING_SECRETS_ARN: 'test/webhook-signing-secrets',
    QUEUE_URL: 'http://127.0.0.1:9324/ledger-queue',
  };

  it('parses with no SIMULATOR_SECRET_ARN as no simulator secret id', () => {
    expect(loadConfig(ingestConfigSchema, required)).toEqual({
      signingSecretsArn: 'test/webhook-signing-secrets',
      queueUrl: 'http://127.0.0.1:9324/ledger-queue',
      simulatorSecretArn: undefined,
    });
  });

  it('parses SIMULATOR_SECRET_ARN, when set, as the simulator secret id', () => {
    const config = loadConfig(ingestConfigSchema, {
      ...required,
      SIMULATOR_SECRET_ARN: 'test/simulator-signing-secret',
    });

    expect(config.simulatorSecretArn).toBe('test/simulator-signing-secret');
  });

  it('refuses an empty SIMULATOR_SECRET_ARN, naming the variable and not its value', () => {
    const failure = (() => {
      try {
        loadConfig(ingestConfigSchema, { ...required, SIMULATOR_SECRET_ARN: '' });
      } catch (error) {
        return error;
      }
      return undefined;
    })();

    expect(failure).toBeInstanceOf(ConfigError);
    expect((failure as ConfigError).issues.map((issue) => issue.variable)).toEqual([
      'SIMULATOR_SECRET_ARN',
    ]);
  });
});
