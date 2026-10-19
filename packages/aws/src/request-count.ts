import {
  type CloudWatchClient,
  DescribeAlarmsCommand,
  GetMetricStatisticsCommand,
} from '@aws-sdk/client-cloudwatch';
import type { ClockPort } from '@ledger/shared';
import { LedgerError } from '@ledger/shared';

// D25 step 3: how close an alarm's metric is to its threshold right now.
export type RequestCount = {
  // The metric's `Sum` over the alarm's last `Period` seconds; `0` when CloudWatch has no datapoint.
  readonly recent: number;
  readonly threshold: number;
  readonly periodSeconds: number;
};

const systemClock: ClockPort = { now: () => new Date() };

// D25 step 3: the usage trip's headroom before a burst. One `DescribeAlarms` of the named alarm gives
// its metric (`Namespace`, `MetricName`, `Dimensions`), `Period` and `Threshold`, so the caller never
// derives the HTTP API's id or copies a constant; then `GetMetricStatistics` of that metric, `Sum`
// over the last `Period` seconds. Every datapoint returned is summed, so a window the service splits
// in two can only overstate the count, the safe side of a preflight. Script-only.
export async function readRequestCount(
  cloudWatch: CloudWatchClient,
  alarmName: string,
  clock: ClockPort = systemClock,
): Promise<RequestCount> {
  const alarms = await cloudWatch.send(new DescribeAlarmsCommand({ AlarmNames: [alarmName] }));
  const alarm = alarms.MetricAlarms?.length === 1 ? alarms.MetricAlarms[0] : undefined;
  if (
    alarm?.Namespace === undefined ||
    alarm.MetricName === undefined ||
    alarm.Period === undefined ||
    alarm.Threshold === undefined
  ) {
    throw new LedgerError('internal_error', 'The alarm is missing or not on a single metric.');
  }
  const end = clock.now();
  const output = await cloudWatch.send(
    new GetMetricStatisticsCommand({
      Namespace: alarm.Namespace,
      MetricName: alarm.MetricName,
      Dimensions: alarm.Dimensions ?? [],
      StartTime: new Date(end.getTime() - alarm.Period * 1000),
      EndTime: end,
      Period: alarm.Period,
      Statistics: ['Sum'],
    }),
  );
  const recent = (output.Datapoints ?? []).reduce((total, point) => total + (point.Sum ?? 0), 0);
  return { recent, threshold: alarm.Threshold, periodSeconds: alarm.Period };
}
