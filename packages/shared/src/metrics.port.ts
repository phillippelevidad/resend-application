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

// Slice 4 D33: why ingest answered `401`, the one dimension's closed set.
export type IngestRejectReason = 'signature' | 'timestamp';

// Slice 4 D8: the only dimensioned metric, a closed set of values, so its cost stays fixed (AWS-12).
export type MetricDimensions = {
  'ingest.rejected': { readonly reason: IngestRejectReason };
};

// A metric in `MetricDimensions` takes its dimensions, required; every other name takes none.
export type MetricDimensionArgs<N extends MetricName> = N extends keyof MetricDimensions
  ? [dimensions: MetricDimensions[N]]
  : [];

// D16: ids travel beside a metric as allow-listed log fields, never as dimensions (AWS-12).
export interface MetricsPort {
  count<N extends MetricName>(
    name: N,
    value: number,
    fields?: LogFields,
    ...dimensions: MetricDimensionArgs<N>
  ): void;
  duration(name: MetricName, ms: number, fields?: LogFields): void;
}
