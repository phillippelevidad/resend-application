# Environment, deploy inputs and names

What crosses into a Lambda's environment, what the deploy command hands the CDK app, and how
resources are named so the kill switch can find them and no account id is published.

## Internal environment variables

Set by CDK on a Lambda, owned by `infra`, not a public contract (S-02,
[api-contract.md → Conventions](../../../../.ai/api-contract.md#conventions)).

- **Names live in `packages/shared/src/function-env.ts`**, one `as const` object of names per
  function. `infra/src/function-env.ts` imports it and sets each value only on the function that
  reads it; that function's `apps/*` `.config.ts` imports the same object for its schema keys
  ([config-and-env.md](../../pp-general/references/config-and-env.md#parse-once-at-the-composition-root)).
  One spelling, so the two sides cannot drift; a drift found at init would fail on live traffic,
  and for the worker every failed receive drains toward the DLQ without an ADR-015 pause.
- **Proven on the template:** one `Template` assertion per function, its environment carrying
  exactly the keys its names object lists
  ([cost-brake-assertions.md → Wiring](cost-brake-assertions.md#wiring-the-slices-owe)).
- **Values are ARNs, URLs, names and ids.** Never a secret value
  ([CBL-01](../../../../.ai/check-before-launch.md#deploy-configuration)); the value is read at
  runtime through `packages/aws` ([config-and-env.md → Secrets](../../pp-general/references/config-and-env.md#secrets)).
- **Never a reserved key** (`AWS_REGION`, `AWS_LAMBDA_FUNCTION_NAME`, `_HANDLER`, …), and all
  variables together within 4 KB ([AWS-56](../../../../.ai/aws.md#lambda)).
- **Not in `.env.example`**, which lists public variables only.

Each name is fixed by the slice that introduces it and written into this table in the same change.

| Function | Carries | Slice |
| --- | --- | --- |
| ingest | ARN of `ledger/webhook-signing-secrets`; the queue URL (`ingestEnv`: `SIGNING_SECRETS_ARN`, `QUEUE_URL`) | 2 |
| ingest | ARN of `ledger/simulator-signing-secret`, only with the simulator flag (`ingestSimulatorEnv`: `SIMULATOR_SECRET_ARN`, a second names object merged into ingest's environment only when `ledger:simulator=true`; `ingest.config.ts` parses it as optional) ([ADR-016](../../../../.ai/architecture.md#adr-016--the-simulator-reaches-aws-only-through-an-opt-in-simulator-secret)) | 3 |
| worker | ARN of `ledger/database` (`workerEnv`: `DATABASE_SECRET_ARN`). It finds its own event source mapping by its own name from the reserved `AWS_LAMBDA_FUNCTION_NAME` (ADR-015, AWS-56), so that is no variable: its mapping's UUID would be a CloudFormation cycle (C5) | 2 |
| worker | the dispatcher's function name ([ADR-017](../../../../.ai/architecture.md#adr-017--the-dispatcher-is-triggered-after-commit-plus-an-hourly-sweep)) | 6 |
| read API | ARN of `ledger/database`; queue and DLQ URLs (`health.get`, `dlq.*`); the worker's function name, which `worker.resumeEventSource` invokes and `health.get` finds the mapping by (`apiEnv`: `DATABASE_SECRET_ARN`, `QUEUE_URL`, `DLQ_URL`, `WORKER_FUNCTION_NAME`) | 2, 3 |
| read API | what `reconcile.start` needs to start the reconciler (slice 4 settles how) | 4 |
| reconciler | ARNs of `ledger/resend-api-key` and `ledger/database`; the Resend webhook id (a deploy input, not a secret) | 4 |
| dispatcher | ARNs of `ledger/database` and `ledger/resend-sending-key` | 6 |
| kill switch | the app stack's name it resolves targets from; the alert topic it reports to (`killSwitchEnv`: `APP_STACK_NAME`, `ALERT_TOPIC_ARN`), on the guardrails template (C16) | 2 |

The `ledger/…` names are the logical names of the
[Secrets layout](../../../../.ai/integrations.md#secrets-layout). A secret takes no physical name
([names](#names-account-and-region)); the function gets its ARN.

## Deploy inputs

- **The set:** the budget cap and the alert address ([Budget alarms](../../../../.ai/aws.md#budget-alarms)
  items 2 and 3), the kill-switch flag (item 5), the simulator flag (ADR-016), the Resend webhook id
  ([Secrets layout](../../../../.ai/integrations.md#secrets-layout)), and the commit being deployed,
  which the app stack exports as the `DeployedCommit` output
  ([scripts.md → Deploy](scripts.md#deploy), ADR-018). Their names are each slice's. Slice 2's
  context keys (`infra/src/infra.config.ts`): `ledger:commit` (40-hex; absent, `DeployedCommit` is
  `unset`, which no `git merge-base --is-ancestor` accepts, so a deploy built from it refuses every
  contract step), `ledger:alertEmail` (optional), `ledger:budgetUsd` (default 50),
  `ledger:killSwitch` (`on` | `off`, default `off`), `ledger:budgetDrill` (`true` | `false`, default
  `false`). Slice 3's: `ledger:simulator` (`true` | `false`, default `false`), which the deploy
  command passes from `LEDGER_SIMULATOR`; `true` adds the simulator secret, ingest's read of it and
  the `SimulatorSecretArn` output. `pnpm synth` passes none, so each has a default or is optional.
- **They arrive as CDK context** from the deploy command, as integrations.md already fixes for the
  webhook id; never in `cdk.json` or any tracked file (CBL-10). A local file holding them is
  git-ignored ([CBL-19](../../../../.ai/check-before-launch.md#public-repo-hygiene)).
- **`main.ts` reads context once** and parses it with `infra.config.ts`, failing on the key, never
  the value ([config-and-env.md](../../pp-general/references/config-and-env.md#parse-once-at-the-composition-root)).
  Stacks take typed props and never read context or `process.env`, so a test passes literals.
- **An input the deploy command reads from the environment is a public variable**: Ask-first,
  listed in api-contract.md, and in `.env.example`.
- The synthesized template holds the alert address, so `cdk.out/` stays git-ignored (CBL-19).

## Names, account and region

- **Functions and the HTTP API take stack-prefixed physical names**, because the kill switch finds
  its targets by name (item 1). The scheme is `<stack>-<fn>` under the fixed stack names `LedgerApp`
  and `LedgerGuardrails` (the list: [cdk-app.md → Function configuration](cdk-app.md#function-configuration)). A named resource cannot take a replacing
  update, so a change that replaces one renames it ([CFN `QueueName`](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-sqs-queue.html)).
- **Secrets take no physical name** (no `secretName`): CloudFormation generates it, so a redeploy
  after teardown never collides with a secret still in its recovery window
  ([aws.md → Teardown](../../../../.ai/aws.md#teardown), AWS-U06). Functions get the ARN; a script
  reads ARNs from the app stack's outputs. Prose keeps `ledger/database` and the others as the
  logical names ([Secrets layout](../../../../.ai/integrations.md#secrets-layout)).
- **No account id anywhere.** Stacks declare no account; ARNs come from
  `Stack.of(this).formatArn({ service, resource, resourceName })`, whose partition, region and
  account are pseudo-parameters resolved at deploy time, so neither code nor template holds the id
  ([CBL-10](../../../../.ai/check-before-launch.md#public-repo-hygiene)).
- **No `fromLookup`.** A lookup caches account-scoped values in `cdk.context.json` (CBL-10).
- **Region** comes from the deploying credentials; aws.md is researched for us-east-2. Both stacks
  stay region-agnostic (slice 2, D28); AWS-U01's us-east-1 fallback for the guardrails stack stays
  behind its tripwire.
- **Synth needs no account** (settled 2026-10-17): every slice 2 construct synthesizes with no
  concrete account, `pnpm synth` exits 0 with no credentials or config reachable, and the stack tests
  synthesize with none.
- **One project tag**, applied once in `main.ts` (`Tags.of(app).add('ledger-project', 'ledger')`),
  is what the post-destroy listing filters on ([aws.md → Teardown](../../../../.ai/aws.md#teardown)).
