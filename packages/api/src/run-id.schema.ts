import { z } from '@hono/zod-openapi';

// Slice 4 D27: `run_id` in a path or query string, as `token_id` is (D21): 15 digits keep every id
// inside `Number.MAX_SAFE_INTEGER`, since it is a JSON number on the wire.
export const runIdSchema = z
  .string()
  .regex(/^[1-9][0-9]{0,14}$/)
  .transform(Number);
