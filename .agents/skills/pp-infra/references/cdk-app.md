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
    *.test.ts                   Template assertions, beside the stack they test
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
  `@aws-cdk/aws-lambda:useCdkManagedLogGroup: true` MUST be reconciled with the explicit
  `logs.LogGroup` rule ([SKILL.md](../SKILL.md#cost-brake-in-code)) when slice 2 adds the first
  function: the `Template` assertion on explicit log groups is the check.
- **An empty stack fails synth.** `@aws-cdk/core:validateAgainstDefaultRules` rejects a stack with
  no resources (`CloudFormation-Validate::F0001`), so both stacks acknowledge F0001 through
  `Validations.of(this).acknowledge(...)` until slice 2 adds their first resource, which removes
  it. Their tests assert zero resources, and no `Fn::ImportValue` in the guardrails stack.

## Bundling

```ts
// infra/src/ledger-function.construct.ts: the shape, not an API; check the installed aws-cdk-lib
new NodejsFunction(this, 'Function', {
  entry: join(repoRoot, 'apps', name, 'src', `${name}.handler.ts`),
  handler: 'handler',
  runtime: Runtime.NODEJS_24_X, // AWS-54
  architecture: Architecture.ARM_64, // AWS-20
  logGroup, // AWS-40: explicit, AWS-29 retention, DESTROY (AWS-38)
  depsLockFilePath: join(repoRoot, 'pnpm-lock.yaml'),
  projectRoot: repoRoot,
  bundling: { format: OutputFormat.ESM, target: 'node24', bundleAwsSDK: true },
});
```

From the [NodejsFunction docs](https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_lambda_nodejs-readme.html)
and [BundlingOptions](https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_lambda_nodejs.BundlingOptions.html)
(read 2026-10-16):

- **Local esbuild, never Docker.** "If `esbuild` is available it will be used to bundle your code
  in your environment. Otherwise, bundling will happen in a Lambda compatible Docker container."
  In a monorepo "the `esbuild` dependency needs to be installed in the 'root' `package.json`
  file". So `esbuild` is a root devDependency (Ask-first, slice 2), and a missing one falls back to
  Docker **silently**. Evidence: an infra test that resolves `esbuild` from the repo root, so the
  fallback fails `pnpm verify` instead of silently bundling in Docker (AWS-55).
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

**[Unverified], slice 2 settles both** with a bundle smoke check (import each built `index.mjs`
under Node 24 and assert `handler` is a function):

- A CommonJS dependency calling `require()` inside an ES-module bundle fails at load with
  `Dynamic require of "os" is not supported`. The documented workaround is a `banner` defining
  `require` through `createRequire(import.meta.url)` ([esbuild #1921](https://github.com/evanw/esbuild/issues/1921)).
  Add it only if the smoke check fails.
- `pg`'s optional `pg-native` require may fail to resolve at bundle time. Mark only `pg-native`
  external, and only if the build fails on it.

## Function configuration

- **Timeout and memory** are the slice's, from a measured duration. Ingest's timeout sits under
  the HTTP API limit (AWS-02) and Resend's delivery timeout ([RS-U08](../../../../.ai/resend.md#unverified));
  the worker's timeout feeds the visibility timeout (AWS-08).
- **No reserved concurrency** (AWS-16, ADR-008) and **no provisioned concurrency** (an always-on
  charge, [cost brake](../../../../AGENTS.md#decision-lens--evidence-over-claims-right-sized)).
- **Log format and level.** `loggingFormat` defaults to `TEXT` and the application level to
  `INFO` ([FunctionProps](https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_lambda.FunctionProps.html)).
  Slice 2 sets them together with pp-general's level-filter `[Unverified]` row
  ([logger](../../pp-general/references/logging-and-pii.md#logger)).
- **IAM by grant methods**, per function and only what it uses: `secret.grantRead(fn)` for the
  secrets the [Secrets layout](../../../../.ai/integrations.md#secrets-layout) gives it, the queue
  grant its role needs. The kill switch's function permissions are scoped to stack-prefixed
  function ARNs built from pseudo-parameters. An event source mapping's ARN ends in a generated
  UUID, so `lambda:UpdateEventSourceMapping` takes `event-source-mapping:*` narrowed by the
  `lambda:FunctionArn` condition to the worker's ARN
  ([Lambda → Resources and conditions](https://docs.aws.amazon.com/lambda/latest/dg/lambda-api-permissions-ref.html)).
  An HTTP API's ARN carries its generated id, so the throttle update takes `/apis/*/stages/*` (and
  `/routes/*` if the kill switch updates routes) in the stack's region: a wider grant the stack
  comments. That ARN shape is `[Unverified]` ([AWS-U11](../../../../.ai/aws.md#unverified)).
- **The worker's event source mapping** carries ADR-008's settings; `maxReceiveCount` is AWS-09's.
- **The reconciler's async invoke config sets `retryAttempts: 0`** (`MaximumRetryAttempts: 0`,
  slice 4). Async invoke is at-least-once ([AWS-53](../../../../.ai/aws.md#lambda)), so a run's
  claim on its [`reconcile_runs`](../../../../.ai/data-modeling.md#reconcile_runs--one-row-per-recovery-run)
  row stops a duplicate ([ADR-007](../../../../.ai/architecture.md#adr-007--recovery-by-id-diff-and-replay-through-ingest));
  no retry means a lost invoke reads abandoned and the next hourly run covers it.

## The guardrails stack

The budget (`CfnBudget`), its topics, the kill-switch function and its `Errors` alarm, as
[Budget alarms](../../../../.ai/aws.md#budget-alarms) designs them; thresholds are aws.md's and
slice 2's. It deploys first and imports nothing from the app stack (item 1). Where the kill
switch's code lives is not yet in the [Projects](../../../../AGENTS.md#projects) table: the slice 2
pre-proposal settles it. Wherever it lands, its AWS calls go through `packages/aws` and it is
bundled like every other function. Where the usage-trip alarm lives (item 7) is slice 2's too.
