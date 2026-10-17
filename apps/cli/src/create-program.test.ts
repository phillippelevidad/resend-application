import { FakeLedgerClient } from '@ledger/sdk/testing';
import { describe, expect, it } from 'vitest';
import { runCli } from './testing/run-cli.ts';

describe('ledger program', () => {
  it('prints help listing every command on stdout and exits 0 for --help', async () => {
    const result = await runCli(['--help'], new FakeLedgerClient());
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Usage: ledger');
    expect(result.stdout).toMatch(/^ {2}email \[options\] <email_id>/m);
    expect(result.stdout).toMatch(/^ {2}recipient \[options\] <address>/m);
    expect(result.stderr).toBe('');
  });

  it('exits 2 with commander message on stderr for an unknown option', async () => {
    const result = await runCli(['--bogus'], new FakeLedgerClient());
    expect(result.exitCode).toBe(2);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain("unknown option '--bogus'");
  });
});
