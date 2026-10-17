import { describe, expect, it } from 'vitest';
import { deriveSeed } from './derive-seed.ts';

describe('deriveSeed', () => {
  it('gives each draw of each neighbouring run seed its own uint32 seed, never the run seed itself', () => {
    const runSeeds = [...Array.from({ length: 256 }, (_, index) => index), 2 ** 32 - 1];
    const derived = runSeeds.flatMap((seed) => [deriveSeed(seed, 1), deriveSeed(seed, 2)]);

    expect(new Set(derived).size).toBe(derived.length);
    expect(derived.every((value) => Number.isInteger(value) && value >= 0 && value < 2 ** 32)).toBe(
      true,
    );
    expect(runSeeds.some((seed) => derived.includes(seed))).toBe(false);
  });
});
