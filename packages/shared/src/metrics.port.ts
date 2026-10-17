import type { LogFields } from './create-logger.ts';

// D16: the fixed custom metric set of architecture.md → Technology. A new metric is a doc change
// first (AWS-12: every metric emitted in an hour costs money). `ingest.rejected`'s `reason` dimension
// and the `reconcile.*` metrics are emitted from slice 4.
export const metricNames = [
  'ingest.accepted',
  'ingest.rejected',
  'worker.duplicates',
  'worker.processing_lag',
  'reconcile.missing',
  'reconcile.replayed',
  'reconcile.failed',
  'projection.unknown_event_type',
  'worker.payload_sanitized',
] as const;

export type MetricName = (typeof metricNames)[number];

// D16: ids travel beside a metric as allow-listed log fields, never as dimensions (AWS-12).
export interface MetricsPort {
  count(name: MetricName, value: number, fields?: LogFields): void;
  duration(name: MetricName, ms: number, fields?: LogFields): void;
}
