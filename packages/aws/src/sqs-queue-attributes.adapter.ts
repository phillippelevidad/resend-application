import { type CloudWatchClient, GetMetricStatisticsCommand } from '@aws-sdk/client-cloudwatch';
import { GetQueueAttributesCommand, type SQSClient } from '@aws-sdk/client-sqs';
import type { ClockPort, QueueAttributesPort, QueueSnapshot } from '@ledger/shared';
import { LedgerError } from '@ledger/shared';

export type SqsQueueAttributesAdapterDeps = {
  sqs: SQSClient;
  cloudWatch: CloudWatchClient;
  queueUrl: string;
  dlqUrl: string;
  // Sets the age query's window; the system clock unless a test passes its own.
  clock?: ClockPort;
};

// D19: the age statistic's window and period. SQS pushes its metrics every minute (AWS-22).
const AGE_WINDOW_MS = 5 * 60_000;
const AGE_PERIOD_SECONDS = 60;

const systemClock: ClockPort = { now: () => new Date() };

// D1, D19: the source queue and its DLQ as `health.get` reports them. Counts are `GetQueueAttributes`'
// approximate visible and not-visible numbers (AWS-22). `GetQueueAttributes` returns no age (C4), so
// the age is CloudWatch's `ApproximateAgeOfOldestMessage`, `Maximum`, over the last five minutes, its
// newest datapoint in whole seconds. No datapoint reads `null` (an idle queue stops reporting after
// 6 h, AWS-22), and so does a queue holding no message, which is what `null` means on the port.
// The three reads run at once, inside the read API's timeout (D27). A failed read rejects with the
// SDK's error; `health.get` answers `500` on it (D19).
export class SqsQueueAttributesAdapter implements QueueAttributesPort {
  readonly #sqs: SQSClient;
  readonly #cloudWatch: CloudWatchClient;
  readonly #queueUrl: string;
  readonly #dlqUrl: string;
  readonly #clock: ClockPort;

  constructor({
    sqs,
    cloudWatch,
    queueUrl,
    dlqUrl,
    clock = systemClock,
  }: SqsQueueAttributesAdapterDeps) {
    this.#sqs = sqs;
    this.#cloudWatch = cloudWatch;
    this.#queueUrl = queueUrl;
    this.#dlqUrl = dlqUrl;
    this.#clock = clock;
  }

  async read(): Promise<QueueSnapshot> {
    const [source, dlq, age] = await Promise.all([
      this.#counts(this.#queueUrl),
      this.#counts(this.#dlqUrl),
      this.#oldestAgeSeconds(),
    ]);
    return {
      visible: source.visible,
      inFlight: source.inFlight,
      oldestAgeSeconds: source.visible + source.inFlight === 0 ? null : age,
      dlqVisible: dlq.visible,
      dlqInFlight: dlq.inFlight,
    };
  }

  async #counts(queueUrl: string): Promise<{ visible: number; inFlight: number }> {
    const output = await this.#sqs.send(
      new GetQueueAttributesCommand({
        QueueUrl: queueUrl,
        AttributeNames: ['ApproximateNumberOfMessages', 'ApproximateNumberOfMessagesNotVisible'],
      }),
    );
    return {
      visible: count(output.Attributes?.ApproximateNumberOfMessages),
      inFlight: count(output.Attributes?.ApproximateNumberOfMessagesNotVisible),
    };
  }

  async #oldestAgeSeconds(): Promise<number | null> {
    const end = this.#clock.now();
    const output = await this.#cloudWatch.send(
      new GetMetricStatisticsCommand({
        Namespace: 'AWS/SQS',
        MetricName: 'ApproximateAgeOfOldestMessage',
        // The metric's dimension is the queue name: the URL's last path segment.
        Dimensions: [{ Name: 'QueueName', Value: this.#queueUrl.split('/').at(-1) ?? '' }],
        StartTime: new Date(end.getTime() - AGE_WINDOW_MS),
        EndTime: end,
        Period: AGE_PERIOD_SECONDS,
        Statistics: ['Maximum'],
      }),
    );
    let newest: { at: number; maximum: number } | undefined;
    for (const point of output.Datapoints ?? []) {
      if (point.Timestamp === undefined || point.Maximum === undefined) continue;
      const at = point.Timestamp.getTime();
      if (newest === undefined || at > newest.at) newest = { at, maximum: point.Maximum };
    }
    return newest === undefined ? null : Math.floor(newest.maximum);
  }
}

// An attribute SQS always returns when asked; a missing or non-numeric one means the answer is not
// what this adapter asked for.
const count = (value: string | undefined): number => {
  const parsed = Number(value);
  if (value === undefined || !Number.isInteger(parsed) || parsed < 0) {
    throw new LedgerError('internal_error', 'A queue attribute was missing or not a count.');
  }
  return parsed;
};
