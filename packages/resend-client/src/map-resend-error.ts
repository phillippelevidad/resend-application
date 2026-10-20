import type { ErrorCode } from '@ledger/core';

// Which method failed: the mapping differs for Retrieve Webhook's `404` and for Send Email's own
// statuses (D12).
export type ResendMethodKind = 'retrieveWebhook' | 'reconcile' | 'sendEmail';

// A failed response as the SDK returned it: the status (null for a network failure), the name and
// message from Resend's body (RS-22). The message is compared, never kept.
export type ResendFailure = {
  readonly status: number | null;
  readonly name: string;
  readonly message: string;
};

// What the caller does with a failure: throw a registry code, or (Send Email only) hand the status
// and name back to its caller.
export type ResendFailureOutcome =
  | { readonly kind: 'throw'; readonly code: ErrorCode; readonly unexpected: boolean }
  | { readonly kind: 'return' };

// RS-U17, resend.md → Constraint 14: a deleted or invalid key answers `400 validation_error`.
const INVALID_KEY_MESSAGE = 'API key is invalid';

const SEND_RETURNED_STATUSES: ReadonlySet<number> = new Set([401, 403, 409]);

// Slice 4 D12, ADR-012: status first, then name, then a default branch, never an exhaustive switch
// over the SDK's name union (it differs from the documented list, Constraint 14). `429`, `5xx` and a
// network failure never reach here: the limiter and the retries own them (D10, D11).
export const mapResendError = (
  failure: ResendFailure,
  method: ResendMethodKind,
): ResendFailureOutcome => {
  const { status, name, message } = failure;
  if (method === 'sendEmail' && status !== null && SEND_RETURNED_STATUSES.has(status)) {
    return { kind: 'return' };
  }
  if (status === 401 || status === 403) {
    return { kind: 'throw', code: 'resend_auth_failed', unexpected: false };
  }
  if (status === 400 && name === 'validation_error' && message === INVALID_KEY_MESSAGE) {
    return { kind: 'throw', code: 'resend_auth_failed', unexpected: false };
  }
  // PP C19: no webhook with the configured id is a configuration fault, not a request bug.
  if (status === 404 && method === 'retrieveWebhook') {
    return { kind: 'throw', code: 'reconciler_not_configured', unexpected: false };
  }
  return { kind: 'throw', code: 'internal_error', unexpected: true };
};
