import { z } from 'zod';

// D4: the mirror of api-contract.md → Error codes, the only registry. A code is added there first
// (Ask-first), then here. The test that fails when the two drift is slice 5's (ADR-011).
export const errorCodes = [
  'unauthorized',
  'forbidden',
  'validation_failed',
  'email_not_found',
  'recipient_not_found',
  'run_not_found',
  'token_not_found',
  'route_not_found',
  'reconcile_in_progress',
  'redrive_in_progress',
  'last_operate_token',
  'webhook_disabled',
  'rate_limited',
  'resend_auth_failed',
  'resend_unavailable',
  'run_abandoned',
  'database_unavailable',
  'internal_error',
  'api_unavailable',
] as const;

export const errorCodeSchema = z.enum(errorCodes);

export type ErrorCode = z.infer<typeof errorCodeSchema>;

// D4: the runbook in this repo's public GitHub tree (`docs/runbook.md`, slice 3); every runbook link
// resolves to a heading there (`infra/src/runbook-links.test.ts`).
export const RUNBOOK_BASE_URL =
  'https://github.com/phillippelevidad/resend-application/blob/main/docs/runbook.md';

// `status` is null for a run-outcome code (stored on the run, never an HTTP status of its own) and
// for a client-side code (raised by the SDK, never by the API).
export type ErrorRegistryEntry = {
  readonly status: number | null;
  readonly message: string;
  readonly hint: string;
  readonly docs: string;
};

const runbook = (code: ErrorCode): string => `${RUNBOOK_BASE_URL}#${code}`;

// Default `message` and `hint` per code. A throw site passes its own only when it is more specific
// (a `validation_failed` naming its field). No message holds an id, address or input value.
export const errorRegistry = {
  unauthorized: {
    status: 401,
    message: 'Bearer token missing, malformed, bad-tag, unknown or revoked.',
    hint: 'Set `LEDGER_TOKEN` to an active token.',
    docs: runbook('unauthorized'),
  },
  forbidden: {
    status: 403,
    message: 'The token is valid but lacks the scope this operation needs.',
    hint: 'Use an `operate` token, or ask its owner for one.',
    docs: runbook('forbidden'),
  },
  validation_failed: {
    status: 400,
    message: 'Malformed input: bad id, address, duration, cursor or `limit`.',
    hint: 'Fix the field the message names, then retry.',
    docs: runbook('validation_failed'),
  },
  email_not_found: {
    status: 404,
    message: 'No event has been recorded for this email id.',
    hint: 'Events may still be queued, or missed: run `ledger gaps`.',
    docs: runbook('email_not_found'),
  },
  recipient_not_found: {
    status: 404,
    message: 'No event has ever named this address.',
    hint: 'Check the address. If it was emailed recently, run `ledger gaps`.',
    docs: runbook('recipient_not_found'),
  },
  run_not_found: {
    status: 404,
    message: 'No reconcile run with this id.',
    hint: 'List runs with `ledger gaps`.',
    docs: runbook('run_not_found'),
  },
  token_not_found: {
    status: 404,
    message: 'No token with this id.',
    hint: 'List tokens with `ledger token list`.',
    docs: runbook('token_not_found'),
  },
  route_not_found: {
    status: 404,
    message: 'No operation at this method and path.',
    hint: "Check `LEDGER_URL`, and that the CLI or SDK version matches the API's.",
    docs: runbook('route_not_found'),
  },
  reconcile_in_progress: {
    status: 409,
    message:
      'Another reconcile run is unfinished and still inside its time budget; runs never overlap.',
    hint: 'Wait for it: `ledger gaps`.',
    docs: runbook('reconcile_in_progress'),
  },
  redrive_in_progress: {
    status: 409,
    message: 'A DLQ redrive task is already running; SQS allows one per queue.',
    hint: 'Wait for the DLQ depth in `ledger health` to fall.',
    docs: 'https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-configure-dead-letter-queue-redrive.html',
  },
  last_operate_token: {
    status: 409,
    message: 'Revoking this token would leave no active `operate` token.',
    hint: 'Create another `operate` token first.',
    docs: runbook('last_operate_token'),
  },
  webhook_disabled: {
    status: null,
    message: 'The Resend webhook is disabled, so replays will not be delivered.',
    hint: 'Re-enable it in the Resend dashboard or with `PATCH /webhooks/{id}` and `status: enabled`, then run `ledger reconcile`.',
    docs: 'https://resend.com/docs/webhooks/retries-and-replays',
  },
  rate_limited: {
    status: null,
    message:
      "Resend's shared rate limit left no room inside the run's time budget, or Resend answered a `429` that cannot be waited out (a daily or monthly quota, or no `retry-after`), so the run stopped before its horizon.",
    hint: "The next hourly run re-diffs from newest. Check what else is spending the team's budget.",
    docs: 'https://resend.com/docs/api-reference/rate-limit',
  },
  resend_auth_failed: {
    status: null,
    message:
      "Resend rejected the reconciler's API key: missing, invalid or deleted, restricted, or suspended.",
    hint: 'The reconciler needs a `full_access` key in its secret.',
    docs: 'https://resend.com/docs/api-reference/errors',
  },
  resend_unavailable: {
    status: null,
    message: "Resend's API answered `5xx` past the client's retries.",
    hint: 'The next scheduled run retries.',
    docs: 'https://resend.com/docs/api-reference/errors',
  },
  run_abandoned: {
    status: null,
    message:
      'The run has no `finished_at` past its time budget (it crashed or its invoke was lost), so it will not finish.',
    hint: 'Run `ledger reconcile` again; the next hourly run covers the horizon.',
    docs: runbook('run_abandoned'),
  },
  database_unavailable: {
    status: 503,
    message: 'The database is unreachable.',
    hint: 'The queue holds events meanwhile (ADR-015); retry, then `ledger worker resume`. `ledger health` shows storage used.',
    docs: runbook('database_unavailable'),
  },
  internal_error: {
    status: 500,
    message: 'An unexpected error occurred.',
    hint: 'Retry; if it persists, read the API logs by request id.',
    docs: runbook('internal_error'),
  },
  api_unavailable: {
    status: null,
    message: 'The Ledger API did not answer with a Ledger response.',
    hint: 'Check `LEDGER_URL`. The kill switch may be tripped: check the budget alerts, then run the re-arm script.',
    docs: runbook('api_unavailable'),
  },
} as const satisfies Readonly<Record<ErrorCode, ErrorRegistryEntry>>;
