import { ingestEnv, ingestSimulatorEnv } from '@ledger/shared';
import { z } from 'zod';

// D2, D32: the ingest function's boot assertion, parsed once by `main.ts` through `loadConfig` at
// module scope. Its keys are `ingestEnv`'s and `ingestSimulatorEnv`'s, the objects `infra` sets them
// from, so the two sides cannot drift. A failure names the variable, never its value
// (pp-general → config-and-env).
export const ingestConfigSchema = z
  .object({
    // The ARN of `ledger/webhook-signing-secrets`, read through the secret reader port (D13).
    [ingestEnv.SIGNING_SECRETS_ARN]: z
      .string({ error: 'must be set' })
      .min(1, { error: 'must be set' }),
    [ingestEnv.QUEUE_URL]: z.url({ error: 'must be a URL' }),
    // D12, D13: the simulator secret's ARN, set only on a `ledger:simulator=true` stack (ADR-016).
    // Absent, ingest holds no simulator secret; present, it must name one.
    [ingestSimulatorEnv.SIMULATOR_SECRET_ARN]: z
      .string()
      .min(1, { error: 'must not be empty when set' })
      .optional(),
  })
  .transform((env) => ({
    signingSecretsArn: env[ingestEnv.SIGNING_SECRETS_ARN],
    queueUrl: env[ingestEnv.QUEUE_URL],
    simulatorSecretArn: env[ingestSimulatorEnv.SIMULATOR_SECRET_ARN],
  }));

export type IngestConfig = z.output<typeof ingestConfigSchema>;
