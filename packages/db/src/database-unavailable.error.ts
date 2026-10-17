import { errorRegistry } from '@ledger/core';
import { LedgerError } from '@ledger/shared';

// The connection-class error, raised by `packages/db` and nowhere else (api-contract.md → Error
// codes). A subclass because callers branch on it: the read API answers `503` (D22, C3), and the
// ADR-015 worker retries once, then pauses its event source (slice 2). `cause` carries the driver
// error for the stack only, never for output.
export class DatabaseUnavailableError extends LedgerError {
  constructor(cause: unknown) {
    super('database_unavailable', errorRegistry.database_unavailable.message, { cause });
    this.name = 'DatabaseUnavailableError';
  }
}
