// Slice 2, Ships 1 and 7, R20 (pp-infra → cost-brake-assertions): the guardrails template holds every
// cost-brake property that applies to it, each paired with a count, and the budget wiring of
// aws.md → Budget alarms: the budget excluding credits with its four notifications, both topics
// unencrypted and open to Budgets and CloudWatch, the kill switch (armed only with its flag) and its
// `Errors` alarm, the drill budget only with its flag, and no `Fn::ImportValue` (item 1). Synthesized
// both ways; no credentials and no AWS call.
import { killSwitchEnv } from '@ledger/shared';
import { App } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { describe, expect, it } from 'vitest';
import {
  alertTopicName,
  BUDGET_NOTIFICATIONS,
  DRILL_THRESHOLD_USD,
  GuardrailsStack,
  type GuardrailsStackProps,
  KILL_SWITCH_ERRORS_PERIOD_SECONDS,
  KILL_SWITCH_MEMORY_MB,
  KILL_SWITCH_TIMEOUT_SECONDS,
  MAX_BUDGET_NOTIFICATIONS,
  tripTopicName,
} from './guardrails.stack.ts';
import { LOG_RETENTION } from './ledger-function.construct.ts';

const APP_STACK_NAME = 'LedgerApp';
const GUARDRAILS_STACK_NAME = 'LedgerGuardrails';
const BUDGET_USD = 50;
const ALERT_EMAIL = 'delivered@resend.dev';

const synth = (overrides: Partial<GuardrailsStackProps> = {}): Template =>
  Template.fromStack(
    new GuardrailsStack(new App(), GUARDRAILS_STACK_NAME, {
      appStackName: APP_STACK_NAME,
      budgetUsd: BUDGET_USD,
      killSwitch: false,
      budgetDrill: false,
      ...overrides,
    }),
  );

// The two ways a deployment synthesizes: an adopter's default, and the owner's (armed, with an
// alert address), here also with the drill budget.
const disarmed = synth();
const armed = synth({ killSwitch: true, budgetDrill: true, alertEmail: ALERT_EMAIL });
const variants = [
  ['disarmed', disarmed],
  ['armed', armed],
] as const;

// Every resource this stack declares carries `Properties`.
type Resource = { Type: string; Properties: Record<string, unknown>; DeletionPolicy?: string };
type Statement = {
  Action: string | string[];
  Resource: unknown;
  Condition?: unknown;
  Principal?: unknown;
};

const resourcesOf = (template: Template, type: string): Record<string, Resource> =>
  template.findResources(type) as Record<string, Resource>;
const only = <T>(record: Record<string, T>): [string, T] => {
  const entries = Object.entries(record);
  expect(entries).toHaveLength(1);
  return entries[0] as [string, T];
};
const asArray = <T>(value: T | T[]): T[] => (Array.isArray(value) ? value : [value]);
const topicId = (template: Template, name: string): string =>
  only(
    Object.fromEntries(
      Object.entries(resourcesOf(template, 'AWS::SNS::Topic')).filter(
        ([, topic]) => topic.Properties.TopicName === name,
      ),
    ),
  )[0];
const killSwitchOf = (template: Template): [string, Resource] =>
  only(resourcesOf(template, 'AWS::Lambda::Function'));

describe.each(variants)('cost brake on the guardrails template (%s)', (_, template) => {
  it('runs the one function on arm64 and nodejs24.x (AWS-20, AWS-54)', () => {
    template.resourceCountIs('AWS::Lambda::Function', 1);
    template.allResourcesProperties('AWS::Lambda::Function', {
      Architectures: ['arm64'],
      Runtime: 'nodejs24.x',
    });
  });

  it('puts no function in a VPC and holds no EC2 resource (AWS-13, ADR-010)', () => {
    template.resourceCountIs('AWS::Lambda::Function', 1);
    template.allResourcesProperties('AWS::Lambda::Function', { VpcConfig: Match.absent() });
    const types = Object.values(template.toJSON().Resources as Record<string, Resource>).map(
      (resource) => resource.Type,
    );
    expect(types.filter((type) => type.startsWith('AWS::EC2::'))).toEqual([]);
  });

  it('gives the kill switch its own explicit log group, 30-day retention, destroyed, TEXT format (AWS-29, AWS-38, AWS-40, D31)', () => {
    const [, fn] = killSwitchOf(template);
    const [logGroupId] = only(resourcesOf(template, 'AWS::Logs::LogGroup'));
    expect(fn.Properties.LoggingConfig).toEqual({
      LogFormat: 'Text',
      LogGroup: { Ref: logGroupId },
    });
    template.allResources('AWS::Logs::LogGroup', {
      DeletionPolicy: 'Delete',
      Properties: Match.objectLike({ RetentionInDays: LOG_RETENTION }),
    });
  });

  it('holds no custom resource, no secret, no queue and no KMS key (AWS-40, AWS-11, AWS-25, AWS-31)', () => {
    const types = Object.values(template.toJSON().Resources as Record<string, Resource>).map(
      (resource) => resource.Type,
    );
    expect(types.length).toBeGreaterThan(0);
    expect(types.filter((type) => type.startsWith('Custom::'))).toEqual([]);
    // Built at run time, so pp-infra's review grep 4 stays a check on the stacks' code.
    template.resourceCountIs(['AWS::CloudFormation::', 'Custom', 'Resource'].join(''), 0);
    template.resourceCountIs('AWS::SecretsManager::Secret', 0);
    template.resourceCountIs('AWS::SQS::Queue', 0);
    template.resourceCountIs('AWS::KMS::Key', 0);
  });

  it('sets no reserved and no provisioned concurrency (AWS-16)', () => {
    template.resourceCountIs('AWS::Lambda::Function', 1);
    template.allResourcesProperties('AWS::Lambda::Function', {
      ReservedConcurrentExecutions: Match.absent(),
    });
    for (const type of ['AWS::Lambda::Alias', 'AWS::Lambda::Version']) {
      template.resourcePropertiesCountIs(
        type,
        { ProvisionedConcurrencyConfig: Match.anyValue() },
        0,
      );
    }
  });

  it('holds no Fn::ImportValue (aws.md → Budget alarms item 1)', () => {
    expect(JSON.stringify(template.toJSON())).not.toContain('Fn::ImportValue');
  });

  it('lets no secret value into the template (CBL-01)', () => {
    expect(JSON.stringify(template.toJSON())).not.toContain(
      ['resolve', 'secretsmanager'].join(':'),
    );
  });
});

describe.each(variants)('budget wiring on the guardrails template (%s)', (_, template) => {
  it('holds one monthly cost budget excluding credits, at the cap (items 2, AWS-32, AWS-52)', () => {
    const budgets = Object.values(resourcesOf(template, 'AWS::Budgets::Budget')).filter(
      (budget) =>
        (budget.Properties.Budget as { BudgetName: string }).BudgetName ===
        `${GUARDRAILS_STACK_NAME}-monthly`,
    );
    expect(budgets).toHaveLength(1);
    expect(budgets[0]?.Properties.Budget).toEqual({
      BudgetName: `${GUARDRAILS_STACK_NAME}-monthly`,
      BudgetType: 'COST',
      TimeUnit: 'MONTHLY',
      BudgetLimit: { Amount: BUDGET_USD, Unit: 'USD' },
      CostTypes: { IncludeCredit: false },
    });
  });

  it('sends ACTUAL 50 %, ACTUAL 80 % and FORECASTED 100 % to the alert topic and ACTUAL 100 % to the trip topic (item 3, AWS-33, C17)', () => {
    const [, budget] = only(
      Object.fromEntries(
        Object.entries(resourcesOf(template, 'AWS::Budgets::Budget')).filter(
          ([, b]) =>
            (b.Properties.Budget as { BudgetName: string }).BudgetName ===
            `${GUARDRAILS_STACK_NAME}-monthly`,
        ),
      ),
    );
    const alert = topicId(template, alertTopicName(GUARDRAILS_STACK_NAME));
    const trip = topicId(template, tripTopicName(GUARDRAILS_STACK_NAME));
    const notifications = budget.Properties.NotificationsWithSubscribers as unknown[];
    expect(BUDGET_NOTIFICATIONS.length).toBeLessThanOrEqual(MAX_BUDGET_NOTIFICATIONS);
    expect(notifications).toEqual(
      [
        ['ACTUAL', 50, alert],
        ['ACTUAL', 80, alert],
        ['FORECASTED', 100, alert],
        ['ACTUAL', 100, trip],
      ].map(([type, threshold, topic]) => ({
        Notification: {
          NotificationType: type,
          ComparisonOperator: 'GREATER_THAN',
          Threshold: threshold,
          ThresholdType: 'PERCENTAGE',
        },
        Subscribers: [{ SubscriptionType: 'SNS', Address: { Ref: topic } }],
      })),
    );
  });

  it('keeps both topics unencrypted, each with a policy letting Budgets and CloudWatch publish from this account (AWS-35, D28)', () => {
    template.resourceCountIs('AWS::SNS::Topic', 2);
    template.allResourcesProperties('AWS::SNS::Topic', { KmsMasterKeyId: Match.absent() });
    const policies = Object.values(resourcesOf(template, 'AWS::SNS::TopicPolicy'));
    expect(policies).toHaveLength(2);
    const covered = policies.flatMap((policy) =>
      (policy.Properties.Topics as { Ref: string }[]).map((topic) => topic.Ref),
    );
    expect(covered.sort()).toEqual(
      [
        topicId(template, tripTopicName(GUARDRAILS_STACK_NAME)),
        topicId(template, alertTopicName(GUARDRAILS_STACK_NAME)),
      ].sort(),
    );
    for (const policy of policies) {
      const topic = (policy.Properties.Topics as { Ref: string }[])[0];
      expect((policy.Properties.PolicyDocument as { Statement: Statement[] }).Statement).toEqual([
        expect.objectContaining({
          Action: 'SNS:Publish',
          Effect: 'Allow',
          Principal: { Service: ['budgets.amazonaws.com', 'cloudwatch.amazonaws.com'] },
          Resource: topic,
          Condition: { StringEquals: { 'aws:SourceAccount': { Ref: 'AWS::AccountId' } } },
        }),
      ]);
    }
  });

  it('names the topics with the fixed names the app stack builds the trip ARN from (item 1)', () => {
    topicId(template, tripTopicName(GUARDRAILS_STACK_NAME));
    topicId(template, alertTopicName(GUARDRAILS_STACK_NAME));
  });

  it('always deploys the kill switch, named, sized and pointed at the app stack by name (item 4, D28, D29)', () => {
    const [, fn] = killSwitchOf(template);
    const alert = topicId(template, alertTopicName(GUARDRAILS_STACK_NAME));
    expect(fn.Properties).toMatchObject({
      FunctionName: `${GUARDRAILS_STACK_NAME}-kill-switch`,
      MemorySize: KILL_SWITCH_MEMORY_MB,
      Timeout: KILL_SWITCH_TIMEOUT_SECONDS,
    });
    const variables = (fn.Properties.Environment as { Variables: Record<string, unknown> })
      .Variables;
    // C16: the kill switch's environment is exactly its kernel object's names.
    expect(Object.keys(variables).sort()).toEqual(Object.values(killSwitchEnv).sort());
    expect(variables[killSwitchEnv.APP_STACK_NAME]).toBe(APP_STACK_NAME);
    expect(variables[killSwitchEnv.ALERT_TOPIC_ARN]).toEqual({ Ref: alert });
  });

  it('alarms on any kill switch error within a minute, to the alert topic (item 4, AWS-28, AWS-30)', () => {
    const [, alarm] = only(resourcesOf(template, 'AWS::CloudWatch::Alarm'));
    expect(alarm.Properties).toMatchObject({
      AlarmName: `${GUARDRAILS_STACK_NAME}-kill-switch-errors`,
      Namespace: 'AWS/Lambda',
      MetricName: 'Errors',
      Dimensions: [{ Name: 'FunctionName', Value: { Ref: killSwitchOf(template)[0] } }],
      Statistic: 'Sum',
      Period: KILL_SWITCH_ERRORS_PERIOD_SECONDS,
      Threshold: 0,
      EvaluationPeriods: 1,
      ComparisonOperator: 'GreaterThanThreshold',
      TreatMissingData: 'notBreaching',
      AlarmActions: [{ Ref: topicId(template, alertTopicName(GUARDRAILS_STACK_NAME)) }],
    });
  });

  it("grants the kill switch only D29's calls, each on its narrowest resource (D29, AWS-U11)", () => {
    const [, fn] = killSwitchOf(template);
    const roleId = (fn.Properties.Role as { 'Fn::GetAtt': [string, string] })['Fn::GetAtt'][0];
    const statements = Object.values(resourcesOf(template, 'AWS::IAM::Policy'))
      .filter((policy) =>
        (policy.Properties.Roles as { Ref: string }[]).some((role) => role.Ref === roleId),
      )
      .flatMap(
        (policy) => (policy.Properties.PolicyDocument as { Statement: Statement[] }).Statement,
      );
    const grants = statements.map((statement) => ({
      actions: asArray(statement.Action).sort(),
      resources: asArray(statement.Resource).map((resource) => JSON.stringify(resource)),
      condition:
        statement.Condition === undefined ? undefined : JSON.stringify(statement.Condition),
    }));
    const actions = grants.flatMap((grant) => grant.actions).sort();
    expect(actions).toEqual(
      [
        'apigateway:GET',
        'apigateway:PATCH',
        'lambda:GetEventSourceMapping',
        'lambda:GetFunctionConcurrency',
        'lambda:ListEventSourceMappings',
        'lambda:ListFunctions',
        'lambda:PutFunctionConcurrency',
        'lambda:UpdateEventSourceMapping',
        'sns:Publish',
      ].sort(),
    );
    const grantOf = (action: string) => {
      const found = grants.filter((grant) => grant.actions.includes(action));
      expect(found).toHaveLength(1);
      return found[0] as (typeof grants)[number];
    };
    expect(grantOf('lambda:ListFunctions').resources).toEqual(['"*"']);
    expect(grantOf('lambda:PutFunctionConcurrency').resources).toHaveLength(1);
    expect(grantOf('lambda:PutFunctionConcurrency').resources[0]).toContain(
      `:function:${APP_STACK_NAME}-*`,
    );
    const mapping = grantOf('lambda:UpdateEventSourceMapping');
    expect(mapping.resources[0]).toContain(':event-source-mapping:*');
    expect(mapping.condition).toContain(`:function:${APP_STACK_NAME}-worker`);
    const get = grantOf('apigateway:GET');
    expect(get.resources).toHaveLength(2);
    expect(get.resources.some((r) => r.includes('::/apis"'))).toBe(true);
    expect(get.resources.some((r) => r.includes('::/apis/*/stages/*"'))).toBe(true);
    const patch = grantOf('apigateway:PATCH');
    expect(patch.resources).toHaveLength(1);
    expect(patch.resources[0]).toContain('::/apis/*/stages/*"');
    expect(grantOf('sns:Publish').resources).toEqual([
      JSON.stringify({ Ref: topicId(template, alertTopicName(GUARDRAILS_STACK_NAME)) }),
    ]);
  });
});

describe('the kill switch is deployed, armed by choice (item 5, CBL-16)', () => {
  it('subscribes the kill switch to the trip topic and outputs KillSwitchArmed true when armed', () => {
    const trip = topicId(armed, tripTopicName(GUARDRAILS_STACK_NAME));
    const [killSwitchId] = killSwitchOf(armed);
    armed.resourcePropertiesCountIs('AWS::SNS::Subscription', { Protocol: 'lambda' }, 1);
    armed.hasResourceProperties('AWS::SNS::Subscription', {
      Protocol: 'lambda',
      TopicArn: { Ref: trip },
      Endpoint: { 'Fn::GetAtt': [killSwitchId, 'Arn'] },
    });
    armed.hasResourceProperties('AWS::Lambda::Permission', {
      Action: 'lambda:InvokeFunction',
      Principal: 'sns.amazonaws.com',
      SourceArn: { Ref: trip },
    });
    expect(armed.toJSON().Outputs.KillSwitchArmed.Value).toBe('true');
  });

  it('keeps the function and its Errors alarm but no subscription, and outputs KillSwitchArmed false, by default', () => {
    disarmed.resourceCountIs('AWS::Lambda::Function', 1);
    disarmed.resourceCountIs('AWS::CloudWatch::Alarm', 1);
    disarmed.resourcePropertiesCountIs('AWS::SNS::Subscription', { Protocol: 'lambda' }, 0);
    disarmed.resourceCountIs('AWS::Lambda::Permission', 0);
    expect(disarmed.toJSON().Outputs.KillSwitchArmed.Value).toBe('false');
  });
});

describe('the alert address and the drill budget', () => {
  it('subscribes the alert address to both topics when given, and to none otherwise (item 3, C17, CBL-03)', () => {
    armed.resourcePropertiesCountIs('AWS::SNS::Subscription', { Protocol: 'email' }, 2);
    for (const name of [tripTopicName, alertTopicName]) {
      armed.hasResourceProperties('AWS::SNS::Subscription', {
        Protocol: 'email',
        Endpoint: ALERT_EMAIL,
        TopicArn: { Ref: topicId(armed, name(GUARDRAILS_STACK_NAME)) },
      });
    }
    disarmed.resourcePropertiesCountIs('AWS::SNS::Subscription', { Protocol: 'email' }, 0);
  });

  // The owner's kept deployment: armed, with an alert address, no drill. `armed` sets every flag at
  // once, so only this variant shows each flag keys its own resources: a drill budget keyed off
  // `killSwitch` would trip the whole stack on its first cent.
  it('keys each flag alone: armed with an address and no drill holds one budget, the subscription and both emails', () => {
    const owner = synth({ killSwitch: true, alertEmail: ALERT_EMAIL });
    owner.resourceCountIs('AWS::Budgets::Budget', 1);
    owner.resourcePropertiesCountIs('AWS::SNS::Subscription', { Protocol: 'lambda' }, 1);
    owner.resourcePropertiesCountIs('AWS::SNS::Subscription', { Protocol: 'email' }, 2);
    expect(owner.toJSON().Outputs.KillSwitchArmed.Value).toBe('true');
  }, 60_000);

  it('holds the drill budget only with its flag: ACTUAL above USD 0.01 to the trip topic (D28, D36, C14)', () => {
    disarmed.resourceCountIs('AWS::Budgets::Budget', 1);
    armed.resourceCountIs('AWS::Budgets::Budget', 2);
    armed.hasResourceProperties('AWS::Budgets::Budget', {
      Budget: Match.objectLike({
        BudgetName: `${GUARDRAILS_STACK_NAME}-drill`,
        CostTypes: { IncludeCredit: false },
      }),
      NotificationsWithSubscribers: [
        {
          Notification: {
            NotificationType: 'ACTUAL',
            ComparisonOperator: 'GREATER_THAN',
            Threshold: DRILL_THRESHOLD_USD,
            ThresholdType: 'ABSOLUTE_VALUE',
          },
          Subscribers: [
            {
              SubscriptionType: 'SNS',
              Address: { Ref: topicId(armed, tripTopicName(GUARDRAILS_STACK_NAME)) },
            },
          ],
        },
      ],
    });
  });

  it('outputs what the scripts read (D33, D36)', () => {
    for (const template of [disarmed, armed]) {
      const outputs = template.toJSON().Outputs as Record<string, { Value: unknown }>;
      expect(Object.keys(outputs).sort()).toEqual(
        ['AlertTopicArn', 'KillSwitchArmed', 'KillSwitchFunctionName', 'TripTopicArn'].sort(),
      );
      expect(outputs.TripTopicArn?.Value).toEqual({
        Ref: topicId(template, tripTopicName(GUARDRAILS_STACK_NAME)),
      });
    }
  });
});
