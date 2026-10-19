import type { IngestEnvelope } from '@ledger/core';
import {
  type ClockPort,
  errorFields,
  LedgerError,
  type Logger,
  type MetricsPort,
  type QueuePort,
  type SecretReaderPort,
} from '@ledger/shared';
import { Resend } from 'resend';
import {
  INGEST_BODY_OK,
  INGEST_BODY_UNAUTHORIZED,
  INGEST_BODY_UNAVAILABLE,
} from './ingest-bodies.ts';
import { signingSecretsSchema } from './signing-secrets.schema.ts';

// ADR-009, D13: a successfully read secret set is reused for at most 5 minutes per container, so an
// added or retired secret takes effect with no redeploy (RS-04).
export const SECRET_SET_TTL_MS = 300_000;

// D13: the Resend signing secrets are read through the port by id (Secrets Manager on AWS, the
// parsed `LEDGER_WEBHOOK_SECRETS` locally); the simulator secret stays typed config until slice 3
// (ADR-016), in the `whsec_` form `webhooks.verify` takes (RS-02).
export type IngestDeps = {
  secretReader: SecretReaderPort;
  signingSecretsId: string;
  simulatorSecret: string | undefined;
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
const unavailable: IngestResponse = { status: 503, body: INGEST_BODY_UNAVAILABLE };

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
export function createIngest({
  secretReader,
  signingSecretsId,
  simulatorSecret,
  queue,
  clock,
  logger,
  metrics,
}: IngestDeps) {
  // RS-02, D10: `webhooks.verify` lives on a `Resend` instance, and resend 6.33.0's constructor throws
  // `Missing API key` without one (or `RESEND_API_KEY`). Ingest holds no API key and makes no API
  // call, so the placeholder never reaches a request. Built once, at factory time.
  const resend = new Resend('ingest-verifies-only');

  // ADR-016: the Resend set in stored order first, then the simulator secret; the match sets
  // `source`, and only ingest sets it. A set with no secret at all would answer `401` to every
  // delivery, which tells Resend the secret is wrong; it is an infrastructure fault instead (D13).
  const readCandidates = async (): Promise<readonly Candidate[]> => {
    const resendSecrets = signingSecretsSchema.parse(await secretReader.read(signingSecretsId));
    const candidates: readonly Candidate[] = [
      ...resendSecrets.map((secret): Candidate => ({ secret, source: 'live' })),
      ...(simulatorSecret === undefined
        ? []
        : [{ secret: simulatorSecret, source: 'simulated' } satisfies Candidate]),
    ];
    if (candidates.length === 0) {
      throw new LedgerError('internal_error', 'The signing-secret set holds no secret.');
    }
    return candidates;
  };

  // D13: the last read, kept per container (one factory per container, built at module scope) and
  // stamped with the clock time it started. The pending read is shared, so concurrent requests
  // (local mode) read once. A failed read clears the entry instead of falling back: a failed refresh
  // never serves an expired set.
  let cached:
    | { readonly readAt: number; readonly candidates: Promise<readonly Candidate[]> }
    | undefined;
  const currentCandidates = (): Promise<readonly Candidate[]> => {
    const now = clock.now().getTime();
    if (cached !== undefined && now - cached.readAt < SECRET_SET_TTL_MS) return cached.candidates;
    const entry = { readAt: now, candidates: readCandidates() };
    cached = entry;
    entry.candidates.catch(() => {
      if (cached === entry) cached = undefined;
    });
    return entry.candidates;
  };

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

    // D13: an unreadable, unparseable or empty set answers `503`, which Resend retries (RS-10),
    // never `401`. Only the error's name is logged: a parse error must not reach a log line.
    let candidates: readonly Candidate[];
    try {
      candidates = await currentCandidates();
    } catch (error) {
      logger.error('ingest.secrets_unavailable', { error_name: errorFields(error).error_name });
      return unavailable;
    }

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
      return unavailable;
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
