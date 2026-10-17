# Build checklist

Execution tracker, one card per vertical slice. **This file does not own ordering or rationale**:
both are canonical in [architecture.md → Build order](architecture.md#build-order-vertical-slices),
and the IDs and titles here are copied from it verbatim. The "what" of each slice is assembled from
the [ADRs](architecture.md#decisions), [data-modeling.md](data-modeling.md),
[api-contract.md](api-contract.md) and [features.md](features.md); links point out rather than
restate. Milestones carry no dates ([about.md → Milestones](about.md#milestones)).

## How to work this checklist

- **Read order:** [`.ai/AGENTS.md`](AGENTS.md) → [about.md](about.md) →
  [architecture.md → Build order](architecture.md#build-order-vertical-slices) → the card you are
  taking → its `Refs`.
- **Spine vs. parallel tracks.** The spine is 0 → 1 → 2 → 3 → 4 → 5 → 6 → 7, then M3 in any order.
  Finish each spine slice before the next. A slice with a letter suffix (`2B`) is a branch off its
  number, not a spine link: it MAY run in parallel once its `Depends on` are done, and its card
  says when it MUST land. Take the first unblocked todo slice on the track you are advancing.
- **Deploy and keep, one demo per milestone.** From slice 2 on, every finished slice is deployed to
  the owner's AWS account and stays up ([lens clause 7](../AGENTS.md#decision-lens--evidence-over-claims-right-sized)).
  The README claims, the demo and the deploy are made coherent at each milestone boundary (slices 4,
  7 and the last M3 slice), not between slices (lens clause 3). A gap that a **named later slice**
  carries is fine; a finished slice whose surfaces cannot be exercised by hand is not finished.
- **The Ships list is the done-list.** Every bullet names its evidence: a test, a property, a
  simulator invariant, a measured number or a working command. An `[Unverified]` row a card owes
  ([architecture.md → Open questions owed by slice](architecture.md#open-questions-owed-by-slice))
  appears as a Ships bullet naming the row and the experiment that settles it, or the test that
  proves the design safe either way. Settling one updates its row in [resend.md](resend.md#unverified),
  [aws.md](aws.md#unverified) or [integrations.md](integrations.md#unverified) in the same change.
  Experiments that write to a live Resend account and every AWS deploy are Ask-first: the card's
  `Ops` line lists them.
- **The walkthrough a slice owes.** Every slice's change folder (`openspec/changes/slice-<id>-<kebab>/`)
  MUST contain a `WALKTHROUGH.md` before its `Status` is ticked: numbered steps in paths that reach
  every surface the card's `UI surfaces` line names (a path MAY group surfaces walked together),
  each with the exact CLI command, API request or simulator run and its expected output. A step
  that cannot be completed today MUST name the slice that covers it, inline. A surface the card
  claims but no step reaches is a finding against this slice. Each path names the persona walking
  it, and every [persona](about.md#target-personas) that reaches the slice MUST walk at least one
  path: a role that reaches the slice but walks no path is a finding against this slice too. Setup
  MUST be non-destructive, and every step that writes to a live Resend account or AWS MUST carry
  an `**Ask-first:**` marker; the format is
  [rsa-manual-test → walkthrough-format.md](../.agents/skills/rsa-manual-test/references/walkthrough-format.md).
  `rsa-manual-test` executes the walk after `wf-after-apply-check` and records `WALKTHROUGH-RUN.md`
  in the change folder before `opsx:archive`.
- **Ships are capability-level.** Explode them into tasks when the slice starts (OpenSpec
  `tasks.md`), not up front. The propose gates compare Ships text verbatim, so a reworded bullet is
  a scope change: edit the card first.
- **Status only, no history.** Update the `Status` line and the `Ships` boxes in place; no
  changelog, no dated notes. An unresolved question goes to
  [about.md → Open questions](about.md#open-questions) and the card is marked blocked with a
  one-line reason.

## Legend

`[ ]` todo · `[~]` in progress · `[x]` done · `[!]` blocked on an owner decision or an unverified fact (one-line why).

The marker lives on the card's `Status` line, in backticks, and nowhere else. Headings MUST stay
marker-free: they are link anchors (`#2b--local-mode-queue-and-docker-compose`). Checkbox lines
appear only inside a `Ships` list. A ticked `Status` over an unticked `Ships` box is the card lying.

## M1 — MVP

Foundations, local v0, durable ingest on AWS, recovery, and a usable CLI; evidence over breadth.

### 0 — Foundations

- **Status:** `[x]`
- **Goal:** A monorepo where the projection logic is proven by property tests, the simulator generates histories, and CI gates every push.
- **Depends on:** — (foundational).
- **Refs:** [ADR-003](architecture.md#adr-003--projection-is-a-pure-function-of-the-event-set) · [ADR-013](architecture.md#adr-013--pure-core-and-local-mode) · [resend.md → Event types and payloads](resend.md#event-types-and-payloads-rs-25rs-30) · [features.md → Ledger & projections](features.md#ledger--projections) · [features.md → discover](features.md#adopter-lifecycle)
- **Ships:**
  - [x] pnpm workspace with strict TypeScript, Biome and Vitest; `pnpm verify` mirrors CI stage for stage and exits 0 only when every stage ran and passed.
  - [x] GitHub Actions CI runs `pnpm verify` on every push and pull request (`pull_request`, never `pull_request_target`; `permissions: contents: read`; third-party actions pinned by commit SHA; `pnpm install --frozen-lockfile`); evidence: a green run on a pushed commit.
  - [x] `pnpm verify` runs a gitleaks stage over the full git history (`git --log-opts=--all`) from a version-pinned Docker image, the same command in CI, with `.gitleaks.toml` extending the default ruleset (`[extend] useDefault = true`) and adding rules for Resend API keys (`re_`), `whsec_` signing secrets and Postgres URLs; evidence: the stage exits 1 on a scratch commit carrying a fake key and 0 on the repo.
  - [x] `packages/core` Zod schemas for the RS-25–RS-29 event types, event-specific objects optional, unknown types kept raw; evidence: schema unit tests over the resend.md payload examples.
  - [x] `projectEmail` and `projectRecipient` pass fast-check properties 1–4: permutation invariance, idempotence, monotonicity (for `projectRecipient`, of the sticky states), oracle agreement (ADR-003).
  - [x] `packages/core` address normalization and mask functions ([PII & retention](data-modeling.md#pii--retention)); evidence: fast-check properties (masks idempotent, length-preserving, no digit revealed, at most 3 characters revealed per token, no control character) and the two-recipient property (a bounce naming one recipient leaves the other's outcome unchanged).
  - [x] Lint rule rejects any AWS, Postgres or Resend import in `packages/core` (ADR-013); evidence: a deliberate-violation fixture fails the lint stage ([import-boundaries.test.ts](../packages/core/src/import-boundaries.test.ts), one fixture per banned pattern).
  - [x] `sim` history generator with seed, duplicate and shuffle knobs; `pnpm sim` prints the projection of a generated, shuffled history, identical for a fixed seed and run namespace.
  - [x] README skeleton states the problem, the positioning against the Ingester and the no-affiliation line; the CI link check reports 0 broken links.
  - [x] RS-U10, RS-U11, RS-U12 and RS-U19 proved safe either way by named property and schema tests, each [Unverified] row citing its test.
- **UI surfaces:** `pnpm verify` locally · the CI run on a pushed commit · `pnpm sim` printing a projection.
- **Ops:** owner approves the CI workflow (Ask-first: CI change) and each new dependency, the gitleaks image included (Ask-first). Docker locally. No Resend or AWS step.
- **Deferred tail:** Drizzle schema, ingest, worker and read path ([slice 1](#1--local-ledger-and-read-path)). Any AWS resource ([slice 2](#2--durable-ingest-on-aws)). Simulator runs against a live process ([slice 1](#1--local-ledger-and-read-path)) and on AWS ([slice 3](#3--operations-and-evidence-on-aws)).

### 1 — Local ledger and read path

- **Status:** `[~]`
- **Goal:** Real and simulated Resend events, verified locally, land once in a Postgres ledger, project into email and recipient state, and are read through the read API, SDK and CLI.
- **Depends on:** 0.
- **Refs:** [ADR-001](architecture.md#adr-001--verify-then-enqueue) · [ADR-004](architecture.md#adr-004--immutable-ledger-keyed-on-svix_id-one-transaction-per-message) · [ADR-009](architecture.md#adr-009--multi-secret-verification-and-timestamp-tolerance) · [ADR-011](architecture.md#adr-011--one-contract-many-surfaces) · [ADR-013](architecture.md#adr-013--pure-core-and-local-mode) · [ADR-018](architecture.md#adr-018--migrations-run-from-the-deploy-command-before-the-code-that-needs-them) · [ADR-019](architecture.md#adr-019--application-and-surface-stack) · [webhook_events](data-modeling.md#webhook_events--the-immutable-ledger) · [email_state](data-modeling.md#email_state--current-state-per-email) · [email_recipients](data-modeling.md#email_recipients--outcome-per-email-and-recipient) · [recipient_state](data-modeling.md#recipient_state--deliverability-per-address) · [PII & retention](data-modeling.md#pii--retention) · [email.get](api-contract.md#emailget) · [recipient.get](api-contract.md#recipientget) · [Ingest boundary](api-contract.md#ingest-boundary) · [J2](features.md#j2--support-lookup)
- **Ships:**
  - [x] Local ingest verifies signature and timestamp on the raw body against the configured secret set, first match wins, and returns `200` with a fixed body or `401`; evidence: unit tests with old, new and both signatures, forged and stale requests.
  - [x] `packages/db` Drizzle schema and expand-only migrations for `webhook_events`, `email_state`, `email_recipients` and `recipient_state`; CI applies every migration to a fresh Postgres before the integration tests (ADR-018).
  - [x] Worker runs one transaction per message behind the in-process queue port, deduplicating on `svix_id` (ADR-004, ADR-013); evidence: Testcontainers tests for a duplicate insert, a crash between steps, and a NUL payload stored with U+FFFD, projected and committed ([Immutable ledger](data-modeling.md#immutable-ledger)).
  - [x] Recipient rows locked in sorted `address_hash` order after the email lock; evidence: concurrency integration test with two emails sharing a recipient.
  - [x] Projections hold masks and keyed address hashes only, under an address-hash key the setup script generates once into `.env.local` ([PII & retention](data-modeling.md#pii--retention)); evidence: integration test finding no raw address or subject in any projection row.
  - [x] Unknown and non-email event types, and schema-failing payloads of known types, stored raw, projection skipped, metric emitted; evidence: unit test.
  - [x] The shared logger emits only the fields in [data-modeling.md → Log fields](data-modeling.md#log-fields), never a payload or an error's `message` / `detail` from parsing or Postgres; evidence: unit test feeding a failing message with a test address and a `CHECK` violation, asserting no log line holds the address or subject.
  - [x] Minimal read API (OpenAPI, Zod), SDK, `ledger email <email_id>` and `ledger recipient <address>` with `--json` in the error shape, auth skipped only on loopback; evidence: SDK ↔ API contract tests and CLI `--json` output tests.
  - [x] `pnpm openapi:export` writes the committed `packages/sdk/openapi.json`, and a `pnpm verify` stage fails when it or the generated SDK types drift ([ADR-011](architecture.md#adr-011--one-contract-many-surfaces)); evidence: the stage fails on a stale fixture.
  - [x] `pnpm sim --duplicates 0.2 --shuffle` against the local process (`apps/local`) passes invariants 1 and 2.
  - [x] RS-U15 recorded from the Ask-first test-address sends, with simulator fixtures mirroring the observed sequences; RS-U18 checked by a read-only `GET /webhooks` after an interrupted `listen` session.
  - [x] RS-U22 settled in the first approved `listen` session: the temporary webhook's secret read with `resend webhooks get <id>`, loaded into the local secret set, and one forwarded delivery verified by local ingest, with the result in resend.md.
- **UI surfaces:** `POST /webhooks/resend` (local) · `resend webhooks listen` · `ledger email <email_id>` · `ledger recipient <address>` · `pnpm sim --duplicates 0.2 --shuffle`.
- **Ops:** owner: a Resend API key and, per `listen` session, that session's signing secret (RS-U22) in the git-ignored `.env.local`; approve each `resend webhooks listen` session (it creates a temporary webhook, RS-33) and each test send (Ask-first); `@resend.dev` test addresses only; Docker for Testcontainers.
- **Deferred tail:** SQS, DLQ, CDK and bearer tokens ([slice 2](#2--durable-ingest-on-aws)). RS-U21's two-recipient send, which needs the project's verified sending domain: from `onboarding@resend.dev` Resend keeps only the first recipient ([slice 2](#2--durable-ingest-on-aws); owner, 2026-10-17). DLQ operations ([slice 3](#3--operations-and-evidence-on-aws)). Rotation runbook and retired-secret test ([slice 4](#4--recovery)). `email.explainDelivery` and MCP ([slice 5](#5--mcp-server-and-contract-hardening)). `docker compose` local mode ([slice 2B](#2b--local-mode-queue-and-docker-compose)).

### 2 — Durable ingest on AWS

- **Status:** `[ ]`
- **Goal:** Ledger runs in the owner's AWS account under a hard budget cap: ingest answers `200` only after enqueue, the worker drains SQS and holds events through a database outage, and the read path is token-protected.
- **Depends on:** 1.
- **Refs:** [ADR-001](architecture.md#adr-001--verify-then-enqueue) · [ADR-002](architecture.md#adr-002--sqs-standard-not-fifo) · [ADR-008](architecture.md#adr-008--backpressure-bounded-concurrency-partial-batch-failure-dlq) · [ADR-010](architecture.md#adr-010--serverless-on-aws-cdk-an-app-stack-and-a-guardrails-stack) · [ADR-015](architecture.md#adr-015--the-worker-pauses-its-own-event-source-on-a-database-outage) · [ADR-018](architecture.md#adr-018--migrations-run-from-the-deploy-command-before-the-code-that-needs-them) · [aws.md → Budget alarms](aws.md#budget-alarms) · [aws.md → Teardown](aws.md#teardown) · [integrations.md → Decision — Neon](integrations.md#decision--neon) · [integrations.md → Secrets layout](integrations.md#secrets-layout) · [api_tokens](data-modeling.md#api_tokens--read-api-bearer-tokens) · [health.get](api-contract.md#healthget) · [worker.resumeEventSource](api-contract.md#workerresumeeventsource) · [token.create](api-contract.md#tokencreate) · [token.list](api-contract.md#tokenlist) · [token.revoke](api-contract.md#tokenrevoke) · [token.getCurrent](api-contract.md#tokengetcurrent) · [features.md → deploy, connect webhook, verify, tear down](features.md#adopter-lifecycle)
- **Ships:**
  - [ ] App stack with HTTP API, ingest, SQS (13 days) and DLQ (14 days), worker ESM with `MaximumConcurrency`, batch size 10 and `ReportBatchItemFailures`, no VPC; evidence: CDK assertion tests on the synthesized template, including that each function's environment carries exactly its names-object keys (`packages/shared/src/function-env.ts`).
  - [ ] Ingest decodes both body encodings and answers `200` after enqueue, `401` on a bad signature and `503` when the enqueue fails; evidence: unit tests for both encodings and the three responses.
  - [ ] Worker builds its failure list from per-message results; evidence: batch-failure unit test.
  - [ ] On a database outage the worker retries once on a fresh connection, then fails the batch and disables its own ESM; the hourly cron and `ledger worker resume` re-enable it after a successful probe (ADR-015); evidence: error-classification unit test and a Testcontainers test where no message reaches the DLQ.
  - [ ] Hashed `api_tokens` with `read` and `operate` scopes, `ledger token create|list|revoke|current`, the first `operate` token issued by the deploy command; evidence: API and CLI tests for `401`, `403 forbidden` and `last_operate_token`, and a deploy-command test where a re-run inserts no second first-token.
  - [ ] `ledger health` reports queue depth and age, DLQ depth, event-source state, database reachability and storage used, and answers during a database outage; evidence: integration test through the real auth middleware with Postgres stopped: `GET /health` with a tagged token → `200` reporting the database unreachable, a bad-tag token → `401`, `GET /emails/{email_id}` → `503`.
  - [ ] Guardrails stack with the USD 50 budget, SNS, the kill switch (on in the owner's deployment), the usage trip sized to admit one burst, the steady default-route throttle with its computed worst-case overshoot stated in aws.md → Budget alarms item 7, and a scripted re-arm; AWS-U01 and AWS-U02 settled by the recorded trip drill; evidence: CDK assertion test that the budget, its notifications and the kill-switch wiring exist (aws.md → Budget alarms, item 8).
  - [ ] `pnpm verify` lints migrations for contract-breaking DDL (`DROP`, `RENAME`, `ALTER … TYPE`, `SET NOT NULL`) unless marked as a contract step; evidence: the lint fails on a fixture migration with `DROP COLUMN`.
  - [ ] One deploy command (migrate with the direct URL, then deploy both stacks) and one teardown command; the deploy command refuses an address-hash key whose `key_id` differs from stored hashes, and a pending contract step whose `contract-step` SHA is not an ancestor of the deployed `DeployedCommit` (ADR-018); the teardown command refuses a non-empty queue or DLQ without `--discard-queued`; evidence: a deploy-command test for each refusal, a teardown test for its refusal, and a post-destroy listing of stack-tagged resources finds nothing billable.
  - [ ] The deploy command creates a DML-only runtime role that cannot delete from `webhook_events`, with role-level `idle_in_transaction_session_timeout` and `lock_timeout` below the worker timeout ([integrations.md → How it is used](integrations.md#decision--neon)); evidence: integration test for `permission denied` on `DELETE FROM webhook_events` and on `CREATE TABLE`, and one where an idle lock holder does not stop the worker committing.
  - [ ] PG-U01 settled from Neon's docs or support; PG-U02 settled by a deployed test where two transactions on one `email_id` serialize through the pooled URL; PG-U06 settled by `SHOW idle_in_transaction_session_timeout` through the pooled URL.
  - [ ] Verify stage walked with one Ask-first send to `delivered@resend.dev`, `ledger email` showing `delivered` and `ledger health` showing queue and DLQ at 0; it settles RS-U14 and AWS-U04.
  - [ ] RS-U21 settled by the Ask-first two-recipient send from the project's verified sending domain to `delivered@resend.dev` and `bounced@resend.dev`, observing each event's own `data.to` (through `resend webhooks listen` or the deployed ledger's stored payload and `ledger email`), with the result in resend.md.
  - [ ] RS-U07 closed by the Ask-first test webhook pointed at an endpoint that returns `401`, or proved safe by the exact-`200` contract, its row citing the result.
  - [ ] AWS-U03, AWS-U05, AWS-U06, AWS-U07, AWS-U09, AWS-U10 and PG-U04 closed or proved safe either way, each [Unverified] row citing its test, measurement or teardown drill.
- **UI surfaces:** deploy command · teardown command · `POST /webhooks/resend` (deployed) · `ledger email <email_id>` · `ledger recipient <address>` · `ledger health` · `ledger worker resume` · `ledger token create|list|revoke|current` · trip drill and re-arm scripts.
- **Ops:** owner: approve the first deploy and every AWS resource (Ask-first); an AWS account on the Paid plan (AWS-51), CDK-bootstrapped in us-east-2, with `aws lambda get-account-settings` read before the deploy (AWS-U05); a Neon Free project in `aws-us-east-2` and its direct and pooled URLs; create the Resend webhook for the ingest URL and put its signing secret in Secrets Manager; approve the verify-stage send and the RS-U07 experiment (Ask-first); verify the project's sending domain in Resend and approve the RS-U21 two-recipient send (Ask-first); optionally run the RS-U01 / RS-U20 replay experiment on the verify-stage event and the RS-U02 read-only id check (Ask-first replay; [slice 4](#4--recovery) still owes them, and an early result de-risks its design); confirm any SNS email subscription the guardrails stack creates (CBL-03); run the trip drill.
- **Deferred tail:** Alarms, runbook, DLQ inspect and redrive, simulator secret, burst and chaos runs ([slice 3](#3--operations-and-evidence-on-aws)). Reconciler and its Resend key ([slice 4](#4--recovery)). Scripted webhook creation (tripwire in [architecture.md → Deferred](architecture.md#deferred-yagni)).

### 3 — Operations and evidence on AWS

- **Status:** `[ ]`
- **Goal:** The deployed stack is operable and its reliability claims are measured: alarms reach the owner with runbook entries, poison messages are inspected and redriven from the CLI, and burst, outage and poison runs prove invariants 1, 2 and 4 on AWS.
- **Depends on:** 2.
- **Refs:** [ADR-002](architecture.md#adr-002--sqs-standard-not-fifo) · [ADR-008](architecture.md#adr-008--backpressure-bounded-concurrency-partial-batch-failure-dlq) · [ADR-015](architecture.md#adr-015--the-worker-pauses-its-own-event-source-on-a-database-outage) · [ADR-016](architecture.md#adr-016--the-simulator-reaches-aws-only-through-an-opt-in-simulator-secret) · [aws.md → CloudWatch and SNS](aws.md#cloudwatch-and-sns) · [dlq.listMessages](api-contract.md#dlqlistmessages) · [dlq.startRedrive](api-contract.md#dlqstartredrive) · [features.md → operate](features.md#adopter-lifecycle) · [J4](features.md#j4--poison-message--redrive) · [J7](features.md#j7--burst)
- **Ships:**
  - [ ] CloudWatch alarms → SNS → email, each with one runbook entry; evidence: the alarm-to-runbook link check.
  - [ ] `ledger dlq inspect` returns a sample with no address, subject or payload, and `ledger dlq redrive` refuses a second concurrent task; evidence: API and CLI tests, plus a redaction test on the inspect output.
  - [ ] Off-by-default simulator secret (ADR-016); evidence: CDK assertion test (without the flag, no secret and no ingest reference), a unit test rejecting a simulator-signed request when the secret is absent, and a unit test that a simulator-signed event is stamped `simulated`.
  - [ ] `pnpm sim --burst 10000/10s` on the deployed stack, recipients spread over `+label` test addresses, passes invariants 1 and 2 and records the ingest p99, closing RS-U08, and the bytes per event that set the [storage budget](integrations.md#cadence-and-the-database), with PG-U07 settled from Neon's docs or support, or a write over the limit, by that measurement; evidence: a test where the throttle changes mid-burst and `finally` leaves it.
  - [ ] `pnpm sim --chaos db-outage` on AWS keeps ingest at `200` and the DLQ at 0, and the queue drains after resume, with invariants 1 and 2; the queue-age alarm email reaches the owner within the hour, recorded with the run.
  - [ ] A poison message reaches the DLQ after `maxReceiveCount` while the others commit (invariant 4), and a redrive after the fix returns the depth to 0.
  - [ ] `pnpm sim --duplicates 0.2 --shuffle` passes invariants 1 and 2 through the deployed queue (ADR-002).
- **UI surfaces:** `pnpm sim --burst 10000/10s` · `pnpm sim --chaos db-outage` · `pnpm sim` poison run · `ledger dlq inspect` · `ledger dlq redrive` · `ledger health` · alarm email.
- **Ops:** owner: confirm the SNS email subscription; check the account concurrency quota against the burst (AWS-U05) and request an increase if it falls short; set the simulator flag in the owner's deployment only; approve the redeploys (Ask-first); watch the budget during the burst.
- **Deferred tail:** Published latency, drain and cost numbers ([slice 9](#9--real-aws-burst-numbers)). MCP `inspect_dlq` and `redrive_dlq` ([slice 5](#5--mcp-server-and-contract-hardening)). Local-mode DLQ ([slice 2B](#2b--local-mode-queue-and-docker-compose)).

### 4 — Recovery

- **Status:** `[ ]`
- **Goal:** Events missed during an outage longer than Resend's retry schedule are found by id diff and replayed through ingest, hourly and on demand, with no duplicates.
- **Depends on:** 3.
- **Refs:** [ADR-007](architecture.md#adr-007--recovery-by-id-diff-and-replay-through-ingest) · [ADR-009](architecture.md#adr-009--multi-secret-verification-and-timestamp-tolerance) · [ADR-012](architecture.md#adr-012--resend-client-is-the-sole-resend-api-caller) · [resend.md → Headless Webhook API](resend.md#headless-webhook-api-rs-13rs-18) · [integrations.md → Locked rules](integrations.md#locked-rules-must) · [integrations.md → Secrets layout](integrations.md#secrets-layout) · [reconcile_runs](data-modeling.md#reconcile_runs--one-row-per-recovery-run) · [gaps.list](api-contract.md#gapslist) · [reconcile.getRun](api-contract.md#reconcilegetrun) · [reconcile.start](api-contract.md#reconcilestart) · [health.get](api-contract.md#healthget) · [features.md → recover, rotate secret](features.md#adopter-lifecycle) · [J3](features.md#j3--outage--recovery) · [J5](features.md#j5--secret-rotation)
- **Ships:**
  - [ ] `packages/resend-client` with one 2 req/s limiter that yields on low `ratelimit-remaining` and waits `retry-after` on `429`, every response checked and mapped by status then name; evidence: limiter unit tests.
  - [ ] Reconciler on the hourly cron and on demand writes one `reconcile_runs` row per run, claims it before any Resend call (`claimed_at`, invoke `MaximumRetryAttempts: 0`) and never overlaps; evidence: an integration test where two concurrent starts yield one run and one `reconcile_in_progress`, one where a second invoke of a claimed run makes no Resend call, and a fake-API integration test where an outage past the retry schedule ends 100 % recovered with 0 duplicates, and a 5-day gap since the last good run is recovered with no `--lookback`.
  - [ ] A disabled webhook stops the run with `webhook_disabled`, and a `429` storm with `retry-after` still completes; evidence: fake-API integration tests.
  - [ ] `ledger gaps [--since]` and `ledger reconcile [--dry-run] [--lookback] [--no-wait]`, polling until the run is finished or `run_abandoned`, with the last run in `ledger health`; evidence: SDK ↔ API contract tests (a run with no `finished_at` past its time budget reads `run_abandoned`) and CLI `--json` output tests.
  - [ ] Rotation runbook entry, and ingest emitting the `ingest.rejected{reason}` metric the runbook watches; evidence: unit test with a fake clock where a secret removed from the store gets `401` once the 5-minute cache TTL passes and emits `ingest.rejected` with `reason=signature`.
  - [ ] RS-U01 and RS-U20 settled by one Ask-first replay of a stored event on the owner's webhook; RS-U02 settled read-only by comparing stored `svix_id`s with List Events ids.
  - [ ] RS-U03 reach of at least the 3-day lookback, RS-U13 visibility lag and RS-U17 revoked-key status closed by read-only checks; PG-U03 proved safe either way (Free never bills; a quota suspension or a full store pauses the worker while the queue holds events, ADR-015), its row citing that, with the 30-idle-day usage reading added beside aws.md → Cost shape when it exists; RS-U06 proved safe by the status read every run.
  - [ ] RS-U04 and RS-U05 closed by the Ask-first disabled-webhook experiments, RS-U09 by an Ask-first secret rotation on a test webhook, RS-U10 by the RS-U01 replay, or each proved safe either way, its row citing the result.
  - [ ] A gap script for the owner's deployment produces one real gap: it lowers the ingest route throttle to its stop value, makes one Ask-first send to `delivered@resend.dev`, restores the throttle after the grace window and before Resend's next scheduled retry (RS-09), then runs `ledger reconcile --dry-run` (1 missing), `ledger reconcile` and `ledger gaps` (0 missing); evidence: the recorded run.
  - [ ] M1 boundary: the README states only claims whose evidence landed in slices 0–4, with 0 unlinked claims and the CI link check green.
- **UI surfaces:** `ledger gaps --since 24h` · `ledger reconcile --dry-run` · `ledger reconcile` · `ledger health` · the hourly cron run.
- **Ops:** owner: a `full_access` Resend key in Secrets Manager for the reconciler only, and the webhook id as a deploy input; approve the replay experiment and the disabled-webhook experiments (Ask-first); walk the M1 demo against the kept deploy.
- **Deferred tail:** RS-U03 re-measured before M2 closes ([slice 7](#7--polish-and-retention)). MCP `list_gaps` and `reconcile` ([slice 5](#5--mcp-server-and-contract-hardening)).

## M2 — Feature complete

Every [idea §7](../docs/idea.md#7-implementation-plan) phase at v0 depth, a real AWS deploy,
simulator evidence.

### 2B — Local-mode queue and docker compose

- **Status:** `[ ]`
- **Goal:** The whole system runs with `docker compose up` and no AWS account, through a Postgres-backed queue behind the same port.
- **Depends on:** 3. MUST land before M2 closes ([slice 7](#7--polish-and-retention)).
- **Refs:** [ADR-013](architecture.md#adr-013--pure-core-and-local-mode) · [local_queue_messages](data-modeling.md#local_queue_messages--the-local-mode-queue) · [health.get](api-contract.md#healthget) · [dlq.listMessages](api-contract.md#dlqlistmessages) · [dlq.startRedrive](api-contract.md#dlqstartredrive)
- **Ships:**
  - [ ] Postgres-backed queue (`FOR UPDATE SKIP LOCKED`, pooler-safe) implements the queue port with receive counts and dead rows; evidence: Testcontainers tests for claim, retry and dead-lettering.
  - [ ] `docker compose up` starts Postgres and `apps/local` (ingest, worker and the read API), and `pnpm sim` against it passes invariants 1, 2 and 4.
  - [ ] `ledger health`, `ledger dlq inspect` and `ledger dlq redrive` work in local mode; evidence: the same contract tests run against both modes.
  - [ ] Compose publishes the API on `127.0.0.1` only, and a local setup command issues the first `operate` token through the deploy command's code path; evidence: contract test that local mode answers `401` without a token.
- **UI surfaces:** `docker compose up` · `pnpm sim` (local mode) · `ledger health` · `ledger dlq inspect` · `ledger dlq redrive`.
- **Ops:** — none (Docker on the developer's machine).
- **Deferred tail:** — none.

### 5 — MCP server and contract hardening

- **Status:** `[ ]`
- **Goal:** An AI agent answers "why did this delivery fail?" from MCP alone, under least privilege, with no PII in tool output.
- **Depends on:** 4.
- **Refs:** [ADR-011](architecture.md#adr-011--one-contract-many-surfaces) · [ADR-019](architecture.md#adr-019--application-and-surface-stack) · [api-contract.md → Conventions](api-contract.md#conventions) · [Error codes](api-contract.md#error-codes) · [email.explainDelivery](api-contract.md#emailexplaindelivery) · [email.get](api-contract.md#emailget) · [recipient.get](api-contract.md#recipientget) · [gaps.list](api-contract.md#gapslist) · [dlq.listMessages](api-contract.md#dlqlistmessages) · [token.getCurrent](api-contract.md#tokengetcurrent) · [reconcile.start](api-contract.md#reconcilestart) · [dlq.startRedrive](api-contract.md#dlqstartredrive) · [J6](features.md#j6--agent-explanation-via-mcp) · [about.md → Open questions](about.md#open-questions)
- **Ships:**
  - [ ] `email.explainDelivery` as a pure `packages/core` function with a closed verdict set, served through `ledger explain <email_id>`, the SDK and MCP `explain_delivery`; evidence: a unit test per verdict and a contract test.
  - [ ] MCP server on the SDK with `get_email_status`, `get_recipient_status`, `list_gaps`, `inspect_dlq` and `explain_delivery`, choosing its tools at startup through `token.getCurrent`; evidence: MCP tool tests.
  - [ ] Operate tools `reconcile` and `redrive_dlq` are not registered under a `read` token; evidence: tool-registration test per scope.
  - [ ] Every tool's output carries masks only, no secrets, no payload and no free-text payload field; evidence: redaction tests, including a fixture whose `failed.reason` and `tags` carry an instruction string.
  - [ ] Every code in api-contract.md → Error codes exists in code, and no other; evidence: error-registry mirror test.
  - [ ] SDK retries idempotent reads and never `token.create`; evidence: SDK unit tests.
- **UI surfaces:** MCP `get_email_status` · `explain_delivery` · `get_recipient_status` · `list_gaps` · `inspect_dlq` · `reconcile` · `redrive_dlq` · `ledger explain <email_id>`.
- **Ops:** owner approves the MCP SDK dependency (Ask-first); an MCP client to walk J6.
- **Deferred tail:** SDK and CLI on npm ([slice 8](#8--npm-release)).

### 6 — Reactions

- **Status:** `[ ]`
- **Goal:** Reactions fire exactly once on top of at-least-once delivery.
- **Depends on:** 5.
- **Refs:** [ADR-006](architecture.md#adr-006--transactional-outbox-for-reactions) · [ADR-017](architecture.md#adr-017--the-dispatcher-is-triggered-after-commit-plus-an-hourly-sweep) · [outbox](data-modeling.md#outbox--reactions-awaiting-delivery) · [integrations.md → Secrets layout](integrations.md#secrets-layout) · [resend.md → Idempotent sends](resend.md#idempotent-sends-rs-17-rs-24) · [features.md → Reactions](features.md#reactions) · [features.md → extend](features.md#adopter-lifecycle)
- **Ships:**
  - [ ] Outbox rows with a unique `dedupe_key` written in the causing event's transaction; evidence: integration test.
  - [ ] Dispatcher invoked after commit plus the hourly sweep, claiming due rows under row locks; evidence: integration test where an invoke dropped after commit is delivered by the sweep, once.
  - [ ] Signed app callback with stable ids; evidence: signature unit test.
  - [ ] Alert email through a `sending_access` key with an `Idempotency-Key` derived from `dedupe_key`, retries stopping inside 24 h; evidence: retry-horizon unit test.
  - [ ] Reactions caused by `source = simulated` events reach only the simulator's receiver sink; evidence: integration test with a fake Resend that records no call.
  - [ ] `pnpm sim --chaos worker-crash:0.05` and `--chaos dispatcher-crash:0.05` on AWS produce no second effect at a receiver (invariant 3).
  - [ ] `ledger health` shows the outbox's pending and dead counts and its oldest pending age, and an alarm fires on a dead entry; evidence: contract test and an integration test that drives a row to `dead`.
  - [ ] RS-U16 proved safe with one sending key, its row citing the secrets layout.
- **UI surfaces:** `pnpm sim --chaos worker-crash:0.05` · alert email at the owner's Resend account address · app callback receiver.
- **Ops:** owner: a `sending_access` Resend key in Secrets Manager for the dispatcher; approve live alert sends (Ask-first); alerts go from `resend.dev` to the owner's own address (project-domain tripwire in [architecture.md → Deferred](architecture.md#deferred-yagni)).
- **Deferred tail:** Any reaction seam beyond the app callback and the alert email (tripwire in [features.md → extend](features.md#adopter-lifecycle)).

### 7 — Polish and retention

- **Status:** `[ ]`
- **Goal:** A newcomer deploys Ledger and runs the demo from the README in 15 minutes or less, and raw payloads are redacted on schedule without breaking rebuilds.
- **Depends on:** 6 and 2B.
- **Refs:** [ADR-014](architecture.md#adr-014--raw-payload-retention-and-redaction) · [PII & retention](data-modeling.md#pii--retention) · [about.md → Success metrics](about.md#success-metrics) · [J1](features.md#j1--first-deploy) · [resend.md → \[Unverified\]](resend.md#unverified)
- **Ships:**
  - [ ] Retention job masks `to`, `from` and `subject` and nulls unread fields after N days, in every event type; evidence: integration test where a rebuild after redaction yields identical projections, and a `contact.created` fixture (test address) holds no raw address or name afterwards.
  - [ ] `docs/results.md` holds the simulator results from slices 1–6, each linked to its run.
  - [ ] Runbook covers every alarm, secret rotation, a database outage and the kill-switch re-arm; evidence: the alarm-to-runbook link check.
  - [ ] README quick start, with a timed newcomer deploy of 15 minutes or less recorded.
  - [ ] RS-U03 re-measured once the owner's webhook is older than 30 days, its row updated.
  - [ ] M2 boundary: slice 2B done, 0 unlinked README claims, and the deploy and demo coherent.
- **UI surfaces:** README quick start (timed walk) · deploy command · retention job run · `ledger email <email_id>` after redaction.
- **Ops:** owner: time the newcomer walk; approve the redeploy (Ask-first).
- **Deferred tail:** Inngest adapter, read-only UI and inbound projection (tripwires in [about.md → Open questions](about.md#open-questions)).

## M3 — Stretch

npm releases with semver, real AWS load numbers, a learning log. Any order once M2 is done.

### 8 — npm release

- **Status:** `[ ]`
- **Goal:** Adopters install the SDK and CLI from npm with semver guarantees.
- **Depends on:** 7; the final name ([about.md → Open questions](about.md#open-questions)).
- **Refs:** [api-contract.md → Conventions](api-contract.md#conventions) · [features.md → Interfaces](features.md#interfaces)
- **Ships:**
  - [ ] Final name picked and recorded in about.md before the first publish.
  - [ ] Release workflow publishes `packages/sdk` and `apps/cli` with semver and provenance, only from tags on `main`, through npm trusted publishing (no stored token); evidence: the published versions on npm.
  - [ ] An `npx` install of the published CLI reads an email from the deployed stack.
  - [ ] M3 boundary, if this is the last open M3 card: 0 unlinked README claims, and the deploy and demo coherent; evidence: the CI link check.
- **UI surfaces:** `npx <cli-package> email <email_id>` · `npm view <sdk-package> versions`.
- **Ops:** owner: npm account and package names; approve the release workflow (Ask-first: CI change) and each publish.
- **Deferred tail:** — none.

### 9 — Real-AWS burst numbers

- **Status:** `[ ]`
- **Goal:** One measured 10k burst on real AWS, with latency, drain time and cost published.
- **Depends on:** 7.
- **Refs:** [about.md → Success metrics](about.md#success-metrics) · [aws.md → Cost shape](aws.md#cost-shape) · [J7](features.md#j7--burst) · [features.md → Evidence harness](features.md#evidence-harness)
- **Ships:**
  - [ ] One recorded `pnpm sim --burst 10000/10s` on the deployed stack, with p50/p99 ingest latency and queue drain time in `docs/results.md`.
  - [ ] The burst's AWS cost from Cost Explorer recorded beside it.
  - [ ] M3 boundary, if this is the last open M3 card: 0 unlinked README claims, and the deploy and demo coherent; evidence: the CI link check.
- **UI surfaces:** `pnpm sim --burst 10000/10s` · the Cost Explorer line.
- **Ops:** owner: approve the burst run; read Cost Explorer.
- **Deferred tail:** — none.

### 10 — Learning log

- **Status:** `[ ]`
- **Goal:** The AWS and distributed-systems decisions are told as a log a reviewer can check.
- **Depends on:** 7.
- **Refs:** [architecture.md → Decisions](architecture.md#decisions) · [aws.md → Learning notes](aws.md#learning-notes)
- **Ships:**
  - [ ] A learning log in `docs/` with each entry linked to its ADR, test or measured number; evidence: the CI link check.
  - [ ] M3 boundary, if this is the last open M3 card: 0 unlinked README claims, and the deploy and demo coherent; evidence: the CI link check.
- **UI surfaces:** the log's links.
- **Ops:** — none.
- **Deferred tail:** — none.
