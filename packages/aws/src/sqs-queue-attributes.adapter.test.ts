// D1, D19, D26: queue depth and age over stubbed SQS and CloudWatch clients. Error names from the API
// References: GetQueueAttributes
// (https://docs.aws.amazon.com/AWSSimpleQueueService/latest/APIReference/API_GetQueueAttributes.html#API_GetQueueAttributes_Errors)
// and GetMetricStatistics
// (https://docs.aws.amazon.com/AmazonCloudWatch/latest/APIReference/API_GetMetricStatistics.html#API_GetMetricStatistics_Errors).
import { type CloudWatchClient, InternalServiceFault } from '@aws-sdk/client-cloudwatch';
import { QueueDoesNotExist, type SQSClient } from '@aws-sdk/client-sqs';
import { LedgerError } from '@ledger/shared';
import { FakeClock, queueAttributesPortContract } from '@ledger/shared/testing';
import { describe, expect, it } from 'vitest';
import { SqsQueueAttributesAdapter } from './sqs-queue-attributes.adapter.ts';
import { StubClient } from './testing/stub-client.ts';

const metadata = { $metadata: {} };
const queueUrl = 'https://sqs.us-east-2.amazonaws.com/000000000000/LedgerApp-SourceQueue7A1B2C';
const dlqUrl = 'https://sqs.us-east-2.amazonaws.com/000000000000/LedgerApp-DeadLetterQueue3D4E';

type Counts = { visible: number; inFlight: number };

const sqsHolding = (source: Counts, dlq: Counts = { visible: 0, inFlight: 0 }) =>
  new StubClient().answer('GetQueueAttributes', (input) => {
    const counts = input.QueueUrl === queueUrl ? source : dlq;
    return {
      Attributes: {
        ApproximateNumberOfMessages: String(counts.visible),
        ApproximateNumberOfMessagesNotVisible: String(counts.inFlight),
      },
      ...metadata,
    };
  });

const cloudWatchAnswering = (datapoints: readonly { Timestamp: Date; Maximum: number }[]) =>
  new StubClient().answer('GetMetricStatistics', () => ({
    Label: 'ApproximateAgeOfOldestMessage',
    Datapoints: datapoints,
    ...metadata,
  }));

const adapter = (sqs: StubClient, cloudWatch: StubClient, clock = new FakeClock()) =>
  new SqsQueueAttributesAdapter({
    sqs: sqs.as<SQSClient>(),
    cloudWatch: cloudWatch.as<CloudWatchClient>(),
    queueUrl,
    dlqUrl,
    clock,
  });

describe('SqsQueueAttributesAdapter', () => {
  it('reads both queues and the age statistic with the D19 query', async () => {
    const clock = new FakeClock();
    const sqs = sqsHolding({ visible: 4, inFlight: 2 }, { visible: 1, inFlight: 0 });
    const cloudWatch = cloudWatchAnswering([]);

    await adapter(sqs, cloudWatch, clock).read();

    const attributeNames = ['ApproximateNumberOfMessages', 'ApproximateNumberOfMessagesNotVisible'];
    expect(sqs.sent).toEqual([
      { name: 'GetQueueAttributes', input: { QueueUrl: queueUrl, AttributeNames: attributeNames } },
      { name: 'GetQueueAttributes', input: { QueueUrl: dlqUrl, AttributeNames: attributeNames } },
    ]);
    const end = clock.now();
    expect(cloudWatch.sent).toEqual([
      {
        name: 'GetMetricStatistics',
        input: {
          Namespace: 'AWS/SQS',
          MetricName: 'ApproximateAgeOfOldestMessage',
          Dimensions: [{ Name: 'QueueName', Value: 'LedgerApp-SourceQueue7A1B2C' }],
          StartTime: new Date(end.getTime() - 5 * 60_000),
          EndTime: end,
          Period: 60,
          Statistics: ['Maximum'],
        },
      },
    ]);
  });

  it('maps the counts and the newest datapoint, floored to whole seconds', async () => {
    const at = (minute: number) => new Date(Date.UTC(2026, 9, 17, 12, minute));
    const cloudWatch = cloudWatchAnswering([
      { Timestamp: at(1), Maximum: 300 },
      { Timestamp: at(3), Maximum: 42.9 },
      { Timestamp: at(2), Maximum: 120 },
    ]);
    const sqs = sqsHolding({ visible: 4, inFlight: 2 }, { visible: 1, inFlight: 3 });

    expect(await adapter(sqs, cloudWatch).read()).toEqual({
      visible: 4,
      inFlight: 2,
      oldestAgeSeconds: 42,
      dlqVisible: 1,
      dlqInFlight: 3,
    });
  });

  it('reads no datapoint as a null age (an idle queue stops reporting, AWS-22)', async () => {
    const sqs = sqsHolding({ visible: 2, inFlight: 0 });

    expect((await adapter(sqs, cloudWatchAnswering([])).read()).oldestAgeSeconds).toBeNull();
  });

  it('reads a queue holding no message as a null age, whatever the statistic says', async () => {
    const at = new Date(Date.UTC(2026, 9, 17, 12, 0));
    const sqs = sqsHolding({ visible: 0, inFlight: 0 });

    const snapshot = await adapter(
      sqs,
      cloudWatchAnswering([{ Timestamp: at, Maximum: 0 }]),
    ).read();

    expect(snapshot.oldestAgeSeconds).toBeNull();
  });

  it('rejects with the SDK error unchanged when a queue read fails (QueueDoesNotExist)', async () => {
    const sqs = new StubClient().answer('GetQueueAttributes', () => {
      throw new QueueDoesNotExist({ message: 'gone', ...metadata });
    });

    const failure = await adapter(sqs, cloudWatchAnswering([]))
      .read()
      .catch((caught: unknown) => caught);

    expect((failure as Error).name).toBe('QueueDoesNotExist');
  });

  it('rejects with the SDK error unchanged when the age read fails (InternalServiceFault)', async () => {
    const cloudWatch = new StubClient().answer('GetMetricStatistics', () => {
      throw new InternalServiceFault({ message: 'oops', ...metadata });
    });

    const failure = await adapter(sqsHolding({ visible: 1, inFlight: 0 }), cloudWatch)
      .read()
      .catch((caught: unknown) => caught);

    expect((failure as Error).name).toBe('InternalServiceFault');
  });

  it('rejects an answer missing a requested attribute as a constant internal_error', async () => {
    const sqs = new StubClient().answer('GetQueueAttributes', () => ({
      Attributes: {},
      ...metadata,
    }));

    const failure = await adapter(sqs, cloudWatchAnswering([]))
      .read()
      .catch((caught: unknown) => caught);

    expect(failure).toBeInstanceOf(LedgerError);
    expect((failure as LedgerError).code).toBe('internal_error');
  });
});

queueAttributesPortContract('SqsQueueAttributesAdapter', () => {
  const clock = new FakeClock();
  const source: Counts = { visible: 0, inFlight: 0 };
  const datapoints: { Timestamp: Date; Maximum: number }[] = [];
  const sqs = new StubClient().answer('GetQueueAttributes', (input) => {
    const counts = input.QueueUrl === queueUrl ? source : { visible: 0, inFlight: 0 };
    return {
      Attributes: {
        ApproximateNumberOfMessages: String(counts.visible),
        ApproximateNumberOfMessagesNotVisible: String(counts.inFlight),
      },
      ...metadata,
    };
  });
  const cloudWatch = new StubClient().answer('GetMetricStatistics', () => ({
    Datapoints: [...datapoints],
    ...metadata,
  }));
  return {
    port: adapter(sqs, cloudWatch, clock),
    // SQS counts the waiting messages; CloudWatch reports the oldest one's age a minute ago.
    holdWaiting: async (count, oldestAgeSeconds) => {
      source.visible = count;
      datapoints.push({
        Timestamp: new Date(clock.now().getTime() - 60_000),
        Maximum: oldestAgeSeconds,
      });
    },
  };
});
