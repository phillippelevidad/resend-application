# Proposal — slice 2: Durable ingest on AWS

## Why

Slice 2 is the next spine card ([build-checklist → 2](../../../.ai/build-checklist.md#2--durable-ingest-on-aws))
and the first that deploys. Every later M1 slice runs on what it lands: slice 3's burst, chaos and
DLQ runs need the deployed queue, worker and guardrails; slice 4's reconciler is a Lambda on the
hourly schedule this slice creates, reading the `ledger/database` secret and the token scopes this
slice adds. The budget alarm and kill switch MUST exist from the first deploy
([lens clause 7](../../../AGENTS.md#decision-lens--evidence-over-claims-right-sized),
[aws.md → Budget alarms](../../../.ai/aws.md#budget-alarms)), and bearer tokens land here because the
read API becomes reachable from the internet ([api-contract.md → Conventions](../../../.ai/api-contract.md#conventions):
"From slice 2, every mode enforces"). Slice 1's ports make this cheap: SQS replaces the in-process
queue behind the same `QueuePort`, and the same `createApi` app goes behind `@hono/aws-lambda`. Six
`[Unverified]` rows MUST settle here, and only a real deploy can settle them (AWS-U01, AWS-U02,
AWS-U11, PG-U01, PG-U02, PG-U06;
[Open questions owed by slice](../../../.ai/architecture.md#open-questions-owed-by-slice)).

The decision-complete brief is the checked pre-proposal
[2026-10-17-slice-2-durable-ingest-on-aws.md](../../../.ai/pre-proposals/2026-10-17-slice-2-durable-ingest-on-aws.md)
(cited below as *PP*; checked 2026-10-17: 15 repaired, 0 for the owner). Every decision it settles
(D1–D44, C1–C19, R1–R20) is carried forward unchanged.

## What Changes

The card's `Ships` list, verbatim. Each bullet's state on `HEAD` is PP §5's (re-checked: only the PP
and its repair have landed since `e62bf50`; no code changed).

1. App stack with HTTP API, ingest, SQS (13 days) and DLQ (14 days), worker ESM with `MaximumConcurrency`, batch size 10 and `ReportBatchItemFailures`, no VPC; evidence: CDK assertion tests on the synthesized template, including that each function's environment carries exactly its names-object keys (`packages/shared/src/function-env.ts`).
2. Ingest decodes both body encodings and answers `200` after enqueue, `401` on a bad signature and `503` when the enqueue fails; evidence: unit tests for both encodings and the three responses.
3. Worker builds its failure list from per-message results; evidence: batch-failure unit test.
4. On a database outage the worker retries once on a fresh connection, then fails the batch and disables its own ESM; the hourly cron and `ledger worker resume` re-enable it after a successful probe (ADR-015); evidence: error-classification unit test and a Testcontainers test where no message reaches the DLQ.
5. Hashed `api_tokens` with `read` and `operate` scopes, `ledger token create|list|revoke|current`, the first `operate` token issued by the deploy command; evidence: API and CLI tests for `401`, `403 forbidden` and `last_operate_token`, and a deploy-command test where a re-run inserts no second first-token.
6. `ledger health` reports queue depth and age, DLQ depth, event-source state, database reachability and storage used, and answers during a database outage; evidence: integration test through the real auth middleware with Postgres stopped: `GET /health` with a tagged token → `200` reporting the database unreachable, a bad-tag token → `401`, `GET /emails/{email_id}` → `503`.
7. Guardrails stack with the USD 50 budget, SNS, the kill switch (on in the owner's deployment), the usage trip sized to admit one burst, the steady default-route throttle with its computed worst-case overshoot stated in aws.md → Budget alarms item 7, and a scripted re-arm; AWS-U01 and AWS-U02 settled by the recorded trip drill; evidence: CDK assertion test that the budget, its notifications and the kill-switch wiring exist (aws.md → Budget alarms, item 8).
8. `pnpm verify` lints migrations for contract-breaking DDL (`DROP`, `RENAME`, `ALTER … TYPE`, `SET NOT NULL`) unless marked as a contract step; evidence: the lint fails on a fixture migration with `DROP COLUMN`.
9. One deploy command (migrate with the direct URL, then deploy both stacks) and one teardown command; the deploy command refuses an address-hash key whose `key_id` differs from stored hashes, and a pending contract step whose `contract-step` SHA is not an ancestor of the deployed `DeployedCommit` (ADR-018); the teardown command refuses a non-empty queue or DLQ without `--discard-queued`; evidence: a deploy-command test for each refusal, a teardown test for its refusal, and a post-destroy listing of stack-tagged resources finds nothing billable.
10. The deploy command creates a DML-only runtime role that cannot delete from `webhook_events`, with role-level `idle_in_transaction_session_timeout` and `lock_timeout` below the worker timeout ([integrations.md → How it is used](../../../.ai/integrations.md#decision--neon)); evidence: integration test for `permission denied` on `DELETE FROM webhook_events` and on `CREATE TABLE`, and one where an idle lock holder does not stop the worker committing.
11. PG-U01 settled from Neon's docs or support; PG-U02 settled by a deployed test where two transactions on one `email_id` serialize through the pooled URL; PG-U06 settled by `SHOW idle_in_transaction_session_timeout` through the pooled URL.
12. Verify stage walked with one Ask-first send to `delivered@resend.dev`, `ledger email` showing `delivered` and `ledger health` showing queue and DLQ at 0; it settles RS-U14 and AWS-U04.
13. RS-U21 settled by the Ask-first two-recipient send from the project's verified sending domain to `delivered@resend.dev` and `bounced@resend.dev`, observing each event's own `data.to` (through `resend webhooks listen` or the deployed ledger's stored payload and `ledger email`), with the result in resend.md. Settled early, 2026-10-17: [RS-43](../../../.ai/resend.md#facts), observed through `resend webhooks listen` and the dashboard's webhook event log.
14. RS-U07 closed by the Ask-first test webhook pointed at an endpoint that returns `401`, or proved safe by the exact-`200` contract, its row citing the result.
15. AWS-U03, AWS-U05, AWS-U06, AWS-U07, AWS-U09, AWS-U10 and PG-U04 closed or proved safe either way, each [Unverified] row citing its test, measurement or teardown drill.

How each bullet lands, in one line (detail in [design.md](design.md)):

- **1:** `LedgerApp` through one `LedgerFunction` construct (ESM, `node24`, arm64, TEXT logs, own log
  group), queues, mapping, HTTP API, two secrets, the hourly schedule and the usage-trip alarm;
  `function-env.ts` names each function's variables; `Template` assertions per cost-brake property
  plus a bundle smoke check (PP D2, D27, D31, D32).
- **2:** `apps/ingest` decodes `isBase64Encoded` bodies; `createIngest` reads the secret set through
  `SecretReaderPort` with a 5-minute cache and answers `503` on an unreadable or empty set (PP D13,
  D14, C12).
- **3:** `apps/worker` maps SQS records to messages and returns `batchItemFailures` exactly as built;
  a thrown error fails the whole batch (PP D17).
- **4:** the ADR-015 branch in `processBatch`, `worker.resume()` with a storage probe,
  `EventSourceControlPort`, the hourly resume event, `worker.resumeEventSource` and
  `ledger worker resume`; two classifier additions (PP D9, D11, D15, D16, D20).
- **5:** `api_tokens` (two migrations), `ldg_<random>_<tag>` mint and tag check in
  `packages/shared`, the auth middleware with per-route scope, four token routes, SDK methods and CLI
  commands, bootstrap issuance on `api_tokens_bootstrap_key` (PP D3, D7, D8, D18, D21, D24, D25).
- **6:** `health.get` over `QueueAttributesPort`, `EventSourceControlPort` and one storage read, at
  most one database attempt per request, `200` during an outage on the tag alone (PP D18, D19, C4).
- **7:** `LedgerGuardrails` (budget, four notifications, two topics, the kill switch and its
  `Errors` alarm, an optional drill budget), `apps/kill-switch` over the shared trip and restore
  steps, the 100 / 200 throttle and the 15,000-per-15-minutes usage trip, `pnpm aws:rearm`,
  `pnpm aws:trip-drill` (PP D28–D30, D35, D36, C14, C17, C18).
- **8:** `scripts/migration-lint.mjs` as the `migrations` stage after `lint`, canary first (PP D38).
- **9:** `pnpm aws:deploy` (twelve fail-closed steps) and `pnpm aws:teardown`, each sequenced by a
  `run-*` module unit-tested with fakes; the post-destroy listing (PP D12, D33, D34).
- **10:** `prepareDatabase` sets the role's timeouts (5 s idle, 10 s lock) on every run and can reset
  the runtime password; three integration tests (PP D10).
- **11:** Neon's docs read at apply for PG-U01; `pnpm aws:db-check` settles PG-U02 and PG-U06 on the
  deploy (PP D37, D42).
- **12:** the walk's verify path; the delivery's `body_base64_count` settles AWS-U04; RS-U14 is
  already settled as [RS-42](../../../.ai/resend.md#facts), so the bullet ticks when the walk passes
  (PP D44, C2).
- **13:** already ticked; nothing to build.
- **14:** proved safe by the exact-`200` contract: every infrastructure fault answers `503`, so a
  `401` means only a wrong secret (PP D43). No experiment, no live write.
- **15:** per PP D42's table (AWS-U12 also closes safe either way there, C1).

**BREAKING** (internal only, nothing is deployed yet): local mode now enforces bearer tokens, so slice
1's placeholder `LEDGER_TOKEN` stops working. `pnpm db:setup` repairs it by minting a real token, and
the local process now requires `LEDGER_TOKEN_TAG_KEY`, which setup writes once (PP C9, C10, D40, D41).

**Out of scope** (PP §3): the card's Deferred tail ("Alarms, runbook, DLQ inspect and redrive,
simulator secret, burst and chaos runs (slice 3). Reconciler and its Resend key (slice 4). Scripted
webhook creation (tripwire in architecture.md → Deferred).") plus, each with its carrier in PP §3:
the queue-age, DLQ-depth and Lambda-error alarms (slice 3); PG-U07 (slice 3; the classifier gains
`53100` now, safe either way); RS-U08 and CBL-21 (slice 3); `ledger reconcile` after a re-arm (slice
4, printed as `→ slice 4`); `ledger/resend-api-key` (slice 4); `health.get`'s reconcile and outbox
fields (slices 4 and 6, additive); `ingest.rejected{reason}` (slice 4); a durable local queue (slice
2B); SDK read retries (slice 5); and these tripwires: a disarm flag, the guardrails stack in
us-east-1, `SET LOCAL lock_timeout`, key rotation, partial `health.get` answers, `minify` or source
maps.

## Capabilities

### New Capabilities

Mapped in PP §23.

- `api-tokens`: bearer-token format, the tag check before any database read, hashed storage, the
  single bootstrap token, and who mints tokens.
- `aws-stacks`: what the synthesized app and guardrails stacks hold: cost-brake properties, each
  function's environment, the budget and its notifications, the kill switch and its steps, the
  usage trip, the throttle and its stated overshoot.
- `deploy-and-teardown`: the owner's AWS commands: deploy order and every refusal, teardown and its
  listing, re-arm, the trip drill and the database check.

### Modified Capabilities

- `webhook-ingest`: ADDED both body encodings, the `503` on an unreadable secret set, the 5-minute
  refresh; MODIFIED "Acknowledge only after a successful enqueue" (SQS acceptance).
- `event-ledger`: ADDED the outage pause, resume after a probe, the runtime role's refusals and
  timeouts; MODIFIED "Batch failures list exactly the failed messages" (the Lambda response and a
  thrown error).
- `read-api`: REMOVED "Auth skipped only on loopback" (C10); ADDED bearer auth on every route,
  `health.get`, `worker.resumeEventSource` and the four token operations; MODIFIED the OpenAPI
  document and both read operations' error lists (`unauthorized`).
- `sdk`: ADDED the health, worker and token methods.
- `cli`: ADDED `ledger health`, `ledger worker resume` and `ledger token create|list|revoke|current`.
- `local-stack`: MODIFIED setup (the tag key; `LEDGER_TOKEN` repaired, C9), the boot assertion and the
  one-process routing; ADDED local token enforcement and the loopback-only bind (moved from
  `read-api`).
- `verify-gate`: MODIFIED the stage list (`migrations`) and the secret-scan canary (the `ldg_` rule);
  ADDED the migration lint with its canary.

## Impact

- **Code:** `packages/core` (`tokenScopes`, `eventSourceStates`), `packages/shared` (four ports,
  their local implementations, fakes and contract suites, `function-env.ts`, `api-token.ts`, the EMF
  adapter, logger `context`), `packages/db` (`api_tokens`, repository, `prepareDatabase`, classifier,
  storage and deploy-check reads), `packages/ingest`, `packages/worker`, `packages/api`,
  `packages/sdk`, `packages/aws` (first real code), `apps/ingest`, `apps/worker`, `apps/api`,
  `apps/kill-switch` (new project), `apps/local`, `apps/cli`, `infra` (both stacks, five scripts),
  `scripts/verify.mjs`, `scripts/migration-lint.mjs` (new), `scripts/secret-scan.mjs`,
  `.gitleaks.toml`, root `package.json`, `.env.example`.
- **Public contract:** six operations already named in
  [api-contract.md](../../../.ai/api-contract.md#healthget) under slice 2, with PP §12's wire details;
  `bearerAuth` and a `401` on every route; seven public environment variables; six CLI commands; five
  `pnpm aws:*` scripts. No new error code.
- **Schema:** one table, two migrations, pure expand. `0000` and `0001` are frozen and untouched.
- **AWS:** two stacks in the owner's account (us-east-2), idle ≈ USD 0.80/month (two secrets). No NAT,
  VPC, KMS key, provisioned concurrency or container (PP §16).
- **Resend:** no API call from Ledger code. The owner creates the production webhook and makes one
  verify send, each Ask-first.
- **Docs** (PP §22): build-checklist card, data-modeling.md, api-contract.md, architecture.md,
  aws.md, integrations.md, resend.md, about.md, features.md, check-before-launch.md, root AGENTS.md
  (Projects, Commands), `.env.example`, rsa-manual-test `environment.md`, and fact corrections in
  pp-infra, pp-backend, pp-database, pp-testing, pp-general and pp-cli, plus `WALKTHROUGH.md` in this
  folder. No edit loosens a rule; C9 and C10 change spec requirements and each tightens or keeps its
  safety rule, which the commit body states.

**Ask-first items** ([root AGENTS.md → Permissions](../../../AGENTS.md#permissions)). Every row was
approved by the owner on 2026-10-17 in one itemized round (PP §7, approvals table); the last two are
held and approved one at a time, when each runs:

| Item | Exact scope approved | PP §7 row |
| --- | --- | --- |
| AWS SDK runtime clients | `@aws-sdk/client-sqs`, `client-secrets-manager`, `client-lambda`, `client-cloudwatch`, each `3.1152.0` exact, `dependencies` of `packages/aws` only | AWS SDK runtime clients |
| AWS SDK script clients | `@aws-sdk/client-apigatewayv2`, `client-cloudformation`, `client-resource-groups-tagging-api`, `client-cloudwatch-logs`, `client-budgets`, `client-sns`, each `3.1152.0` exact, `dependencies` of `packages/aws` only | AWS SDK script clients |
| `esbuild` | `0.28.2` exact, root `devDependencies` only | `esbuild` |
| Six operations | `health.get`, `worker.resumeEventSource`, `token.create`, `token.list`, `token.revoke`, `token.getCurrent` as api-contract.md names them, with PP §12's wire details: `token.create` answers `201`; `bearerAuth` and a `401` on every route; PP §12's response objects and `validation_failed` messages | Six operations |
| Seven public env vars | `LEDGER_TOKEN_TAG_KEY`, `LEDGER_DEPLOY_DATABASE_URL`, `LEDGER_DEPLOY_DATABASE_POOLED_URL`, `LEDGER_DEPLOY_WEBHOOK_SECRETS`, `LEDGER_ALERT_EMAIL`, `LEDGER_KILL_SWITCH`, `LEDGER_BUDGET_USD` | Seven public env vars |
| Script names and flags | `pnpm aws:deploy [--issue-operate-token <name>] [--budget-drill]`, `pnpm aws:teardown [--discard-queued]`, `pnpm aws:rearm`, `pnpm aws:trip-drill`, `pnpm aws:db-check --email-id <id> [--idle-minutes <n>]` | Script names and flags |
| CI change | One new stage, `migrations`, in `scripts/verify.mjs` after `lint`, with its canary. No `.github/workflows/ci.yml` edit | CI change |
| `.gitleaks.toml` rule | `ledger-api-token` (`ldg_` bearer token) plus its canary in `scripts/secret-scan.mjs` | `.gitleaks.toml` rule |
| Schema | `api_tokens` and migrations `0002_create-api-tokens` (generated) and `0003_grant-api-tokens` (custom); pure expand; unfrozen until merged to `main` | Schema |
| AWS runs | `aws lambda get-account-settings`, every `pnpm aws:deploy`, `pnpm aws:trip-drill`, `pnpm aws:rearm`, `pnpm aws:db-check`, `pnpm aws:teardown` — **held: approved one at a time, when each runs** | AWS runs |
| Live Resend writes | Creating the production webhook for the deployed ingest URL; the verify send to `delivered@resend.dev` — **held: approved one at a time, when each runs** ([integrations.md → Locked rules](../../../.ai/integrations.md#locked-rules-must), rule 8) | Live Resend writes |

`"@ledger/<pkg>": "workspace:*"` entries are boundary declarations, not Ask-first. Anything outside
these rows (another package or version, a `ci.yml` edit, another variable, flag, route, error code or
stage, a frozen migration changed) stops for the owner at apply.
