import { apiUnavailable, type DlqRedrive, type SdkError } from '@ledger/sdk';
import { FakeLedgerClient } from '@ledger/sdk/testing';
import { describe, expect, it } from 'vitest';
import { runCli } from '../testing/run-cli.ts';
import {
  databaseUnavailable,
  forbidden,
  redriveInProgress,
  unauthorized,
  unknownCode,
} from '../testing/sdk-errors.ts';

// `ledger dlq redrive` against the fake SDK (pp-cli → cli-tests; design.md → Surfaces,
// `dlq.startRedrive`): one call, returning at once, nothing to poll.

const started: DlqRedrive = { object: 'dlq_redrive', status: 'started', depth: 3 };
const empty: DlqRedrive = { object: 'dlq_redrive', status: 'empty', depth: 0 };

const answering = (data: DlqRedrive) =>
  new FakeLedgerClient({ dlqStartRedrive: { data, error: null } });
const failing = (error: SdkError) =>
  new FakeLedgerClient({ dlqStartRedrive: { data: null, error } });

describe('ledger dlq redrive', () => {
  it('--json prints exactly data as one document after one call, and exits 0', async () => {
    const client = answering(started);

    const result = await runCli(['dlq', 'redrive', '--json'], client);

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual(started);
    expect(result.stderr).toBe('');
    expect(client.calls).toEqual([{ method: 'dlq.startRedrive' }]);
  });

  it.each<[DlqRedrive, string]>([
    [
      started,
      'redrive     started: 3 message(s) moving back to the queue; watch the dlq depth with ledger health\n',
    ],
    [
      { ...started, depth: 1 },
      'redrive     started: 1 message(s) moving back to the queue; watch the dlq depth with ledger health\n',
    ],
    [empty, 'redrive     nothing to move: the dlq is empty\n'],
  ])('prints the human line for %j, uncoloured, and exits 0', async (data, line) => {
    const client = answering(data);

    const result = await runCli(['dlq', 'redrive'], client);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe(line);
    expect(result.stdout).not.toContain('\u001b[');
    expect(result.stderr).toBe('');
    expect(client.calls).toEqual([{ method: 'dlq.startRedrive' }]);
  });

  it.each([
    ['redrive_in_progress (a task is running)', redriveInProgress],
    ['forbidden (a read token)', forbidden],
    ['unauthorized', unauthorized],
    ['database_unavailable', databaseUnavailable()],
    ['api_unavailable', apiUnavailable],
    ['an unknown code', unknownCode],
  ])('--json prints %s as { error } on stdout and exits 1', async (_case, error) => {
    const result = await runCli(['dlq', 'redrive', '--json'], failing(error));

    expect(result.exitCode).toBe(1);
    expect(JSON.parse(result.stdout)).toEqual({ error });
    expect(result.stderr).toBe('');
  });

  it.each([
    ['forbidden', forbidden],
    ['redrive_in_progress', redriveInProgress],
  ])('%s without --json prints message and hint on stderr only, exit 1', async (_case, error) => {
    const result = await runCli(['dlq', 'redrive'], failing(error));

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toBe(`${error.message}\nhint: ${error.hint}\n`);
  });

  it.each([
    [['dlq', 'redrive', '--no-wait'], "unknown option '--no-wait'"],
    [['dlq', 'redrive', 'now'], 'too many arguments'],
  ])('a usage error (%j) exits 2 with no call and stdout empty', async (args, message) => {
    const client = answering(started);

    const result = await runCli(args, client);

    expect(result.exitCode).toBe(2);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain(message);
    expect(client.calls).toEqual([]);
  });

  it('a missing LEDGER_URL exits 2 naming it, with no call', async () => {
    const client = answering(started);

    const result = await runCli(['dlq', 'redrive'], client, { LEDGER_TOKEN: 'secret-token-value' });

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('LEDGER_URL');
    expect(result.stderr).not.toContain('secret-token-value');
    expect(client.calls).toEqual([]);
  });
});
