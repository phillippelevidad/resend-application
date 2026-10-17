// @ledger/shared: kernel (ports, logger, metrics, config, error base, clock). No AWS, Postgres or
// Resend (ADR-013). The package's one public surface; port doubles ship through `./testing`.
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
