import { request } from 'node:http';
import { createServer } from 'node:net';
import { LedgerError } from '@ledger/shared';
import { DrizzleQueryError } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { classifyDatabaseError } from './classify-database-error.ts';
import { DatabaseClient } from './database-client.ts';
import { DatabaseUnavailableError } from './database-unavailable.error.ts';

// An error shaped like the driver's: a `code` property on an Error, as pg and Node set it.
function withCode(code: string): Error {
  return Object.assign(new Error('driver message'), { code });
}

// pp-database → Connection-error classification, one case per classified row.
const connectionSqlstates = [
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
  // `disk_full`, ADR-015's out-of-storage class (D9).
  '53100',
];
const socketCodes = [
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  'EPIPE',
  'ENOTFOUND',
  'EAI_AGAIN',
  'EHOSTUNREACH',
  'ENETUNREACH',
];
const pgMessages = [
  'Connection terminated unexpectedly',
  'Connection terminated due to connection timeout',
  'Client has encountered a connection error and is not queryable',
  // `query_timeout` fired (D9).
  'Query read timeout',
];

// Emits `err` on a `DatabaseClient`'s pg connection, the one path every socket error a pg
// connection raises takes (pg 8.23.1 `lib/connection.js` `reportStreamError`).
function emittedByConnection(err: Error): Error {
  new DatabaseClient({ connectionString: 'postgres://nobody@127.0.0.1:1/none' }).connection.emit(
    'error',
    err,
  );
  return err;
}

// A socket error as `@smithy/node-http-handler` 4.12.1 rejects it: Node's own error, renamed
// `TimeoutError` for `ECONNRESET`, `EPIPE` and `ETIMEDOUT` (`dist-cjs/index.js:362`), then given
// `$metadata` by the retry strategy (`@smithy/core` 3.36.0 `submodules/retry`). Raised here by a
// real HTTP request to a server that resets every connection, so the shape is Node's, not ours.
let resetPort = 0;
const resetServer = createServer((socket) => socket.resetAndDestroy());

beforeAll(async () => {
  await new Promise<void>((resolve) => resetServer.listen(0, '127.0.0.1', resolve));
  const address = resetServer.address();
  resetPort = typeof address === 'object' && address !== null ? address.port : 0;
});

afterAll(async () => {
  await new Promise((resolve) => resetServer.close(resolve));
});

async function sdkSocketError(): Promise<Error> {
  const err = await new Promise<Error>((resolve) => {
    const req = request({ host: '127.0.0.1', port: resetPort, path: '/' });
    req.on('error', resolve);
    req.end();
  });
  return Object.assign(err, {
    name: 'TimeoutError',
    $metadata: { attempts: 3, totalRetryDelay: 0 },
  });
}

describe('classifyDatabaseError', () => {
  it.each(connectionSqlstates)('classifies SQLSTATE %s as database_unavailable', (code) => {
    const result = classifyDatabaseError(withCode(code));
    expect(result).toBeInstanceOf(DatabaseUnavailableError);
    expect(result?.code).toBe('database_unavailable');
  });

  it.each(socketCodes)(
    'classifies the socket code %s inside a DrizzleQueryError as database_unavailable',
    (code) => {
      const wrapped = new DrizzleQueryError('select 1', [], withCode(code));
      expect(classifyDatabaseError(wrapped)?.code).toBe('database_unavailable');
    },
  );

  it.each(socketCodes)(
    'classifies the socket code %s a pg connection emitted as database_unavailable',
    (code) => {
      expect(classifyDatabaseError(emittedByConnection(withCode(code)))?.code).toBe(
        'database_unavailable',
      );
    },
  );

  it.each(pgMessages)(
    'classifies the code-less pg error "%s" as database_unavailable',
    (message) => {
      expect(classifyDatabaseError(new Error(message))?.code).toBe('database_unavailable');
    },
  );

  it('classifies a refused connection a real pg client raised, keeping it as the cause', async () => {
    // The client `createDatabase`'s pool and `prepareDatabase` connect with.
    const client = new DatabaseClient({ connectionString: 'postgres://nobody@127.0.0.1:1/none' });
    const err: unknown = await client.connect().then(
      () => undefined,
      (e: unknown) => e,
    );
    const result = classifyDatabaseError(err);
    expect(result?.code).toBe('database_unavailable');
    expect(result?.cause).toBe(err);
  });

  it("classifies pg-pool's connection timeout, whose cause is the connect error", () => {
    const timeout = new Error('Connection terminated due to connection timeout', {
      cause: new Error('Connection terminated unexpectedly'),
    });
    expect(classifyDatabaseError(timeout)?.code).toBe('database_unavailable');
  });

  it("walks a DrizzleQueryError's cause to the driver error", () => {
    const wrapped = new DrizzleQueryError('select 1', [], withCode('57P01'));
    expect(classifyDatabaseError(wrapped)?.code).toBe('database_unavailable');
  });

  it("walks an AggregateError's members, as Node's dual-stack connect raises them", () => {
    const aggregate = emittedByConnection(
      new AggregateError([withCode('ECONNREFUSED'), withCode('ECONNREFUSED')]),
    );
    expect(classifyDatabaseError(aggregate)?.code).toBe('database_unavailable');
  });

  it('returns an already classified error unchanged', () => {
    const classified = new DatabaseUnavailableError(withCode('08006'));
    expect(classifyDatabaseError(classified)).toBe(classified);
  });

  it('leaves a constraint violation unclassified, so it follows the ordinary error path', () => {
    expect(classifyDatabaseError(withCode('23505'))).toBeUndefined();
    expect(
      classifyDatabaseError(new DrizzleQueryError('insert', [], withCode('23514'))),
    ).toBeUndefined();
  });

  it("leaves pg-pool's cause-less checkout timeout unclassified: on a size-1 pool it is a leak", () => {
    expect(
      classifyDatabaseError(new Error('timeout exceeded when trying to connect')),
    ).toBeUndefined();
  });

  it('leaves a LedgerError of another code and a non-error value unclassified', () => {
    expect(classifyDatabaseError(new LedgerError('internal_error', 'x'))).toBeUndefined();
    expect(classifyDatabaseError('ECONNREFUSED')).toBeUndefined();
    expect(classifyDatabaseError(undefined)).toBeUndefined();
  });

  // Issue 8: a socket code with no pg origin is any client's network failure, so an AWS port that
  // fails with one is never read as a database outage (onError's 503, ADR-015's pause).
  it.each(socketCodes)(
    'leaves the socket code %s unclassified when no pg connection or Drizzle query raised it',
    (code) => {
      expect(classifyDatabaseError(withCode(code))).toBeUndefined();
    },
  );

  it('leaves an AWS SDK socket error unclassified, raw or as the cause of an internal_error', async () => {
    const sdkError = await sdkSocketError();
    expect(sdkError).toMatchObject({ code: 'ECONNRESET', name: 'TimeoutError' });

    expect(classifyDatabaseError(sdkError)).toBeUndefined();
    expect(
      classifyDatabaseError(new LedgerError('internal_error', 'x', { cause: sdkError })),
    ).toBeUndefined();
    expect(classifyDatabaseError(new AggregateError([sdkError]))).toBeUndefined();
  });
});
