import { ingestEnv } from '@ledger/shared';
import { z } from 'zod';

// D2, D32: the ingest function's boot assertion, parsed once by `main.ts` through `loadConfig` at
// module scope. Its keys are `ingestEnv`'s, the object `infra` sets them from, so the two sides
// cannot drift. A failure names the variable, never its value (pp-general → config-and-env).
export const ingestConfigSchema = z
  .object({
    // The ARN of `ledger/webhook-signing-secrets`, read through the secret reader port (D13).
    [ingestEnv.SIGNING_SECRETS_ARN]: z
      .string({ error: 'must be set' })
      .min(1, { error: 'must be set' }),
    [ingestEnv.QUEUE_URL]: z.url({ error: 'must be a URL' }),
  })
  .transform((env) => ({
    signingSecretsArn: env[ingestEnv.SIGNING_SECRETS_ARN],
    queueUrl: env[ingestEnv.QUEUE_URL],
  }));

export type IngestConfig = z.output<typeof ingestConfigSchema>;
