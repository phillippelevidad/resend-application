// Ships 7 (slice 1): the log allow-list. A worker failure whose cause quotes a test address, a parse
// failure quoting a subject, and a payload under a non-allowed key leave neither in any line.
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createLogger, errorFields, type LogFields } from './create-logger.ts';
import { LedgerError } from './ledger.error.ts';

const address = 'delivered@resend.dev';
const subject = 'Quarterly invoice for the Northwind account';

const captured = () => {
  const lines: string[] = [];
  const logger = createLogger({
    functionName: 'worker',
    stream: { write: (chunk: string) => lines.push(chunk) },
  });
  const parsed = (): Record<string, unknown>[] =>
    lines.map((line) => JSON.parse(line) as Record<string, unknown>);
  return { lines, logger, parsed };
};

// What pg-protocol's `DatabaseError` holds for a CHECK violation (pg 8.23.1): `name` `error`,
// `severity`, the SQLSTATE in `code`, and the failing row in `detail`.
const checkViolation = () =>
  Object.assign(
    new Error('new row for relation "webhook_events" violates check constraint "source_check"'),
    {
      name: 'error',
      severity: 'ERROR',
      code: '23514',
      detail: `Failing row contains (msg_2v3cQ9uYfJ8kL1mN0pR4sT6wX, {"to": ["${address}"]}, replayed).`,
      table: 'webhook_events',
      constraint: 'source_check',
    },
  );

// What Drizzle wraps a driver error in: the query and its params in `message`, the driver error as
// `cause`.
const workerFailure = () =>
  Object.assign(
    new Error(`Failed query: insert into "webhook_events" … params: ${address},${subject}`, {
      cause: checkViolation(),
    }),
    { params: [address, subject] },
  );

const subjectParseFailure = () => {
  const result = z
    .object({ data: z.object({ subject: z.literal('expected') }) })
    .safeParse({ data: { subject } }, { reportInput: true });
  if (result.success) return expect.unreachable('the parse must fail');
  return result.error;
};

describe('createLogger', () => {
  it('logs a worker failure by name and SQLSTATE, never the address the cause quotes', () => {
    const { lines, logger, parsed } = captured();
    const failure = workerFailure();

    logger.error('worker.message_failed', {
      svix_id: 'msg_2v3cQ9uYfJ8kL1mN0pR4sT6wX',
      ...errorFields(failure),
    });

    expect(lines).toHaveLength(1);
    const [line] = parsed();
    expect(line).toMatchObject({
      level: 'error',
      function_name: 'worker',
      message: 'worker.message_failed',
      svix_id: 'msg_2v3cQ9uYfJ8kL1mN0pR4sT6wX',
      error_name: 'Error',
      pg_code: '23514',
    });
    expect(Object.keys(line ?? {}).sort()).toEqual(
      ['error_name', 'function_name', 'level', 'message', 'pg_code', 'svix_id', 'timestamp'].sort(),
    );
    expect(lines.join('\n')).not.toContain(address);
    expect(lines.join('\n')).not.toContain(subject);
  });

  it('logs a parse failure quoting a subject without the subject', () => {
    const { lines, logger } = captured();
    const failure = subjectParseFailure();
    expect(failure.message).toContain(subject);

    logger.error('worker.message_failed', errorFields(failure));
    logger.error('worker.message_failed', errorFields(new LedgerError('internal_error', subject)));

    expect(lines).toHaveLength(2);
    expect(lines.join('\n')).not.toContain(subject);
  });

  it('drops a payload under a non-allowed key and any non-scalar under an allowed key', () => {
    const { lines, logger, parsed } = captured();
    const failure = workerFailure();
    const fields: Record<string, unknown> = {
      payload: { type: 'email.bounced', data: { to: [address], subject } },
      detail: failure.cause,
      to: [address],
      email_id: { nested: address },
      error_name: failure,
      type: ['email.sent'],
      [`${address}_count`]: 1,
      attempt_count: '3',
      lag_ms: Number.NaN,
      receive_count: 5,
      lag_ms_total: 1,
      message: subject,
      level: subject,
      function_name: subject,
      timestamp: subject,
      cold_start: true,
    };

    logger.warn('worker.message_failed', fields as LogFields);

    expect(lines).toHaveLength(1);
    const [line] = parsed();
    expect(line).toMatchObject({
      level: 'warn',
      function_name: 'worker',
      message: 'worker.message_failed',
      receive_count: 5,
      cold_start: true,
    });
    expect(Object.keys(line ?? {}).sort()).toEqual(
      ['cold_start', 'function_name', 'level', 'message', 'receive_count', 'timestamp'].sort(),
    );
    expect(lines[0]).not.toContain(address);
    expect(lines[0]).not.toContain(subject);
  });

  it('writes one JSON line per call with an RFC 3339 timestamp', () => {
    const { lines, logger, parsed } = captured();

    logger.info('ingest.accepted', { svix_id: 'msg_1', type: 'email.sent', value_count: 1 });
    logger.info('worker.processing_lag', { svix_id: 'msg_1', value_ms: 12 });

    expect(lines).toHaveLength(2);
    for (const line of lines) expect(line.endsWith('\n')).toBe(true);
    for (const line of parsed()) {
      expect(z.iso.datetime({ offset: true }).safeParse(line.timestamp).success).toBe(true);
    }
    expect(parsed()[0]).toMatchObject({ type: 'email.sent', value_count: 1 });
    expect(parsed()[1]).toMatchObject({ value_ms: 12 });
  });
});

describe('createLogger context (D6)', () => {
  it('merges the context fields into every line, read afresh on each line', () => {
    const lines: string[] = [];
    let holder: LogFields = { request_id: 'req-1', cold_start: true };
    const logger = createLogger({
      functionName: 'worker',
      stream: { write: (chunk: string) => lines.push(chunk) },
      context: () => holder,
    });

    logger.info('worker.batch_received', { svix_id: 'msg_1' });
    holder = { request_id: 'req-2', cold_start: false };
    logger.warn('worker.message_failed');

    const parsed = lines.map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(parsed[0]).toMatchObject({ request_id: 'req-1', cold_start: true, svix_id: 'msg_1' });
    expect(parsed[1]).toMatchObject({ request_id: 'req-2', cold_start: false });
  });

  it('drops a context key outside the allow-list and lets a defined caller field win', () => {
    const lines: string[] = [];
    const context: Record<string, unknown> = {
      request_id: 'req-ctx',
      cold_start: false,
      to: address,
      payload: { subject },
      function_name: 'forged',
      timestamp: subject,
    };
    const logger = createLogger({
      functionName: 'api',
      stream: { write: (chunk: string) => lines.push(chunk) },
      context: () => context as LogFields,
    });

    logger.info('api.request', { request_id: 'req-caller', cold_start: undefined });

    const [line] = lines.map((entry) => JSON.parse(entry) as Record<string, unknown>);
    expect(Object.keys(line ?? {}).sort()).toEqual(
      ['cold_start', 'function_name', 'level', 'message', 'request_id', 'timestamp'].sort(),
    );
    expect(line).toMatchObject({
      function_name: 'api',
      request_id: 'req-caller',
      cold_start: false,
    });
    expect(lines[0]).not.toContain(address);
    expect(lines[0]).not.toContain(subject);
  });
});

describe('errorFields', () => {
  it('keeps the name, the first SQLSTATE and the first registry code, nothing else', () => {
    expect(errorFields(workerFailure())).toEqual({ error_name: 'Error', pg_code: '23514' });
    expect(
      errorFields(
        new LedgerError('database_unavailable', 'The database is unreachable.', {
          cause: workerFailure(),
        }),
      ),
    ).toEqual({ error_name: 'LedgerError', error_code: 'database_unavailable', pg_code: '23514' });
  });

  it('reads no code from a Node system error, and survives a thrown string or a cause cycle', () => {
    expect(errorFields(Object.assign(new Error('write EPIPE'), { code: 'EPIPE' }))).toEqual({
      error_name: 'Error',
    });
    expect(errorFields(address)).toEqual({ error_name: 'NonError' });
    const cyclic = new Error('outer');
    cyclic.cause = cyclic;
    expect(errorFields(cyclic)).toEqual({ error_name: 'Error' });
  });
});
