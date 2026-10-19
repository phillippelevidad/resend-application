import { apiUnavailable, type DlqMessageList, type SdkError } from '@ledger/sdk';
import { FakeLedgerClient } from '@ledger/sdk/testing';
import { describe, expect, it } from 'vitest';
import { runCli } from '../testing/run-cli.ts';
import {
  databaseUnavailable,
  unauthorized,
  unknownCode,
  validationFailed,
} from '../testing/sdk-errors.ts';
import { DLQ_LOGS_NOTICE } from './dlq-list-messages.cli.ts';

// `ledger dlq inspect` against the fake SDK (pp-cli → cli-tests; design.md → Surfaces,
// `dlq.listMessages`): the `dlq` line, one row per item with `—` for a null field, and the stderr
// notice only for a human run on a non-empty DLQ.

const sample: DlqMessageList = {
  object: 'list',
  has_more: false,
  depth: 2,
  data: [
    {
      object: 'dlq_message',
      svix_id: 'msg_dlq_cli_01',
      type: 'email.delivered',
      email_id: 'em_dlq_cli_01',
      event_created_at: '2026-10-19T12:00:00.000Z',
      enqueued_at: '2026-10-19T12:00:01.000Z',
      receive_count: 6,
    },
    // An unreadable body: every field null but its receive count (D5).
    {
      object: 'dlq_message',
      svix_id: null,
      type: null,
      email_id: null,
      event_created_at: null,
      enqueued_at: null,
      receive_count: 7,
    },
  ],
};

const empty: DlqMessageList = { object: 'list', has_more: false, depth: 0, data: [] };

const answering = (data: DlqMessageList) =>
  new FakeLedgerClient({ dlqListMessages: { data, error: null } });
const failing = (error: SdkError) =>
  new FakeLedgerClient({ dlqListMessages: { data: null, error } });

const pad = (count: number): string => ' '.repeat(count);

describe('ledger dlq inspect', () => {
  it('--json prints exactly data as one document, sends no limit, leaves stderr empty, and exits 0', async () => {
    const client = answering(sample);

    const result = await runCli(['dlq', 'inspect', '--json'], client);

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual(sample);
    expect(result.stderr).toBe('');
    expect(client.calls).toEqual([{ method: 'dlq.listMessages', argument: {} }]);
  });

  it('--limit 5 reaches the SDK as the integer 5', async () => {
    const client = answering(sample);

    const result = await runCli(['dlq', 'inspect', '--limit', '5', '--json'], client);

    expect(result.exitCode).toBe(0);
    expect(client.calls).toEqual([{ method: 'dlq.listMessages', argument: { limit: 5 } }]);
  });

  it('prints the dlq line and one aligned row per item, — for each null field, and the notice on stderr', async () => {
    const result = await runCli(['dlq', 'inspect'], answering(sample));

    expect(result.exitCode).toBe(0);
    expect(result.stdout).not.toContain('\u001b[');
    expect(result.stdout).toBe(
      [
        'dlq         2 message(s), showing 2',
        'msg_dlq_cli_01  email.delivered  email em_dlq_cli_01  created 2026-10-19T12:00:00.000Z  enqueued 2026-10-19T12:00:01.000Z  receives 6',
        `—${pad(15)}—${pad(16)}email —${pad(14)}created —${pad(25)}enqueued —${pad(25)}receives 7`,
        '',
      ].join('\n'),
    );
    expect(result.stderr).toBe(`${DLQ_LOGS_NOTICE}\n`);
    expect(result.stderr).toBe(
      'why each failed is in the worker logs under its svix_id (runbook: LedgerApp-dlq-depth)\n',
    );
  });

  it('with has_more, the dlq line reads showing <n> of <depth>', async () => {
    const result = await runCli(
      ['dlq', 'inspect'],
      answering({ ...sample, has_more: true, depth: 5 }),
    );

    expect(result.exitCode).toBe(0);
    expect(result.stdout.split('\n')[0]).toBe('dlq         5 message(s), showing 2 of 5');
    expect(result.stderr).toBe(`${DLQ_LOGS_NOTICE}\n`);
  });

  it('an empty DLQ prints dlq empty and nothing on stderr', async () => {
    const result = await runCli(['dlq', 'inspect'], answering(empty));

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('dlq         empty\n');
    expect(result.stderr).toBe('');
  });

  it('an empty DLQ under --json prints exactly data', async () => {
    const result = await runCli(['dlq', 'inspect', '--json'], answering(empty));

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual(empty);
    expect(result.stderr).toBe('');
  });

  it('an out-of-range --limit reaches the SDK, and its validation_failed exits 1', async () => {
    const outOfRange = validationFailed('limit must be an integer from 1 to 10.');
    const client = failing(outOfRange);

    const result = await runCli(['dlq', 'inspect', '--limit', '11', '--json'], client);

    expect(result.exitCode).toBe(1);
    expect(JSON.parse(result.stdout)).toEqual({ error: outOfRange });
    expect(result.stderr).toBe('');
    expect(client.calls).toEqual([{ method: 'dlq.listMessages', argument: { limit: 11 } }]);
  });

  it.each([
    ['unauthorized', unauthorized],
    ['database_unavailable', databaseUnavailable()],
    ['api_unavailable', apiUnavailable],
    ['an unknown code', unknownCode],
  ])('--json prints %s as { error } on stdout and exits 1', async (_case, error) => {
    const result = await runCli(['dlq', 'inspect', '--json'], failing(error));

    expect(result.exitCode).toBe(1);
    expect(JSON.parse(result.stdout)).toEqual({ error });
    expect(result.stderr).toBe('');
  });

  it('a registry error without --json prints message and hint on stderr only, exit 1', async () => {
    const result = await runCli(['dlq', 'inspect'], failing(unauthorized));

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toBe(`${unauthorized.message}\nhint: ${unauthorized.hint}\n`);
  });

  it.each([
    [['dlq', 'inspect', '--limit', 'abc'], "argument 'abc' is invalid"],
    [['dlq', 'inspect', '--limit', '2.5'], "argument '2.5' is invalid"],
    [['dlq', 'inspect', '--limit'], "option '--limit <1-10>' argument missing"],
    [['dlq', 'inspect', '--all'], "unknown option '--all'"],
    [['dlq', 'inspect', 'extra'], 'too many arguments'],
  ])('a usage error (%j) exits 2 with no call and stdout empty', async (args, message) => {
    const client = answering(sample);

    const result = await runCli(args, client);

    expect(result.exitCode).toBe(2);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain(message);
    expect(client.calls).toEqual([]);
  });

  it('a missing LEDGER_URL exits 2 naming it, with no call', async () => {
    const client = answering(sample);

    const result = await runCli(['dlq', 'inspect'], client, { LEDGER_TOKEN: 'secret-token-value' });

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('LEDGER_URL');
    expect(result.stderr).not.toContain('secret-token-value');
    expect(client.calls).toEqual([]);
  });
});
