import { describe, expect, it } from 'vitest';
import { readSimConfig } from './sim.config.ts';

// Throwaway values: none is a real secret, URL or key.
const live = {
  LEDGER_URL: 'http://127.0.0.1:3200',
  LEDGER_SIMULATOR_SECRET: `whsec_${Buffer.from('simulator-test-secret').toString('base64')}`,
  DATABASE_URL: 'postgres://user:secret-password@127.0.0.1:55432/ledger',
  LEDGER_ADDRESS_HASH_KEY: '0a'.repeat(32),
};

function messageOf(call: () => unknown): string {
  try {
    call();
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  return '(no error)';
}

describe('readSimConfig', () => {
  it('runs offline when LEDGER_URL is unset or empty, whatever else is set, so LEDGER_URL= pnpm sim never sends', () => {
    expect(readSimConfig({})).toEqual({ mode: 'offline' });
    expect(readSimConfig({ ...live, LEDGER_URL: '' })).toEqual({ mode: 'offline' });
  });

  it('runs live against $LEDGER_URL/webhooks/resend with the key decoded to 32 bytes', () => {
    const config = readSimConfig(live);

    expect(config.mode).toBe('live');
    if (config.mode !== 'live') return;
    expect(config.ingestUrl).toBe('http://127.0.0.1:3200/webhooks/resend');
    expect(config.addressHashKey).toEqual(new Uint8Array(32).fill(0x0a));
    expect(config.simulatorSecret).toBe(live.LEDGER_SIMULATOR_SECRET);
    expect(config.databaseUrl).toBe(live.DATABASE_URL);
  });

  it('keeps a base path and a trailing slash out of the ingest URL, so it never posts to //webhooks', () => {
    const at = (LEDGER_URL: string) => {
      const config = readSimConfig({ ...live, LEDGER_URL });
      return config.mode === 'live' ? config.ingestUrl : config.mode;
    };

    expect(at('http://127.0.0.1:3200/')).toBe('http://127.0.0.1:3200/webhooks/resend');
    expect(at('http://127.0.0.1:3200/ledger')).toBe('http://127.0.0.1:3200/ledger/webhooks/resend');
  });

  it.each(['LEDGER_SIMULATOR_SECRET', 'DATABASE_URL', 'LEDGER_ADDRESS_HASH_KEY'] as const)(
    'names %s as required when LEDGER_URL is set and it is missing or empty',
    (name) => {
      const expected = `${name} is required when LEDGER_URL is set`;

      expect(messageOf(() => readSimConfig({ ...live, [name]: undefined }))).toBe(expected);
      expect(messageOf(() => readSimConfig({ ...live, [name]: '' }))).toBe(expected);
    },
  );

  it.each([
    ['LEDGER_ADDRESS_HASH_KEY', 'AB'.repeat(32), 'must be 64 lowercase hex characters'],
    ['LEDGER_ADDRESS_HASH_KEY', '0a'.repeat(31), 'must be 64 lowercase hex characters'],
    ['LEDGER_URL', 'not a url', 'must be an http or https URL'],
    ['LEDGER_URL', 'ftp://127.0.0.1/', 'must be an http or https URL'],
  ])('rejects an invalid %s naming the variable, never its value', (name, value, reason) => {
    const message = messageOf(() => readSimConfig({ ...live, [name]: value }));

    expect(message).toBe(`${name} ${reason}`);
    expect(message).not.toContain(value);
  });
});
