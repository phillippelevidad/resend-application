// @ledger/shared: kernel (ports and their local implementations, logger, metrics, config, internal
// variable names, error base, clock, token mint and tag check). No AWS, Postgres or
// Resend (ADR-013). The package's one public surface; port doubles ship through `./testing`.
export { hashApiToken, hasValidTag, mintApiToken, tokenTagKeyId } from './api-token.ts';
export type { ClockPort } from './clock.port.ts';
export { ConfigError, type ConfigIssue } from './config.error.ts';
export {
  type CreateLoggerOptions,
  createLogger,
  type ErrorFields,
  errorFields,
  type LogFields,
  type Logger,
  type LogSink,
  logFieldKeys,
} from './create-logger.ts';
export type { DlqPort, DlqRawMessage, DlqSample, RedriveStart } from './dlq.port.ts';
export { EmfMetricsAdapter, type EmfMetricsDeps } from './emf-metrics.adapter.ts';
export type { EventSourceControlPort } from './event-source-control.port.ts';
export {
  apiEnv,
  ingestEnv,
  ingestSimulatorEnv,
  killSwitchEnv,
  workerEnv,
} from './function-env.ts';
export type { FunctionInvokePort } from './function-invoke.port.ts';
export { InProcessFunctionInvokeAdapter } from './in-process-function-invoke.adapter.ts';
export {
  type DeadListEntry,
  InProcessQueueAdapter,
  type InProcessQueueDeps,
} from './in-process-queue.adapter.ts';
export { LedgerError, type LedgerErrorOptions } from './ledger.error.ts';
export { type Env, loadConfig } from './load-config.ts';
export { LogMetricsAdapter } from './log-metrics.adapter.ts';
export { type MetricName, type MetricsPort, metricNames } from './metrics.port.ts';
export type { BatchResponse, QueueConsumer, QueueMessage, QueuePort } from './queue.port.ts';
export type { QueueAttributesPort, QueueSnapshot } from './queue-attributes.port.ts';
export type { SecretReaderPort } from './secret-reader.port.ts';
export { StaticEventSourceControlAdapter } from './static-event-source-control.adapter.ts';
export { StaticSecretReaderAdapter } from './static-secret-reader.adapter.ts';
