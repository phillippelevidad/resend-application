import { apiUnavailable, type CreatedToken, type SdkError } from '@ledger/sdk';
import { FakeLedgerClient } from '@ledger/sdk/testing';
import { describe, expect, it } from 'vitest';
import { runCli } from '../testing/run-cli.ts';
import {
  databaseUnavailable,
  forbidden,
  unauthorized,
  unknownCode,
  validationFailed,
} from '../testing/sdk-errors.ts';
import { TOKEN_SHOWN_ONCE_NOTICE } from './token-create.cli.ts';

// `ledger token create` against the fake SDK (pp-cli → cli-tests; design.md → Surfaces,
// `token.create`): the plaintext lands on stdout exactly once and never on stderr.

const PLAINTEXT = `ldg_${'a1'.repeat(32)}_${'b2'.repeat(32)}`;

const created: CreatedToken = {
  object: 'token',
  token_id: 3,
  name: 'review-2026-10-20',
  scope: 'read',
  created_at: '2026-10-20T09:00:00.000Z',
  revoked_at: null,
  token: PLAINTEXT,
};

const ARGS = ['token', 'create', '--name', 'review-2026-10-20', '--scope', 'read'];

const answering = () => new FakeLedgerClient({ tokensCreate: { data: created, error: null } });
const failing = (error: SdkError) => new FakeLedgerClient({ tokensCreate: { data: null, error } });

const occurrences = (text: string, part: string): number => text.split(part).length - 1;

describe('ledger token create', () => {
  it('--json prints exactly data, the plaintext once on stdout, and nothing on stderr', async () => {
    const client = answering();

    const result = await runCli([...ARGS, '--json'], client);

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual(created);
    expect(occurrences(result.stdout, PLAINTEXT)).toBe(1);
    expect(result.stderr).toBe('');
    expect(client.calls).toEqual([
      { method: 'tokens.create', argument: { name: 'review-2026-10-20', scope: 'read' } },
    ]);
  });

  it('prints the human layout with the secret once on stdout, the notice on stderr, exit 0', async () => {
    const result = await runCli(ARGS, answering());

    expect(result.exitCode).toBe(0);
    expect(result.stdout).not.toContain('\u001b[');
    expect(result.stdout).toBe(
      [
        'token       3',
        'name        review-2026-10-20',
        'scope       read',
        'created     2026-10-20T09:00:00.000Z',
        `secret      ${PLAINTEXT}`,
        '',
      ].join('\n'),
    );
    expect(occurrences(result.stdout, PLAINTEXT)).toBe(1);
    expect(result.stderr).toBe(`${TOKEN_SHOWN_ONCE_NOTICE}\n`);
    expect(result.stderr).toBe('ledger: this is the only time the token is shown; store it now.\n');
  });

  it.each([[[]], [['--json']]])(
    'never writes any part of the plaintext to stderr (%j)',
    async (flags) => {
      const result = await runCli([...ARGS, ...flags], answering());

      for (const part of PLAINTEXT.split('_')) {
        expect(result.stderr).not.toContain(part);
      }
    },
  );

  it('passes the scope through unchecked: the API answers validation_failed, exit 1', async () => {
    const invalid = validationFailed('scope must be read or operate.');
    const client = failing(invalid);

    const result = await runCli(
      ['token', 'create', '--name', 'ok', '--scope', 'admin', '--json'],
      client,
    );

    expect(client.calls).toEqual([
      { method: 'tokens.create', argument: { name: 'ok', scope: 'admin' } },
    ]);
    expect(result.exitCode).toBe(1);
    expect(JSON.parse(result.stdout)).toEqual({ error: invalid });
  });

  it.each([
    ['forbidden (a read token)', forbidden],
    ['unauthorized', unauthorized],
    ['database_unavailable', databaseUnavailable()],
    ['api_unavailable', apiUnavailable],
    ['an unknown code', unknownCode],
  ])('--json prints %s as { error } on stdout, no notice, and exits 1', async (_case, error) => {
    const result = await runCli([...ARGS, '--json'], failing(error));

    expect(result.exitCode).toBe(1);
    expect(JSON.parse(result.stdout)).toEqual({ error });
    expect(result.stderr).toBe('');
  });

  it('a registry error without --json prints message and hint on stderr only, exit 1', async () => {
    const result = await runCli(ARGS, failing(forbidden));

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toBe(`${forbidden.message}\nhint: ${forbidden.hint}\n`);
  });

  it.each([
    [['token', 'create', '--name', 'review-walk'], "required option '--scope <read|operate>'"],
    [['token', 'create', '--scope', 'read'], "required option '--name <name>'"],
    [[...ARGS, '--bogus'], "unknown option '--bogus'"],
    [[...ARGS, 'extra'], 'too many arguments'],
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

    const result = await runCli(ARGS, client, { LEDGER_TOKEN: 'secret-token-value' });

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('LEDGER_URL');
    expect(result.stderr).not.toContain('secret-token-value');
    expect(client.calls).toEqual([]);
  });
});
