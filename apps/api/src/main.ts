import { createApi } from '@ledger/api';
import {
  createCloudWatchClient,
  createLambdaClient,
  createSecretsManagerClient,
  createSqsClient,
  LambdaAsyncFunctionInvokeAdapter,
  LambdaEventSourceControlAdapter,
  LambdaFunctionInvokeAdapter,
  SecretsManagerSecretReaderAdapter,
  SqsDlqAdapter,
  SqsQueueAttributesAdapter,
} from '@ledger/aws';
import { createDatabase, STORAGE_LIMIT_BYTES } from '@ledger/db';
import { createLogger, loadConfig } from '@ledger/shared';
import { apiConfigSchema } from './api.config.ts';
import { type InvocationFields, lambdaRequestId } from './create-api-handler.ts';
import { databaseSecretSchema } from './database-secret.schema.ts';

// Composition root of the API Lambda (ADR-013, D23). The config parse, the clients and the adapters
// are built once per container at module scope. The `ledger/database` secret is read, and the size-1
// pool and the app built from it, on the first invocation through one memoized promise (D32), so
// importing the bundle needs no AWS access; every warm invocation reuses them (ADR-005).

const config = loadConfig(apiConfigSchema, process.env);

// D6: refreshed by the handler at the start of each invocation and merged into every log line.
export const invocation: InvocationFields = { request_id: undefined, cold_start: true };
export const logger = createLogger({ functionName: 'api', context: () => invocation });

const secretReader = new SecretsManagerSecretReaderAdapter({
  client: createSecretsManagerClient(),
});
const lambda = createLambdaClient();
const sqs = createSqsClient();
// D19: both queues' attributes, and the age from CloudWatch (AWS-57).
const queueAttributes = new SqsQueueAttributesAdapter({
  sqs,
  cloudWatch: createCloudWatchClient(),
  queueUrl: config.queueUrl,
  dlqUrl: config.dlqUrl,
});
// Slice 3, D4, D9: DLQ inspect and redrive; a redrive returns each message to the source queue.
const dlq = new SqsDlqAdapter({ sqs, dlqUrl: config.dlqUrl, queueUrl: config.queueUrl });
// D16, C5: the worker's mapping found by the worker's name; the resume sent to the same function.
const eventSource = new LambdaEventSourceControlAdapter({
  client: lambda,
  functionName: config.workerFunctionName,
});
const workerInvoke = new LambdaFunctionInvokeAdapter({
  client: lambda,
  functionName: config.workerFunctionName,
});
// Slice 4 D28: `reconcile.start` hands its run to the reconciler as an `Event` invoke.
const reconcilerInvoke = new LambdaAsyncFunctionInvokeAdapter({
  client: lambda,
  functionName: config.reconcilerFunctionName,
});
const clock = { now: () => new Date() };

type Api = ReturnType<typeof createApi>;

async function build(): Promise<Api> {
  const secret = databaseSecretSchema.parse(await secretReader.read(config.databaseSecretArn));
  // `pg` connects lazily, so a database outage surfaces inside a request, where `onError` answers
  // `503` and `health.get` still answers (D18, D19), never here.
  const database = createDatabase({ url: secret.pooledUrl, max: 1, logger });
  return createApi({
    db: database.db,
    logger,
    addressHashKey: secret.addressHashKey,
    tokenTagKey: secret.tokenTagKey,
    requestId: lambdaRequestId,
    queueAttributes,
    eventSource,
    workerInvoke,
    dlq,
    reconcilerInvoke,
    clock,
    storageLimitBytes: STORAGE_LIMIT_BYTES,
  });
}

// Invalidated on a failed build only, so a transient secret read is retried on the next invocation
// instead of failing every invocation of the container.
let built: Promise<Api> | undefined;
export const app = (): Promise<Api> => {
  built ??= build().catch((error: unknown) => {
    built = undefined;
    throw error;
  });
  return built;
};
