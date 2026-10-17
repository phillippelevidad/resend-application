import { apiUnavailable, type Recipient, type SdkError } from '@ledger/sdk';
import { FakeLedgerClient } from '@ledger/sdk/testing';
import { describe, expect, it } from 'vitest';
import { runCli } from '../testing/run-cli.ts';

// `ledger recipient` against the fake SDK: exit codes, the bytes on stdout and stderr, the address
// reaching the SDK as the argument and never echoed (pp-cli → cli-tests; Ships 8).

const ADDRESS = 'bounced@resend.dev';

const hardBounced: Recipient = {
  object: 'recipient',
  address_masked: 'bo*****@r*****.d**',
  deliverability: 'hard_bounced',
  since: '2026-10-17T12:00:02.000Z',
  cause_email_id: 'walk-probe',
};

const recipientNotFound: SdkError = {
  code: 'recipient_not_found',
  message: 'No event has ever named this address.',
  hint: 'Check the address. If it was emailed recently, run `ledger gaps`.',
  docs: 'https://github.com/phillippelevidad/resend-application/blob/main/docs/runbook.md#recipient_not_found',
};

const found = () => new FakeLedgerClient({ recipientsGet: { data: hardBounced, error: null } });
const failing = (error: SdkError) => new FakeLedgerClient({ recipientsGet: { data: null, error } });

describe('ledger recipient', () => {
  it('--json prints exactly data as one document and exits 0', async () => {
    const result = await runCli(['recipient', ADDRESS, '--json'], found());

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual(hardBounced);
    expect(result.stderr).toBe('');
  });

  it('prints the human layout, uncoloured, and exits 0', async () => {
    const result = await runCli(['recipient', ADDRESS], found());

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).not.toContain('\u001b[');
    expect(result.stdout).toBe(
      [
        'recipient        bo*****@r*****.d**',
        'deliverability   hard_bounced',
        'since            2026-10-17T12:00:02.000Z',
        'caused by        walk-probe',
        '',
      ].join('\n'),
    );
  });

  it('prints null as —', async () => {
    const client = new FakeLedgerClient({
      recipientsGet: {
        data: { ...hardBounced, deliverability: 'ok', since: null, cause_email_id: null },
        error: null,
      },
    });

    const result = await runCli(['recipient', 'delivered@resend.dev'], client);

    expect(result.stdout).toContain('since            —\ncaused by        —\n');
  });

  it.each([[[]], [['--json']]])(
    'passes the address to the SDK as the argument and never prints it (%j)',
    async (flags) => {
      const client = found();

      const result = await runCli(['recipient', ADDRESS, ...flags], client);

      expect(client.calls).toEqual([{ method: 'recipients.get', argument: ADDRESS }]);
      expect(result.stdout).toContain('bo*****@r*****.d**');
      expect(result.stdout + result.stderr).not.toContain(ADDRESS);
    },
  );

  it('never prints the address on a registry error either', async () => {
    const result = await runCli(['recipient', ADDRESS], failing(recipientNotFound));

    expect(result.stdout + result.stderr).not.toContain(ADDRESS);
  });

  it('--json on a registry error prints exactly { error } on stdout and exits 1', async () => {
    const result = await runCli(['recipient', ADDRESS, '--json'], failing(recipientNotFound));

    expect(result.exitCode).toBe(1);
    expect(JSON.parse(result.stdout)).toEqual({ error: recipientNotFound });
    expect(result.stderr).toBe('');
  });

  it('a registry error without --json prints message and hint on stderr only, exit 1', async () => {
    const result = await runCli(['recipient', ADDRESS], failing(recipientNotFound));

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toBe(
      'No event has ever named this address.\nhint: Check the address. If it was emailed recently, run `ledger gaps`.\n',
    );
  });

  it('prints an unknown code as received and exits 1', async () => {
    const unknown: SdkError = {
      code: 'not_in_registry',
      message: 'm',
      hint: 'h',
      docs: 'https://d',
    };

    const result = await runCli(['recipient', ADDRESS, '--json'], failing(unknown));

    expect(result.exitCode).toBe(1);
    expect(JSON.parse(result.stdout)).toEqual({ error: unknown });
  });

  it('prints api_unavailable as received and exits 1', async () => {
    const result = await runCli(['recipient', ADDRESS, '--json'], failing(apiUnavailable));

    expect(result.exitCode).toBe(1);
    expect(JSON.parse(result.stdout)).toEqual({ error: apiUnavailable });
  });

  it.each([
    [['recipient'], "missing required argument 'address'"],
    [['recipient', ADDRESS, '--bogus'], "unknown option '--bogus'"],
  ])('a usage error (%j) exits 2 with no call and stdout empty', async (args, message) => {
    const client = found();

    const result = await runCli(args, client);

    expect(result.exitCode).toBe(2);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain(message);
    expect(client.calls).toEqual([]);
  });

  it('a missing LEDGER_URL exits 2 naming it, with no call', async () => {
    const client = found();

    const result = await runCli(['recipient', ADDRESS, '--json'], client, {
      LEDGER_TOKEN: 'secret-token-value',
    });

    expect(result.exitCode).toBe(2);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('LEDGER_URL');
    expect(result.stderr).not.toContain('secret-token-value');
    expect(result.stderr).not.toContain(ADDRESS);
    expect(client.calls).toEqual([]);
  });

  it('a defect under --json exits 1 with internal_error on stdout', async () => {
    const client = new FakeLedgerClient({
      recipientsGet: () => {
        throw new TypeError('boom');
      },
    });

    const result = await runCli(['recipient', ADDRESS, '--json'], client);

    expect(result.exitCode).toBe(1);
    expect(JSON.parse(result.stdout).error.code).toBe('internal_error');
    expect(result.stdout + result.stderr).not.toContain('boom');
  });
});
