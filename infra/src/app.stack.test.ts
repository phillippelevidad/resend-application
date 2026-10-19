// Slice 2, Ships 1 and R20 (pp-infra → cost-brake-assertions): the app template holds every
// cost-brake property, one assertion each, each paired with a count so a template holding none of a
// type cannot pass by matching nothing; plus the wiring the slice owes (the throttle, the mapping, the
// queues, secrets least privilege, each function's environment, the schedule, the usage trip and the
// outputs). Every number comes from the stack's own named constants. Synthesis bundles every
// function for real, so a broken entry fails here too. No credentials and no AWS call.
// Slice 3 adds the three operating alarms (D17), every alarm's runbook link (D18), the read API's DLQ
// grants (D9) and the simulator secret, synthesized both ways (D12).
import { RUNBOOK_BASE_URL } from '@ledger/core';
import { apiEnv, ingestEnv, ingestSimulatorEnv, workerEnv } from '@ledger/shared';
import { App } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { describe, expect, it } from 'vitest';
import {
  API_5XX_PERIOD_SECONDS,
  API_5XX_THRESHOLD,
  API_MEMORY_MB,
  API_TIMEOUT_SECONDS,
  AppStack,
  DLQ_DEPTH_PERIOD_SECONDS,
  DLQ_DEPTH_THRESHOLD,
  DLQ_RETENTION_DAYS,
  HOURLY_CRON,
  INGEST_MEMORY_MB,
  INGEST_PATH,
  INGEST_TIMEOUT_SECONDS,
  MAPPING_BATCH_SIZE,
  MAPPING_MAX_CONCURRENCY,
  MAX_RECEIVE_COUNT,
  QUEUE_AGE_PERIOD_SECONDS,
  QUEUE_AGE_THRESHOLD_SECONDS,
  RESUME_EVENT,
  SCHEDULE_MAX_EVENT_AGE_SECONDS,
  SCHEDULE_RETRY_ATTEMPTS,
  SOURCE_RETENTION_DAYS,
  THROTTLE_BURST_LIMIT,
  THROTTLE_RATE_LIMIT,
  USAGE_TRIP_PERIOD_SECONDS,
  USAGE_TRIP_THRESHOLD,
  VISIBILITY_TIMEOUT_FACTOR,
  WORKER_MEMORY_MB,
  WORKER_TIMEOUT_SECONDS,
} from './app.stack.ts';
import {
  alertTopicName,
  FREE_STANDARD_ALARMS,
  GuardrailsStack,
  tripTopicName,
} from './guardrails.stack.ts';
import { LOG_RETENTION } from './ledger-function.construct.ts';

const APP_STACK_NAME = 'LedgerApp';
const GUARDRAILS_STACK_NAME = 'LedgerGuardrails';
const COMMIT = '0123456789abcdef0123456789abcdef01234567';
const DAY_SECONDS = 86_400;

const synthApp = (simulator: boolean): Template =>
  Template.fromStack(
    new AppStack(new App(), APP_STACK_NAME, {
      commit: COMMIT,
      guardrailsStackName: GUARDRAILS_STACK_NAME,
      simulator,
    }),
  );

// The adopter's default (no simulator secret) and the owner's deployment (D12). Synthesized here,
// once each, for the same timeout reason as the guardrails template below.
const template = synthApp(false);
const withSimulator = synthApp(true);

// The guardrails stack at its most (armed, with the drill budget and an alert address), for the
// alarm count across both stacks. Synthesized here, not inside the test: bundling the kill switch
// took 10 s on a loaded machine, past the per-test timeout.
const fullGuardrails = Template.fromStack(
  new GuardrailsStack(new App(), GUARDRAILS_STACK_NAME, {
    appStackName: APP_STACK_NAME,
    budgetUsd: 50,
    killSwitch: true,
    budgetDrill: true,
    alertEmail: 'delivered@resend.dev',
  }),
);

// Every resource these stacks declare carries `Properties`.
type Resource = { Type: string; Properties: Record<string, unknown>; DeletionPolicy?: string };
type Statement = {
  Action: string | string[];
  Resource: unknown;
  Condition?: Record<string, Record<string, unknown>>;
};

const resourcesOf = (type: string, from: Template = template): Record<string, Resource> =>
  from.findResources(type) as Record<string, Resource>;
const only = <T>(record: Record<string, T>): [string, T] => {
  const entries = Object.entries(record);
  expect(entries).toHaveLength(1);
  return entries[0] as [string, T];
};
const asArray = <T>(value: T | T[]): T[] => (Array.isArray(value) ? value : [value]);

// The three functions by their stack-prefixed physical names (D27).
const functionNamed = (name: string, from: Template = template): [string, Resource] =>
  only(
    Object.fromEntries(
      Object.entries(resourcesOf('AWS::Lambda::Function', from)).filter(
        ([, fn]) => fn.Properties.FunctionName === `${APP_STACK_NAME}-${name}`,
      ),
    ),
  );

// Every statement of the policies attached to a function's role.
const statementsOf = (name: string, from: Template = template): Statement[] => {
  const [, fn] = functionNamed(name, from);
  const roleId = (fn.Properties.Role as { 'Fn::GetAtt': [string, string] })['Fn::GetAtt'][0];
  return Object.values(resourcesOf('AWS::IAM::Policy', from))
    .filter((policy) =>
      (policy.Properties.Roles as { Ref: string }[]).some((role) => role.Ref === roleId),
    )
    .flatMap(
      (policy) => (policy.Properties.PolicyDocument as { Statement: Statement[] }).Statement,
    );
};

const logicalIdOf = (
  type: string,
  predicate: (resource: Resource) => boolean,
  from: Template = template,
): string =>
  only(
    Object.fromEntries(Object.entries(resourcesOf(type, from)).filter(([, r]) => predicate(r))),
  )[0];

// A secret by the logical name its description begins with (Secrets layout).
const secretIdOf = (logicalName: string, from: Template = template): string =>
  logicalIdOf(
    'AWS::SecretsManager::Secret',
    (secret) => String(secret.Properties.Description).startsWith(logicalName),
    from,
  );

// The secrets a function's role can read, by logical id.
const secretsReadBy = (name: string, from: Template = template): string[] =>
  statementsOf(name, from)
    .filter((statement) => asArray(statement.Action).includes('secretsmanager:GetSecretValue'))
    .flatMap((statement) => asArray(statement.Resource as { Ref: string }))
    .map((resource) => resource.Ref)
    .sort();

const environmentOf = (name: string, from: Template = template): Record<string, unknown> =>
  (functionNamed(name, from)[1].Properties.Environment as { Variables: Record<string, unknown> })
    .Variables;

// An alarm by its physical name.
const alarmNamed = (alarmName: string): Resource =>
  only(
    Object.fromEntries(
      Object.entries(resourcesOf('AWS::CloudWatch::Alarm')).filter(
        ([, alarm]) => alarm.Properties.AlarmName === alarmName,
      ),
    ),
  )[1];

// `arn:<partition>:sns:<region>:<account>:<topic>`, every variable part a pseudo-parameter (item 1).
const constructedTopicArn = (topicName: string) => ({
  'Fn::Join': [
    '',
    [
      'arn:',
      { Ref: 'AWS::Partition' },
      ':sns:',
      { Ref: 'AWS::Region' },
      ':',
      { Ref: 'AWS::AccountId' },
      `:${topicName}`,
    ],
  ],
});

const sourceQueueId = logicalIdOf('AWS::SQS::Queue', (queue) =>
  Boolean(queue.Properties.RedrivePolicy),
);
const dlqId = logicalIdOf('AWS::SQS::Queue', (queue) => !queue.Properties.RedrivePolicy);

describe('cost brake on the app template', () => {
  it('runs every function on arm64 and nodejs24.x (AWS-20, AWS-54)', () => {
    template.resourceCountIs('AWS::Lambda::Function', 3);
    template.allResourcesProperties('AWS::Lambda::Function', {
      Architectures: ['arm64'],
      Runtime: 'nodejs24.x',
    });
  });

  it('puts no function in a VPC and holds no EC2 resource, so no NAT and no public IPv4 (AWS-13, ADR-010)', () => {
    template.resourceCountIs('AWS::Lambda::Function', 3);
    template.allResourcesProperties('AWS::Lambda::Function', { VpcConfig: Match.absent() });
    const ec2 = Object.values(template.toJSON().Resources as Record<string, Resource>).filter(
      (resource) => resource.Type.startsWith('AWS::EC2::'),
    );
    expect(ec2).toEqual([]);
  });

  it('gives every function its own explicit log group, 30-day retention, destroyed (AWS-29, AWS-38, AWS-40)', () => {
    const functions = Object.values(resourcesOf('AWS::Lambda::Function'));
    const logGroups = resourcesOf('AWS::Logs::LogGroup');
    expect(functions).toHaveLength(3);
    expect(Object.keys(logGroups)).toHaveLength(functions.length);
    const used = functions.map(
      (fn) => (fn.Properties.LoggingConfig as { LogGroup: { Ref: string } }).LogGroup.Ref,
    );
    expect(new Set(used)).toEqual(new Set(Object.keys(logGroups)));
    template.allResources('AWS::Logs::LogGroup', {
      DeletionPolicy: 'Delete',
      Properties: Match.objectLike({ RetentionInDays: LOG_RETENTION }),
    });
  });

  it('logs in the TEXT format with no level filter (D31, C15)', () => {
    template.resourceCountIs('AWS::Lambda::Function', 3);
    template.allResourcesProperties('AWS::Lambda::Function', {
      LoggingConfig: {
        LogFormat: 'Text',
        LogGroup: Match.anyValue(),
        ApplicationLogLevel: Match.absent(),
        SystemLogLevel: Match.absent(),
      },
    });
  });

  it('holds no custom resource of any kind (AWS-40, ADR-018)', () => {
    const types = Object.values(template.toJSON().Resources as Record<string, Resource>).map(
      (resource) => resource.Type,
    );
    expect(types.length).toBeGreaterThan(0);
    expect(types.filter((type) => type.startsWith('Custom::'))).toEqual([]);
    // Built at run time, so pp-infra's review grep 4 stays a check on the stacks' code.
    template.resourceCountIs(['AWS::CloudFormation::', 'Custom', 'Resource'].join(''), 0);
  });

  it('holds the two Secrets layout secrets, three with the simulator, destroyed, unnamed and empty in the template (AWS-11, AWS-38, CBL-01, D12)', () => {
    for (const [from, count] of [
      [template, 2],
      [withSimulator, 3],
    ] as const) {
      from.resourceCountIs('AWS::SecretsManager::Secret', count);
      from.allResources('AWS::SecretsManager::Secret', { DeletionPolicy: 'Delete' });
      from.allResourcesProperties('AWS::SecretsManager::Secret', {
        SecretString: Match.absent(),
        GenerateSecretString: Match.anyValue(),
        Name: Match.absent(),
      });
    }
    secretIdOf('ledger/simulator-signing-secret', withSimulator);
  });

  it('encrypts every queue with SSE-SQS and holds no KMS key (AWS-25, AWS-31)', () => {
    template.resourceCountIs('AWS::SQS::Queue', 2);
    template.allResourcesProperties('AWS::SQS::Queue', { KmsMasterKeyId: Match.absent() });
    template.resourcePropertiesCountIs('AWS::SQS::Queue', { SqsManagedSseEnabled: false }, 0);
    template.resourceCountIs('AWS::KMS::Key', 0);
  });

  it('derives the source queue visibility timeout from the worker timeout and batching window (AWS-08, ADR-008)', () => {
    const [, worker] = functionNamed('worker');
    const [, mapping] = only(resourcesOf('AWS::Lambda::EventSourceMapping'));
    const timeout = worker.Properties.Timeout as number;
    const window = (mapping.Properties.MaximumBatchingWindowInSeconds as number | undefined) ?? 0;
    const queue = resourcesOf('AWS::SQS::Queue')[sourceQueueId];
    expect(queue?.Properties.VisibilityTimeout).toBe(VISIBILITY_TIMEOUT_FACTOR * timeout + window);
  });

  it('sets no reserved and no provisioned concurrency (AWS-16, ADR-008)', () => {
    template.resourceCountIs('AWS::Lambda::Function', 3);
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

  it('puts the hourly resume on the one hourly cron, window off, with an explicit no-retry policy (AWS-10, ADR-015)', () => {
    const [, schedule] = only(resourcesOf('AWS::Scheduler::Schedule'));
    const [workerId] = functionNamed('worker');
    expect(schedule.Properties).toMatchObject({
      Name: `${APP_STACK_NAME}-hourly`,
      ScheduleExpression: HOURLY_CRON,
      FlexibleTimeWindow: { Mode: 'OFF' },
      Target: {
        Arn: { 'Fn::GetAtt': [workerId, 'Arn'] },
        Input: JSON.stringify(RESUME_EVENT),
        RetryPolicy: {
          MaximumRetryAttempts: SCHEDULE_RETRY_ATTEMPTS,
          MaximumEventAgeInSeconds: SCHEDULE_MAX_EVENT_AGE_SECONDS,
        },
      },
    });
  });

  it('keeps the standard alarms of both stacks within the free count, with no composite alarm (AWS-28, D17)', () => {
    const guardrails = fullGuardrails;
    // Both stacks at their most: the kill switch armed and the simulator on.
    const alarms = [withSimulator, guardrails].map(
      (t) => Object.keys(t.findResources('AWS::CloudWatch::Alarm')).length,
    );
    expect(alarms).toEqual([4, 1]);
    const total = alarms.reduce((sum, count) => sum + count, 0);
    expect(total).toBe(5);
    expect(total).toBeLessThanOrEqual(FREE_STANDARD_ALARMS);
    for (const t of [template, withSimulator, guardrails]) {
      t.resourceCountIs('AWS::CloudWatch::CompositeAlarm', 0);
    }
  });

  it('lets no secret value reach a function or the template, with or without the simulator (CBL-01)', () => {
    for (const from of [template, withSimulator]) {
      // Built at run time, so pp-infra's review grep 5 stays a check on the stacks' code.
      expect(JSON.stringify(from.toJSON())).not.toContain(['resolve', 'secretsmanager'].join(':'));
      const functions = Object.values(resourcesOf('AWS::Lambda::Function', from));
      expect(functions).toHaveLength(3);
      for (const fn of functions) {
        const variables = (fn.Properties.Environment as { Variables: Record<string, unknown> })
          .Variables;
        for (const value of Object.values(variables))
          expect(isReferenceOrPlainName(value)).toBe(true);
      }
    }
  });
});

// The assertions below read every number from the stack's own constants, so a changed constant
// moves template and test together. These are the values the aws-stacks spec and aws.md pin, as
// literals: a `MAX_RECEIVE_COUNT` of 1 would drain an outage to the DLQ in one receive (ADR-015).
describe('the constants hold the values the spec pins', () => {
  it('queues, mapping, throttle, usage trip and schedule (aws-stacks spec, aws.md → Budget alarms item 7)', () => {
    expect({
      SOURCE_RETENTION_DAYS,
      DLQ_RETENTION_DAYS,
      MAX_RECEIVE_COUNT,
      MAPPING_BATCH_SIZE,
      MAPPING_MAX_CONCURRENCY,
      THROTTLE_RATE_LIMIT,
      THROTTLE_BURST_LIMIT,
      USAGE_TRIP_PERIOD_SECONDS,
      USAGE_TRIP_THRESHOLD,
      HOURLY_CRON,
      SCHEDULE_RETRY_ATTEMPTS,
      SCHEDULE_MAX_EVENT_AGE_SECONDS,
      QUEUE_AGE_PERIOD_SECONDS,
      QUEUE_AGE_THRESHOLD_SECONDS,
      DLQ_DEPTH_PERIOD_SECONDS,
      DLQ_DEPTH_THRESHOLD,
      API_5XX_PERIOD_SECONDS,
      API_5XX_THRESHOLD,
    }).toEqual({
      SOURCE_RETENTION_DAYS: 13,
      DLQ_RETENTION_DAYS: 14,
      MAX_RECEIVE_COUNT: 5,
      MAPPING_BATCH_SIZE: 10,
      MAPPING_MAX_CONCURRENCY: 5,
      THROTTLE_RATE_LIMIT: 100,
      THROTTLE_BURST_LIMIT: 200,
      USAGE_TRIP_PERIOD_SECONDS: 900,
      USAGE_TRIP_THRESHOLD: 15_000,
      HOURLY_CRON: 'cron(0 * * * ? *)',
      SCHEDULE_RETRY_ATTEMPTS: 0,
      SCHEDULE_MAX_EVENT_AGE_SECONDS: 60,
      // aws-stacks spec, D17: the three operating alarms.
      QUEUE_AGE_PERIOD_SECONDS: 300,
      QUEUE_AGE_THRESHOLD_SECONDS: 900,
      DLQ_DEPTH_PERIOD_SECONDS: 300,
      DLQ_DEPTH_THRESHOLD: 0,
      API_5XX_PERIOD_SECONDS: 300,
      API_5XX_THRESHOLD: 0,
    });
  });
});

describe('wiring of the app template', () => {
  it('names every function and the HTTP API with the app stack prefix the kill switch finds them by (D27, D29)', () => {
    for (const name of ['ingest', 'worker', 'api']) functionNamed(name);
    template.resourceCountIs('AWS::ApiGatewayV2::Api', 1);
    template.hasResourceProperties('AWS::ApiGatewayV2::Api', {
      Name: `${APP_STACK_NAME}-http`,
      ProtocolType: 'HTTP',
    });
  });

  it('sizes each function from its named constants (D27)', () => {
    const sizes = (name: string) => {
      const [, fn] = functionNamed(name);
      return [fn.Properties.MemorySize, fn.Properties.Timeout];
    };
    expect(sizes('ingest')).toEqual([INGEST_MEMORY_MB, INGEST_TIMEOUT_SECONDS]);
    expect(sizes('worker')).toEqual([WORKER_MEMORY_MB, WORKER_TIMEOUT_SECONDS]);
    expect(sizes('api')).toEqual([API_MEMORY_MB, API_TIMEOUT_SECONDS]);
  });

  it('throttles the $default stage at rate 100 and burst 200 (aws.md → Budget alarms item 7, C3)', () => {
    template.resourceCountIs('AWS::ApiGatewayV2::Stage', 1);
    template.hasResourceProperties('AWS::ApiGatewayV2::Stage', {
      StageName: '$default',
      AutoDeploy: true,
      DefaultRouteSettings: {
        ThrottlingRateLimit: THROTTLE_RATE_LIMIT,
        ThrottlingBurstLimit: THROTTLE_BURST_LIMIT,
      },
      RouteSettings: Match.absent(),
    });
  });

  it('routes the ingest endpoint to ingest and every other request to the read API', () => {
    const integrationTarget = (routeKey: string): string => {
      const [, route] = only(
        Object.fromEntries(
          Object.entries(resourcesOf('AWS::ApiGatewayV2::Route')).filter(
            ([, r]) => r.Properties.RouteKey === routeKey,
          ),
        ),
      );
      const join = (route.Properties.Target as { 'Fn::Join': [string, [string, { Ref: string }]] })[
        'Fn::Join'
      ];
      const integration = resourcesOf('AWS::ApiGatewayV2::Integration')[join[1][1].Ref];
      const properties = integration?.Properties ?? {};
      expect(properties).toMatchObject({
        IntegrationType: 'AWS_PROXY',
        PayloadFormatVersion: '2.0',
      });
      return (properties.IntegrationUri as { 'Fn::GetAtt': [string, string] })['Fn::GetAtt'][0];
    };
    template.resourceCountIs('AWS::ApiGatewayV2::Route', 2);
    expect(integrationTarget(`POST ${INGEST_PATH}`)).toBe(functionNamed('ingest')[0]);
    expect(integrationTarget('$default')).toBe(functionNamed('api')[0]);
  });

  it('maps the source queue to the worker: batch 10, no window, partial batch failure, concurrency 5 (ADR-008, AWS-04)', () => {
    template.resourceCountIs('AWS::Lambda::EventSourceMapping', 1);
    template.hasResourceProperties('AWS::Lambda::EventSourceMapping', {
      EventSourceArn: { 'Fn::GetAtt': [sourceQueueId, 'Arn'] },
      FunctionName: { Ref: functionNamed('worker')[0] },
      BatchSize: MAPPING_BATCH_SIZE,
      MaximumBatchingWindowInSeconds: Match.absent(),
      FunctionResponseTypes: ['ReportBatchItemFailures'],
      ScalingConfig: { MaximumConcurrency: MAPPING_MAX_CONCURRENCY },
    });
  });

  it('retains the source queue 13 days and the DLQ 14, moving a message after its fifth receive (AWS-07, AWS-09)', () => {
    const queues = resourcesOf('AWS::SQS::Queue');
    expect(queues[sourceQueueId]?.Properties).toMatchObject({
      MessageRetentionPeriod: SOURCE_RETENTION_DAYS * DAY_SECONDS,
      RedrivePolicy: {
        deadLetterTargetArn: { 'Fn::GetAtt': [dlqId, 'Arn'] },
        maxReceiveCount: MAX_RECEIVE_COUNT,
      },
    });
    expect(queues[dlqId]?.Properties.MessageRetentionPeriod).toBe(DLQ_RETENTION_DAYS * DAY_SECONDS);
    expect(DLQ_RETENTION_DAYS).toBeGreaterThan(SOURCE_RETENTION_DAYS);
  });

  it('grants each function read on exactly the secrets the Secrets layout gives it', () => {
    const signingId = secretIdOf('ledger/webhook-signing-secrets');
    const databaseId = secretIdOf('ledger/database');
    expect(secretsReadBy('ingest')).toEqual([signingId]);
    expect(secretsReadBy('worker')).toEqual([databaseId]);
    expect(secretsReadBy('api')).toEqual([databaseId]);
  });

  it('with the simulator, lets only ingest read the simulator secret (ADR-016, D12)', () => {
    const signingId = secretIdOf('ledger/webhook-signing-secrets', withSimulator);
    const databaseId = secretIdOf('ledger/database', withSimulator);
    const simulatorId = secretIdOf('ledger/simulator-signing-secret', withSimulator);
    expect(secretsReadBy('ingest', withSimulator)).toEqual([signingId, simulatorId].sort());
    expect(secretsReadBy('worker', withSimulator)).toEqual([databaseId]);
    expect(secretsReadBy('api', withSimulator)).toEqual([databaseId]);
    // No other policy in the template names it either.
    const policiesNaming = Object.values(resourcesOf('AWS::IAM::Policy', withSimulator)).filter(
      (policy) => JSON.stringify(policy.Properties.PolicyDocument).includes(simulatorId),
    );
    expect(policiesNaming).toHaveLength(1);
    expect(environmentOf('ingest', withSimulator)[ingestSimulatorEnv.SIMULATOR_SECRET_ARN]).toEqual(
      { Ref: simulatorId },
    );
  });

  it('without the simulator, holds no simulator secret and names none in any environment or policy (ADR-016, D12)', () => {
    const json = JSON.stringify(template.toJSON());
    expect(json).not.toContain(ingestSimulatorEnv.SIMULATOR_SECRET_ARN);
    expect(json).not.toContain('ledger/simulator-signing-secret');
    expect(json).not.toContain('SimulatorSecret');
  });

  it('grants the read API the DLQ inspect and redrive minimum, and no other function a DLQ permission (D9, AWS-60)', () => {
    const sqsGrants = (name: string, from: Template = template): Record<string, string[]> => {
      const grants: Record<string, string[]> = {};
      for (const statement of statementsOf(name, from)) {
        const actions = asArray(statement.Action).filter((action) => action.startsWith('sqs:'));
        if (actions.length === 0) continue;
        for (const resource of asArray(statement.Resource as { 'Fn::GetAtt': [string, string] })) {
          const queueId = resource['Fn::GetAtt'][0];
          grants[queueId] = [...(grants[queueId] ?? []), ...actions].sort();
        }
      }
      return grants;
    };
    for (const from of [template, withSimulator]) {
      expect(sqsGrants('api', from)).toEqual({
        [dlqId]: [
          'sqs:DeleteMessage',
          'sqs:GetQueueAttributes',
          'sqs:ListMessageMoveTasks',
          'sqs:ReceiveMessage',
          'sqs:StartMessageMoveTask',
        ],
        [sourceQueueId]: ['sqs:GetQueueAttributes', 'sqs:SendMessage'],
      });
      for (const name of ['ingest', 'worker']) {
        const grants = sqsGrants(name, from);
        expect(grants[dlqId]).toBeUndefined();
        expect(Object.values(grants).flat()).not.toContain('sqs:StartMessageMoveTask');
        expect(Object.values(grants).flat()).not.toContain('sqs:ListMessageMoveTasks');
      }
    }
  });

  it("scopes the event source mapping calls to the worker's mapping by condition (D16, D27)", () => {
    for (const [name, actions] of [
      ['worker', ['lambda:GetEventSourceMapping', 'lambda:UpdateEventSourceMapping']],
      ['api', ['lambda:GetEventSourceMapping']],
    ] as const) {
      const scoped = statementsOf(name).filter((statement) =>
        asArray(statement.Action).some((action) => action.endsWith('EventSourceMapping')),
      );
      const [statement] = scoped;
      expect(scoped).toHaveLength(1);
      expect(asArray(statement?.Action ?? []).sort()).toEqual([...actions].sort());
      expect(JSON.stringify(statement?.Resource)).toContain(':event-source-mapping:*');
      expect(JSON.stringify(statement?.Condition)).toContain(`:function:${APP_STACK_NAME}-worker`);
    }
  });

  it('sets on each function exactly the internal variable names its kernel object lists (D2)', () => {
    const keysOf = (name: string) => {
      const [, fn] = functionNamed(name);
      return Object.keys(
        (fn.Properties.Environment as { Variables: Record<string, unknown> }).Variables,
      ).sort();
    };
    expect(keysOf('ingest')).toEqual(Object.values(ingestEnv).sort());
    expect(keysOf('worker')).toEqual(Object.values(workerEnv).sort());
    expect(keysOf('api')).toEqual(Object.values(apiEnv).sort());
    // D12: with the simulator, ingest's set is its names plus the simulator names, and only its.
    const keysWithSimulator = (name: string) =>
      Object.keys(environmentOf(name, withSimulator)).sort();
    expect(keysWithSimulator('ingest')).toEqual(
      [...Object.values(ingestEnv), ...Object.values(ingestSimulatorEnv)].sort(),
    );
    expect(keysWithSimulator('worker')).toEqual(Object.values(workerEnv).sort());
    expect(keysWithSimulator('api')).toEqual(Object.values(apiEnv).sort());
    const [, api] = functionNamed('api');
    expect(
      (api.Properties.Environment as { Variables: Record<string, unknown> }).Variables[
        apiEnv.WORKER_FUNCTION_NAME
      ],
    ).toBe(`${APP_STACK_NAME}-worker`);
  });

  it('trips on the HTTP API request count over 15 minutes through a constructed trip-topic ARN (D30, item 1)', () => {
    const alarm = alarmNamed(`${APP_STACK_NAME}-usage-trip`);
    const apiId = only(resourcesOf('AWS::ApiGatewayV2::Api'))[0];
    expect(alarm.Properties).toMatchObject({
      Namespace: 'AWS/ApiGateway',
      MetricName: 'Count',
      Dimensions: [{ Name: 'ApiId', Value: { Ref: apiId } }],
      Statistic: 'Sum',
      Period: USAGE_TRIP_PERIOD_SECONDS,
      Threshold: USAGE_TRIP_THRESHOLD,
      EvaluationPeriods: 1,
      ComparisonOperator: 'GreaterThanThreshold',
      TreatMissingData: 'notBreaching',
    });
    // The trip topic's constructed ARN is its one action.
    expect(alarm.Properties.AlarmActions).toEqual([
      constructedTopicArn(tripTopicName(GUARDRAILS_STACK_NAME)),
    ]);
    expect(alarm.Properties.OKActions).toBeUndefined();
    expect(alarm.Properties.InsufficientDataActions).toBeUndefined();
    expect(JSON.stringify(template.toJSON())).not.toContain('Fn::ImportValue');
  });

  // D17, D14, D15, D16: one assertion per operating alarm, each to the alert topic's constructed
  // ARN, its one action, on `ALARM` only, missing data not breaching.
  const operatingAlarm = (alarmName: string, metric: Record<string, unknown>) => {
    const alarm = alarmNamed(alarmName);
    expect(alarm.Properties).toMatchObject({
      ...metric,
      EvaluationPeriods: 1,
      ComparisonOperator: 'GreaterThanThreshold',
      TreatMissingData: 'notBreaching',
    });
    expect(alarm.Properties.AlarmActions).toEqual([
      constructedTopicArn(alertTopicName(GUARDRAILS_STACK_NAME)),
    ]);
    expect(alarm.Properties.OKActions).toBeUndefined();
    expect(alarm.Properties.InsufficientDataActions).toBeUndefined();
  };

  it('alarms when the source queue holds a message older than 15 minutes, to the alert topic (D17, ADR-015, AWS-22)', () => {
    operatingAlarm(`${APP_STACK_NAME}-queue-age`, {
      Namespace: 'AWS/SQS',
      MetricName: 'ApproximateAgeOfOldestMessage',
      Dimensions: [{ Name: 'QueueName', Value: { 'Fn::GetAtt': [sourceQueueId, 'QueueName'] } }],
      Statistic: 'Maximum',
      Period: QUEUE_AGE_PERIOD_SECONDS,
      Threshold: QUEUE_AGE_THRESHOLD_SECONDS,
    });
  });

  it('alarms when the DLQ holds any visible message, to the alert topic (D17, AWS-22)', () => {
    operatingAlarm(`${APP_STACK_NAME}-dlq-depth`, {
      Namespace: 'AWS/SQS',
      MetricName: 'ApproximateNumberOfMessagesVisible',
      Dimensions: [{ Name: 'QueueName', Value: { 'Fn::GetAtt': [dlqId, 'QueueName'] } }],
      Statistic: 'Maximum',
      Period: DLQ_DEPTH_PERIOD_SECONDS,
      Threshold: DLQ_DEPTH_THRESHOLD,
    });
  });

  it('alarms on any HTTP API 5xx in five minutes, to the alert topic (D17, RS-10, RS-11, AWS-30)', () => {
    operatingAlarm(`${APP_STACK_NAME}-api-5xx`, {
      Namespace: 'AWS/ApiGateway',
      MetricName: '5xx',
      Dimensions: [
        { Name: 'ApiId', Value: { Ref: only(resourcesOf('AWS::ApiGatewayV2::Api'))[0] } },
      ],
      Statistic: 'Sum',
      Period: API_5XX_PERIOD_SECONDS,
      Threshold: API_5XX_THRESHOLD,
    });
  });

  it("ends every alarm's description with its runbook link (D18)", () => {
    const alarms = Object.values(resourcesOf('AWS::CloudWatch::Alarm'));
    expect(alarms).toHaveLength(4);
    for (const alarm of alarms) {
      const name = String(alarm.Properties.AlarmName);
      const description = String(alarm.Properties.AlarmDescription);
      expect(description.endsWith(`. Runbook: ${RUNBOOK_BASE_URL}#${name.toLowerCase()}`)).toBe(
        true,
      );
      // One line, no ARN or account id (CBL-01).
      expect(description).not.toMatch(/\n|arn:|\d{12}/);
    }
  });

  it('admits one burst of about 12,000 requests in 15 minutes below the usage trip (item 7)', () => {
    expect(12_000).toBeLessThan(USAGE_TRIP_THRESHOLD);
    expect(USAGE_TRIP_PERIOD_SECONDS).toBe(15 * 60);
  });

  it('outputs DeployedCommit equal to the commit it was synthesized from, and what the scripts read (D33–D36)', () => {
    const outputs = template.toJSON().Outputs as Record<string, { Value: unknown }>;
    expect(Object.keys(outputs).sort()).toEqual(
      [
        'ApiUrl',
        'DatabaseSecretArn',
        'DeployedCommit',
        'DlqUrl',
        'QueueUrl',
        'SigningSecretsArn',
        'ThrottleBurstLimit',
        'ThrottleRateLimit',
        'WorkerFunctionName',
      ].sort(),
    );
    expect(outputs.DeployedCommit?.Value).toBe(COMMIT);
    expect(outputs.WorkerFunctionName?.Value).toBe(`${APP_STACK_NAME}-worker`);
    expect(outputs.ThrottleRateLimit?.Value).toBe(String(THROTTLE_RATE_LIMIT));
    expect(outputs.ThrottleBurstLimit?.Value).toBe(String(THROTTLE_BURST_LIMIT));
    expect(outputs.QueueUrl?.Value).toEqual({ Ref: sourceQueueId });
    expect(outputs.DlqUrl?.Value).toEqual({ Ref: dlqId });
  });

  it('outputs SimulatorSecretArn only with the simulator (D12, D21)', () => {
    const outputsOf = (from: Template) =>
      from.toJSON().Outputs as Record<string, { Value: unknown }>;
    expect(outputsOf(template).SimulatorSecretArn).toBeUndefined();
    expect(outputsOf(withSimulator).SimulatorSecretArn?.Value).toEqual({
      Ref: secretIdOf('ledger/simulator-signing-secret', withSimulator),
    });
    expect(Object.keys(outputsOf(withSimulator)).sort()).toEqual(
      [...Object.keys(outputsOf(template)), 'SimulatorSecretArn'].sort(),
    );
  });
});

// CBL-01: an environment value is a reference CloudFormation resolves to an ARN, URL or name (`Ref`,
// `Fn::GetAtt`, or a `Fn::Join` of those and strings), or a plain string that is no secret's shape.
const secretShapes = /whsec_|re_[A-Za-z0-9]{8}|postgres(ql)?:\/\/|ldg_/;
function isReferenceOrPlainName(value: unknown): boolean {
  if (typeof value === 'string') return !secretShapes.test(value);
  if (typeof value !== 'object' || value === null) return false;
  const keys = Object.keys(value);
  if (keys.length !== 1) return false;
  const [key] = keys;
  const body = (value as Record<string, unknown>)[key as string];
  if (key === 'Ref') return typeof body === 'string';
  if (key === 'Fn::GetAtt') return Array.isArray(body);
  if (key === 'Fn::Join') {
    const parts = (body as [string, unknown[]])[1];
    return Array.isArray(parts) && parts.every(isReferenceOrPlainName);
  }
  return false;
}
