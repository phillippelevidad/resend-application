import { z } from '@hono/zod-openapi';

// D21: `token_id` in a path or query string. 15 digits keeps every id inside
// `Number.MAX_SAFE_INTEGER`, since it is a JSON number on the wire and the column is read with
// `bigint({ mode: 'number' })`.
export const tokenIdSchema = z
  .string()
  .regex(/^[1-9][0-9]{0,14}$/)
  .transform(Number);
