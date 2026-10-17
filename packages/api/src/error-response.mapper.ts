import { type ErrorCode, errorRegistry } from '@ledger/core';
import type { ErrorResponse } from './error-response.schema.ts';

export type ErrorOverrides = {
  message?: string | undefined;
  hint?: string | undefined;
  docs?: string | undefined;
};

// The registry's default `message`, `hint` and `docs` (D4), each replaced only where the raise site
// is more specific (a `validation_failed` naming its field). Nothing else reaches the body.
export function errorResponseMapper(
  code: ErrorCode,
  overrides: ErrorOverrides = {},
): ErrorResponse {
  const entry = errorRegistry[code];
  return {
    error: {
      code,
      message: overrides.message ?? entry.message,
      hint: overrides.hint ?? entry.hint,
      docs: overrides.docs ?? entry.docs,
    },
  };
}
