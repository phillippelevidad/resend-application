# Pre-proposal — slice 2: Durable ingest on AWS

| Field | Value |
| --- | --- |
| **Slice** | 2 — [Durable ingest on AWS](../build-checklist.md#2--durable-ingest-on-aws) |
| Change name | `slice-2-durable-ingest-on-aws` → `openspec/changes/slice-2-durable-ingest-on-aws/` (`openspec/changes/` holds only `archive/`: slices 0 and 1) |
| Date | 2026-10-17 |
| Card status | `[ ]` (1 of 15 `Ships` boxes ticked: Ships 13, RS-U21, settled early as [RS-43](../resend.md#facts)) |
| Depends on | 1 — `[x]` ([card](../build-checklist.md#1--local-ledger-and-read-path)) |
| Track | Spine (0 → 1 → **2** → 3 → …) |
| Touches | `packages/core`, `packages/shared`, `packages/db`, `packages/ingest`, `packages/worker`, `packages/api`, `packages/sdk`, `packages/aws`, `apps/ingest`, `apps/worker`, `apps/api`, `apps/kill-switch` (new), `apps/local`, `apps/cli`, `infra`, `scripts/`, root `package.json`, `.gitleaks.toml`, `.env.example`, `.ai/` docs, root `AGENTS.md`, seven skills' text |
| Earlier pre-proposal | None for this slice |
| Branch | `worktree-slice-2` (at `a0039a1`: `e62bf50` plus this document) |
| Checked | 2026-10-17: 15 repaired, 0 for the owner |

## 1. Why now

Slice 2 is the next spine card, and the first that deploys. Every later M1 slice runs on what it
lands: slice 3's burst, chaos and DLQ runs need the deployed queue, worker and guardrails; slice 4's
reconciler is a Lambda on the hourly schedule this slice creates, reading the `ledger/database`
secret and the token scopes this slice adds. The budget alarm and kill switch MUST exist from the
first deploy ([lens clause 7](../../AGENTS.md#decision-lens--evidence-over-claims-right-sized),
[aws.md → Budget alarms](../aws.md#budget-alarms)), so they cannot trail the app stack. Bearer
tokens land here because the read API becomes reachable from the internet, and api-contract.md
binds every mode to enforce them from this slice ([Conventions → Auth in slice 1](../api-contract.md#conventions)).
Building on slice 1's ports is cheap: SQS replaces the in-process queue behind the same `QueuePort`,
and the same `createApi` app goes behind `@hono/aws-lambda`. Six `[Unverified]` rows MUST be settled
here (AWS-U01, AWS-U02, AWS-U11, PG-U01, PG-U02, PG-U06;
[architecture.md → owed-by-slice table](../architecture.md#open-questions-owed-by-slice)),
and they can only be settled against a real deploy.

## 2. Scope — the `Ships` list, verbatim

1. App stack with HTTP API, ingest, SQS (13 days) and DLQ (14 days), worker ESM with `MaximumConcurrency`, batch size 10 and `ReportBatchItemFailures`, no VPC; evidence: CDK assertion tests on the synthesized template, including that each function's environment carries exactly its names-object keys (`packages/shared/src/function-env.ts`).
2. Ingest decodes both body encodings and answers `200` after enqueue, `401` on a bad signature and `503` when the enqueue fails; evidence: unit tests for both encodings and the three responses.
3. Worker builds its failure list from per-message results; evidence: batch-failure unit test.
4. On a database outage the worker retries once on a fresh connection, then fails the batch and disables its own ESM; the hourly cron and `ledger worker resume` re-enable it after a successful probe (ADR-015); evidence: error-classification unit test and a Testcontainers test where no message reaches the DLQ.
5. Hashed `api_tokens` with `read` and `operate` scopes, `ledger token create|list|revoke|current`, the first `operate` token issued by the deploy command; evidence: API and CLI tests for `401`, `403 forbidden` and `last_operate_token`, and a deploy-command test where a re-run inserts no second first-token.
6. `ledger health` reports queue depth and age, DLQ depth, event-source state, database reachability and storage used, and answers during a database outage; evidence: integration test through the real auth middleware with Postgres stopped: `GET /health` with a tagged token → `200` reporting the database unreachable, a bad-tag token → `401`, `GET /emails/{email_id}` → `503`.
7. Guardrails stack with the USD 50 budget, SNS, the kill switch (on in the owner's deployment), the usage trip sized to admit one burst, the steady default-route throttle with its computed worst-case overshoot stated in aws.md → Budget alarms item 7, and a scripted re-arm; AWS-U01 and AWS-U02 settled by the recorded trip drill; evidence: CDK assertion test that the budget, its notifications and the kill-switch wiring exist (aws.md → Budget alarms, item 8).
8. `pnpm verify` lints migrations for contract-breaking DDL (`DROP`, `RENAME`, `ALTER … TYPE`, `SET NOT NULL`) unless marked as a contract step; evidence: the lint fails on a fixture migration with `DROP COLUMN`.
9. One deploy command (migrate with the direct URL, then deploy both stacks) and one teardown command; the deploy command refuses an address-hash key whose `key_id` differs from stored hashes, and a pending contract step whose `contract-step` SHA is not an ancestor of the deployed `DeployedCommit` (ADR-018); the teardown command refuses a non-empty queue or DLQ without `--discard-queued`; evidence: a deploy-command test for each refusal, a teardown test for its refusal, and a post-destroy listing of stack-tagged resources finds nothing billable.
10. The deploy command creates a DML-only runtime role that cannot delete from `webhook_events`, with role-level `idle_in_transaction_session_timeout` and `lock_timeout` below the worker timeout ([integrations.md → How it is used](../integrations.md#decision--neon)); evidence: integration test for `permission denied` on `DELETE FROM webhook_events` and on `CREATE TABLE`, and one where an idle lock holder does not stop the worker committing.
11. PG-U01 settled from Neon's docs or support; PG-U02 settled by a deployed test where two transactions on one `email_id` serialize through the pooled URL; PG-U06 settled by `SHOW idle_in_transaction_session_timeout` through the pooled URL.
12. Verify stage walked with one Ask-first send to `delivered@resend.dev`, `ledger email` showing `delivered` and `ledger health` showing queue and DLQ at 0; it settles RS-U14 and AWS-U04.
13. RS-U21 settled by the Ask-first two-recipient send from the project's verified sending domain to `delivered@resend.dev` and `bounced@resend.dev`, observing each event's own `data.to` (through `resend webhooks listen` or the deployed ledger's stored payload and `ledger email`), with the result in resend.md. Settled early, 2026-10-17: [RS-43](../resend.md#facts), observed through `resend webhooks listen` and the dashboard's webhook event log.
14. RS-U07 closed by the Ask-first test webhook pointed at an endpoint that returns `401`, or proved safe by the exact-`200` contract, its row citing the result.
15. AWS-U03, AWS-U05, AWS-U06, AWS-U07, AWS-U09, AWS-U10 and PG-U04 closed or proved safe either way, each [Unverified] row citing its test, measurement or teardown drill.

## 3. Out of scope

The card's Deferred tail, verbatim: "Alarms, runbook, DLQ inspect and redrive, simulator secret, burst and chaos runs ([slice 3](../build-checklist.md#3--operations-and-evidence-on-aws)). Reconciler and its Resend key ([slice 4](../build-checklist.md#4--recovery)). Scripted webhook creation (tripwire in [architecture.md → Deferred](../architecture.md#deferred-yagni))."

Also out, each with its carrier:

| Not built here | Carried by / tripwire |
| --- | --- |
| The queue-age, DLQ-depth and Lambda-error alarms, their runbook entries, and the alarm topic's runbook | [slice 3](../build-checklist.md#3--operations-and-evidence-on-aws). Slice 2 has exactly two alarms: the usage trip and the kill switch's `Errors` (D28, D29) |
| `dlq.listMessages`, `dlq.startRedrive`, the DLQ's redrive-allow policy | [slice 3](../build-checklist.md#3--operations-and-evidence-on-aws) |
| `ledger/simulator-signing-secret` and the simulator flag | [slice 3](../build-checklist.md#3--operations-and-evidence-on-aws) ([ADR-016](../architecture.md#adr-016--the-simulator-reaches-aws-only-through-an-opt-in-simulator-secret)) |
| PG-U07 (Neon's storage-limit SQLSTATE). The classifier gains `53100` now, safe either way (D9) | [slice 3](../build-checklist.md#3--operations-and-evidence-on-aws), MUST by its first storage-budget measurement |
| RS-U08 (Resend's delivery timeout, measured p99) and CBL-21 (cold single delivery) | [slice 3](../build-checklist.md#3--operations-and-evidence-on-aws); CBL-21 recurring |
| `ledger reconcile` after a re-arm; the trip drill's last step ("reconcile") | [slice 4](../build-checklist.md#4--recovery). The drill prints the step with `→ slice 4` (C7) |
| `ledger/resend-api-key` and the webhook-id deploy input | [slice 4](../build-checklist.md#4--recovery) ([Secrets layout](../integrations.md#secrets-layout)). Slice 2 creates two of M1's three secrets (C25) |
| `health.get`'s last-reconcile-run field; its outbox fields | Slice 4; [slice 6](../build-checklist.md#6--reactions) ([api-contract.md → health.get](../api-contract.md#healthget)). Clients ignore unknown fields ([Conventions → Versioning](../api-contract.md#conventions)), so adding them later is additive |
| The `ingest.rejected{reason}` metric | [slice 4](../build-checklist.md#4--recovery) (slice 1 pre-proposal C4) |
| A durable local queue, `local_queue_messages`, local DLQ operations | [slice 2B](../build-checklist.md#2b--local-mode-queue-and-docker-compose). Slice 2's local `ledger health` reports the in-process queue's own counts (D40) |
| SDK read retries | [slice 5](../build-checklist.md#5--mcp-server-and-contract-hardening) |
| Scripted Resend webhook creation | Tripwire: a redeploy of the same stack changes the ingest URL ([Deferred](../architecture.md#deferred-yagni)). Teardown plus a fresh deploy is a new stack, not a redeploy; the walk orders teardown before the webhook exists (§21) so no endpoint update is needed |
| A deploy flag that disarms an armed kill switch | Tripwire: the owner asks to disarm the owner's deployment. Until then the deploy command refuses a disarming deploy (D33 step 3) |
| Guardrails stack in us-east-1 (AWS-U01's fallback) | Tripwire: the first guardrails deploy fails creating `AWS::Budgets::Budget` in us-east-2. Then the stack moves to us-east-1 and the kill switch's clients target the app region through its config (D28) |
| `SET LOCAL lock_timeout` inside transactions as PG-U06's fallback | Tripwire: `pnpm aws:db-check` shows the pooler does not apply the role settings (§24). It needs a pp-database rule change, put to the owner then |
| Address-hash or token-tag key rotation | [data-modeling.md → Deferred](../data-modeling.md#deferred): tripwire "the key is suspected leaked, or an adopter asks to rotate it". The token-tag key follows the same tripwire |
| Partial `health.get` answers when an AWS read fails | Tripwire: an operator walk where `ledger health` answers `internal_error` while only one of SQS, Lambda or CloudWatch is failing. v0 answers `500 internal_error` (D19) |
| `minify` or source maps on any bundle | [pp-infra → Case-by-case](../../.agents/skills/pp-infra/SKILL.md#case-by-case): a measured `Init Duration` before and after |

## 4. Prerequisites

- **Slices:** slice 1 is `[x]`. Nothing blocks drafting or building.
- **Ask-first approvals:** every row of the §7 table owner-approved 2026-10-17, except the live AWS
  runs and live Resend writes, which are approved one at a time when each runs.
- **Owner ops** (§18, §25), needed before the live steps only (task group 13): an AWS account on the
  Paid plan ([AWS-51](../aws.md#aws-budgets-and-cost-anomaly-detection)), CDK-bootstrapped in
  us-east-2; `aws lambda get-account-settings` read before the first deploy (AWS-U05); a Neon Free
  project on Postgres 18 in `aws-us-east-2`; `.env.local` holding the deploy variables (§18);
  `LEDGER_KILL_SWITCH=on` in the owner's `.env.local`; confirming the two SNS email subscriptions
  (CBL-03); creating the Resend webhook (Ask-first).
- **Env vars:** seven new public variables (§18), all owner-approved 2026-10-17. `pnpm db:setup`
  writes `LEDGER_TOKEN_TAG_KEY` and a real `LEDGER_TOKEN` locally (D41).
- **`[Unverified]` rows the slice owes** ([about.md](../about.md#open-questions)): MUST settle
  AWS-U01, AWS-U02, AWS-U11, PG-U01, PG-U02, PG-U06; closed, or proved safe under both answers: RS-U07, AWS-U03,
  AWS-U04, AWS-U05, AWS-U06, AWS-U07, AWS-U09, AWS-U10, AWS-U12, PG-U04; library bullets: the Lambda
  log-level filter, Drizzle identity on `bigint` and the identity-sequence grant, `pg`'s code-less
  errors, and the four CDK bundling and synth bullets. None blocks building; each settles in task
  group 13 or at install. PG-U01 MAY need Neon support (§25).

## 5. Reality check — per-`Ships`-item verdict

Checked against the repo at `e62bf50` on 2026-10-17, and re-checked at `a0039a1` (no code changed
since). Every `file:line` below is the file's own numbering.

| # | Verdict | Evidence | What remains |
| --- | --- | --- | --- |
| 1 | **absent** | `infra/src/app.stack.ts:5-14` is empty (acknowledges F0001 at lines 9-12); `infra/src/app.stack.test.ts:10-12` asserts zero resources. `packages/shared/src/function-env.ts` does not exist. `apps/ingest/src/ingest.handler.ts`, `apps/worker/src/worker.handler.ts` and `apps/api/src/api.handler.ts` are `export {}` stubs. `packages/aws/src/index.ts` is `export {}` and lists no `@aws-sdk/*` dependency. `esbuild` is not a root dependency (only transitive copies 0.18.20, 0.25.12, 0.28.2 in `node_modules/.pnpm`) | Everything: function construct, stacks, names object, assertions, adapters, handlers |
| 2 | **partial** | `packages/ingest/src/create-ingest.ts:81-137` already answers `200` after enqueue, `401` on no match and `503` on a rejected enqueue, with unit tests in `create-ingest.test.ts`. Secrets are static typed config (`create-ingest.ts:18-21`); no secret-reading port, no TTL cache, no Lambda adapter, no base64 decode | The Lambda handler with both encodings and its unit tests; the secret-reader port, the 5-minute cache and the `503` on an unreadable set (D13, D14) |
| 3 | **partial** | `packages/worker/src/create-worker.ts:31-44` builds `batchItemFailures` from per-message results; `create-worker.int.test.ts` proves it on Postgres. No SQS-event adaptation exists | The worker handler (SQS records ↔ messages, response) and its batch-failure **unit** test (D17) |
| 4 | **partial** | `packages/db/src/classify-database-error.ts:6-71` classifies connection errors, with `classify-database-error.test.ts`; `DatabaseUnavailableError` exists. `createWorker` has no `resume`, no retry, no pause; no event-source port; no schedule | The ADR-015 branch, `resume`, the event-source port and adapter, the resume event, the hourly schedule, `worker.resumeEventSource`, `ledger worker resume`, the classifier additions, the outage Testcontainers test (D9, D15–D17, D20) |
| 5 | **absent** | No `api_tokens` schema (`packages/db/src/schema/` holds four files); `drizzle/` holds `0000` and `0001` only; no mint or tag check in `packages/shared`; `createApi` has no auth middleware (`create-api.ts:92-95`); the SDK has `emails` and `recipients` only; the CLI registers two commands (`create-program.ts:25-26`). All four token error codes already exist in core (`error-codes.ts:5-24`) | Table, migrations, repository, mint, middleware, four routes, SDK methods, four CLI commands, bootstrap issuance, tests |
| 6 | **absent** | No health route, reader or SDK method. The in-process queue keeps no enqueue time (`in-process-queue.adapter.ts:14-22`) | Route, reader, ports, SDK, CLI, the outage integration test |
| 7 | **absent** | `infra/src/guardrails.stack.ts:5-14` is empty | The whole guardrails stack, `apps/kill-switch`, the trip and restore module, re-arm, trip drill, assertions |
| 8 | **absent** | `scripts/verify.mjs:17-35`: no migration lint stage (the comment at lines 13-14 names it "migration lint (slice 2)") | `scripts/migration-lint.mjs` with its canary, the `migrations` stage |
| 9 | **absent** | No deploy or teardown script; root `package.json` has `synth` only. `prepareDatabase` exists (`packages/db/src/prepare-database.ts:23-38`) and is the step the deploy reuses | Both commands, every refusal and its test, the post-destroy listing |
| 10 | **partial** | The runtime role exists and holds per-table DML (`drizzle/0001_grant-ledger-tables.sql`: `SELECT, INSERT` on `webhook_events`). `ensureRuntimeRole` (`prepare-database.ts:40-50`) creates the role only: no `ALTER ROLE … SET`. No refusal or idle-holder test | Role timeouts, the password path (D10), the three integration tests |
| 11 | **absent** | integrations.md rows PG-U01, PG-U02, PG-U06 `[Unverified]` | Neon docs read; `pnpm aws:db-check` (D37) run against the deploy |
| 12 | **partial** | RS-U14 is already settled ([RS-42](../resend.md#facts), slice 1); [resend.md → Onboarding reality](../resend.md#onboarding-reality) still lists the verify stage "Not done" | The deployed verify walk; AWS-U04 from the delivery's log line (D44). The RS-U14 clause needs no new work (C2) |
| 13 | **already done** | `[x]` on the card; [RS-43](../resend.md#facts); [about.md → Resolved](../about.md#open-questions) | Nothing |
| 14 | **absent** | resend.md RS-U07 row `[Unverified]` | The safe-either-way proof and the row update (D43) |
| 15 | **absent** | aws.md rows AWS-U03, U05, U06, U07, U09, U10 and integrations.md PG-U04 `[Unverified]` | Per D42's table |

`openspec/specs/` holds thirteen capabilities (`address-masking`, `cli`, `core-import-boundary`,
`event-ledger`, `event-schemas`, `local-stack`, `projection-privacy`, `projections`, `read-api`,
`sdk`, `simulator`, `verify-gate`, `webhook-ingest`). Slice 2 modifies seven and adds three (§23).

## 6. Contradictions and how each resolves

| # | Sources | Governs | Resolution |
| --- | --- | --- | --- |
| C1 | [architecture.md → Open questions owed by slice](../architecture.md#open-questions-owed-by-slice) row 2 puts AWS-U11 under "MUST settle" and AWS-U12 under "MAY close safe either way", and [aws.md → Unverified](../aws.md#unverified) names slice 2 for both. The card's Ships names neither, though [How to work this checklist](../build-checklist.md#how-to-work-this-checklist) says "An `[Unverified]` row a card owes … appears as a Ships bullet naming the row" | architecture.md (it owns which slice owes a row; the checklist copies it) | Both are carried by existing bullets' mechanisms: AWS-U11 settles in Ships 7's trip drill (its row: "the first deploy's trip drill: the throttle update succeeds under that grant"), AWS-U12 closes safe either way with Ships 15's rows (D42). The card text gains the two ids at apply (§22). The edit adds owed work the ratified table already assigns; it loosens nothing |
| C2 | Ships 12: the verify send "settles RS-U14 and AWS-U04". RS-U14 was settled 2026-10-17 by slice 1's sends ([RS-42](../resend.md#facts)); resend.md's row: "Slice 2's verify-stage send still runs" | resend.md (current fact) | The send still runs and settles AWS-U04. The RS-U14 clause is already discharged; the bullet is ticked when the walk passes. No card edit |
| C3 | [pp-infra → Cost brake in code](../../.agents/skills/pp-infra/SKILL.md#cost-brake-in-code) and [cost-brake-assertions.md](../../.agents/skills/pp-infra/references/cost-brake-assertions.md#one-assertion-per-property) put "the default-route throttle" in the guardrails template ("guardrails only"). [ADR-010](../architecture.md#adr-010--serverless-on-aws-cdk-an-app-stack-and-a-guardrails-stack) and the [System shape](../architecture.md#system-shape) put the HTTP API in the app stack, and [aws.md → Budget alarms](../aws.md#budget-alarms) item 1 forbids the guardrails stack importing anything from it | ADR-010 (a doc beats a skill) | The throttle is a property of the app stack's `$default` stage, so its assertion runs on the app template (D27). The guardrails assertion keeps the budget, notifications, topics, kill switch and `Errors` alarm. pp-infra's two lines are corrected (§22): same assertion, other stack, nothing loosened |
| C4 | [api-contract.md → health.get](../api-contract.md#healthget): "One SQS attribute read and one Lambda read per call". [AWS-22](../aws.md#sqs): `ApproximateAgeOfOldestMessage` is a CloudWatch metric, "pushed to CloudWatch at one-minute intervals"; `GetQueueAttributes` returns no age | AWS-22 (the fact) and the card ("queue depth and age") | Health reads one CloudWatch statistic for the age, `null` when the metric has no datapoint (an idle queue stops reporting after 6 h, AWS-22) (D19). The api-contract cost line is corrected, and the change adds an `AWS-NN` fact for the read's price from the CloudWatch API and pricing pages (§22) |
| C5 | [api-contract.md → Conventions](../api-contract.md#conventions) lists "the worker's event source mapping UUID" as an example internal variable. A function cannot carry its own mapping's UUID: the mapping references the function, so the reverse reference is a CloudFormation cycle. The guardrails stack must find the mapping "through its function" ([Budget alarms](../aws.md#budget-alarms) item 1) | aws.md item 1; the cycle is CloudFormation's | Every reader finds the worker's mapping by the worker's function name (`ListEventSourceMappings`) (D16). The example in Conventions becomes "the worker's function name" (§22), a fact correction |
| C6 | [rsa-manual-test → environment.md](../../.agents/skills/rsa-manual-test/references/environment.md#surfaces-by-slice): "`ledger health` in local mode from 2B", and its 2B row: "the local setup command issues the first `operate` token". [api-contract.md → Conventions](../api-contract.md#conventions): "From slice 2, every mode enforces"; [data-modeling.md → `api_tokens`](../data-modeling.md#api_tokens--read-api-bearer-tokens) names the local setup command as a mint caller | api-contract.md (a doc beats a skill) | Slice 2's local mode enforces tokens and `pnpm db:setup` mints one (D41). Local `health.get` answers from the in-process queue's own counts, because the route ships in the shared app (D40). environment.md is corrected (§22) |
| C7 | [aws.md → Budget alarms](../aws.md#budget-alarms) item 8: the trip drill ends "re-arm, reconcile". `ledger reconcile` is [slice 4](../build-checklist.md#4--recovery)'s | Both: the walk rule lets a step name its later slice | The drill and the re-arm print the reconcile step as `→ slice 4` ([build-checklist → walkthrough](../build-checklist.md#how-to-work-this-checklist)) |
| C8 | [resend.md → Onboarding reality](../resend.md#onboarding-reality): the sending domain is "Not done: deferred". [about.md → Scope questions](../about.md#open-questions): bought and verified 2026-10-17, and it carried RS-43 | about.md (current fact) | Fact correction in resend.md (§22). The webhook and verify rows update after the walk |
| C9 | [local-stack spec → Setup writes missing local configuration once](../../openspec/specs/local-stack/spec.md): "writing each only when unset or empty and never overwriting a value". Slice 1 pre-proposal D27: the fixed placeholder exists "so slice 2's setup, which mints a real token, can recognize and replace it"; api-contract: every mode enforces from slice 2 | D27 and api-contract.md | `pnpm db:setup` overwrites `LEDGER_TOKEN` alone, and only when it is empty, the slice 1 placeholder, or not an active token in the database setup just prepared (D41). Every other name keeps "never overwritten", the address-hash and token-tag keys above all. The requirement is MODIFIED (§23). It weakens no safety rule: a placeholder or dead token already authenticates nothing |
| C10 | [read-api spec → Auth skipped only on loopback](../../openspec/specs/read-api/spec.md) (slice 1's interim rule) vs. slice 2's enforcement | api-contract.md → Conventions | The requirement is REMOVED and replaced by "Bearer token on every route" (§23). The loopback-only bind stays and moves to `local-stack` (D40). Nothing loosens: auth becomes stricter and the bind guard is kept |
| C11 | [data-modeling.md → `api_tokens`](../data-modeling.md#api_tokens--read-api-bearer-tokens)'s field table lists no `updated_at`. [Base fields](../data-modeling.md#base-fields--the-checklist-for-every-new-model): `updated_at` "MUST on mutable rows"; the Model index gives `api_tokens` "Insert, then revoke once", and its grant includes `UPDATE` | Base fields (they bind every table; the field table lists load-bearing columns only) | `api_tokens` carries `created_at` and `updated_at` (D7). The field table gains a line that `revoked_at`'s update also sets `updated_at` (§22) |
| C12 | [pp-backend → ingest-and-worker](../../.agents/skills/pp-backend/references/ingest-and-worker.md#ingest-in-order) step 1: "A failed or empty read throws, so the answer is a `5xx` Resend retries, never a `401`". Ships 2 names `503` for a failed enqueue only | Both, compatible | A failed or empty secret read also answers `503` with the fixed body (D13): it is required for ingest to work on AWS (the [in-scope test](../../.agents/skills/pp-workflow/references/slice-scoping.md#3--the-in-scope-test) row 3), and it is what makes RS-U07 safe either way (D43) |
| C13 | [aws.md → AWS-U09](../aws.md#unverified): settled by "deploy once while tripped with an ESM property change". [ADR-018](../architecture.md#adr-018--migrations-run-from-the-deploy-command-before-the-code-that-needs-them): the deploy command refuses while tripped | ADR-018; Ships 15 allows "proved safe either way" | AWS-U09 closes safe either way: the refusal-while-tripped test and the pause-restore test (D42). No tripped deploy is run |
| C14 | [AWS-U01](../aws.md#unverified): settled by "a forced low-threshold notification". [AWS-34](../aws.md#aws-budgets-and-cost-anomaly-detection): "Actual alerts are only sent out once per budget, per budget period" | AWS-34 plus lens clause 6 (no budget-alarm gap) | Forcing the real budget would spend its one ACTUAL alert for the month. The drill forces a separate, temporary drill budget behind `--budget-drill` (D28, D36); the real budget's alerts stay armed |
| C15 | [about.md → library bullets](../about.md#open-questions) and [pp-general → logging-and-pii](../../.agents/skills/pp-general/references/logging-and-pii.md#logger): whether Lambda's JSON-format level filter accepts Winston's lowercase levels | The decision lens (reversible-cheap) | Functions use `LoggingFormat.TEXT` (D31), under which Lambda applies no application level filter, and the logger already writes `level` and `timestamp` itself. The bullet resolves as "moot under TEXT", with the first deploy's log lines as evidence (§22) |
| C16 | [Ships 1](../build-checklist.md#2--durable-ingest-on-aws) "each function's environment carries exactly its names-object keys" vs. the kill switch, which lives in the guardrails stack, not the app stack | Ships 1 (every function) | The names object has one entry per function, the kill switch included, and its key-set assertion runs on the guardrails template (D2, D27, D28) |
| C17 | [aws.md → Budget alarms](../aws.md#budget-alarms) item 3: ACTUAL 50 %, ACTUAL 80 % and FORECASTED 100 % "go to email", ACTUAL 100 % "to email **and** the trip topic". [AWS-33](../aws.md#aws-budgets-and-cost-anomaly-detection): a notification takes "one SNS subscriber and up to 10 email subscribers"; a template synthesized in CI has no alert address | Item 3's recipients | Each notification's SNS subscriber is a topic (alert topic for the first three, trip topic for ACTUAL 100 %), and the alert address subscribes to both topics (D28). The recipients are exactly item 3's. CBL-03 already names both topics. Item 3's wording gains the mechanism (§22) |
| C18 | [aws.md → Budget alarms](../aws.md#budget-alarms) item 4 names five functions the kill switch throttles ("ingest, worker, dispatcher, reconciler and the read API"); slice 2 deploys three | Item 4's intent ("every app function") | The kill switch lists functions by the app stack's name prefix at trip time (D29), so slices 4 and 6 add theirs with no kill-switch edit and no gap |
| C19 | [Secrets layout](../integrations.md#secrets-layout): `ledger/resend-api-key` "From M1". The card's Deferred tail: "Reconciler and its Resend key (slice 4)" | Both: slice 4 is inside M1 | Slice 2 creates `ledger/webhook-signing-secrets` and `ledger/database`. [Cost shape](../aws.md#cost-shape)'s "3 secrets in M1" holds at the M1 boundary |

Also checked, no contradiction: ADR-001 vs. `create-ingest.ts` (fixed bodies, verify then enqueue);
ADR-008's batch size, failure list and `maxReceiveCount` vs. AWS-04, AWS-05, AWS-09; ADR-018's
order vs. [pp-infra → scripts → Deploy](../../.agents/skills/pp-infra/references/scripts.md#deploy);
the `api_tokens` partial unique key vs. [Idempotency keys](../data-modeling.md#idempotency-keys);
the four token error codes vs. `packages/core/src/error-codes.ts`; the card's `UI surfaces` line vs.
the six api-contract entries naming slice 2 (each surface has its operation, and `email.get` /
`recipient.get` owe slice 2 only the auth and `503` paths).

## 7. Decisions

**Ask-first approvals** (owner, 2026-10-17, one itemized round; every item approved):

| Item | Exact scope | Status | Used by |
| --- | --- | --- | --- |
| AWS SDK runtime clients | `@aws-sdk/client-sqs`, `@aws-sdk/client-secrets-manager`, `@aws-sdk/client-lambda`, `@aws-sdk/client-cloudwatch`, each `3.1152.0` exact (npm `latest`, 2026-10-14), `dependencies` of `packages/aws` only | owner-approved 2026-10-17 | Group 5 |
| AWS SDK script clients | `@aws-sdk/client-apigatewayv2`, `@aws-sdk/client-cloudformation`, `@aws-sdk/client-resource-groups-tagging-api`, `@aws-sdk/client-cloudwatch-logs`, `@aws-sdk/client-budgets`, `@aws-sdk/client-sns`, each `3.1152.0` exact, `dependencies` of `packages/aws` only | owner-approved 2026-10-17 | Groups 5, 11, 12 |
| `esbuild` | `0.28.2` exact (2026-08-08), root `devDependencies` only. `aws-cdk-lib` 2.273.0 builds against `^0.28.1` | owner-approved 2026-10-17 | Group 11 |
| Six operations | `health.get`, `worker.resumeEventSource`, `token.create`, `token.list`, `token.revoke`, `token.getCurrent` exactly as [api-contract.md](../api-contract.md) names them (routes, SDK methods, CLI commands), with this document's wire details: `token.create` answers `201`; a `bearerAuth` security scheme and a `401` response on every route of the OpenAPI document; the response objects and `validation_failed` messages of §12 | owner-approved 2026-10-17 | Groups 8, 9 |
| Seven public env vars | `LEDGER_TOKEN_TAG_KEY`, `LEDGER_DEPLOY_DATABASE_URL`, `LEDGER_DEPLOY_DATABASE_POOLED_URL`, `LEDGER_DEPLOY_WEBHOOK_SECRETS`, `LEDGER_ALERT_EMAIL`, `LEDGER_KILL_SWITCH`, `LEDGER_BUDGET_USD` (§18). Added to [Conventions](../api-contract.md#conventions) and `.env.example` (names only) | owner-approved 2026-10-17 | Groups 2, 10, 12 |
| Script names and flags | `pnpm aws:deploy [--issue-operate-token <name>] [--budget-drill]`, `pnpm aws:teardown [--discard-queued]`, `pnpm aws:rearm`, `pnpm aws:trip-drill`, `pnpm aws:db-check --email-id <id> [--idle-minutes <n>]` | owner-approved 2026-10-17 | Group 12 |
| CI change | One new stage, `migrations`, in `scripts/verify.mjs` after `lint`, with its canary. No edit to `.github/workflows/ci.yml` | owner-approved 2026-10-17 | Group 4 |
| `.gitleaks.toml` rule | A custom `ldg_` bearer-token rule plus its canary in `scripts/secret-scan.mjs` (D39) | owner-approved 2026-10-17 | Group 4 |
| Schema | `api_tokens` (§8) and two new migrations, `0002_create-api-tokens` (generated) and `0003_grant-api-tokens` (custom). Pure expand; unfrozen until merged to `main` | owner-approved 2026-10-17 | Group 3 |
| AWS runs | `aws lambda get-account-settings` (read), every `pnpm aws:deploy` (first, `--budget-drill`, redeploys), `pnpm aws:trip-drill`, `pnpm aws:rearm`, `pnpm aws:db-check`, `pnpm aws:teardown`. **Approved one at a time, when each runs** | held — per action at walk time | Group 13 |
| Live Resend writes | Creating the production webhook for the deployed ingest URL; the verify-stage send to `delivered@resend.dev`. **Approved one at a time, when each runs** ([integrations.md → Locked rules](../integrations.md#locked-rules-must), rule 8) | held — per action at walk time | Group 13 |

Anything else (another dependency or version, a `ci.yml` edit, another variable, flag, route,
error code or stage, a frozen migration changed) stops at apply. Workspace `"@ledger/<pkg>":
"workspace:*"` entries are boundary declarations, not Ask-first
([pp-general → adding-things](../../.agents/skills/pp-general/references/adding-things.md#add-a-dependency)).
No error code is added: every code slice 2 raises is in the registry and the core mirror.

### Kernel and core

**D1 — Ports landing in slice 2** (each `packages/shared/src/<name>.port.ts`, the four
[pp-backend → Ports](../../.agents/skills/pp-backend/references/composition.md#ports) marks "Lands 2"):

| Port | Methods | Implementations |
| --- | --- | --- |
| `SecretReaderPort` (`secret-reader.port.ts`) | `read(secretId: string): Promise<string>` | `SecretsManagerSecretReaderAdapter` (`packages/aws`); `StaticSecretReaderAdapter` (`packages/shared`) for local mode, built from the values `apps/local`'s config parsed, so the factory always takes the port ([pp-backend → Ports](../../.agents/skills/pp-backend/references/composition.md#ports), Secret reading row) (D13, D40) |
| `EventSourceControlPort` (`event-source-control.port.ts`) | `getState(): Promise<EventSourceState>`, `enable(): Promise<void>`, `disable(): Promise<void>` | `LambdaEventSourceControlAdapter` (`packages/aws`), bound to one function name; `StaticEventSourceControlAdapter` (`packages/shared`, reports `enabled`, enable and disable are no-ops) for local mode ([worker.resumeEventSource](../api-contract.md#workerresumeeventsource): "In local mode it is a no-op that reports the state") |
| `QueueAttributesPort` (`queue-attributes.port.ts`) | `read(): Promise<QueueSnapshot>`, `QueueSnapshot = { visible, inFlight, oldestAgeSeconds: number \| null, dlqVisible, dlqInFlight }` | `SqsQueueAttributesAdapter` (`packages/aws`: `GetQueueAttributes` on both queues, plus one CloudWatch statistic, C4); `InProcessQueueAdapter` implements it too (D40) |
| `FunctionInvokePort` (`function-invoke.port.ts`) | `invoke(payload: unknown): Promise<unknown>` (synchronous: awaits the function's result) | `LambdaFunctionInvokeAdapter` (`packages/aws`, `RequestResponse`), bound to one function name; `InProcessFunctionInvokeAdapter` (`packages/shared`) over a local function |

The asynchronous invoke the dispatcher and reconciler need is slices 4 and 6's. Stateful fakes, one
per port, go in `@ledger/shared/testing` (`FakeSecretReader`, `FakeEventSourceControl`,
`FakeQueueAttributes`, `FakeFunctionInvoke`): each holds the state the port reads and writes, and a
test asserts the resulting state ([pp-testing → fakes](../../.agents/skills/pp-testing/references/fakes-and-doubles.md#which-double-per-seam)).

**Shared port contract suites.** Slice 2 gives five ports a second implementation: `QueuePort`
(in-process, SQS), and the four above. Each port gets one suite in `@ledger/shared/testing`
(`queuePortContract`, `secretReaderPortContract`, `eventSourceControlPortContract`,
`queueAttributesPortContract`, `functionInvokePortContract`), run once per implementation: the local
one directly, the `packages/aws` one over its stubbed client (D26). A suite holds only the behavior
both implementations share (for `QueuePort`: `enqueue` resolves on acceptance and rejects on a
failed send, which R4 rests on; for `EventSourceControlPort`: `getState` answers a member of
`eventSourceStates` and `enable` / `disable` resolve); a behavior only one side has stays in that
side's own test. Authority: [pp-testing → AWS adapters](../../.agents/skills/pp-testing/references/fakes-and-doubles.md#aws-adapters)
("When a second implementation of the port exists, the adapter also runs the port's shared contract
suite"); [shared contract suites](../../.agents/skills/pp-testing/references/vitest-layout.md#shared-contract-suites).

Authority: ADR-013; pp-backend → Ports ("Each port's exact name and methods are settled by the slice
that lands it").

**D2 — Internal variable names** (`packages/shared/src/function-env.ts`, one `as const` object per
function; `infra/src/function-env.ts` sets each value on its reader only):

| Object | Keys | Values |
| --- | --- | --- |
| `ingestEnv` | `SIGNING_SECRETS_ARN`, `QUEUE_URL` | ARN of `ledger/webhook-signing-secrets`; source queue URL |
| `workerEnv` | `DATABASE_SECRET_ARN` | ARN of `ledger/database`. The worker finds its own mapping by its own name, read from the runtime's reserved `AWS_LAMBDA_FUNCTION_NAME` ([AWS-56](../aws.md#lambda)) (D16) |
| `apiEnv` | `DATABASE_SECRET_ARN`, `QUEUE_URL`, `DLQ_URL`, `WORKER_FUNCTION_NAME` | ARN; both queue URLs; the worker's physical name (for its mapping and the resume invoke) |
| `killSwitchEnv` | `APP_STACK_NAME`, `ALERT_TOPIC_ARN` | `LedgerApp` (the prefix it resolves targets from); the alert topic's ARN |

No key is Lambda-reserved, every value is an ARN, URL or name, and the four objects together stay
far inside AWS-56's 4 KB. Authority: [pp-infra → env-and-inputs](../../.agents/skills/pp-infra/references/env-and-inputs.md#internal-environment-variables)
("Each name is fixed by the slice that introduces it").

**D3 — Token mint, tag check and hash** (`packages/shared/src/api-token.ts`, `node:crypto` only):

- Format `ldg_<random>_<tag>`: `random` is 32 random bytes as 64 lowercase hex characters; `tag` is
  `HMAC-SHA-256(tagKey, random)` as 64 lowercase hex characters. Hex, because base64url's alphabet
  holds the `_` separator.
- `mintApiToken(tagKey: Uint8Array): { token: string; tokenHash: string }`.
- `hasValidTag(token: string, tagKey: Uint8Array): boolean`: shape check
  `^ldg_[0-9a-f]{64}_[0-9a-f]{64}$`, then a constant-time compare (`timingSafeEqual`) of the
  recomputed tag. No I/O.
- `hashApiToken(token: string): string`: SHA-256 of the whole token string, 64 hex characters. An
  unkeyed hash is sufficient because `random` carries 256 bits ([api_tokens](../data-modeling.md#api_tokens--read-api-bearer-tokens)).
- `tagKey` is 32 bytes, given as 64 lowercase hex (`LEDGER_TOKEN_TAG_KEY` locally, `tokenTagKey` in
  the `ledger/database` secret on AWS).

Three callers: `packages/api` (`token.create`), the deploy command, `pnpm db:setup`. Authority:
[api-contract.md → Conventions](../api-contract.md#conventions) (Auth); data-modeling ("Mint home").
Rules out: a plaintext token at rest; a database read before the tag check.

**D4 — Core closed sets.** `packages/core` gains `tokenScopes = ['read', 'operate'] as const`
(`tokenScopeSchema`, feeding `api_tokens`' `CHECK`) and
`eventSourceStates = ['enabled', 'paused', 'changing'] as const` (`eventSourceStateSchema`), the wire
value of the mapping's state: Lambda's `Enabled` → `enabled`, `Disabled` → `paused`, any other
(`Creating`, `Enabling`, `Disabling`, `Updating`) → `changing`. Authority:
[Modeling conventions](../data-modeling.md#modeling-conventions-canonical) (closed sets mirrored by a
core Zod enum); AWS-18.

**D5 — EMF metrics writer.** `packages/shared/src/emf-metrics.adapter.ts` → `EmfMetricsAdapter`
implements `MetricsPort` by writing one EMF JSON line per call through an injected sink
(`process.stdout.write` on Lambda, [pp-general → Metrics](../../.agents/skills/pp-general/references/logging-and-pii.md#metrics)):
namespace `Ledger`, one empty dimension set (no dimension; `ingest.rejected`'s `reason` is slice
4's), the unit `Count` or `Milliseconds`, plus the caller's allow-listed log fields. No library.
Lambda roots use it; `apps/local` keeps `LogMetricsAdapter`. The hourly resume emits no metric, so an
idle hour costs no custom-metric charge ([AWS-12](../aws.md#cloudwatch-and-sns)).

**D6 — Per-invocation log fields.** `createLogger` gains an optional `context: () => LogFields`,
merged into every line through the same allow-list. Each Lambda handler updates a per-container
holder `{ request_id: context.awsRequestId, cold_start }` at the start of each invocation; a Lambda
container runs one invocation at a time, so lines never interleave. `apps/local` passes none (the
API already sets `request_id` per call). Authority: [pp-general → Logger](../../.agents/skills/pp-general/references/logging-and-pii.md#logger)
("Every line carries … `request_id` (from the Lambda context's `awsRequestId` …) … and `cold_start`").

### Database

**D7 — `api_tokens`** (§8): one schema file, one generated migration, one grant migration
(`SELECT, INSERT, UPDATE`, the [grants](../../.agents/skills/pp-database/references/migrations-and-grants.md#grants)
row for set-once tables). Authority: [data-modeling.md → `api_tokens`](../data-modeling.md#api_tokens--read-api-bearer-tokens),
[New-table recipe](../../.agents/skills/pp-database/references/new-table-recipe.md).

**D8 — `apiTokensRepository`** (`packages/db/src/api-tokens.repository.ts`), executor-first:

- `insert(db, row)`: a plain insert; `RETURNING` the row. `token.create` and `--issue-operate-token`.
- `insertBootstrapIfAbsent(db, row)`: `INSERT … ON CONFLICT DO NOTHING` on the partial unique
  `(bootstrap) WHERE bootstrap`; returns the row or `undefined`. The deploy command and `db:setup`.
- `findActiveByHash(db, tokenHash)`: `{ id, name, scope }` of an unrevoked row. The auth middleware.
- `findById(db, id)`, `listPage(db, { limit, afterId })` (newest first, `id < afterId`, served by
  the primary key, [keyset pages](../../.agents/skills/pp-database/references/indexes-and-jsonb.md#keyset-pages)).
- `lockActiveOperate(tx)` → the active `operate` rows `ORDER BY id FOR UPDATE`; `lockById(tx, id)`;
  `markRevoked(tx, id)` (`revoked_at = now(), updated_at = now() WHERE id = $1 AND revoked_at IS NULL`).
  The lock functions take a `Transaction`.

The `key_id` check's read, `storedAddressHashKeyId`, is not a token function (D12).

**D9 — Pool timeouts and the classifier.** `createDatabase({ url, max, logger })` sets
`connectionTimeoutMillis: 5_000` and `query_timeout: 15_000` (named constants beside the factory,
both below every function's timeout, D27). The classifier gains:

- `pg`'s code-less `Query read timeout` (`node_modules/.pnpm/pg@8.23.1/node_modules/pg/lib/client.js:707`, the `query_timeout` error),
  as connection-class. A server that answers no statement within 15 s, while the role's
  `lock_timeout` (10 s, D10) ends every lock wait server-side first, is unreachable for the worker's
  purposes. A misread pauses at most one hour (the hourly resume, [Risks](../architecture.md#risks--mitigations)).
- `53100` (`disk_full`), Neon's likely storage-limit SQLSTATE, as ADR-015's out-of-storage class.
  Safe under both answers until PG-U07 settles in slice 3: an unmatched code follows ADR-008, as
  today.

Authority: [pp-database → Connection](../../.agents/skills/pp-database/references/schema-and-repositories.md#connection)
("The values, and whether a `Query read timeout` error is connection-class, are the slice 2
pre-proposal's"); ADR-015.

**D10 — `prepareDatabase` grows three things.** The deploy command, `pnpm db:setup` and the harness
call it, so one path stays tested:

- `roleTimeouts: { idleInTransactionMs, lockTimeoutMs }`: after ensuring the role, it runs
  `ALTER ROLE ledger_runtime SET idle_in_transaction_session_timeout = …` and
  `… SET lock_timeout = …` on every call. Values: deploy and setup `5_000` / `10_000` (both below the
  worker's 60 s timeout; idle below lock, so an idle holder is ended before a waiter's lock wait
  expires, and the waiter commits); harness `2_000` / `5_000` (above the longest wait any concurrency
  test polls for, [harness step 2](../../.agents/skills/pp-testing/references/postgres-harness.md#lifecycle-one-run)).
- `resetPassword: boolean`: when `true`, an existing role's password is set to `runtimePassword`
  (`ALTER ROLE … PASSWORD`, quoted through `pg`'s `escapeLiteral`, as role creation already is). The
  deploy command passes `true` only when no usable password is stored (D33 step 6).
- The role name stays the one constant, `RUNTIME_ROLE`.

Authority: [integrations.md → Runtime role](../integrations.md#decision--neon) ("values fixed by slice
2"); [pp-database → Grants](../../.agents/skills/pp-database/references/migrations-and-grants.md#grants).

**D11 — Storage read and its limit.** `databaseRepository.storageBytes(db)` →
`SELECT pg_database_size(current_database())`. The limit is `STORAGE_LIMIT_BYTES = 1_000_000_000`
in `packages/db`: Neon Free's "1 GB" read as the smaller, decimal unit, so the resume probe refuses
early rather than late. The probe fails at `≥ 95 %` of it (`STORAGE_PROBE_THRESHOLD = 0.95`), because
`pg_database_size` and Neon's own storage accounting can differ; PG-U07's slice 3 measurement
revisits both constants. `health.get` reports the bytes and the limit (D19). Authority: ADR-015 ("The
probe also reads storage used and fails while it is at the storage budget's limit");
[Cadence](../integrations.md#cadence-and-the-database).

**D12 — Deploy refusal helpers in `packages/db`**, because the data they read lives there:

- `storedAddressHashKeyId(db)`: the 8-character prefix of any one stored hash, from
  `recipient_state.address_hash` (one row, `LIMIT 1`), or `undefined` on an empty database. The deploy
  command compares it with `addressHashKeyId(key)` ([PII & retention](../data-modeling.md#pii--retention):
  "The deploy command MUST refuse a key whose `key_id` differs from a stored hash's prefix").
- `pendingContractSteps(db)`: the pending migrations' (not in `drizzle.__drizzle_migrations`) first
  lines, parsed for `-- contract-step: <40-hex SHA>`; `replace:` markers carry no SHA and are
  skipped ([the marker](../../.agents/skills/pp-database/references/migrations-and-grants.md#the-contract-step-marker)).

### Ingest

**D13 — The secret set on AWS.** `createIngest` takes `secretReader: SecretReaderPort` and
`signingSecretsId: string` in place of the static `secrets.resend`; `simulatorSecret: string |
undefined` stays typed config until slice 3 gives the simulator secret its own read (ADR-016).
Ingest reads `signingSecretsId` through the port and parses the value with Zod as a JSON array of
`whsec_…` strings (the [Secrets layout](../integrations.md#secrets-layout) row), so the parse lives
in `packages/ingest` and is tested once. It caches the last successful result per container for
`SECRET_SET_TTL_MS = 300_000` against the clock port ([ADR-009](../architecture.md#adr-009--multi-secret-verification-and-timestamp-tolerance)).
After the TTL it refreshes; a failed read, a value that fails the parse, or a set with no secret at
all (no Resend secret and no simulator secret) answers `503` with the fixed body `unavailable`, logs
`ingest.secrets_unavailable` with `error_name`, enqueues nothing and emits no metric. A failed
refresh never serves an expired set. On AWS, `apps/ingest`'s root passes the
`SecretsManagerSecretReaderAdapter` and `SIGNING_SECRETS_ARN` (D2), simulator `undefined`. Locally,
`apps/local` passes a `StaticSecretReaderAdapter` that answers `JSON.stringify` of its parsed
`LEDGER_WEBHOOK_SECRETS` for the one id it was built with and rejects any other (D1). Authority:
ADR-001, ADR-009, C12; [pp-backend → Ports](../../.agents/skills/pp-backend/references/composition.md#ports)
(Secret reading: "locally `apps/local`'s `main.ts` passes a static implementation over the values
its config parsed from `.env.local`, so the factory always takes the port").

**D14 — `apps/ingest`.** `ingest.handler.ts` exports `createIngestHandler(ingest)` and
`handler = createIngestHandler(<the root's ingest>)`. Per event (API Gateway payload 2.0,
[AWS-01](../aws.md#api-gateway-http-api)):

1. Body: when `isBase64Encoded` is `true`, `Buffer.from(body, 'base64').toString('utf8')`; otherwise
   `body`, or `''` when absent. Headers are already lowercase in payload 2.0; the three `svix-*` are
   passed.
2. One info line per request, `ingest.request_decoded`, carrying `body_base64_count` (`1` or `0`).
   The `<name>_count` form is already on the [log allow-list](../data-modeling.md#log-fields), so no
   doc change is needed, and it is how AWS-U04 is read from the verify delivery (D44).
3. `{ statusCode, headers: { 'content-type': INGEST_CONTENT_TYPE }, body, isBase64Encoded: false }`.
4. Anything thrown is caught at the edge, logged by `error_name`, and rethrown as a constant
  `LedgerError('internal_error', …)` with no `cause` ([pp-general → Catching](../../.agents/skills/pp-general/references/errors.md#catching)).

No `@types/aws-lambda`: each handler declares the narrow event shape it reads.

### Worker

**D15 — The ADR-015 branch in `processBatch`.** For each message, in order:

1. Run `RecordEventCommand`. Success → next message.
2. If it throws and `classifyDatabaseError(err)` matches, run the same message once more (the pool
   has discarded the broken client, so the retry opens a fresh connection). Success → next message.
3. If the retry matches too: report **every** message of the batch in `batchItemFailures` (a
   message already committed in this batch is redelivered as a duplicate, absorbed on `svix_id`),
   log `worker.database_unavailable`, then call `eventSource.disable()`. A failing `disable` is
   logged (`worker.pause_failed`, `error_name`) and the response is unchanged. Stop processing.
4. Any other error: that message alone is listed (ADR-008).

`createWorker` takes `eventSource: EventSourceControlPort` and `storageLimitBytes`. Authority:
ADR-015 ("retries once on a fresh connection … reports every message in the batch as failed and
disables its own ESM"); [pp-backend → Database outage](../../.agents/skills/pp-backend/references/ingest-and-worker.md#database-outage-adr-015).

**D16 — `worker.resume()` and how the worker finds its mapping.**
`resume(): Promise<ResumeResult>`, `ResumeResult = { outcome: 'resumed' | 'already_enabled' | 'probe_failed'; state: EventSourceState }`:

1. `eventSource.getState()`. `enabled` → `already_enabled`, no database connection.
2. Otherwise probe: `storageBytes` (D11) on the pool. It connects, so it proves reachability, and it
   reads storage. A connection-class error, or storage at the threshold → `probe_failed`, state
   unchanged.
3. Success → `eventSource.enable()`, then `getState()` → `resumed`.

`LambdaEventSourceControlAdapter` is constructed with a function name. It calls
`ListEventSourceMappings({ FunctionName })` once per container, requires exactly one mapping (else a
constant error), caches its UUID, and reads and updates it with `GetEventSourceMapping` and
`UpdateEventSourceMapping({ Enabled })`. The worker passes its own name; the read API, the kill
switch, the re-arm and the deploy command pass `LedgerApp-worker`. Authority: C5;
[pp-backend → ingest-and-worker](../../.agents/skills/pp-backend/references/ingest-and-worker.md#database-outage-adr-015)
("The resume event's shape, and how the worker learns its own ESM UUID … are the pre-proposal of the
slice that ships the pause and resume (slice 2)").

**D17 — `apps/worker`.** `worker.handler.ts` exports `createWorkerHandler(worker)` and `handler`.
It branches on the event:

- **SQS batch** (`Records` array whose entries carry `eventSource: 'aws:sqs'`): maps each record to
  `{ messageId, body }`, calls `processBatch`, returns `{ batchItemFailures }` exactly as built.
- **Resume event** `{ "ledger": "resume-event-source" }` (Zod-parsed): calls `resume()` and returns
  the `ResumeResult`. The hourly schedule sends it asynchronously; the read API sends it
  synchronously and reads the result.
- **Anything else:** throws a constant `LedgerError('internal_error', …)`.

A thrown error from `processBatch` is rethrown as a constant (AWS-05: a thrown exception fails the
whole batch, which is redelivered, never acknowledged). The root reads `ledger/database` once per
container on the first invocation, through a memoized promise (D32), and builds the size-1 pool from
it. Authority: ADR-008, AWS-05 ("a thrown exception" is complete failure); [pp-backend → Worker, per batch](../../.agents/skills/pp-backend/references/ingest-and-worker.md#worker-per-batch);
the resume event's shape is this slice's to fix ([Database outage](../../.agents/skills/pp-backend/references/ingest-and-worker.md#database-outage-adr-015)).

### Read API

**D18 — Auth middleware** (`packages/api/src/auth.middleware.ts`), after the request id and before
every route, the not-found handler included:

1. `Authorization` missing, not `Bearer <token>`, or `hasValidTag` false → `401 unauthorized`. No
   database connection opens.
2. `findActiveByHash(hashApiToken(token))`. No row → `401 unauthorized`. A classified database error
   → `503 database_unavailable`, **except** on `GET /health` (the health route's exported method and
   path constants), which continues with the caller marked `verified: false`.
3. The caller `{ tokenId, name, scope, verified }` is set on the context.
4. Each route's `createRoute` carries `middleware: requireScope('read' | 'operate')`, its entry's
   **Scope**; `operate` satisfies `read`. Short → `403 forbidden`.

Every failure uses the registry's default `message` and `hint`, so a `401` never reveals which check
failed. `apps/local` enforces the same middleware ([Conventions](../api-contract.md#conventions):
"From slice 2, every mode enforces"). Authority: [pp-backend → read-api → Middleware](../../.agents/skills/pp-backend/references/read-api.md#middleware-in-this-order).

**D19 — `health.get`** (`get-health.route.ts`, `GetHealthReader`): reads `QueueAttributesPort`,
`EventSourceControlPort` and, under a try, `storageBytes`. A classified database error →
`database.reachable: false`, `storage_bytes: null`; it never fails the response. When the caller is
`verified: false` (D18 step 2 already classified the database unreachable), the reader skips
`storageBytes` and reports `reachable: false` at once. So a request makes at most one database
attempt: on a database that hangs rather than refuses, two stacked attempts (15 s query timeout,
then a 5 s reconnect and another 15 s, D9) would pass the read API's 25 s timeout and API Gateway's
30 s (AWS-02), and `ledger health` would get `api_unavailable` exactly when Ships 6 says it answers. An AWS read error →
`500 internal_error`, logged (§3 holds the tripwire for partial answers). The CloudWatch read is
`GetMetricStatistics` of `AWS/SQS` `ApproximateAgeOfOldestMessage`, `Maximum`, dimension
`QueueName` (the source queue URL's last segment), period 60 s over the last 5 minutes; no datapoint
→ `null`. Shape in §12. Authority: [health.get](../api-contract.md#healthget); C4.

**D20 — `worker.resumeEventSource`** (`resume-event-source.route.ts`, `ResumeEventSourceCommand`,
`POST /worker/resume`, `operate`): invokes the worker through `FunctionInvokePort` with
`{ "ledger": "resume-event-source" }`, parses the `ResumeResult` with Zod, and answers `200`
`{ object: 'event_source', state, resumed }`. `probe_failed` → `503 database_unavailable` with
§12's message. An invoke failure or a result that fails the parse → `500 internal_error`. On an
enabled source it opens no database connection (the worker's step 1). Authority:
[worker.resumeEventSource](../api-contract.md#workerresumeeventsource) ("It invokes the worker with
the resume event … `database_unavailable` (the probe failed, so the source stays paused)");
[pp-backend → Ports](../../.agents/skills/pp-backend/references/composition.md#ports) (Function
invoke, synchronous: "API → worker resume").

**D21 — Token routes** (each one route file, one command or reader, one mapper):

- `token.getCurrent` → `GET /tokens/current` (`read`): the caller's row by `tokenId`.
- `token.list` → `GET /tokens` (`operate`): `limit` 1–100, default 20; `after` a token id; newest
  first by `token_id`; the list envelope with `has_more`.
- `token.create` → `POST /tokens` (`operate`): body `{ name, scope }`, `request.body.required: true`;
  `name` matches `^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$`; `scope` ∈ `tokenScopes`. Mints (D3), inserts
  with `bootstrap = false`, answers `201` with the row plus `token` (the plaintext, once).
- `token.revoke` → `POST /tokens/{token_id}/revoke` (`operate`): `token_id` matches
  `^[1-9][0-9]{0,14}$` (as does `token.list`'s `after`). `token_id` is a JSON number on the wire, so
  the pattern stops at 15 digits, every value inside `Number.MAX_SAFE_INTEGER`: a 16-digit id could
  round to a different row's id. The column is read with Drizzle's `bigint({ mode: 'number' })`. One transaction: `lockActiveOperate`, then `lockById`. No row →
  `404 token_not_found`. Already revoked → `200` with the row unchanged. Target active and
  `operate`, and the only active `operate` row → `409 last_operate_token`. Otherwise `markRevoked`,
  `200` with the revoked row. A token MAY revoke itself unless it is the last `operate` one.

Authority: the four api-contract entries; data-modeling (`api_tokens`); [read-api.md](../../.agents/skills/pp-backend/references/read-api.md).

**D22 — `createApi` deps and error mapping.** `ApiDeps` becomes `{ db, logger, addressHashKey,
tokenTagKey, requestId: (c: Context) => string, queueAttributes, eventSource, workerInvoke,
storageLimitBytes }`. `requestId` takes the Hono context, matching Hono 4.13.13's `generator?: (c: Context) => string`:
`apps/api` returns `c.env.lambdaContext.awsRequestId` (`@hono/aws-lambda` 1.0.1 passes
`{ event, requestContext, lambdaContext }` as the env), `apps/local` `crypto.randomUUID()`. The
`415` / malformed-JSON mapping in `onError` names the body per route (§12), keyed by the matched
route's path. Authority: [pp-backend → read-api](../../.agents/skills/pp-backend/references/read-api.md).

**D23 — `apps/api` and the shared contract suite.** `api.handler.ts` serves
`handle(app)` from `@hono/aws-lambda`; the app is built on the first invocation from the memoized
database secret (D32). The SDK ↔ API contract cases move into `@ledger/api/testing` as
`readApiContract(name, make)` ([shared contract suites](../../.agents/skills/pp-testing/references/vitest-layout.md#shared-contract-suites):
"the same app object passes the same contract tests under `@hono/node-server` and through the
Lambda adapter"; [pp-testing](../../.agents/skills/pp-testing/SKILL.md) writes a shared suite when "A
second implementation of that port exists in the repo"). `apps/local/src/sdk-contract.int.test.ts` runs it
under `@hono/node-server`; `apps/api/src/api-lambda-contract.int.test.ts` runs it through the
`@hono/aws-lambda` handler with synthetic payload-2.0 events. Authority: ADR-019 Evidence ("the same
app object passes the same contract tests … through the Lambda adapter (slice 2)").

### SDK and CLI

**D24 — SDK methods** (each `{ data, error }`, never thrown):
`ledger.health.get()`, `ledger.worker.resumeEventSource()`, `ledger.tokens.getCurrent()`,
`ledger.tokens.list({ limit?, after? })`, `ledger.tokens.create({ name, scope })`,
`ledger.tokens.revoke(tokenId: string)`. Exported types `Health`, `EventSource`, `Token`,
`CreatedToken`, `TokenList`. `FakeLedgerClient` grows the same methods. Authority:
[pp-backend → sdk](../../.agents/skills/pp-backend/references/sdk.md).

**D25 — CLI commands**, one `<noun>-<verb>.cli.ts` each, registered under plain group commands
(`worker`, `token`) made with `.command()`: `health-get.cli.ts` (`ledger health`),
`worker-resume-event-source.cli.ts` (`ledger worker resume`), `token-create.cli.ts`
(`ledger token create --name <name> --scope <read|operate>`, both `requiredOption`, strings, no
`argParser`), `token-list.cli.ts` (`ledger token list`: calls `tokens.list({ limit: 100 })`, the
contract's maximum, because the Surfaces line names no paging flag), `token-revoke.cli.ts`
(`ledger token revoke <token_id>`), `token-get-current.cli.ts` (`ledger token current`). Every one
takes `--json`. Layouts and notices in §12. Authority: [pp-cli](../../.agents/skills/pp-cli/SKILL.md)
(human layouts are each slice's).

### AWS adapters

**D26 — `packages/aws`.** Each adapter takes its SDK client from its composition root; each unit test
hands a stub with `send(command)` that records commands and answers from a script, asserting the
commands sent and the mapping of each answer, error names cited from the API Reference
([pp-testing → AWS adapters](../../.agents/skills/pp-testing/references/fakes-and-doubles.md#aws-adapters)):

| Module | Port or role | SDK calls |
| --- | --- | --- |
| `sqs-queue.adapter.ts` → `SqsQueueAdapter` | `QueuePort.enqueue` | `SendMessage` (body: the envelope JSON) |
| `sqs-queue-attributes.adapter.ts` | `QueueAttributesPort` | `GetQueueAttributes` (visible, not visible) ×2; CloudWatch `GetMetricStatistics` |
| `secrets-manager-secret-reader.adapter.ts` | `SecretReaderPort` | `GetSecretValue` |
| `lambda-event-source-control.adapter.ts` | `EventSourceControlPort` | `ListEventSourceMappings`, `GetEventSourceMapping`, `UpdateEventSourceMapping` |
| `lambda-function-invoke.adapter.ts` | `FunctionInvokePort` | `Invoke` (`RequestResponse`; a `FunctionError` or non-JSON payload is a constant error) |
| `kill-switch.ts` → `tripKillSwitch(clients, names)`, `restoreFromTrip(clients, names, declared)` | The trip and restore steps the kill switch, the re-arm and the drill share (D29, D35) | Lambda `ListFunctions`, `GetFunctionConcurrency`, `PutFunctionConcurrency`, `DeleteFunctionConcurrency`; the mapping calls; `apigatewayv2` `GetApis`, `GetStage`, `UpdateStage`, `DeleteRouteSettings`; SNS `Publish` |
| `stack-outputs.ts` | Script-only | CloudFormation `DescribeStacks` |
| `secret-writer.ts` | Script-only (deploy step 9) | `GetSecretValue`, `PutSecretValue` |
| `post-destroy-listing.ts` | Script-only (teardown) | Tagging `GetResources`; Secrets Manager `DescribeSecret` (a pending deletion is not billable, [Teardown](../aws.md#teardown)); Logs `DescribeLogGroups` (`/aws/lambda/LedgerApp-`, `/ledger/`) |
| `budget-spend.ts` | Script-only (re-arm) | Budgets `DescribeBudget` → `CalculatedSpend.ActualSpend` |
| `alarm-control.ts` | Script-only (drill) | CloudWatch `SetAlarmState`, `DescribeAlarms`; SNS `Publish`; Lambda `Invoke` (`Event`) |

A call only a script makes uses the concrete module: one implementation is no reason for a port
([pp-infra → scripts](../../.agents/skills/pp-infra/references/scripts.md#shape)).

### Infra

**D27 — The app stack** (`LedgerApp`; every value a named constant commented with its `AWS-NN`):

- **Functions** through one shared construct, `LedgerFunction` (`ledger-function.construct.ts`):
  `NodejsFunction`, local esbuild, `format: ESM`, `target: 'node24'`, `bundleAwsSDK: true`,
  `Runtime.NODEJS_24_X`, `Architecture.ARM_64`, an explicit `LogGroup` named `/ledger/<function name>`
  (30 days, `DESTROY`), `loggingFormat: TEXT` (D31), physical name `<stack>-<fn>`, no VPC, no reserved
  concurrency. Initial sizes, revisited from the first measured `REPORT` lines (CBL-21, slice 3):

  | Function | Name | Memory | Timeout | Why the timeout |
  | --- | --- | --- | --- | --- |
  | ingest | `LedgerApp-ingest` | 256 MB | 10 s | Under Svix's 15 s delivery timeout (RS-10) and API Gateway's 30 s (AWS-02) |
  | worker | `LedgerApp-worker` | 512 MB | 60 s | The outage path fits with margin: one query timeout (15 s), the fresh connection (≤ 5 s) and the retry's query timeout (15 s) is 35 s, so D15 step 3's pause always runs before the function times out. A healthy batch of ten short transactions takes far less; a timeout anyway (a slow, not down, database) fails the whole batch, redelivered and absorbed on `svix_id` (AWS-05). Feeds the visibility timeout (AWS-08) |
  | read API | `LedgerApp-api` | 256 MB | 25 s | Under the 30 s integration cap (AWS-02). A classified database error ends every request at its first database attempt (D18, D19), so one connect (5 s) plus one query (15 s) is the worst case; the resume invoke is one probe of the same size (D16) |

- **Queues:** source retention 13 days, DLQ 14 days (AWS-07, AWS-09), SSE-SQS (no key, AWS-25),
  `maxReceiveCount` 5, visibility timeout `6 × 60 + 0 = 360` s derived in code (AWS-08). No physical
  names.
- **Mapping:** batch size 10, no batching window, `ReportBatchItemFailures`,
  `MaximumConcurrency: 5` (≥ 2, AWS-04; below any new-account quota AWS-U05 reads; five size-1 pools
  against Neon's pooler). The burst's drain time is slice 3's measurement.
- **HTTP API** `LedgerApp-http`: `POST /webhooks/resend` → ingest; `$default` → read API (mirroring
  `apps/local`'s split). A `$default` stage with `throttle: { rateLimit: 100, burstLimit: 200 }`
  (D30). The default `execute-api` endpoint is the URL.
- **Secrets:** `ledger/webhook-signing-secrets` and `ledger/database`, no physical name, `DESTROY`, no
  value in the template (CDK's generated placeholder until the deploy command writes the value; until
  then ingest answers `503` and the worker and API fail to parse it). Each function gets
  `grantRead` on its own secrets only.
- **Schedule:** one EventBridge Scheduler schedule `LedgerApp-hourly`, `cron(0 * * * ? *)`, flexible
  window `OFF`, retry policy `MaximumRetryAttempts: 0`, `MaximumEventAgeInSeconds: 60` (the next tick
  supersedes a missed one, AWS-10), target the worker with `{ "ledger": "resume-event-source" }`.
- **Usage-trip alarm** `LedgerApp-usage-trip` (D30), here because it needs the API id, which the
  guardrails stack cannot import. Its action is the trip topic's ARN built with `formatArn` from the
  topic's fixed name: a constructed ARN, not a cross-stack reference.
- **IAM** by grants, plus: ingest `sqs:SendMessage` on the source queue; the read API
  `sqs:GetQueueAttributes` on both queues, `cloudwatch:GetMetricStatistics` (`*`, no resource-level
  form), `lambda:InvokeFunction` on the worker, `lambda:ListEventSourceMappings` (`*`) and
  `lambda:GetEventSourceMapping` on `event-source-mapping:*` with the `lambda:FunctionArn` condition;
  the worker the same mapping calls plus `UpdateEventSourceMapping`. Every function ARN in a policy is
  built with `formatArn` from its physical name, never a `Ref`, so a function's policy never cycles
  back to itself.
- **Outputs:** `DeployedCommit`, `ApiUrl`, `SigningSecretsArn`, `DatabaseSecretArn`, `QueueUrl`,
  `DlqUrl`, `WorkerFunctionName`, `ThrottleRateLimit`, `ThrottleBurstLimit`.
- **Tag:** `Tags.of(app).add('ledger-project', 'ledger')` once in `infra/src/main.ts`.

Authority: ADR-008 (batch, `ReportBatchItemFailures`, `maxReceiveCount`), ADR-010 (no VPC, two
stacks), each value's `AWS-NN` as cited; [aws.md → Budget alarms](../aws.md#budget-alarms) items 1
and 7 (stack-prefixed names, the throttle, the usage trip); [pp-infra → cdk-app](../../.agents/skills/pp-infra/references/cdk-app.md).

**D28 — The guardrails stack** (`LedgerGuardrails`; imports nothing from the app stack):

- **Topics**, unencrypted ([AWS-35](../aws.md#aws-budgets-and-cost-anomaly-detection)), fixed names:
  `LedgerGuardrails-trip` (the kill switch subscribes) and `LedgerGuardrails-alert`. Each topic policy
  grants `SNS:Publish` to `budgets.amazonaws.com` and to `cloudwatch.amazonaws.com`, conditioned on
  `aws:SourceAccount`. CloudWatch is granted explicitly whatever the default policy would allow,
  because a CDK topic policy replaces the default one; the drill's alarm-driven trip (D36) proves
  the path. With
  `LEDGER_ALERT_EMAIL` set, it subscribes to both topics (two confirmations, CBL-03).
- **Budget** `LedgerGuardrails-monthly`: plain, monthly, cost, `CostTypes.IncludeCredit: false`
  (AWS-52), limit `LEDGER_BUDGET_USD` (default 50). Notifications (4 of AWS-33's 5): ACTUAL 50 %,
  ACTUAL 80 %, FORECASTED 100 % → alert topic; ACTUAL 100 % → trip topic (C17).
- **Drill budget** `LedgerGuardrails-drill`, only with `--budget-drill`: ACTUAL, `ABSOLUTE_VALUE`
  `0.01` → trip topic. The real budget keeps its once-a-month alert (C14).
- **Kill switch**: `LedgerGuardrails-kill-switch`, the shared construct, 256 MB, 60 s. Always
  deployed. With `LEDGER_KILL_SWITCH=on`, the trip topic's Lambda subscription to it exists; without,
  none. Output `KillSwitchArmed` (`true` / `false`) is what CBL-16 reads.
- **Alarm** `LedgerGuardrails-kill-switch-errors`: `Errors > 0`, one 60 s period, `notBreaching`,
  action → alert topic ([Budget alarms](../aws.md#budget-alarms) item 4).
- **Outputs:** `KillSwitchArmed`, `TripTopicArn`, `AlertTopicArn`, `KillSwitchFunctionName`.
- **Region:** the deploying credentials' region (us-east-2). AWS-U01's fallback stays behind its
  tripwire (§3).

Alarms across both stacks: two, inside AWS-28's ten free. Authority: [aws.md → Budget alarms](../aws.md#budget-alarms)
items 1–5; [pp-infra → The guardrails stack](../../.agents/skills/pp-infra/references/cdk-app.md#the-guardrails-stack)
("Where the kill switch's code lives … the slice 2 pre-proposal settles it … Where the usage-trip
alarm lives (item 7) is slice 2's too").

**D29 — The kill switch's home and steps.** `apps/kill-switch` (`@ledger/app-kill-switch`, a new
Projects row): `kill-switch.handler.ts` accepts an SNS event (any message on the trip topic trips; a
non-SNS payload throws a constant, which the drill uses) and calls `tripKillSwitch` from
`packages/aws` (D26), so the re-arm and slice 3's burst step reuse the same steps. In order, each
reading the current state first so a re-run is safe:

1. Disable the worker's mapping (found through `LedgerApp-worker`, D16).
2. `PutFunctionConcurrency` `0` on every function whose name starts `LedgerApp-` (`ListFunctions`),
   so later slices' functions are covered with no edit (C18).
3. On `LedgerApp-http`'s `$default` stage: `DefaultRouteSettings` throttle `0` / `0`, and every
   existing `RouteSettings` entry `0` / `0`.
4. Publish what it changed (function names, states, throttle values; no id, URL or account) to the
   alert topic.

IAM: `lambda:ListFunctions` (`*`); concurrency calls on `function:LedgerApp-*`; mapping calls as D27
(condition on the worker's ARN); `apigateway:GET` on `arn:aws:apigateway:<region>::/apis` and
`…::/apis/*/stages/*`, `apigateway:PATCH` on `…::/apis/*/stages/*` (the AWS-U11 shape, commented as
wider than an id-scoped grant); `sns:Publish` on the alert topic. Its own function and the guardrails
stack are exempt. Authority: [Budget alarms](../aws.md#budget-alarms) item 4;
[pp-infra → scripts → Shape](../../.agents/skills/pp-infra/references/scripts.md#shape) ("the trip
and restore steps the kill switch, the re-arm and the burst's throttle raise share (home: slice 2)").

**D30 — Throttle, usage trip and the overshoot bound.**

- Steady `$default` throttle: rate 100 rps, burst 200 ([Budget alarms](../aws.md#budget-alarms)
  item 7: "order of 100 rps"). Kill-switch stop values: `0` / `0`; if `UpdateStage` rejects `0`, the
  lowest accepted value, recorded with its worst-case spend (AWS-U02's fallback).
- Usage trip: HTTP API `Count` (vended, AWS-30), `Sum` over 900 s, threshold 15,000 requests, one
  evaluation period, `notBreaching`. It admits one burst (≈ 12k, item 7) with headroom.
- Worst-case cost per accepted request, from the facts: API Gateway USD 1.0 × 10⁻⁶ (AWS-15); ingest
  invocation and 256 MB × 0.1 s (AWS-20) ≈ 0.53 × 10⁻⁶; SQS send plus batched receive and delete
  ≈ 0.48 × 10⁻⁶ (AWS-24); a tenth of a 512 MB worker invocation at 50 ms per event ≈ 0.36 × 10⁻⁶;
  ≈ 1 KB of log ingest ≈ 0.5 × 10⁻⁶ (AWS-29). So **c ≈ USD 3 × 10⁻⁶**.
- Above the threshold, a flood at the throttle cap trips within one alarm period plus evaluation
  (≤ 20 min): ≤ 120k requests ≈ USD 0.36.
- Just under the threshold, a sustained flood spends ≤ 60k requests/h ≈ USD 0.18/h until the budget
  trip, which lags by up to a day of billing data plus 12 h (AWS-34): ≤ 36 h ≈ **USD 6.5 above the
  cap**. The change states the inputs and this bound in [Budget alarms](../aws.md#budget-alarms)
  item 7 (§22).

**D31 — `LoggingFormat.TEXT`** on every function, no application or system level filter set. The
logger writes one JSON object per line, which CloudWatch Logs Insights parses as fields, and EMF
written with `process.stdout.write` is parsed under TEXT
([AWS → Node.js logging](https://docs.aws.amazon.com/lambda/latest/dg/nodejs-logging.html)). Under
TEXT no level filter applies, so Winston's lowercase levels cannot be dropped (C15). Authority:
[pp-infra → Function configuration](../../.agents/skills/pp-infra/references/cdk-app.md#function-configuration)
("Slice 2 sets them together with pp-general's level-filter `[Unverified]` row").

**D32 — Bundling checks.**

- `esbuild` is a root devDependency, and `infra/src/esbuild-installation.test.ts` resolves it from
  the repo root, so a missing one fails `pnpm verify` instead of silently bundling in Docker (AWS-55).
- **Bundle smoke check** (`infra/src/bundle-smoke.test.ts`, unit): synthesize both stacks, then for
  each function asset set the function's internal variable names to dummy values, `import()` its
  `index.mjs`, and assert `typeof handler === 'function'`. It settles the `require()`-in-ES-module
  and `pg-native` bullets: a failure adds esbuild's `createRequire` banner, or marks `pg-native`
  external, only then ([pp-infra → Bundling](../../.agents/skills/pp-infra/references/cdk-app.md#bundling)).
- So that import needs no AWS access, each root parses its config and builds its clients at module
  scope, but reads its secrets and builds its pool on the first invocation, through one memoized
  promise per container: still built once per container, reused by every warm invocation.
- `@aws-cdk/aws-lambda:useCdkManagedLogGroup: true` stays; the explicit-log-group assertion proves
  every function uses its own group ([cdk-app.md → Layout](../../.agents/skills/pp-infra/references/cdk-app.md#layout)).

### Scripts

**D33 — `pnpm aws:deploy`** (`infra/scripts/deploy.ts` composes; `infra/scripts/run-deploy.ts`
sequences with injected steps, so order and fail-closed behavior are unit-tested with fakes). Inputs:
the env vars of §18, the context keys `ledger:commit`, `ledger:alertEmail`, `ledger:budgetUsd`,
`ledger:killSwitch`, `ledger:budgetDrill` passed as `-c key=value`, and the CDK CLI spawned as
`spawn(process.execPath, [require.resolve('aws-cdk/bin/cdk'), …])` (aws-cdk 2.1145.0 exports
`./bin/cdk`; no shell). Before step 1, the inputs are parsed with Zod, the boot-time assertion
([pp-general → config-and-env](../../.agents/skills/pp-general/references/config-and-env.md)):
`LEDGER_DEPLOY_DATABASE_URL`, `LEDGER_DEPLOY_DATABASE_POOLED_URL` and `LEDGER_ALERT_EMAIL` required;
`LEDGER_ADDRESS_HASH_KEY` and `LEDGER_TOKEN_TAG_KEY` required as 64 lowercase hex. A missing or
malformed one refuses, naming the variable, never its value; for either key the reason adds `run
pnpm db:setup once to generate it`. The deploy command never generates a key: the address-hash key
"is generated once by the setup script, and is placed in the `ledger/database` secret by the deploy
command" ([data-modeling.md → PII & retention](../data-modeling.md#pii--retention)), and a key made
per deploy would orphan every stored hash. `pnpm db:setup` writes both keys before it touches a
database, so it generates them on a machine with no local Postgres too (it then ends `db:setup:
failed: Postgres is unreachable …`, which root AGENTS.md → Commands says to expect beside
`pnpm aws:deploy`, §22). Steps, each fail-closed:

1. Refuse a working tree with tracked changes (`git status --porcelain --untracked-files=no`), so
   `DeployedCommit` names the code deployed.
2. Read the stacks (`stack-outputs.ts`): if the app stack exists, refuse while tripped (the worker's
   reserved concurrency reads `0`; "run `pnpm aws:rearm` first"), and record whether the worker's
   mapping is paused.
3. Refuse a disarming deploy: `KillSwitchArmed` is `true` and `LEDGER_KILL_SWITCH` is not `on`
   (CBL-16, lens clause 1).
4. Refuse an unsafe contract step: for each `pendingContractSteps` SHA, `git merge-base
   --is-ancestor <SHA> <DeployedCommit>`; any exit but 0 refuses. Skipped with no app stack
   ([pp-infra → Deploy](../../.agents/skills/pp-infra/references/scripts.md#deploy) step 2).
5. `cdk synth` with the context, then CBL-01's grep over `cdk.out/`
   (`whsec_|re_[A-Za-z0-9]{8}|postgres(ql)?://|ldg_[0-9a-f]{20}`); a hit refuses.
6. `prepareDatabase` through `LEDGER_DEPLOY_DATABASE_URL`, with D10's role timeouts. The password:
   when the database secret exists and parses, its `pooledUrl`'s password is reused
   (`resetPassword: false`); otherwise a new 24-byte hex password, `resetPassword: true`. No running
   function can hold a working connection then, because the secret it would read does not parse.
7. Refuse an address-hash key whose `key_id` differs from `storedAddressHashKeyId` (D12), before the
   key is written anywhere.
8. `cdk deploy LedgerGuardrails`, then `cdk deploy LedgerApp`, `--require-approval never` (the run
   itself is the owner's Ask-first approval).
9. Write `ledger/database` (`{ pooledUrl, addressHashKey, tokenTagKey }`; `pooledUrl` is
   `LEDGER_DEPLOY_DATABASE_POOLED_URL` with `ledger_runtime:<password>` as credentials and
   `sslmode=require`), and `ledger/webhook-signing-secrets` when `LEDGER_DEPLOY_WEBHOOK_SECRETS` is
   set, each only when it differs from the stored value (`secret-writer.ts`). Values never pass
   through CDK (CBL-01).
10. `insertBootstrapIfAbsent` through the direct URL (D8); print the token once, only when inserted.
    `--issue-operate-token <name>` also inserts and prints one more `operate` token.
11. Restore a pause recorded in step 2. It runs whenever step 8 started, also when step 8 failed
    (AWS-U09).
12. Print the API URL, the ingest URL (`<ApiUrl>/webhooks/resend`) and `KillSwitchArmed`.

Authority: ADR-018; [pp-infra → Deploy](../../.agents/skills/pp-infra/references/scripts.md#deploy)
steps 1–9 and its two recommendations (CBL-01 grep, CBL-16 refusal), both adopted.

**D34 — `pnpm aws:teardown`** (`teardown.ts` / `run-teardown.ts`): read the queue URLs from the app
stack's outputs; when the source queue or the DLQ holds any visible or in-flight message, refuse
unless `--discard-queued`; `cdk destroy LedgerApp --force`; only when it succeeded,
`cdk destroy LedgerGuardrails --force`; then `post-destroy-listing.ts`, exiting non-zero on a
billable leftover (a secret pending deletion is not one); finally print the two steps outside AWS:
delete the Resend webhook, and optionally the Neon project. Authority: [aws.md → Teardown](../aws.md#teardown);
[pp-infra → Teardown](../../.agents/skills/pp-infra/references/scripts.md#teardown).

**D35 — `pnpm aws:rearm`** (`rearm.ts`): `restoreFromTrip` (D26): `DeleteFunctionConcurrency` on
every `LedgerApp-*` function, enable the worker's mapping, restore the `$default` throttle from the
`ThrottleRateLimit` and `ThrottleBurstLimit` outputs, delete every `RouteSettings` entry (the stack
declares none). Then read the budget's `ActualSpend` (`budget-spend.ts`) and warn when it is at or
above the limit (the usage trip is then the only re-armable trigger this month, item 6). Last, print
`then: ledger reconcile → slice 4`. AWS-U10 settles at apply by reading the Budgets and Cost Explorer
pricing pages before the script lands; the design reads the budget, which the row expects to be free.
Authority: [Budget alarms](../aws.md#budget-alarms) item 6.

**D36 — `pnpm aws:trip-drill`** (`trip-drill.ts`), one recorded run. It refuses unless
`KillSwitchArmed` is `true` and the stack is not tripped. Steps:

1. `SetAlarmState` `LedgerApp-usage-trip` → `ALARM`: proves alarm → trip topic → kill switch.
2. Poll, up to 5 minutes, for D29's end state: mapping disabled, every `LedgerApp-*` concurrency
   `0`, the stage throttle at its stop values. That the `UpdateStage` succeeded under D29's grant
   settles AWS-U11.
3. Send five unsigned `POST`s to the ingest URL and record the status codes (AWS-U02: expect `429`
   from API Gateway). The billing half of AWS-U02 is read later in Cost Explorer (owner, §25).
4. Invoke the kill switch asynchronously with a non-SNS payload, which it rejects; poll
   `LedgerGuardrails-kill-switch-errors` until `ALARM` (item 8's forced failure).
5. `restoreFromTrip`, then poll for the restored state.
6. Print `reconcile → slice 4` (C7) and a summary without any id or URL.

The recorded trip drill Ships 7 names has two parts, recorded together in the walk (§21 path G).
This script is the alarm part, run in minutes. The budget part settles AWS-U01 and runs on its own
clock, because a budget refresh takes hours (AWS-34): `pnpm aws:deploy --budget-drill`, wait for
the drill budget's notification (the trip email, then the kill switch's report), `pnpm aws:rearm`,
then `pnpm aws:deploy` without the flag, which removes the drill budget.
Authority: [Budget alarms](../aws.md#budget-alarms) item 8; [pp-infra → Trip drill](../../.agents/skills/pp-infra/references/scripts.md#trip-drill).

**D37 — `pnpm aws:db-check --email-id <id> [--idle-minutes <n>]`** (`db-check.ts`): reads
`ledger/database` (the runtime role's pooled URL) and runs, through `packages/db` functions only:

1. **PG-U06:** `SHOW idle_in_transaction_session_timeout` and `SHOW lock_timeout` through the pooled
   URL; prints them against D10's values.
2. **PG-U02:** two size-1 pools through the pooled URL. A opens a transaction and `lockEmail`s the
   email (`SELECT … FOR UPDATE`, no write) and holds it 2 s; B does the same and records its wait.
   B waiting until A commits is the pass. It writes nothing; the email is the verify send's.
3. **PG-U04** (only with `--idle-minutes`, at least 6, past Neon's 5-minute suspend): one connection
   idles, then queries; prints success, or the classified error name.

The card says "a deployed test"; a script keeps the walk free of SQL ([walkthrough format → Coverage](../../.agents/skills/rsa-manual-test/references/walkthrough-format.md#coverage))
and makes the check repeatable after any Neon change.

**D38 — The `migrations` verify stage** (`scripts/migration-lint.mjs`, Node built-ins, after
`lint`): a canary first, an in-memory `ALTER TABLE t DROP COLUMN c;` that must fail and a marked copy
that must pass; then every `packages/db/drizzle/*.sql`. A statement matching `\bDROP\b`, `\bRENAME\b`,
`\bALTER\b[^;]*\bTYPE\b` or `\bSET\s+NOT\s+NULL\b` (case-insensitive, `--` comments stripped) fails
unless line 1 is `-- contract-step: <40-hex SHA>` or `-- contract-step: replace: <name>, <widen|narrow>`.
It prints `migrations: canary caught 1/1` and `migrations: <n> checked, <k> unmarked`. Authority:
ADR-018; [the marker](../../.agents/skills/pp-database/references/migrations-and-grants.md#the-contract-step-marker).

**D39 — The gitleaks rule.** `.gitleaks.toml` gains `ledger-api-token`, regex
`ldg_[0-9a-f]{64}_[0-9a-f]{64}`; `secret-scan.mjs`'s canary gains one fake token of that shape.
CBL-10's grep already names `ldg_`. Authority: the decision lens, clause 6 (security exposure):
slice 2 is the first to mint a credential that can read the ledger; [check-before-launch.md](../check-before-launch.md)
CBL-10.

### Local mode

**D40 — `apps/local`.** `local.config.ts` requires `LEDGER_TOKEN_TAG_KEY` (64 lowercase hex). The
composition adds the auth middleware's key; `InProcessQueueAdapter` as `QueueAttributesPort` (it
gains `enqueuedAt` per message: `visible` = messages waiting, `inFlight` = messages delivering,
`oldestAgeSeconds` from the oldest `enqueuedAt`, `dlqVisible` = the dead list, `dlqInFlight` 0);
`StaticEventSourceControlAdapter`; `StaticSecretReaderAdapter` over the parsed
`LEDGER_WEBHOOK_SECRETS` (D13); and `InProcessFunctionInvokeAdapter` over the local worker's
`resume`, which answers `already_enabled`. `--host` stays loopback-only; its refusal line drops
"because local mode skips auth" and reads `refusing to start: --host must be 127.0.0.1, ::1 or
localhost`. Slice 2B decides the bind for `docker compose`. Authority: C6, C10, ADR-013.

**D41 — `pnpm db:setup`.** `localEnvNames` gains `LEDGER_TOKEN_TAG_KEY` (32 random bytes, 64 hex),
written once and never overwritten. After `prepareDatabase`, `LEDGER_TOKEN` is (re)written only when
it is empty, equals `local-loopback-no-auth`, fails `hasValidTag` under the file's tag key, or matches
no active row: setup inserts a bootstrap `operate` token (`insertBootstrapIfAbsent`), or, when a
bootstrap row already exists, an `operate` token named `local-setup`, and writes its plaintext. It
prints `db:setup: wrote LEDGER_TOKEN to .env.local`, never the value. Locally the token is inserted
as the owner (`DATABASE_URL`), as slice 1's D30 connects locally. Authority: C9; slice 1 D27.

### `[Unverified]` rows and experiments

**D42 — How each owed row closes:**

| Row | Closes by | Kind |
| --- | --- | --- |
| AWS-U01 | Guardrails deploy succeeds in us-east-2, then the `--budget-drill` notification reaches email and trips the kill switch (D36) | MUST settle |
| AWS-U02 | Drill step 3's status codes; the billing half from Cost Explorer's API Gateway usage after the drill day | MUST settle |
| AWS-U11 | The Service Authorization Reference for API Gateway read at apply, then drill step 2's throttle update succeeding under D29's grant | MUST settle |
| PG-U01 | Neon's docs read at apply; Neon support if they are silent (owner op, §25) | MUST settle |
| PG-U02 | `pnpm aws:db-check` step 2 | MUST settle |
| PG-U06 | `pnpm aws:db-check` step 1 | MUST settle |
| AWS-U03 | Safe either way: ≤ USD 0.26/month at five pollers (the row); the 30-day measurement is CBL-18's | Safe |
| AWS-U04 | The verify delivery's `body_base64_count` (D44); the decode is unit-tested both ways | Settle |
| AWS-U05 | `aws lambda get-account-settings` before the first deploy; the quota recorded in aws.md with no account id | Settle |
| AWS-U06 | Listing the two secrets after the teardown drill (§21 T-path) | Settle |
| AWS-U07 | Safe either way (≤ USD 0.30/month at idle); the first bill is CBL-18's | Safe |
| AWS-U09 | Safe either way: deploy-command tests for the tripped refusal and the pause restore (C13) | Safe |
| AWS-U10 | The pricing pages read before `rearm.ts` lands; the budget read (D35) | Settle |
| AWS-U12 | Safe either way: every handler's catch-at-edge unit test (D14, D17) | Safe |
| PG-U04 | Safe either way (a connection error is retryable, D15); `--idle-minutes 6` observes it on the deploy | Safe |
| Library bullets | Identity on `bigint` and the sequence grant: the `api_tokens` repository test inserting as `ledger_runtime`; `pg`'s code-less errors: D9's classifier test plus PG-U04; CDK bundling: D32's tests; synth without an account: `pnpm synth` in CI; CDK CLI entry: `aws-cdk/bin/cdk` (read 2026-10-17); Cost Explorer read cost: AWS-U10; Lambda level filter: moot under TEXT (C15) | Settle |

Authority: [architecture.md → Open questions owed by slice](../architecture.md#open-questions-owed-by-slice)
row 2 (which rows MUST settle and which MAY close safe under both answers); each row's own "What
would settle it" in [aws.md](../aws.md#unverified) and [integrations.md](../integrations.md#unverified).
PG-U01's wording: the row asks about "a project that a scheduled tick touches hourly", but slice 2's
kept deploy opens no connection on an idle hour (R8) until slice 4's reconciler writes a
`reconcile_runs` row each hour. The question put to Neon's docs or support is therefore what counts
as activity, and whether an idle project is deleted, not only whether hourly ticks suffice (§24).

**D43 — RS-U07 is proved safe by the exact-`200` contract**, with no experiment and no live write.
Ingest answers `401` only for a request no configured secret verifies, and every infrastructure fault
(an unreadable or empty secret set, a failed enqueue) answers `503` (D13), so a `401` happens only
when the secret is wrong. If a `401` stops Resend's retries, those deliveries are missed and recovered
by `ledger reconcile` (slice 4) within List Events reach; if it does not, the retries end on their own
or auto-disable the webhook (RS-11), which the reconciler detects (ADR-007). Both readings end on the
path ADR-001 already prescribes: fix the secret, re-enable, reconcile. Evidence:
`create-ingest.test.ts`'s `503` cases for the secret read and the enqueue. Authority: Ships 14 (it
allows "proved safe by the exact-`200` contract"); lens clause 2 (reversible-cheap).

**D44 — The verify stage.** After the webhook exists (Ask-first) and its secret is placed by a
redeploy: one Ask-first send from the owner's account to `delivered@resend.dev`; `ledger email <id>`
shows `delivered`; `ledger health` shows `queue 0 visible, 0 in flight` and `dlq 0 visible`; the
ingest log line `ingest.request_decoded` for that delivery shows `body_base64_count`, which settles
AWS-U04 in aws.md (AWS-01's rule becomes a fact). Authority: [features.md → verify](../features.md#adopter-lifecycle).

## 8. Data model

**Schema authority:** the Drizzle schema in `packages/db` owns table and column shape; migrations are
expand/contract only ([data-modeling.md → How to use](../data-modeling.md#how-to-use)). This section
is **Ask-first**, approved in §7 ("Schema").

### `api_tokens` — `packages/db/src/schema/api-tokens.ts`

Credential record; insert, then revoke once ([Model index](../data-modeling.md#model-index)).

| Column | Type | Null | Default / constraint | Notes |
| --- | --- | --- | --- | --- |
| `id` | `bigint GENERATED ALWAYS AS IDENTITY` | no | `api_tokens_pkey` | `token_id` on the wire; keyset page key (served by the PK) |
| `name` | `text` | no | — | The operator's label; validated by the API (D21) |
| `token_hash` | `text` | no | `api_tokens_token_hash_key` UNIQUE | SHA-256 hex of the token; a collision guard only |
| `bootstrap` | `boolean` | no | `false`; partial unique index `api_tokens_bootstrap_key` on `(bootstrap) WHERE bootstrap` | The deploy command's and setup's first `operate` token |
| `scope` | `text` | no | `api_tokens_scope_check` `CHECK (scope in ('read', 'operate'))` from `tokenScopes` | ADR-011 |
| `revoked_at` | `timestamptz` | yes | — | Null while active. Set once |
| `created_at` | `timestamptz` | no | `now()` | Base field |
| `updated_at` | `timestamptz` | no | `now()` | Base field (C11); set by `markRevoked` |

- **Idempotency key:** `api_tokens_bootstrap_key`. `insertBootstrapIfAbsent` is `INSERT … ON
  CONFLICT DO NOTHING`; a duplicate returns no row, so nothing is printed
  ([Idempotency keys](../data-modeling.md#idempotency-keys)). `token.create` is deliberately not
  idempotent ([token.create](../api-contract.md#tokencreate)).
- **Indexes:** the PK (lookups by id, keyset pages), the `token_hash` unique key (the middleware's
  `findActiveByHash`), the partial bootstrap index. No other.
- **No foreign key, no trigger, no `tenant_id`, no `deleted_at`, no plaintext** ([Anti-patterns](../data-modeling.md#anti-patterns-must-not)).
- **PII:** none (token hashes only).

**Migrations**, in order, both pure expand, carrying no contract-step marker:

1. `0002_create-api-tokens.sql`: `pnpm db:generate --name create-api-tokens`, read before commit.
2. `0003_grant-api-tokens.sql`: `pnpm db:generate --custom --name grant-api-tokens`:
   `GRANT SELECT, INSERT, UPDATE ON "api_tokens" TO "ledger_runtime";`. If the identity insert as
   `ledger_runtime` fails on the sequence (the library bullet), the same migration adds
   `GRANT USAGE ON SEQUENCE api_tokens_id_seq TO "ledger_runtime";`, regenerated before it freezes.

No backfill. `0000` and `0001` are frozen (merged to `main`) and untouched.

**Role-level settings** (not schema, D10): `ALTER ROLE ledger_runtime SET
idle_in_transaction_session_timeout = '5s'` and `SET lock_timeout = '10s'`, re-run on every deploy.

## 9. State machines and transitions

No projection changes: `projectEmail` and `projectRecipient` are untouched, and no outbox row is
written (slice 6).

**Worker event source** (the mapping's `Enabled`, AWS-18; reported as `eventSourceStates`, D4):

| From | Event | To | Who |
| --- | --- | --- | --- |
| `enabled` | Connection-class failure twice in one message (D15) | `paused` | The worker |
| `paused` | Hourly schedule or `worker.resumeEventSource`; probe succeeds, storage below threshold | `enabled` | The worker's `resume` |
| `paused` | Probe fails | `paused` (unchanged) | — |
| any | Kill switch trips | `paused` (and every app function at concurrency `0`) | The kill switch |
| any | `pnpm aws:rearm` | `enabled` | The re-arm |
| `paused` | `pnpm aws:deploy` | `paused` kept (step 11 restores it) | The deploy command |

Transient Lambda states read as `changing`. A tripped stack cannot resume itself: its resume
invocations are throttled at concurrency `0` (ADR-015).

**Token:** `active` (`revoked_at` null) → `revoked` (terminal). `token.revoke` on a revoked token
returns it unchanged. The last active `operate` token cannot be revoked (`409`).

**Kill switch** (owner's deployment): `disarmed` (no subscription) or `armed` → `tripped` (the four
steps of D29 applied) → `armed` (re-arm). A deploy refuses `tripped` and refuses `armed` → `disarmed`.

## 10. Backend surface

Paths as [api-contract.md](../api-contract.md) names them; nothing new is named here.

| Operation | Kind | Semantics | In → Out | Scope | Idempotency | Surfaces | New? |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `health.get` → `GET /health` | read | Queue, DLQ, event source, database (D19) | none → `health` | `read` | Idempotent; answers during an outage | `ledger.health.get` · `ledger health` · no MCP | **new** |
| `worker.resumeEventSource` → `POST /worker/resume` | command | ADR-015 resume on demand (D20) | none → `event_source` | `operate` | Idempotent; no-op on `enabled` | `ledger.worker.resumeEventSource` · `ledger worker resume` · no MCP | **new** |
| `token.create` → `POST /tokens` | command | Mint; plaintext once (D21) | `{ name, scope }` → `token` + `token` field | `operate` | **Not** idempotent; the SDK never retries it | `ledger.tokens.create` · `ledger token create` · no MCP | **new** |
| `token.list` → `GET /tokens` | read | Active and revoked, newest first | `limit`, `after` → list of `token` | `operate` | Idempotent | `ledger.tokens.list` · `ledger token list` · no MCP | **new** |
| `token.revoke` → `POST /tokens/{token_id}/revoke` | command | Set `revoked_at` (D21) | `token_id` → `token` | `operate` | Idempotent | `ledger.tokens.revoke` · `ledger token revoke` · no MCP | **new** |
| `token.getCurrent` → `GET /tokens/current` | read | The caller's row | none → `token` | `read` | Idempotent | `ledger.tokens.getCurrent` · `ledger token current` · no MCP (slice 5's MCP reads it at startup) | **new** |
| `email.get`, `recipient.get` | read | Unchanged, now behind auth | — | `read` | — | — | existing (gain `401`) |

No operation calls Resend.

## 11. Async — outbox, jobs, webhooks

- **Outbox:** `Not touched — no reaction rule exists before slice 6.`
- **SQS consumer:** the worker's mapping (D27). Idempotency: `svix_id`, never the SQS `messageId`
  (ADR-004, AWS-21). At-least-once and unordered by design (ADR-002); order comes from the projection.
- **Partial batch failure:** the handler returns `batchItemFailures` exactly as `processBatch` built
  it (AWS-05, D17).
- **DLQ:** after `maxReceiveCount` 5 (AWS-09), code errors only. A database outage pauses instead
  (D15). Inspect and redrive are slice 3's.
- **Scheduled job:** one hourly schedule invoking the worker's resume (D27). Two runs cannot conflict:
  `resume` reads state first and `UpdateEventSourceMapping` is idempotent on `Enabled: true`. No
  sub-hourly schedule touches Postgres ([Cadence](../integrations.md#cadence-and-the-database)); a
  healthy stack never probes.
- **Inbound webhook:** `POST /webhooks/resend` on the deployed HTTP API: verify against the cached
  set (D13), enqueue, answer exactly `200` with the fixed body; `401` on no match; `503` on an
  unreadable set or a failed enqueue ([Ingest boundary](../api-contract.md#ingest-boundary)).
  Replays are slice 4's.
- **Synchronous invoke:** the read API → the worker's resume (D20).
- **SNS:** trip topic → kill switch (async Lambda invoke; Lambda retries twice, then discards, which
  the `Errors` alarm catches, AWS-53).
- **Retry ownership:** Resend owns delivery retries (RS-09); SQS owns redelivery; nothing in Ledger
  retries a send.

## 12. Surfaces

All JSON below is the SDK's `data` (and the CLI's `--json` stdout). Times are RFC 3339 UTC. Every
error is the [error shape](../../AGENTS.md#error-shape) with the registry's `docs`.

### `health.get` — `GET /health` → `ledger.health.get()` → `ledger health [--json]`

```json
{
  "object": "health",
  "queue": { "visible": 0, "in_flight": 0, "oldest_age_seconds": null },
  "dlq": { "visible": 0, "in_flight": 0 },
  "event_source": { "state": "enabled" },
  "database": { "reachable": true, "storage_bytes": 9437184, "storage_limit_bytes": 1000000000 }
}
```

During an outage: `"database": { "reachable": false, "storage_bytes": null, "storage_limit_bytes": 1000000000 }`,
still `200`. Human:

```text
queue       0 visible, 0 in flight, oldest —
dlq         0 visible, 0 in flight
worker      enabled
database    reachable, 9.4 MB of 1.0 GB
```

`oldest <n>s` when non-null; `database    unreachable` during an outage. Errors: `unauthorized`,
`internal_error`. `read` and `operate` tokens both see it.

### `worker.resumeEventSource` — `POST /worker/resume` → `ledger.worker.resumeEventSource()` → `ledger worker resume [--json]`

`{ "object": "event_source", "state": "changing", "resumed": true }`. Human:
`worker      changing (resumed)`, `worker      enabled (resumed)`, or `worker      enabled (already enabled)`.
Errors: `unauthorized`, `forbidden`, `database_unavailable` (probe failed) with message
**"The database is unreachable or at its storage limit, so the event source stays paused."** and the
registry hint, `internal_error`. Locally it always answers `enabled (already enabled)`.

### Token object

`{ "object": "token", "token_id": 3, "name": "review-2026-10-20", "scope": "read", "created_at": "…", "revoked_at": null }`.
Never a hash.

- **`token.create`** → `POST /tokens` → `ledger.tokens.create({ name, scope })` →
  `ledger token create --name <name> --scope <read|operate> [--json]`: `201`, the token object plus
  `"token": "ldg_…"`. Human (stdout):

  ```text
  token       3
  name        review-2026-10-20
  scope       read
  created     2026-10-20T09:00:00.000Z
  secret      ldg_…
  ```

  plus one stderr notice: `ledger: this is the only time the token is shown; store it now.` Errors:
  `unauthorized`, `forbidden`, `validation_failed`, `database_unavailable`, `internal_error`.
- **`token.list`** → `GET /tokens` → `ledger.tokens.list({ limit, after })` → `ledger token list [--json]`:
  `{ "object": "list", "has_more": false, "data": [ <token>, … ] }`. Human, one row per token:
  `  3   review-2026-10-20   read      2026-10-20T09:00:00.000Z   —` (the last column `revoked_at`
  or `—`). With `has_more`: stderr notice `ledger: more tokens exist; showing the newest 100.`
  Errors: `unauthorized`, `forbidden`, `validation_failed`, `database_unavailable`, `internal_error`.
- **`token.revoke`** → `POST /tokens/{token_id}/revoke` → `ledger.tokens.revoke(tokenId)` →
  `ledger token revoke <token_id> [--json]`: `200`, the token object. Human: the create layout
  without `secret`, plus `revoked     <time>`. Errors: `unauthorized`, `forbidden`,
  `validation_failed`, `token_not_found`, `last_operate_token`, `database_unavailable`,
  `internal_error`.
- **`token.getCurrent`** → `GET /tokens/current` → `ledger.tokens.getCurrent()` →
  `ledger token current [--json]`: `200`, the caller's token object. Human: `token`, `name`, `scope`,
  `created`. Errors: `unauthorized`, `database_unavailable`, `internal_error`.

### Error codes raised, in the [error shape](../../AGENTS.md#error-shape)

Registry defaults ([Error codes](../api-contract.md#error-codes); `packages/core/src/error-codes.ts`)
unless a row overrides:

| Code | Status | `message` | `hint` |
| --- | --- | --- | --- |
| `unauthorized` | 401 | Bearer token missing, malformed, bad-tag, unknown or revoked. | Set `LEDGER_TOKEN` to an active token. |
| `forbidden` | 403 | The token is valid but lacks the scope this operation needs. | Use an `operate` token, or ask its owner for one. |
| `validation_failed` (`name`) | 400 | name must be 1 to 64 characters from A-Z, a-z, 0-9, '.', '_' and '-', starting with a letter or digit. | Fix the field the message names, then retry. |
| `validation_failed` (`scope`) | 400 | scope must be read or operate. | Fix the field the message names, then retry. |
| `validation_failed` (`token_id`) | 400 | token_id must be a positive integer. | Fix the field the message names, then retry. |
| `validation_failed` (`limit`) | 400 | limit must be an integer from 1 to 100. | Fix the field the message names, then retry. |
| `validation_failed` (`after`) | 400 | after must be a token id, a positive integer. | Fix the field the message names, then retry. |
| `validation_failed` (`POST /tokens` body) | 400 | The request body must be a JSON object with name and scope fields. | Send Content-Type: application/json with a JSON body. |
| `token_not_found` | 404 | No token with this id. | List tokens with `ledger token list`. |
| `last_operate_token` | 409 | Revoking this token would leave no active `operate` token. | Create another `operate` token first. |
| `database_unavailable` | 503 | The database is unreachable. (resume: the override above) | The queue holds events meanwhile (ADR-015); retry, then `ledger worker resume`. `ledger health` shows storage used. |
| `internal_error` | 500 | An unexpected error occurred. | Retry; if it persists, read the API logs by request id. |
| `api_unavailable` | — (SDK) | The Ledger API did not answer with a Ledger response. | Check `LEDGER_URL`. The kill switch may be tripped: check the budget alerts, then run the re-arm script. |

`email.get` and `recipient.get` gain `unauthorized` (§10). `recipient.get`'s body message is
unchanged ("… with an address field").

### CLI behavior

Exit `0` / `1` / `2` as today. A missing `--name` or `--scope`, or a missing `<token_id>`, is
commander's usage error, exit `2`, no SDK call. `ledger token create` prints the plaintext to stdout
only, once. The `api_unavailable` path is how a tripped stack reads from the CLI (CBL-17).

### Deploy-side scripts (not operations)

Each prints names, states and the two URLs, never a secret value; the deploy command prints a token
only in step 10. Lines are prefixed with the script name (`aws:deploy: …`), and each ends with
`<script>: done` or `<script>: refused: <constant reason>` / `<script>: failed: <constant reason>`,
exit `1` for the last two. Refusal reasons are constants naming the variable or check, never a value.

## 13. Recovery paths

- **Database outage:** the worker pauses its own mapping (D15) and the queue holds events up to 13
  days (AWS-07); the hourly resume or `ledger worker resume` re-enables after a successful probe
  (D16). The Testcontainers outage test proves no message reaches the DLQ (§20); `--chaos db-outage`
  on AWS is slice 3's.
- **Code error:** the message reaches the DLQ after five receives (ADR-008); redrive is slice 3's,
  and a redriven message dedupes on `svix_id` (AWS-21, ADR-004).
- **Duplicate delivery** (Resend retry, SQS redelivery, a batch re-listed after a pause): a duplicate
  on `svix_id`, never a second row (slice 1's tests, unchanged).
- **Kill switch tripped:** Resend's retries cover ≈ 27.6 h (RS-09); a re-arm inside that window
  recovers without a replay; past it, `ledger reconcile` (slice 4) within List Events reach (RS-U03).
- **A frozen Lambda holding a lock:** the role's `idle_in_transaction_session_timeout` ends it; the
  idle-holder test proves the worker then commits (§20). Through the pooler this rests on PG-U06.
- **Lost hourly resume:** the next hour's runs it; the queue-age alarm (slice 3) shows a long pause.

## 14. Business rules and invariants

- **R1** Ingest MUST decode a base64-encoded body to its exact bytes before verifying, and MUST verify
  a plain body unchanged; both encodings of one signed request MUST yield the same response.
- **R2** Ingest MUST answer `503` with the fixed body, enqueue nothing, and never answer `401`, when
  the secret set cannot be read or holds no secret.
- **R3** Ingest MUST NOT use a secret set older than 5 minutes; an added or retired secret takes
  effect within 5 minutes with no redeploy.
- **R4** Ingest MUST answer `200` only after SQS accepted the message; a rejected send answers `503`.
- **R5** The worker handler MUST return exactly the failed `messageId`s; a thrown error MUST fail the
  whole batch, never return an empty response.
- **R6** A connection-class failure MUST be retried once on a fresh connection; a second one MUST
  report every message of the batch failed and disable the worker's mapping, so a database outage
  adds one receive per message and moves none to the DLQ.
- **R7** Any other error MUST fail only its message (ADR-008).
- **R8** Resume MUST NOT open a database connection when the source is enabled, and MUST enable it
  only after a probe that connects and finds storage below the threshold.
- **R9** Every read-API route MUST answer `401` to a missing, malformed or bad-tag token before any
  database connection opens, `401` to an unknown or revoked token, and `403 forbidden` to a token
  without the route's scope; `operate` satisfies `read`.
- **R10** During a database outage, `GET /health` with a correctly tagged token MUST answer `200`
  with the database unreachable; every other route MUST answer `503 database_unavailable`.
- **R11** `token.create` MUST return the plaintext once and store only its hash; no surface, log or
  table ever holds a plaintext token or its hash outside `api_tokens.token_hash`.
- **R12** `token.revoke` MUST be idempotent and MUST refuse to leave no active `operate` token, also
  under two concurrent revokes.
- **R13** Re-running the deploy command MUST insert no second bootstrap token and print none.
- **R14** The deploy command MUST refuse, before any migration or stack change: a missing or malformed
  required input (either key included), a dirty tree, a tripped
  stack, a disarming deploy, an unsafe contract step, a CBL-01 grep hit; and before writing the key, a
  mismatched `key_id`. It MUST deploy the guardrails stack before the app stack and MUST restore a
  recorded pause after `cdk deploy` started.
- **R15** The teardown command MUST refuse a non-empty queue or DLQ without `--discard-queued`, MUST
  destroy the guardrails stack only after the app stack's destroy succeeded, and MUST exit non-zero
  on a billable leftover.
- **R16** The kill switch MUST disable the mapping before it sets concurrency `0`, MUST cover every
  `LedgerApp-*` function, MUST lower every throttle to its stop value, and MUST be safe to re-run.
- **R17** The runtime role MUST NOT be able to delete from `webhook_events` or create a table, and
  MUST carry both role-level timeouts after every deploy and setup.
- **R18** A migration holding contract-breaking DDL without a marker MUST fail `pnpm verify`.
- **R19** Local mode MUST enforce bearer tokens exactly as the deployed API does.
- **R20** The synthesized templates MUST hold every [cost-brake property](../../.agents/skills/pp-infra/SKILL.md#cost-brake-in-code),
  and each function's environment MUST carry exactly its names-object keys.

## 15. Authorization and idempotency

- **Webhook:** Svix signature against the secret set (ADR-009); no bearer token. Unsigned → `401`.
- **Read API:** bearer token, tag check before the database (D18). Scopes per entry: `health.get`,
  `token.getCurrent`, `email.get`, `recipient.get` are `read`; `token.create`, `token.list`,
  `token.revoke`, `worker.resumeEventSource` are `operate`. A `read` token on an `operate` route →
  `403 forbidden`.
- **Idempotency:** `svix_id` (unchanged); `api_tokens_bootstrap_key` for the first token; revoke is
  naturally idempotent; `token.create` is not, and the SDK never retries it; resume is idempotent.
- **Integration tests owed** (the Mandatory auth-boundary row): `401` for no, malformed, bad-tag,
  unknown and revoked tokens; `403` for `read` on each `operate` route; `last_operate_token`, also
  concurrent; bootstrap insert twice → one row; health on tag alone with Postgres stopped.

## 16. Cost and the Resend budget

| Resource | Idle cost | Note |
| --- | --- | --- |
| Lambda ×4 (ingest, worker, read API, kill switch) | 0 | The hourly resume (730/month) fits the free tier and opens no connection on a healthy stack (AWS-20) |
| Log groups ×4 | ≈ 0 | 30 days, `DESTROY` (AWS-29, AWS-38) |
| SQS queue + DLQ | ≈ 0 | AWS-U03, ≤ USD 0.26 at five pollers (AWS-24) |
| HTTP API | 0 | AWS-15 |
| Secrets ×2 | **USD 0.80** | AWS-11; M1's third is slice 4's |
| EventBridge Scheduler ×1 | 0 | AWS-26 |
| CloudWatch alarms ×2 | 0 | Inside the ten free (AWS-28) |
| SNS topics ×2 | 0 | AWS-31 |
| Budget (and the transient drill budget) | 0 | Plain budgets (AWS-32) |
| Custom metrics (EMF) | 0 at idle | Emitted only on traffic (AWS-12, D5) |

Idle total ≈ USD 0.80/month plus the bootstrap bucket, inside ≤ USD 5. No NAT, VPC, KMS key,
provisioned concurrency or container. The overshoot bound is D30's. **No Resend API call** is added:
the verify send is the owner's own request, not Ledger's, and nothing in slice 2 spends the shared
10 req/s budget.

## 17. PII and retention

- **Tokens:** the plaintext appears only in `token.create`'s response, `ledger token create`'s
  stdout, the deploy command's step 10 and `db:setup`'s `.env.local` write. Stored as SHA-256 only.
  Logs carry `token_id` alone ([Log fields](../data-modeling.md#log-fields)). CBL-10 and D39 guard the
  repo.
- **Keys:** the address-hash and token-tag keys live in `.env.local` and the `ledger/database`
  secret; never in a log, output, template or variable (CBL-01, D33 step 5).
- **Health:** counts, states and byte totals; no PII.
- **Alert address:** a deploy input; it lands in the synthesized template (`cdk.out/`, git-ignored,
  CBL-19) and in SNS, never in a tracked file, log or output.
- **Kill-switch report:** function names, states and throttle values only.
- **Ingest:** the new line carries `body_base64_count` only; the response bodies stay fixed (RS-12).
- **Retention:** `Not touched` — ADR-014's job is slice 7's; this slice adds no column holding PII.

## 18. Integrations, env and owner ops

**New public env vars** (owner-approved, §7), each in [Conventions](../api-contract.md#conventions)
and `.env.example`:

| Name | Read by | Form |
| --- | --- | --- |
| `LEDGER_TOKEN_TAG_KEY` | `apps/local`, `pnpm db:setup` (writes it once), `pnpm aws:deploy` (into `ledger/database`) | 64 lowercase hex |
| `LEDGER_DEPLOY_DATABASE_URL` | deploy | Neon direct URL, owner credentials |
| `LEDGER_DEPLOY_DATABASE_POOLED_URL` | deploy | Neon pooled URL, owner credentials (the deploy swaps in `ledger_runtime`) |
| `LEDGER_DEPLOY_WEBHOOK_SECRETS` | deploy (optional) | Comma-separated `whsec_…`, the deployed signing-secret set |
| `LEDGER_ALERT_EMAIL` | deploy (required) | The budget and kill-switch alert address; never committed |
| `LEDGER_KILL_SWITCH` | deploy | `on` \| `off`, default `off` |
| `LEDGER_BUDGET_USD` | deploy | Positive number, default `50` |

Existing and unchanged: `LEDGER_ADDRESS_HASH_KEY` (now also read by the deploy command, as slice 1
recorded), `AWS_REGION`, `AWS_PROFILE`, `LEDGER_URL`, `LEDGER_TOKEN`. Internal variables: D2.

**Adapters:** D26. **Secrets:** D27, values written by the deploy command (D33 step 9).

**Owner ops** (§25): the AWS account and its plan; the Neon project; `.env.local`'s deploy
variables; `LEDGER_KILL_SWITCH=on`; the two SNS confirmations; the production Resend webhook and its
secret; PG-U01's support question if the docs are silent; reading Cost Explorer for AWS-U02's billing
half. Until the webhook secret is placed, deployed ingest answers `503` (D13), which nothing calls
yet.

## 19. Decision lens, in writing

**Self-service test** ([Guiding principles](../about.md#guiding-principles),
[Adopter lifecycle](../features.md#adopter-lifecycle)):

- **deploy:** one command, `pnpm aws:deploy`, after a Neon project, three `.env.local` lines (the two
  Neon URLs, `LEDGER_ALERT_EMAIL`) and the two keys `pnpm db:setup` generates (D33). It migrates,
  deploys both stacks, writes the secrets and prints the first `operate` token. No console click, no
  SQL, no hand-made key. The CDK bootstrap and the Neon project are one-time prerequisites the README names.
  Nothing owed.
- **connect the webhook:** one documented manual step per installation, on the adopter's path:
  create the webhook in Resend (dashboard or `POST /webhooks`, RS-13), put its secret in
  `LEDGER_DEPLOY_WEBHOOK_SECRETS`, re-run `pnpm aws:deploy`. The smallest version that removes the
  console step is admitted: the deploy command writes the secret, so no `aws secretsmanager` call is
  needed. Scripting the webhook itself stays behind its tripwire (§3).
- **verify:** one send and two CLI reads (D44). Nothing owed.
- **ingest:** automatic. **query:** automatic, with the printed token.
- **recover (outage):** automatic hourly resume; `ledger worker resume` on demand. Replay recovery is
  slice 4's.
- **tear down:** one command; it prints the two steps outside AWS (the webhook, Neon). Nothing owed.
- **Re-arm and the trip drill:** owner-only demo ops (adopters ship the kill switch disarmed), each
  scripted because it recurs per drill and per trip (lens clause 1).
- **Local:** `pnpm db:setup` now writes a working token, so a fresh clone needs no hand-made token.

**Cost brake.**

- **Chosen:** the cheapest shape that meets ADR-010: no VPC, two secrets, two free alarms, one
  hourly schedule, TEXT logs, a plain budget, the usage trip on a vended metric, oldest age from a
  free vended SQS metric read on demand rather than an always-on poll.
- **Rejected:** a third stack or a custom resource for migrations (ADR-018); a CloudWatch dashboard;
  extra alarms before slice 3; reserved concurrency as the valve (AWS-U05); a separate demo stack for
  the drill (ADR-016's reasoning, doubled idle lines); a second budget kept up after the drill;
  `@types/aws-lambda` and `aws-sdk-client-mock` (a few lines each).
- **Over-engineering at the ceiling:** partial health answers; a disarm flag; key rotation; paging
  flags on `ledger token list`.

## 20. Test plan

| Requirement | Test (tier) | Fails if removed |
| --- | --- | --- |
| Ships 1, R20 | `infra/src/app.stack.test.ts`, `guardrails.stack.test.ts` (unit): one `Template` assertion per [cost-brake property](../../.agents/skills/pp-infra/references/cost-brake-assertions.md#one-assertion-per-property), each paired with a count; the throttle on the app template (C3); the mapping (batch 10, no window, `MaximumConcurrency`, `ReportBatchItemFailures`); queue retention and `maxReceiveCount`; the derived visibility timeout; secrets least privilege; per-function environment key sets equal to `function-env.ts`; outputs including `DeployedCommit`; the kill-switch flag synthesized both ways (`KillSwitchArmed` and the subscription) | Any cost-brake property; a variable on the wrong function |
| Ships 7 | `guardrails.stack.test.ts`: the budget with `IncludeCredit: false` and four notifications; both topics unencrypted with the two service principals; the kill switch and its `Errors` alarm; no `Fn::ImportValue`; the drill budget only with its flag | Budget-alarm wiring |
| D32 | `esbuild-installation.test.ts`, `bundle-smoke.test.ts` (unit) | A Docker fallback; an unloadable bundle |
| Ships 2, R1–R4 | `apps/ingest/src/ingest.handler.test.ts` (unit): a signed request plain and base64 → `200`; forged in both encodings → `401`; a rejecting queue → `503`; fixed bodies and content type; `body_base64_count`. `packages/ingest/src/create-ingest.test.ts` (unit, `FakeClock`): an unreadable set and an empty set → `503`, nothing enqueued; the cache serves within 5 min, refreshes after; a failed refresh never serves the expired set | The decode; the `503` on infra faults |
| `SqsQueueAdapter` | `packages/aws/src/sqs-queue.adapter.test.ts` (unit, stubbed client): `SendMessage` input; a rejection propagates | — |
| Ships 3, R5 | `apps/worker/src/worker.handler.test.ts` (unit, fake worker): three records, one failure → exactly that id; a throw → rethrown constant; a resume event → `ResumeResult`; an unknown event → constant throw | An empty or assumed response |
| Ships 4, R6 | `packages/db/src/classify-database-error.test.ts` (unit, extended): `Query read timeout`, `53100` | The classification |
| Ships 4, R6, R7 | `packages/worker/src/database-outage.int.test.ts` (int, its own container): a batch while Postgres is stopped → every id listed, `FakeEventSourceControl` reads `paused` after exactly one batch; a non-connection failure lists only its message and leaves the source enabled | The pause; the single retry |
| Ships 4, R8 | `packages/worker/src/resume.int.test.ts` (int): enabled → no connection opened (a pool over a closed port still answers `already_enabled`); paused, database up → `resumed`, fake reads `enabled`; storage limit injected at 1 byte → `probe_failed`, still `paused` | The probe; the storage check |
| Ships 4 (resume path) | `packages/api/src/resume-event-source.route.int.test.ts` (int, `FakeFunctionInvoke`): `operate` → `200`; `read` → `403`; `probe_failed` → `503` with the override | — |
| Ships 5, R9, R11–R13 | `packages/db/src/api-tokens.repository.int.test.ts` (int, as `ledger_runtime`): identity insert works (library bullet); scope tuple members insert, an outsider → `23514`; `insertBootstrapIfAbsent` twice → one row, second `undefined`; two concurrent revokes of the last two `operate` tokens → one `last_operate_token`. `packages/shared/src/api-token.test.ts` (unit): format, tag check, constant-time path, hash. `packages/api/src/auth.middleware.test.ts` (unit, database at `127.0.0.1:1`): no, malformed and bad-tag tokens → `401` with no connection attempted. `packages/api/src/*token*.route.int.test.ts`: unknown and revoked → `401`; `read` on each `operate` route → `403`; create → `201`, plaintext once, hash stored; list paging; revoke idempotent; `token_not_found`; `last_operate_token` | Auth; the bootstrap key; the revoke lock |
| Ships 5 (deploy) | `infra/scripts/run-deploy.test.ts` (unit, fakes): a re-run inserts no second token and prints none; `--issue-operate-token` prints one | The bootstrap path in the deploy |
| Ships 6, R10 | `packages/api/src/get-health.route.int.test.ts` (int, its own container, the real middleware): Postgres stopped → `GET /health` with a tagged token `200`, `reachable: false`; a bad-tag token → `401`; `GET /emails/{id}` → `503`. With Postgres up: the storage fields; the fakes' queue and source values pass through. `get-health.reader.test.ts` (unit): a `verified: false` caller makes no `storageBytes` call (D19) | The outage exception; the one-attempt bound |
| Ships 8, R18 | The `migrations` stage itself: its `DROP COLUMN` canary on every run | The lint |
| Ships 9, R14 | `infra/scripts/run-deploy.test.ts` (unit): each refusal (a missing or malformed key or URL, dirty tree, tripped, disarming, unsafe contract step over a throwaway git repo, CBL-01 hit, key mismatch) stops before the next step; guardrails before app; the pause restored also when deploy fails. `packages/db/src/deploy-checks.int.test.ts` (int): `storedAddressHashKeyId`, `pendingContractSteps` | Each refusal |
| Ships 9, R15 | `infra/scripts/run-teardown.test.ts` (unit, fakes): non-empty queue or DLQ refuses without the flag; guardrails destroyed only after the app's success; a billable leftover exits `1`, a pending secret does not | The queue refusal; the order |
| Ships 10, R17 | `packages/db/src/runtime-role.int.test.ts` (int): `DELETE FROM webhook_events` and `CREATE TABLE` as `ledger_runtime` → `42501`; `rolconfig` holds both settings. `packages/worker/src/idle-lock-holder.int.test.ts`: a runtime-role client locks the email row and idles → terminated, and the worker commits one row of everything ([harness → idle holder](../../.agents/skills/pp-testing/references/postgres-harness.md#faults-and-concurrency)) | The grants; the role timeouts |
| R16 | `packages/aws/src/kill-switch.test.ts` (unit, stubbed clients): order (mapping first), every prefixed function, both throttle kinds, re-run issues no change; `restoreFromTrip` restores | The order; a missed function |
| Adapters | One unit test per `packages/aws` module (D26) | Command drift |
| D1, R4 | The five shared port contract suites in `@ledger/shared/testing` (unit), each run by both of its implementations: the local one directly, the AWS one over its stubbed client (D1) | Two implementations of one port drifting apart |
| D40, D41, R19 | `apps/local/src/main.e2e.test.ts` (updated, no Docker): `GET /` without a token → `401`; `GET /health` with a tag-valid token over a placeholder `DATABASE_URL` → `200`, `reachable: false`; non-loopback host → exit `1`; missing `LEDGER_TOKEN_TAG_KEY` → exit `1` naming it. `merge-local-env.test.ts`: the tag key written once; `LEDGER_TOKEN` replaced only in its four cases | The local auth; the token repair |
| D23 | `readApiContract` run by `apps/local/src/sdk-contract.int.test.ts` and `apps/api/src/api-lambda-contract.int.test.ts` (int): every operation's success and error paths through `createLedgerClient` | Adapter drift |
| D25 | One `--json` test per new command ([cli-tests](../../.agents/skills/pp-cli/references/cli-tests.md#what-every-commands-test-asserts)), plus: `token create` plaintext on stdout once, never stderr; `token list`'s notice on `has_more` | Exit mapping; the plaintext rule |

`int` timeouts are set from measured runs. `pnpm verify` covers all of the above. It cannot see:
AWS behavior (the drill, the deployed lock test, the verify delivery, the teardown listing), which
the walk records; Neon's pooler (PG-U02, PG-U06); the first bill (CBL-18).

## 21. Walkthrough plan

`openspec/changes/slice-2-durable-ingest-on-aws/WALKTHROUGH.md`, in [the format](../../.agents/skills/rsa-manual-test/references/walkthrough-format.md).
It runs well past ~15 minutes: two deploys, a drill and a budget wait. The local path and the
deployed read paths stay short.

Personas reaching slice 2: **Operator** (deploy, health, resume, tokens, drill, teardown),
**Application developer** (connecting the webhook, the deployed ingest, HTTP with a token),
**Support / on-call engineer** (`ledger email`, `ledger recipient` deployed), **Reviewer** (a
`read` token: what it can and cannot do). Not reaching it: **AI agent** (MCP, slice 5).

Every `UI surfaces` entry is reached: deploy command B3, B4, B5, G4, G6, T3, C3; teardown command T1;
`POST /webhooks/resend` (deployed) C4; `ledger email` C5, D1; `ledger recipient` D2; `ledger health`
A3, C6, E3; `ledger worker resume` A4, E4; `ledger token create|list|revoke|current` A2, A5–A7, F1–F5;
trip drill and re-arm scripts G1–G6.

**Before you start:** `pnpm install`; Docker running; `pnpm dev:full` (runs `db:setup`, which now
mints `LEDGER_TOKEN`). For the deployed paths, set the deployed `LEDGER_URL` and `LEDGER_TOKEN` in
the shell for the session (`export LEDGER_URL=…`; `read -rs LEDGER_TOKEN && export LEDGER_TOKEN`, so
the token never lands in shell history); a shell value wins over `.env.local`.

- **This walk creates:** local tokens; both stacks (kept); a drill budget (removed in G6); the
  production webhook; one test email's rows; review tokens (revoked in F5).
- **Ask-first:** B1, B4, C1, C2, C3, C4, E5, G1–G6, T1, and every `pnpm aws:*` run.

**Order:** A (local) → B (deploy) → G (drill) → T (teardown, then redeploy) → C (webhook and verify)
→ D, E, F (deployed reads). Teardown runs before the webhook exists, so the redeploy's new ingest URL
needs no webhook update (§3).

- **Path A — local auth, health and tokens (Operator).** A1: `pnpm db:setup` after slice 1's
  `.env.local` → `db:setup: wrote LEDGER_TOKEN_TAG_KEY …` and `… LEDGER_TOKEN …`. A2:
  `pnpm -s ledger token current --json` → `"scope": "operate"`. A3: `pnpm -s ledger health --json` →
  `"event_source": { "state": "enabled" }`, `"reachable": true`. A4: `pnpm -s ledger worker resume`
  → `enabled (already enabled)`. A5: `pnpm -s ledger token create --name walk-read --scope read`
  → the layout, notice on stderr. A6: `curl` `$LEDGER_URL/tokens` with the walk-read token → `403`
  `forbidden`; with none → `401`. A7: `pnpm -s ledger token revoke <walk-read id> --json` → revoked;
  revoking the only `operate` token → exit `1`, `last_operate_token`.
- **Path B — deploy (Operator).** B1 **Ask-first:** `aws lambda get-account-settings` (AWS-U05;
  record the concurrency quota only). B2: `pnpm synth` → no CBL-01 hit. B3: `pnpm aws:deploy` with
  `LEDGER_ADDRESS_HASH_KEY` set to a fresh value against a database holding hashes →
  `aws:deploy: refused: …key_id…` before any stack change (on a fresh database this step reads `n/a`).
  B4 **Ask-first:** `pnpm aws:deploy` → guardrails then app, the first `operate` token printed once,
  `KillSwitchArmed true`; confirm both SNS emails (CBL-03). B5: re-run `pnpm aws:deploy` → no token
  printed (Ships 5).
- **Path G — trip drill and re-arm (Operator).** G1 **Ask-first:** `pnpm aws:trip-drill` → steps
  1–5 pass, five `429`s (AWS-U02), the throttle update accepted (AWS-U11), the `Errors` alarm fires.
  G2: `ledger health` while tripped (between steps, if the drill pauses for it) → exit `1`,
  `api_unavailable`. G3: `reconcile → slice 4`. G4 **Ask-first:** `pnpm aws:deploy --budget-drill`;
  wait for the drill notification and the kill switch's report email (AWS-U01). G5 **Ask-first:**
  `pnpm aws:rearm` → restored, spend warning if any. G6 **Ask-first:** `pnpm aws:deploy` → the drill
  budget is gone.
- **Path T — teardown (Operator).** T1 **Ask-first:** `pnpm aws:teardown` → app, then guardrails,
  listing clean, the two outside steps printed. T2: list the two secrets → pending deletion (AWS-U06).
  T3 **Ask-first:** `pnpm aws:deploy` again → the bootstrap row survives in Neon, so no token prints;
  `pnpm aws:deploy --issue-operate-token walk-operate` prints one.
- **Path C — connect the webhook and verify (Application developer).** C1 **Ask-first:** create the
  webhook for the printed ingest URL (dashboard or `POST /webhooks`, RS-13), owner-run, the response's
  secret never pasted into a transcript. C2: put the secret in `LEDGER_DEPLOY_WEBHOOK_SECRETS`.
  C3 **Ask-first:** `pnpm aws:deploy` → the secret written. C4 **Ask-first:** one send to
  `delivered@resend.dev` (the format's worked example). C5: `pnpm -s ledger email <id> --json` →
  `"status": "delivered"`. C6: `pnpm -s ledger health` → queue and DLQ at 0; then
  `aws logs filter-log-events --log-group-name /ledger/LedgerApp-ingest --filter-pattern '"ingest.request_decoded"'`
  (read-only; the line carries allow-listed fields only) → the delivery's `body_base64_count`
  (AWS-U04).
- **Path D — support lookup, deployed (Support / on-call engineer).** D1: `ledger email <id>`,
  human layout. D2: `ledger recipient delivered@resend.dev` → `ok`, masked.
- **Path E — operate the deployed pipeline (Operator).** E1: `curl` `$LEDGER_URL/health` with no
  token → `401`. E2: with a bad-tag token → `401`. E3: `ledger health --json`. E4:
  `ledger worker resume` → `enabled (already enabled)`. E5 **Ask-first:** `pnpm aws:db-check
  --email-id <id> --idle-minutes 6` → PG-U06 values, PG-U02 serialized, PG-U04 outcome.
- **Path F — reviewer access (Reviewer, with the Operator issuing).** F1: `ledger token create
  --name review-walk --scope read`. F2 (as the reviewer's token): `ledger token current` →
  `read`. F3: `ledger email <id>` → `200`. F4: `ledger token list` → exit `1`, `forbidden`;
  `ledger worker resume` → `forbidden`. F5: revoke `review-walk` and `walk-operate`; then
  `ledger token current` with the revoked token → `unauthorized` (CBL-20).
- **Teardown of the walk:** revoke walk tokens (F5); the stacks stay up (deploy and keep).

**Cannot reach today:**

| Not reachable | Carried by |
| --- | --- |
| `ledger reconcile` after a re-arm or a trip | [slice 4](../build-checklist.md#4--recovery) |
| DLQ inspect and redrive; alarms with runbook entries; the burst and `--chaos db-outage` on AWS | [slice 3](../build-checklist.md#3--operations-and-evidence-on-aws) |
| A durable local queue; local DLQ operations | [slice 2B](../build-checklist.md#2b--local-mode-queue-and-docker-compose) |
| MCP tools | [slice 5](../build-checklist.md#5--mcp-server-and-contract-hardening) |
| A deployed database outage (Neon cannot be stopped from the walk) | The Testcontainers outage test (§20); [slice 3](../build-checklist.md#3--operations-and-evidence-on-aws)'s `--chaos db-outage` |

## 22. Docs to update

Applied by the change, in the commits that land each piece:

- [build-checklist.md](../build-checklist.md#2--durable-ingest-on-aws): `Status` `[~]` from the first
  commit, `[x]` after the walk; tick Ships as each lands; Ships 7 gains "AWS-U11" beside AWS-U01 and
  AWS-U02, Ships 15 gains "AWS-U12" (C1). The `Ops` line's RS-U21 note stays.
- [data-modeling.md](../data-modeling.md): Model index `Modeled` `[x]` for `api_tokens`; the field
  table's `updated_at` line (C11); the slice 2 evidence lines (`api_tokens`, Idempotency keys, PII's
  `key_id` refusal) → §20's tests.
- [api-contract.md](../api-contract.md): Conventions → public variables (the seven); internal
  variables' example "the worker's event source mapping UUID" → "the worker's function name" (C5);
  `health.get`'s cost line gains the CloudWatch statistic (C4).
- [architecture.md](../architecture.md): Evidence lines of ADR-001 (both encodings), ADR-005
  (PG-U02), ADR-008 (batch-failure unit test), ADR-010 (CDK assertions, drill, listing), ADR-015,
  ADR-018 (lint, refusals, deploy order), ADR-019 (the Lambda adapter contract run).
- [aws.md](../aws.md): Budget alarms item 3's mechanism (C17), item 6's script name `pnpm aws:rearm`,
  item 7's throttle, threshold and D30's bound with its inputs; every row D42 settles; a new
  `AWS-NN` for CloudWatch `GetMetricStatistics` and its price, read from the CloudWatch API and
  pricing pages (C4); Teardown evidence; Cost shape unchanged (two secrets in slice 2, three by M1's
  end).
- [integrations.md](../integrations.md): PG-U01, PG-U02, PG-U04, PG-U06 rows; Runtime role's values
  (D10); Secrets layout's `ledger/database` JSON keys (`pooledUrl`, `addressHashKey`, `tokenTagKey`).
- [resend.md](../resend.md): RS-U07 proved safe (D43); Onboarding reality: the domain row (C8), the
  webhook and verify rows after the walk.
- [about.md](../about.md): What this project must demonstrate rows 2 (migration lint), 3 (IaC), 4
  (budget alarms and kill switch) linked; the slice 2 `[Unverified]` bullets updated; library bullets
  resolved (C15; identity and sequence grant; `pg` errors; CDK bundling, synth and CLI entry; AWS-U10).
- [features.md](../features.md): deploy, connect webhook, verify, tear down stances → their evidence.
- [check-before-launch.md](../check-before-launch.md): CBL-16 → the `KillSwitchArmed` output and the
  deploy's disarm refusal; CBL-01 → the deploy's step 5.
- Root [AGENTS.md](../../AGENTS.md): Projects (`apps/kill-switch` row; `apps/api`, `apps/ingest`,
  `apps/worker` and `infra` scaffold notes removed; `packages/aws` "Logic lands 2" done); Commands
  (`pnpm aws:deploy`, `aws:teardown`, `aws:rearm`, `aws:trip-drill`, `aws:db-check`, the CLI's new
  commands, the `migrations` stage, `db:setup`'s new names); the planned-stage sentence removed.
- [.env.example](../../.env.example): the seven names; `LEDGER_TOKEN`'s comment (minted by
  `db:setup`, enforced).
- [rsa-manual-test → environment.md](../../.agents/skills/rsa-manual-test/references/environment.md):
  slice 2 rows with exact commands; local `ledger health` from slice 2 (C6); traps: the real local
  token, `read -rs LEDGER_TOKEN` for deployed walks, never `--discard-queued`, the drill's trip.
- Skill corrections, each a fact this slice settles (no rule loosened):
  - [pp-infra](../../.agents/skills/pp-infra/SKILL.md): the throttle assertion on the app template
    (C3); the kill switch's home, the usage alarm's home, names, tag key, context keys, TEXT format,
    the CDK entry, the bundle smoke check, `useCdkManagedLogGroup` reconciled.
  - [pp-backend → composition](../../.agents/skills/pp-backend/references/composition.md) and
    [ingest-and-worker](../../.agents/skills/pp-backend/references/ingest-and-worker.md): port names
    and methods (D1), the resume event and the mapping lookup (D16, D17), pool timeouts (D9), the
    memoized secret read (D32).
  - [pp-backend → read-api](../../.agents/skills/pp-backend/references/read-api.md): the middleware's
    health exception and per-route scope (D18).
  - [pp-database](../../.agents/skills/pp-database/references/schema-and-repositories.md): timeout
    values and `Query read timeout` (D9); [migrations-and-grants](../../.agents/skills/pp-database/references/migrations-and-grants.md):
    role timeout values, `resetPassword`, the identity results.
  - [pp-testing → postgres-harness](../../.agents/skills/pp-testing/references/postgres-harness.md):
    the harness timeout values, the outage container helper; [vitest-layout](../../.agents/skills/pp-testing/references/vitest-layout.md):
    `readApiContract`'s location.
  - [pp-general → logging-and-pii](../../.agents/skills/pp-general/references/logging-and-pii.md):
    the `context` option (D6); the level-filter bullet resolved (C15).
  - [pp-cli](../../.agents/skills/pp-cli/SKILL.md): layouts → this document §12.

No line above loosens a rule, so none needs the independent-helper gate
([Never loosen a rule](../../AGENTS.md#never-loosen-a-rule-to-fit-what-was-built)). C9 and C10 change
spec requirements (§23); each tightens or keeps its safety rule, and the change's commit body says so.

## 23. OpenSpec mapping

Change `slice-2-durable-ingest-on-aws` at `openspec/changes/slice-2-durable-ingest-on-aws/`. Against
`find openspec/specs -name spec.md` (thirteen capabilities):

| Capability path | Delta | Requirements |
| --- | --- | --- |
| `webhook-ingest` | **MODIFIED** | ADDED "Both body encodings verify identically" (R1), "An unreadable secret set answers 503" (R2, D13), "The secret set refreshes within 5 minutes" (R3). "Acknowledge only after a successful enqueue" MODIFIED: SQS acceptance (R4). Others unchanged |
| `event-ledger` | **MODIFIED** | ADDED "A database outage pauses the event source instead of dead-lettering" (R6, D15), "Resume only after a successful probe" (R8, D16), "The runtime role cannot delete the ledger or change the schema" (R17). "Batch failures list exactly the failed messages" MODIFIED: the Lambda handler's response and a thrown error (R5). "At-least-once local delivery" unchanged |
| `read-api` | **MODIFIED** | REMOVED "Auth skipped only on loopback" (C10). ADDED "Bearer token on every route" (R9), "Health answers during a database outage" (R10, D19), `worker.resumeEventSource` (D20), `token.create`, `token.list`, `token.revoke`, `token.getCurrent` (D21, R11, R12). MODIFIED "OpenAPI document" (eight operations, `bearerAuth`), "email.get errors" and "recipient.get errors" (gain `unauthorized`) |
| `sdk` | **MODIFIED** | ADDED "Health, worker and token methods" (D24); "Client configuration and auth header" unchanged |
| `cli` | **MODIFIED** | ADDED `ledger health`, `ledger worker resume`, `ledger token create`, `ledger token list`, `ledger token revoke`, `ledger token current` (D25, §12) |
| `local-stack` | **MODIFIED** | MODIFIED "Setup writes missing local configuration once" (the tag key; C9's `LEDGER_TOKEN` rule), "Local process boot assertion" (requires `LEDGER_TOKEN_TAG_KEY`), "One loopback process serves ingest and the read API" (the root path needs a token). ADDED "Local mode enforces bearer tokens" (R19), "The local process binds loopback only" (moved from `read-api`, D40) |
| `verify-gate` | **MODIFIED** | "One gate, identical locally and in CI": the stage list gains `migrations`. ADDED "Migration lint fails contract-breaking DDL and proves itself" (R18, D38). "The secret scan proves its own rules on every run" MODIFIED: the `ldg_` rule and canary (D39) |
| `api-tokens` | **ADDED** | Token format and tag check; hashed at rest; bootstrap uniqueness and the deploy's single issuance (D3, D7, R13) |
| `aws-stacks` | **ADDED** | Cost-brake template properties; function environments; the guardrails stack; the kill switch's steps; the usage trip; the throttle and the overshoot statement (R16, R20, D27–D31) |
| `deploy-and-teardown` | **ADDED** | Deploy order and refusals; teardown; re-arm; trip drill; db-check (R14, R15, D33–D37) |

`projection-privacy`, `projections`, `event-schemas`, `address-masking`, `core-import-boundary` and
`simulator` are unchanged.

Task groups, each one or more commits pushed as it lands:

1. **Dependencies** (Ask-first, §7). Gate `pnpm check`.
2. **Kernel and core:** ports, fakes, the static and in-process local implementations and the five
   port contract suites (D1), `function-env.ts`, token mint, EMF adapter, logger context,
   `tokenScopes`, `eventSourceStates`; unit tests.
3. **Database** (schema + migrations + Model index tick in one commit): `api_tokens`, repository,
   `prepareDatabase` (timeouts, password), classifier additions, storage read, deploy helpers; int
   tests (role refusals, idle holder, tokens, deploy checks); the harness's timeout values and outage
   container helper. Gate `pnpm check` + `pnpm test:int`.
4. **Gate stages** (Ask-first CI): `migration-lint.mjs` and the `migrations` stage; the gitleaks rule
   and canary.
5. **`packages/aws`:** every module of D26 with its stubbed-client test; each port adapter also runs
   its port's contract suite (D1).
6. **Ingest:** `loadSecrets`, the cache and the `503`; `apps/ingest`; tests (Ships 2).
7. **Worker:** the ADR-015 branch, `resume`; `apps/worker`; unit and int tests (Ships 3, 4).
8. **Read API:** middleware, health, resume, tokens; route tests; `readApiContract`;
   `pnpm openapi:export`. `apps/api`.
9. **SDK and CLI:** methods, fake, six commands and tests; both contract runs.
10. **Local mode:** `apps/local` wiring, `db:setup`, e2e update, `.env.example`.
11. **Infra:** `LedgerFunction`, both stacks, `apps/kill-switch`, assertions, smoke check; `pnpm synth`.
12. **Scripts:** deploy, teardown, re-arm, trip drill, db-check, their `run-*` tests, root scripts.
13. **Live** (each action Ask-first, owner-run where it touches a secret): AWS-U05 read; first deploy;
    drill; budget drill; teardown and redeploy; webhook; verify send; db-check; record every row
    (D42). Depends on 1–12.
14. **Docs** (§22) and `WALKTHROUGH.md` (§21).
15. **Gate:** `pnpm verify` → `VERIFY PASSED`; `pnpm exec openspec validate slice-2-durable-ingest-on-aws --type change --strict`; CI green on the pushed `HEAD`.

## 24. Risks

| Risk | Likelihood | Cost | Cheapest early catch |
| --- | --- | --- | --- |
| `AWS::Budgets::Budget` will not deploy in us-east-2 (AWS-U01) | Medium | The guardrails stack moves to us-east-1 (§3's tripwire) | The first `cdk deploy LedgerGuardrails` in group 13, before the app stack |
| A throttle of `0` is rejected or still bills (AWS-U02) | Medium | A non-zero stop value; its spend stated in aws.md | Drill step 3; D30's fallback |
| The AWS-U11 resource shape is wrong, so the kill switch cannot throttle | Medium | The `Errors` alarm fires on a real trip | Reading the Service Authorization Reference at apply; drill step 2 |
| Neon's pooler ignores the role settings (PG-U06 negative) | Medium | A frozen lock holder is bounded only by client timeouts; waiters may hit `Query read timeout` and pause the worker for up to an hour | `pnpm aws:db-check` step 1; the `SET LOCAL` fallback goes to the owner then (§3) |
| The CDK topic policy blocks the CloudWatch alarm's publish | Low | The usage trip never trips | D28 grants it explicitly; drill step 1 proves it |
| A bundle fails to load (CommonJS `require`, `pg-native`) | Medium | Every function fails at init | D32's smoke check in `pnpm check`, before any deploy |
| The tagging API lists just-deleted resources | Medium | A false leftover after teardown | Re-run the listing after a few minutes; the script names each ARN's type |
| The idle-in-transaction timeout (5 s) cuts slice 6's dispatcher batch, which holds a transaction across HTTP sends | Certain in slice 6 | A slice 6 design constraint | Recorded here; slice 6's pre-proposal sizes its delivery timeout or the role value |
| `pg_database_size` and Neon's storage accounting differ | Medium | The probe pauses early or late | D11's 95 % threshold; PG-U07 in slice 3 |
| The budget-drill notification takes longer than a day | Low | The slice closes later | Start G4 right after the first deploy |
| Identity inserts need a sequence grant | Low | One extra line in `0003` | The repository int test, before the migration freezes |
| Neon's inactivity rule (PG-U01) reaches an idle Free project in AWS regions, and the kept slice 2 deploy, which opens no connection on an idle hour (R8), sees no traffic for that long before slice 4's hourly reconciler lands | Unknown until PG-U01 settles | The ledger is deleted (lens clause 6) | PG-U01 read at apply, before the first deploy; the answer goes to the owner with what counts as activity |

## 25. Owner ops still open

- **AWS account** on the Paid plan, CDK-bootstrapped in us-east-2; approve and run
  `aws lambda get-account-settings` (AWS-U05).
- **Neon:** create the Free project on Postgres 18 in `aws-us-east-2`; put its direct and pooled URLs
  in `.env.local` as `LEDGER_DEPLOY_DATABASE_URL` and `LEDGER_DEPLOY_DATABASE_POOLED_URL`.
- **`.env.local`:** `LEDGER_ALERT_EMAIL`, `LEDGER_KILL_SWITCH=on`, optionally `LEDGER_BUDGET_USD`.
- **Confirm** both SNS email subscriptions after the first deploy and after the redeploy (CBL-03).
- **Resend:** create the production webhook for the printed ingest URL and copy its secret into
  `LEDGER_DEPLOY_WEBHOOK_SECRETS` yourself (it is a signing secret, RS-05); approve the verify send.
- **PG-U01:** if Neon's docs do not settle the 90-day rule for an AWS-region Free project, ask Neon
  support what counts as activity. Slice 2's kept deploy touches the database only on traffic (R8);
  from slice 4 the reconciler touches it hourly. The change records the answer (D42).
- **AWS-U02's billing half:** read API Gateway usage in Cost Explorer for the drill day.
- **Approve each live action** when it runs (§7: AWS runs, live Resend writes).
