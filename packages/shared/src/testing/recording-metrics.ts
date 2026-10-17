import type { LogFields } from '../create-logger.ts';
import type { MetricName, MetricsPort } from '../metrics.port.ts';

export type RecordedMetric = {
  readonly kind: 'count' | 'duration';
  readonly name: MetricName;
  readonly value: number;
  readonly fields: LogFields;
};

// D7: the metrics port's test double. It holds every metric emitted, in order, so a test asserts
// what was emitted (the metric is the consequence), never that a method was called.
export class RecordingMetrics implements MetricsPort {
  readonly recorded: RecordedMetric[] = [];

  count(name: MetricName, value: number, fields: LogFields = {}): void {
    this.recorded.push({ kind: 'count', name, value, fields });
  }

  duration(name: MetricName, ms: number, fields: LogFields = {}): void {
    this.recorded.push({ kind: 'duration', name, value: ms, fields });
  }
}
