// Error objects the fake SDK answers with in the CLI's tests (pp-cli → cli-tests). The CLI prints
// them as received, so these are fixtures, not the registry: the registry is the API's.
import type { SdkError } from '@ledger/sdk';

const RUNBOOK = 'https://github.com/phillippelevidad/resend-application/blob/main/docs/runbook.md';

const fixture = (code: string, message: string, hint: string): SdkError => ({
  code,
  message,
  hint,
  docs: `${RUNBOOK}#${code}`,
});

export const unauthorized = fixture(
  'unauthorized',
  'Bearer token missing, malformed, bad-tag, unknown or revoked.',
  'Set `LEDGER_TOKEN` to an active token.',
);

export const forbidden = fixture(
  'forbidden',
  'The token is valid but lacks the scope this operation needs.',
  'Use an `operate` token, or ask its owner for one.',
);

export const tokenNotFound = fixture(
  'token_not_found',
  'No token with this id.',
  'List tokens with `ledger token list`.',
);

export const lastOperateToken = fixture(
  'last_operate_token',
  'Revoking this token would leave no active `operate` token.',
  'Create another `operate` token first.',
);

export const validationFailed = (message: string): SdkError =>
  fixture('validation_failed', message, 'Fix the field the message names, then retry.');

export const databaseUnavailable = (message = 'The database is unreachable.'): SdkError =>
  fixture(
    'database_unavailable',
    message,
    'The queue holds events meanwhile (ADR-015); retry, then `ledger worker resume`. `ledger health` shows storage used.',
  );

// A code the CLI has never heard of: printed as received, exit 1.
export const unknownCode = fixture('not_in_registry', 'm', 'h');
