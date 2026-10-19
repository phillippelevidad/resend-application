import { ArnFormat, Aws, CfnOutput, Duration, Stack, type StackProps } from 'aws-cdk-lib';
import { CfnBudget } from 'aws-cdk-lib/aws-budgets';
import { Alarm, ComparisonOperator, Stats, TreatMissingData } from 'aws-cdk-lib/aws-cloudwatch';
import { SnsAction } from 'aws-cdk-lib/aws-cloudwatch-actions';
import { PolicyStatement, ServicePrincipal } from 'aws-cdk-lib/aws-iam';
import { Topic, TopicPolicy } from 'aws-cdk-lib/aws-sns';
import { EmailSubscription, LambdaSubscription } from 'aws-cdk-lib/aws-sns-subscriptions';
import type { Construct } from 'constructs';
import { killSwitchEnvironment } from './function-env.ts';
import { LedgerFunction } from './ledger-function.construct.ts';

// The fixed topic names, so the app stack can build the trip topic's ARN without importing it
// (aws.md → Budget alarms item 1).
export const tripTopicName = (guardrailsStackName: string): string => `${guardrailsStackName}-trip`;
export const alertTopicName = (guardrailsStackName: string): string =>
  `${guardrailsStackName}-alert`;

// aws.md → Budget alarms item 2: the cap's default, in USD.
export const DEFAULT_BUDGET_USD = 50;

// Item 3, AWS-33: the four notifications (of the five a budget allows). FORECASTED never trips,
// because a new account has no forecast; ACTUAL 100 % is the trip.
export const BUDGET_NOTIFICATIONS = [
  { notificationType: 'ACTUAL', threshold: 50, topic: 'alert' },
  { notificationType: 'ACTUAL', threshold: 80, topic: 'alert' },
  { notificationType: 'FORECASTED', threshold: 100, topic: 'alert' },
  { notificationType: 'ACTUAL', threshold: 100, topic: 'trip' },
] as const;

// AWS-33: the CloudFormation page allows five notifications per budget.
export const MAX_BUDGET_NOTIFICATIONS = 5;

// D28, C14: the drill budget's absolute threshold, in USD, low enough that the next budget refresh
// notifies (AWS-34). The real budget keeps its once-a-month ACTUAL alert untouched. CloudFormation's
// validation refuses a notification threshold below 0.1 (measured: `aws:deploy --budget-drill`
// failed synth at 0.01, WALKTHROUGH-RUN F3), so the drill uses that minimum.
export const DRILL_THRESHOLD_USD = 0.1;

// D28: the kill switch's size. It makes a few dozen AWS calls in sequence, well under a minute.
export const KILL_SWITCH_MEMORY_MB = 256;
export const KILL_SWITCH_TIMEOUT_SECONDS = 60;

// Item 4, AWS-30: the `Errors` alarm fires on the first failed invocation in a one-minute period.
export const KILL_SWITCH_ERRORS_PERIOD_SECONDS = 60;

// AWS-28: ten standard alarms are free; both stacks together stay within them, with no composite.
export const FREE_STANDARD_ALARMS = 10;

export type GuardrailsStackProps = StackProps & {
  // The app stack the kill switch acts on, by name only (item 1): no import, no reference.
  readonly appStackName: string;
  readonly budgetUsd: number;
  // Item 5, CBL-16: with the kill switch `on`, the trip topic invokes it; otherwise no subscription.
  readonly killSwitch: boolean;
  // D36: the drill budget exists only while the owner runs the budget part of the trip drill.
  readonly budgetDrill: boolean;
  // Item 3: subscribed to both topics when given; never committed, so it arrives as context (CBL-19).
  readonly alertEmail?: string | undefined;
};

// ADR-010, aws.md → Budget alarms: the budget, its two topics, the kill switch and its `Errors`
// alarm, in their own stack so an app-stack redeploy, failure or destroy never leaves a budget-alarm
// gap. Nothing here references the app stack's resources (no `Fn::ImportValue`, item 1).
export class GuardrailsStack extends Stack {
  constructor(scope: Construct, id: string, props: GuardrailsStackProps) {
    super(scope, id, props);
    const stackName = this.stackName;

    // AWS-35: unencrypted, because Budgets cannot publish to an encrypted topic.
    const tripTopic = new Topic(this, 'TripTopic', { topicName: tripTopicName(stackName) });
    const alertTopic = new Topic(this, 'AlertTopic', { topicName: alertTopicName(stackName) });

    // AWS-35: the topic policy lets Budgets publish; CloudWatch is granted too, because a topic
    // policy written here replaces the default one, and the usage-trip and `Errors` alarms publish
    // (D28). Both are held to this account.
    const allowServicePublish = (topic: Topic): TopicPolicy => {
      const policy = new TopicPolicy(this, `${topic.node.id}Policy`, { topics: [topic] });
      policy.document.addStatements(
        new PolicyStatement({
          sid: 'BudgetsAndAlarmsPublish',
          principals: [
            new ServicePrincipal('budgets.amazonaws.com'),
            new ServicePrincipal('cloudwatch.amazonaws.com'),
          ],
          actions: ['SNS:Publish'],
          resources: [topic.topicArn],
          conditions: { StringEquals: { 'aws:SourceAccount': Aws.ACCOUNT_ID } },
        }),
      );
      return policy;
    };
    const topicPolicies = [allowServicePublish(tripTopic), allowServicePublish(alertTopic)];

    // Item 3, C17: a notification takes one SNS subscriber (AWS-33), so the address reaches every
    // notification through the topics: it subscribes to both (two confirmations, CBL-03).
    if (props.alertEmail !== undefined) {
      tripTopic.addSubscription(new EmailSubscription(props.alertEmail));
      alertTopic.addSubscription(new EmailSubscription(props.alertEmail));
    }

    const topicArn = { alert: alertTopic.topicArn, trip: tripTopic.topicArn };

    // Item 2, AWS-32, AWS-52: one plain monthly cost budget, credits excluded so they cannot hide a
    // runaway.
    const budget = new CfnBudget(this, 'MonthlyBudget', {
      budget: {
        budgetName: `${stackName}-monthly`,
        budgetType: 'COST',
        timeUnit: 'MONTHLY',
        budgetLimit: { amount: props.budgetUsd, unit: 'USD' },
        costTypes: { includeCredit: false },
      },
      notificationsWithSubscribers: BUDGET_NOTIFICATIONS.map((notification) => ({
        notification: {
          notificationType: notification.notificationType,
          comparisonOperator: 'GREATER_THAN',
          threshold: notification.threshold,
          thresholdType: 'PERCENTAGE',
        },
        subscribers: [{ subscriptionType: 'SNS', address: topicArn[notification.topic] }],
      })),
    });
    // Budgets checks it may publish when the notification is created (AWS-35).
    budget.node.addDependency(...topicPolicies);

    if (props.budgetDrill) {
      const drill = new CfnBudget(this, 'DrillBudget', {
        budget: {
          budgetName: `${stackName}-drill`,
          budgetType: 'COST',
          timeUnit: 'MONTHLY',
          budgetLimit: { amount: props.budgetUsd, unit: 'USD' },
          costTypes: { includeCredit: false },
        },
        notificationsWithSubscribers: [
          {
            notification: {
              notificationType: 'ACTUAL',
              comparisonOperator: 'GREATER_THAN',
              threshold: DRILL_THRESHOLD_USD,
              thresholdType: 'ABSOLUTE_VALUE',
            },
            subscribers: [{ subscriptionType: 'SNS', address: tripTopic.topicArn }],
          },
        ],
      });
      drill.node.addDependency(...topicPolicies);
    }

    // Item 4, D29: always deployed, whether or not it is armed.
    const killSwitch = new LedgerFunction(this, 'KillSwitch', {
      app: 'kill-switch',
      functionName: `${stackName}-kill-switch`,
      memorySize: KILL_SWITCH_MEMORY_MB,
      timeout: Duration.seconds(KILL_SWITCH_TIMEOUT_SECONDS),
      environment: killSwitchEnvironment({
        appStackName: props.appStackName,
        alertTopicArn: alertTopic.topicArn,
      }),
    });
    this.grantKillSwitch(killSwitch, props.appStackName);
    alertTopic.grantPublish(killSwitch.fn);

    if (props.killSwitch) {
      tripTopic.addSubscription(new LambdaSubscription(killSwitch.fn));
    }

    // Item 4, AWS-53: Lambda discards an async event after its retries and the budget does not alert
    // again that month (AWS-34), so a failed trip emails the owner.
    const errors = new Alarm(this, 'KillSwitchErrors', {
      alarmName: `${stackName}-kill-switch-errors`,
      metric: killSwitch.fn.metricErrors({
        period: Duration.seconds(KILL_SWITCH_ERRORS_PERIOD_SECONDS),
        statistic: Stats.SUM,
      }),
      threshold: 0,
      comparisonOperator: ComparisonOperator.GREATER_THAN_THRESHOLD,
      evaluationPeriods: 1,
      treatMissingData: TreatMissingData.NOT_BREACHING,
    });
    errors.addAlarmAction(new SnsAction(alertTopic));

    // CBL-16 reads `KillSwitchArmed`; the scripts read the rest (D33, D36).
    new CfnOutput(this, 'KillSwitchArmed', { value: props.killSwitch ? 'true' : 'false' });
    new CfnOutput(this, 'TripTopicArn', { value: tripTopic.topicArn });
    new CfnOutput(this, 'AlertTopicArn', { value: alertTopic.topicArn });
    new CfnOutput(this, 'KillSwitchFunctionName', { value: killSwitch.fn.functionName });
  }

  // D29: only what the trip steps call, each on the narrowest resource its ARN allows. Targets are
  // found at trip time by the app stack's prefix, so later slices' functions are covered with no edit
  // (C18); the kill switch's own function and this stack never match it.
  private grantKillSwitch(killSwitch: LedgerFunction, appStackName: string): void {
    const lambdaArn = (resource: string, resourceName: string) =>
      this.formatArn({
        service: 'lambda',
        resource,
        resourceName,
        arnFormat: ArnFormat.COLON_RESOURCE_NAME,
      });
    // API Gateway ARNs carry no account (AWS-U11, read in the Service Authorization Reference).
    const apiGatewayArn = (path: string) =>
      this.formatArn({
        service: 'apigateway',
        account: '',
        resource: path,
        arnFormat: ArnFormat.NO_RESOURCE_NAME,
      });

    const statements = [
      // `ListFunctions` takes no resource-level permission.
      new PolicyStatement({ actions: ['lambda:ListFunctions'], resources: ['*'] }),
      new PolicyStatement({
        actions: ['lambda:GetFunctionConcurrency', 'lambda:PutFunctionConcurrency'],
        resources: [lambdaArn('function', `${appStackName}-*`)],
      }),
      // D16: the worker's mapping is found by its function name; `ListEventSourceMappings` takes no
      // resource-level permission.
      new PolicyStatement({ actions: ['lambda:ListEventSourceMappings'], resources: ['*'] }),
      // A mapping's ARN ends in a generated UUID, so the grant is every mapping narrowed by the
      // condition to the worker's (pp-infra → cdk-app.md → Function configuration).
      new PolicyStatement({
        actions: ['lambda:GetEventSourceMapping', 'lambda:UpdateEventSourceMapping'],
        resources: [lambdaArn('event-source-mapping', '*')],
        conditions: {
          StringEquals: { 'lambda:FunctionArn': lambdaArn('function', `${appStackName}-worker`) },
        },
      }),
      // AWS-U11: wider than an id-scoped grant, because the HTTP API's id is generated at deploy.
      // `GetApis` is GET on `/apis`; `GetStage` GET and `UpdateStage` PATCH on a stage.
      new PolicyStatement({
        actions: ['apigateway:GET'],
        resources: [apiGatewayArn('/apis'), apiGatewayArn('/apis/*/stages/*')],
      }),
      new PolicyStatement({
        actions: ['apigateway:PATCH'],
        resources: [apiGatewayArn('/apis/*/stages/*')],
      }),
    ];
    for (const statement of statements) killSwitch.fn.addToRolePolicy(statement);
  }
}
