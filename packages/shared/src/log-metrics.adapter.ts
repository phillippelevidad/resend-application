import type { LogFields, Logger } from './create-logger.ts';
import type { MetricDimensionArgs, MetricName, MetricsPort } from './metrics.port.ts';

// D16: slice 1's metrics writer. Locally a metric is a log line: the message is the metric name,
// the value is `value_count` or `value_ms`, beside the caller's allow-listed ids
// (pp-general → logging-and-pii, Metrics). A dimension (slice 4 D8: `reason`) is a log field here.
// The EMF writer is slice 2's.
export class LogMetricsAdapter implements MetricsPort {
  readonly #logger: Logger;

  constructor(logger: Logger) {
    this.#logger = logger;
  }

  count<N extends MetricName>(
    name: N,
    value: number,
    fields?: LogFields,
    ...dimensions: MetricDimensionArgs<N>
  ): void {
    this.#logger.info(name, { ...fields, ...dimensions[0], value_count: value });
  }

  duration(name: MetricName, ms: number, fields?: LogFields): void {
    this.#logger.info(name, { ...fields, value_ms: ms });
  }
}
