import { describe, expect, it } from 'vitest';
import { RECONCILE_RUN_BUDGET_MS, runOutcome } from './reconcile-run.ts';

const startedAt = new Date('2026-10-21T13:00:00.000Z');
const at = (msAfterStart: number): Date => new Date(startedAt.getTime() + msAfterStart);

describe('runOutcome', () => {
  it('reads an unfinished run as running at exactly its budget', () => {
    const run = { startedAt, finishedAt: null, errorCode: null };
    expect(runOutcome(run, at(RECONCILE_RUN_BUDGET_MS))).toBeNull();
  });

  it('reads an unfinished run as run_abandoned 1 ms past its budget, derived and never stored', () => {
    const run = { startedAt, finishedAt: null, errorCode: null };
    expect(runOutcome(run, at(RECONCILE_RUN_BUDGET_MS + 1))).toEqual({ code: 'run_abandoned' });
  });

  it('lets a stored code win over the budget', () => {
    const run = { startedAt, finishedAt: null, errorCode: 'internal_error' as const };
    expect(runOutcome(run, at(RECONCILE_RUN_BUDGET_MS + 1))).toEqual({ code: 'internal_error' });
    const finished = { startedAt, finishedAt: at(5_000), errorCode: 'webhook_disabled' as const };
    expect(runOutcome(finished, at(1_000))).toEqual({ code: 'webhook_disabled' });
  });

  it('never reads a finished run as abandoned, however old', () => {
    const run = { startedAt, finishedAt: at(4_000), errorCode: null };
    expect(runOutcome(run, at(RECONCILE_RUN_BUDGET_MS * 100))).toBeNull();
  });
});
