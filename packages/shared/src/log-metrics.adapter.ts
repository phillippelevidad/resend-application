import type { LogFields, Logger } from './create-logger.ts';
import type { MetricName, MetricsPort } from './metrics.port.ts';

// D16: slice 1's metrics writer. Locally a metric is a log line: the message is the metric name,
// the value is `value_count` or `value_ms`, beside the caller's allow-listed ids
// (pp-general → logging-and-pii, Metrics). The EMF writer is slice 2's.
export class LogMetricsAdapter implements MetricsPort {
  readonly #logger: Logger;

  constructor(logger: Logger) {
    this.#logger = logger;
  }

  count(name: MetricName, value: number, fields?: LogFields): void {
    this.#logger.info(name, { ...fields, value_count: value });
  }

  duration(name: MetricName, ms: number, fields?: LogFields): void {
    this.#logger.info(name, { ...fields, value_ms: ms });
  }
}
