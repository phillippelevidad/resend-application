import { type ErrorCode, errorRegistry } from '@ledger/core';
import createClient from 'openapi-fetch';
import { z } from 'zod';
import type { components, paths } from './openapi-types.ts';

export type Email = components['schemas']['Email'];
export type Recipient = components['schemas']['Recipient'];

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

export type LedgerClient = {
  readonly emails: { get(emailId: string): Promise<SdkResult<Email>> };
  readonly recipients: { get(address: string): Promise<SdkResult<Recipient>> };
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
  };
}
