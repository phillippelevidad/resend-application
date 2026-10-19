import { describe, expect, it } from 'vitest';
import { notSettledLine, settleBound } from './live-run.ts';

describe('settleBound', () => {
  it('waits 32 s for a 20-event run, polling every 250 ms (D22)', () => {
    expect(settleBound(20)).toEqual({ boundMs: 32_000, intervalMs: 250 });
  });

  it('waits 1,030 s for a 10,000-event burst, polling every 2 s (D22)', () => {
    expect(settleBound(10_000)).toEqual({ boundMs: 1_030_000, intervalMs: 2_000 });
  });

  it('keeps the 250 ms poll up to a 60 s bound and switches to 2 s just past it', () => {
    expect(settleBound(300)).toEqual({ boundMs: 60_000, intervalMs: 250 });
    expect(settleBound(301)).toEqual({ boundMs: 60_100, intervalMs: 2_000 });
  });
});

describe('notSettledLine', () => {
  it('names the bound in seconds and the stored count, so a 20-event run short by one reads 19/20 after 32s', () => {
    const line = notSettledLine({
      expected: 20,
      present: 19,
      settled: false,
      bound: settleBound(20),
      elapsedMs: 32_010,
    });
    expect(line).toBe('sim: not settled after 32s (19/20 stored)');
  });
});
