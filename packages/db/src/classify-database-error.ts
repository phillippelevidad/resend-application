import { DrizzleQueryError } from 'drizzle-orm';
import { DatabaseUnavailableError } from './database-unavailable.error.ts';

// pp-database → Connection-error classification: the one list, in `packages/db` only.

// SQLSTATE class 08 (connection exception) plus the class 57 shutdown codes (Postgres errcodes),
// plus `53100`.
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
  // `disk_full`: ADR-015's out-of-storage class, not a connection error, classified so the worker
  // pauses instead of draining to the DLQ. Whether Neon's storage limit raises it is PG-U07 (D9);
  // until then an unmatched code follows ADR-008, as before.
  '53100',
]);

// Node system error codes a socket raises when the server is unreachable or drops the connection.
// Any client's socket raises them: the AWS SDK rejects with the same raw Node error (D9). So
// one counts only when it has a pg origin (see `hasPgOrigin`).
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
  // `query_timeout` fired (pg 8.23.1 `lib/client.js:707`). The runtime role's `lock_timeout` (10 s)
  // ends every lock wait server-side before the pool's 15 s, so this silence means the server is
  // unreachable (D9). pg keeps that connection open, so the retry must not reuse it (D15).
  'Query read timeout',
]);

// Every socket error a `DatabaseClient`'s pg connection emitted. A WeakSet, so the error itself is
// never changed and a marked error is collected with it.
const connectionErrors = new WeakSet<object>();

// `DatabaseClient`'s listener on its pg `Connection`'s `error` event.
export function markConnectionError(err: unknown): void {
  if (typeof err === 'object' && err !== null) {
    connectionErrors.add(err);
  }
}

// A socket code has a pg origin when a pg connection emitted it, or when it sits inside Drizzle's
// query wrapper, whose `cause` is what the driver raised (drizzle-orm 0.45.4 `pg-core/session.js`
// `queryWithCache`). Both hold for every database path: a query through Drizzle, and the raw
// errors of `pool.connect()` and of `client.query` on a checked-out client, which a
// `DatabaseClient` marks. A bare socket error with neither is some other client's.
function hasPgOrigin(err: object): boolean {
  return err instanceof DrizzleQueryError || connectionErrors.has(err);
}

// Drizzle wraps a failed query in `DrizzleQueryError` with the driver error as `cause`; pg-pool
// attaches the connect error as `cause` on its timeout; Node's dual-stack connect raises an
// `AggregateError` of the per-address errors. A match anywhere in that tree counts, a socket code
// only below a pg origin.
const MAX_DEPTH = 8;

function isConnectionClass(err: unknown, depth: number, pgOrigin: boolean): boolean {
  if (depth > MAX_DEPTH || typeof err !== 'object' || err === null) {
    return false;
  }
  const fromPg = pgOrigin || hasPgOrigin(err);
  const code = 'code' in err ? err.code : undefined;
  if (typeof code === 'string') {
    if (CONNECTION_SQLSTATES.has(code) || (fromPg && SOCKET_CODES.has(code))) {
      return true;
    }
  } else if (err instanceof Error && CONNECTION_MESSAGES.has(err.message)) {
    return true;
  }
  if (
    err instanceof AggregateError &&
    err.errors.some((e) => isConnectionClass(e, depth + 1, fromPg))
  ) {
    return true;
  }
  return 'cause' in err && isConnectionClass(err.cause, depth + 1, fromPg);
}

// Returns the `database_unavailable` error for a connection-class failure, with the original as
// `cause`, or `undefined` when the error is anything else and the caller's own mapping applies.
export function classifyDatabaseError(err: unknown): DatabaseUnavailableError | undefined {
  if (err instanceof DatabaseUnavailableError) {
    return err;
  }
  return isConnectionClass(err, 0, false) ? new DatabaseUnavailableError(err) : undefined;
}
