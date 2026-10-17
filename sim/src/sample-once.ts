import fc from 'fast-check';

// One value drawn from `arbitrary` by the run's seed (simulator.md → Seed and determinism): the same
// seed always draws the same value, so a printed seed replays the run.
export function sampleOnce<T>(arbitrary: fc.Arbitrary<T>, seed: number): T {
  const [value] = fc.sample(arbitrary, { seed, numRuns: 1 });
  if (value === undefined) {
    throw new Error('fast-check drew no sample');
  }
  return value;
}
