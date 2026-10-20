import { describe, expect, it } from 'vitest';
import { parseDuration } from './parse-duration.ts';

describe('parseDuration', () => {
  it.each([
    ['1m', 60_000],
    ['24h', 86_400_000],
    ['72h', 259_200_000],
    ['30d', 2_592_000_000],
    ['720h', 2_592_000_000],
  ])('accepts %s as %i ms', (text, ms) => {
    expect(parseDuration(text)).toBe(ms);
  });

  it.each(['0m', '31d', '721h', '2x', '720h1', '', '1', 'm', '-1h', '01h', ' 1h', '1.5h', '1H'])(
    'refuses %j, outside 1m to 30d or not a whole number of m, h or d',
    (text) => {
      expect(parseDuration(text)).toBeUndefined();
    },
  );
});
