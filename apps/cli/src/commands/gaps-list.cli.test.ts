import {
  apiUnavailable,
  type ReconcileRun,
  type ReconcileRunList,
  type SdkError,
} from '@ledger/sdk';
import { FakeLedgerClient } from '@ledger/sdk/testing';
import { describe, expect, it } from 'vitest';
import { runCli } from '../testing/run-cli.ts';
import { unauthorized, unknownCode, validationFailed } from '../testing/sdk-errors.ts';
import { MORE_RUNS_NOTICE } from './gaps-list.cli.ts';

// `ledger gaps` against the fake SDK (pp-cli → cli-tests; slice 4 design.md → Surfaces,
// `gaps.list`): the newest 100 runs in the window, `--since` passed as given, the stderr notice when
// more exist.

const run = (id: number, overrides: Partial<ReconcileRun> = {}): ReconcileRun => ({
  object: 'reconcile_run',
  run_id: id,
  trigger: 'manual',
  dry_run: false,
  started_at: '2026-10-21T13:24:10.554Z',
  finished_at: '2026-10-21T13:24:14.008Z',
  horizon_start: '2026-10-18T13:14:10.554Z',
  horizon_end: '2026-10-21T13:14:10.554Z',
  checked: 2,
  missing: 2,
  replayed: 2,
  failed: 0,
  error: null,
  ...overrides,
});

const page: ReconcileRunList = {
  object: 'list',
  has_more: false,
  data: [
    run(43, { dry_run: true, started_at: '2026-10-21T13:25:40.120Z', missing: 0, replayed: 0 }),
    run(42),
    run(41, {
      trigger: 'scheduled',
      started_at: '2026-10-21T13:00:02.310Z',
      checked: 0,
      missing: 0,
      replayed: 0,
    }),
  ],
};

const answering = (data: ReconcileRunList) =>
  new FakeLedgerClient({ gapsList: { data, error: null } });
const failing = (error: SdkError) => new FakeLedgerClient({ gapsList: { data: null, error } });

describe('ledger gaps', () => {
  it('--json prints exactly data as one document, asks for the newest 100, and exits 0', async () => {
    const client = answering(page);

    const result = await runCli(['gaps', '--json'], client);

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual(page);
    expect(result.stderr).toBe('');
    expect(client.calls).toEqual([{ method: 'gaps.list', argument: { limit: 100 } }]);
  });

  it('passes --since to the API as given, which parses it', async () => {
    const client = answering(page);

    await runCli(['gaps', '--since', '2h', '--json'], client);

    expect(client.calls).toEqual([{ method: 'gaps.list', argument: { limit: 100, since: '2h' } }]);
  });

  it('prints one aligned row per run, uncoloured, the outcome last', async () => {
    const result = await runCli(['gaps'], answering(page));

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).not.toContain('\u001b[');
    expect(result.stdout).toBe(
      [
        '  43   manual      dry run   2026-10-21T13:25:40.120Z   checked 2   missing 0   replayed 0   failed 0   ok',
        '  42   manual                2026-10-21T13:24:10.554Z   checked 2   missing 2   replayed 2   failed 0   ok',
        '  41   scheduled             2026-10-21T13:00:02.310Z   checked 0   missing 0   replayed 0   failed 0   ok',
        '',
      ].join('\n'),
    );
  });

  it('prints running for an unfinished run and the error code as sent for one with an error', async () => {
    const result = await runCli(
      ['gaps'],
      answering({
        ...page,
        data: [
          run(45, { finished_at: null }),
          run(44, { finished_at: null, error: { ...unauthorized, code: 'run_abandoned' } }),
        ],
      }),
    );

    const outcomes = result.stdout
      .trimEnd()
      .split('\n')
      .map((line) => line.split('   ').at(-1));
    expect(outcomes).toEqual(['running', 'run_abandoned']);
  });

  it('prints  — for an empty window', async () => {
    const result = await runCli(['gaps'], answering({ ...page, data: [] }));

    expect(result.stdout).toBe('  —\n');
  });

  it('notes on stderr only that more runs exist when has_more', async () => {
    const result = await runCli(['gaps'], answering({ ...page, has_more: true }));

    expect(result.stderr).toBe(`${MORE_RUNS_NOTICE}\n`);
    expect(result.stdout).not.toContain(MORE_RUNS_NOTICE);
    const json = await runCli(['gaps', '--json'], answering({ ...page, has_more: true }));
    expect(json.stderr).toBe('');
  });

  it('--json on a registry error prints exactly { error } on stdout and exits 1', async () => {
    const error = validationFailed('since must be a duration from 1m to 30d, such as 24h.');

    const result = await runCli(['gaps', '--since', '2x', '--json'], failing(error));

    expect(result.exitCode).toBe(1);
    expect(JSON.parse(result.stdout)).toEqual({ error });
    expect(result.stderr).toBe('');
  });

  it('a registry error without --json prints message and hint on stderr only, exit 1', async () => {
    const result = await runCli(['gaps'], failing(unauthorized));

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toBe(`${unauthorized.message}\nhint: ${unauthorized.hint}\n`);
  });

  it.each([
    ['an unknown code', unknownCode],
    ['api_unavailable', apiUnavailable],
  ])('prints %s as received and exits 1', async (_case, error) => {
    const result = await runCli(['gaps', '--json'], failing(error));

    expect(result.exitCode).toBe(1);
    expect(JSON.parse(result.stdout)).toEqual({ error });
  });

  it.each([
    [['gaps', 'extra'], 'too many arguments'],
    [['gaps', '--limit', '5'], "unknown option '--limit'"],
    [['gaps', '--since'], "option '--since <duration>' argument missing"],
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

    const result = await runCli(['gaps'], client, { LEDGER_TOKEN: 'secret-token-value' });

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('LEDGER_URL');
    expect(result.stderr).not.toContain('secret-token-value');
    expect(client.calls).toEqual([]);
  });
});
