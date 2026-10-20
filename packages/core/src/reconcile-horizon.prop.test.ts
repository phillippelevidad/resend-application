import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { reconcileHorizon } from './reconcile-horizon.ts';
import { RECONCILE_GRACE_MS, RECONCILE_MAX_LOOKBACK_MS } from './reconcile-run.ts';

const DAY_MS = 86_400_000;
const now = fc.date({
  min: new Date('2026-01-01T00:00:00.000Z'),
  max: new Date('2030-01-01T00:00:00.000Z'),
  noInvalidDate: true,
});
// parseDuration's range, 1m to 30d.
const lookbackMs = fc.integer({ min: 60_000, max: RECONCILE_MAX_LOOKBACK_MS });
// SQS keeps a message at most 14 days (AWS), so no queue age is older.
const queueAgeSeconds = fc.option(fc.integer({ min: 0, max: 14 * 86_400 }), { nil: undefined });
// An anchor anywhere from 60 days back to the run's own start.
const anchorBackMs = fc.option(fc.integer({ min: 0, max: 60 * DAY_MS }), { nil: undefined });

describe('reconcileHorizon', () => {
  it('never starts after it ends', () => {
    fc.assert(
      fc.property(now, lookbackMs, anchorBackMs, queueAgeSeconds, (n, lb, back, age) => {
        const { horizonStart, horizonEnd } = reconcileHorizon({
          now: n,
          lookbackMs: lb,
          anchorHorizonEnd: back === undefined ? undefined : new Date(n.getTime() - back),
          oldestQueueAgeSeconds: age,
        });
        expect(horizonStart.getTime()).toBeLessThanOrEqual(horizonEnd.getTime());
      }),
    );
  });

  it('never reaches back more than 30 days (RS-31)', () => {
    fc.assert(
      fc.property(now, lookbackMs, anchorBackMs, queueAgeSeconds, (n, lb, back, age) => {
        const { horizonStart } = reconcileHorizon({
          now: n,
          lookbackMs: lb,
          anchorHorizonEnd: back === undefined ? undefined : new Date(n.getTime() - back),
          oldestQueueAgeSeconds: age,
        });
        expect(horizonStart.getTime()).toBeGreaterThanOrEqual(
          n.getTime() - RECONCILE_MAX_LOOKBACK_MS,
        );
      }),
    );
  });

  it('starts exactly at an anchor older than the lookback and younger than 30 days', () => {
    fc.assert(
      fc.property(
        now,
        fc.integer({ min: 60_000, max: RECONCILE_MAX_LOOKBACK_MS - 1 }),
        fc.integer({ min: 1, max: RECONCILE_MAX_LOOKBACK_MS }),
        queueAgeSeconds,
        (n, lb, extra, age) => {
          const anchorBack = Math.min(lb + extra, RECONCILE_MAX_LOOKBACK_MS);
          // Older than the lookback, and not inside the grace window or the queue's backlog.
          fc.pre(anchorBack > lb && anchorBack >= Math.max(RECONCILE_GRACE_MS, (age ?? 0) * 1000));
          const anchor = new Date(n.getTime() - anchorBack);
          const { horizonStart } = reconcileHorizon({
            now: n,
            lookbackMs: lb,
            anchorHorizonEnd: anchor,
            oldestQueueAgeSeconds: age,
          });
          expect(horizonStart.getTime()).toBe(anchor.getTime());
        },
      ),
    );
  });

  it('ends at the grace window, or at the queue age when that is longer', () => {
    fc.assert(
      fc.property(now, lookbackMs, queueAgeSeconds, (n, lb, age) => {
        const { horizonEnd } = reconcileHorizon({
          now: n,
          lookbackMs: lb,
          anchorHorizonEnd: undefined,
          oldestQueueAgeSeconds: age,
        });
        const backMs = Math.max(RECONCILE_GRACE_MS, (age ?? 0) * 1000);
        expect(horizonEnd.getTime()).toBe(n.getTime() - backMs);
      }),
    );
  });

  it('takes the queue age over the grace window: a 30-minute backlog ends the horizon 30 minutes back', () => {
    const n = new Date('2026-10-21T13:00:00.000Z');
    const { horizonEnd } = reconcileHorizon({
      now: n,
      lookbackMs: 3_600_000,
      anchorHorizonEnd: undefined,
      oldestQueueAgeSeconds: 1_800,
    });
    expect(horizonEnd.toISOString()).toBe('2026-10-21T12:30:00.000Z');
  });
});
