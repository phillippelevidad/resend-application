// Slice 4 D27: the one run mapper. Its exact key set keeps `claimed_at` and `updated_at` internal,
// and `run_abandoned` is derived from the shared budget, never read from the row (ADR-007).
import { errorRegistry, RECONCILE_RUN_BUDGET_MS } from '@ledger/core';
import { describe, expect, it } from 'vitest';
import {
  type ReconcileRunRead,
  reconcileRunListResponseMapper,
  reconcileRunResponseMapper,
} from './reconcile-run-response.mapper.ts';

const startedAt = new Date('2026-10-21T13:24:10.554Z');

const run = (overrides: Partial<ReconcileRunRead> = {}): ReconcileRunRead => ({
  id: 42,
  trigger: 'manual',
  dryRun: false,
  startedAt,
  finishedAt: new Date('2026-10-21T13:24:14.008Z'),
  horizonStart: new Date('2026-10-18T13:14:10.554Z'),
  horizonEnd: new Date('2026-10-21T13:14:10.554Z'),
  checked: 2,
  missing: 2,
  replayed: 2,
  failed: 0,
  errorCode: null,
  ...overrides,
});

describe('reconcileRunResponseMapper', () => {
  it('maps a finished run to exactly the wire keys, error null, no claimed_at or updated_at', () => {
    // A row as the repository returns it, internal columns included.
    const row = {
      ...run(),
      claimedAt: new Date('2026-10-21T13:24:10.600Z'),
      updatedAt: new Date('2026-10-21T13:24:14.008Z'),
    };

    const mapped = reconcileRunResponseMapper(row, new Date('2026-10-21T13:30:00.000Z'));

    expect(mapped).toEqual({
      object: 'reconcile_run',
      run_id: 42,
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
    });
    expect(Object.keys(mapped)).not.toContain('claimed_at');
    expect(Object.keys(mapped)).not.toContain('updated_at');
  });

  it('carries a stored outcome as its registry error object', () => {
    const mapped = reconcileRunResponseMapper(
      run({ errorCode: 'webhook_disabled' }),
      new Date('2026-10-21T13:30:00.000Z'),
    );

    expect(mapped.error).toEqual({
      code: 'webhook_disabled',
      message: errorRegistry.webhook_disabled.message,
      hint: errorRegistry.webhook_disabled.hint,
      docs: errorRegistry.webhook_disabled.docs,
    });
  });

  it('reads an unfinished run as run_abandoned 1 ms past its budget, and as running at it', () => {
    const unfinished = run({ finishedAt: null });
    const atBudget = new Date(startedAt.getTime() + RECONCILE_RUN_BUDGET_MS);
    const past = new Date(startedAt.getTime() + RECONCILE_RUN_BUDGET_MS + 1);

    expect(reconcileRunResponseMapper(unfinished, atBudget).error).toBeNull();
    const abandoned = reconcileRunResponseMapper(unfinished, past);
    expect(abandoned.error?.code).toBe('run_abandoned');
    expect(abandoned.finished_at).toBeNull();
  });

  it('wraps runs in the list envelope', () => {
    const now = new Date('2026-10-21T13:30:00.000Z');
    expect(reconcileRunListResponseMapper({ hasMore: true, runs: [run()] }, now)).toEqual({
      object: 'list',
      has_more: true,
      data: [reconcileRunResponseMapper(run(), now)],
    });
  });
});
