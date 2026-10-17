import type { ErrorCode } from '@ledger/core';

export type LedgerErrorOptions = { hint?: string; docs?: string; cause?: unknown };

// D5: the one error base class (ADR-013). `code` is a registry code (api-contract.md → Error codes);
// each surface maps it once, at its edge. `cause` carries the original error for the stack, never
// for output: a Postgres or Zod error can quote a row or an input value.
export class LedgerError extends Error {
  readonly code: ErrorCode;
  readonly hint: string | undefined;
  readonly docs: string | undefined;

  constructor(code: ErrorCode, message: string, options: LedgerErrorOptions = {}) {
    super(message, { cause: options.cause });
    this.name = 'LedgerError';
    this.code = code;
    this.hint = options.hint;
    this.docs = options.docs;
  }
}
