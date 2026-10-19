# Proposal — slice 3: Operations and evidence on AWS

## Why

Slice 3 is the next spine card ([build-checklist → 3](../../../.ai/build-checklist.md#3--operations-and-evidence-on-aws)).
Slice 2 left the stack deployed with two alarms and no runbook. Its DLQ exists, but no surface
inspects or redrives it. The reliability claims that only a deployed queue can carry are still
"pending — slice 3" in the **Evidence** lines of
[ADR-001](../../../.ai/architecture.md#adr-001--verify-then-enqueue),
[ADR-002](../../../.ai/architecture.md#adr-002--sqs-standard-not-fifo),
[ADR-008](../../../.ai/architecture.md#adr-008--backpressure-bounded-concurrency-partial-batch-failure-dlq) and
[ADR-015](../../../.ai/architecture.md#adr-015--the-worker-pauses-its-own-event-source-on-a-database-outage):
no loss under a burst and a database outage, poison isolation, and order independence through SQS.
PG-U07 is owed here ([Open questions owed by slice](../../../.ai/architecture.md#open-questions-owed-by-slice)).
Slice 4's reconciler builds on this slice's runbook, its alert-topic wiring and the simulator's AWS
mode. The build cost is low: every AWS client the slice needs is already installed in
`packages/aws`, there is no schema change, and no live Resend write.

The decision-complete brief is the checked pre-proposal
[2026-10-19-slice-3-operations-and-evidence-on-aws.md](../../../.ai/pre-proposals/2026-10-19-slice-3-operations-and-evidence-on-aws.md)
(cited below as *PP*; checked 2026-10-19: 12 repaired, 0 for the owner). Every decision it settles
(D1–D31, C1–C11) is carried forward unchanged.

## What Changes

The card's `Ships` list, verbatim. Each bullet's state on `HEAD` is PP §5's (re-checked 2026-10-19:
only the PP and its repair have landed since `8e37a70`; no code changed).

1. CloudWatch alarms → SNS → email, each with one runbook entry; evidence: the alarm-to-runbook link check.
2. `ledger dlq inspect` returns a sample with no address, subject or payload, and `ledger dlq redrive` refuses a second concurrent task; evidence: API and CLI tests, plus a redaction test on the inspect output.
3. Off-by-default simulator secret (ADR-016); evidence: CDK assertion test (without the flag, no secret and no ingest reference), a unit test rejecting a simulator-signed request when the secret is absent, and a unit test that a simulator-signed event is stamped `simulated`.
4. `pnpm sim --burst 10000/10s` on the deployed stack, recipients spread over `+label` test addresses, passes invariants 1 and 2 and records the ingest p99, closing RS-U08, and the bytes per event that set the [storage budget](../../../.ai/integrations.md#cadence-and-the-database), with PG-U07 settled from Neon's docs, source or support, or a write over the limit, by that measurement; evidence: a test where the throttle changes mid-burst and `finally` leaves it.
5. `pnpm sim --chaos db-outage` on AWS keeps ingest at `200` and the DLQ at 0, and the queue drains after resume, with invariants 1 and 2; the queue-age alarm email reaches the owner within the hour, recorded with the run.
6. A poison message reaches the DLQ after `maxReceiveCount` while the others commit (invariant 4), and a redrive after the fix returns the depth to 0.
7. `pnpm sim --duplicates 0.2 --shuffle` passes invariants 1 and 2 through the deployed queue (ADR-002).

**Owner ruling on Ships 4 (2026-10-19, PP D30, C5):** the PG-U07 clause becomes "settled from Neon's
docs, source or support, or a write over the limit". Task 1.1 applies it to the card and to the
quote above in one step, because a reworded bullet is a scope change that starts at the card.

How each bullet lands, in one line (detail in [design.md](design.md)):

- **1:** three new alarms (`LedgerApp-queue-age`, `LedgerApp-dlq-depth`, `LedgerApp-api-5xx`) on the
  existing `LedgerGuardrails-alert` topic, every alarm's `AlarmDescription` carrying its runbook link,
  a new `docs/runbook.md` with alarm and error-code entries, and `runbook-links.test.ts` with a canary
  (PP D14–D20).
- **2:** `DlqPort` in the kernel, `SqsDlqAdapter` and the in-process implementation under one contract
  suite, `GET /dlq/messages` and `POST /dlq/redrive`, SDK `dlq.*`, CLI `ledger dlq inspect|redrive`,
  the route-level redaction test (PP D1–D10, C1, C2, C7–C9).
- **3:** a public `LEDGER_SIMULATOR` deploy variable, a CDK secret and ingest grant only with it,
  ingest reading the simulator secret by id through `SecretReaderPort`, and the deploy writing its
  value (PP D11–D13, D21).
- **4:** `--burst`, its AWS-run guard, quota and usage-trip preflights, the conditional throttle
  restore, `burstHistory`, the paced sender, the storage reading; RS-U08 closed by the measured p99;
  PG-U07 settled from Neon's source (PP D22–D26, D29, D30).
- **5:** `--chaos db-outage`, which repoints the `ledger/database` secret to an `.invalid` host,
  recycles the worker and the read API, waits for the pause and the alarm, then restores (PP D27).
- **6:** `--poison <n>`, a transient `NOT VALID` CHECK added through `@ledger/db/testing`,
  invariant 4, a poison-isolation integration test, then the operator's inspect and redrive (PP D24,
  D27).
- **7:** a settle bound that scales with the run, then the recorded run against the deployed stack;
  no new flag (PP D22).

No **BREAKING** change. `IngestDeps.simulatorSecret` becomes `simulatorSecretId` (internal, PP D13),
and the stack-name constants move from `infra/scripts` to `@ledger/aws` (internal, PP D2).

**Out of scope** (PP §3): the card's Deferred tail ("Published latency, drain and cost numbers
(slice 9). MCP `inspect_dlq` and `redrive_dlq` (slice 5). Local-mode DLQ (slice 2B).") plus, each with
its carrier in PP §3: the reconcile-gap alarm and `ingest.rejected{reason}` (slice 4); the complete
runbook (slice 7); `--burst`, `--chaos` and `--poison` against local mode, and the Postgres-backed
queue's dead rows (slice 2B); slice 2's unrecorded AWS and PG rows (slice 2's own task 13.8); SDK
retries for `dlq.listMessages` (slice 5); Cost Anomaly Detection (temporal tripwire); and alarms on
Lambda `Throttles`, worker `Errors` or a custom metric (tripwire: a failure none of the five alarms
catches).

## Capabilities

### New Capabilities

- `operations-runbook`: the public runbook every alarm and every runbook-linked error code points
  at, and the link check that fails when an entry is missing (PP D19, D20).

### Modified Capabilities

Mapped in PP §23, plus three requirements the PP's map left out: the OpenAPI document's operation
list and the simulator's `invariant 4 not checked` line, both fact corrections that follow from D10
and D23; and `event-ledger`'s poison and redrive rule, PP §14 rules 6 and 14, which the map routed
only to the simulator although its evidence is the worker's integration test.

- `read-api`: ADDED `dlq.listMessages` and `dlq.startRedrive` with their errors; MODIFIED "Read
  responses are masked" (DLQ items carry no address, subject or payload) and "OpenAPI document"
  (ten operations).
- `sdk`: ADDED the DLQ methods.
- `cli`: ADDED `ledger dlq inspect` and `ledger dlq redrive`.
- `webhook-ingest`: MODIFIED "Event source stamped from the matching secret" (the simulator secret
  read by id; absent → `401`) and "An unreadable secret set answers 503" (the simulator secret
  included).
- `aws-stacks`: ADDED operational alarms through the alert topic, the flag-gated simulator secret,
  and the read API's DLQ permissions; MODIFIED "Cost-brake properties on the templates" (five
  alarms), "Secrets least privilege", "Each function's environment is exactly its names" and "The
  app stack's outputs" (each with and without the flag).
- `deploy-and-teardown`: MODIFIED "Deploy inputs are asserted first" (`LEDGER_SIMULATOR` and its
  secret); ADDED "Deploy writes the simulator secret".
- `local-stack`: ADDED "Local DLQ reads the in-process dead list".
- `event-ledger`: ADDED "A poison message is isolated, and applies once after a redrive".
- `simulator`: ADDED the AWS-run guard, the burst, database-outage and poison knobs, and invariant 4;
  MODIFIED "Bad flags are rejected", "Live run sends every event signed", "Live run waits for the
  ledger to settle" and "Invariants 1 and 2 checked against the local process".

## Impact

- **Code:** `packages/shared` (`dlq.port.ts`, the in-process implementation, the DLQ contract suite,
  `ingestSimulatorEnv`, the static secret reader's record), `packages/core/testing`
  (`burstHistory`), `packages/db/testing` (`addPoisonFault`, `removePoisonFault`, importable outside
  Vitest), `packages/ingest`, `packages/worker` (one integration test only), `packages/api`,
  `packages/sdk`, `packages/aws` (`SqsDlqAdapter`, stack names, throttle raise and restore, function
  recycle, account settings and metric reads), `apps/ingest`, `apps/api`, `apps/local`, `apps/cli`,
  `infra` (app stack alarms, simulator secret, IAM, `runbook-links.test.ts`, deploy script), `sim`,
  `docs/runbook.md` (new), `.env.example`.
- **Public contract:** two operations api-contract.md already names (`dlq.listMessages`,
  `dlq.startRedrive`) with PP §12's wire shapes; one public variable (`LEDGER_SIMULATOR`); three
  `pnpm sim` flags. No new error code.
- **Schema:** none. `--poison` adds and drops a transient `NOT VALID` constraint during a run on the
  owner's database; it is a test fault, never a migration (PP §8).
- **AWS:** three standard alarms (5 of AWS-28's 10 free), `ledger/simulator-signing-secret` in the
  owner's deployment only (USD 0.40/month, AWS-11), read-API IAM on the DLQ. No always-on resource.
- **Resend:** no API call, no live write.
- **Docs** (PP §22): build-checklist card, api-contract.md, aws.md, integrations.md, resend.md,
  architecture.md, about.md, features.md, data-modeling.md, root AGENTS.md (Commands, Projects),
  `.env.example`, and fact updates in pp-testing, pp-backend, pp-infra, pp-cli and rsa-manual-test
  `environment.md`, plus `WALKTHROUGH.md` in this folder. None loosens a rule.

**Ask-first items** ([root AGENTS.md → Permissions](../../../AGENTS.md#permissions)). Every row was
approved by the owner on 2026-10-19 in one itemized round (PP §7, approvals table). A second owner
round the same day pre-approved the AWS runs, so apply runs them unattended:

| Item | Exact scope approved | PP §7 row |
| --- | --- | --- |
| DLQ contract | `dlq.listMessages` → `GET /dlq/messages?limit=1…10` (default 10) and `dlq.startRedrive` → `POST /dlq/redrive` with PP D5 and D7's wire shapes; SDK `ledger.dlq.listMessages({ limit? })` and `ledger.dlq.startRedrive()`; CLI `ledger dlq inspect [--limit <1-10>] [--json]` and `ledger dlq redrive [--json]`; api-contract edits: `dlq.startRedrive` returns no task handle (C1), and both entries list `database_unavailable` (C7) | DLQ contract |
| Public inputs | `LEDGER_SIMULATOR` (`on` \| `off`, default `off`), read by `pnpm aws:deploy`; with `on`, the deploy requires `LEDGER_SIMULATOR_SECRET` and writes it into `ledger/simulator-signing-secret`. `pnpm sim` flags `--burst <events>/<seconds>s` (events ≤ 10,000), `--chaos db-outage`, `--poison <1-10>` | Public inputs |
| Template resources | Alarms `LedgerApp-queue-age`, `LedgerApp-dlq-depth`, `LedgerApp-api-5xx` on `LedgerGuardrails-alert`; `ledger/simulator-signing-secret` only with the flag; read-API IAM on the DLQ (`sqs:ReceiveMessage`, `sqs:DeleteMessage`, `sqs:StartMessageMoveTask`, `sqs:ListMessageMoveTasks`) and `sqs:SendMessage` on the source queue | Template resources |
| AWS runs | Each `pnpm aws:deploy`, the read-only quota check, each AWS sim run (`--duplicates 0.2 --shuffle`, `--burst`, `--chaos db-outage`, `--poison`), and every read-only `aws` CLI read in the walk — **pre-approved for an unattended apply, owner-ruled 2026-10-19** ("Pre-approve all of group 12") | AWS runs |
| Quota increase request | If the Lambda concurrent-executions quota reads below 1,000: one `aws service-quotas request-service-quota-increase` to 1,000 in us-east-2, "then revert if possible when testing is complete" (owner, 2026-10-19; tasks 12.1, 12.5) | Owner round, 2026-10-19 |

Not needed: no dependency (`sim` gains `"@ledger/aws": "workspace:*"`, a boundary declaration), no CI
change (the link check is a unit test), no migration, no live Resend write. Anything outside these
rows (another variable, flag, route field, resource or dependency) stops for the owner at apply.
