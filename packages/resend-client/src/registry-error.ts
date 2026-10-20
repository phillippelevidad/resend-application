import { type ErrorCode, errorRegistry } from '@ledger/core';
import { LedgerError } from '@ledger/shared';

// Slice 4 D12: every error this package throws carries the registry's message, never Resend's
// body, so nothing Resend wrote reaches a log, an error or an output.
export const registryError = (code: ErrorCode): LedgerError =>
  new LedgerError(code, errorRegistry[code].message);
