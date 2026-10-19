import { apiUnavailable, type EventSource, type SdkError } from '@ledger/sdk';
import { FakeLedgerClient } from '@ledger/sdk/testing';
import { describe, expect, it } from 'vitest';
import { runCli } from '../testing/run-cli.ts';
import {
  databaseUnavailable,
  forbidden,
  unauthorized,
  unknownCode,
} from '../testing/sdk-errors.ts';

// `ledger worker resume` against the fake SDK (pp-cli → cli-tests; design.md → Surfaces,
// `worker.resumeEventSource`).

const alreadyEnabled: EventSource = { object: 'event_source', state: 'enabled', resumed: false };

const answering = (data: EventSource) =>
  new FakeLedgerClient({ workerResumeEventSource: { data, error: null } });
const failing = (error: SdkError) =>
  new FakeLedgerClient({ workerResumeEventSource: { data: null, error } });

const probeFailed = databaseUnavailable(
  'The database is unreachable or at its storage limit, so the event source stays paused.',
);

describe('ledger worker resume', () => {
  it('--json prints exactly data as one document and exits 0', async () => {
    const client = answering(alreadyEnabled);

    const result = await runCli(['worker', 'resume', '--json'], client);

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual(alreadyEnabled);
    expect(result.stderr).toBe('');
    expect(client.calls).toEqual([{ method: 'worker.resumeEventSource' }]);
  });

  it.each<[EventSource, string]>([
    [alreadyEnabled, 'worker      enabled (already enabled)\n'],
    [
      { object: 'event_source', state: 'changing', resumed: true },
      'worker      changing (resumed)\n',
    ],
    [
      { object: 'event_source', state: 'enabled', resumed: true },
      'worker      enabled (resumed)\n',
    ],
  ])('prints the human line for %j, uncoloured, and exits 0', async (data, line) => {
    const result = await runCli(['worker', 'resume'], answering(data));

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe(line);
    expect(result.stdout).not.toContain('\u001b[');
    expect(result.stderr).toBe('');
  });

  it.each([
    ['forbidden (a read token)', forbidden],
    ['database_unavailable (the probe failed)', probeFailed],
    ['unauthorized', unauthorized],
    ['api_unavailable', apiUnavailable],
    ['an unknown code', unknownCode],
  ])('--json prints %s as { error } on stdout and exits 1', async (_case, error) => {
    const result = await runCli(['worker', 'resume', '--json'], failing(error));

    expect(result.exitCode).toBe(1);
    expect(JSON.parse(result.stdout)).toEqual({ error });
    expect(result.stderr).toBe('');
  });

  it('a registry error without --json prints message and hint on stderr only, exit 1', async () => {
    const result = await runCli(['worker', 'resume'], failing(probeFailed));

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toBe(`${probeFailed.message}\nhint: ${probeFailed.hint}\n`);
  });

  it.each([
    [['worker', 'resume', 'now'], 'too many arguments'],
    [['worker', 'resume', '--bogus'], "unknown option '--bogus'"],
    [['worker', 'bogus'], "unknown command 'bogus'"],
  ])('a usage error (%j) exits 2 with no call and stdout empty', async (args, message) => {
    const client = answering(alreadyEnabled);

    const result = await runCli(args, client);

    expect(result.exitCode).toBe(2);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain(message);
    expect(client.calls).toEqual([]);
  });

  it('a missing LEDGER_URL exits 2 naming it, with no call', async () => {
    const client = answering(alreadyEnabled);

    const result = await runCli(['worker', 'resume'], client, {
      LEDGER_TOKEN: 'secret-token-value',
    });

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('LEDGER_URL');
    expect(result.stderr).not.toContain('secret-token-value');
    expect(client.calls).toEqual([]);
  });
});
