# Cost-brake assertions

The [cost brake](../SKILL.md#cost-brake-in-code) is proven on the synthesized template: **one
assertion per property, each citing its ADR or `AWS-NN`**. The tests are `*.test.ts` beside the
stack under `infra/src/`, unit tier, no credentials and no AWS call
([pp-testing → Test files and tiers](../../pp-testing/SKILL.md#test-files-and-tiers)).

## The API

`aws-cdk-lib/assertions` `Template` ([docs](https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.assertions.Template.html),
read 2026-10-16): `fromStack`, `hasResource`, `hasResourceProperties`, `resourceCountIs`,
`resourcePropertiesCountIs`, `allResources`, `allResourcesProperties`, `findResources`, `toJSON`,
plus `Match.absent()`, `Match.anyValue()`, `Match.objectLike()`. `allResources` matches the whole
definition (`DeletionPolicy` included); `allResourcesProperties` matches `Properties` only. Check
the installed version before relying on one
([version rule](../../pp-general/SKILL.md#check-the-installed-version-not-memory)).

```ts
// infra/src/app.stack.test.ts: the shape
const app = new App();
const stack = new AppStack(app, 'Test', testProps); // literal props: stacks never read context
const template = Template.fromStack(stack);

test('every function runs arm64 on nodejs24.x (AWS-20, AWS-54)', () => {
  expect(Object.keys(template.findResources('AWS::Lambda::Function')).length).toBeGreaterThan(0);
  template.allResourcesProperties('AWS::Lambda::Function', {
    Architectures: ['arm64'],
    Runtime: 'nodejs24.x',
  });
});
```

- **Pair every "all resources" assertion with a count**, as above, so a template holding none of
  the type cannot pass by matching nothing.
- **Name the test after the property and cite its id** in the name, the way a failing run reads
  first.
- **Synthesis bundles every function for real**, so a broken entry or bundling option fails the
  same stage. One more test resolves `esbuild` from the repo root, because a missing one makes CDK
  fall back to Docker silently, and the bundle smoke check loads every bundle
  ([cdk-app.md → Bundling](cdk-app.md#bundling)).
- **A test builds a grep-listed literal at run time** (`['resolve', 'secretsmanager'].join(':')`,
  the custom-resource type name from its parts), so the [review greps](#review-greps) keep checking
  the stacks' code and never hit their own assertion.
- **`infra/src/` tests set no environment through `process.env`** (review grep 11): the bundle smoke
  check uses `vi.stubEnv` and lets the spawned Node inherit it.
- **Numbers come from the stack's own named constants**, each commented with the `AWS-NN` that
  fixes it, imported by the test. A literal in the test restates aws.md.

## One assertion per property

Run against both stacks unless the row says otherwise.

| Property | Assertion | Cites |
| --- | --- | --- |
| arm64, `nodejs24.x` | `allResourcesProperties('AWS::Lambda::Function', { Architectures: ['arm64'], Runtime: 'nodejs24.x' })` | AWS-20, AWS-54 |
| No VPC, no NAT, no public IPv4 | `allResourcesProperties('AWS::Lambda::Function', { VpcConfig: Match.absent() })`; no key of `toJSON().Resources` has a `Type` starting `AWS::EC2::` | AWS-13, ADR-010 |
| Explicit log groups | every function `Match.objectLike({ LoggingConfig: Match.objectLike({ LogGroup: Match.anyValue() }) })`; `allResources('AWS::Logs::LogGroup', { DeletionPolicy: 'Delete', Properties: Match.objectLike({ RetentionInDays: LOG_RETENTION_DAYS }) })`; log groups ≥ functions | AWS-29, AWS-38, AWS-40 |
| No custom resource | no `Type` starting `Custom::`; `resourceCountIs('AWS::CloudFormation::CustomResource', 0)` | AWS-40, ADR-018 |
| Secrets destroyed, counted, empty and unnamed in the template | `allResources('AWS::SecretsManager::Secret', { DeletionPolicy: 'Delete' })`; `allResourcesProperties(…, { SecretString: Match.absent(), Name: Match.absent() })` (no physical name, so a redeploy never meets one in its recovery window, AWS-U06, [names](env-and-inputs.md#names-account-and-region)); `resourceCountIs(…, n)`, `n` from the [Secrets layout](../../../../.ai/integrations.md#secrets-layout) for the flags under test | AWS-11, AWS-38, CBL-01 |
| SSE-SQS, no KMS key | `allResourcesProperties('AWS::SQS::Queue', { KmsMasterKeyId: Match.absent() })`; `resourcePropertiesCountIs('AWS::SQS::Queue', { SqsManagedSseEnabled: false }, 0)` (when the key is absent, CloudFormation enables SSE-SQS, [CFN](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-sqs-queue.html)); `resourceCountIs('AWS::KMS::Key', 0)` | AWS-25, AWS-31 |
| Derived visibility timeout | read the worker's `Timeout` and its mapping's `MaximumBatchingWindowInSeconds` (0 when absent) from the template; the source queue's `VisibilityTimeout` equals the AWS-08 derivation, its factor the stack's named constant | AWS-08, ADR-008 |
| No reserved or provisioned concurrency | `allResourcesProperties('AWS::Lambda::Function', { ReservedConcurrentExecutions: Match.absent() })`; `resourcePropertiesCountIs` of `AWS::Lambda::Alias` and `AWS::Lambda::Version` with `ProvisionedConcurrencyConfig: Match.anyValue()` is 0 | AWS-16, ADR-008 |
| Guardrails import nothing | guardrails only: `expect(JSON.stringify(template.toJSON())).not.toContain('Fn::ImportValue')` | [Budget alarms](../../../../.ai/aws.md#budget-alarms) item 1 |
| One hourly cron, window off, explicit retries | `allResourcesProperties('AWS::Scheduler::Schedule', { ScheduleExpression: HOURLY_CRON, FlexibleTimeWindow: { Mode: 'OFF' }, Target: Match.objectLike({ RetryPolicy: Match.anyValue() }) })` for every Postgres-touching schedule | AWS-10, [Cadence](../../../../.ai/integrations.md#cadence-and-the-database) |
| Alarms within the free count | standard alarms across both stacks ≤ the AWS-28 constant; `resourceCountIs('AWS::CloudWatch::CompositeAlarm', 0)` | AWS-28 |
| Budget and kill switch wired | guardrails: one `AWS::Budgets::Budget` with `CostTypes.IncludeCredit: false` and item 3's notifications, within AWS-33's limit; both topics without `KmsMasterKeyId`, each with a policy letting `budgets.amazonaws.com` and `cloudwatch.amazonaws.com` `SNS:Publish`; the kill switch subscribed to the trip topic when armed, none otherwise; an alarm on the kill switch's `Errors` (item 4). App (C3), because the HTTP API lives there: the `$default` stage's default-route throttle at the stack's constants (item 7), and the usage-trip alarm whose action is the trip topic's constructed ARN | [Budget alarms](../../../../.ai/aws.md#budget-alarms) items 2–4, 7, 8, AWS-52, AWS-33, AWS-35, AWS-53 |
| No secret value reaches a function | `JSON.stringify(template.toJSON())` contains no `resolve:secretsmanager`; every `Environment.Variables` value is a `Ref`, `Fn::GetAtt`, `Fn::Join` of those, or a plain non-secret string | CBL-01 |

## Wiring the slices owe

Not cost-brake properties, but the same mechanics. Each lands with the `Ships` bullet that names it.

- **Worker mapping** (slice 2, ADR-008): `AWS::Lambda::EventSourceMapping` with ADR-008's batch
  size, `ScalingConfig.MaximumConcurrency`, `FunctionResponseTypes: ['ReportBatchItemFailures']`,
  and no batching window.
- **Queues** (slice 2): source and DLQ retention from the AWS-07 and AWS-09 constants, the DLQ's
  above the source's; `RedrivePolicy.maxReceiveCount` from the AWS-09 constant.
- **Secrets least privilege** (slice 2): for each function, the secrets named in its role's
  `secretsmanager:GetSecretValue` statements equal its "Read by" rows in the
  [Secrets layout](../../../../.ai/integrations.md#secrets-layout), no more.
- **Function environments** (from slice 2, one test per function): the keys of its
  `Environment.Variables` equal, as a set, the keys of its names object imported from
  `@ledger/shared` ([internal variables](env-and-inputs.md#internal-environment-variables)), so a
  variable set on the wrong function, or a name read but never set, fails here instead of at init.
- **Stack outputs the scripts read** (slice 2): the app template's `Outputs` carry
  `DeployedCommit`, equal to the commit passed in the test's props, and the secret ARNs and queue
  URLs the deploy and teardown commands read ([scripts.md](scripts.md#deploy)).
- **Reconciler invoke config** (slice 4): one `AWS::Lambda::EventInvokeConfig` for the reconciler
  with `MaximumRetryAttempts: 0` ([cdk-app.md](cdk-app.md#function-configuration)).
- **Flags, synthesized both ways**: the kill-switch flag (item 5; what "armed" looks like in the
  template is slice 2's, [CBL-16](../../../../.ai/check-before-launch.md#deploy-configuration)), and
  the simulator flag (slice 3, [ADR-016](../../../../.ai/architecture.md#adr-016--the-simulator-reaches-aws-only-through-an-opt-in-simulator-secret):
  without it, no simulator secret and no ingest reference to one).

## What a template test cannot prove

These are deploy-time evidence, owed by slice 2 and re-checked by
[check-before-launch.md](../../../../.ai/check-before-launch.md): the trip drill (AWS-U01, AWS-U02),
the post-destroy listing ([aws.md → Teardown](../../../../.ai/aws.md#teardown)), the secret grep over
`cdk.out/` and the deployed environment (CBL-01), and the idle bill (CBL-18).

## Review greps

Run from the repo root. Expected: no output.

1. Docker bundling or `nodeModules` (AWS-55):
   `git grep -nE "DockerImage|forceDockerBundling: *true|nodeModules:" -- infra`
2. `logRetention` (AWS-40): `git grep -n "logRetention" -- infra`
3. A runtime other than Node 24 (AWS-54):
   `git grep -nE "NODEJS_(LATEST|[0-9]+_X)" -- infra | grep -v NODEJS_24_X`
4. A lookup or custom resource (CBL-10, AWS-40):
   `git grep -nE "fromLookup|AwsCustomResource|custom_resources|CustomResource" -- infra`
5. A secret value in the template (CBL-01):
   `git grep -nE "unsafePlainText|secretValue|resolve:secretsmanager" -- infra`
6. Reserved or provisioned concurrency (AWS-16):
   `git grep -nE "reservedConcurrentExecutions|provisionedConcurrentExecutions" -- infra`
7. A VPC or KMS key (AWS-13, AWS-25): `git grep -nE "\bvpc\b|ec2\.|kms\.|encryptionKey" -- infra`
8. The AWS SDK under `infra/`: `git grep -n "@aws-sdk/" -- infra`
9. An account id or ARN literal (CBL-10): `git grep -nE "\b[0-9]{12}\b|arn:aws:" -- infra`
10. A shell-string command: `git grep -nE "exec(Sync)?\(|shell: *true" -- infra/scripts`
11. `process.env` outside a composition root:
    `git grep -n "process\.env" -- infra ':!infra/src/main.ts' ':!infra/scripts'`
12. A physical secret name (AWS-U06): `git grep -n "secretName" -- infra`
