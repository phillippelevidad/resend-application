import { z } from '@hono/zod-openapi';
import { parseDuration } from '@ledger/core';

// Slice 4 D3: `--since` and `--lookback` on the wire, a whole number of minutes, hours or days from
// `1m` to `30d` (RS-31), parsed into milliseconds by core's `parseDuration`; the CLI never parses it.
export const durationSchema = z
  .string()
  .refine((text) => parseDuration(text) !== undefined)
  .transform((text) => parseDuration(text) ?? 0);
