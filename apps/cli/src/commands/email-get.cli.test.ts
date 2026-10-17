import { apiUnavailable, type Email, type SdkError } from '@ledger/sdk';
import { FakeLedgerClient } from '@ledger/sdk/testing';
import { describe, expect, it } from 'vitest';
import { runCli } from '../testing/run-cli.ts';

// `ledger email` against the fake SDK: exit codes, the bytes on stdout and stderr, and that a usage
// error never calls the SDK (pp-cli → cli-tests; Ships 8).

const bouncedEmail: Email = {
  object: 'email',
  email_id: 'walk-probe',
  status: 'bounced',
  from_masked: 'A*** <onb*******@r*****.d**>',
  subject_masked: 'Y*** re*****',
  open_count: 0,
  click_count: 2,
  first_opened_at: null,
  first_clicked_at: '2026-10-17T12:00:03.000Z',
  last_event_at: '2026-10-17T12:00:03.000Z',
  event_count: 4,
  recipients: [
    {
      address_masked: 'bo*****@r*****.d**',
      status: 'bounced',
      status_at: '2026-10-17T12:00:02.000Z',
      bounce_type: 'Permanent',
      bounce_sub_type: 'General',
    },
    {
      address_masked: 'del******@r*****.d**',
      status: 'delivered',
      status_at: '2026-10-17T12:00:01.000Z',
      bounce_type: null,
      bounce_sub_type: null,
    },
  ],
  timeline: [
    {
      svix_id: 'msg_1',
      type: 'email.sent',
      event_created_at: '2026-10-17T12:00:00.000Z',
      bounce_type: null,
      bounce_sub_type: null,
    },
    {
      svix_id: 'msg_2',
      type: 'email.delivered',
      event_created_at: '2026-10-17T12:00:01.000Z',
      bounce_type: null,
      bounce_sub_type: null,
    },
    {
      svix_id: 'msg_3',
      type: 'email.bounced',
      event_created_at: '2026-10-17T12:00:02.000Z',
      bounce_type: 'Permanent',
      bounce_sub_type: 'General',
    },
    {
      svix_id: 'msg_4',
      type: 'email.clicked',
      event_created_at: null,
      bounce_type: null,
      bounce_sub_type: null,
    },
  ],
};

const emailNotFound: SdkError = {
  code: 'email_not_found',
  message: 'No event has been recorded for this email id.',
  hint: 'Events may still be queued, or missed: run `ledger gaps`.',
  docs: 'https://github.com/phillippelevidad/resend-application/blob/main/docs/runbook.md#email_not_found',
};

const found = () => new FakeLedgerClient({ emailsGet: { data: bouncedEmail, error: null } });
const failing = (error: SdkError) => new FakeLedgerClient({ emailsGet: { data: null, error } });

describe('ledger email', () => {
  it('--json prints exactly data as one document and exits 0', async () => {
    const client = found();

    const result = await runCli(['email', 'walk-probe', '--json'], client);

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual(bouncedEmail);
    expect(result.stderr).toBe('');
    expect(client.calls).toEqual([{ method: 'emails.get', argument: 'walk-probe' }]);
  });

  it('prints the human layout, uncoloured, and exits 0', async () => {
    const result = await runCli(['email', 'walk-probe'], found());

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).not.toContain('\u001b[');
    expect(result.stdout).toBe(
      [
        'email       walk-probe',
        'status      bounced',
        'from        A*** <onb*******@r*****.d**>',
        'subject     Y*** re*****',
        'events      4, last 2026-10-17T12:00:03.000Z',
        'opens       0',
        'clicks      2, first 2026-10-17T12:00:03.000Z',
        '',
        'recipients',
        '  bo*****@r*****.d**     bounced     2026-10-17T12:00:02.000Z   Permanent / General',
        '  del******@r*****.d**   delivered   2026-10-17T12:00:01.000Z',
        '',
        'timeline',
        '  2026-10-17T12:00:00.000Z   email.sent        msg_1',
        '  2026-10-17T12:00:01.000Z   email.delivered   msg_2',
        '  2026-10-17T12:00:02.000Z   email.bounced     msg_3   Permanent / General',
        '  —                          email.clicked     msg_4',
        '',
      ].join('\n'),
    );
  });

  it('prints null as — and an empty section as  —', async () => {
    const unprojected: Email = {
      ...bouncedEmail,
      status: null,
      from_masked: null,
      subject_masked: null,
      click_count: 0,
      first_clicked_at: null,
      last_event_at: null,
      recipients: [],
      timeline: [],
    };
    const client = new FakeLedgerClient({ emailsGet: { data: unprojected, error: null } });

    const result = await runCli(['email', 'walk-probe'], client);

    expect(result.stdout).toContain('status      —\n');
    expect(result.stdout).toContain('from        —\n');
    expect(result.stdout).toContain('events      4, last —\n');
    expect(result.stdout).toContain('recipients\n  —\n\ntimeline\n  —\n');
  });

  it('maps a control character in a bounce type to * and prints no ESC', async () => {
    const recipient = bouncedEmail.recipients[0];
    if (!recipient) throw new TypeError('fixture has a recipient');
    const hostile: Email = {
      ...bouncedEmail,
      recipients: [{ ...recipient, bounce_type: '\u001b[31mPermanent\u0007\u009b' }],
    };
    const client = new FakeLedgerClient({ emailsGet: { data: hostile, error: null } });

    const result = await runCli(['email', 'walk-probe'], client);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('*[31mPermanent** / General');
    // No C0 (but the line feed), DEL or C1 code point anywhere on stdout.
    const controls = [...result.stdout].filter((char) => {
      const code = char.codePointAt(0) ?? 0;
      return (code <= 0x1f && code !== 0x0a) || (code >= 0x7f && code <= 0x9f);
    });
    expect(controls).toEqual([]);
  });

  it('--json on a registry error prints exactly { error } on stdout and exits 1', async () => {
    const result = await runCli(['email', 'no-such-email', '--json'], failing(emailNotFound));

    expect(result.exitCode).toBe(1);
    expect(JSON.parse(result.stdout)).toEqual({ error: emailNotFound });
    expect(result.stderr).toBe('');
  });

  it('a registry error without --json prints message and hint on stderr only, exit 1', async () => {
    const result = await runCli(['email', 'no-such-email'], failing(emailNotFound));

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toBe(
      'No event has been recorded for this email id.\nhint: Events may still be queued, or missed: run `ledger gaps`.\n',
    );
  });

  it('prints an unknown code as received and exits 1', async () => {
    const unknown: SdkError = {
      code: 'not_in_registry',
      message: 'm',
      hint: 'h',
      docs: 'https://d',
    };

    const result = await runCli(['email', 'walk-probe', '--json'], failing(unknown));

    expect(result.exitCode).toBe(1);
    expect(JSON.parse(result.stdout)).toEqual({ error: unknown });
  });

  it('prints api_unavailable as received and exits 1', async () => {
    const result = await runCli(['email', 'walk-probe', '--json'], failing(apiUnavailable));

    expect(result.exitCode).toBe(1);
    expect(JSON.parse(result.stdout)).toEqual({ error: apiUnavailable });
  });

  it.each([
    [['email'], "missing required argument 'email_id'"],
    [['email', '--json'], "missing required argument 'email_id'"],
    [['email', 'walk-probe', '--bogus'], "unknown option '--bogus'"],
  ])('a usage error (%j) exits 2 with no call and stdout empty', async (args, message) => {
    const client = found();

    const result = await runCli(args, client);

    expect(result.exitCode).toBe(2);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain(message);
    expect(client.calls).toEqual([]);
  });

  it('a missing LEDGER_URL exits 2 naming it, with no call and no other value', async () => {
    const client = found();

    const result = await runCli(['email', 'walk-probe', '--json'], client, {
      LEDGER_TOKEN: 'secret-token-value',
    });

    expect(result.exitCode).toBe(2);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('LEDGER_URL');
    expect(result.stderr).not.toContain('secret-token-value');
    expect(client.calls).toEqual([]);
  });

  it('an invalid LEDGER_URL or empty LEDGER_TOKEN exits 2 naming each, never its value', async () => {
    const client = found();

    const result = await runCli(['email', 'walk-probe'], client, {
      LEDGER_URL: 'not-a-url-secret-value',
      LEDGER_TOKEN: '',
    });

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('LEDGER_URL');
    expect(result.stderr).toContain('LEDGER_TOKEN');
    expect(result.stderr).not.toContain('not-a-url-secret-value');
    expect(client.calls).toEqual([]);
  });

  it('a defect under --json exits 1 with internal_error on stdout and no exception text', async () => {
    const client = new FakeLedgerClient({
      emailsGet: () => {
        throw new TypeError('boom at a secret place');
      },
    });

    const result = await runCli(['email', 'walk-probe', '--json'], client);

    expect(result.exitCode).toBe(1);
    expect(JSON.parse(result.stdout).error.code).toBe('internal_error');
    expect(result.stdout + result.stderr).not.toContain('boom');
  });

  it('a defect without --json exits 1 with the constant line and no exception text', async () => {
    const client = new FakeLedgerClient({
      emailsGet: () => {
        throw new TypeError('boom at a secret place');
      },
    });

    const result = await runCli(['email', 'walk-probe'], client);

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toBe('ledger: unexpected failure.\n');
  });
});
