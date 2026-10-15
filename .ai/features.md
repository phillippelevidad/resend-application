# Features

> **TEMPLATE — not ratified.** Bootstrap step 3 in [bootstrap-checklist.md](bootstrap-checklist.md). The preview content below is illustrative, drafted from [docs/idea.md](../docs/idea.md) without research. Nothing here is binding until this banner and the instructions comment are removed.

<!-- AGENT INSTRUCTIONS
Purpose: The capability view of Ledger. One binding table (Adopter lifecycle: what a team adopting
  Ledger does, stage by stage, and what Ledger owes at each), plus non-binding inventories that
  make scoping arguments cheap: journeys, capabilities by area, and parity with Resend's Webhook
  Ingester.
Consumers: wf-before-propose (the card's Refs links a section here; the lifecycle table is what the
  self-service test is argued against, per .agents/skills/wf-before-propose/references/doc-map.md);
  architecture.md build order (step 7); api-contract.md Coverage (step 9); build-checklist.md Refs.
Inputs (read first): root AGENTS.md (decision lens, Permissions, Error shape); .ai/AGENTS.md;
  about.md (step 1: personas, milestones, non-goals, risk appetite, open questions);
  bootstrap-checklist.md -> Owner calibration (binding: M1/M2/M3, no dates, deploy-and-keep AWS
  posture with mandatory budget alarms, the working definition of overdoing it);
  docs/idea.md §2.2, §3, §4, §5 (all), §6.4, §7 incl. the 5-minute demo.
Research:
  - Read Resend's Webhook Ingester README and docs page (https://resend.com/docs/webhooks/ingester)
    and its open PRs/issues (#8, #12, #13 at minimum) to re-verify every Ingester parity row; cite
    the commit or PR read and the date. Do NOT assume idea §2.2 is still current.
  - No Resend API behavior is restated here: cite resend.md `RS-NN` ids instead.
  - Check each lifecycle stance against architecture.md ADRs and the build order once they exist.
Required structure (headings MUST exist, in this order): status note (prose, top) ·
  `## Adopter lifecycle` (closed table Stage | What the adopter does | Stance; the ten stages
  below, no more, no fewer; every row carries a stance, its evidence pointer and the slice that
  delivers it) · `## Journeys` (one `###` per journey: Actor / Trigger / Steps / Surfaces /
  Evidence) · one H2 per capability area (Ingest, Ledger & projections, Recovery, Reactions,
  Interfaces, Operations, Evidence harness) · `## Ingester parity (reference, non-binding)`.
Evidence rules:
  - Every capability bullet and every lifecycle stance MUST carry an evidence pointer: a unit,
    property or integration test, a simulator invariant (idea §5.9), or a cited doc page. While
    the evidence does not exist yet, the pointer names the kind of evidence and the slice that
    owes it (`evidence: property test, slice 0`). A bullet with no possible evidence is deleted or
    moved to about.md#open-questions.
  - Slice links MUST use build-checklist anchors (`build-checklist.md#<id>--<kebab-title>`) and
    MUST be checked against the final card headings from step 10.
  - Resend behavior is cited as resend.md RS-NN, never paraphrased from memory.
Owner decisions to surface (one batched round, each with a recommended pick):
  - Tear down: confirm it stays owner-triggered under deploy-and-keep (recommend: yes, one
    command, documented; never automatic).
  - Rotate secret: whether multi-secret verification is an M1 or M2 commitment (depends on the
    rotation-overlap open question in about.md; recommend M2 unless resend.md settles it).
  - Extend: which extension seams are committed (app callback, unknown-event storage) vs. deferred
    (recommend: only those already in idea §5.6).
Done when: banner and this comment removed; every lifecycle row has a stance, an evidence pointer
  and a slice; every journey's Surfaces resolve to api-contract.md operations or simulator runs;
  every parity row cites a re-verified Ingester source; no preview text survives unverified.
-->

**Status (MUST).** Only [Adopter lifecycle](#adopter-lifecycle) binds. Journeys, capability
sections and [Ingester parity](#ingester-parity-reference-non-binding) are reference inventories
for scoping: a bullet there MUST NOT be read as a commitment. Commitments live in the lifecycle
table, an [ADR](architecture.md), or a [build-checklist](build-checklist.md) card.

## Adopter lifecycle

The stages a team adopting Ledger passes through, in order. The set is closed. Every row MUST carry
a stance; a stage where Ledger owes nothing says so, so an unanswered stage shows as an empty row.
A stage that needs a human outside the adopter (an email to the maintainer, a manual console step
nobody documented) is a defect unless recorded here with its reason.

| Stage | What the adopter does | Stance (evidence + slice) |
| --- | --- | --- |
| **discover** | Reads the README, decides whether Ledger fits beside or instead of the Ingester | README states the problem, the parity table and every reliability claim with a link to its evidence. Evidence: link check in CI · [slice 0](build-checklist.md#0--foundations) _(preview)_ |
| **deploy** | Runs one command against their own AWS account | `cdk deploy` of one stack; budget alarm with a hard monthly cap created in the same deploy, not as polish ([owner calibration](bootstrap-checklist.md#owner-calibration-ratified-2026-10-15)). Evidence: `cdk synth` snapshot test asserting no NAT, no provisioned DB · slice TBD (durable ingest) |
| **connect webhook** | Points a Resend webhook at `POST /webhooks/resend` and stores the signing secret | Documented steps; secret lives in Secrets Manager, never in env files committed. Evidence: deploy guide walked in a WALKTHROUGH · slice TBD |
| **verify** | Confirms events are arriving and correct | `ledger simulate` against the deployed stack, then the invariants print; real traffic via `resend webhooks listen` locally. Evidence: simulator invariants 1–2 ([idea §5.9](../docs/idea.md#59-the-chaos-and-simulation-harness)) · [slice 1](build-checklist.md#1--local-v0) _(preview)_ |
| **query** | Asks "what happened to email X / recipient Y?" | `ledger email`, `ledger recipient`, SDK, MCP read tools over one contract ([api-contract.md](api-contract.md)). Evidence: contract tests per surface · slice TBD (interfaces) |
| **operate** | Watches health, handles poison messages | Alarms → SNS → email; DLQ inspect and redrive from the CLI. Evidence: integration test for poison isolation · slice TBD |
| **recover** | Closes gaps after an outage longer than the retry window | Scheduled + on-demand reconcile; `webhook_disabled` stops it with a hint. Evidence: "down > 28h" integration test against a fake Resend API · slice TBD (recovery) |
| **rotate secret** | Rotates the Resend signing secret without dropped deliveries | Multiple active secrets accepted during overlap `[Unverified]` — depends on Resend's rotation semantics ([about.md → Open questions](about.md#open-questions)). Evidence: unit test · slice TBD |
| **extend** | Reacts to state changes in their own app | Signed app callback via the outbox; unknown event types stored raw, never fatal. Evidence: `--chaos worker-crash` yields no duplicate dispatch · slice TBD (reactions) |
| **tear down** | Removes everything | One command (`cdk destroy`), **owner-triggered** under deploy-and-keep; what it leaves behind is listed in [check-before-launch.md](check-before-launch.md#cost--teardown). Evidence: post-destroy resource listing · slice TBD |

## Journeys

### J1 — Support lookup

- **Actor:** support / on-call engineer.
- **Trigger:** "I never got the password-reset email."
- **Steps:** `ledger email <id>` → status, timeline, bounce detail → `ledger recipient <address>` → deliverability and cause.
- **Surfaces:** `email.get`, `recipient.get` ([api-contract.md](api-contract.md#read-operations)).
- **Evidence:** contract test for both CLI outputs; projection property tests behind the status.

### J2 — Outage → recovery

- **Actor:** operator.
- **Trigger:** ingest or database down longer than Resend's retry schedule.
- **Steps:** alarm fires → `ledger gaps --since 24h` → `ledger reconcile --dry-run` → `ledger reconcile` → `ledger gaps` shows zero missing.
- **Surfaces:** `gaps.list`, `reconcile.start`.
- **Evidence:** "down > 28h" integration test recovers 100% with no duplicates.

### J3 — Agent explanation via MCP

- **Actor:** AI agent acting for support.
- **Trigger:** "Did delivered@resend.dev get the confirm email? Why not?"
- **Steps:** MCP read tools fetch state + timeline → deterministic explanation with next step.
- **Surfaces:** MCP `get_email_status`, `explain_delivery`; operate tools not registered without the `operate` scope.
- **Evidence:** MCP tool tests; a test that operate tools are absent under a read token.

### J4 — Poison message → redrive

- **Actor:** operator.
- **Trigger:** DLQ depth alarm > 0.
- **Steps:** `ledger dlq inspect` → fix deployed → `ledger dlq redrive` → depth returns to 0.
- **Surfaces:** DLQ read and redrive operations (entries owed in api-contract.md).
- **Evidence:** integration test: poison isolated after N attempts, others unaffected; simulator invariant 4.

### J5 — Secret rotation

- **Actor:** operator.
- **Trigger:** scheduled rotation or suspected leak.
- **Steps:** add new secret to the active list → rotate at Resend → confirm acceptance → retire old secret.
- **Surfaces:** deploy guide; ingest metrics `ingest.rejected{reason}`.
- **Evidence:** unit test for multi-secret verification `[Unverified]` overlap semantics.

### J6 — Burst

- **Actor:** application developer (indirectly: a broadcast).
- **Trigger:** a broadcast produces thousands of webhooks in seconds.
- **Steps:** ingest keeps returning `200` → queue depth rises → worker drains at the bounded rate.
- **Surfaces:** `ledger simulate --burst 10000/10s`; health read; CloudWatch dashboard.
- **Evidence:** burst run recorded in `docs/results.md` (p50/p99 ingest latency, drain time).

## Ingest

- Signature + timestamp verification on the raw body, before enqueue. Evidence: unit test · slice 1.
- `200` on enqueue, `401` on bad signature, `503` on enqueue failure. Evidence: unit test · slice TBD.
- No database in the request path. Evidence: `--chaos db-outage` keeps ingest at `200` · slice TBD.

## Ledger & projections

- One row per `svix_id`, ever; duplicates counted, never re-applied. Evidence: property test + simulator invariant 1.
- `projectEmail` is a pure function of the event set (permutation, idempotence, monotonicity, oracle). Evidence: fast-check properties · slice 0.
- Recipient deliverability derived from email states. Evidence: property test · slice 1.
- Unknown event types stored raw, projection skipped, metric emitted. Evidence: unit test.

## Recovery

- Gap detection by id comparison against List Events (cite resend.md RS-NN). Evidence: fake-API integration test.
- Rate-limit aware against the shared team budget. Evidence: fake-API test with `retry-after`.
- Disabled webhook stops the run with `webhook_disabled`. Evidence: integration test.

## Reactions

- Outbox row in the same transaction as the event. Evidence: simulator invariant 3.
- Signed app callback; alert email via Resend idempotency keys. Evidence: `--chaos worker-crash` · slice TBD.

## Interfaces

- One contract, four surfaces: read API, SDK, CLI, MCP ([api-contract.md](api-contract.md)). Evidence: contract tests.
- One error shape everywhere ([AGENTS.md → Error shape](../AGENTS.md#error-shape)). Evidence: registry-mirror test.
- MCP read-only by default. Evidence: tool-registration test.

## Operations

- Structured JSON logs with `svix_id`, `email_id`, `type`; EMF metrics; alarms with runbook entries. Evidence: runbook link per alarm.
- Budget alarm with hard monthly cap; near-zero idle cost. Evidence: synth assertion + [check-before-launch.md](check-before-launch.md).

## Evidence harness

- `ledger simulate` with duplicates, shuffle, burst and chaos knobs; four invariants checked after every run. Evidence: the harness is its own evidence; results in `docs/results.md`.

## Ingester parity (reference, non-binding)

Against Resend's [Webhook Ingester](https://resend.com/docs/webhooks/ingester) as summarized in
[idea §2.2](../docs/idea.md#22-what-already-exists-the-resend-webhook-ingester). Every row MUST be
re-verified against the Ingester repo before this file is final.

| Capability | Ingester (+ PR #13) | Ledger |
| --- | --- | --- |
| Signature verification | Yes | Yes (multi-secret during rotation `[Unverified]`) |
| Idempotent raw storage | Yes | Yes |
| Recover missed events | Yes (PR #13, open) | Yes (replays re-enter through ingest) |
| Many database connectors | Yes | No — Postgres only (non-goal) |
| Ingest decoupled from storage | No | Yes (queue buffer) |
| Order-independent current state | No | Yes |
| Safe side effects (outbox) | No | Yes |
| Poison isolation (DLQ + redrive) | No | Yes |
| CLI / SDK / MCP | No | Yes |
