// Slice 4 D15, D19: the run's steps over `FakeResendClient` (unit, no Postgres): the status read
// before List Events, the per-item window filter, which replay errors stop the run, the metrics a
// clean run emits and an errored one does not, and the allow-listed log keys. What Postgres decides
// (the claim, the anchor) is reconciler.int.test.ts's and recovery.int.test.ts's.
import { RECONCILE_RUN_BUDGET_MS } from '@ledger/core';
import { FakeResendClient } from '@ledger/resend-client/testing';
import { type LogFields, logFieldKeys } from '@ledger/shared';
import { FakeClock, RecordingMetrics } from '@ledger/shared/testing';
import { describe, expect, it } from 'vitest';
import { executeRun, type RunToExecute } from './execute-run.ts';
import { reportRunFinished } from './report-run.ts';

const NOW = new Date('2026-10-21T13:00:00.000Z');
const HOUR = 3_600_000;
const at = (hoursAgo: number): Date => new Date(NOW.getTime() - hoursAgo * HOUR);

const run = (overrides: Partial<RunToExecute> = {}): RunToExecute => ({
  id: 42,
  dryRun: false,
  startedAt: NOW,
  horizonStart: at(72),
  horizonEnd: at(0.25),
  ...overrides,
});

type Line = { level: string; message: string; fields: LogFields | undefined };

function setup(stored: readonly string[] = []) {
  const resend = new FakeResendClient();
  const clock = new FakeClock(NOW);
  const lines: Line[] = [];
  const log = (level: string) => (message: string, fields?: LogFields) => {
    lines.push({ level, message, fields });
  };
  const logger = { info: log('info'), warn: log('warn'), error: log('error') };
  const present = new Set(stored);
  const lookups: (readonly string[])[] = [];
  const deps = {
    resend,
    webhookId: 'wh_fake',
    presentSvixIds: async (ids: readonly string[]) => {
      lookups.push(ids);
      return new Set(ids.filter((id) => present.has(id)));
    },
    clock,
    logger,
  };
  return { resend, clock, lines, logger, lookups, deps };
}

const allowed = (key: string): boolean =>
  (logFieldKeys as readonly string[]).includes(key) || /^[a-z][a-z0-9_]*_(count|ms)$/.test(key);

describe('executeRun', () => {
  it('reads the webhook status before any List Events call (RS-11)', async () => {
    const { resend, deps } = setup();
    resend.events = [{ id: 'evt_1', type: 'email.sent', createdAt: at(1) }];

    await executeRun(run(), deps);

    expect(resend.calls.map((c) => c.method)).toEqual([
      'retrieveWebhook',
      'listWebhookEvents',
      'replayWebhookEvent',
    ]);
  });

  it('stops with webhook_disabled and lists nothing when the webhook is disabled', async () => {
    const { resend, deps } = setup();
    resend.webhookStatus = 'disabled';
    resend.events = [{ id: 'evt_1', type: 'email.sent', createdAt: at(1) }];

    const outcome = await executeRun(run(), deps);

    expect(outcome).toEqual({
      checked: 0,
      missing: 0,
      replayed: 0,
      failed: 0,
      errorCode: 'webhook_disabled',
    });
    expect(resend.calls.map((c) => c.method)).toEqual(['retrieveWebhook']);
  });

  it('filters an unsorted page item by item: younger than the end skipped, older than the start outside', async () => {
    const { resend, deps, lookups } = setup(['evt_stored']);
    resend.pages = [
      {
        hasMore: true,
        events: [
          { id: 'evt_old', type: 'email.sent', createdAt: at(80) },
          { id: 'evt_grace', type: 'email.sent', createdAt: at(0.1) },
          { id: 'evt_stored', type: 'email.sent', createdAt: at(2) },
          { id: 'evt_missing', type: 'email.delivered', createdAt: at(3) },
        ],
      },
      { hasMore: false, events: [{ id: 'evt_never', type: 'email.sent', createdAt: at(4) }] },
    ];

    const outcome = await executeRun(run(), deps);

    expect(lookups).toEqual([['evt_stored', 'evt_missing']]);
    expect(resend.replayed).toEqual(['evt_missing']);
    // The page held an item older than the start, so paging stopped there.
    expect(resend.calls.filter((c) => c.method === 'listWebhookEvents')).toHaveLength(1);
    expect(outcome).toEqual({ checked: 2, missing: 1, replayed: 1, failed: 0, errorCode: null });
  });

  it('pages with after = the previous page last id until has_more is false', async () => {
    const { resend, deps } = setup();
    resend.pageSize = 2;
    resend.events = [1, 2, 3, 4, 5].map((n) => ({
      id: `evt_${n}`,
      type: 'email.sent',
      createdAt: at(n),
    }));

    const outcome = await executeRun(run({ dryRun: true }), deps);

    const afters = resend.calls
      .filter((c) => c.method === 'listWebhookEvents')
      .map((c) => (c.args[1] as { after?: string }).after);
    expect(afters).toEqual([undefined, 'evt_2', 'evt_4']);
    expect(outcome).toMatchObject({ checked: 5, missing: 5, replayed: 0 });
  });

  it('ends internal_error, never clean, on an empty page that claims has_more', async () => {
    const { resend, deps } = setup();
    resend.pages = [
      { hasMore: true, events: [{ id: 'evt_1', type: 'email.sent', createdAt: at(1) }] },
      { hasMore: true, events: [] },
    ];

    const outcome = await executeRun(run(), deps);

    expect(outcome).toMatchObject({ checked: 1, missing: 1, errorCode: 'internal_error' });
  });

  it('replays nothing on a dry run, and reports the same missing count', async () => {
    const { resend, deps } = setup();
    resend.events = [
      { id: 'evt_a', type: 'email.sent', createdAt: at(1) },
      { id: 'evt_b', type: 'email.sent', createdAt: at(2) },
    ];

    const outcome = await executeRun(run({ dryRun: true }), deps);

    expect(resend.replayed).toEqual([]);
    expect(outcome).toEqual({ checked: 2, missing: 2, replayed: 0, failed: 0, errorCode: null });
  });

  it('counts any other replay error in failed and goes on', async () => {
    const { resend, deps, lines } = setup();
    resend.events = [
      { id: 'evt_a', type: 'email.sent', createdAt: at(1) },
      { id: 'evt_b', type: 'email.sent', createdAt: at(2) },
    ];
    resend.failReplayOf('evt_a', 'internal_error');

    const outcome = await executeRun(run(), deps);

    expect(outcome).toEqual({ checked: 2, missing: 2, replayed: 1, failed: 1, errorCode: null });
    expect(lines).toContainEqual({
      level: 'warn',
      message: 'reconcile.replay_failed',
      fields: { run_id: '42', svix_id: 'evt_a', error_code: 'internal_error' },
    });
  });

  it.each(['resend_auth_failed', 'rate_limited'] as const)(
    'stops the run with %s on a replay, keeping the counts reached',
    async (code) => {
      const { resend, deps } = setup();
      resend.events = [
        { id: 'evt_a', type: 'email.sent', createdAt: at(1) },
        { id: 'evt_b', type: 'email.sent', createdAt: at(2) },
      ];
      resend.failReplayOf('evt_b', code);

      const outcome = await executeRun(run(), deps);

      expect(outcome).toEqual({ checked: 2, missing: 2, replayed: 1, failed: 0, errorCode: code });
    },
  );

  it.each(['resend_unavailable', 'resend_auth_failed', 'reconciler_not_configured'] as const)(
    'stops the run with %s from Retrieve Webhook or List Events',
    async (code) => {
      const status = setup();
      status.resend.fail('retrieveWebhook', code);
      expect((await executeRun(run(), status.deps)).errorCode).toBe(code);

      const listing = setup();
      listing.resend.fail('listWebhookEvents', code);
      expect((await executeRun(run(), listing.deps)).errorCode).toBe(code);
    },
  );

  it('stops rate_limited when the deadline is reached with paging unfinished (PP C2)', async () => {
    const { resend, deps, clock } = setup();
    resend.events = [{ id: 'evt_a', type: 'email.sent', createdAt: at(1) }];
    clock.advance(RECONCILE_RUN_BUDGET_MS);

    const outcome = await executeRun(run(), deps);

    expect(outcome.errorCode).toBe('rate_limited');
    expect(resend.calls.map((c) => c.method)).toEqual(['retrieveWebhook']);
  });

  it('logs only allow-listed keys', async () => {
    const { resend, deps, lines, logger } = setup();
    resend.events = [{ id: 'evt_a', type: 'email.sent', createdAt: at(1) }];
    resend.failReplayOf('evt_a', 'internal_error');

    const outcome = await executeRun(run(), deps);
    reportRunFinished({ logger, metrics: new RecordingMetrics() }, 42, outcome);

    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      for (const key of Object.keys(line.fields ?? {})) {
        expect(allowed(key), `${line.message}: ${key}`).toBe(true);
      }
    }
  });
});

describe('reportRunFinished', () => {
  it('emits the three reconcile metrics, dimensionless, for a clean run, a dry one included', () => {
    const { logger } = setup();
    const metrics = new RecordingMetrics();

    reportRunFinished({ logger, metrics }, 7, {
      checked: 3,
      missing: 2,
      replayed: 1,
      failed: 1,
      errorCode: null,
    });

    expect(metrics.recorded).toEqual([
      { kind: 'count', name: 'reconcile.missing', value: 2, fields: { run_id: '7' } },
      { kind: 'count', name: 'reconcile.replayed', value: 1, fields: { run_id: '7' } },
      { kind: 'count', name: 'reconcile.failed', value: 1, fields: { run_id: '7' } },
    ]);
  });

  it('emits no metric for an errored run, so the gap alarm reads its silence (D24)', () => {
    const { logger, lines } = setup();
    const metrics = new RecordingMetrics();

    reportRunFinished({ logger, metrics }, 7, {
      checked: 0,
      missing: 0,
      replayed: 0,
      failed: 0,
      errorCode: 'webhook_disabled',
    });

    expect(metrics.recorded).toEqual([]);
    expect(lines).toEqual([
      {
        level: 'info',
        message: 'reconcile.run_finished',
        fields: {
          run_id: '7',
          checked_count: 0,
          missing_count: 0,
          replayed_count: 0,
          failed_count: 0,
          error_code: 'webhook_disabled',
        },
      },
    ]);
  });
});
