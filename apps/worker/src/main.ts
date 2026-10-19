import {
  createLambdaClient,
  createSecretsManagerClient,
  LambdaEventSourceControlAdapter,
  SecretsManagerSecretReaderAdapter,
} from '@ledger/aws';
import { createDatabase, STORAGE_LIMIT_BYTES } from '@ledger/db';
import { type ClockPort, createLogger, EmfMetricsAdapter, loadConfig } from '@ledger/shared';
import { createWorker, type Worker } from '@ledger/worker';
import type { InvocationFields } from './create-worker-handler.ts';
import { databaseSecretSchema } from './database-secret.schema.ts';
import { workerConfigSchema } from './worker.config.ts';

// Composition root of the worker Lambda (ADR-013, D17). The config parse, the clients and the
// adapters are built once per container at module scope. The `ledger/database` secret is read, and
// the size-1 pool built from it, on the first invocation through one memoized promise (D32), so
// importing the bundle needs no AWS access; every warm invocation reuses them (ADR-005).

const config = loadConfig(workerConfigSchema, process.env);

// D6: refreshed by the handler at the start of each invocation and merged into every log line.
export const invocation: InvocationFields = { request_id: undefined, cold_start: true };
export const logger = createLogger({ functionName: 'worker', context: () => invocation });

const clock: ClockPort = { now: () => new Date() };
const secretReader = new SecretsManagerSecretReaderAdapter({
  client: createSecretsManagerClient(),
});
// D16, C5: the worker finds its own event source mapping by its own name.
const eventSource = new LambdaEventSourceControlAdapter({
  client: createLambdaClient(),
  functionName: config.functionName,
});
// D5: EMF on stdout, parsed by CloudWatch under the TEXT log format (D31).
const metrics = new EmfMetricsAdapter({ sink: process.stdout, clock });

async function build(): Promise<Worker> {
  const secret = databaseSecretSchema.parse(await secretReader.read(config.databaseSecretArn));
  // `pg` connects lazily, so a database outage surfaces inside `processBatch`, where ADR-015's
  // branch handles it, never here.
  const database = createDatabase({ url: secret.pooledUrl, max: 1, logger });
  return createWorker({
    database,
    eventSource,
    storageLimitBytes: STORAGE_LIMIT_BYTES,
    clock,
    logger,
    metrics,
    addressHashKey: secret.addressHashKey,
  });
}

// Invalidated on a failed build only, so a transient secret read is retried on the next invocation
// instead of failing every invocation of the container.
let built: Promise<Worker> | undefined;
const workerOnce = (): Promise<Worker> => {
  built ??= build().catch((error: unknown) => {
    built = undefined;
    throw error;
  });
  return built;
};

export const worker: Worker = {
  processBatch: async (messages, deadline) => (await workerOnce()).processBatch(messages, deadline),
  resume: async () => (await workerOnce()).resume(),
};
