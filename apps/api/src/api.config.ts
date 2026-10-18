import { apiEnv } from '@ledger/shared';
import { z } from 'zod';

const required = z.string({ error: 'must be set' }).min(1, { error: 'must be set' });

// D2, D32: the API function's boot assertion, parsed once by `main.ts` through `loadConfig` at
// module scope. Its keys are `apiEnv`'s, the object `infra` sets them from, so the two sides cannot
// drift. A failure names the variable, never its value (pp-general → config-and-env).
export const apiConfigSchema = z
  .object({
    // The ARN of `ledger/database`, read through the secret reader port on the first invocation.
    [apiEnv.DATABASE_SECRET_ARN]: required,
    [apiEnv.QUEUE_URL]: z.url({ error: 'must be a URL' }),
    [apiEnv.DLQ_URL]: z.url({ error: 'must be a URL' }),
    // The worker's physical name: its event source mapping (`health.get`) and its resume invoke
    // (`worker.resumeEventSource`), D16, C5.
    [apiEnv.WORKER_FUNCTION_NAME]: required,
  })
  .transform((env) => ({
    databaseSecretArn: env[apiEnv.DATABASE_SECRET_ARN],
    queueUrl: env[apiEnv.QUEUE_URL],
    dlqUrl: env[apiEnv.DLQ_URL],
    workerFunctionName: env[apiEnv.WORKER_FUNCTION_NAME],
  }));

export type ApiConfig = z.output<typeof apiConfigSchema>;
