import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ConfigError } from './config.error.ts';
import { loadConfig } from './load-config.ts';

const schema = z.object({
  DATABASE_URL: z.url(),
  LEDGER_ADDRESS_HASH_KEY: z
    .string()
    .regex(/^[0-9a-f]{64}$/, { error: 'must be 64 lowercase hex characters' }),
  LEDGER_SIMULATOR_SECRET: z.string().startsWith('whsec_').optional(),
});

// Values a log or a terminal must never show: a credentialed URL and a key-shaped string.
const secretUrl = 'not-a-url-but-holds-hunter2-credentials';
const wrongKey = 'ABCDEF-this-key-is-secret';
const wrongSecret = 'sk_this-secret-is-secret';

const caught = (run: () => unknown): unknown => {
  try {
    run();
  } catch (error) {
    return error;
  }
  return expect.unreachable('loadConfig did not throw');
};

describe('loadConfig', () => {
  it('returns the parsed config when every variable is valid', () => {
    const key = 'a'.repeat(64);
    expect(
      loadConfig(schema, {
        DATABASE_URL: 'postgres://127.0.0.1:55432/ledger',
        LEDGER_ADDRESS_HASH_KEY: key,
        UNRELATED: 'ignored',
      }),
    ).toEqual({ DATABASE_URL: 'postgres://127.0.0.1:55432/ledger', LEDGER_ADDRESS_HASH_KEY: key });
  });

  it('throws a ConfigError naming each failing variable and its expectation, never a value', () => {
    const error = caught(() =>
      loadConfig(schema, {
        DATABASE_URL: secretUrl,
        LEDGER_ADDRESS_HASH_KEY: wrongKey,
        LEDGER_SIMULATOR_SECRET: wrongSecret,
      }),
    );

    expect(error).toBeInstanceOf(ConfigError);
    const configError = error as ConfigError;
    expect(configError.issues.map((issue) => issue.variable)).toEqual([
      'DATABASE_URL',
      'LEDGER_ADDRESS_HASH_KEY',
      'LEDGER_SIMULATOR_SECRET',
    ]);
    expect(configError.issues[1]?.expected).toBe('must be 64 lowercase hex characters');
    for (const name of ['DATABASE_URL', 'LEDGER_ADDRESS_HASH_KEY', 'LEDGER_SIMULATOR_SECRET']) {
      expect(configError.message).toContain(name);
    }

    const everything = JSON.stringify({
      message: configError.message,
      issues: configError.issues,
      stack: configError.stack,
      cause: configError.cause,
    });
    for (const value of [secretUrl, wrongKey, wrongSecret, 'hunter2']) {
      expect(everything).not.toContain(value);
    }
  });

  it('names a missing required variable', () => {
    const error = caught(() => loadConfig(schema, { DATABASE_URL: 'postgres://127.0.0.1/ledger' }));
    expect(error).toBeInstanceOf(ConfigError);
    expect((error as ConfigError).issues.map((issue) => issue.variable)).toEqual([
      'LEDGER_ADDRESS_HASH_KEY',
    ]);
  });
});
