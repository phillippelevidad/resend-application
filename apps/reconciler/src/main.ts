import { setTimeout as sleep } from 'node:timers/promises';
import {
  createCloudWatchClient,
  createSecretsManagerClient,
  createSqsClient,
  SecretsManagerSecretReaderAdapter,
  SqsQueueAttributesAdapter,
} from '@ledger/aws';
import { createDatabase } from '@ledger/db';
import { createReconciler, type Reconciler } from '@ledger/reconciler';
import { createResendClient } from '@ledger/resend-client';
import { type ClockPort, createLogger, EmfMetricsAdapter, loadConfig } from '@ledger/shared';
import type { InvocationFields } from './create-reconciler-handler.ts';
import { databaseSecretSchema } from './database-secret.schema.ts';
import {
  RECONCILER_USER_AGENT,
  RESEND_API_BASE_URL,
  reconcilerConfigSchema,
  resendConfiguration,
} from './reconciler.config.ts';

// Composition root of the reconciler Lambda (ADR-013, slice 4 D20). The config parse, the clients
// and the adapters are built once per container at module scope. Both secrets are read, and the
// size-1 pool and the Resend client built from them, on the first invocation through one memoized
// promise, so importing the bundle needs no AWS access (`apps/worker/src/main.ts`'s pattern).

const config = loadConfig(reconcilerConfigSchema, process.env);

export const invocation: InvocationFields = { request_id: undefined, cold_start: true };
export const logger = createLogger({ functionName: 'reconciler', context: () => invocation });

const clock: ClockPort = { now: () => new Date() };
const secretReader = new SecretsManagerSecretReaderAdapter({
  client: createSecretsManagerClient(),
});
// D21: the source queue's oldest age for the grace window, from CloudWatch (AWS-22, AWS-57).
const queueAttributes = new SqsQueueAttributesAdapter({
  sqs: createSqsClient(),
  cloudWatch: createCloudWatchClient(),
  queueUrl: config.queueUrl,
  dlqUrl: config.dlqUrl,
});
// D5: EMF on stdout, parsed by CloudWatch under the TEXT log format.
const metrics = new EmfMetricsAdapter({ sink: process.stdout, clock });

async function build(): Promise<Reconciler> {
  const secret = databaseSecretSchema.parse(await secretReader.read(config.databaseSecretArn));
  // The key never reaches a log, an error or an output (integrations.md rule 7).
  const resend = resendConfiguration(
    config.webhookId,
    await secretReader.read(config.resendApiKeySecretArn),
  );
  const database = createDatabase({ url: secret.pooledUrl, max: 1, logger });
  return createReconciler({
    db: database.db,
    resend:
      resend === undefined
        ? undefined
        : createResendClient({
            apiKey: resend.apiKey,
            baseUrl: RESEND_API_BASE_URL,
            userAgent: RECONCILER_USER_AGENT,
            clock,
            sleep: (ms) => sleep(ms),
            logger,
          }),
    webhookId: resend?.webhookId,
    queueAttributes,
    clock,
    logger,
    metrics,
  });
}

// Invalidated on a failed build only, so a transient secret read is retried on the next invocation.
let built: Promise<Reconciler> | undefined;
const reconcilerOnce = (): Promise<Reconciler> => {
  built ??= build().catch((error: unknown) => {
    built = undefined;
    throw error;
  });
  return built;
};

export const reconciler: Reconciler = {
  runScheduled: async () => (await reconcilerOnce()).runScheduled(),
  runClaimed: async (runId) => (await reconcilerOnce()).runClaimed(runId),
};
