import { describe, expect, it } from 'vitest';
import { type LocalEnvName, localEnvNames, mergeLocalEnv } from './merge-local-env.ts';

// A visible stand-in for each generated value, so a test sees which names were written.
const generate = (name: LocalEnvName) => `generated-${name}`;

describe('mergeLocalEnv', () => {
  it('writes every name into an empty file, in order, and reports each one written', () => {
    const { text, written } = mergeLocalEnv('', generate);
    expect(written).toEqual([...localEnvNames]);
    expect(text).toBe(localEnvNames.map((name) => `${name}=generated-${name}\n`).join(''));
  });

  it('never overwrites a set value, so a rerun keeps the developer keys and database password', () => {
    const before = [
      'DATABASE_URL=postgres://ledger:kept@127.0.0.1:55432/ledger',
      'LEDGER_ADDRESS_HASH_KEY=00ff',
      'LEDGER_SIMULATOR_SECRET=whsec_kept',
      'LEDGER_URL=http://127.0.0.1:3200',
      'LEDGER_TOKEN=kept-token',
      '',
    ].join('\n');
    const { text, written } = mergeLocalEnv(before, generate);
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
      'AWS_REGION=us-east-2',
    ].join('\n');
    const { text, written } = mergeLocalEnv(before, generate);
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
        'AWS_REGION=us-east-2',
        'LEDGER_ADDRESS_HASH_KEY=generated-LEDGER_ADDRESS_HASH_KEY',
        '',
      ].join('\n'),
    );
  });

  it('reads `export NAME=value` and a commented-out name as the parser does, so neither is written twice nor lost', () => {
    const before = '# LEDGER_URL=http://example.invalid\nexport LEDGER_TOKEN=kept\n';
    const { text, written } = mergeLocalEnv(before, generate);
    expect(written).not.toContain('LEDGER_TOKEN');
    expect(written).toContain('LEDGER_URL');
    expect(text.startsWith(before)).toBe(true);
    expect(text).toContain('\nLEDGER_URL=generated-LEDGER_URL\n');
  });

  it('keeps CRLF line endings and the file text before the appended names', () => {
    const before = 'RESEND_API_KEY=re_kept\r\nLEDGER_URL=\r\n';
    const { text } = mergeLocalEnv(before, generate);
    expect(text.startsWith('RESEND_API_KEY=re_kept\r\nLEDGER_URL=generated-LEDGER_URL\r\n')).toBe(
      true,
    );
    expect(text.replaceAll('\r\n', '')).not.toContain('\n');
  });

  it('appends after a last line with no terminator without joining the two lines', () => {
    const { text } = mergeLocalEnv('RESEND_API_KEY=re_kept', generate);
    expect(text.split('\n')[0]).toBe('RESEND_API_KEY=re_kept');
    expect(text.split('\n')[1]).toBe('DATABASE_URL=generated-DATABASE_URL');
  });

  it('fills the last assignment of a repeated name, the one node --env-file uses', () => {
    const before = 'LEDGER_TOKEN=first\nLEDGER_TOKEN=\n';
    const { text, written } = mergeLocalEnv(before, generate);
    expect(written).toContain('LEDGER_TOKEN');
    expect(text.startsWith('LEDGER_TOKEN=first\nLEDGER_TOKEN=generated-LEDGER_TOKEN\n')).toBe(true);
  });
});
