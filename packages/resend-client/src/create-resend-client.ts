import type { ClockPort, Logger } from '@ledger/shared';
import { Resend } from 'resend';
import { Limiter } from './limiter.ts';
import { mapResendError, type ResendMethodKind } from './map-resend-error.ts';
import { registryError } from './registry-error.ts';

// Slice 4 D9: one request's own bound, so a hung connection reads as a network failure (D11).
export const RESEND_REQUEST_TIMEOUT_MS = 10_000;

// D11: a `5xx` or a network failure is retried twice more, after these waits.
const RETRY_BACKOFF_MS = [1_000, 2_000] as const;

// Every method's last argument: the caller's deadline, past which no wait starts (D10).
export type CallOptions = { readonly deadline: Date };

export type ListedWebhookEvent = {
  readonly id: string;
  readonly type: string;
  readonly createdAt: Date;
};

export type ListedWebhookEvents = {
  readonly hasMore: boolean;
  readonly events: readonly ListedWebhookEvent[];
};

export type SendEmailInput = {
  readonly from: string;
  readonly to: string;
  readonly subject: string;
  readonly text: string;
};

// D12: a `401`, `403` or `409` from Send Email goes back to its caller by status and name.
export type SendEmailOutcome =
  | { readonly emailId: string }
  | { readonly rejected: { readonly status: number; readonly name: string } };

// Only the operations Ledger's callers need, each named (ADR-012): the reconciler's three, and the
// gap drill's Retrieve Event and Send Email (slice 6's dispatcher reuses Send Email).
export interface ResendClient {
  retrieveWebhook(
    webhookId: string,
    opts: CallOptions,
  ): Promise<{ status: 'enabled' | 'disabled' }>;
  listWebhookEvents(
    webhookId: string,
    page: { readonly after?: string | undefined },
    opts: CallOptions,
  ): Promise<ListedWebhookEvents>;
  replayWebhookEvent(webhookId: string, eventId: string, opts: CallOptions): Promise<void>;
  retrieveWebhookEventCreatedAt(
    webhookId: string,
    eventId: string,
    opts: CallOptions,
  ): Promise<{ createdAt: Date }>;
  sendEmail(
    email: SendEmailInput,
    request: { readonly idempotencyKey: string },
    opts: CallOptions,
  ): Promise<SendEmailOutcome>;
}

export type CreateResendClientDeps = {
  // Read through the secret port by the root; never logged, thrown or returned (integrations.md
  // rule 7).
  apiKey: string;
  // Explicit, so the SDK never reads `RESEND_BASE_URL` (pp-backend → resend-client).
  baseUrl: string;
  // `ledger-reconciler` or `ledger-gap-drill` (RS-21).
  userAgent: string;
  clock: ClockPort;
  sleep: (ms: number) => Promise<void>;
  logger: Logger;
  ratePerSecond?: number;
};

// The SDK's response, as every method returns it (RS-23): it never throws on an HTTP error.
type SdkResponse<T> = {
  data: T | null;
  error: { statusCode: number | null; name: string; message: string } | null;
  headers: Record<string, string> | null;
};

type Attempt<T> = {
  readonly status: number | null;
  readonly name: string | undefined;
  readonly headers: Readonly<Record<string, string>> | null;
  readonly response: SdkResponse<T>;
};

const isRetryable = (status: number | null): boolean => status === null || status >= 500;

const NETWORK_FAILURE = {
  statusCode: null,
  name: 'application_error',
  message: 'network failure',
} as const;

// Slice 4 D9–D12, ADR-012: the only Resend API caller. Every response is checked: `429` through the
// limiter, `5xx` and network failures retried then `resend_unavailable`, the rest mapped by status
// then name. Resend's body never becomes a message, a cause or a log value.
export function createResendClient({
  apiKey,
  baseUrl,
  userAgent,
  clock,
  sleep,
  logger,
  ratePerSecond = 2,
}: CreateResendClientDeps): ResendClient {
  const sdk = new Resend(apiKey, { baseUrl, userAgent });
  // PP C9: the SDK `console.error`s every error body unless `NODE_ENV` is `production`; the body can
  // quote the request. Shadowed on the instance; `create-resend-client.test.ts` fails if a version
  // bump renames the method.
  Reflect.defineProperty(sdk, 'logError', { value: () => {} });
  const limiter = new Limiter({ clock, sleep, ratePerSecond });

  // One request through the limiter. A throw from the SDK (an abort while it read an error body)
  // reads as a network failure.
  const attempt = async <T>(
    call: (signal: AbortSignal) => Promise<SdkResponse<T>>,
    deadline: Date,
  ): Promise<Attempt<T>> =>
    limiter.run(async () => {
      let response: SdkResponse<T>;
      try {
        response = await call(AbortSignal.timeout(RESEND_REQUEST_TIMEOUT_MS));
      } catch {
        response = { data: null, error: { ...NETWORK_FAILURE }, headers: null };
      }
      return {
        status: response.error === null ? 200 : response.error.statusCode,
        name: response.error?.name,
        headers: response.headers,
        response,
      };
    }, deadline);

  // D11: a `5xx` or a network failure, retried twice after 1 s then 2 s, each wait inside the
  // deadline; then `resend_unavailable`.
  const withRetries = async <T>(
    call: (signal: AbortSignal) => Promise<SdkResponse<T>>,
    deadline: Date,
  ): Promise<SdkResponse<T>> => {
    for (let retry = 0; ; retry += 1) {
      const { status, response } = await attempt(call, deadline);
      if (!isRetryable(status)) return response;
      const backoff = RETRY_BACKOFF_MS[retry];
      if (backoff === undefined || clock.now().getTime() + backoff > deadline.getTime()) {
        throw registryError('resend_unavailable');
      }
      await sleep(backoff);
    }
  };

  // D12: a failure to its registry code; the default branch logged once by name, never by message.
  const fail = (
    error: NonNullable<SdkResponse<unknown>['error']>,
    method: ResendMethodKind,
  ): never => {
    const outcome = mapResendError(
      { status: error.statusCode, name: error.name, message: error.message },
      method,
    );
    const code = outcome.kind === 'throw' ? outcome.code : 'internal_error';
    if (outcome.kind === 'return' || outcome.unexpected) {
      logger.error('resend.request_failed', { error_name: error.name, error_code: code });
    }
    throw registryError(code);
  };

  const dataOf = <T>(response: SdkResponse<T>, method: ResendMethodKind): T => {
    if (response.error !== null) return fail(response.error, method);
    if (response.data === null) throw registryError('internal_error');
    return response.data;
  };

  const dateOf = (value: unknown): Date => {
    const date = typeof value === 'string' ? new Date(value) : new Date(Number.NaN);
    if (Number.isNaN(date.getTime())) throw registryError('internal_error');
    return date;
  };

  return {
    async retrieveWebhook(webhookId, { deadline }) {
      const response = await withRetries(
        (signal) => sdk.webhooks.get(webhookId, { signal }),
        deadline,
      );
      // RS-13: the response carries the signing secret and the endpoint; only the status leaves.
      const { status } = dataOf(response, 'retrieveWebhook');
      if (status !== 'enabled' && status !== 'disabled') throw registryError('internal_error');
      return { status };
    },

    async listWebhookEvents(webhookId, { after }, { deadline }) {
      const response = await withRetries(
        (signal) =>
          sdk.webhooks.events.list(
            { webhookId, limit: 100, ...(after === undefined ? {} : { after }) },
            { signal },
          ),
        deadline,
      );
      const page = dataOf(response, 'reconcile');
      return {
        hasMore: page.has_more === true,
        events: page.data.map((item) => ({
          id: item.id,
          type: item.type,
          createdAt: dateOf(item.created_at),
        })),
      };
    },

    async replayWebhookEvent(webhookId, eventId, { deadline }) {
      const response = await withRetries(
        (signal) => sdk.webhooks.events.replay({ webhookId, eventId }, { signal }),
        deadline,
      );
      dataOf(response, 'reconcile');
    },

    async retrieveWebhookEventCreatedAt(webhookId, eventId, { deadline }) {
      const response = await withRetries(
        (signal) => sdk.webhooks.events.get({ webhookId, eventId }, { signal }),
        deadline,
      );
      // RS-15: the payload holds raw addresses; only its top-level `created_at` leaves.
      const event = dataOf(response, 'reconcile');
      return { createdAt: dateOf((event.payload as { created_at?: unknown }).created_at) };
    },

    async sendEmail({ from, to, subject, text }, { idempotencyKey }, { deadline }) {
      const response = await withRetries(
        (signal) => sdk.emails.send({ from, to, subject, text }, { idempotencyKey, signal }),
        deadline,
      );
      const { error } = response;
      if (error !== null) {
        const outcome = mapResendError(
          { status: error.statusCode, name: error.name, message: error.message },
          'sendEmail',
        );
        if (outcome.kind === 'return' && error.statusCode !== null) {
          return { rejected: { status: error.statusCode, name: error.name } };
        }
        return fail(error, 'sendEmail');
      }
      return { emailId: dataOf(response, 'sendEmail').id };
    },
  };
}
