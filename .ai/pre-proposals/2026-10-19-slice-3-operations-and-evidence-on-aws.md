# Pre-proposal — slice 3: Operations and evidence on AWS

| Field | Value |
| --- | --- |
| **Slice** | 3 — [Operations and evidence on AWS](../build-checklist.md#3--operations-and-evidence-on-aws) |
| Change name | `slice-3-operations-and-evidence-on-aws` → `openspec/changes/slice-3-operations-and-evidence-on-aws/` (`openspec/changes/` holds only `archive/`: slices 0, 1 and 2) |
| Date | 2026-10-19 |
| Card status | `[ ]` (0 of 7 `Ships` boxes ticked) |
| Depends on | 2 — `[!]` ([card](../build-checklist.md#2--durable-ingest-on-aws): Ships 7's AWS-U01 second half, walkthrough F4; four other boxes unticked). See §4 |
| Track | Spine (0 → 1 → 2 → **3** → 4 → …) |
| Touches | `packages/core` (testing only), `packages/shared`, `packages/db` (testing only), `packages/ingest`, `packages/api`, `packages/sdk`, `packages/aws`, `apps/ingest`, `apps/api`, `apps/local`, `apps/cli`, `infra`, `sim`, `docs/runbook.md` (new), `.env.example`, `.ai/` docs, root `AGENTS.md`, five skills' text |
| Earlier pre-proposal | None for this slice |
| Branch | `worktree-slice-3-operations-evidence` (at `8e37a70`, clean) |
| Owner round | 2026-10-19: one decision (PG-U07, D30) and the itemized Ask-first approvals (§7), all approved |
| Checked | Not yet |

## 1. Why now

Slice 3 is the next spine card. It turns slice 2's deployed stack into one an operator can run and
a reviewer can check. Slice 2 left the stack deployed with two alarms (the usage trip and the
kill-switch `Errors` alarm) but no runbook. The DLQ exists, but nothing on any surface inspects or
redrives it. The reliability claims that only a deployed queue can carry (no loss under a burst
and a database outage, poison isolation, order independence through SQS) are still "pending —
slice 3" in four ADRs' **Evidence** lines
([ADR-001](../architecture.md#adr-001--verify-then-enqueue),
[ADR-002](../architecture.md#adr-002--sqs-standard-not-fifo),
[ADR-008](../architecture.md#adr-008--backpressure-bounded-concurrency-partial-batch-failure-dlq),
[ADR-015](../architecture.md#adr-015--the-worker-pauses-its-own-event-source-on-a-database-outage)).
Slice 4's reconciler builds on this slice's runbook, its alert topic wiring and the simulator's AWS
mode. PG-U07 is owed here
([architecture.md → Open questions owed by slice](../architecture.md#open-questions-owed-by-slice)),
so the ADR-015 out-of-storage path must stop resting on a guess. The build cost is low: every AWS
client the slice needs is already installed in `packages/aws`, no schema changes, and no live Resend
write is needed.

## 2. Scope — the `Ships` list, verbatim

From [build-checklist.md → 3](../build-checklist.md#3--operations-and-evidence-on-aws), links
rewritten to resolve from this file:

1. CloudWatch alarms → SNS → email, each with one runbook entry; evidence: the alarm-to-runbook link check.
2. `ledger dlq inspect` returns a sample with no address, subject or payload, and `ledger dlq redrive` refuses a second concurrent task; evidence: API and CLI tests, plus a redaction test on the inspect output.
3. Off-by-default simulator secret (ADR-016); evidence: CDK assertion test (without the flag, no secret and no ingest reference), a unit test rejecting a simulator-signed request when the secret is absent, and a unit test that a simulator-signed event is stamped `simulated`.
4. `pnpm sim --burst 10000/10s` on the deployed stack, recipients spread over `+label` test addresses, passes invariants 1 and 2 and records the ingest p99, closing RS-U08, and the bytes per event that set the [storage budget](../integrations.md#cadence-and-the-database), with PG-U07 settled from Neon's docs or support, or a write over the limit, by that measurement; evidence: a test where the throttle changes mid-burst and `finally` leaves it.
5. `pnpm sim --chaos db-outage` on AWS keeps ingest at `200` and the DLQ at 0, and the queue drains after resume, with invariants 1 and 2; the queue-age alarm email reaches the owner within the hour, recorded with the run.
6. A poison message reaches the DLQ after `maxReceiveCount` while the others commit (invariant 4), and a redrive after the fix returns the depth to 0.
7. `pnpm sim --duplicates 0.2 --shuffle` passes invariants 1 and 2 through the deployed queue (ADR-002).

**UI surfaces (card):** `pnpm sim --burst 10000/10s` · `pnpm sim --chaos db-outage` · `pnpm sim`
poison run · `ledger dlq inspect` · `ledger dlq redrive` · `ledger health` · alarm email.

**Owner ruling on Ships 4 (2026-10-19, D30):** the bullet's PG-U07 clause is reworded at apply
time to "settled from Neon's docs, source or support, or a write over the limit". The owner chose
"Cite Neon's source" in this round. That is a scope wording the owner made, recorded under §22,
not a change this document applies.

## 3. Out of scope

The card's `Deferred tail`, verbatim:

> Published latency, drain and cost numbers ([slice 9](../build-checklist.md#9--real-aws-burst-numbers)). MCP `inspect_dlq` and `redrive_dlq` ([slice 5](../build-checklist.md#5--mcp-server-and-contract-hardening)). Local-mode DLQ ([slice 2B](../build-checklist.md#2b--local-mode-queue-and-docker-compose)).

Plus what the harvest suggested that the card does not carry:

| Item | Where it lives | Trigger |
| --- | --- | --- |
| The reconcile-gap alarm ([data-modeling.md → outbox, Operational alerts](../data-modeling.md#outbox--reactions-awaiting-delivery): "reconcile gaps, DLQ depth and queue age go through CloudWatch → SNS") | [Slice 4](../build-checklist.md#4--recovery): the reconciler and its `reconcile.*` metrics do not exist yet | Slice 4 lands the reconciler |
| `ingest.rejected{reason}` metric and the rotation runbook entry | [Slice 4](../build-checklist.md#4--recovery) Ships 5 | Slice 4 |
| A complete runbook (every entry beyond what an alarm or an error code links) | [Slice 7](../build-checklist.md#7--polish-and-retention) ("runbook complete"); [api-contract.md → Error codes](../api-contract.md#error-codes): entries "owed by slice 3 and completed in slice 7" | Slice 7 |
| `--burst`, `--chaos db-outage` and `--poison` against local mode | [Slice 2B](../build-checklist.md#2b--local-mode-queue-and-docker-compose) ("`pnpm sim` against it passes invariants 1, 2 and 4") | Slice 2B lands the Postgres-backed queue |
| The Postgres-backed queue's DLQ (dead rows of `local_queue_messages`) | Slice 2B (Deferred tail above). This slice gives the **in-process** queue the DLQ port only (D3, C2) | Slice 2B |
| Slice 2's unrecorded results (task 13.8: the AWS-U01…U12 and PG-U01…U06 rows) | [Slice 2](../build-checklist.md#2--durable-ingest-on-aws), `[!]` on F4 | Slice 2's own close-out. This slice updates only the AWS-U05 row it owes (D29) |
| SDK retries for `dlq.listMessages` | [Slice 5](../build-checklist.md#5--mcp-server-and-contract-hardening) ([Conventions → Idempotency](../api-contract.md#conventions)) | Slice 5 |
| Cost Anomaly Detection | [Deferred (YAGNI)](../architecture.md#deferred-yagni): temporal | A trip drill or a bill shows spend past 80 % of the cap without an alert |
| Any alarm on Lambda `Throttles`, worker `Errors` or a custom EMF metric | Lens clause 5: no claim in this slice depends on them. Ingest throttling surfaces as HTTP API `5xx` (D17), and a worker failure surfaces as DLQ depth (D17) | A runbook entry or a walk finds a failure that none of the five alarms catches |

## 4. Prerequisites

| Prerequisite | State | Blocking? |
| --- | --- | --- |
| Slice 2 `[x]` | **`[!]`** on F4 (the drill budget cannot trip an account spending USD 0.00; AWS-U01's second half). Also unticked: Ships 9 (deploy/teardown evidence), 11 (PG-U01/U02/U06), 12 (verify stage), 15 (the smaller AWS and PG rows). The archived change's tasks 13.2–13.9 and 14.2 are unticked, although its [WALKTHROUGH-RUN.md](../../openspec/changes/archive/2026-10-18-slice-2-durable-ingest-on-aws/WALKTHROUGH-RUN.md) walked them and records the results ("Settled by this run": AWS-U05 quota 50, AWS-U06, AWS-U04, AWS-U02 status half, AWS-U11, PG-U06, PG-U02, PG-U04, AWS-U01 first half) | **Risk, not a blocker.** The owner opened this slice's worktree on a parallel track. Slice 3 builds on the deployed shape, which the walk proved working. What lags is slice 2's paperwork and AWS-U01's budget half. Slice 3 MUST NOT tick slice 2 boxes. It updates only the AWS-U05 row it owes itself (D29) |
| The kept deploy | Both stacks up (WALKTHROUGH-RUN "Data created": the rerun's T3 kept), the production webhook repointed, `bootstrap` token held by the owner | No |
| The alert topic's email subscription | Confirmed by the owner 2026-10-18 (WALKTHROUGH-RUN, "Held for the owner"). The three new alarms publish to the same `LedgerGuardrails-alert` topic (D17), so no new subscription is created | No. Re-confirm only after a teardown and redeploy ([CBL-03](../check-before-launch.md#deploy-configuration)) |
| Account Lambda concurrency quota | **50**, read in slice 2's walk (AWS-U05). The burst needs at least 1,000 (D25) | **Blocks Ships 4 only.** Owner op: a Service Quotas increase request (§25). Every other bullet runs at 50 |
| `.env.deployed.local` | Holds the deployed `LEDGER_URL` and the `bootstrap` `LEDGER_TOKEN` ([rsa-manual-test → environment.md](../../.agents/skills/rsa-manual-test/references/environment.md)) | Owner op (§25): add `DATABASE_URL` = the deployed database's **pooled URL with owner credentials** (the value of `LEDGER_DEPLOY_DATABASE_POOLED_URL`), so AWS sim runs check invariants against Neon, and `--poison` can add its fault (D27) |
| `LEDGER_SIMULATOR=on` in the owner's `.env.local` | New public variable (D11) | Owner op before the redeploy (§25) |
| AWS credentials | SSO profile `ledger`, us-east-2. The sim's AWS steps and the deploy use the default chain | `aws sso login` on expiry |
| Open questions the slice depends on | PG-U07 (settled here, D30). RS-U08 (closed here by the burst, D26). AWS-U05 (burst half, D25/D29). New: AWS-U14 and AWS-U15 (§6 C9, C10), both safe either way | None blocks |

## 5. Reality check — per-`Ships`-item verdict

Checked against `8e37a70` (clean).

| # | Verdict | Evidence | What remains |
| --- | --- | --- | --- |
| 1 | **partial** | Two alarms exist: `LedgerApp-usage-trip` → trip topic (`infra/src/app.stack.ts:247-258`) and `LedgerGuardrails-kill-switch-errors` → alert topic (`infra/src/guardrails.stack.ts:170-181`). Neither has an `AlarmDescription`. There is no queue-age, DLQ-depth or 5xx alarm. No `docs/runbook.md` exists (`ls docs` → `idea.md` only). `packages/core/src/error-codes.ts:31-33`: "Its entries are slice 3's, so these links 404 until then" | Three alarms (D17), descriptions on all five (D18), the runbook (D19), and the link check (D20) |
| 2 | **absent** | No DLQ port (`packages/shared/src` has no `dlq.port.ts`), no SQS DLQ adapter (`packages/aws/src`), no route (`packages/api/src`), no SDK method (`packages/sdk/src/create-ledger-client.ts:34-36`: `health`, `worker`, `tokens` only) and no CLI command (`apps/cli/src/commands`). Present: the read API already carries `DLQ_URL` and `sqs:GetQueueAttributes` on the DLQ (`infra/src/app.stack.ts:183,190-195`); `redrive_in_progress` is registered and mirrored (`packages/core/src/error-codes.ts:15,105`); the in-process queue keeps a dead list (`packages/shared/src/in-process-queue.adapter.ts:58,106,175`) | Port, two implementations, routes, SDK, CLI, tests (D1–D10) |
| 3 | **partial** | Ingest already verifies the simulator secret after the Resend set and stamps `simulated` (`packages/ingest/src/create-ingest.ts:79-89`). The stamping test exists (`packages/ingest/src/create-ingest.test.ts:283`). On AWS the secret is wired as `undefined` (`apps/ingest/src/main.ts:29-30`: "no simulator secret on AWS until slice 3"). No CDK secret, no flag, no deploy write | The flag (D11), the CDK secret and its assertions (D12), the read through the port (D13), and the absent-secret rejection test (D13) |
| 4 | **absent** | `sim/src/read-sim-flags.ts:12-17`: four flags, no `--burst`. `sim/src/live-run.ts:41`: sends one request at a time; `:26`: a 30 s settle bound. No throttle raise in `packages/aws` (the kill switch only lowers and restores, `packages/aws/src/kill-switch.ts:85,177`). `ledgerHistory` draws small shared-pool histories (`packages/core/src/testing/ledger-history.ts:212-219`), not a 10k broadcast. PG-U07 `[Unverified]` ([integrations.md](../integrations.md#unverified)); RS-U08 `[Unverified]` ([resend.md](../resend.md#unverified)) | The burst generator, sender, preflight and throttle steps, the storage reading, PG-U07, RS-U08 (D21–D26, D30) |
| 5 | **absent** | No `--chaos`. The ADR-015 machinery exists and is proven on Testcontainers (`packages/worker/src/database-outage.int.test.ts`), and the deployed pause/resume path exists (slice 2) | The chaos mechanism, the alarm wait and the run (D27, D28) |
| 6 | **partial** | The SQS redrive policy (`maxReceiveCount` 5, `infra/src/app.stack.ts:43,133`) and per-message failure (`packages/worker/src/create-worker.int.test.ts`) exist. `sim/src/live-run.ts:112` prints "invariant 4 not checked (slice 3)". No invariant-4 checker, no poison fault, no redrive surface | Invariant 4 (D24), the poison fault (D27), the isolation integration test (§20), and the redrive (D1–D10) |
| 7 | **partial** | `pnpm sim --duplicates 0.2 --shuffle` already runs live against any `LEDGER_URL` (`sim/src/sim.config.ts:155-178`) and checks invariants 1 and 2 through `DATABASE_URL`. It has never run against the deployed queue, and its 30 s settle bound (`sim/src/live-run.ts:26`) is local-sized | The settle bound (D22) and the recorded run against the deployed stack (§21 P6). No new flag |

`openspec/specs/` holds `read-api`, `sdk`, `cli`, `simulator`, `aws-stacks`, `webhook-ingest`,
`deploy-and-teardown` and `local-stack`, so each of those deltas is `MODIFIED` (§23). There is no
runbook capability.

## 6. Contradictions and how each resolves

| # | Sources | Resolution |
| --- | --- | --- |
| C1 | [api-contract.md → `dlq.startRedrive`](../api-contract.md#dlqstartredrive), In / Out: "none → the task handle and the starting depth" **vs.** [`.ai/AGENTS.md` → Rules](../AGENTS.md#rules): "No … account IDs", and [lens clause 6](../../AGENTS.md#decision-lens--evidence-over-claims-right-sized) (security exposure). AWS's own `StartMessageMoveTask` example `TaskHandle`, base64-decoded, is `{"taskId":"dc169e04-…","sourceArn":"arn:aws:sqs:us-east-1:<account id>:MyDeadLetterQueue"}` ([API_StartMessageMoveTask](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/APIReference/API_StartMessageMoveTask.html), decoded 2026-10-19) | **The handle never leaves `packages/aws`.** The response carries the status and the depth at start (D7). There is nothing to poll ([Conventions → Long-running commands](../api-contract.md#conventions): "`dlq.startRedrive` has nothing to poll"). The api-contract edit is an Ask-first contract change, owner-approved 2026-10-19 (§7). The fact becomes AWS-61 (§22) |
| C2 | Card Deferred tail: "Local-mode DLQ (slice 2B)" **vs.** `apps/local` composes `createApi`, which from this slice needs a DLQ port, and [pp-backend → composition.md → Ports](../../.agents/skills/pp-backend/references/composition.md#ports): "Every port with two implementations has one shared contract suite" | **The in-process queue implements the port over the dead list it already keeps** (D3). Precedent: slice 2's D40 gave `InProcessQueueAdapter` `QueueAttributesPort` over the same lists, while local-mode `health.get` is listed for 2B ([api-contract.md → health.get](../api-contract.md#healthget) Slices). 2B's deferral is the Postgres-backed queue's dead rows, which stays deferred. Authority: build cost and testability ([lens clause 3](../../AGENTS.md#decision-lens--evidence-over-claims-right-sized)): the SDK ↔ API contract test runs against `apps/local` on real responses ([sdk-contract.int.test.ts](../../apps/local/src/sdk-contract.int.test.ts)) |
| C3 | Card Ships 1 names runbook entries for alarms only **vs.** [api-contract.md → Error codes](../api-contract.md#error-codes): runbook `docs/runbook.md#<code>` "whose entries are owed by slice 3 and completed in slice 7", and `packages/core/src/error-codes.ts:31-33` | **Both bind; they do not conflict.** The registry assigns the code entries to slice 3. The card's bullet names the alarm entries and their check. The runbook carries both (D19), and the link check covers both (D20). Without it, every `docs` link in every error response is a 404 on the public surface |
| C4 | [aws.md → AWS-U05](../aws.md#unverified) `[Unverified]` "owed by slice 2" **vs.** slice 2's walk, which read the quota as 50 ([WALKTHROUGH-RUN](../../openspec/changes/archive/2026-10-18-slice-2-durable-ingest-on-aws/WALKTHROUGH-RUN.md), "Settled by this run") and never recorded it (task 13.8 unticked) | **The docs lag the run.** Slice 2 carries its own 13.8. AWS-U05's row also says "before `--burst`, slice 3 MUST confirm the quota", so this slice records the read value and the burst half (D29). Every other unrecorded row stays slice 2's (§3) |
| C5 | Card Ships 4: "PG-U07 settled from Neon's docs or support, or a write over the limit" **vs.** Neon's docs, which are silent ([FAQ](https://neon.com/faqs/free-plan-limits-and-quotas): writes "that would increase storage fail"), while Neon's published source raises `errcode(ERRCODE_DISK_FULL)` in `neon_extend` and `neon_zeroextend` ([pagestore_smgr.c](https://github.com/neondatabase/neon/blob/main/pgxn/neon/pagestore_smgr.c), read 2026-10-19) | **Owner-ruled 2026-10-19: cite Neon's source** (D30), and widen the card's wording to "docs, source or support" (§22) |
| C6 | [ADR-016](../architecture.md#adr-016--the-simulator-reaches-aws-only-through-an-opt-in-simulator-secret)'s title "reaches AWS only through an opt-in simulator secret" **vs.** the sim's AWS control-plane steps, ratified for the burst ([aws.md → Budget alarms](../aws.md#budget-alarms) item 7; [pp-testing → simulator.md → The burst and the throttle](../../.agents/skills/pp-testing/references/simulator.md#the-burst-and-the-throttle): "through `@ledger/aws`") and needed here for the chaos and poison faults | **ADR-016 governs how events enter**: every event goes through ingest under the simulator secret, and its "Rejected: injecting straight into SQS" stands. The poison therefore enters through ingest too (D27), never as an SQS send. Control-plane steps run under the owner's credentials through `@ledger/aws`, as item 7 already does. ADR-016 gains one clarifying sentence and its deploy-flag name (§22). This is not a reversal of the decision |
| C7 | [api-contract.md → `dlq.listMessages`](../api-contract.md#dlqlistmessages) Errors: `validation_failed` only, and `dlq.startRedrive`: `forbidden`, `redrive_in_progress` **vs.** [Conventions → Auth](../api-contract.md#conventions): "During a database outage, `health.get` alone accepts a correctly tagged token without the revocation lookup; every other route answers `503` `database_unavailable`" | **Conventions governs**: the auth middleware's token lookup raises `database_unavailable` on both routes. Both entries gain it (an Ask-first contract edit, owner-approved 2026-10-19, §7). The alternative, tag-only auth for DLQ routes too, would widen what a revoked token can do during an outage, and nothing in the docs asks for it |
| C8 | [api-contract.md → `dlq.listMessages`](../api-contract.md#dlqlistmessages): "It parses only the [ingest envelope](../architecture.md#adr-001--verify-then-enqueue) ids and type" **vs.** its own item fields `email_id` and `event_created_at`, which live in the raw body, not the envelope ([ingest-envelope.schema.ts](../../packages/core/src/ingest-envelope.schema.ts): `svixId`, `receivedAt`, `source`, `rawBody`, `headers`) | **The intent is "identifying fields only, never the payload".** The reader parses the envelope, then reads exactly three fields from the raw body: top-level `type`, top-level `created_at` and `data.email_id` (D5). The wording is corrected (§22). This is a fact correction that loosens nothing, and the redaction test pins it (§20) |
| C9 | [aws.md → AWS-21](../aws.md#sqs): "Only one active message movement task is supported per queue" **vs.** the `StartMessageMoveTask` error list (`InvalidAddress`, `InvalidSecurity`, `RequestThrottled`, `ResourceNotFoundException`, `UnsupportedOperation`), which names no "task already running" error | **Refuse from `ListMessageMoveTasks` first** (a `RUNNING` result → `redrive_in_progress`, no start sent; D6). Which error a racing second start raises becomes **AWS-U14**, safe either way: the check runs first, and a racing start's own error propagates as `internal_error`, never as a second task, because SQS enforces one per queue |
| C10 | ADR-015's chaos evidence assumes the deployed worker meets an unreachable database **vs.** the worker building its pool once per container from the `ledger/database` secret (`apps/worker/src/main.ts:38-53`), so a changed secret reaches only new containers | **D27's db-outage repoints the secret, then recycles the functions with `UpdateFunctionConfiguration`.** Whether a configuration update sends later invocations to new execution environments is undocumented (search 2026-10-19), so it becomes **AWS-U15**, owed by slice 3 and safe either way: without a pause inside the run's bound, the run fails loudly and restores, and no event is lost |
| C11 | [pp-testing → simulator.md → Ground truth and runs](../../.agents/skills/pp-testing/references/simulator.md#ground-truth-and-runs): "polls … every 250 ms, up to 30 s" **vs.** a 10,000-event drain at `MaximumConcurrency` 5 | **The bound scales with the run** (D22). The skill text is a fact update for a mechanism this slice owns, not a loosened rule (§22) |

None found, having also checked these pairs: card UI surfaces ↔ api-contract Surfaces lines
(`ledger dlq inspect [--limit <1-10>]`, `ledger dlq redrive`, no `--no-wait`; [pp-cli → Never](../../.agents/skills/pp-cli/SKILL.md#never));
ADR-008 ↔ `infra/src/app.stack.ts` (`MAX_RECEIVE_COUNT` 5, visibility timeout derived);
AWS-22 ↔ the planned alarms (`TreatMissingData: notBreaching`); the Secrets layout ↔ the
simulator secret (logical name, ingest only, owner's deployment only); aws.md Cost shape ↔ the
alarm count (5 of 10 free, AWS-28); data-modeling.md `webhook_events.source` ↔ the stamping test.

## 7. Decisions

**Ask-first approvals** (owner round, 2026-10-19):

| Item | Exact scope | Status | Used by |
| --- | --- | --- | --- |
| DLQ contract | `dlq.listMessages` → `GET /dlq/messages?limit=1…10` (default 10) and `dlq.startRedrive` → `POST /dlq/redrive`, with this document's wire shapes (D5, D7); SDK `ledger.dlq.listMessages({ limit? })` and `ledger.dlq.startRedrive()`; CLI `ledger dlq inspect [--limit <1-10>] [--json]` and `ledger dlq redrive [--json]`; api-contract edits: `dlq.startRedrive` returns no task handle (C1), and both entries list `database_unavailable` (C7) | owner-approved 2026-10-19 | Groups 3, 4 |
| Public inputs | Public variable `LEDGER_SIMULATOR` (`on` \| `off`, default `off`), read by `pnpm aws:deploy`; with `on`, the deploy also requires `LEDGER_SIMULATOR_SECRET` (an existing public variable, new reader) and writes it into `ledger/simulator-signing-secret`. `pnpm sim` flags `--burst <events>/<seconds>s` (events ≤ 10,000), `--chaos db-outage` and `--poison <1-10>` | owner-approved 2026-10-19 | Groups 7, 8 |
| Template resources | App stack: alarms `LedgerApp-queue-age`, `LedgerApp-dlq-depth` and `LedgerApp-api-5xx` on the `LedgerGuardrails-alert` topic (5 standard alarms in total, within AWS-28's 10 free); `ledger/simulator-signing-secret` only with the flag (USD 0.40/month, owner's deployment only, AWS-11); read-API IAM on the DLQ: `sqs:ReceiveMessage`, `sqs:DeleteMessage`, `sqs:StartMessageMoveTask` and `sqs:ListMessageMoveTasks`, plus `sqs:SendMessage` on the source queue (D9, AWS-60) | owner-approved 2026-10-19 | Group 6 |
| AWS runs | Each `pnpm aws:deploy` (the redeploy with the flag, and any later one), the read-only quota check, each AWS sim run (`--duplicates 0.2 --shuffle`, `--burst`, `--chaos db-outage`, `--poison`), and every read-only `aws` CLI read in the walk. **Approved one at a time, when each runs** | held — per action at walk time | Group 10 |
| Dependencies | None. Every SDK call needs a client already installed in `packages/aws` (`client-sqs`, `client-lambda`, `client-secrets-manager`, `client-cloudwatch`, `client-cloudformation`, `client-apigatewayv2`). `sim` gains `"@ledger/aws": "workspace:*"`, a boundary declaration, not Ask-first ([pp-general → adding-things](../../.agents/skills/pp-general/references/adding-things.md#add-a-dependency)) | — | — |
| CI change | None. The runbook link check is a unit test (D20); `scripts/verify.mjs` is untouched | — | — |
| Schema / migration | None (§8) | — | — |
| Live Resend writes | None. No `Ships` bullet sends or replays | — | — |

Anything else (another variable, flag, route field, resource or dependency) stops at apply.

### Kernel

**D1 — `DlqPort`.** `packages/shared/src/dlq.port.ts`:

```ts
export type DlqRawMessage = { readonly body: string; readonly receiveCount: number };
export type DlqSample = { readonly depth: number; readonly messages: readonly DlqRawMessage[] };
export type RedriveStart =
  | { readonly status: 'started'; readonly depth: number }
  | { readonly status: 'empty'; readonly depth: 0 };
export interface DlqPort {
  sample(limit: number): Promise<DlqSample>;   // never deletes, never hides a message
  startRedrive(): Promise<RedriveStart>;       // throws LedgerError('redrive_in_progress')
}
```

`depth` is visible plus in flight, the same sum `health.get` reports
(`QueueSnapshot.dlqVisible + dlqInFlight`, [queue-attributes.port.ts](../../packages/shared/src/queue-attributes.port.ts)).
The port returns raw bodies; parsing them is the reader's job (D5), so no adapter knows the envelope.
Authority: [pp-backend → composition.md → Ports](../../.agents/skills/pp-backend/references/composition.md#ports)
("DLQ receive and redrive (AWS-50, AWS-21) | `packages/aws`; local mode reads and clears `dead_at` | 3";
"Each port's exact name and methods are settled by the slice that lands it"). Rules out: a
port per call, or an adapter that parses payloads.

**D2 — Stack names move to `@ledger/aws`.** `APP_STACK_NAME`, `GUARDRAILS_STACK_NAME`,
`appOutputKeys`, `guardrailsOutputKeys`, `USAGE_TRIP_ALARM_NAME` and `KILL_SWITCH_ERRORS_ALARM_NAME`
move from `infra/scripts/ledger-stacks.ts` to `packages/aws/src/ledger-stacks.ts`. They are
re-exported, and `infra/scripts` imports them from there, adding the three new alarm names (D17).
The sim needs them, and it must not import `infra` ([module boundaries](../../AGENTS.md#module-boundaries);
[pp-infra → scripts.md → Shape](../../.agents/skills/pp-infra/references/scripts.md#shape): "Logic
a script shares lives in its package"). `PROJECT_TAG` and the log-group helpers stay in `infra/scripts`.

### Local and in-process

**D3 — `InProcessQueueAdapter` implements `DlqPort`** (C2). `sample(limit)` returns the dead list's
first `limit` entries (`depth` = the dead list's length, nothing is in flight on it).
`startRedrive()` moves every dead entry back to the waiting list with its receive count reset, then
answers `started` with the depth moved, or `empty`. It is synchronous, so it never answers
`redrive_in_progress`. The **shared contract suite** `packages/shared/src/testing/dlq-port.contract.ts`
runs against it and against `SqsDlqAdapter` over its stubbed client. The suite covers: sampling never
removes a message, `depth` counts what was dead-lettered, an empty redrive answers `empty`, and a
redrive empties the dead store
([pp-testing → Shared contract suites](../../.agents/skills/pp-testing/references/vitest-layout.md#shared-contract-suites)).

### AWS adapters (`packages/aws`)

**D4 — `SqsDlqAdapter`** (`sqs-dlq.adapter.ts`), bound to the DLQ URL, the DLQ ARN and the
source queue's ARN (both from one `GetQueueAttributes` `QueueArn` read each, cached per container).
- `sample(limit)`: one `GetQueueAttributes` (`ApproximateNumberOfMessages`,
  `ApproximateNumberOfMessagesNotVisible`) for `depth`, then one `ReceiveMessage` with
  `MaxNumberOfMessages: limit`, **`VisibilityTimeout: 0`** and **`WaitTimeSeconds: 1`**, requesting
  the `ApproximateReceiveCount` attribute. It never calls `DeleteMessage`. `VisibilityTimeout: 0`
  means an inspect never hides a message from a redrive that follows it, or from the depth. The
  1-second long poll "queries all servers", where a short poll samples a subset and can return
  nothing from a small queue (AWS-59, new; AWS-50). Authority: [api-contract.md → `dlq.listMessages`](../api-contract.md#dlqlistmessages)
  ("receives with a short visibility timeout and never deletes"), [pp-backend → reactions-and-recovery.md](../../.agents/skills/pp-backend/references/reactions-and-recovery.md#dlq-inspect-and-redrive).
- `startRedrive()`: `ListMessageMoveTasks` (`SourceArn`: the DLQ, `MaxResults: 1`). Any `RUNNING` →
  throw `new LedgerError('redrive_in_progress', …)` with no start sent (C9, AWS-60). Otherwise read
  the depth; at `0` → `empty`, no start; otherwise `StartMessageMoveTask` with the DLQ as
  `SourceArn` and no `DestinationArn`, which redrives "back to their respective original source
  queues" ([API_StartMessageMoveTask](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/APIReference/API_StartMessageMoveTask.html))
  → `started` with the depth. The `TaskHandle` is dropped (C1). An SDK error propagates unchanged
  ([pp-testing → fakes-and-doubles.md](../../.agents/skills/pp-testing/references/fakes-and-doubles.md#dlq-redrive):
  "mapping 'one active task per queue' (AWS-21) to `redrive_in_progress`").

### Read API (`packages/api`)

**D5 — `ListDlqMessagesReader` and its mapper.** `execute({ limit })` → `DlqPort.sample(limit)`,
then for each raw message:
- parse the body with `ingestEnvelopeSchema` ([core](../../packages/core/src/ingest-envelope.schema.ts)).
  On failure, every item field except `receive_count` is `null`.
- `svix_id` ← `envelope.svixId`; `enqueued_at` ← `envelope.receivedAt` (ingest stamps it at the
  enqueue, [ADR-001](../architecture.md#adr-001--verify-then-enqueue)).
- `JSON.parse(envelope.rawBody)`, then read exactly three paths, each `null` unless it is a string:
  top-level `type`, top-level `created_at` → `event_created_at`, and `data.email_id` → `email_id`.
  **No other path is read.** The parsed value is dropped inside the reader and never reaches the
  mapper (C8; [Conventions → Redaction](../api-contract.md#conventions)).
- `receive_count` ← the adapter's count (`ApproximateReceiveCount`, AWS-50).
- Items with the same non-null `svix_id` collapse to the first, since a `VisibilityTimeout: 0`
  receive can return a message twice. `null`-id items are kept.

Wire (`200`):

```json
{ "object": "list", "has_more": false, "depth": 1,
  "data": [ { "object": "dlq_message", "svix_id": "msg_…", "type": "email.delivered",
              "email_id": "…", "event_created_at": "2026-10-19T12:00:00.000Z",
              "enqueued_at": "2026-10-19T12:00:01.000Z", "receive_count": 6 } ] }
```

`has_more` is `depth > data.length`. `depth` is a top-level field beside Resend's list envelope.
`dlq.listMessages` "returns the envelope with no cursor, because it is a sample"
([Conventions → Pagination](../api-contract.md#conventions)). An AWS error → `500 internal_error`
with the error as `cause`, as `GetHealthReader` does (`packages/api/src/get-health.reader.ts:44-49`).

**D6 — `limit` validation.** `limit` is an integer from 1 to 10, default 10. Out of range or not an
integer → `400 validation_failed`, message **`limit must be an integer from 1 to 10.`**. `create-api.ts`'s
`fieldErrors.limit` ("1 to 100") is keyed by field, so the DLQ route carries a route-scoped override.
Authority: [api-contract.md → `dlq.listMessages`](../api-contract.md#dlqlistmessages) ("`limit` (1–10)").

**D7 — `StartDlqRedriveCommand`.** `execute()` → `DlqPort.startRedrive()`. Wire: `started` →
**`202`** `{ "object": "dlq_redrive", "status": "started", "depth": 3 }`; `empty` → **`200`**
`{ "object": "dlq_redrive", "status": "empty", "depth": 0 }`; a thrown `redrive_in_progress` →
`409` in the error shape (registry text, D8). Scope `operate`. It opens no transaction: no Postgres
write ([pp-backend](../../.agents/skills/pp-backend/SKILL.md): a command owns the transaction only
when it writes). Authority: [api-contract.md → `dlq.startRedrive`](../api-contract.md#dlqstartredrive)
("answers `202` with the depth at start. An empty DLQ answers `200` and starts no task"), C1.

**D8 — Errors.** No new code. `redrive_in_progress` uses the registry's message and hint verbatim
(`packages/core/src/error-codes.ts:105`). The `docs` link stays the AWS redrive page, as the
registry fixes it. The codes each route raises are listed in §12.

**D9 — Composition.** `ApiDeps` gains `dlq: DlqPort`. `apps/api/src/main.ts` builds
`SqsDlqAdapter` from `apiEnv.DLQ_URL` and `apiEnv.QUEUE_URL` (both already set, no new variable).
`apps/local/src/main.ts` passes its `InProcessQueueAdapter` (D3). IAM on the read API (approved,
§7): add `sqs:ReceiveMessage`, `sqs:DeleteMessage`, `sqs:StartMessageMoveTask` and
`sqs:ListMessageMoveTasks` on the DLQ ARN, and `sqs:SendMessage` on the source queue ARN, the
documented minimum for a redrive to the source queue (AWS-60). `sqs:GetQueueAttributes` on both
already exists. `DeleteMessage` is in that minimum because SQS moves the messages on the caller's
permissions; the API's own code never calls it (D4), and a test pins that.

### SDK and CLI

**D10 — SDK and CLI.** `ledger.dlq.listMessages({ limit }?)` → `GET /dlq/messages`, and
`ledger.dlq.startRedrive()` → `POST /dlq/redrive`, both with the `{ data, error }` return style,
`REQUEST_TIMEOUT_MS` and no retries (SDK retries are slice 5's). `pnpm openapi:export` regenerates
`packages/sdk/openapi.json` and `src/openapi-types.ts`, and the `drift` stage checks them. CLI:
a `dlq` group on the root in `create-program.ts`;
`apps/cli/src/commands/dlq-list-messages.cli.ts` (`ledger dlq inspect [--limit <1-10>] [--json]`,
`--limit` through an integer `argParser`, range left to the API) and
`apps/cli/src/commands/dlq-start-redrive.cli.ts` (`ledger dlq redrive [--json]`, no `--no-wait`).
Output is in §12. Authority: [pp-cli](../../.agents/skills/pp-cli/SKILL.md) (file names, group, `argParser`, no range check in the CLI).

### Simulator secret

**D11 — The flag is a persistent public variable, `LEDGER_SIMULATOR`** (`on` | `off`, default
`off`), parsed by `infra/scripts/deploy-env.schema.ts` next to `LEDGER_KILL_SWITCH`. It passes CDK
context `ledger:simulator` (`true` | `false`, default `false`) through `infra.config.ts`. With
`on`, the deploy asserts `LEDGER_SIMULATOR_SECRET` (RS-02's `whsec_` form, the same regex as
`LEDGER_DEPLOY_WEBHOOK_SECRETS`) before contacting AWS, and refuses naming it. A variable rather than
a deploy flag: it is the owner's standing deployment shape, like the kill switch. A flag forgotten
on one redeploy would silently drop the secret mid-demo. Authority:
[ADR-016](../architecture.md#adr-016--the-simulator-reaches-aws-only-through-an-opt-in-simulator-secret)
("An off-by-default deploy flag"), [pp-infra → env-and-inputs.md → Deploy inputs](../../.agents/skills/pp-infra/references/env-and-inputs.md#deploy-inputs)
("An input the deploy command reads from the environment is a public variable"), owner approval (§7).

**D12 — CDK.** With `ledger:simulator=true` only: one `Secret` (`description` beginning
`ledger/simulator-signing-secret`, no physical name, `DESTROY`, empty value: [Secrets layout](../integrations.md#secrets-layout)),
`grantRead` to ingest only, and ingest's environment gains `SIMULATOR_SECRET_ARN` from a second
names object, `ingestSimulatorEnv = { SIMULATOR_SECRET_ARN }`, in `packages/shared/src/function-env.ts`.
Output `SimulatorSecretArn` appears only with the flag. Template tests, synthesized both ways: without
the flag, two secrets and no `SIMULATOR_SECRET_ARN` anywhere in ingest's environment or policy;
with it, three secrets, ingest's keys equal `ingestEnv ∪ ingestSimulatorEnv`, and only ingest's role
reads the third. The deploy writes the value with `writeSecretIfChanged`, after `cdk deploy` and
beside the signing-secret write. Authority: [pp-infra → cost-brake-assertions.md](../../.agents/skills/pp-infra/references/cost-brake-assertions.md)
("the simulator flag (slice 3 …: without it, no simulator secret and no ingest reference to one)").

**D13 — Ingest reads it through the port.** `IngestDeps.simulatorSecret: string | undefined`
becomes `simulatorSecretId: string | undefined`. `readCandidates` reads it through the same
`SecretReaderPort`, under the same 5-minute cache, after the Resend set. The value is one `whsec_`
string, parsed with the signing-secret regex. A failed or unparseable read fails the whole read, so
every request answers `503`, never `401`. That keeps D13 of slice 2: an unreadable secret is an
infrastructure fault Resend retries. `StaticSecretReaderAdapter` takes a record of id → value, so
`apps/local` serves both ids from its parsed config (it still rejects an unknown id). Tests
(`create-ingest.test.ts`): with `simulatorSecretId` absent, a simulator-signed request answers `401`
and nothing is enqueued (the Ships 3 test); present, it is stamped `simulated` (the existing test,
rewired); and an unreadable simulator secret answers `503` with nothing enqueued.

### Infra

**D14 — Alarm actions reach email through the alert topic.** The app stack builds the
`LedgerGuardrails-alert` ARN with `formatArn` from `alertTopicName(props.guardrailsStackName)`,
exactly as the usage trip builds the trip topic's ARN (`infra/src/app.stack.ts:242-246`). It is
never a cross-stack import ([Budget alarms](../aws.md#budget-alarms) item 1). The topic policy
already lets `cloudwatch.amazonaws.com` publish (item 3), and the owner's subscription is confirmed (§4).

**D15 — Alarm actions on `ALARM` only.** No OK action: one email per incident, and the alarm
returns to OK on its own. Authority: lens clause 5 (signal over noise).

**D16 — `TreatMissingData: notBreaching`** on every new alarm, because an idle queue stops
delivering metrics after six hours (AWS-22, [Constraint 7](../aws.md#constraints-and-sharp-edges)).

**D17 — Three new alarms** (5 in total with the usage trip and kill-switch errors, within AWS-28's 10):

| Name | Metric | Statistic, period, evaluation | Threshold | Why |
| --- | --- | --- | --- | --- |
| `LedgerApp-queue-age` | SQS `ApproximateAgeOfOldestMessage`, source queue | `Maximum`, 300 s, 1 period | `> 900` s | A paused worker fires it ([ADR-015](../architecture.md#adr-015--the-worker-pauses-its-own-event-source-on-a-database-outage): "fires the queue-age alarm (AWS-22)"). 15 minutes is far above a 10k burst's drain (≈ 100 s at ≈ 100 msg/s, §16) and fires within ≈ 20 min of a pause, inside the card's hour. Poison messages are excluded from the metric (AWS-22) |
| `LedgerApp-dlq-depth` | SQS `ApproximateNumberOfMessagesVisible`, DLQ | `Maximum`, 300 s, 1 period | `> 0` | AWS-22; J4's trigger ([features.md → J4](../features.md#j4--poison-message--redrive)) |
| `LedgerApp-api-5xx` | HTTP API `5xx` (`metricServerError`) | `Sum`, 300 s, 1 period | `> 0` | A `5xx` to Resend is a failed delivery that Resend retries and that can auto-disable the endpoint (RS-10, RS-11). It is also how a throttled ingest Lambda surfaces. Vended, free (AWS-30). A read-API `503` during an outage fires it too, which the runbook explains |

Constants live in `infra/src/app.stack.ts` beside the usage trip's, each citing its fact. One
`Template` assertion per alarm covers its metric, dimensions, statistic, period, threshold,
comparison, missing-data and its one action. The existing "Alarms within the free count" assertion
still holds ([cost-brake-assertions.md](../../.agents/skills/pp-infra/references/cost-brake-assertions.md)).

**D18 — Every alarm carries its runbook link** in `AlarmDescription`, and an SNS alarm email
includes the description: `<one line of what fired>. Runbook: <RUNBOOK_BASE_URL>#<slug>`. The slug
is the GitHub anchor of the alarm's runbook heading (`## LedgerApp-queue-age` →
`#ledgerapp-queue-age`). This applies to all five, including the two from slice 2. The base URL is
`RUNBOOK_BASE_URL` from `@ledger/core` (`error-codes.ts:32`), and `infra` already imports core.
Descriptions hold no ARN, account id or address (CBL-01, [`.ai/AGENTS.md` → Rules](../AGENTS.md#rules)).

**D19 — `docs/runbook.md`.** Tracked, public, house-style (tight; no account id, URL of the deploy,
address or secret). It opens with one line restating "Not affiliated with Resend". The outline:
- `## Alarms`: one `###` per alarm, whose heading text is exactly the alarm's name
  (`LedgerApp-queue-age`, `LedgerApp-dlq-depth`, `LedgerApp-api-5xx`, `LedgerApp-usage-trip`,
  `LedgerGuardrails-kill-switch-errors`). Each entry has four labelled lines: **Means**, **First**
  (the first command, e.g. `pnpm -s ledger health`), **Then** (the decision steps, naming the
  `ledger` or `pnpm aws:*` command), and **Related** (the ADR or `AWS-NN`).
- `## Error codes`: one `###` per code whose registry `docs` is the runbook: `unauthorized`,
  `forbidden`, `validation_failed`, `email_not_found`, `recipient_not_found`, `run_not_found`,
  `token_not_found`, `route_not_found`, `reconcile_in_progress`, `last_operate_token`,
  `run_abandoned`, `database_unavailable`, `internal_error`, `api_unavailable`. Each entry has the
  same four lines; slice 4's codes say which slice lands their operation.
  [Slice 7](../build-checklist.md#7--polish-and-retention) completes it.

**D20 — The alarm-to-runbook link check** is `infra/src/runbook-links.test.ts` (unit tier, so
`pnpm check` and the `unit` stage run it; no CI change). It synthesizes both stacks (kill switch on,
simulator on), and reads `docs/runbook.md` headings into GitHub slugs (lowercase, spaces → `-`,
punctuation but `-` and `_` dropped). It asserts:
1. every `AWS::CloudWatch::Alarm` in both templates has an `AlarmDescription` containing
   `Runbook: ${RUNBOOK_BASE_URL}#<slug>`, and that slug is a heading;
2. every `errorRegistry` entry whose `docs` starts with `RUNBOOK_BASE_URL` points at a heading;
3. a canary: a fabricated alarm description with an unknown slug is rejected by the same checker
   function, so a checker that passes everything fails.

`node scripts/check-links.mjs docs/runbook.md` (relative links and anchors inside the runbook)
runs from the same test through `spawnSync(process.execPath, …)`, with exit `0` expected.

### Deploy command

**D21 — Deploy step for the simulator secret.** `run-deploy.ts` places the simulator value
after `cdk deploy`, next to the signing secrets, from the `SimulatorSecretArn` output, only when
`LEDGER_SIMULATOR=on`. Its printed lines gain `aws:deploy: simulator on` or `aws:deploy: simulator off`
after `KillSwitchArmed`, and never the value. Tests (`run-deploy.test.ts`, fake steps): `on` without
`LEDGER_SIMULATOR_SECRET` refuses before any AWS call, naming the variable; `on` passes
`-c ledger:simulator=true` and writes the secret; `off` passes `false` and writes none.

### Simulator

**D22 — Settle bound scales with the run.** It is `30 s + 100 ms × generated events`: 30 s for
today's histories, ≈ 17 min for 10,000 events. It polls every 250 ms locally, and every 2 s once
the bound passes 60 s (each poll is one `countPresent` over the run's ids). It still fails the run
at its bound, never waits forever ([simulator.md → Ground truth and runs](../../.agents/skills/pp-testing/references/simulator.md#ground-truth-and-runs)).

**D23 — AWS runs and their guard.** `--burst`, `--chaos db-outage` and `--poison` make a run an
**AWS run**. An AWS run needs a live config (`LEDGER_URL` set; otherwise exit `2`:
`sim: --burst needs a live run against the deployed stack: load .env.deployed.local`). It reads the
`LedgerApp` and `LedgerGuardrails` stack outputs through `@ledger/aws` (D2) and refuses, exit `1`, before
sending anything:
- when `LEDGER_URL` (trailing slash ignored) is not the stack's `ApiUrl`
  (`sim: LEDGER_URL is not the deployed LedgerApp API; load .env.deployed.local`), so a fault never
  lands on the wrong target;
- when the kill switch is tripped (`readKillSwitchState`: `sim: the stack is tripped; run pnpm aws:rearm first`);
- when `KillSwitchArmed` is not `true` (`sim: the kill switch is not armed; AWS runs need the owner's armed deployment`).
  Lens clause 6: a raised throttle without an armed switch is a budget-alarm gap;
- when the DLQ depth is not 0 (`sim: the DLQ holds <n> messages; inspect and redrive them first`),
  because invariant 4 needs a clean start.

The three knobs exclude each other and `--duplicates`; a combination exits `2` naming the pair.
`--shuffle` combines with any. The plain `--duplicates 0.2 --shuffle` run is unchanged and works
against any `LEDGER_URL`, deployed included (Ships 7). It reports `invariant 4 not checked (AWS
runs check it: --burst, --chaos or --poison)`. Authority: [simulator.md](../../.agents/skills/pp-testing/references/simulator.md#ground-truth-and-runs)
("Each knob's mechanism, and the seed flag's name, are its slice's pre-proposal's"), ADR-016, lens clause 6.

**D24 — Invariant 4.** `sim/src/invariants/invariant-4.ts` exports
`invariant4(dlq: DlqPort, poisoned: ReadonlySet<string>)`. It calls `dlq.sample(10)` up to 10 times,
collecting distinct `svix_id`s from the parsed envelopes, until it has `depth` of them. Pass iff
`depth === poisoned.size`, every collected id is in `poisoned`, and every poisoned id was
collected. Its line is `invariant 4 pass (dlq holds exactly the <n> poisoned)`, or a fail line
naming the depth, the counts and any stray `svix_id`s (ids only). The sim builds an `SqsDlqAdapter`
from the stack's `DlqUrl` and `QueueUrl`. `invariant-4.test.ts` covers it against the in-process
adapter (D3).

**D25 — `--burst <events>/<seconds>s`.** It parses `^(\d+)\/(\d+)s$` with
`1 ≤ events ≤ 10000` (the ceiling, [Platform scale assumptions](../about.md#platform-scale-assumptions))
and `1 ≤ seconds ≤ 600`; anything else exits `2`. Order:
1. D23's guard.
2. **Quota preflight (AWS-U05's burst half):** `lambda:GetAccountSettings` →
   `AccountLimit.ConcurrentExecutions`. Below `BURST_MIN_ACCOUNT_CONCURRENCY = 1000`, refuse
   with `sim: the account's Lambda concurrency quota is <q>; the burst needs at least 1000 (AWS-U05): request an increase in Service Quotas`.
   Why 1,000: it is the default regional quota (AWS-16); 1,000 rps × up to 1 s for a cold ingest
   invocation, plus `MaximumConcurrency` 5 and the read API, needs headroom on that order.
3. **Usage-trip headroom:** `GetMetricStatistics` of the HTTP API's `Count`, `Sum` over the last
   900 s, plus the burst's events, must not exceed the usage-trip alarm's own `Threshold`, read with
   `DescribeAlarms` (never a copied constant). Otherwise refuse with
   `sim: <n> requests in the last 15 minutes plus the burst would trip LedgerApp-usage-trip; wait and retry`.
4. **Raise the throttle** to `BURST_THROTTLE = { rateLimit: 1200, burstLimit: 2400 }` through new
   `packages/aws` steps, `raiseDefaultThrottle` and `restoreDefaultThrottleIf`, which share the kill
   switch's stage read and `withThrottle` helper (`packages/aws/src/kill-switch.ts`). The raise
   records the value it set. `finally` restores the declared throttle (`ThrottleRateLimit` and
   `ThrottleBurstLimit` outputs) **only if** the stage still reads the raised value; otherwise it
   prints `throttle left at <rate>/<burst>: changed during the burst (a trip?)`. The unit test is
   Ships 4's evidence: the stub stage's throttle changes to `0`/`0` mid-run, and `finally` sends no
   update ([Budget alarms](../aws.md#budget-alarms) item 7, [simulator.md → The burst and the throttle](../../.agents/skills/pp-testing/references/simulator.md#the-burst-and-the-throttle)).
   Why 1,200/2,400: 1.2× the burst's mean rate, and a bucket of two seconds' tokens, so a
   best-effort throttle (AWS-14) does not reject a paced burst.
5. **Generate:** `burstHistory({ namespace, events })` in `@ledger/core/testing`. It holds
   broadcast-shaped emails, **one distinct recipient each**, cycling over the RS-39 test addresses as
   `<local>+<namespace>-b<i>@resend.dev`, each email carrying its address's observed sequence
   (`testAddressSequences`). The last email takes a prefix of its sequence so the total is exactly
   `events`. Seeded and deterministic ([about.md → Emails per recipient](../about.md#platform-scale-assumptions):
   "a broadcast's recipients are distinct … `+label` test addresses (RS-32)"). Its property test:
   the exact count, distinct recipients, and determinism per seed and namespace.
6. **Measure storage before:** `databaseRepository.storageBytes` (`pg_database_size`).
7. **Send paced:** request `i` is due at `t0 + i × seconds/events`, with at most 512 requests in
   flight, each signed at send time (RS-02's window). It records each request's client-observed
   latency (send to response body read), with no retry. Any non-`200` or timeout is not accepted,
   and the run then exits `1` after reporting.
8. `finally` restores the throttle (step 4).
9. Settle (D22), measure storage after, check invariants 1, 2 and 4 (nothing poisoned).

The burst prints no projection JSON (10,000 events of it); it prints
`projection not printed (--burst)` in its place. Output lines are in §12.

**D26 — RS-U08 and the p99.** RS-U08 closes when the burst's client-observed p99 is under
**5 s**, a third of Svix's 15 s timeout (RS-10). Client-observed latency includes the owner's
network round trip, so it is an upper bound on the latency Resend sees. The row records the
measured p50 and p99, the command and the date. Published p50/p99 are slice 9's.
[CBL-21](../check-before-launch.md#behaviour-only-production-reveals)'s lone cold delivery stays
separate. Authority: [resend.md → RS-U08](../resend.md#unverified) ("measured ingest p99 well
under 15 s, from the burst run").

**D27 — The two faults.**

*`--chaos db-outage`* repoints the database without touching Neon:
1. D23's guard, plus a refusal when the worker's event source is already paused.
2. Read `ledger/database` (`DatabaseSecretArn` output) through the reader adapter. Write the same
   JSON with `pooledUrl`'s host replaced by **`ledger-sim-db-outage.invalid`**. `.invalid` never
   resolves (RFC 2606), so every connect fails with `ENOTFOUND` under a pg origin, which the
   classifier pauses on (`packages/db/src/classify-database-error.ts:28-37`). Port, user and
   database are unchanged. The value is held in memory only, never printed or written to disk.
3. **Recycle** the worker and the read API: `UpdateFunctionConfiguration` with `Description`
   `ledger-sim db-outage <namespace>`, then wait for `LastUpdateStatus: Successful`. The template
   sets no description, so this is cosmetic drift (AWS-U15, C10).
4. Send the history, then report how many first attempts were `200`. Ships 5 requires all of
   them, because ingest never touches the database (ADR-001).
5. Wait, bounded 10 min, for the event source to read `paused` (ADR-015 on AWS).
6. Hold the outage, bounded 45 min, until `LedgerApp-queue-age` reads `ALARM` (`alarmControl.readState`).
   Print the minutes it took. During the hold, check that the DLQ depth is 0. The owner records the
   email's arrival (§21).
7. `finally`, also on failure: write the original value back if the secret still holds the
   `.invalid` host, then recycle both functions again with `Description` `""`. If the restore
   fails, print `sim: the database secret was not restored; run pnpm aws:deploy, which rewrites it`
   and exit `1` (deploy step 7 writes `ledger/database`).
8. Print `resume: pnpm -s ledger worker resume, or wait for the hourly resume`. Wait, bounded 65 min,
   for `enabled` (the hourly cron covers it with no human), then settle (D22) and check invariants
   1, 2 and 4 (DLQ 0).

Rejected: disabling Neon's endpoint through its API (a new owner credential and integration, and
the error a disabled endpoint raises is undocumented, so it may not classify); `NOLOGIN`, a
password change or `CONNECTION LIMIT 0` on the runtime role (`28000`, `28P01` and `53300` are not
connection-class, so messages would drain to the DLQ: the failure the run exists to rule out).
Authority: [lens](../../AGENTS.md#decision-lens--evidence-over-claims-right-sized)
(reversible-cheap; cost brake: no new integration), ADR-015.

*`--poison <n>`* (1–10, so the poisoned set fits one inspect sample) is a real unexpected error,
entering through ingest (C6):
1. D23's guard.
2. Pick `n` events, seeded (`deriveSeed`), never from the walk probe email. Print
   `poison count=<n> svix_ids=<…> email_ids=<…>` (ids only).
3. **Add the fault:** `ALTER TABLE webhook_events ADD CONSTRAINT ledger_sim_poison_<namespace>
   CHECK (svix_id NOT IN (<ids>)) NOT VALID` through `DATABASE_URL`. A poisoned insert fails with
   `23514`, which is not connection-class, so it follows ADR-008 per message while the others
   commit. This is the technique ADR-004's evidence already uses (`CHECK (false) NOT VALID`).
   The function lives in `@ledger/db/testing` (`addPoisonFault`, `removePoisonFault`), so `sim`
   still reaches Postgres only through `packages/db`. A `42501` →
   `sim: --poison needs DATABASE_URL to own webhook_events (the owner's pooled URL, not the runtime role's)`,
   exit `1`, nothing sent. Any leftover `ledger_sim_poison_%` constraint is dropped first.
4. Send; settle every non-poisoned event (D22); then wait, bounded 40 min, for the DLQ depth to
   reach `n`. Each failed receive waits out the 360 s visibility timeout (AWS-08), so 5 receives
   take ≈ 24 min.
5. Report `invariant 1 pass (<n> poisoned excluded: in the DLQ)`,
   `invariant 2 not checked (<n> poisoned events wait in the DLQ)`, and invariant 4.
6. **The fix:** drop the constraint (`finally` drops it on any failure too), then print
   `poison fixed; next: pnpm -s ledger dlq inspect, then pnpm -s ledger dlq redrive; the depth returns to 0 in pnpm -s ledger health`.

The operator then walks J4 by hand (§21 P4): an intended product action, since ADR-015 rejects
automatic redrive. Rejected: a fault seam in the worker (the evidence would be fake), and an SQS
send of a malformed envelope (ADR-016 rejects bypassing ingest, and it could never be "fixed").

**D28 — Exit codes and output.** These are unchanged: `0` iff every request sent was accepted and
every checked invariant passed, `1` otherwise or on a refusal, `2` on a flag or configuration error.
Every line is ids, counts, durations, and throttle or quota numbers only, never an address, URL,
ARN, secret or payload ([simulator.md → Invariant checkers](../../.agents/skills/pp-testing/references/simulator.md#invariant-checkers)).

### `[Unverified]` rows and facts

**D29 — AWS-U05.** The row records the quota read in slice 2's walk (50), then the burst half:
the preflight's reading after the owner's increase, with the date. "Safe for the deploy" stands.
Authority: C4.

**D30 — PG-U07 (owner-ruled 2026-10-19).** Settled from Neon's published source:
`neon_extend` and `neon_zeroextend` raise `ereport(ERROR, (errcode(ERRCODE_DISK_FULL), errmsg("could
not extend file because project size limit (%d MB) has been exceeded", …)))`
([pagestore_smgr.c](https://github.com/neondatabase/neon/blob/main/pgxn/neon/pagestore_smgr.c),
read 2026-10-19). `ERRCODE_DISK_FULL` is SQLSTATE `53100`, an ordinary `ErrorResponse` that `pg`
surfaces as a statement error carrying `code`. The classifier already lists it
(`classify-database-error.ts:19-22`), and its unit test pins it. The row moves to settled, citing
the source and the classifier test; the D9 comment in the classifier is updated. The burst's
storage reading (D25 steps 6 and 9) is "that measurement" in the card's sense. The card's wording
is widened per §22.

**D31 — New facts and rows** (written into aws.md in the change): **AWS-59** long polling queries
all servers, sample in D4; **AWS-60** the redrive's minimum IAM permissions and
`ListMessageMoveTasks` (most recent ≤ 10, `Status` `RUNNING` and the rest, `TaskHandle` on a running
task); **AWS-61** a `TaskHandle` embeds the source queue ARN, account id included (C1); **AWS-U14**
the error a racing second `StartMessageMoveTask` raises (C9, owed by slice 3, safe either way);
**AWS-U15** a configuration update sends later invocations to new execution environments (C10,
owed by slice 3, settled by the db-outage run, safe either way). Each fact carries its page and the
date 2026-10-19 ([aws.md → Rules](../aws.md)).

## 8. Data model

`Not touched — no schema change.` No table, column, index, grant or migration. The `jsonb`
buckets and the idempotency key (`svix_id`, [Idempotency keys](../data-modeling.md#idempotency-keys))
are unchanged.

One note for the schema's authority, the Drizzle schema in `packages/db`: `--poison` adds a
**transient** `NOT VALID` CHECK constraint (`ledger_sim_poison_<namespace>`) to `webhook_events`
on the owner's database for the length of a run, and drops it in `finally` (D27). It is a test
fault, not a schema change. It is never a migration, never part of the Drizzle schema, matches
only that run's generated `svix_id`s, and is dropped by the next poison run if a crash left it.
No section-8 Ask-first applies. The run itself is Ask-first (§7 AWS runs).

## 9. State machines and transitions

- **Projections** are unchanged ([ADR-003](../architecture.md#adr-003--projection-is-a-pure-function-of-the-event-set)).
  A redriven event takes the ordinary path: the insert on `svix_id`, then the recompute under the
  email and recipient locks (ADR-004). A poisoned event that commits after the fix changes its
  email's projection exactly as a late arrival would, because order never comes from transport.
- **The worker's event source** (AWS-18) is `enabled → paused` on a connection-class failure after
  the fresh-connection retry (ADR-015), and `paused → enabled` on a resume whose probe succeeds (the
  hourly cron, or `ledger worker resume`). D27's db-outage walks exactly this loop on AWS.
- **A DLQ message** is source queue → (failed receive × `maxReceiveCount`) → DLQ → (redrive: a new
  message, new `messageId` and `enqueueTime`, AWS-21) → source queue → a commit, or back to the DLQ
  if still failing.
- **A redrive task** has no task → `RUNNING` → `COMPLETED` (or another terminal status; AWS-60).
  `RUNNING` makes `dlq.startRedrive` answer `409` (D4).
- No reaction or outbox row exists yet (slice 6).

## 10. Backend surface

| Operation | Kind | Semantics | In / Out | Scope | Idempotency | Surfaces | New? |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `dlq.listMessages` | read `[view-shaped]` | A sample of up to `limit` dead messages plus the depth (D4, D5) | `limit` 1–10 (default 10) → list envelope + `depth`, items as D5 | `read` | Safe to repeat: never deletes, `VisibilityTimeout: 0`; each receive adds to `receive_count` (AWS-50) | SDK `ledger.dlq.listMessages` · CLI `ledger dlq inspect [--limit <1-10>]` · MCP `inspect_dlq` (slice 5) | **new** |
| `dlq.startRedrive` | **command** | Moves every DLQ message back to the source queue (AWS-21) | none → `{ object, status, depth }` (D7) | `operate` | Safe to repeat: a running task refuses with `redrive_in_progress`; redriven messages dedupe on `svix_id` (ADR-004) | SDK `ledger.dlq.startRedrive` · CLI `ledger dlq redrive` · MCP `redrive_dlq` (slice 5) | **new** |
| `health.get` | read | Unchanged: it already reports DLQ depth | — | `read` | — | existing | existing |
| `worker.resumeEventSource` | command | Unchanged; walked on a paused source in P3 | — | `operate` | — | existing | existing |

Paths and verbs are the ones [api-contract.md](../api-contract.md) already names.

## 11. Async — outbox, jobs, webhooks

- **Outbox:** not touched (slice 6).
- **SQS consumer:** unchanged. The worker's idempotency argument (`svix_id`, ADR-004) is what makes
  a redrive safe. Its Postgres side is already proven: "a copy under a new `messageId`" leaves one
  row ([record-event.command.int.test.ts](../../packages/worker/src/record-event.command.int.test.ts),
  the Mandatory "Postgres side of DLQ redrive" row in [pp-workflow → Test tiers](../../.agents/skills/pp-workflow/SKILL.md#test-tiers)).
- **Scheduled jobs:** the hourly resume is unchanged. No new schedule.
- **Inbound webhooks:** ingest verifies the Resend set, then the simulator secret when configured
  (D13). Replay behaviour is unchanged.
- **DLQ and redrive:** D4. A poison message that is not yet fixed returns to the DLQ after
  `maxReceiveCount` ([api-contract.md → `dlq.startRedrive`](../api-contract.md#dlqstartredrive)).
  There is never an automatic redrive (ADR-015).
- **Alarms → SNS:** D14–D17. Operational alerts never go through the outbox
  ([data-modeling.md → outbox](../data-modeling.md#outbox--reactions-awaiting-delivery)).
- SQS standard is never relied on for ordering ([ADR-002](../architecture.md#adr-002--sqs-standard-not-fifo)).
  Ships 7 proves it through the deployed queue.

## 12. Surfaces

### `dlq.listMessages` — `GET /dlq/messages` → `ledger.dlq.listMessages()` → `ledger dlq inspect [--limit <1-10>] [--json]`

- **Actor and scope:** operator, support or reviewer, with any active token (`read` suffices).
- **`--json`:** the SDK's `data`, D5's wire object, one document on stdout.
- **Human (stdout)**, every value through `printable`, timestamps as returned (ISO-8601 UTC):

  ```text
  dlq         2 messages, showing 2
  msg_…  email.delivered  email <email_id>  created 2026-10-19T12:00:00.000Z  enqueued 2026-10-19T12:00:01.000Z  receives 6
  msg_…  -                email -           created -                         enqueued -                         receives 7
  ```

  The first line reads `dlq         <depth> message(s), showing <n>` (`showing <n> of <depth>`
  when `has_more`), or `dlq         empty`. A `null` field prints through `printable(null)`.
  stderr gets one notice line when depth > 0 and not `--json`:
  `why each failed is in the worker logs under its svix_id (runbook: LedgerApp-dlq-depth)`.
- **Masks:** none needed. No address, subject, display name, `from`, tag or payload field is ever
  in the response (D5). The route-level redaction test (§20) proves it.

### `dlq.startRedrive` — `POST /dlq/redrive` → `ledger.dlq.startRedrive()` → `ledger dlq redrive [--json]`

- **Actor and scope:** operator, `operate` only.
- **`--json`:** `{ "object": "dlq_redrive", "status": "started", "depth": 3 }` or `{ …, "status": "empty", "depth": 0 }`.
- **Human (stdout):** `redrive     started: 3 message(s) moving back to the queue; watch the dlq depth with ledger health`,
  or `redrive     nothing to move: the dlq is empty`.
- It returns at once, with nothing to poll ([Conventions → Long-running commands](../api-contract.md#conventions)).

### Error codes raised, in the [error shape](../../AGENTS.md#error-shape)

| Code | HTTP | Route | `message` | `hint` |
| --- | --- | --- | --- | --- |
| `unauthorized` | 401 | both | `Bearer token missing, malformed, bad-tag, unknown or revoked.` | ``Set `LEDGER_TOKEN` to an active token.`` |
| `forbidden` | 403 | redrive | `The token is valid but lacks the scope this operation needs.` | ``Use an `operate` token, or ask its owner for one.`` |
| `validation_failed` | 400 | inspect | `limit must be an integer from 1 to 10.` (D6) | `Fix the field the message names, then retry.` |
| `redrive_in_progress` | 409 | redrive | `A DLQ redrive task is already running; SQS allows one per queue.` | ``Wait for the DLQ depth in `ledger health` to fall.`` |
| `database_unavailable` | 503 | both (the auth lookup, C7) | `The database is unreachable.` | ``The queue holds events meanwhile (ADR-015); retry, then `ledger worker resume`. `ledger health` shows storage used.`` |
| `internal_error` | 500 | both | `An unexpected error occurred.` | `Retry; if it persists, read the API logs by request id.` |
| `api_unavailable` | — (SDK) | both | `The Ledger API did not answer with a Ledger response.` | ``Check `LEDGER_URL`. The kill switch may be tripped: check the budget alerts, then run the re-arm script.`` |

`docs` per [the registry](../api-contract.md#error-codes): the runbook for all but
`redrive_in_progress` (the AWS redrive page). The CLI exits `0`, `1` or `2` as
[pp-cli → Output and exit codes](../../.agents/skills/pp-cli/SKILL.md#output-and-exit-codes)
fixes. A non-integer `--limit` is a usage error, exit `2`, and never reaches the API.

### `pnpm sim` (not an operation)

The lines an AWS run prints, in order (D25, D27), each with ids, counts, durations and numbers only:

- **Burst:** `sim seed=… namespace=…` · `history emails=… events=10000 duplicates=0 shuffled=…` ·
  `projection not printed (--burst)` · `preflight concurrency=<q> recent_requests=<r> usage_trip_threshold=<t>` ·
  `throttle raised rate=1200 burst=2400` · `sent requests=10000 accepted=10000 duration_s=<d> p50_ms=<x> p99_ms=<y>` ·
  `throttle restored rate=100 burst=200` · `settled stored=10000/10000 after <s>s` ·
  `storage before=<b> after=<a> bytes_per_event=<c> bursts_left=<k>` · invariants 1, 2 ·
  `invariant 3 not checked (slice 6)` · invariant 4.
- **db-outage:** `chaos db-outage: database repointed, worker and api recycled` ·
  `sent requests=<k> accepted=<k> first_attempt_200=<k>` · `worker paused after <s>s` ·
  `queue-age alarm ALARM after <m>m; dlq depth 0` · `chaos db-outage: database restored, worker and api recycled` ·
  `resume: pnpm -s ledger worker resume, or wait for the hourly resume` · `worker enabled after <m>m` ·
  `settled …` · invariants 1, 2, 4.
- **Poison:** D27 steps 2–6.

Refusals print `sim: <reason>` on stderr (D23, D25, D27).

### Alarm email (not an operation)

This is SNS's CloudWatch alarm email to the owner's subscribed address. Its subject names the alarm,
and its body carries the `AlarmDescription` with the runbook link (D18). Only the owner observes it.

## 13. Recovery paths — redrive, replay, reconcile

- **DLQ redrive** is this slice's ([ADR-008](../architecture.md#adr-008--backpressure-bounded-concurrency-partial-batch-failure-dlq)).
  A redriven message is a new SQS message (AWS-21). The worker's insert is
  `ON CONFLICT (svix_id) DO NOTHING`, so a message redriven after it already committed (e.g. from a
  visibility race) commits as a duplicate with one row and no second effect (ADR-004). The
  existing integration test covers it (§11).
- **The outage pause** ([ADR-015](../architecture.md#adr-015--the-worker-pauses-its-own-event-source-on-a-database-outage))
  is exercised on AWS by D27: messages wait in the source queue (13 days, AWS-07), and none reaches
  the DLQ.
- **Replay and reconcile:** not touched. They are [slice 4](../build-checklist.md#4--recovery)'s.
  The usage trip and the kill switch can stop ingest during a careless demo, and the recovery for
  that is the scripted re-arm plus slice 4's reconcile ([Budget alarms](../aws.md#budget-alarms) item 6).

## 14. Business rules and invariants

These are the `spec.md` requirements, stated behaviourally.

1. **Inspect never removes or hides a dead message.** After any number of `dlq.listMessages` calls,
   the DLQ depth is unchanged, and a redrive started right after moves every message.
2. **Inspect never returns personal data or the payload.** For a dead message whose raw body
   names `delivered@resend.dev` and carries a subject, the response holds neither, raw or masked.
   It holds only `svix_id`, `type`, `email_id`, `event_created_at`, `enqueued_at` and `receive_count`.
3. **An unreadable dead message is still listed,** with every field `null` except `receive_count`.
   The response never fails because one body is malformed.
4. **One redrive at a time.** While a redrive task runs, `dlq.startRedrive` answers `409`
   `redrive_in_progress` and starts nothing.
5. **An empty DLQ redrive starts nothing** and answers `200` `status: empty`.
6. **A redriven event applies once.** It commits under its `svix_id` exactly once, whether it
   arrives after the fix for the first time, or again after a duplicate delivery or a second redrive.
7. **Redrive needs `operate`;** a `read` token gets `403` `forbidden`. Inspect needs any active token.
8. **The simulator secret exists only with the flag.** Without `LEDGER_SIMULATOR=on`, no simulator
   secret exists, ingest references none, and a simulator-signed request answers `401` with nothing
   enqueued. With it, a simulator-signed delivery is enqueued stamped `simulated`, and a
   Resend-signed one stays `live`.
9. **An unreadable simulator secret answers `503`, never `401`,** with nothing enqueued.
10. **Every alarm emails through the alert topic, and every alarm and every runbook-linked error
    code has a runbook entry** that the link check resolves.
11. **Under a database outage, ingest keeps answering `200`, the worker pauses after one batch, no
    message reaches the DLQ, the queue-age alarm fires, and after the resume every event is in the
    ledger exactly once with projections equal to the ground truth** (invariants 1, 2, 4).
12. **Under a 10,000-event burst over the deployed stack,** every event is stored exactly once and
    every projection matches (invariants 1, 2, 4), at the measured p99.
13. **Under duplicates and shuffling through the deployed queue,** invariants 1 and 2 hold (ADR-002, ADR-003).
14. **A poisoned event reaches the DLQ after `maxReceiveCount` receives while every other event
    commits; the DLQ then holds exactly the poisoned events** (invariant 4). After the fix, a
    redrive returns the depth to 0 and the event commits once.
15. **A burst never leaves the throttle raised over someone else's change.** It restores only a
    throttle that still reads the value it set, and it refuses to start on a tripped or unarmed stack.

## 15. Authorization and idempotency

- **Ingest** (`POST /webhooks/resend`): Svix signature and timestamp against the Resend set, then
  the simulator secret when configured (D13). A bad signature → `401`, an unreadable set → `503`,
  both with nothing enqueued.
- **Read API:** a bearer token on both DLQ routes, through the existing auth middleware. A missing,
  bad-tag, unknown or revoked token → `401` before any AWS call. The token lookup during an outage →
  `503` `database_unavailable` (C7). Inspect needs `read`; redrive needs `operate`, else `403`.
- **Idempotency:** inspect is side-effect free apart from `receive_count` (AWS-50). Redrive is
  refused while running; a repeated redrive after completion moves whatever is dead at that moment.
  The worker dedupes on `svix_id`, never on `messageId`.
- **Integration suite (real Postgres):** both routes through the real auth middleware: `401`
  (no token), `403` (redrive with `read`), `200` and `202` with `operate`, and `409` from a port that
  reports a running task, each in the error shape. The poison-isolation test (§20).
- **AWS credentials:** the sim's AWS steps run under the owner's SSO profile. No Lambda gains
  permission beyond D9's DLQ and source-queue grants.

## 16. Cost and the Resend budget

| Item | Idle cost | Per run |
| --- | --- | --- |
| Three standard alarms | 0 (5 of 10 free, AWS-28) | — |
| `ledger/simulator-signing-secret` | USD 0.40/month, **owner's deployment only** (AWS-11, already in [Cost shape](../aws.md#cost-shape)) | — |
| `dlq.listMessages` | 0 | 2 SQS requests (attributes + receive), free tier (AWS-24) |
| `dlq.startRedrive` | 0 | 2–3 SQS requests, plus one send and receive per moved message |
| Burst (10k) | — | ≈ 10,000 × USD 3 × 10⁻⁶ ≈ **USD 0.03** ([Budget alarms](../aws.md#budget-alarms) item 7's per-request cost), plus 2 `GetMetricStatistics`/`DescribeAlarms` reads and 2 throttle updates (free tiers, AWS-57) |
| db-outage | — | 4 `UpdateFunctionConfiguration`, 2 `PutSecretValue` (≈ USD 0), up to ≈ 2 h of the hourly resume and an alarm wait |
| Poison | — | ≈ 6 receives per poisoned message; Neon DDL (0) |
| Neon storage | 0 (Free never bills) | ≈ bytes_per_event × 10,000 per burst, measured (D25). The bursts-left figure goes into [Cadence](../integrations.md#cadence-and-the-database) |

- **The raised throttle's worst case.** If a burst run dies without its `finally` (a kill), the
  throttle stays at 1,200 rps. The usage trip still fires within one alarm period plus evaluation
  (≤ 20 min): ≤ 1.44M requests ≈ **USD 4.3**, below item 7's existing USD 6.5 worst case. That
  number is added to item 7 (§22).
- **The usage-trip preflight** (D25 step 3) keeps a burst from tripping the stack by itself.
- **Resend budget:** `Not touched` — no Resend API call (ADR-012).
- **Always-on resources:** none added.

## 17. PII and retention

- **Fields:** a dead message's raw body holds `data.to`, `from`, `subject`, tags and bounce text.
  None of it reaches any surface: the reader reads three paths and drops the parse (D5). The
  redaction test is mandatory for `dlq.listMessages`, since it reads a queue envelope
  ([pp-workflow → Mandatory](../../.agents/skills/pp-workflow/SKILL.md#test-tiers)).
- **Logs:** the reader and the adapter log nothing new. An adapter error logs only its name
  (`errorFields`). The worker already logs failures under `svix_id`, which the runbook points at.
- **Sim output:** ids, counts and timings only (D28). Burst recipients are `+label` forms of Resend
  test addresses, never printed, and they reach the owner's database as keyed hashes and masks only
  ([PII & retention](../data-modeling.md#pii--retention)).
- **Secrets:** the sim holds the `ledger/database` value in memory during a db-outage run, and
  never prints or writes it to disk (D27). The simulator secret travels `.env.local` → deploy →
  Secrets Manager, never CDK (CBL-01).
- **Alarm descriptions and the runbook:** no ARN, account id, URL of the deploy, or address (D18, D19).
- **Retention:** unchanged (slice 7, ADR-014). A DLQ message expires 14 days after its original
  enqueue (AWS-09).

## 18. Integrations, env and owner ops

- **Ports and adapters:** `DlqPort` (D1) → `SqsDlqAdapter` and `InProcessQueueAdapter`. Script-only
  AWS steps are concrete `packages/aws` functions with no port: the throttle raise and restore, the
  function recycle, the account settings read, and the API `Count` read
  ([pp-infra → scripts.md → Shape](../../.agents/skills/pp-infra/references/scripts.md#shape):
  "A call only a script makes uses the concrete `packages/aws` adapter").
- **New public variable:** `LEDGER_SIMULATOR` (D11). It is added to [api-contract.md → Conventions](../api-contract.md#conventions)
  and to `.env.example` as `LEDGER_SIMULATOR=` with a comment: `on` only in the owner's deployment.
- **New internal variable:** `SIMULATOR_SECRET_ARN` on ingest, in `ingestSimulatorEnv` (D12) and
  in [pp-infra → env-and-inputs.md](../../.agents/skills/pp-infra/references/env-and-inputs.md#internal-environment-variables)'s
  table. The ingest config schema makes it optional.
- **New CDK context:** `ledger:simulator`.
- **Owner ops** (§25): the quota increase, `LEDGER_SIMULATOR=on`, `DATABASE_URL` in
  `.env.deployed.local`, the redeploy, each AWS run's approval, watching the budget during the
  burst, and recording the alarm emails. Until the quota increase lands, the burst refuses
  (D25 step 2) and every other bullet still runs.

## 19. Decision lens, in writing

**Self-service test** ([about.md → Guiding principles](../about.md#guiding-principles)), for the
stages this slice touches:

| Stage | Human step or unbounded wait? | Stance |
| --- | --- | --- |
| deploy | No new one. Alarms, their actions and descriptions come with the same `pnpm aws:deploy`. The simulator flag defaults off, so an adopter sets nothing | Nothing owed |
| connect webhook | Not touched | Nothing owed |
| verify | An adopter's stack never holds a simulator secret (D12, invariant 8 in §14) | Nothing owed |
| ingest | Not touched (the simulator read is config) | Nothing owed |
| query | Not touched | Nothing owed |
| operate | The SNS email confirmation is one per installation, already in place since slice 2 ([CBL-03](../check-before-launch.md#deploy-configuration)). Inspect and redrive are CLI commands, not console clicks ([features.md → operate](../features.md#adopter-lifecycle)). Redrive stays operator-triggered by design: ADR-015 rejects automatic redrive, because it needs a failure classification to keep poison messages from looping | **On** the adopter's path; the smallest version that removes the console step ships here |
| recover | A paused worker resumes hourly with no human (ADR-015); `ledger worker resume` only speeds it | Nothing owed |
| tear down | Alarms and the simulator secret go with the stacks (`DESTROY`, AWS-38) | Nothing owed |
| Owner demo runs (`pnpm sim --burst`, `--chaos db-outage`, `--poison`) | Each run is one command that scripts its own fault, guard and restore ([lens clause 1](../../AGENTS.md#decision-lens--evidence-over-claims-right-sized)). Two parts stay manual and off the adopter's path: the one-time quota increase (an AWS support step, done once per account) and observing the alarm email (only the owner's inbox can) | Off the path; correctly cheap |

**Cost brake.**
- *Chosen:* vended metrics and 5 standard alarms (free); the existing alert topic; no new secret
  for adopters; faults built from the deploy's own pieces (a secret, a constraint, a config update).
- *Cheaper alternative rejected:* fewer alarms (queue age and DLQ only). Without the 5xx alarm, a
  failing ingest (Resend retries, then auto-disables, RS-11) would go unseen. That is lens clause 6's
  "lost events".
- *Over-engineering at the ceiling, not built:* a Neon API integration for the outage (D27), a
  burst load generator beyond one Node process (a 10,000-event, 10 s ceiling), Cost Anomaly
  Detection, per-function `Throttles` and `Errors` alarms, composite alarms, and an automated
  alarm-email check (the inbox is the owner's).

## 20. Test plan

| Requirement (§14) | Tier and test | Fails if removed |
| --- | --- | --- |
| 1, 4, 5 | Unit, `packages/aws/src/sqs-dlq.adapter.test.ts` (stubbed client): `ReceiveMessage` with `VisibilityTimeout: 0`, `WaitTimeSeconds: 1`, `MaxNumberOfMessages: limit`, never `DeleteMessage`; `RUNNING` → `redrive_in_progress`, no start sent; depth 0 → `empty`, no start; otherwise `StartMessageMoveTask` with the DLQ's `SourceArn` and no `DestinationArn`; no `TaskHandle` in the result. Plus the shared `dlq-port.contract.ts` suite, run by this test and by the in-process one | the visibility, the `RUNNING` check, the empty check |
| 2, 3 | Integration, `packages/api/src/list-dlq-messages.route.int.test.ts`: **redaction test**: a dead message whose raw body names `delivered@resend.dev` (in `to` and `from`) and a subject → the response body (as text) contains neither, and no other key exists on an item; a malformed body → `null` fields with a `receive_count`; `limit` 0 and 11 → `400` with D6's message; `has_more` and `depth` | the reader's path restriction, the null fallback |
| 4, 5, 7 | Integration, `packages/api/src/start-dlq-redrive.route.int.test.ts`, through the real auth middleware: `401`, `403` with a `read` token, `202 started`, `200 empty`, `409 redrive_in_progress` in the error shape | the scope check, the status mapping |
| 6 | Integration, existing: a copy under a new `messageId` leaves one row ([record-event.command.int.test.ts](../../packages/worker/src/record-event.command.int.test.ts)). New: `packages/worker/src/poison-isolation.int.test.ts`. Real Postgres, the in-process queue, `addPoisonFault` on one `svix_id`: after `maxReceiveCount` receives, that message is on the dead list while every other message committed ([features.md → operate](../features.md#adopter-lifecycle) "poison isolated after N attempts, others unaffected"); after `removePoisonFault` and the in-process redrive, it commits once | the per-message failure list, the fault helpers |
| 1–7 (contract) | Integration, `apps/local/src/sdk-contract.int.test.ts` grows: both SDK methods against `apps/local` on real responses | SDK ↔ API drift |
| SDK | Unit, `packages/sdk` method tests: paths, verbs, `{ data, error }` | — |
| CLI | Unit, `apps/cli/src/commands/dlq-list-messages.cli.test.ts` and `dlq-start-redrive.cli.test.ts` against a fake SDK: `--json` success documents, human lines (§12), `409` and `403` → exit `1` with the error object, `--limit abc` → exit `2` with no SDK call | the output contract |
| 8, 9 | Unit, `packages/ingest/src/create-ingest.test.ts` (D13): absent id → simulator-signed `401`, nothing enqueued; present → `simulated`; unreadable → `503`. `apps/ingest` handler test with the optional config key | the flag's ingest half |
| 8 (template) | Unit, `infra/src/app.stack.test.ts`, synthesized both ways (D12): secret count 2 or 3, ingest's env keys, read grant on ingest only | the CDK half |
| 8 (deploy) | Unit, `infra/scripts/run-deploy.test.ts` (D21) | the deploy half |
| 10 | Unit, `infra/src/app.stack.test.ts` (D17: one assertion per alarm) and `infra/src/runbook-links.test.ts` (D20, with its canary) | an alarm, a description, a runbook heading |
| 15 | Unit, `packages/aws/src/burst-throttle.test.ts`: raise records its value; `finally` restores when unchanged; **the stage's throttle changes to `0/0` mid-run → no update sent** (Ships 4's evidence); refuse when tripped | the conditional restore |
| Sim flags | Unit, `sim/src/read-sim-flags.test.ts`: the three new flags, ranges, exclusivity, and an AWS knob offline → exit `2` (also in `main.e2e.test.ts`, with no network) | — |
| Burst history | Property, `packages/core/src/testing/burst-history.prop.test.ts`: exact count, distinct recipients, determinism | — |
| Invariant 4 | Unit, `sim/src/invariants/invariant-4.test.ts` over the in-process adapter: pass, a stray id, a missing poisoned id, a depth mismatch | — |
| Poison fault | Integration, `packages/db/src/testing/poison-fault.int.test.ts`: only the listed ids fail with `23514`, `NOT VALID` leaves existing rows, drop restores, a leftover is dropped first | — |
| 11–14 (deployed) | Simulator invariants 1, 2, 4 in the recorded runs (§21 P2–P6). `pnpm verify` cannot see them; the walk is their evidence | — |
| PG-U07 | Existing unit test in `classify-database-error.test.ts` pins `53100` (D30) | — |

**What `pnpm verify` covers:** every unit, property and integration row above, the `drift` stage
(the OpenAPI document and SDK types), `synth` (both stacks), and the link stage (README).
**What it cannot see:** anything that needs the deployed stack: the five runs, the alarm email,
the quota, the AWS-U14/U15 observations and RS-U08's number. The walkthrough records them.

## 21. Walkthrough plan

[Walkthrough format](../../.agents/skills/rsa-manual-test/references/walkthrough-format.md). Setup
is non-destructive. Every AWS step is `**Ask-first:**`. There are no live Resend writes. Personas
reaching this slice: **operator** (alarms, DLQ, health, resume), **application developer**
(indirectly, J7's burst), and **reviewer** (a `read` token against the kept deploy,
[about.md → Target personas](../about.md#target-personas)). Support and the AI agent do not reach it
(MCP DLQ tools are slice 5's).

- **P0 — Setup (owner).** `LEDGER_SIMULATOR=on` in `.env.local`; `DATABASE_URL` added to
  `.env.deployed.local` (§4). **Ask-first:** `pnpm aws:deploy` → expect the usual lines plus
  `aws:deploy: simulator on`, exit `0`. **Ask-first:** `aws cloudwatch describe-alarms
  --alarm-name-prefix Ledger --query "MetricAlarms[].AlarmName"` → the five names.
- **P1 — Operator: alarms and the runbook.** **Ask-first:** `aws cloudwatch describe-alarms
  --alarm-names LedgerApp-dlq-depth --query "MetricAlarms[0].AlarmDescription"` → ends
  `Runbook: https://github.com/…/docs/runbook.md#ledgerapp-dlq-depth`. Open it and land on the entry.
  `pnpm check` shows `runbook-links.test.ts` passing.
- **P2 — Application developer (J7): the burst.** Load `.env.deployed.local`. **Ask-first:**
  `pnpm sim --burst 10000/10s`. Before the quota increase, expect
  `sim: the account's Lambda concurrency quota is 50; …`, exit `1`, nothing sent (this step is
  marked blocked until §25's increase). After it, expect §12's burst lines and exit `0`; record
  p50/p99, bytes per event and bursts left. `pnpm -s ledger health` afterwards → queue 0, dlq 0.
  `LedgerApp-usage-trip` stays OK (no trip email).
- **P3 — Operator: database outage.** **Ask-first:** `pnpm sim --chaos db-outage`. While it holds:
  `pnpm -s ledger health` → `worker      paused`, `database    unreachable`, dlq 0. The owner
  records the `ALARM: "LedgerApp-queue-age"` email time. After `database restored`:
  `pnpm -s ledger worker resume` → `worker      enabled`. Expect the run to end with invariants
  1, 2 and 4 passing, exit `0`. AWS-U15 is settled by `worker paused after <s>s` appearing.
- **P4 — Operator: poison and redrive (J4).** **Ask-first:** `pnpm sim --poison 1` → D27's lines,
  `invariant 4 pass (dlq holds exactly the 1 poisoned)`, `poison fixed; next: …`, exit `0`. The
  owner records the `ALARM: "LedgerApp-dlq-depth"` email. Then:
  `pnpm -s ledger dlq inspect` → `dlq         1 message(s), showing 1` and the printed `svix_id`,
  with no address or subject anywhere. `pnpm -s ledger dlq inspect --json` → one document.
  `pnpm -s ledger dlq redrive` → `redrive     started: 1 message(s) …`. An immediate second
  `pnpm -s ledger dlq redrive --json` → the `redrive_in_progress` error object with exit `1`, or
  `status: empty` if the task already finished (either is correct; record which). Then
  `pnpm -s ledger health` → `dlq         0 visible, 0 in flight`.
  `pnpm -s ledger email <poisoned email_id>` → the timeline holds the poisoned `svix_id`.
- **P5 — Reviewer: read token.** With an `operate` token, `pnpm -s ledger token create --name
  review-dlq --scope read` → the plaintext once. With it: `pnpm -s ledger dlq inspect --json` →
  exit `0`; `pnpm -s ledger dlq redrive` → `The token is valid but lacks the scope this operation
  needs.` and its hint on stderr, exit `1`. Revoke it with the `operate` token.
- **P6 — Application developer: order independence through SQS.** **Ask-first:**
  `pnpm sim --duplicates 0.2 --shuffle` with `.env.deployed.local` loaded → invariants 1 and 2
  pass, `invariant 4 not checked (…)`, exit `0`.
- **P7 — Operator: local mode.** `pnpm dev:full`, then `pnpm -s ledger dlq inspect` →
  `dlq         empty`; `pnpm -s ledger dlq redrive` → `redrive     nothing to move: the dlq is empty`.
  The Postgres-backed queue's DLQ is [slice 2B](../build-checklist.md#2b--local-mode-queue-and-docker-compose)'s.
- **P8 — Adopter default (no step on AWS).** `pnpm synth` with no context → the template holds two
  secrets and no `SIMULATOR_SECRET_ARN` (read from `cdk.out`; no AWS call). The deployed `401`
  half is proven by D13's unit test; deploying a flag-less stack only to show it is not worth an
  AWS run.

## 22. Docs to update

At apply time, in the change:

- **build-checklist.md, slice 3:** `Status`, `Ships` boxes ticked as their evidence lands. Ships 4's
  PG-U07 clause becomes "settled from Neon's docs, source or support, or a write over the limit"
  (**owner-ruled 2026-10-19**, C5). Slice 2's card is **not** touched (§3).
- **api-contract.md:** `dlq.listMessages` (Errors add `database_unavailable`, C7; Kind: "the
  envelope's `svixId` and `receivedAt`, and only `type`, `created_at` and `data.email_id` from the
  raw body", C8; `depth` top-level). `dlq.startRedrive` (In / Out: "the status and the starting
  depth"; no task handle, C1; Errors add `database_unavailable`). [Conventions](../api-contract.md#conventions):
  `LEDGER_SIMULATOR` in the public-variable list. [Error codes](../api-contract.md#error-codes):
  the runbook now exists ("owed by slice 3" → present tense; "completed in slice 7" stays).
- **aws.md:** AWS-59, AWS-60, AWS-61 (D31). AWS-U05 (D29), AWS-U14 and AWS-U15 (new rows, D31).
  [Budget alarms](../aws.md#budget-alarms) item 7: the burst throttle `1200/2400`, the usage-trip
  preflight, and the raised-throttle worst case ≈ USD 4.3 (§16). A short alarms list under
  [CloudWatch and SNS](../aws.md#cloudwatch-and-sns) or Budget alarms: the five names, 5 of 10 free.
- **integrations.md:** PG-U07 settled (D30). [Cadence → Storage budget](../integrations.md#cadence-and-the-database):
  bytes per event and bursts left from the burst. PG-U03's "unmeasured until the slice 3 burst" → measured.
- **resend.md:** RS-U08 closed with the measured p50/p99, the command and the date (D26).
- **architecture.md:** Evidence lines of ADR-001 (`--chaos db-outage` keeps `200`), ADR-002
  (`--duplicates 0.2 --shuffle` through the deployed queue), ADR-008 (poison run, invariant 4,
  burst), ADR-015 (PG-U07 settled; the AWS outage run), ADR-016 (the CDK and unit tests; plus one
  clarifying sentence: "The simulator's control-plane steps, the burst's throttle and the chaos
  faults, run under the owner's credentials through `@ledger/aws`; every event still enters
  through ingest", and the flag's name `LEDGER_SIMULATOR`, C6). [Reliability core](../architecture.md#reliability-core):
  the No-loss row's "Pending — `--chaos db-outage` on AWS" → evidence.
  [Open questions owed by slice](../architecture.md#open-questions-owed-by-slice): slice 3 adds
  AWS-U14 and AWS-U15 (MAY close safe either way) and AWS-U05's burst half.
  [Simulator invariants](../architecture.md#simulator-invariants) unchanged.
- **about.md:** [What this project must demonstrate](../about.md#what-this-project-must-demonstrate)
  rows "Queues and workers…" (sim burst and chaos runs) and "Operate what you build…" (alarms,
  runbook, DLQ inspect and redrive). [Open questions](../about.md#open-questions): PG-U07 settled,
  RS-U08 settled, AWS-U05's burst half, AWS-U14 and AWS-U15 added.
- **features.md:** the operate and verify stances' evidence links; J4 and J7 Evidence; Ingest's
  "`--chaos db-outage` keeps ingest at `200`"; Operations' alarm-to-runbook link check; Evidence harness.
- **data-modeling.md:** [webhook_events → Evidence](../data-modeling.md#webhook_events--the-immutable-ledger)'s
  "Slice 3: a unit test that a simulator-signed event is stamped `simulated`" → its link.
- **check-before-launch.md:** "Owned elsewhere → Slice 3" stays. CBL-21 cites the burst p99 as context only.
- **Root AGENTS.md:** Commands (the new `pnpm sim` flags; `pnpm -s ledger dlq inspect|redrive`;
  `LEDGER_SIMULATOR` on `pnpm aws:deploy`). Projects: the `packages/aws` row ("DLQ receive and
  redrive land in slice 3" → present tense; stack names now live there, D2).
- **`.env.example`:** `LEDGER_SIMULATOR=`.
- **Skills (fact updates for mechanisms this slice owns; none loosens a rule):**
  [pp-testing → simulator.md](../../.agents/skills/pp-testing/references/simulator.md) (the settle
  bound, D22; each knob's mechanism, D25 and D27; invariant 4's reading, D24; the AWS-run guard, D23).
  [fakes-and-doubles.md → DLQ redrive](../../.agents/skills/pp-testing/references/fakes-and-doubles.md#dlq-redrive)
  (the adapter's test and the contract suite).
  [pp-backend → composition.md → Ports](../../.agents/skills/pp-backend/references/composition.md#ports)
  (the `DlqPort` row's name and methods; the in-process implementation, D3) and
  [reactions-and-recovery.md](../../.agents/skills/pp-backend/references/reactions-and-recovery.md#dlq-inspect-and-redrive)
  (visibility 0, the `ListMessageMoveTasks` check). [pp-infra → env-and-inputs.md](../../.agents/skills/pp-infra/references/env-and-inputs.md)
  (`SIMULATOR_SECRET_ARN`, `ledger:simulator`) and [cdk-app.md](../../.agents/skills/pp-infra/references/cdk-app.md)
  (the alarm physical names). [pp-cli](../../.agents/skills/pp-cli/SKILL.md) (human layouts:
  "slice 3's design.md → Surfaces" for `ledger dlq inspect|redrive`).
  [rsa-manual-test → environment.md](../../.agents/skills/rsa-manual-test/references/environment.md)
  (the slice 3 rows: how each surface starts, `DATABASE_URL` in `.env.deployed.local`, the quota prerequisite).
- **New:** `docs/runbook.md` (D19).

## 23. OpenSpec mapping

- **Change:** `slice-3-operations-and-evidence-on-aws` in `openspec/changes/slice-3-operations-and-evidence-on-aws/`,
  with `WALKTHROUGH.md` (§21) before `Status` is ticked.
- **Spec deltas** (`find openspec/specs -name spec.md` checked 2026-10-19):

| Capability | Delta | Requirements |
| --- | --- | --- |
| `read-api` | MODIFIED (ADDED requirements) | `dlq.listMessages` returns a sample (§14.1, 3); its errors; `dlq.startRedrive` (§14.4, 5, 7); its errors. MODIFIED "Read responses are masked": DLQ items carry no address, subject or payload (§14.2) |
| `sdk` | MODIFIED | ADDED "DLQ methods" (both, `{ data, error }`, no retry in v0) |
| `cli` | MODIFIED | ADDED "ledger dlq inspect", "ledger dlq redrive" (§12 output and exit codes) |
| `webhook-ingest` | MODIFIED | MODIFIED "Event source stamped from the matching secret" (the simulator secret read by id, absent → `401`, §14.8); MODIFIED "An unreadable secret set answers 503" (the simulator secret included, §14.9) |
| `aws-stacks` | MODIFIED | ADDED "Operational alarms email through the alert topic" (D17, D18); ADDED "The simulator secret exists only with the flag" (D12); ADDED "The read API may inspect and redrive the DLQ" (D9's IAM); MODIFIED "Cost-brake properties" (the alarm count) |
| `deploy-and-teardown` | MODIFIED | MODIFIED "Deploy inputs are asserted first" (`LEDGER_SIMULATOR`, its secret); ADDED "Deploy writes the simulator secret" (D21) |
| `local-stack` | MODIFIED | ADDED "Local DLQ reads the in-process dead list" (D3) |
| `simulator` | MODIFIED | ADDED "AWS runs guard their target" (D23); "Burst knob" (D25, §14.12, 15); "Database-outage knob" (D27, §14.11); "Poison knob and invariant 4" (D24, D27, §14.14); MODIFIED "Live run waits for the ledger to settle" (D22); MODIFIED "Bad flags are rejected" (new flags, exclusivity) |
| `operations-runbook` | **ADDED** (no such directory) | "Every alarm and runbook-linked error code has a runbook entry"; "The link check fails on a missing entry" (D19, D20, §14.10) |

- **Task groups** (each independently verifiable; `pnpm check` per commit):
  1. Kernel: `DlqPort`, the in-process implementation, the contract suite; the stack names to `@ledger/aws` (D1–D3).
  2. AWS adapters: `SqsDlqAdapter`; the burst throttle steps; the function recycle; the account-settings and `Count` reads (D4, D25, D27).
  3. Read API: both routes, the reader, mappers, the redaction and route integration tests; `pnpm openapi:export` (D5–D9). **Ask-first, approved.**
  4. SDK and CLI (D10). **Ask-first, approved.**
  5. Ingest: the simulator secret through the port; the static reader's record (D13).
  6. Infra: alarms, descriptions, simulator secret, IAM, template tests; `docs/runbook.md`; `runbook-links.test.ts` (D12, D14–D20). **Ask-first, approved.** `pnpm synth`.
  7. Deploy command: `LEDGER_SIMULATOR` and the secret write (D11, D21). **Ask-first, approved.**
  8. Simulator: flags, settle bound, AWS-run guard, `burstHistory`, the paced sender, invariant 4, the db-outage and poison faults (`@ledger/db/testing`), the poison-isolation integration test (D22–D28).
  9. Docs (§22).
  10. **Ask-first, per run:** the redeploy, the quota read, and P2–P6, recorded; then the `[Unverified]` rows (D26, D29, D31).
  11. `pnpm verify` and `WALKTHROUGH.md`.

## 24. Risks

| Risk | Likelihood | Cost | Cheapest early catch |
| --- | --- | --- | --- |
| The quota increase is slow or partial | Medium (new accounts) | Ships 4 waits | Request it first (§25); the preflight refuses cleanly, and every other bullet proceeds |
| One Windows Node process cannot pace 1,000 rps | Medium | A slow burst (`duration_s` > 10) | `duration_s` is printed. If it is far over, measure before touching the design. The ceiling, not a load farm, is the requirement |
| A config update does not recycle environments (AWS-U15) | Low | The db-outage run sees no pause | D27 step 5's 10-minute bound fails the run and `finally` restores; then change the recycle step (e.g. a code-hash-neutral update) |
| A crashed db-outage run leaves the secret repointed | Low | The kept stack fails every database read | The `finally` restore; otherwise `pnpm aws:deploy` rewrites it (printed); the queue holds meanwhile (ADR-015) |
| A crashed poison run leaves the constraint | Low | Only that run's ids fail | The next poison run drops leftovers; live `svix_id`s never match |
| A burst trips the usage trip | Low (preflight) | The whole stack trips | D25 step 3; then `pnpm aws:rearm` |
| The 5xx alarm is noisy during demos (an outage's `503`s) | Medium | Extra emails | The runbook entry explains it; tuning waits for a measured case |
| Neon storage grows ≈ tens of MB per burst | Certain | Bursts left shrinks | Printed per run, recorded in Cadence |
| Slice 2's unrecorded results confuse the doc state | Certain until slice 2 closes | A reviewer sees `[Unverified]` rows already observed | §3 and §4 state it; slice 2's 13.8 carries it |
| `ReceiveMessage` with visibility 0 returns the same message twice in one sample | Low | A duplicate line | The reader dedupes items by `svix_id` within one response (a cheap guard, in D5's mapper) |

## 25. Owner ops still open

1. **Request a Lambda concurrency increase to ≥ 1,000** in us-east-2 (Service Quotas → AWS Lambda
   → Concurrent executions). Read-only check afterwards: `aws lambda get-account-settings`
   (**Ask-first**, at walk time).
2. **Set `LEDGER_SIMULATOR=on`** in the owner's `.env.local` (`LEDGER_SIMULATOR_SECRET` is already
   there from `pnpm db:setup`).
3. **Add `DATABASE_URL`** = the deployed database's pooled URL with owner credentials to
   `.env.deployed.local` (never committed).
4. **Approve each AWS run** when it runs (§7): the redeploy, the quota read, P2–P6.
5. **Watch the budget** during the burst, and **record the two alarm emails** (queue age in P3, DLQ
   depth in P4) in the walkthrough run.
