import { Buffer } from 'node:buffer';
import { z } from 'zod';

// D2, D3: each key is 32 bytes as 64 lowercase hex characters.
const hexKey = z
  .string()
  .regex(/^[0-9a-f]{64}$/, { error: 'must be 64 lowercase hex characters' })
  .transform((hex) => new Uint8Array(Buffer.from(hex, 'hex')));

// D33 step 9: `ledger/database` holds `{ pooledUrl, addressHashKey, tokenTagKey }`; the API reads
// all three (the worker's own schema reads the first two; apps import no other app, ADR-013).
// Invalid JSON is one more issue of the same parse, so every unparseable value fails as a
// `ZodError` whose issues carry no input: the URL's password or a key is never echoed into an
// error, and the handler logs only the error's name.
export const databaseSecretSchema = z
  .string()
  .transform((value, ctx): unknown => {
    try {
      return JSON.parse(value);
    } catch {
      ctx.addIssue({ code: 'custom', message: 'must be a JSON object' });
      return z.NEVER;
    }
  })
  .pipe(
    z.object({
      pooledUrl: z.string().startsWith('postgres', { error: 'must be a Postgres URL' }),
      addressHashKey: hexKey,
      tokenTagKey: hexKey,
    }),
  );

export type DatabaseSecret = z.output<typeof databaseSecretSchema>;
