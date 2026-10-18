import { LedgerError } from '@ledger/shared';
import { DrizzleQueryError } from 'drizzle-orm';
import { Client } from 'pg';
import { describe, expect, it } from 'vitest';
import { classifyDatabaseError } from './classify-database-error.ts';
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

describe('classifyDatabaseError', () => {
  it.each(connectionSqlstates)('classifies SQLSTATE %s as database_unavailable', (code) => {
    const result = classifyDatabaseError(withCode(code));
    expect(result).toBeInstanceOf(DatabaseUnavailableError);
    expect(result?.code).toBe('database_unavailable');
  });

  it.each(socketCodes)('classifies the socket code %s as database_unavailable', (code) => {
    expect(classifyDatabaseError(withCode(code))?.code).toBe('database_unavailable');
  });

  it.each(pgMessages)(
    'classifies the code-less pg error "%s" as database_unavailable',
    (message) => {
      expect(classifyDatabaseError(new Error(message))?.code).toBe('database_unavailable');
    },
  );

  it('classifies a refused connection a real pg client raised, keeping it as the cause', async () => {
    const client = new Client({ connectionString: 'postgres://nobody@127.0.0.1:1/none' });
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
    const aggregate = new AggregateError([withCode('ECONNREFUSED'), withCode('ECONNREFUSED')]);
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
});
