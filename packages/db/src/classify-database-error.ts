import { DatabaseUnavailableError } from './database-unavailable.error.ts';

// pp-database → Connection-error classification: the one list, in `packages/db` only.

// SQLSTATE class 08 (connection exception) plus the class 57 shutdown codes (Postgres errcodes).
const CONNECTION_SQLSTATES: ReadonlySet<string> = new Set([
  '08000',
  '08001',
  '08003',
  '08004',
  '08006',
  '08007',
  '08P01',
  '57P01',
  '57P02',
  '57P03',
]);

// Node system error codes a socket raises when the server is unreachable or drops the connection.
const SOCKET_CODES: ReadonlySet<string> = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  'EPIPE',
  'ENOTFOUND',
  'EAI_AGAIN',
  'EHOSTUNREACH',
  'ENETUNREACH',
]);

// `pg` errors that carry no `code`, matched by exact message (pg 8.23.1 `lib/client.js`, pg-pool
// 3.14.0 `index.js`). Never
// pg-pool's `timeout exceeded when trying to connect` with no `cause`: on a size-1 pool that is a
// leaked checkout, a bug that follows ADR-008 to the DLQ instead of pausing the worker.
const CONNECTION_MESSAGES: ReadonlySet<string> = new Set([
  'Connection terminated unexpectedly',
  'Connection terminated due to connection timeout',
  'Client has encountered a connection error and is not queryable',
]);

// Drizzle wraps a failed query in `DrizzleQueryError` with the driver error as `cause`; pg-pool
// attaches the connect error as `cause` on its timeout; Node's dual-stack connect raises an
// `AggregateError` of the per-address errors. A match anywhere in that tree counts.
const MAX_DEPTH = 8;

function isConnectionClass(err: unknown, depth: number): boolean {
  if (depth > MAX_DEPTH || typeof err !== 'object' || err === null) {
    return false;
  }
  const code = 'code' in err ? err.code : undefined;
  if (typeof code === 'string') {
    if (CONNECTION_SQLSTATES.has(code) || SOCKET_CODES.has(code)) {
      return true;
    }
  } else if (err instanceof Error && CONNECTION_MESSAGES.has(err.message)) {
    return true;
  }
  if (err instanceof AggregateError && err.errors.some((e) => isConnectionClass(e, depth + 1))) {
    return true;
  }
  return 'cause' in err && isConnectionClass(err.cause, depth + 1);
}

// Returns the `database_unavailable` error for a connection-class failure, with the original as
// `cause`, or `undefined` when the error is anything else and the caller's own mapping applies.
export function classifyDatabaseError(err: unknown): DatabaseUnavailableError | undefined {
  if (err instanceof DatabaseUnavailableError) {
    return err;
  }
  return isConnectionClass(err, 0) ? new DatabaseUnavailableError(err) : undefined;
}
