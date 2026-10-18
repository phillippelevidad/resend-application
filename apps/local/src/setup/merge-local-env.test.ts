import { mintApiToken } from '@ledger/shared';
import { describe, expect, it } from 'vitest';
import {
  isWorkingLocalToken,
  LOOPBACK_PLACEHOLDER_TOKEN,
  type LocalEnvName,
  localEnvNames,
  mergeLocalEnv,
  setOnceEnvNames,
} from './merge-local-env.ts';

// A visible stand-in for each generated value, so a test sees which names were written.
const generate = (name: LocalEnvName) => `generated-${name}`;

describe('mergeLocalEnv', () => {
  it('writes every name into an empty file, in order, and reports each one written', () => {
    const { text, written } = mergeLocalEnv('', localEnvNames, generate);
    expect(written).toEqual([...localEnvNames]);
    expect(text).toBe(localEnvNames.map((name) => `${name}=generated-${name}\n`).join(''));
  });

  it('never overwrites a set value, so a rerun keeps the developer keys and database password', () => {
    const before = [
      'DATABASE_URL=postgres://ledger:kept@127.0.0.1:55432/ledger',
      'LEDGER_ADDRESS_HASH_KEY=00ff',
      'LEDGER_TOKEN_TAG_KEY=11ee',
      'LEDGER_SIMULATOR_SECRET=whsec_kept',
      'LEDGER_URL=http://127.0.0.1:3200',
      'LEDGER_TOKEN=kept-token',
      '',
    ].join('\n');
    const { text, written } = mergeLocalEnv(before, localEnvNames, generate);
    expect(written).toEqual([]);
    expect(text).toBe(before);
  });

  it('fills an empty value in place and appends an absent name, keeping every other line and comment', () => {
    const before = [
      '# Ledger local settings',
      'RESEND_API_KEY=re_kept',
      'LEDGER_URL=',
      '',
      '# keep me',
      'DATABASE_URL=postgres://ledger:kept@127.0.0.1:55432/ledger',
      "LEDGER_TOKEN=''",
      'LEDGER_SIMULATOR_SECRET=   # set me',
      'LEDGER_TOKEN_TAG_KEY=11ee',
      'AWS_REGION=us-east-2',
    ].join('\n');
    const { text, written } = mergeLocalEnv(before, localEnvNames, generate);
    expect(written).toEqual([
      'LEDGER_ADDRESS_HASH_KEY',
      'LEDGER_SIMULATOR_SECRET',
      'LEDGER_URL',
      'LEDGER_TOKEN',
    ]);
    expect(text).toBe(
      [
        '# Ledger local settings',
        'RESEND_API_KEY=re_kept',
        'LEDGER_URL=generated-LEDGER_URL',
        '',
        '# keep me',
        'DATABASE_URL=postgres://ledger:kept@127.0.0.1:55432/ledger',
        'LEDGER_TOKEN=generated-LEDGER_TOKEN',
        'LEDGER_SIMULATOR_SECRET=generated-LEDGER_SIMULATOR_SECRET',
        'LEDGER_TOKEN_TAG_KEY=11ee',
        'AWS_REGION=us-east-2',
        'LEDGER_ADDRESS_HASH_KEY=generated-LEDGER_ADDRESS_HASH_KEY',
        '',
      ].join('\n'),
    );
  });

  it('reads `export NAME=value` and a commented-out name as the parser does, so neither is written twice nor lost', () => {
    const before = '# LEDGER_URL=http://example.invalid\nexport LEDGER_TOKEN=kept\n';
    const { text, written } = mergeLocalEnv(before, localEnvNames, generate);
    expect(written).not.toContain('LEDGER_TOKEN');
    expect(written).toContain('LEDGER_URL');
    expect(text.startsWith(before)).toBe(true);
    expect(text).toContain('\nLEDGER_URL=generated-LEDGER_URL\n');
  });

  it('keeps CRLF line endings and the file text before the appended names', () => {
    const before = 'RESEND_API_KEY=re_kept\r\nLEDGER_URL=\r\n';
    const { text } = mergeLocalEnv(before, localEnvNames, generate);
    expect(text.startsWith('RESEND_API_KEY=re_kept\r\nLEDGER_URL=generated-LEDGER_URL\r\n')).toBe(
      true,
    );
    expect(text.replaceAll('\r\n', '')).not.toContain('\n');
  });

  it('appends after a last line with no terminator without joining the two lines', () => {
    const { text } = mergeLocalEnv('RESEND_API_KEY=re_kept', localEnvNames, generate);
    expect(text.split('\n')[0]).toBe('RESEND_API_KEY=re_kept');
    expect(text.split('\n')[1]).toBe('DATABASE_URL=generated-DATABASE_URL');
  });

  it('fills the last assignment of a repeated name, the one node --env-file uses', () => {
    const before = 'LEDGER_TOKEN=first\nLEDGER_TOKEN=\n';
    const { text, written } = mergeLocalEnv(before, localEnvNames, generate);
    expect(written).toContain('LEDGER_TOKEN');
    expect(text.startsWith('LEDGER_TOKEN=first\nLEDGER_TOKEN=generated-LEDGER_TOKEN\n')).toBe(true);
  });
});

// D41: the token-tag key is written once, before the database is touched, and never overwritten.
describe('mergeLocalEnv, the token-tag key', () => {
  it('writes LEDGER_TOKEN_TAG_KEY into slice 1 .env.local, in the set-once pass, and leaves LEDGER_TOKEN alone', () => {
    const slice1 = [
      'DATABASE_URL=postgres://ledger:kept@127.0.0.1:55432/ledger',
      'LEDGER_ADDRESS_HASH_KEY=00ff',
      'LEDGER_SIMULATOR_SECRET=whsec_kept',
      'LEDGER_URL=http://127.0.0.1:3200',
      `LEDGER_TOKEN=${LOOPBACK_PLACEHOLDER_TOKEN}`,
      '',
    ].join('\n');
    const { text, written } = mergeLocalEnv(slice1, setOnceEnvNames, generate);
    expect(written).toEqual(['LEDGER_TOKEN_TAG_KEY']);
    expect(text).toBe(`${slice1}LEDGER_TOKEN_TAG_KEY=generated-LEDGER_TOKEN_TAG_KEY\n`);
  });

  it('never overwrites a set LEDGER_TOKEN_TAG_KEY, even in the pass that replaces the token', () => {
    const before = 'LEDGER_TOKEN_TAG_KEY=11ee\nLEDGER_TOKEN=stale\n';
    const setOnce = mergeLocalEnv(before, setOnceEnvNames, generate);
    expect(setOnce.written).not.toContain('LEDGER_TOKEN_TAG_KEY');
    const everything = mergeLocalEnv(before, localEnvNames, generate, { replaceToken: true });
    expect(everything.written).not.toContain('LEDGER_TOKEN_TAG_KEY');
    expect(everything.text).toContain('LEDGER_TOKEN_TAG_KEY=11ee\n');
  });
});

// D41: `LEDGER_TOKEN` is the one name setup replaces, and only when it is not a working token.
describe('mergeLocalEnv, LEDGER_TOKEN replacement', () => {
  it('replaces a set LEDGER_TOKEN in place when told it is not working, keeping every other line', () => {
    const before = `# keep me\nLEDGER_TOKEN=${LOOPBACK_PLACEHOLDER_TOKEN}\nRESEND_API_KEY=re_kept\n`;
    const { text, written } = mergeLocalEnv(before, ['LEDGER_TOKEN'], () => 'ldg_new', {
      replaceToken: true,
    });
    expect(written).toEqual(['LEDGER_TOKEN']);
    expect(text).toBe('# keep me\nLEDGER_TOKEN=ldg_new\nRESEND_API_KEY=re_kept\n');
  });

  it('keeps a set LEDGER_TOKEN without the replacement flag', () => {
    const before = 'LEDGER_TOKEN=ldg_kept\n';
    const { text, written } = mergeLocalEnv(before, ['LEDGER_TOKEN'], () => 'ldg_new');
    expect(written).toEqual([]);
    expect(text).toBe(before);
  });
});

describe('isWorkingLocalToken', () => {
  const tagKey = Buffer.from('a'.repeat(64), 'hex');
  const otherKey = Buffer.from('b'.repeat(64), 'hex');
  const active = mintApiToken(tagKey);
  // The active set setup reads through `findActiveByHash`, stood in by the hashes it holds.
  const activeHashes = new Set([active.tokenHash]);
  const lookups: string[] = [];
  const isActive = async (tokenHash: string) => {
    lookups.push(tokenHash);
    return activeHashes.has(tokenHash);
  };

  it('replaces an empty or absent token without a database lookup', async () => {
    lookups.length = 0;
    expect(await isWorkingLocalToken(undefined, tagKey, isActive)).toBe(false);
    expect(await isWorkingLocalToken('', tagKey, isActive)).toBe(false);
    expect(lookups).toEqual([]);
  });

  it('replaces slice 1 placeholder local-loopback-no-auth without a database lookup', async () => {
    lookups.length = 0;
    expect(await isWorkingLocalToken(LOOPBACK_PLACEHOLDER_TOKEN, tagKey, isActive)).toBe(false);
    expect(lookups).toEqual([]);
  });

  it('replaces a token whose tag fails under the file tag key without a database lookup', async () => {
    lookups.length = 0;
    const underOtherKey = mintApiToken(otherKey).token;
    expect(await isWorkingLocalToken(underOtherKey, tagKey, isActive)).toBe(false);
    expect(await isWorkingLocalToken('ldg_not-a-token', tagKey, isActive)).toBe(false);
    expect(lookups).toEqual([]);
  });

  it('replaces a tag-valid token that matches no active row', async () => {
    const inactive = mintApiToken(tagKey);
    expect(await isWorkingLocalToken(inactive.token, tagKey, isActive)).toBe(false);
  });

  it('keeps an active token under the file tag key, looked up by its hash', async () => {
    lookups.length = 0;
    expect(await isWorkingLocalToken(active.token, tagKey, isActive)).toBe(true);
    expect(lookups).toEqual([active.tokenHash]);
  });
});
