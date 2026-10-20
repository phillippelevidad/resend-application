import { apiUnavailable, internalError, type ReconcileRun, type SdkError } from '@ledger/sdk';
import { type FakeAnswers, FakeLedgerClient } from '@ledger/sdk/testing';
import { describe, expect, it } from 'vitest';
import { runCli, VALID_ENV } from '../testing/run-cli.ts';
import { forbidden, unauthorized, unknownCode, validationFailed } from '../testing/sdk-errors.ts';
import { RUN_POLL_INTERVAL_MS, RUN_WAIT_BACKSTOP_MS } from '../wait-for-run.ts';
import { startedNotice } from './reconcile-start.cli.ts';

// `ledger reconcile` against the fake SDK, `sleep` injected (pp-cli → cli-tests, Waiting; slice 4
// design.md → Surfaces, `reconcile.start`): the start, the run-id notice on stderr, the wait on
// `reconcile.getRun` until finished or carrying an error, `--no-wait`, and the backstop.

const running: ReconcileRun = {
  object: 'reconcile_run',
  run_id: 42,
  trigger: 'manual',
  dry_run: false,
  started_at: '2026-10-21T13:24:10.554Z',
  finished_at: null,
  horizon_start: '2026-10-18T13:14:10.554Z',
  horizon_end: '2026-10-21T13:14:10.554Z',
  checked: 0,
  missing: 0,
  replayed: 0,
  failed: 0,
  error: null,
};
const finished: ReconcileRun = {
  ...running,
  finished_at: '2026-10-21T13:24:14.008Z',
  checked: 2,
  missing: 2,
  replayed: 2,
};
const disabled: SdkError = {
  code: 'webhook_disabled',
  message: 'The Resend webhook is disabled, so replays will not be delivered.',
  hint: 'Re-enable it in the Resend dashboard or with `PATCH /webhooks/{id}` and `status: enabled`, then run `ledger reconcile`.',
  docs: 'https://resend.com/docs/webhooks/retries-and-replays',
};
const abandonedError: SdkError = { ...unauthorized, code: 'run_abandoned' };

// `getRun` answers each run in turn, the last one forever after.
function client(polls: readonly ReconcileRun[], answers: Partial<FakeAnswers> = {}) {
  let next = 0;
  return new FakeLedgerClient({
    reconcileStart: { data: running, error: null },
    reconcileGetRun: () => {
      const run = polls[Math.min(next, polls.length - 1)] ?? running;
      next += 1;
      return { data: run, error: null };
    },
    ...answers,
  });
}

function recordingSleep() {
  const waits: number[] = [];
  return { waits, sleep: async (ms: number) => void waits.push(ms) };
}

const run = (args: string[], fake: FakeLedgerClient, sleep = recordingSleep().sleep) =>
  runCli(args, fake, VALID_ENV, sleep);

describe('ledger reconcile', () => {
  it('waits until the run finishes: exit 0, --json stdout only the final run, the polls in order', async () => {
    const fake = client([running, finished]);
    const { waits, sleep } = recordingSleep();

    const result = await run(['reconcile', '--json'], fake, sleep);

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual(finished);
    expect(result.stderr).toBe(`${startedNotice(42)}\n`);
    expect(fake.calls).toEqual([
      { method: 'reconcile.start', argument: {} },
      { method: 'reconcile.getRun', argument: '42' },
      { method: 'reconcile.getRun', argument: '42' },
    ]);
    expect(waits).toEqual([RUN_POLL_INTERVAL_MS, RUN_POLL_INTERVAL_MS]);
  });

  it('prints the run-id notice on stderr only, never on stdout', async () => {
    const result = await run(['reconcile', '--json'], client([finished]));

    expect(result.stdout).not.toContain('started; follow it');
    expect(result.stderr).toContain(startedNotice(42));
  });

  it('sends --dry-run and --lookback as given, the API parsing the duration', async () => {
    const fake = client([{ ...finished, dry_run: true }]);

    await run(['reconcile', '--dry-run', '--lookback', '6h', '--json'], fake);

    expect(fake.calls[0]).toEqual({
      method: 'reconcile.start',
      argument: { dry_run: true, lookback: '6h' },
    });
  });

  it('prints the finished run layout without --json, uncoloured', async () => {
    const result = await run(['reconcile'], client([finished]));

    expect(result.exitCode).toBe(0);
    expect(result.stdout).not.toContain('\u001b[');
    expect(result.stdout).toBe(
      [
        'run 42   manual',
        'started    2026-10-21T13:24:10.554Z',
        'finished   2026-10-21T13:24:14.008Z',
        'horizon    2026-10-18T13:14:10.554Z → 2026-10-21T13:14:10.554Z',
        'checked 2   missing 2   replayed 2   failed 0',
        '',
      ].join('\n'),
    );
  });

  it("starts a dry run's first line with dry run", async () => {
    const result = await run(['reconcile', '--dry-run'], client([{ ...finished, dry_run: true }]));

    expect(result.stdout.split('\n')[0]).toBe('run 42   manual   dry run');
  });

  it('a finished run carrying an error exits 1 with it in the error shape', async () => {
    const result = await run(
      ['reconcile', '--json'],
      client([running, { ...finished, error: disabled }]),
    );

    expect(result.exitCode).toBe(1);
    expect(JSON.parse(result.stdout)).toEqual({ error: disabled });
  });

  it('an abandoned run exits 1 with run_abandoned, and no poll follows it', async () => {
    const fake = client([running, { ...running, error: abandonedError }]);

    const result = await run(['reconcile', '--json'], fake);

    expect(result.exitCode).toBe(1);
    expect(JSON.parse(result.stdout)).toEqual({ error: abandonedError });
    expect(fake.calls.filter((call) => call.method === 'reconcile.getRun')).toHaveLength(2);
  });

  it('--no-wait makes one start call and no getRun call, and prints the 202 run', async () => {
    const fake = client([finished]);

    const result = await run(['reconcile', '--no-wait', '--json'], fake);

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual(running);
    expect(fake.calls).toEqual([{ method: 'reconcile.start', argument: {} }]);
  });

  it('stops at the backstop: --json prints internal_error and exits 1', async () => {
    const fake = client([running]);
    const { waits, sleep } = recordingSleep();

    const result = await run(['reconcile', '--json'], fake, sleep);

    expect(result.exitCode).toBe(1);
    expect(JSON.parse(result.stdout)).toEqual({ error: internalError });
    expect(waits).toHaveLength(Math.ceil(RUN_WAIT_BACKSTOP_MS / RUN_POLL_INTERVAL_MS));
  });

  it('stops at the backstop without --json with the constant defect line, exit 1', async () => {
    const result = await run(['reconcile'], client([running]));

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toBe(`${startedNotice(42)}\nledger: unexpected failure.\n`);
  });

  it('a start refused with reconcile_in_progress or forbidden exits 1 in the error shape, with no wait', async () => {
    const inProgress: SdkError = { ...unauthorized, code: 'reconcile_in_progress' };
    for (const error of [inProgress, forbidden]) {
      const fake = client([], { reconcileStart: { data: null, error } });

      const result = await run(['reconcile', '--json'], fake);

      expect(result.exitCode).toBe(1);
      expect(JSON.parse(result.stdout)).toEqual({ error });
      expect(result.stderr).toBe('');
      expect(fake.calls).toHaveLength(1);
    }
  });

  it('a getRun error during the wait exits 1 with it', async () => {
    const fake = client([], { reconcileGetRun: { data: null, error: apiUnavailable } });

    const result = await run(['reconcile', '--json'], fake);

    expect(result.exitCode).toBe(1);
    expect(JSON.parse(result.stdout)).toEqual({ error: apiUnavailable });
  });

  it('a registry error without --json prints message and hint on stderr only, exit 1', async () => {
    const error = validationFailed('lookback must be a duration from 1m to 30d, such as 72h.');
    const fake = client([], { reconcileStart: { data: null, error } });

    const result = await run(['reconcile', '--lookback', '31d'], fake);

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toBe(`${error.message}\nhint: ${error.hint}\n`);
  });

  it('prints an unknown code as received and exits 1', async () => {
    const fake = client([], { reconcileStart: { data: null, error: unknownCode } });

    const result = await run(['reconcile', '--json'], fake);

    expect(result.exitCode).toBe(1);
    expect(JSON.parse(result.stdout)).toEqual({ error: unknownCode });
  });

  it.each([
    [['reconcile', 'extra'], 'too many arguments'],
    [['reconcile', '--since', '2h'], "unknown option '--since'"],
    [['reconcile', '--lookback'], "option '--lookback <duration>' argument missing"],
  ])('a usage error (%j) exits 2 with no call and stdout empty', async (args, message) => {
    const fake = client([finished]);

    const result = await run(args, fake);

    expect(result.exitCode).toBe(2);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain(message);
    expect(fake.calls).toEqual([]);
  });

  it('a missing LEDGER_URL exits 2 naming it, with no call', async () => {
    const fake = client([finished]);

    const result = await runCli(['reconcile'], fake, { LEDGER_TOKEN: 'secret-token-value' });

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('LEDGER_URL');
    expect(result.stderr).not.toContain('secret-token-value');
    expect(fake.calls).toEqual([]);
  });
});
