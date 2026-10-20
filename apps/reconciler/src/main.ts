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
import { composeReconciler } from './compose-reconciler.ts';
import type { InvocationFields } from './create-reconciler-handler.ts';
import { databaseSecretSchema } from './database-secret.schema.ts';
import {
  RECONCILER_USER_AGENT,
  RESEND_API_BASE_URL,
  reconcilerConfigSchema,
} from './reconciler.config.ts';

// Composition root of the reconciler Lambda (ADR-013, slice 4 D20). The config parse, the clients
// and the adapters are built once per container at module scope. The size-1 pool is built from
// `ledger/database` on the first invocation; the Resend key is read on every invocation, and the
// Resend client rebuilt when it changed (`compose-reconciler.ts`). Importing the bundle needs no
// AWS access (`apps/worker/src/main.ts`'s pattern).

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

export const reconciler: Reconciler = composeReconciler({
  openDatabase: async () => {
    const secret = databaseSecretSchema.parse(await secretReader.read(config.databaseSecretArn));
    return createDatabase({ url: secret.pooledUrl, max: 1, logger }).db;
  },
  readResendApiKey: () => secretReader.read(config.resendApiKeySecretArn),
  webhookId: config.webhookId,
  build: (db, resend) =>
    createReconciler({
      db,
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
    }),
});
