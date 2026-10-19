// D25 step 3: the usage trip's headroom over a stubbed CloudWatch client. Fields from the
// DescribeAlarms (https://docs.aws.amazon.com/AmazonCloudWatch/latest/APIReference/API_DescribeAlarms.html)
// and GetMetricStatistics
// (https://docs.aws.amazon.com/AmazonCloudWatch/latest/APIReference/API_GetMetricStatistics.html)
// references.
import { type CloudWatchClient, InvalidParameterValueException } from '@aws-sdk/client-cloudwatch';
import { LedgerError } from '@ledger/shared';
import { FakeClock } from '@ledger/shared/testing';
import { describe, expect, it } from 'vitest';
import { readRequestCount } from './request-count.ts';
import { StubClient } from './testing/stub-client.ts';

const metadata = { $metadata: {} };
const alarmName = 'LedgerApp-usage-trip';
const dimensions = [{ Name: 'ApiId', Value: 'a1b2c3d4e5' }];

// The usage trip as the app stack declares it: the HTTP API's `Count`, `Sum` over 900 s, > 15,000.
const usageTrip = {
  AlarmName: alarmName,
  Namespace: 'AWS/ApiGateway',
  MetricName: 'Count',
  Dimensions: dimensions,
  Statistic: 'Sum',
  Period: 900,
  Threshold: 15_000,
  StateValue: 'OK',
};

const cloudWatchAnswering = (
  alarms: readonly object[],
  datapoints: readonly { Timestamp: Date; Sum: number }[],
) =>
  new StubClient()
    .answer('DescribeAlarms', () => ({ MetricAlarms: alarms, ...metadata }))
    .answer('GetMetricStatistics', () => ({ Label: 'Count', Datapoints: datapoints, ...metadata }));

const failureOf = (promise: Promise<unknown>): Promise<unknown> =>
  promise.then(
    () => undefined,
    (caught: unknown) => caught,
  );

describe('readRequestCount', () => {
  it("reads the named alarm, then its metric's Sum over the alarm's last Period", async () => {
    const clock = new FakeClock();
    const cloudWatch = cloudWatchAnswering([usageTrip], []);

    await readRequestCount(cloudWatch.as<CloudWatchClient>(), alarmName, clock);

    const end = clock.now();
    expect(cloudWatch.sent).toEqual([
      { name: 'DescribeAlarms', input: { AlarmNames: [alarmName] } },
      {
        name: 'GetMetricStatistics',
        input: {
          Namespace: 'AWS/ApiGateway',
          MetricName: 'Count',
          Dimensions: dimensions,
          StartTime: new Date(end.getTime() - 900_000),
          EndTime: end,
          Period: 900,
          Statistics: ['Sum'],
        },
      },
    ]);
  });

  it('maps the summed datapoints, the threshold and the period', async () => {
    const at = (minute: number) => new Date(Date.UTC(2026, 9, 19, 12, minute));
    const cloudWatch = cloudWatchAnswering(
      [usageTrip],
      [
        { Timestamp: at(0), Sum: 120 },
        { Timestamp: at(15), Sum: 30 },
      ],
    );

    expect(await readRequestCount(cloudWatch.as<CloudWatchClient>(), alarmName)).toEqual({
      recent: 150,
      threshold: 15_000,
      periodSeconds: 900,
    });
  });

  it('reads no datapoint as 0 requests', async () => {
    const cloudWatch = cloudWatchAnswering([usageTrip], []);

    expect((await readRequestCount(cloudWatch.as<CloudWatchClient>(), alarmName)).recent).toBe(0);
  });

  it('rejects a missing alarm as a constant internal_error and reads no metric', async () => {
    const cloudWatch = cloudWatchAnswering([], []);

    const failure = await failureOf(readRequestCount(cloudWatch.as<CloudWatchClient>(), alarmName));

    expect(failure).toBeInstanceOf(LedgerError);
    expect((failure as LedgerError).code).toBe('internal_error');
    expect(cloudWatch.names()).toEqual(['DescribeAlarms']);
  });

  it('rejects with the SDK error unchanged when the metric read fails (InvalidParameterValueException)', async () => {
    const error = new InvalidParameterValueException({ message: 'x', ...metadata });
    const cloudWatch = cloudWatchAnswering([usageTrip], []).answer('GetMetricStatistics', () => {
      throw error;
    });

    expect(await failureOf(readRequestCount(cloudWatch.as<CloudWatchClient>(), alarmName))).toBe(
      error,
    );
  });
});
