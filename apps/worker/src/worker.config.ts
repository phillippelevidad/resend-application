import { workerEnv } from '@ledger/shared';
import { z } from 'zod';

// D2, D32: the worker function's boot assertion, parsed once by `main.ts` through `loadConfig` at
// module scope. Its own key is `workerEnv`'s, the object `infra` sets it from, so the two sides
// cannot drift. `AWS_LAMBDA_FUNCTION_NAME` is Lambda's reserved variable (AWS-56): the worker finds
// its own event source mapping by its own name (D16, C5). A failure names the variable, never its
// value (pp-general → config-and-env).
export const workerConfigSchema = z
  .object({
    // The ARN of `ledger/database`, read through the secret reader port on the first invocation.
    [workerEnv.DATABASE_SECRET_ARN]: z
      .string({ error: 'must be set' })
      .min(1, { error: 'must be set' }),
    AWS_LAMBDA_FUNCTION_NAME: z.string({ error: 'must be set' }).min(1, { error: 'must be set' }),
  })
  .transform((env) => ({
    databaseSecretArn: env[workerEnv.DATABASE_SECRET_ARN],
    functionName: env.AWS_LAMBDA_FUNCTION_NAME,
  }));

export type WorkerConfig = z.output<typeof workerConfigSchema>;
