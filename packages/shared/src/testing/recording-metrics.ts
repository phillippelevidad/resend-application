import type { LogFields } from '../create-logger.ts';
import type { MetricDimensionArgs, MetricName, MetricsPort } from '../metrics.port.ts';

export type RecordedMetric = {
  readonly kind: 'count' | 'duration';
  readonly name: MetricName;
  readonly value: number;
  readonly fields: LogFields;
  // Slice 4 D8: present only for a dimensioned metric (`ingest.rejected`'s `reason`).
  readonly dimensions?: Readonly<Record<string, string>>;
};

// D7: the metrics port's test double. It holds every metric emitted, in order, so a test asserts
// what was emitted (the metric is the consequence), never that a method was called.
export class RecordingMetrics implements MetricsPort {
  readonly recorded: RecordedMetric[] = [];

  count<N extends MetricName>(
    name: N,
    value: number,
    fields: LogFields = {},
    ...dimensions: MetricDimensionArgs<N>
  ): void {
    const [dims] = dimensions;
    this.recorded.push({
      kind: 'count',
      name,
      value,
      fields,
      ...(dims === undefined ? {} : { dimensions: dims }),
    });
  }

  duration(name: MetricName, ms: number, fields: LogFields = {}): void {
    this.recorded.push({ kind: 'duration', name, value: ms, fields });
  }
}
