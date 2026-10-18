import {
  type CloudWatchClient,
  DescribeAlarmsCommand,
  SetAlarmStateCommand,
  type StateValue,
} from '@aws-sdk/client-cloudwatch';
import { InvokeCommand, type LambdaClient } from '@aws-sdk/client-lambda';
import { PublishCommand, type SNSClient } from '@aws-sdk/client-sns';
import { LedgerError } from '@ledger/shared';

export type AlarmState = StateValue;

// D26, D36: the trip drill's AWS calls. Script-only, one object of client-first functions, so the
// drill composes them with its own polling.
export const alarmControl = {
  // D36 step 1: force an alarm into a state. CloudWatch re-evaluates it on its next period, so a forced
  // `ALARM` runs the alarm's actions once (the usage trip → the trip topic → the kill switch).
  async setState(
    cloudWatch: CloudWatchClient,
    alarmName: string,
    state: AlarmState,
    reason: string,
  ): Promise<void> {
    await cloudWatch.send(
      new SetAlarmStateCommand({ AlarmName: alarmName, StateValue: state, StateReason: reason }),
    );
  },

  // D36 step 4's poll: the alarm's current state, or `null` when no alarm has that name.
  async readState(cloudWatch: CloudWatchClient, alarmName: string): Promise<AlarmState | null> {
    const output = await cloudWatch.send(new DescribeAlarmsCommand({ AlarmNames: [alarmName] }));
    return output.MetricAlarms?.[0]?.StateValue ?? null;
  },

  // Publish one message to a topic, as Budgets or CloudWatch would.
  async publish(sns: SNSClient, topicArn: string, subject: string, message: string): Promise<void> {
    await sns.send(new PublishCommand({ TopicArn: topicArn, Subject: subject, Message: message }));
  },

  // D36 step 4: an asynchronous invoke (`Event`), which Lambda queues and answers `202` (Invoke API
  // Reference). The drill sends the kill switch a non-SNS payload, which it rejects, so its `Errors`
  // alarm fires.
  async invokeAsync(lambda: LambdaClient, functionName: string, payload: unknown): Promise<void> {
    const output = await lambda.send(
      new InvokeCommand({
        FunctionName: functionName,
        InvocationType: 'Event',
        Payload: new TextEncoder().encode(JSON.stringify(payload)),
      }),
    );
    if (output.StatusCode !== 202) {
      throw new LedgerError('internal_error', 'The asynchronous invoke was not accepted.');
    }
  },
};
