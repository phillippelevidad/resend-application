import { apiUnavailable, type SdkError, type Token } from '@ledger/sdk';
import { FakeLedgerClient } from '@ledger/sdk/testing';
import { describe, expect, it } from 'vitest';
import { runCli } from '../testing/run-cli.ts';
import { databaseUnavailable, unauthorized, unknownCode } from '../testing/sdk-errors.ts';

// `ledger token current` against the fake SDK (pp-cli → cli-tests; design.md → Surfaces,
// `token.getCurrent`).

const current: Token = {
  object: 'token',
  token_id: 3,
  name: 'review-2026-10-20',
  scope: 'read',
  created_at: '2026-10-20T09:00:00.000Z',
  revoked_at: null,
};

const answering = () => new FakeLedgerClient({ tokensGetCurrent: { data: current, error: null } });
const failing = (error: SdkError) =>
  new FakeLedgerClient({ tokensGetCurrent: { data: null, error } });

describe('ledger token current', () => {
  it('--json prints exactly data as one document with the scope, exit 0', async () => {
    const client = answering();

    const result = await runCli(['token', 'current', '--json'], client);

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual(current);
    expect(JSON.parse(result.stdout)).toMatchObject({ object: 'token', scope: 'read' });
    expect(result.stderr).toBe('');
    expect(client.calls).toEqual([{ method: 'tokens.getCurrent' }]);
  });

  it('prints the token, name, scope and created lines, uncoloured, and exits 0', async () => {
    const result = await runCli(['token', 'current'], answering());

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).not.toContain('\u001b[');
    expect(result.stdout).toBe(
      [
        'token       3',
        'name        review-2026-10-20',
        'scope       read',
        'created     2026-10-20T09:00:00.000Z',
        '',
      ].join('\n'),
    );
  });

  it.each([
    ['unauthorized (a revoked token)', unauthorized],
    ['database_unavailable', databaseUnavailable()],
    ['api_unavailable', apiUnavailable],
    ['an unknown code', unknownCode],
  ])('--json prints %s as { error } on stdout and exits 1', async (_case, error) => {
    const result = await runCli(['token', 'current', '--json'], failing(error));

    expect(result.exitCode).toBe(1);
    expect(JSON.parse(result.stdout)).toEqual({ error });
    expect(result.stderr).toBe('');
  });

  it('a registry error without --json prints message and hint on stderr only, exit 1', async () => {
    const result = await runCli(['token', 'current'], failing(unauthorized));

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toBe(`${unauthorized.message}\nhint: ${unauthorized.hint}\n`);
  });

  it.each([
    [['token', 'current', '--bogus'], "unknown option '--bogus'"],
    [['token', 'current', '3'], 'too many arguments'],
  ])('a usage error (%j) exits 2 with no call and stdout empty', async (args, message) => {
    const client = answering();

    const result = await runCli(args, client);

    expect(result.exitCode).toBe(2);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain(message);
    expect(client.calls).toEqual([]);
  });

  it('a missing LEDGER_URL exits 2 naming it, with no call', async () => {
    const client = answering();

    const result = await runCli(['token', 'current'], client, {
      LEDGER_TOKEN: 'secret-token-value',
    });

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('LEDGER_URL');
    expect(result.stderr).not.toContain('secret-token-value');
    expect(client.calls).toEqual([]);
  });
});
