import { apiUnavailable, type SdkError, type Token, type TokenList } from '@ledger/sdk';
import { FakeLedgerClient } from '@ledger/sdk/testing';
import { describe, expect, it } from 'vitest';
import { runCli } from '../testing/run-cli.ts';
import {
  databaseUnavailable,
  forbidden,
  unauthorized,
  unknownCode,
} from '../testing/sdk-errors.ts';
import { MORE_TOKENS_NOTICE } from './token-list.cli.ts';

// `ledger token list` against the fake SDK (pp-cli → cli-tests; design.md → Surfaces,
// `token.list`): the newest 100, and the stderr notice when more exist.

const token = (id: number, overrides: Partial<Token> = {}): Token => ({
  object: 'token',
  token_id: id,
  name: `review-${id}`,
  scope: 'read',
  created_at: '2026-10-20T09:00:00.000Z',
  revoked_at: null,
  ...overrides,
});

const page: TokenList = {
  object: 'list',
  has_more: false,
  data: [
    token(12, { name: 'review-2026-10-20' }),
    token(3, {
      name: 'bootstrap',
      scope: 'operate',
      created_at: '2026-10-17T12:00:00.000Z',
      revoked_at: '2026-10-19T08:30:00.000Z',
    }),
  ],
};

const answering = (data: TokenList) => new FakeLedgerClient({ tokensList: { data, error: null } });
const failing = (error: SdkError) => new FakeLedgerClient({ tokensList: { data: null, error } });

describe('ledger token list', () => {
  it('--json prints exactly data as one document, asks for the newest 100, and exits 0', async () => {
    const client = answering(page);

    const result = await runCli(['token', 'list', '--json'], client);

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual(page);
    expect(result.stderr).toBe('');
    expect(client.calls).toEqual([{ method: 'tokens.list', argument: { limit: 100 } }]);
  });

  it('prints one aligned row per token, — for a token never revoked, uncoloured', async () => {
    const result = await runCli(['token', 'list'], answering(page));

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).not.toContain('\u001b[');
    expect(result.stdout).toBe(
      [
        '  12   review-2026-10-20   read      2026-10-20T09:00:00.000Z   —',
        '  3    bootstrap           operate   2026-10-17T12:00:00.000Z   2026-10-19T08:30:00.000Z',
        '',
      ].join('\n'),
    );
  });

  it('lines a single read token up as the layout shows it', async () => {
    const one: TokenList = { ...page, data: [token(3, { name: 'review-2026-10-20' })] };

    const result = await runCli(['token', 'list'], answering(one));

    expect(result.stdout).toBe(
      '  3   review-2026-10-20   read      2026-10-20T09:00:00.000Z   —\n',
    );
  });

  const full: TokenList = {
    object: 'list',
    has_more: true,
    data: Array.from({ length: 100 }, (_, index) => token(200 - index)),
  };

  it('with has_more, prints 100 rows and the notice on stderr, exit 0', async () => {
    const result = await runCli(['token', 'list'], answering(full));

    expect(result.exitCode).toBe(0);
    expect(result.stdout.trimEnd().split('\n')).toHaveLength(100);
    expect(result.stderr).toBe(`${MORE_TOKENS_NOTICE}\n`);
    expect(result.stderr).toBe('ledger: more tokens exist; showing the newest 100.\n');
  });

  it('with has_more under --json, prints exactly data and leaves stderr empty', async () => {
    const result = await runCli(['token', 'list', '--json'], answering(full));

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual(full);
    expect(result.stderr).toBe('');
  });

  it('prints no notice when has_more is false', async () => {
    const result = await runCli(['token', 'list'], answering(page));

    expect(result.stderr).toBe('');
  });

  it.each([
    ['forbidden (a read token)', forbidden],
    ['unauthorized', unauthorized],
    ['database_unavailable', databaseUnavailable()],
    ['api_unavailable', apiUnavailable],
    ['an unknown code', unknownCode],
  ])('--json prints %s as { error } on stdout and exits 1', async (_case, error) => {
    const result = await runCli(['token', 'list', '--json'], failing(error));

    expect(result.exitCode).toBe(1);
    expect(JSON.parse(result.stdout)).toEqual({ error });
    expect(result.stderr).toBe('');
  });

  it('a registry error without --json prints message and hint on stderr only, exit 1', async () => {
    const result = await runCli(['token', 'list'], failing(forbidden));

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toBe(`${forbidden.message}\nhint: ${forbidden.hint}\n`);
  });

  it.each([
    [['token', 'list', '--limit', '5'], "unknown option '--limit'"],
    [['token', 'list', 'extra'], 'too many arguments'],
  ])('a usage error (%j) exits 2 with no call and stdout empty', async (args, message) => {
    const client = answering(page);

    const result = await runCli(args, client);

    expect(result.exitCode).toBe(2);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain(message);
    expect(client.calls).toEqual([]);
  });

  it('a missing LEDGER_URL exits 2 naming it, with no call', async () => {
    const client = answering(page);

    const result = await runCli(['token', 'list'], client, { LEDGER_TOKEN: 'secret-token-value' });

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('LEDGER_URL');
    expect(result.stderr).not.toContain('secret-token-value');
    expect(client.calls).toEqual([]);
  });
});
