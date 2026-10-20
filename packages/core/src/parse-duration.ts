import { RECONCILE_MAX_LOOKBACK_MS } from './reconcile-run.ts';

const UNIT_MS = { m: 60_000, h: 3_600_000, d: 86_400_000 } as const;

const MIN_DURATION_MS = UNIT_MS.m;

// Slice 4 D3: `--since` and `--lookback`, shared through the API's duration schema; the CLI never
// parses it. A whole number of minutes, hours or days from `1m` to `30d` inclusive (RS-31), else
// `undefined`.
export const parseDuration = (text: string): number | undefined => {
  const match = /^([1-9][0-9]{0,4})([mhd])$/.exec(text);
  if (match === null) return undefined;
  const ms = Number(match[1]) * UNIT_MS[match[2] as keyof typeof UNIT_MS];
  if (ms < MIN_DURATION_MS || ms > RECONCILE_MAX_LOOKBACK_MS) return undefined;
  return ms;
};
