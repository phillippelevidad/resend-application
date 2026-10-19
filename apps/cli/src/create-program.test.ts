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
    expect(result.stdout).toMatch(/^ {2}health \[options\]/m);
    expect(result.stdout).toMatch(/^ {2}worker /m);
    expect(result.stdout).toMatch(/^ {2}token /m);
    expect(result.stdout).toMatch(/^ {2}dlq /m);
    expect(result.stderr).toBe('');
  });

  it('lists inspect and redrive for dlq --help', async () => {
    const dlq = await runCli(['dlq', '--help'], new FakeLedgerClient());

    expect(dlq.exitCode).toBe(0);
    expect(dlq.stdout).toMatch(/^ {2}inspect /m);
    expect(dlq.stdout).toMatch(/^ {2}redrive /m);
  });

  it('lists the token group commands for token --help and the worker one for worker --help', async () => {
    const token = await runCli(['token', '--help'], new FakeLedgerClient());
    const worker = await runCli(['worker', '--help'], new FakeLedgerClient());

    expect(token.exitCode).toBe(0);
    for (const command of ['create', 'list', 'revoke', 'current']) {
      expect(token.stdout).toMatch(new RegExp(`^ {2}${command} `, 'm'));
    }
    expect(worker.exitCode).toBe(0);
    expect(worker.stdout).toMatch(/^ {2}resume /m);
  });

  it('a group without a command is a usage error, exit 2, with no call', async () => {
    const client = new FakeLedgerClient();

    const result = await runCli(['token'], client);

    expect(result.exitCode).toBe(2);
    expect(result.stdout).toBe('');
    expect(client.calls).toEqual([]);
  });

  it('exits 2 with commander message on stderr for an unknown option', async () => {
    const result = await runCli(['--bogus'], new FakeLedgerClient());
    expect(result.exitCode).toBe(2);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain("unknown option '--bogus'");
  });
});
