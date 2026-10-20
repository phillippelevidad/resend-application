# The CDK app

How `infra/` is laid out and how each function is bundled and configured. What crosses into a
Lambda's environment, deploy inputs and naming: [env-and-inputs.md](env-and-inputs.md). The stack split is [ADR-010](../../../../.ai/architecture.md#adr-010--serverless-on-aws-cdk-an-app-stack-and-a-guardrails-stack);
the guardrails design is [aws.md → Budget alarms](../../../../.ai/aws.md#budget-alarms). Read the
installed `aws-cdk-lib` docs before coding against a construct
([version rule](../../pp-general/SKILL.md#check-the-installed-version-not-memory)): props move
(`logRetention` is deprecated, AWS-40).

## Layout

```text
infra/
  package.json                  @ledger/infra, private
  cdk.json                      "app": "node src/main.ts" (a tool file, exempt from suffixes)
  src/
    main.ts                     composition root: parses deploy inputs, builds both stacks, tags the app
    infra.config.ts             Zod schema for the deploy inputs
    app.stack.ts                AppStack, stack id LedgerApp
    guardrails.stack.ts         GuardrailsStack, stack id LedgerGuardrails
    ledger-function.construct.ts  the shared function shape
    function-env.ts             internal variable values, keyed by the names from `@ledger/shared`
    *.stack.test.ts             Template assertions, beside the stack they test
    esbuild-installation.test.ts  the local esbuild CDK bundles with (AWS-55)
    bundle-smoke.test.ts        every synthesized bundle loads in Node and exports `handler`
  scripts/
    <name>.ts                   AWS-facing commands (scripts.md)
```

- **Two stacks, no more** (ADR-010). No nested stack; a third stack is an ADR.
- **`.stack.ts` and `.construct.ts`** are role suffixes in
  [pp-general's table](../../pp-general/references/coding-standards.md#role-suffixes), valid under
  `infra/` only.
- **One shared function construct, from the second function**, never a construct class per
  function. Every cost-brake property MUST be identical on every function, and a copy that misses
  one is a cost or teardown defect, not a style issue; that is why this path does not wait for the
  third duplicate (owner, O-15; [adding-things.md](../../pp-general/references/adding-things.md#extract-an-abstraction)).
- **Stacks import only `aws-cdk-lib`, `constructs` and the internal-variable names from
  `@ledger/shared`** ([env-and-inputs.md](env-and-inputs.md#internal-environment-variables)). A
  handler is referenced by its entry path, never imported. Scripts import workspace packages
  ([scripts.md](scripts.md)).
- **The CDK app runs under Node 24 type stripping**, no build step
  ([imports-and-tsconfig.md](../../pp-general/references/imports-and-tsconfig.md#node-24-runs-ts-directly)).
- **`cdk.json`** carries the feature flags `cdk init` wrote for `aws-cdk` 2.1145.0, plus
  `cli-telemetry: false`, `versionReporting: false` and `notices: false`. Among them,
  `@aws-cdk/aws-lambda:useCdkManagedLogGroup: true` stays (slice 2, D32): it only makes CDK create a
  group for a function given none, and every function passes its own `logGroup`. The `Template`
  assertion on explicit log groups (each function's `LoggingConfig.LogGroup` is a `Ref` to one of
  the stack's groups, as many groups as functions) is the check.
- **An empty stack fails synth.** `@aws-cdk/core:validateAgainstDefaultRules` rejects a stack with
  no resources (`CloudFormation-Validate::F0001`). Slice 2 gave both stacks resources and removed
  their F0001 acknowledgements; a new stack would need one until its first resource.

## Bundling

```ts
// infra/src/ledger-function.construct.ts: the shape, not an API; check the installed aws-cdk-lib
new NodejsFunction(this, 'Function', {
  entry: join(repoRoot, 'apps', name, 'src', `${name}.handler.ts`),
  handler: 'handler',
  runtime: Runtime.NODEJS_24_X, // AWS-54
  architecture: Architecture.ARM_64, // AWS-20
  logGroup, // AWS-40: explicit, AWS-29 retention, DESTROY (AWS-38)
  loggingFormat: LoggingFormat.TEXT, // D31: no level filter applies
  depsLockFilePath: join(repoRoot, 'pnpm-lock.yaml'),
  projectRoot: repoRoot,
  bundling: { format: OutputFormat.ESM, target: 'node24', bundleAwsSDK: true, banner }, // banner: below
});
```

From the [NodejsFunction docs](https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_lambda_nodejs-readme.html)
and [BundlingOptions](https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_lambda_nodejs.BundlingOptions.html)
(read 2026-10-16):

- **Local esbuild, never Docker.** "If `esbuild` is available it will be used to bundle your code
  in your environment. Otherwise, bundling will happen in a Lambda compatible Docker container."
  In a monorepo "the `esbuild` dependency needs to be installed in the 'root' `package.json`
  file". So `esbuild` is a root devDependency (Ask-first, slice 2), and a missing one falls back to
  Docker **silently**. Evidence: [esbuild-installation.test.ts](../../../../infra/src/esbuild-installation.test.ts)
  resolves the pinned `esbuild` from the repo root, and from aws-cdk-lib's own lookup, so the
  fallback fails `pnpm verify` instead of silently bundling in Docker (AWS-55). aws-cdk-lib 2.273.0
  detects esbuild with `require('esbuild/package.json')` from its own module, which under pnpm finds
  whichever 0.x copy is hoisted, then runs the workspace binary (`pnpm exec esbuild`) from
  `projectRoot`, which is the root's pinned one.
  `forceDockerBundling` stays `false`; `nodeModules` is never set: those modules "are installed …
  only when bundling runs in Docker".
- **Runtime and architecture are explicit.** The runtime default is `NODEJS_LATEST` behind a
  feature flag, else `NODEJS_16_X`; the architecture default is `X86_64`
  ([NodejsFunctionProps](https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_lambda_nodejs.NodejsFunctionProps.html)).
  Neither default is Ledger's (AWS-54, AWS-20).
- **ES modules.** `format` defaults to `OutputFormat.CJS`; Ledger is `"type": "module"`
  end to end. `target` defaults to "the node version of the runtime"; it is written out, so a
  runtime move is one reviewed line beside `runtime`.
- **The AWS SDK is bundled.** For a runtime that ships the SDK, "all `@aws-sdk/*` packages are
  excluded" by default; `bundleAwsSDK: true` "will exclude SDK from the external module and would
  not be resolved to Lambda provided sdk". The lockfile, not the runtime image, fixes the SDK
  version, so a deploy is reproducible. Its init cost is read from the `REPORT` line's
  `Init Duration` ([CBL-21](../../../../.ai/check-before-launch.md#behaviour-only-production-reveals)).
  `externalModules` never lists `@aws-sdk/*`.
- **`minify` and `sourceMap` stay at their default, off.** Logs carry error names, never stacks
  ([logging-and-pii.md](../../pp-general/references/logging-and-pii.md#logger)), so a source map
  buys nothing. Either changes only with a measured `Init Duration`.
- **Workspace packages ship TypeScript source** ([imports-and-tsconfig.md](../../pp-general/references/imports-and-tsconfig.md#packages-ship-typescript-source));
  esbuild bundles them through the workspace links, and nothing builds first.
- **The entry path is absolute,** built from `import.meta.dirname`. It is a string, not an import.

**The bundle smoke check** ([bundle-smoke.test.ts](../../../../infra/src/bundle-smoke.test.ts),
unit tier) synthesizes both stacks and imports each built `index.mjs` in its own Node 24 process,
its internal variables set to dummy values and no AWS credentials or config reachable, asserting
`handler` is a function. Each composition root therefore builds its clients at module scope and
makes no AWS call before the first invocation (D32). Settled by it on 2026-10-17:

- A CommonJS dependency calling `require()` inside an ES-module bundle fails at load. It did, in
  all four functions (`Dynamic require of "util" is not supported`, from Winston's
  `@colors/colors`), so `LedgerFunction` sets esbuild's `banner` to
  `import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);`
  ([esbuild #1921](https://github.com/evanw/esbuild/issues/1921)). Removing it fails all four.
- `pg`'s optional `pg-native` require did not fail the build or the load, so nothing is marked
  external. Mark only `pg-native`, and only if a build fails on it.

## Function configuration

- **Timeout and memory** are the slice's, from a measured duration. Ingest's timeout sits under
  the HTTP API limit (AWS-02) and Resend's delivery timeout ([RS-U08](../../../../.ai/resend.md#unverified));
  the worker's timeout feeds the visibility timeout (AWS-08).
- **No reserved concurrency** (AWS-16, ADR-008) and **no provisioned concurrency** (an always-on
  charge, [cost brake](../../../../AGENTS.md#decision-lens--evidence-over-claims-right-sized)).
- **Log format and level.** `loggingFormat` defaults to `TEXT` and the application level to
  `INFO` ([FunctionProps](https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_lambda.FunctionProps.html)).
  Every function sets `LoggingFormat.TEXT` explicitly and no application or system level (D31): the
  logger's one JSON object per line and EMF on stdout are both parsed under TEXT, and no level
  filter applies, so pp-general's level-filter row is moot (C15). The app stack test asserts both.
- **IAM by grant methods**, per function and only what it uses: `secret.grantRead(fn)` for the
  secrets the [Secrets layout](../../../../.ai/integrations.md#secrets-layout) gives it, the queue
  grant its role needs. The kill switch's function permissions are scoped to stack-prefixed
  function ARNs built from pseudo-parameters. An event source mapping's ARN ends in a generated
  UUID, so `lambda:UpdateEventSourceMapping` takes `event-source-mapping:*` narrowed by the
  `lambda:FunctionArn` condition to the worker's ARN
  ([Lambda → Resources and conditions](https://docs.aws.amazon.com/lambda/latest/dg/lambda-api-permissions-ref.html)).
  An HTTP API's ARN carries its generated id, so the throttle update takes `/apis/*/stages/*` in
  the stack's region: a wider grant the stack comments. Per the Service Authorization Reference
  (read 2026-10-17, [AWS-U11](../../../../.ai/aws.md#unverified)), `GetApis` is `apigateway:GET` on
  `arn:<partition>:apigateway:<region>::/apis`, `GetStage` is `GET` and `UpdateStage` (route
  throttles included) is `PATCH` on `…::/apis/<id>/stages/<name>`; API Gateway ARNs carry no
  account (`formatArn` with `account: ''`). The kill switch updates no route, so it has no
  `/routes/*` grant. AWS-U11 stays `[Unverified]` until the trip drill's update succeeds under it.
- **Physical names** (D27): `<stack>-<fn>` for functions (`LedgerApp-ingest`, `LedgerApp-worker`,
  `LedgerApp-api`, `LedgerApp-reconciler`, `LedgerGuardrails-kill-switch`), `LedgerApp-http` for the
  HTTP API, `LedgerApp-hourly` and `LedgerApp-reconcile-hourly` for the schedules,
  `LedgerApp-usage-trip`, `LedgerApp-queue-age`, `LedgerApp-dlq-depth`, `LedgerApp-api-5xx`,
  `LedgerApp-reconcile-gap` and `LedgerGuardrails-kill-switch-errors` for the alarms (the names from `@ledger/aws`'s `ledger-stacks.ts`, so the scripts and `sim` read the same
  ones), `LedgerGuardrails-trip` and
  `LedgerGuardrails-alert` for the topics, `LedgerGuardrails-monthly` (and `-drill`) for the budgets,
  `/ledger/<function name>` for log groups. Queues and secrets take none.
- **The worker's event source mapping** carries ADR-008's settings; `maxReceiveCount` is AWS-09's.
- **The reconciler's async invoke config sets `retryAttempts: 0`** (`MaximumRetryAttempts: 0`,
  slice 4). Async invoke is at-least-once ([AWS-53](../../../../.ai/aws.md#lambda)), so a run's
  claim on its [`reconcile_runs`](../../../../.ai/data-modeling.md#reconcile_runs--one-row-per-recovery-run)
  row stops a duplicate ([ADR-007](../../../../.ai/architecture.md#adr-007--recovery-by-id-diff-and-replay-through-ingest));
  no retry means a lost invoke reads abandoned and the next hourly run covers it. It sets
  `maxEventAge` to its 60 s minimum too (`MaximumEventAgeInSeconds: 60`, [AWS-63](../../../../.ai/aws.md#lambda)),
  so hourly invokes queued while the kill switch holds the function at `0` expire rather than run
  back to back on re-arm; `reconciler.fn.configureAsyncInvoke(…)` emits the one
  `AWS::Lambda::EventInvokeConfig`.
- **`LedgerApp-reconcile-gap` sets its evaluation window on the `CfnAlarm`:**
  `(alarm.node.defaultChild as CfnAlarm).evaluationWindow = { wallClockWindow: {} }`, because the L2
  `Alarm` has no prop for it in aws-cdk-lib 2.273.0 ([AWS-64](../../../../.ai/aws.md#cloudwatch-and-sns)).
  With `TreatMissingData.BREACHING`, an hour with no clean run then reads breaching; a sliding
  window would keep evaluating the last clean `0`.

## The guardrails stack

The budget (`CfnBudget`), its topics, the kill-switch function and its `Errors` alarm, as
[Budget alarms](../../../../.ai/aws.md#budget-alarms) designs them; thresholds are aws.md's and
slice 2's. It deploys first and imports nothing from the app stack (item 1).

- **The kill switch's home** is `apps/kill-switch` ([Projects](../../../../AGENTS.md#projects)):
  `create-kill-switch-handler.ts` turns any SNS event into one `tripKillSwitch` call from
  `packages/aws` and refuses a non-SNS payload with a constant (the drill's forced failure);
  `kill-switch.handler.ts` binds it to what `main.ts` built. It is bundled through `LedgerFunction`
  like every other function, always deployed; the trip topic's Lambda subscription exists only with
  `ledger:killSwitch=on`, which the `KillSwitchArmed` output reports (CBL-16).
- **The usage-trip alarm lives in the app stack** (item 7, C3), beside the default-route throttle,
  because it needs the HTTP API's id. Its action is the trip topic's ARN built with `formatArn` from
  the topic's fixed name, never a cross-stack reference; the guardrails topics' policies let
  `cloudwatch.amazonaws.com` publish.
- **The operating alarms** (slice 3, D17) also live in the app stack: queue age, DLQ depth and the
  HTTP API's `5xx`, each on a free vended metric (AWS-22, AWS-30), one evaluation period,
  `TreatMissingData: notBreaching`, and one action on `ALARM` only, the alert topic's ARN built the
  same way from `alertTopicName`. No OK action: one email per incident.
- **Every alarm's `AlarmDescription`** (both stacks) is one line of what fired, then
  `Runbook: ${RUNBOOK_BASE_URL}#<alarm name in lowercase>`, built by `alarmDescription` in
  `guardrails.stack.ts`; no ARN, account id or address (CBL-01). A new alarm adds its `###` entry
  under `## Alarms` in [`docs/runbook.md`](../../../../docs/runbook.md) in the same change, or
  `infra/src/runbook-links.test.ts` fails naming it.
