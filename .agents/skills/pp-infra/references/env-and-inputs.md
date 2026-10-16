# Environment, deploy inputs and names

What crosses into a Lambda's environment, what the deploy command hands the CDK app, and how
resources are named so the kill switch can find them and no account id is published.

## Internal environment variables

Set by CDK on a Lambda, owned by `infra`, not a public contract (S-02,
[api-contract.md → Conventions](../../../../.ai/api-contract.md#conventions)).

- **Names live in `infra/src/function-env.ts`**, one `as const` object. Each variable is set only
  on the function that reads it. That function's `.config.ts` schema parses the same key at boot
  and fails naming it ([config-and-env.md](../../pp-general/references/config-and-env.md#parse-once-at-the-composition-root)),
  which is what catches a drift between the two spellings on the first invocation.
- **Values are ARNs, URLs, names and ids.** Never a secret value
  ([CBL-01](../../../../.ai/check-before-launch.md#deploy-configuration)); the value is read at
  runtime through `packages/aws` ([config-and-env.md → Secrets](../../pp-general/references/config-and-env.md#secrets)).
- **Never a reserved key.** "The keys for these environment variables are *reserved* and cannot be
  set in your function configuration": `AWS_REGION`, `AWS_DEFAULT_REGION`,
  `AWS_LAMBDA_FUNCTION_NAME`, `AWS_LAMBDA_LOG_GROUP_NAME`, `AWS_ACCESS_KEY_ID`, `_HANDLER`, and
  the rest of the list; all variables together stay within 4 KB
  ([Lambda env vars](https://docs.aws.amazon.com/lambda/latest/dg/configuration-envvars.html), read 2026-10-16).
- **Not in `.env.example`**, which lists public variables only.

Each name is fixed by the slice that introduces it and written into this table in the same change.

| Function | Carries | Slice |
| --- | --- | --- |
| ingest | ARN of `ledger/webhook-signing-secrets`; the queue URL | 2 |
| ingest | ARN of `ledger/simulator-signing-secret`, only with the simulator flag ([ADR-016](../../../../.ai/architecture.md#adr-016--the-simulator-reaches-aws-only-through-an-opt-in-simulator-secret)) | 3 |
| worker | ARN of `ledger/database`; what it needs to find its own event source mapping (ADR-015; the slice that builds the pause settles whether that is a variable) | 2 |
| worker | the dispatcher's function name ([ADR-017](../../../../.ai/architecture.md#adr-017--the-dispatcher-is-triggered-after-commit-plus-an-hourly-sweep)) | 6 |
| read API | ARN of `ledger/database`; queue and DLQ URLs (`health.get`, `dlq.*`); what `worker.resumeEventSource` needs to invoke the worker | 2, 3 |
| read API | what `reconcile.start` needs to start the reconciler (slice 4 settles how) | 4 |
| reconciler | ARNs of `ledger/resend-api-key` and `ledger/database`; the Resend webhook id (a deploy input, not a secret) | 4 |
| dispatcher | ARNs of `ledger/database` and `ledger/resend-sending-key` | 6 |
| kill switch | the stack prefix it resolves targets from; the topic it reports to | 2 |

The `ledger/…` names are the logical names of the
[Secrets layout](../../../../.ai/integrations.md#secrets-layout); the physical ones are
stack-prefixed.

## Deploy inputs

- **The set:** the budget cap and the alert address ([Budget alarms](../../../../.ai/aws.md#budget-alarms)
  items 2 and 3), the kill-switch flag (item 5), the simulator flag (ADR-016), the Resend webhook id
  ([Secrets layout](../../../../.ai/integrations.md#secrets-layout)). Their names are each slice's.
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

- **Physical names are stack-prefixed**, because the kill switch finds its targets by name
  (item 1). The scheme is slice 2's. A named resource cannot take a replacing update, so a change
  that replaces one renames it ([CFN `QueueName`](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-sqs-queue.html)).
- **No account id anywhere.** Stacks declare no account; ARNs use `Aws.ACCOUNT_ID` and
  `Aws.REGION`, resolved at deploy time, so neither code nor template holds the id
  ([CBL-10](../../../../.ai/check-before-launch.md#public-repo-hygiene)).
- **No `fromLookup`.** A lookup caches account-scoped values in `cdk.context.json` (CBL-10).
- **Region** comes from the deploying credentials; aws.md is researched for us-east-2. AWS-U01's
  fallback would pin the guardrails stack's region; slice 2 decides.
- **[Unverified]:** every construct slice 2 uses synthesizes without a concrete account; the first
  `cdk synth` settles it (slice 2).
- **One project tag**, applied once in `main.ts` (`Tags.of(app).add(…)`), is what the post-destroy
  listing filters on ([aws.md → Teardown](../../../../.ai/aws.md#teardown)). Its key is slice 2's.
