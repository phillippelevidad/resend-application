import { Writable } from 'node:stream';
import type { ErrorCode } from '@ledger/core';
import winston from 'winston';
import { LedgerError } from './ledger.error.ts';

// The mirror of data-modeling.md → Log fields, the canonical allow-list: change the doc first, then
// this constant, in the same change. `function_name` and `timestamp` are written by the logger
// itself, so a caller's value under either never reaches the line.
export const logFieldKeys = [
  'svix_id',
  'email_id',
  'type',
  'request_id',
  'run_id',
  'token_id',
  'error_name',
  'error_code',
  'pg_code',
  'function_name',
  'cold_start',
  'timestamp',
] as const;

const loggerOwnedKeys: ReadonlySet<string> = new Set(['function_name', 'timestamp']);
const callerKeys: ReadonlySet<string> = new Set(
  logFieldKeys.filter((key) => !loggerOwnedKeys.has(key)),
);

// `<name>_count` and `<name>_ms`, the name in snake case: a key built from a value (an address, a
// subject) cannot pass.
const measureKey = /^[a-z][a-z0-9_]*_(count|ms)$/;

type NamedFields = {
  svix_id: string;
  email_id: string;
  type: string;
  request_id: string;
  run_id: string;
  token_id: string;
  error_name: string;
  error_code: ErrorCode;
  pg_code: string;
  cold_start: boolean;
};

export type LogFields = { readonly [Key in keyof NamedFields]?: NamedFields[Key] | undefined } & {
  readonly [key: `${string}_count`]: number | undefined;
  readonly [key: `${string}_ms`]: number | undefined;
};

export type Logger = {
  readonly info: (message: string, fields?: LogFields) => void;
  readonly warn: (message: string, fields?: LogFields) => void;
  readonly error: (message: string, fields?: LogFields) => void;
};

// Any sink with a `write`. Winston's Stream transport takes only a real Node stream, so a plain
// sink is wrapped in a `Writable`.
export type LogSink = { write(chunk: string): unknown };

export type CreateLoggerOptions = { functionName: string; stream?: LogSink };

const isScalar = (value: unknown): value is string | number | boolean =>
  typeof value === 'string' ||
  typeof value === 'boolean' ||
  (typeof value === 'number' && Number.isFinite(value));

// D15: an allow-list, never a deny-list. Under an allowed key only a scalar survives: pg's
// `DatabaseError` carries `detail` ("Failing row contains …") as an own property, so an error object
// under `error_name` would serialize the row.
const allowListed = (fields: LogFields | undefined): Record<string, string | number | boolean> => {
  const kept: Record<string, string | number | boolean> = {};
  if (fields === undefined) return kept;
  for (const [key, value] of Object.entries(fields)) {
    if (!isScalar(value)) continue;
    if (callerKeys.has(key) || (measureKey.test(key) && typeof value === 'number')) {
      kept[key] = value;
    }
  }
  return kept;
};

// One JSON object per line: `level`, an RFC 3339 `timestamp` and `function_name` first, so Lambda's
// level filter reads them (pp-general → logging-and-pii), then the constant message and the kept
// fields.
const lineFormat = (functionName: string) =>
  winston.format.printf(({ level, message, fields }) =>
    JSON.stringify({
      level,
      timestamp: new Date().toISOString(),
      function_name: functionName,
      message,
      ...(fields as Record<string, unknown>),
    }),
  );

const toStream = (sink: LogSink): Writable =>
  new Writable({
    write(chunk: Buffer | string, _encoding, callback) {
      sink.write(chunk.toString());
      callback();
    },
  });

// D15: without `stream`, a Console transport to stdout (production, `apps/local`); with one, a
// Stream transport over it (tests). One format and one allow-list for both. Messages are constants,
// never interpolated.
export const createLogger = ({ functionName, stream }: CreateLoggerOptions): Logger => {
  const transport =
    stream === undefined
      ? new winston.transports.Console()
      : new winston.transports.Stream({ stream: toStream(stream) });
  const winstonLogger = winston.createLogger({
    level: 'info',
    format: lineFormat(functionName),
    transports: [transport],
  });
  const write =
    (level: 'info' | 'warn' | 'error') =>
    (message: string, fields?: LogFields): void => {
      winstonLogger.log({ level, message, fields: allowListed(fields) });
    };
  return { info: write('info'), warn: write('warn'), error: write('error') };
};

export type ErrorFields = { error_name: string; error_code?: ErrorCode; pg_code?: string };

// A SQLSTATE is five digits or upper-case letters. pg's `DatabaseError` always carries `severity`
// (the protocol's `S` field), which a Node system error with a five-letter `code` (`EPIPE`) lacks.
const sqlState = /^[0-9A-Z]{5}$/;

const pgCodeOf = (error: object): string | undefined => {
  const { code, severity } = error as { code?: unknown; severity?: unknown };
  return typeof code === 'string' && sqlState.test(code) && typeof severity === 'string'
    ? code
    : undefined;
};

const maxCauseDepth = 16;

// D15: an error contributes its name, the first registry code and the first SQLSTATE on its `cause`
// chain, and nothing else. `message`, `detail` and `params` are never read: a parse error, a
// Drizzle query error or a Postgres error can quote the row.
export const errorFields = (error: unknown): ErrorFields => {
  const name =
    typeof error === 'object' && error !== null && typeof (error as Error).name === 'string'
      ? (error as Error).name
      : 'NonError';
  const fields: ErrorFields = { error_name: name };
  const seen = new Set<unknown>();
  let current: unknown = error;
  for (let depth = 0; depth < maxCauseDepth; depth += 1) {
    if (typeof current !== 'object' || current === null || seen.has(current)) break;
    seen.add(current);
    if (fields.error_code === undefined && current instanceof LedgerError) {
      fields.error_code = current.code;
    }
    const pgCode = fields.pg_code === undefined ? pgCodeOf(current) : undefined;
    if (pgCode !== undefined) fields.pg_code = pgCode;
    current = (current as { cause?: unknown }).cause;
  }
  return fields;
};
