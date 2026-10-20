import { z } from '@hono/zod-openapi';
import { parseDuration } from '@ledger/core';

// Slice 4 D3: `--since` and `--lookback` on the wire, a whole number of minutes, hours or days from
// `1m` to `30d` (RS-31), parsed into milliseconds by core's `parseDuration`; the CLI never parses it.
export const durationSchema = z.string().transform((text, ctx) => {
  const ms = parseDuration(text);
  if (ms === undefined) {
    ctx.addIssue({ code: 'custom', message: 'must be a duration from 1m to 30d' });
    return z.NEVER;
  }
  return ms;
});
