import {
  createSecretsManagerClient,
  createSqsClient,
  SecretsManagerSecretReaderAdapter,
  SqsQueueAdapter,
} from '@ledger/aws';
import { createIngest } from '@ledger/ingest';
import { type ClockPort, createLogger, EmfMetricsAdapter, loadConfig } from '@ledger/shared';
import type { InvocationFields } from './create-ingest-handler.ts';
import { ingestConfigSchema } from './ingest.config.ts';

// Composition root of the ingest Lambda (ADR-013, D14). Everything here runs once per container, at
// module scope (D32): the config parse, the clients and the factory, so a warm invocation reuses the
// clients and ingest's 5-minute secret-set cache (ADR-009). Nothing here makes a network call: the
// secret set is read on the first request through the port (D13), so importing the bundle needs no
// AWS access (D32's smoke check). Ingest has no database and no pool (ADR-001).

const config = loadConfig(ingestConfigSchema, process.env);

// D6: refreshed by the handler at the start of each invocation and merged into every log line.
export const invocation: InvocationFields = { request_id: undefined, cold_start: true };
export const logger = createLogger({ functionName: 'ingest', context: () => invocation });

const clock: ClockPort = { now: () => new Date() };

export const ingest = createIngest({
  secretReader: new SecretsManagerSecretReaderAdapter({ client: createSecretsManagerClient() }),
  signingSecretsId: config.signingSecretsArn,
  // ADR-016, D13: read through the same port, only on a stack deployed with the simulator on.
  simulatorSecretId: config.simulatorSecretArn,
  queue: new SqsQueueAdapter({ client: createSqsClient(), queueUrl: config.queueUrl }),
  clock,
  logger,
  // D5: EMF on stdout, parsed by CloudWatch under the TEXT log format (D31).
  metrics: new EmfMetricsAdapter({ sink: process.stdout, clock }),
});
