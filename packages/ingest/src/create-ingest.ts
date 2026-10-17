import type { IngestEnvelope } from '@ledger/core';
import {
  type ClockPort,
  errorFields,
  type Logger,
  type MetricsPort,
  type QueuePort,
} from '@ledger/shared';
import { Resend } from 'resend';
import {
  INGEST_BODY_OK,
  INGEST_BODY_UNAUTHORIZED,
  INGEST_BODY_UNAVAILABLE,
} from './ingest-bodies.ts';

// D9: the signing secrets, in the `whsec_` form `webhooks.verify` takes (RS-02). Typed config the
// composition root parsed; at least one overall is asserted at boot (D29).
export type IngestSecrets = {
  readonly resend: readonly string[];
  readonly simulator: string | undefined;
};

export type IngestDeps = {
  secrets: IngestSecrets;
  queue: QueuePort;
  clock: ClockPort;
  logger: Logger;
  metrics: MetricsPort;
};

// The three Svix headers, lowercase, as the runtime adapter read them. An absent one is `undefined`.
export type IngestRequest = {
  readonly rawBody: string;
  readonly headers: {
    readonly 'svix-id'?: string | undefined;
    readonly 'svix-timestamp'?: string | undefined;
    readonly 'svix-signature'?: string | undefined;
  };
};

// D9, D11: the body is one of the fixed constants; the adapter adds `INGEST_CONTENT_TYPE`.
export type IngestResponse = { readonly status: 200 | 401 | 503; readonly body: string };

type Candidate = { readonly secret: string; readonly source: IngestEnvelope['source'] };

const unauthorized: IngestResponse = { status: 401, body: INGEST_BODY_UNAUTHORIZED };

// D9 step 6: `type` rides on the metric only when the verified payload is a plain object holding a
// string `type`. Any other JSON value is still accepted: the ledger stores it raw (ADR-004, D17).
const typeOf = (payload: unknown): string | undefined => {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) return undefined;
  const { type } = payload as { type?: unknown };
  return typeof type === 'string' ? type : undefined;
};

// ADR-001: verify, then enqueue, then answer; `200` only after the enqueue resolved. ADR-009: every
// configured secret is tried, first match wins, so a rotation drops nothing (RS-04). Ingest never
// touches the database.
export function createIngest({ secrets, queue, clock, logger, metrics }: IngestDeps) {
  // RS-02, D10: `webhooks.verify` lives on a `Resend` instance, and resend 6.33.0's constructor throws
  // `Missing API key` without one (or `RESEND_API_KEY`). Ingest holds no API key and makes no API
  // call, so the placeholder never reaches a request. Built once, at factory time.
  const resend = new Resend('ingest-verifies-only');

  // ADR-016: the Resend set in configured order first, then the simulator secret; the match sets
  // `source`, and only ingest sets it.
  const candidates: readonly Candidate[] = [
    ...secrets.resend.map((secret): Candidate => ({ secret, source: 'live' })),
    ...(secrets.simulator === undefined
      ? []
      : [{ secret: secrets.simulator, source: 'simulated' } satisfies Candidate]),
  ];

  // D9 step 3: one constant line, no fields. The `svix-id` of an unverified request is
  // attacker-controlled, so it is never logged.
  const reject = (): IngestResponse => {
    logger.warn('ingest.request_rejected');
    return unauthorized;
  };

  return async (request: IngestRequest): Promise<IngestResponse> => {
    const svixId = request.headers['svix-id'];
    const timestamp = request.headers['svix-timestamp'];
    const signature = request.headers['svix-signature'];
    // D9 step 1. An empty header counts as missing, as `webhooks.verify` itself treats it.
    if (!svixId || !timestamp || !signature) return reject();

    // D9 step 2: one `verify` per secret (one secret per call, resend.md → Constraint 12). It checks
    // the signature over the raw body and the 5-minute timestamp window, then parses the body
    // (RS-02); any throw is no match. A signed empty body is the one input it returns `undefined`
    // for without parsing: not JSON, so no match either.
    let matched: { source: IngestEnvelope['source']; payload: unknown } | undefined;
    for (const { secret, source } of candidates) {
      try {
        const payload: unknown = resend.webhooks.verify({
          payload: request.rawBody,
          headers: { id: svixId, timestamp, signature },
          webhookSecret: secret,
        });
        if (payload === undefined) continue;
        matched = { source, payload };
        break;
      } catch {
        // No match under this secret (D9 step 2): the next one is tried, and none left is a `401`.
      }
    }
    if (matched === undefined) return reject();

    // D9 step 4, D12: the raw body byte for byte (RS-01); `svix-signature` is not carried.
    const envelope: IngestEnvelope = {
      svixId,
      receivedAt: clock.now().toISOString(),
      source: matched.source,
      rawBody: request.rawBody,
      headers: { 'svix-timestamp': timestamp },
    };

    // D9 step 5: a failed enqueue answers `503`, so Resend retries the delivery (RS-10).
    try {
      await queue.enqueue(envelope);
    } catch (error) {
      logger.error('ingest.enqueue_failed', {
        svix_id: svixId,
        error_name: errorFields(error).error_name,
      });
      return { status: 503, body: INGEST_BODY_UNAVAILABLE };
    }

    // D9 step 6.
    const type = typeOf(matched.payload);
    metrics.count(
      'ingest.accepted',
      1,
      type === undefined ? { svix_id: svixId } : { svix_id: svixId, type },
    );
    return { status: 200, body: INGEST_BODY_OK };
  };
}
