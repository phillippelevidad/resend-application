import { apiUnavailable, type SdkError, type Token } from '@ledger/sdk';
import { FakeLedgerClient } from '@ledger/sdk/testing';
import { describe, expect, it } from 'vitest';
import { runCli } from '../testing/run-cli.ts';
import {
  databaseUnavailable,
  forbidden,
  lastOperateToken,
  tokenNotFound,
  unauthorized,
  unknownCode,
  validationFailed,
} from '../testing/sdk-errors.ts';

// `ledger token revoke <token_id>` against the fake SDK (pp-cli → cli-tests; design.md → Surfaces,
// `token.revoke`).

const revoked: Token = {
  object: 'token',
  token_id: 3,
  name: 'review-2026-10-20',
  scope: 'read',
  created_at: '2026-10-20T09:00:00.000Z',
  revoked_at: '2026-10-21T10:15:00.000Z',
};

const answering = () => new FakeLedgerClient({ tokensRevoke: { data: revoked, error: null } });
const failing = (error: SdkError) => new FakeLedgerClient({ tokensRevoke: { data: null, error } });

describe('ledger token revoke', () => {
  it('--json prints exactly data as one document, the id passed as given, exit 0', async () => {
    const client = answering();

    const result = await runCli(['token', 'revoke', '3', '--json'], client);

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual(revoked);
    expect(result.stderr).toBe('');
    expect(client.calls).toEqual([{ method: 'tokens.revoke', argument: '3' }]);
  });

  it('prints the token lines plus revoked, uncoloured, and exits 0', async () => {
    const result = await runCli(['token', 'revoke', '3'], answering());

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).not.toContain('\u001b[');
    expect(result.stdout).toBe(
      [
        'token       3',
        'name        review-2026-10-20',
        'scope       read',
        'created     2026-10-20T09:00:00.000Z',
        'revoked     2026-10-21T10:15:00.000Z',
        '',
      ].join('\n'),
    );
  });

  it('passes a malformed id through unchecked: the API answers validation_failed, exit 1', async () => {
    const invalid = validationFailed('token_id must be a positive integer.');
    const client = failing(invalid);

    const result = await runCli(['token', 'revoke', 'abc', '--json'], client);

    expect(client.calls).toEqual([{ method: 'tokens.revoke', argument: 'abc' }]);
    expect(result.exitCode).toBe(1);
    expect(JSON.parse(result.stdout)).toEqual({ error: invalid });
  });

  it.each([
    ['last_operate_token', lastOperateToken],
    ['token_not_found', tokenNotFound],
    ['forbidden (a read token)', forbidden],
    ['unauthorized', unauthorized],
    ['database_unavailable', databaseUnavailable()],
    ['api_unavailable', apiUnavailable],
    ['an unknown code', unknownCode],
  ])('--json prints %s as { error } on stdout and exits 1', async (_case, error) => {
    const result = await runCli(['token', 'revoke', '1', '--json'], failing(error));

    expect(result.exitCode).toBe(1);
    expect(JSON.parse(result.stdout)).toEqual({ error });
    expect(result.stderr).toBe('');
  });

  it('a registry error without --json prints message and hint on stderr only, exit 1', async () => {
    const result = await runCli(['token', 'revoke', '1'], failing(lastOperateToken));

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toBe(`${lastOperateToken.message}\nhint: ${lastOperateToken.hint}\n`);
  });

  it.each([
    [['token', 'revoke'], "missing required argument 'token_id'"],
    [['token', 'revoke', '--json'], "missing required argument 'token_id'"],
    [['token', 'revoke', '3', '--bogus'], "unknown option '--bogus'"],
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

    const result = await runCli(['token', 'revoke', '3'], client, {
      LEDGER_TOKEN: 'secret-token-value',
    });

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('LEDGER_URL');
    expect(result.stderr).not.toContain('secret-token-value');
    expect(client.calls).toEqual([]);
  });
});
