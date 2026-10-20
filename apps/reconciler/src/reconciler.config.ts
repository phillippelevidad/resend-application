import { reconcilerEnv } from '@ledger/shared';
import { z } from 'zod';

const required = z.string({ error: 'must be set' }).min(1, { error: 'must be set' });

// Slice 4 D21: what `infra` sets when the deploy passes no `ledger:resendWebhookId` context.
export const WEBHOOK_ID_UNSET = 'unset';

// D9: the Lambda's Resend API base URL, a config constant, so the SDK never reads
// `RESEND_BASE_URL`; tests pass the fake's.
export const RESEND_API_BASE_URL = 'https://api.resend.com';

// RS-21: every request carries a `User-Agent` naming the caller.
export const RECONCILER_USER_AGENT = 'ledger-reconciler';

// D21: the reconciler function's boot assertion, parsed once by `main.ts` through `loadConfig` at
// module scope. Its keys are `reconcilerEnv`'s, the object `infra` sets them from. A failure names
// the variable, never its value (pp-general → config-and-env).
export const reconcilerConfigSchema = z
  .object({
    // The ARNs of `ledger/database` and `ledger/resend-api-key`, read on the first invocation.
    [reconcilerEnv.DATABASE_SECRET_ARN]: required,
    [reconcilerEnv.RESEND_API_KEY_SECRET_ARN]: required,
    [reconcilerEnv.RESEND_WEBHOOK_ID]: required,
    // Both queues' attributes and the source queue's age, for the grace window (AWS-22).
    [reconcilerEnv.QUEUE_URL]: z.url({ error: 'must be a URL' }),
    [reconcilerEnv.DLQ_URL]: z.url({ error: 'must be a URL' }),
  })
  .transform((env) => ({
    databaseSecretArn: env[reconcilerEnv.DATABASE_SECRET_ARN],
    resendApiKeySecretArn: env[reconcilerEnv.RESEND_API_KEY_SECRET_ARN],
    // `unset` reads as no webhook configured (D21).
    webhookId:
      env[reconcilerEnv.RESEND_WEBHOOK_ID] === WEBHOOK_ID_UNSET
        ? undefined
        : env[reconcilerEnv.RESEND_WEBHOOK_ID],
    queueUrl: env[reconcilerEnv.QUEUE_URL],
    dlqUrl: env[reconcilerEnv.DLQ_URL],
  }));

export type ReconcilerConfig = z.output<typeof reconcilerConfigSchema>;

// D21: the Resend side the reconciler composes, or none. `ledger/resend-api-key` holds a bare key; a
// value not starting `re_` is the CDK placeholder the deploy has not overwritten, and reads as not
// configured, as does an unset webhook id. Every run then ends `reconciler_not_configured`.
export function resendConfiguration(
  webhookId: string | undefined,
  apiKeySecret: string,
): { apiKey: string; webhookId: string } | undefined {
  const apiKey = apiKeySecret.trim();
  if (webhookId === undefined || !apiKey.startsWith('re_')) return undefined;
  return { apiKey, webhookId };
}
