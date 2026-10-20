import { z } from 'zod';

// Slice 4 D21: `ledger/database` holds `{ pooledUrl, addressHashKey, tokenTagKey }`; the reconciler
// reads the pooled URL alone. Invalid JSON is one more issue of the same parse, so every unparseable
// value fails as a `ZodError` whose issues carry no input (`reportInput` stays off): the URL's
// password is never echoed into an error, and the handler logs only the error's name.
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
    }),
  );

export type DatabaseSecret = z.output<typeof databaseSecretSchema>;
