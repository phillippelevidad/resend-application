// D26, D36: the trip drill's calls over stubbed CloudWatch, SNS and Lambda clients. Error names and
// the `202` from the API References: SetAlarmState
// (https://docs.aws.amazon.com/AmazonCloudWatch/latest/APIReference/API_SetAlarmState.html#API_SetAlarmState_Errors)
// and Invoke (https://docs.aws.amazon.com/lambda/latest/api/API_Invoke.html#API_Invoke_ResponseElements).
import { type CloudWatchClient, ResourceNotFound } from '@aws-sdk/client-cloudwatch';
import type { LambdaClient } from '@aws-sdk/client-lambda';
import type { SNSClient } from '@aws-sdk/client-sns';
import { LedgerError } from '@ledger/shared';
import { describe, expect, it } from 'vitest';
import { alarmControl } from './alarm-control.ts';
import { StubClient } from './testing/stub-client.ts';

const metadata = { $metadata: {} };
const topicArn = 'arn:aws:sns:us-east-2:000000000000:LedgerGuardrails-trip';

describe('alarmControl', () => {
  it('setState sends one SetAlarmState with the state and reason', async () => {
    const stub = new StubClient().answer('SetAlarmState', () => metadata);

    await alarmControl.setState(
      stub.as<CloudWatchClient>(),
      'LedgerApp-usage-trip',
      'ALARM',
      'trip drill',
    );

    expect(stub.sent).toEqual([
      {
        name: 'SetAlarmState',
        input: {
          AlarmName: 'LedgerApp-usage-trip',
          StateValue: 'ALARM',
          StateReason: 'trip drill',
        },
      },
    ]);
  });

  it('setState rejects with the SDK error unchanged on a missing alarm (ResourceNotFound)', async () => {
    const stub = new StubClient().answer('SetAlarmState', () => {
      throw new ResourceNotFound({ message: 'no alarm', ...metadata });
    });

    const failure = await alarmControl
      .setState(stub.as<CloudWatchClient>(), 'LedgerApp-usage-trip', 'ALARM', 'trip drill')
      .catch((caught: unknown) => caught);

    expect((failure as Error).name).toBe('ResourceNotFound');
  });

  it('readState answers the named alarm state, or null when no alarm has the name', async () => {
    const stub = new StubClient().answer('DescribeAlarms', (input) => ({
      MetricAlarms:
        (input.AlarmNames as string[])[0] === 'LedgerGuardrails-kill-switch-errors'
          ? [{ AlarmName: 'LedgerGuardrails-kill-switch-errors', StateValue: 'ALARM' }]
          : [],
      ...metadata,
    }));
    const cloudWatch = stub.as<CloudWatchClient>();

    expect(await alarmControl.readState(cloudWatch, 'LedgerGuardrails-kill-switch-errors')).toBe(
      'ALARM',
    );
    expect(await alarmControl.readState(cloudWatch, 'missing')).toBeNull();
    expect(stub.inputs('DescribeAlarms')).toEqual([
      { AlarmNames: ['LedgerGuardrails-kill-switch-errors'] },
      { AlarmNames: ['missing'] },
    ]);
  });

  it('publish sends one Publish to the topic', async () => {
    const stub = new StubClient().answer('Publish', () => ({ MessageId: 'm-1', ...metadata }));

    await alarmControl.publish(stub.as<SNSClient>(), topicArn, 'drill', '{"drill":true}');

    expect(stub.sent).toEqual([
      {
        name: 'Publish',
        input: { TopicArn: topicArn, Subject: 'drill', Message: '{"drill":true}' },
      },
    ]);
  });

  it('invokeAsync sends an Event invoke and resolves on 202', async () => {
    const stub = new StubClient().answer('Invoke', () => ({ StatusCode: 202, ...metadata }));

    await alarmControl.invokeAsync(stub.as<LambdaClient>(), 'LedgerGuardrails-kill-switch', {
      drill: 'not-sns',
    });

    expect(stub.sent[0]?.input).toMatchObject({
      FunctionName: 'LedgerGuardrails-kill-switch',
      InvocationType: 'Event',
    });
    expect(JSON.parse(new TextDecoder().decode(stub.sent[0]?.input.Payload as Uint8Array))).toEqual(
      { drill: 'not-sns' },
    );
  });

  it('invokeAsync rejects any status but 202 as a constant internal_error', async () => {
    const stub = new StubClient().answer('Invoke', () => ({ StatusCode: 200, ...metadata }));

    const failure = await alarmControl
      .invokeAsync(stub.as<LambdaClient>(), 'LedgerGuardrails-kill-switch', {})
      .catch((caught: unknown) => caught);

    expect(failure).toBeInstanceOf(LedgerError);
    expect((failure as LedgerError).code).toBe('internal_error');
  });
});
