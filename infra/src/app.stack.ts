import { RESUME_EVENT } from '@ledger/core';
import { ArnFormat, CfnOutput, Duration, RemovalPolicy, Stack, type StackProps } from 'aws-cdk-lib';
import { HttpApi, HttpMethod, HttpStage } from 'aws-cdk-lib/aws-apigatewayv2';
import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import { Alarm, ComparisonOperator, Stats, TreatMissingData } from 'aws-cdk-lib/aws-cloudwatch';
import { SnsAction } from 'aws-cdk-lib/aws-cloudwatch-actions';
import { PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { SqsEventSource } from 'aws-cdk-lib/aws-lambda-event-sources';
import {
  Schedule,
  ScheduleExpression,
  ScheduleTargetInput,
  TimeWindow,
} from 'aws-cdk-lib/aws-scheduler';
import { LambdaInvoke } from 'aws-cdk-lib/aws-scheduler-targets';
import { Secret } from 'aws-cdk-lib/aws-secretsmanager';
import { Topic } from 'aws-cdk-lib/aws-sns';
import { Queue, QueueEncryption } from 'aws-cdk-lib/aws-sqs';
import type { Construct } from 'constructs';
import { apiEnvironment, ingestEnvironment, workerEnvironment } from './function-env.ts';
import { tripTopicName } from './guardrails.stack.ts';
import { LedgerFunction } from './ledger-function.construct.ts';

// D27: every value a named constant citing what fixes it. Sizes are initial, revisited from the
// first measured `REPORT` lines (CBL-21, slice 3).

// Ingest answers well under Svix's 15 s delivery timeout (RS-10) and API Gateway's 30 s (AWS-02).
export const INGEST_MEMORY_MB = 256;
export const INGEST_TIMEOUT_SECONDS = 10;
// D15, D27: one query timeout (15 s), a fresh connection (≤ 5 s) and the retry's query timeout (15 s)
// is 35 s, so the ADR-015 pause always runs inside the timeout. Feeds the visibility timeout (AWS-08).
export const WORKER_MEMORY_MB = 512;
export const WORKER_TIMEOUT_SECONDS = 60;
// AWS-02: under the 30 s integration cap; one connect (5 s) plus one query (15 s) is the worst case.
export const API_MEMORY_MB = 256;
export const API_TIMEOUT_SECONDS = 25;

// AWS-07: the source queue keeps 13 days, so the DLQ can keep longer, at the 14-day maximum (AWS-09).
export const SOURCE_RETENTION_DAYS = 13;
export const DLQ_RETENTION_DAYS = 14;
// AWS-09, ADR-008: a message moves to the DLQ after its fifth failed receive.
export const MAX_RECEIVE_COUNT = 5;
// AWS-08: the source queue's visibility timeout is at least six times the worker's timeout, plus
// the batching window.
export const VISIBILITY_TIMEOUT_FACTOR = 6;

// ADR-008, AWS-17: batch size 10 needs no batching window, and none is set.
export const MAPPING_BATCH_SIZE = 10;
export const MAPPING_BATCHING_WINDOW_SECONDS = 0;
// AWS-04 (minimum 2), ADR-008: five size-1 pools against Neon's pooler, below any new-account quota
// AWS-U05 reads.
export const MAPPING_MAX_CONCURRENCY = 5;

// aws.md → Budget alarms item 7, AWS-14, D30: the steady `$default` throttle bounds the worst-case
// request rate, and so the overshoot past the budget cap.
export const THROTTLE_RATE_LIMIT = 100;
export const THROTTLE_BURST_LIMIT = 200;

// D30, item 7: the usage trip sums the HTTP API's vended `Count` (AWS-30) over 15 minutes; 15,000
// admits one burst (≈ 12k requests) with headroom.
export const USAGE_TRIP_PERIOD_SECONDS = 900;
export const USAGE_TRIP_THRESHOLD = 15_000;

// AWS-10, integrations.md → Cadence: every Postgres-touching schedule shares the one hourly cron,
// window off. No retry and a 60 s event age (AWS-10's minimum): the next tick supersedes a missed one.
export const HOURLY_CRON = 'cron(0 * * * ? *)';
export const SCHEDULE_RETRY_ATTEMPTS = 0;
export const SCHEDULE_MAX_EVENT_AGE_SECONDS = 60;
// ADR-015, D17: the event the worker answers with `resume()`, defined once in `@ledger/core`.
export { RESUME_EVENT };

// api-contract.md → Ingest boundary.
export const INGEST_PATH = '/webhooks/resend';
const STAGE_NAME = '$default';

export type AppStackProps = StackProps & {
  // The commit being deployed, exported as `DeployedCommit` (ADR-018, D33 step 4).
  readonly commit: string;
  // The guardrails stack, by name only: the usage trip publishes to its trip topic through an ARN
  // built from the topic's fixed name, never a cross-stack reference (aws.md → Budget alarms item 1).
  readonly guardrailsStackName: string;
};

// ADR-001, ADR-002, ADR-008, ADR-010, ADR-015: ingest, the queues, the worker and its mapping, the
// read API behind one HTTP API, the two secrets, the hourly resume schedule and the usage trip.
export class AppStack extends Stack {
  constructor(scope: Construct, id: string, props: AppStackProps) {
    super(scope, id, props);
    const stackName = this.stackName;
    // D27: stack-prefixed physical names, which the kill switch finds its targets by (D29).
    const names = {
      ingest: `${stackName}-ingest`,
      worker: `${stackName}-worker`,
      api: `${stackName}-api`,
      http: `${stackName}-http`,
    };
    // Every function ARN in a policy is built from its physical name, never a reference, so no
    // policy cycles back to its own function (D27).
    const functionArn = (functionName: string) =>
      this.formatArn({
        service: 'lambda',
        resource: 'function',
        resourceName: functionName,
        arnFormat: ArnFormat.COLON_RESOURCE_NAME,
      });
    const workerArn = functionArn(names.worker);

    // Secrets layout: no physical name, so a redeploy never meets one in its recovery window
    // (AWS-U06); no value in the template, CDK generates a placeholder the deploy command overwrites
    // (D33 step 9, CBL-01); destroyed with the stack (AWS-38).
    const signingSecrets = new Secret(this, 'SigningSecrets', {
      description: 'ledger/webhook-signing-secrets: a JSON array of the Resend signing secrets',
      removalPolicy: RemovalPolicy.DESTROY,
    });
    const databaseSecret = new Secret(this, 'DatabaseSecret', {
      description: 'ledger/database: the pooled URL, the address-hash key and the token tag key',
      removalPolicy: RemovalPolicy.DESTROY,
    });

    // AWS-25: SSE-SQS, at no cost and with no key to manage.
    const dlq = new Queue(this, 'Dlq', {
      retentionPeriod: Duration.days(DLQ_RETENTION_DAYS),
      encryption: QueueEncryption.SQS_MANAGED,
    });
    const queue = new Queue(this, 'Queue', {
      retentionPeriod: Duration.days(SOURCE_RETENTION_DAYS),
      encryption: QueueEncryption.SQS_MANAGED,
      // AWS-08, derived, never a literal.
      visibilityTimeout: Duration.seconds(
        VISIBILITY_TIMEOUT_FACTOR * WORKER_TIMEOUT_SECONDS + MAPPING_BATCHING_WINDOW_SECONDS,
      ),
      deadLetterQueue: { queue: dlq, maxReceiveCount: MAX_RECEIVE_COUNT },
    });

    const ingest = new LedgerFunction(this, 'Ingest', {
      app: 'ingest',
      functionName: names.ingest,
      memorySize: INGEST_MEMORY_MB,
      timeout: Duration.seconds(INGEST_TIMEOUT_SECONDS),
      environment: ingestEnvironment({
        signingSecretsArn: signingSecrets.secretArn,
        queueUrl: queue.queueUrl,
      }),
    });
    signingSecrets.grantRead(ingest.fn);
    ingest.fn.addToRolePolicy(
      new PolicyStatement({ actions: ['sqs:SendMessage'], resources: [queue.queueArn] }),
    );

    const worker = new LedgerFunction(this, 'Worker', {
      app: 'worker',
      functionName: names.worker,
      memorySize: WORKER_MEMORY_MB,
      timeout: Duration.seconds(WORKER_TIMEOUT_SECONDS),
      environment: workerEnvironment({ databaseSecretArn: databaseSecret.secretArn }),
    });
    databaseSecret.grantRead(worker.fn);
    // ADR-008, AWS-05: partial batch failure from per-message results.
    worker.fn.addEventSource(
      new SqsEventSource(queue, {
        batchSize: MAPPING_BATCH_SIZE,
        reportBatchItemFailures: true,
        maxConcurrency: MAPPING_MAX_CONCURRENCY,
      }),
    );
    // ADR-015, D16: the worker pauses and resumes its own mapping, found by its own name.
    for (const statement of mappingStatements(this, workerArn, [
      'lambda:GetEventSourceMapping',
      'lambda:UpdateEventSourceMapping',
    ])) {
      worker.fn.addToRolePolicy(statement);
    }

    const api = new LedgerFunction(this, 'Api', {
      app: 'api',
      functionName: names.api,
      memorySize: API_MEMORY_MB,
      timeout: Duration.seconds(API_TIMEOUT_SECONDS),
      environment: apiEnvironment({
        databaseSecretArn: databaseSecret.secretArn,
        queueUrl: queue.queueUrl,
        dlqUrl: dlq.queueUrl,
        workerFunctionName: names.worker,
      }),
    });
    databaseSecret.grantRead(api.fn);
    // D19, D20: `health.get` reads both queues' depth and the source queue's oldest age, and the
    // mapping's state; `worker.resumeEventSource` invokes the worker.
    api.fn.addToRolePolicy(
      new PolicyStatement({
        actions: ['sqs:GetQueueAttributes'],
        resources: [queue.queueArn, dlq.queueArn],
      }),
    );
    // `GetMetricStatistics` takes no resource-level permission.
    api.fn.addToRolePolicy(
      new PolicyStatement({ actions: ['cloudwatch:GetMetricStatistics'], resources: ['*'] }),
    );
    api.fn.addToRolePolicy(
      new PolicyStatement({ actions: ['lambda:InvokeFunction'], resources: [workerArn] }),
    );
    for (const statement of mappingStatements(this, workerArn, ['lambda:GetEventSourceMapping'])) {
      api.fn.addToRolePolicy(statement);
    }

    // api-contract.md → Ingest boundary: the webhook path to ingest, everything else to the read API.
    const httpApi = new HttpApi(this, 'HttpApi', {
      apiName: names.http,
      createDefaultStage: false,
      defaultIntegration: new HttpLambdaIntegration('ApiIntegration', api.fn),
    });
    httpApi.addRoutes({
      path: INGEST_PATH,
      methods: [HttpMethod.POST],
      integration: new HttpLambdaIntegration('IngestIntegration', ingest.fn),
    });
    // Item 7, D30: the default-route throttle on the one stage; the kill switch lowers it to its stop
    // values, the re-arm restores these from the outputs below (D35).
    const stage = new HttpStage(this, 'DefaultStage', {
      httpApi,
      stageName: STAGE_NAME,
      autoDeploy: true,
      throttle: { rateLimit: THROTTLE_RATE_LIMIT, burstLimit: THROTTLE_BURST_LIMIT },
    });

    // ADR-015, AWS-10: the hourly resume; the worker answers `already_enabled` without connecting
    // when its mapping is not paused (D16).
    new Schedule(this, 'Hourly', {
      scheduleName: `${stackName}-hourly`,
      schedule: ScheduleExpression.expression(HOURLY_CRON),
      timeWindow: TimeWindow.off(),
      target: new LambdaInvoke(worker.fn, {
        input: ScheduleTargetInput.fromObject(RESUME_EVENT),
        retryAttempts: SCHEDULE_RETRY_ATTEMPTS,
        maxEventAge: Duration.seconds(SCHEDULE_MAX_EVENT_AGE_SECONDS),
      }),
    });

    // D30, item 7: here, because it needs the API's id, which the guardrails stack cannot import.
    // Its action is the trip topic's ARN constructed from the topic's fixed name (item 1).
    const tripTopicArn = this.formatArn({
      service: 'sns',
      resource: tripTopicName(props.guardrailsStackName),
      arnFormat: ArnFormat.NO_RESOURCE_NAME,
    });
    const usageTrip = new Alarm(this, 'UsageTrip', {
      alarmName: `${stackName}-usage-trip`,
      metric: httpApi.metricCount({
        period: Duration.seconds(USAGE_TRIP_PERIOD_SECONDS),
        statistic: Stats.SUM,
      }),
      threshold: USAGE_TRIP_THRESHOLD,
      comparisonOperator: ComparisonOperator.GREATER_THAN_THRESHOLD,
      evaluationPeriods: 1,
      treatMissingData: TreatMissingData.NOT_BREACHING,
    });
    usageTrip.addAlarmAction(new SnsAction(Topic.fromTopicArn(this, 'TripTopic', tripTopicArn)));

    // What the deploy, teardown, re-arm and drill commands read (D33–D36).
    new CfnOutput(this, 'DeployedCommit', { value: props.commit });
    new CfnOutput(this, 'ApiUrl', { value: stage.url });
    new CfnOutput(this, 'SigningSecretsArn', { value: signingSecrets.secretArn });
    new CfnOutput(this, 'DatabaseSecretArn', { value: databaseSecret.secretArn });
    new CfnOutput(this, 'QueueUrl', { value: queue.queueUrl });
    new CfnOutput(this, 'DlqUrl', { value: dlq.queueUrl });
    new CfnOutput(this, 'WorkerFunctionName', { value: names.worker });
    new CfnOutput(this, 'ThrottleRateLimit', { value: String(THROTTLE_RATE_LIMIT) });
    new CfnOutput(this, 'ThrottleBurstLimit', { value: String(THROTTLE_BURST_LIMIT) });
  }
}

// D16: the worker's mapping is found by its function name, and `ListEventSourceMappings` takes no
// resource-level permission. A mapping's ARN ends in a generated UUID, so the other calls take every
// mapping narrowed by the `lambda:FunctionArn` condition to the worker's (pp-infra → cdk-app.md).
function mappingStatements(
  stack: Stack,
  workerArn: string,
  actions: readonly string[],
): PolicyStatement[] {
  return [
    new PolicyStatement({ actions: ['lambda:ListEventSourceMappings'], resources: ['*'] }),
    new PolicyStatement({
      actions: [...actions],
      resources: [
        stack.formatArn({
          service: 'lambda',
          resource: 'event-source-mapping',
          resourceName: '*',
          arnFormat: ArnFormat.COLON_RESOURCE_NAME,
        }),
      ],
      conditions: { StringEquals: { 'lambda:FunctionArn': workerArn } },
    }),
  ];
}
