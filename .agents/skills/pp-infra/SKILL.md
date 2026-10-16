---
name: pp-infra
description: Ledger's infrastructure conventions — the CDK app layout (app and guardrails stacks), NodejsFunction bundling with local esbuild into ES modules on arm64 `nodejs24.x` with the AWS SDK bundled, Lambda configuration, the internal environment variables CDK sets, deploy inputs and physical names, the cost brake written as one CDK `Template` assertion per property, teardown, and the AWS-facing scripts under `infra/scripts/`. Load it before writing or reviewing anything under `infra/`, a root `package.json` script that calls it, or a change that adds a Lambda, queue, secret, schedule, alarm or log group — "add a function", "add an env var to a Lambda", "why is CDK using Docker", "write the deploy command", "teardown", "re-arm", "trip drill", "budget alarm", "kill switch", "CDK assertion test". Load it alongside pp-workflow and pp-general, not instead of them. When it and a linked doc disagree, the doc wins and this file is fixed.
---

# pp-infra — patterns and practices, `infra/` and the AWS-facing scripts

The cost brake, the teardown and the secrets layout, written so they hold by construction and a
test checks them. Every AWS limit is an `AWS-NN` fact in [aws.md](../../../.ai/aws.md), linked by
id; no number it owns is restated here.

**Owns:** `infra/` layout · bundling · Lambda configuration · internal environment variables
(S-02), deploy inputs, physical names · the cost brake in code and its CDK assertion tests ·
teardown mechanics · the AWS-facing scripts and their root `package.json` entries.

**Does not own:** the budget-alarm design, cost shape, teardown leftovers, every AWS fact →
[aws.md](../../../.ai/aws.md) · the stack split → [ADR-010](../../../.ai/architecture.md#adr-010--serverless-on-aws-cdk-an-app-stack-and-a-guardrails-stack)
· which secret exists and who reads it → [Secrets layout](../../../.ai/integrations.md#secrets-layout)
· handlers, ports, `packages/aws` adapters → [pp-backend](../pp-backend/SKILL.md) · migrations and
grants → [pp-database](../pp-database/SKILL.md) · test-runner mechanics →
[pp-testing](../pp-testing/SKILL.md#test-files-and-tiers) · naming, imports, config loading →
[pp-general](../pp-general/SKILL.md).

## Precedence

[pp-general → Precedence](../pp-general/SKILL.md#precedence): on `infra/**` this skill beats
pp-general; where it is silent, pp-general applies.

| Reference | Open when |
| --- | --- |
| [cdk-app.md](references/cdk-app.md) | Creating or changing a stack, a function, its bundling or its configuration |
| [env-and-inputs.md](references/env-and-inputs.md) | Adding an environment variable, a deploy input or a physical name; touching account or region |
| [cost-brake-assertions.md](references/cost-brake-assertions.md) | Writing or reviewing a CDK `Template` test; adding a resource a cost-brake property covers |
| [scripts.md](references/scripts.md) | Writing the deploy, teardown, re-arm or trip-drill command, or any script that calls AWS |

## Always

- Every function is a `NodejsFunction` bundled by **local esbuild** (never Docker, AWS-39) into ES
  modules, target `node24`, `Runtime.NODEJS_24_X` on `Architecture.ARM_64` (AWS-54, AWS-20), the
  AWS SDK bundled from the lockfile (`bundleAwsSDK: true`); entry `apps/<fn>/src/<fn>.handler.ts`
  exporting `handler` ([bundling](references/cdk-app.md#bundling)).
- Every function logs to an explicit `logs.LogGroup` with the AWS-29 retention and
  `RemovalPolicy.DESTROY`; every secret sets `DESTROY` (AWS-38, AWS-40, ADR-010).
- A Lambda receives secret **ARNs**, never values, with IAM read on its own secrets alone
  ([Secrets layout](../../../.ai/integrations.md#secrets-layout), [CBL-01](../../../.ai/check-before-launch.md#deploy-configuration)).
- Internal variable names live in one module in `infra` and in
  [the table](references/env-and-inputs.md#internal-environment-variables); each is set only on the
  function that reads it ([api-contract.md → Conventions](../../../.ai/api-contract.md#conventions)).
- Deploy inputs reach the CDK app as context, parsed once with Zod in `infra/src/main.ts`; stacks
  take typed props ([deploy inputs](references/env-and-inputs.md#deploy-inputs)).
- No account id, ARN literal or context lookup; physical names are stack-prefixed
  ([names](references/env-and-inputs.md#names-account-and-region), CBL-10).
- Each [cost-brake property](#cost-brake-in-code) has one `Template` assertion citing its id.
- A script's AWS calls go through `@ledger/aws`, its database work through `@ledger/db`
  ([module boundaries](../../../AGENTS.md#module-boundaries)).
- Deploy order is S-05: ensure the runtime role, migrate, then `cdk deploy`
  ([ADR-018](../../../.ai/architecture.md#adr-018--migrations-run-from-the-deploy-command-before-the-code-that-needs-them),
  [deploy](references/scripts.md#deploy)). Teardown is one command (lens clause 7).
- Deploying, creating AWS resources and running a script against AWS are Ask-first
  ([Permissions](../../../AGENTS.md#permissions)). `cdk synth` and the `Template` tests need no
  credentials; nothing else runs unapproved.

## Cost brake in code

The [cost brake](../../../AGENTS.md#decision-lens--evidence-over-claims-right-sized) is a property
of the synthesized template, so it is proven there: **one `Template` assertion per property, each
citing its ADR or `AWS-NN`**, in a `*.test.ts` beside the stack. A property without its assertion
is unproven. Shapes, and the wiring assertions slices owe: [cost-brake-assertions.md](references/cost-brake-assertions.md).

| Property | Rests on |
| --- | --- |
| Every function on arm64, `nodejs24.x` | AWS-20, AWS-54 |
| No VPC on any function, no `AWS::EC2::*` resource (so no NAT, no public IPv4) | AWS-13, ADR-010 |
| An explicit log group per function, AWS-29 retention, `DESTROY`; no `logRetention` | AWS-29, AWS-38, AWS-40 |
| No custom resource of any kind | AWS-40, ADR-018 |
| Every secret `DESTROY`, empty in the template, counted against the Secrets layout | AWS-11, AWS-38, CBL-01 |
| Every queue SSE-SQS, no KMS key anywhere | AWS-25, AWS-31 |
| Visibility timeout derived from the worker timeout and batching window | AWS-08, ADR-008 |
| No reserved and no provisioned concurrency in either template | AWS-16, ADR-008 |
| The guardrails template holds no `Fn::ImportValue` | [Budget alarms](../../../.ai/aws.md#budget-alarms) item 1 |
| Every Postgres-touching schedule on the one hourly cron, window `OFF`, explicit retry policy | AWS-10, [Cadence](../../../.ai/integrations.md#cadence-and-the-database) |
| Standard alarms within the free count, no composite alarm | AWS-28 |

## Case-by-case

| Do this | Deciding test |
| --- | --- |
| Add a resource | Its idle cost is 0 or a row of [Cost shape](../../../.ai/aws.md#cost-shape); otherwise an ADR with a measured reason ([Cost envelope](../../../.ai/architecture.md#cost-envelope)) |
| Add a secret | A [Secrets layout](../../../.ai/integrations.md#secrets-layout) row names it (each bills, AWS-11) |
| Add an alarm | The total stays within AWS-28's free count, or Cost shape states the extra |
| Add a schedule | It touches Postgres → the shared hourly cron; otherwise any cadence ≥ 1 min (AWS-10) |
| Add an internal variable | The function reads it in this diff, the key is not Lambda-reserved, the value is not a secret |
| Add a deploy input | A doc or slice card names it; one read from the environment is a public variable, Ask-first |
| Extract the shared function construct | A second function needs the shape ([layout](references/cdk-app.md#layout)) |
| Script a step | It recurs per deploy, demo or review ([lens clause 1](../../../AGENTS.md#decision-lens--evidence-over-claims-right-sized)) |
| Turn on `minify` or source maps | A measured `Init Duration` before and after ([CBL-21](../../../.ai/check-before-launch.md#behaviour-only-production-reveals)) |

## Never

- **Docker bundling, a container image function or `nodeModules`** → `NodejsFunction` with esbuild
  in the root `package.json` (AWS-39; ADR-010 rejects containers; [bundling](references/cdk-app.md#bundling)).
- **`@aws-sdk/*` taken from the runtime** (listed in `externalModules`) → `bundleAwsSDK: true`.
- **The default or `NODEJS_LATEST` runtime, or x86** → `Runtime.NODEJS_24_X`, `Architecture.ARM_64`.
- **A VPC, NAT gateway or VPC endpoint** → no VPC (AWS-13; [decision-lens-suite case 9](../../../.ai/decision-lens-suite.md)).
- **`logRetention`, reading `fn.logGroup`, the implicit `/aws/lambda/*` group, or a log group or
  secret without `DESTROY`** → an explicit `LogGroup` passed as `logGroup`, `DESTROY` set (AWS-19,
  AWS-38, AWS-40).
- **A custom resource (`AwsCustomResource`, a `Provider`, `Custom::*`)** → a deploy-script step,
  or nothing (AWS-40; ADR-018 rejects one for migrations).
- **A customer-managed KMS key, an SSE-KMS queue or an encrypted trip topic** → SSE-SQS and
  AWS-managed keys (AWS-25, AWS-31, AWS-35).
- **Reserved or provisioned concurrency in a template** → none; the kill switch sets `0` at trip
  time only (AWS-16).
- **A visibility timeout literal** → derive it (AWS-08).
- **A cross-stack reference into the guardrails stack** → stack-prefixed names resolved at trip
  time ([Budget alarms](../../../.ai/aws.md#budget-alarms) item 1).
- **A secret value in an env var or the template** (`SecretValue.unsafePlainText`, an unwrapped
  `secretValue`, `{{resolve:secretsmanager…}}`, a deploy input passed through) → the ARN, read at
  runtime through `packages/aws` (CBL-01).
- **A Lambda-reserved key (`AWS_REGION`, …) set as a variable** → read the one the runtime sets
  ([internal variables](references/env-and-inputs.md#internal-environment-variables)).
- **An account id, ARN literal or `fromLookup`** → pseudo-parameters, no lookups (CBL-10).
- **A deploy input in `cdk.json` or any tracked file** → context from the deploy command (CBL-10, CBL-19).
- **A root script named `deploy`, or any pnpm built-in** → a name no built-in shadows
  ([scripts.md](references/scripts.md#root-packagejson-scripts)).
- **`@aws-sdk/*` imported under `infra/`** → `@ledger/aws` ([module boundaries](../../../AGENTS.md#module-boundaries)).
- **A shell-string command (`exec`, `shell: true`)** → `spawn` with an argument array
  ([scripts.md](references/scripts.md#running-the-cdk-cli)).
- **Migrations from a Lambda or a custom resource** → the deploy command (ADR-018).
- **A Budget Action as the stop, or a kill switch that tears down** → the kill switch stops compute;
  teardown is owner-triggered (AWS-36, [features.md → tear down](../../../.ai/features.md#adopter-lifecycle)).
- **`ts-node`, `tsx` or a build step for the CDK app** → `node src/main.ts`
  ([type stripping](../pp-general/references/imports-and-tsconfig.md#node-24-runs-ts-directly)).
- **A cost-brake property without its assertion** → add it ([Cost brake in code](#cost-brake-in-code)).

## Gate — then read the diff

**Gate.** Until slice 0 lands `pnpm verify`, the cheap checks for what was touched (lint and the
infra `*.test.ts`); after it, `pnpm verify` exits 0 with every stage run
([Definition of done](../pp-workflow/SKILL.md#definition-of-done)). The report names what ran.

**Then read the diff.** From the repo root, each prints nothing:
`git grep -nE "DockerImage|forceDockerBundling: *true|nodeModules:" -- infra` ·
`git grep -n "logRetention" -- infra` · `git grep -nE "NODEJS_(LATEST|[0-9]+_X)" -- infra | grep -v NODEJS_24_X` ·
`git grep -nE "fromLookup|AwsCustomResource|custom_resources|CustomResource" -- infra` ·
`git grep -nE "unsafePlainText|secretValue|resolve:secretsmanager" -- infra` ·
`git grep -nE "reservedConcurrentExecutions|provisionedConcurrentExecutions" -- infra` ·
`git grep -nE "\bvpc\b|ec2\.|kms\.|encryptionKey" -- infra` · `git grep -n "@aws-sdk/" -- infra` ·
`git grep -nE "\b[0-9]{12}\b|arn:aws:" -- infra` · `git grep -nE "exec(Sync)?\(|shell: *true" -- infra/scripts` ·
`git grep -n "process\.env" -- infra ':!infra/src/main.ts' ':!infra/scripts'`. Then: every new
function uses the shared shape · every new cost-brake property has its assertion, citing its id
and paired with a count · every new internal variable is in the names module and the
[table](references/env-and-inputs.md#internal-environment-variables), set only where it is read · no
root script shadows a pnpm built-in · `cdk.out/` is git-ignored
([CBL-19](../../../.ai/check-before-launch.md#public-repo-hygiene)) · each new dependency
(`aws-cdk-lib`, `constructs`, `aws-cdk`, `esbuild`), deploy, AWS resource and AWS-facing run was
owner-approved ([Permissions](../../../AGENTS.md#permissions)).
