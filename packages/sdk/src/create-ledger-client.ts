import { type ErrorCode, errorRegistry } from '@ledger/core';
import createClient from 'openapi-fetch';
import { z } from 'zod';
import type { components, paths } from './openapi-types.ts';

export type Email = components['schemas']['Email'];
export type Recipient = components['schemas']['Recipient'];
export type Health = components['schemas']['Health'];
export type EventSource = components['schemas']['EventSource'];
export type Token = components['schemas']['Token'];
export type CreatedToken = components['schemas']['CreatedToken'];
export type TokenList = components['schemas']['TokenList'];
export type DlqMessage = components['schemas']['DlqMessage'];
export type DlqMessageList = components['schemas']['DlqMessageList'];
export type DlqRedrive = components['schemas']['DlqRedrive'];

type TokenScope = Token['scope'];

// The inner object of the one error shape (AGENTS.md → Error shape), exactly as the API sent it.
// `code` is a string, not the registry union: an unknown code passes through (Conventions → Errors).
export type SdkError = {
  readonly code: string;
  readonly message: string;
  readonly hint: string;
  readonly docs: string;
};

// The SDK's one return style (owner, O-10; RS-23): never a throw for an API error.
export type SdkResult<T> =
  | { readonly data: T; readonly error: null }
  | { readonly data: null; readonly error: SdkError };

// One method per operation, named by its Surfaces line (api-contract.md; D24).
export type LedgerClient = {
  readonly emails: { get(emailId: string): Promise<SdkResult<Email>> };
  readonly recipients: { get(address: string): Promise<SdkResult<Recipient>> };
  readonly health: { get(): Promise<SdkResult<Health>> };
  readonly worker: { resumeEventSource(): Promise<SdkResult<EventSource>> };
  readonly tokens: {
    getCurrent(): Promise<SdkResult<Token>>;
    list(params?: {
      readonly limit?: number;
      readonly after?: number;
    }): Promise<SdkResult<TokenList>>;
    create(input: {
      readonly name: string;
      readonly scope: TokenScope;
    }): Promise<SdkResult<CreatedToken>>;
    // A string, as the CLI receives it: the API validates the id (D21, D24).
    revoke(tokenId: string): Promise<SdkResult<Token>>;
  };
  // Slice 3 D10: neither retries (slice 5's); `limit`'s 1 to 10 range is the API's to check (D6).
  readonly dlq: {
    listMessages(params?: { readonly limit?: number }): Promise<SdkResult<DlqMessageList>>;
    startRedrive(): Promise<SdkResult<DlqRedrive>>;
  };
};

export type LedgerClientConfig = { readonly baseUrl: string; readonly token: string };

const clientSideError = (code: ErrorCode): SdkError =>
  Object.freeze({
    code,
    message: errorRegistry[code].message,
    hint: errorRegistry[code].hint,
    docs: errorRegistry[code].docs,
  });

// The client-side codes, exported so the CLI and the MCP server write no `code` literal (O-12).
export const apiUnavailable = clientSideError('api_unavailable');
export const internalError = clientSideError('internal_error');

// D26: just above the HTTP API's 30 s integration cap (AWS-02). Without it Node's fetch waits up to
// undici's 300 s headersTimeout.
const REQUEST_TIMEOUT_MS = 31_000;

// Unknown fields are ignored, never rejected (Conventions → Versioning).
const errorShapeSchema = z.object({
  error: z.object({ code: z.string(), message: z.string(), hint: z.string(), docs: z.string() }),
});

type FetchOutcome = { data?: unknown; error?: unknown };

// One mapping for every method: a 2xx JSON object is `data`; an error-shaped body is its inner
// `error`, unknown code included; anything else (a shapeless 429 or 5xx from the HTTP API itself,
// AWS-14, an empty or non-JSON body, a network failure, the timeout) is `api_unavailable`.
async function settle<T>(request: () => Promise<FetchOutcome>): Promise<SdkResult<T>> {
  let outcome: FetchOutcome;
  try {
    outcome = await request();
  } catch {
    return { data: null, error: apiUnavailable };
  }
  if (outcome.error !== undefined) {
    const parsed = errorShapeSchema.safeParse(outcome.error);
    return { data: null, error: parsed.success ? parsed.data.error : apiUnavailable };
  }
  if (typeof outcome.data !== 'object' || outcome.data === null) {
    return { data: null, error: apiUnavailable };
  }
  return { data: outcome.data as T, error: null };
}

export function createLedgerClient(config: LedgerClientConfig): LedgerClient {
  // The bearer header from slice 1, while the loopback server still skips the check, so no client
  // changes when tokens are enforced (Conventions → Auth in slice 1).
  const client = createClient<paths>({
    baseUrl: config.baseUrl,
    headers: { Authorization: `Bearer ${config.token}` },
  });
  return {
    emails: {
      get: (emailId) =>
        settle<Email>(() =>
          client.GET('/emails/{email_id}', {
            params: { path: { email_id: emailId } },
            signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
          }),
        ),
    },
    recipients: {
      // The address travels in the body only, never a path or query (Conventions → Redaction).
      get: (address) =>
        settle<Recipient>(() =>
          client.POST('/recipients/lookup', {
            body: { address },
            signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
          }),
        ),
    },
    health: {
      get: () =>
        settle<Health>(() =>
          client.GET('/health', { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) }),
        ),
    },
    worker: {
      resumeEventSource: () =>
        settle<EventSource>(() =>
          client.POST('/worker/resume', { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) }),
        ),
    },
    tokens: {
      getCurrent: () =>
        settle<Token>(() =>
          client.GET('/tokens/current', { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) }),
        ),
      // Query values travel as strings; their range and format are the API's to check (D21).
      list: (params = {}) =>
        settle<TokenList>(() =>
          client.GET('/tokens', {
            params: {
              query: {
                ...(params.limit === undefined ? {} : { limit: String(params.limit) }),
                ...(params.after === undefined ? {} : { after: String(params.after) }),
              },
            },
            signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
          }),
        ),
      // One request per call, never retried: each call mints a new token (D24; sdk.md → Retries).
      create: (input) =>
        settle<CreatedToken>(() =>
          client.POST('/tokens', {
            body: { name: input.name, scope: input.scope },
            signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
          }),
        ),
      revoke: (tokenId) =>
        settle<Token>(() =>
          client.POST('/tokens/{token_id}/revoke', {
            params: { path: { token_id: tokenId } },
            signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
          }),
        ),
    },
    dlq: {
      listMessages: (params = {}) =>
        settle<DlqMessageList>(() =>
          client.GET('/dlq/messages', {
            params: {
              query: params.limit === undefined ? {} : { limit: String(params.limit) },
            },
            signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
          }),
        ),
      // One request per call, never retried (slice 3 D10): `202` started and `200` empty are both
      // `data`; a running task is `redrive_in_progress`.
      startRedrive: () =>
        settle<DlqRedrive>(() =>
          client.POST('/dlq/redrive', { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) }),
        ),
    },
  };
}
