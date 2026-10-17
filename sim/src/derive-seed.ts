// The seed of a run's `draw`-th draw after the history: splitmix32's `draw`-th output from the run's
// seed. Each `sampleOnce` call restarts fast-check's generator from the seed it is given, so draws
// sharing one seed read the same random stream and come out correlated; a seed per draw keeps them
// independent, and still a pure function of the printed seed, so the run replays.
export function deriveSeed(seed: number, draw: number): number {
  let z = (seed + Math.imul(draw, 0x9e3779b9)) | 0;
  z = Math.imul(z ^ (z >>> 16), 0x85ebca6b);
  z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35);
  return (z ^ (z >>> 16)) >>> 0;
}
