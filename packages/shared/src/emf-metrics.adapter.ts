import type { ClockPort } from './clock.port.ts';
import { allowListed, type LogFields, type LogSink } from './create-logger.ts';
import type { MetricName, MetricsPort } from './metrics.port.ts';

export type EmfMetricsDeps = {
  // `process.stdout.write` on Lambda: under the JSON log format CloudWatch does not parse EMF that
  // `console.log` wrapped (pp-general → logging-and-pii, Metrics).
  sink: LogSink;
  clock: ClockPort;
};

type EmfUnit = 'Count' | 'Milliseconds';

// D5: the Lambda roots' metrics writer, no library: one CloudWatch Embedded Metric Format line per
// call, namespace `Ledger`, one empty dimension set (ids are never dimensions, AWS-12), the value
// under the metric's name, beside the caller's allow-listed log fields. `apps/local` keeps
// `LogMetricsAdapter`.
export class EmfMetricsAdapter implements MetricsPort {
  readonly #sink: LogSink;
  readonly #clock: ClockPort;

  constructor({ sink, clock }: EmfMetricsDeps) {
    this.#sink = sink;
    this.#clock = clock;
  }

  count(name: MetricName, value: number, fields?: LogFields): void {
    this.#write(name, 'Count', value, fields);
  }

  duration(name: MetricName, ms: number, fields?: LogFields): void {
    this.#write(name, 'Milliseconds', ms, fields);
  }

  // The metric's own keys go last, so no field can overwrite them; the allow-list admits neither
  // `_aws` nor a dotted metric name in any case.
  #write(name: MetricName, unit: EmfUnit, value: number, fields: LogFields | undefined): void {
    const line = {
      ...allowListed(fields),
      _aws: {
        Timestamp: this.#clock.now().getTime(),
        CloudWatchMetrics: [
          { Namespace: 'Ledger', Dimensions: [[]], Metrics: [{ Name: name, Unit: unit }] },
        ],
      },
      [name]: value,
    };
    this.#sink.write(`${JSON.stringify(line)}\n`);
  }
}
