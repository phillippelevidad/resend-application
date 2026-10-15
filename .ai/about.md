# Ledger

A self-hosted, single-installation service that turns Resend webhooks into correct, current,
queryable state and safe reactions, and recovers the events it missed. Built in public as part
of an application to Resend. **Not affiliated with or endorsed by Resend.**

## Target personas

Two audiences. Ledger is designed for the first, and judged by the second.

- **Product personas** ([idea §4](../docs/idea.md#4-users-and-jobs-to-be-done)):
  - **Application developer:** knows when an address stops being deliverable, without writing webhook plumbing.
  - **Support / on-call engineer:** explains a specific delivery fast (`ledger email`, `ledger recipient`).
  - **Operator:** after an outage, proves nothing was lost, and recovers what was (`ledger gaps`, `ledger reconcile`).
  - **AI agent:** answers "why did this delivery fail?" through MCP, unable to break anything.
- **Reviewer:** a Resend engineer with about 30 minutes. Reads the README, runs the demo or reads
  its recorded output, and checks a few claims against their evidence. Arrives at a **milestone
  boundary** (M1, M2 or M3), timing unknown ([lens clause 3](../AGENTS.md#decision-lens--evidence-over-claims-right-sized)).

Every product persona is an actor the self-service test traces. Each finished slice is walked by
hand in every role that reaches it.

## Guiding principles

- **Evidence over claims (MUST):** every reliability claim links its evidence ([root lens](../AGENTS.md#decision-lens--evidence-over-claims-right-sized)).
- **Correct under real delivery (MUST):** duplicates, reordering, bursts and outages change nothing in the projected state ([idea §3](../docs/idea.md#3-goals-and-non-goals), goals 1–3).
- **Headless by default (SHOULD):** everything the owner can do, a script or an agent can do too (CLI `--json`, SDK, MCP).
- **Near-zero idle cost (MUST):** target in [Success metrics](#success-metrics); the cost brake is in the [lens](../AGENTS.md#decision-lens--evidence-over-claims-right-sized).

**Self-service test (MUST).** Walk `deploy → connect the webhook → ingest → query → recover → tear down`
and ask at each step: *who running Ledger has to do something by hand for this to work (an owner
script, a SQL query, a console click), or wait without bound, and is that intended?* Name the
manual fallback and where it sits. **In** the adopter's path, admit the smallest version that
removes it. **Off** it (owner-only demo ops), it is correctly cheap and defers on a tripwire.
Applied at scoping time by the [decision lens](../AGENTS.md#decision-lens--evidence-over-claims-right-sized).

## What this project must demonstrate

Each row is a requirement from a public Resend role post or a published Resend value, with where
the repo will prove it. Nothing is built yet, so **every row is a gap until its evidence lands**.
The slice that lands it updates this column with a link.

Sources: [Backend Engineer](https://resend.com/careers/df2fe05d-87ca-4e87-a66d-50bb2c9c4859) (BE) ·
[Software Engineer, Developer Tools](https://resend.com/careers/53d3710a-2d55-42ac-ba90-cdfd306bf560) (DT) ·
[Philosophy](https://resend.com/philosophy) · [tech stack](https://resend.com/handbook/engineering/what-is-our-tech-stack) ·
handbook pages linked per row. Checked 2026-10-15.

| Requirement / value | Source | Planned evidence |
| --- | --- | --- |
| Queues and workers that survive spikes, retries, duplicate events, concurrency and partial failure | BE; stack ("queues absorb spikes") | Worker-transaction integration tests; `fast-check` permutation and duplication properties; simulator burst + chaos invariants ([idea §5.9](../docs/idea.md#59-the-chaos-and-simulation-harness)) |
| Relational data models; safe database changes | BE | `packages/db` Drizzle schema; expand/contract migrations run in CI |
| Infrastructure as code (AWS CDK); serverless background work on Lambda | BE; stack | `infra/` CDK app; one-command deploy and teardown |
| Operate what you build: monitoring, safe deploys, incident recovery, runbooks | BE; [incidents](https://resend.com/handbook/engineering/how-we-handle-incidents), [on-call](https://resend.com/handbook/engineering/how-we-handle-on-call-rotations) | CloudWatch alarms in CDK; runbook; budget alarms + kill switch ([aws.md](aws.md#budget-alarms)) |
| Idempotency, retries, rate limits, partial failure | DT | Outbox `dedupe_key` + Resend idempotency keys; `packages/resend-client` rate-limit tests; `--chaos worker-crash` never duplicates an alert |
| One contract across SDK, CLI, MCP and docs; clear errors; backward compatibility | DT; Philosophy ("predictable by design") | One read-API contract ([api-contract.md](api-contract.md)); the [error shape](../AGENTS.md#error-shape); semver at M3 |
| AI agents as users, with their own discovery and security needs | DT | MCP read-only by default; operate tools unregistered without scope; redaction tests on tool output |
| Zero friction; documentation is the product | Philosophy | Newcomer deploy target in [Success metrics](#success-metrics); recovery through the Headless Webhook API with no dashboard step; 0 unlinked claims |
| Ship a minimal version early, in small PRs, after a written design | [shipping](https://resend.com/handbook/engineering/how-we-ship-new-features), [PRs](https://resend.com/handbook/engineering/how-we-handle-pull-requests), [RFCs](https://resend.com/handbook/engineering/how-we-use-rfcs) | [docs/idea.md](../docs/idea.md) as the RFC; v0 per slice; PR history |

## Milestones

No dates. Slice IDs map to milestones in [architecture.md](architecture.md). A reviewer may arrive
at any milestone boundary, so each one MUST leave the README claims, the demo and the deploy coherent.

- **M1 — MVP:** foundations, local v0, durable ingest on AWS, recovery, and a usable CLI. Evidence over breadth.
- **M2 — Feature complete:** every [idea §7](../docs/idea.md#7-implementation-plan) phase at v0 depth, real AWS deploy, simulator evidence.
- **M3 — Stretch:** SDK and CLI published to npm with semver; real AWS load numbers from the 10k burst; a learning log of the AWS and distributed-systems decisions.

Upstream PRs to Resend's Webhook Ingester are not planned.

## Success metrics

| Metric | Target | Evidence |
| --- | --- | --- |
| Simulator invariants after burst + chaos | 0 lost, 0 duplicated, N/N states correct | `sim` run output |
| Recovery after an outage past Resend's retry window | 100% of events recovered, 0 duplicates | Integration test ([idea §7](../docs/idea.md#7-implementation-plan) phase 3) |
| Newcomer deploy | ≤ 15 min, timed from "AWS account with CDK bootstrapped + a Resend API key" to "demo run". Account creation excluded | Timed README walkthrough |
| Idle AWS cost | ≤ USD 5 / month all-in | Billing export after 30 idle days |
| Monthly AWS spend | Hard cap USD 50: alerts **plus** a kill switch that stops compute | [aws.md → Budget alarms](aws.md#budget-alarms); a recorded trip drill |
| Burst numbers (M3, real AWS) | Published: p50/p99 ingest latency, queue drain time, AWS cost of one 10k burst | `docs/results.md` |
| Unlinked reliability claims in README / docs | 0 | Review |

## Platform scale assumptions

Design ceiling, not a growth plan:

- **Installation:** one deployment, one Resend team, one webhook endpoint ([idea §3](../docs/idea.md#3-goals-and-non-goals)).
- **Load:** the demo burst, 10,000 events in 10 s ([idea §5.9](../docs/idea.md#59-the-chaos-and-simulation-harness)). Nothing is engineered past it.
- **Resend API budget:** a per-team request limit shared across all of the team's API keys ([rate limits](https://resend.com/docs/api-reference/rate-limit)). Ledger's calls compete with the team's own API traffic and MUST leave headroom.
- **Events per email:** small lifecycle counts; opens and clicks are counters ([idea §5.4](../docs/idea.md#54-order-independent-projections)).
- **Demo traffic:** Resend test addresses only (`delivered@resend.dev`, `bounced@resend.dev`, …).

**Owner operations are capped too (MUST).** One owner, no team, no on-call rotation. A manual step
that recurs per deploy, per demo or per reviewer walk does not survive repeated reviews, so it is
in the adopter's path and MUST be scripted. Manual work is tolerable only off that path
([Risk appetite](#risk-appetite)).

## Positioning

Resend's [Webhook Ingester](https://resend.com/docs/webhooks/ingester), as of 2026-10-15
([repo](https://github.com/resend/resend-webhooks-ingester)):

- A self-hosted Next.js app: it verifies the Svix signature and inserts each event into your
  database, deduplicated on `svix_id`. It has 9 connectors (10 listed databases) and deploys to
  Vercel, Railway, Render or Docker.
- Verification and the database write happen in the same request. A failed write returns 500,
  so Resend retries it.
- It stores raw events only. It derives no state and runs no reactions. Status and rates are computed at read time.
- Open, not merged: [PR #13](https://github.com/resend/resend-webhooks-ingester/pull/13)
  ([#12](https://github.com/resend/resend-webhooks-ingester/issues/12)) adds an opt-in,
  Postgres-only `/reconcile` that replays events missing from the database.
  [Issue #8](https://github.com/resend/resend-webhooks-ingester/issues/8) asks for a per-email
  timeline.

The Ingester answers *what happened?* Ledger answers *what is true now, what should happen, and
what did we miss?*

- **Not in the Ingester:** queue-buffered ingest (a database outage is not a failed delivery);
  order-independent per-email and per-recipient state; an outbox for idempotent reactions;
  DLQ + redrive; CLI / SDK / MCP on one contract.
- **Overlaps PR #13:** recovering missed events by diffing against List Events and replaying. Ledger
  MUST describe its reconciler as the same approach, not as new.
- Ledger **complements** the Ingester and does not compete on connectors.
- Ledger MUST NOT imply affiliation with, or endorsement by, Resend, anywhere.

## Risk appetite

The [lens](../AGENTS.md#decision-lens--evidence-over-claims-right-sized) decides *how much* to build;
this decides *whose exposure* may run thin meanwhile.

- **MAY run thin:** only the owner's own demo operations (e.g. a manual step in the owner's
  personal account), and only with a cheap reversal and a countable tripwire.
- **MUST be discharged:** anything an adopter or a reviewer meets on the self-service path.
- **Budget cap over continuity (owner deployment):** when the hard cap trips, the kill switch stops
  compute. Webhooks that fail meanwhile are recovered by `ledger reconcile`, but only while List
  Events still holds them (reach `[Unverified]`, see [Open questions](#open-questions)). This is
  tolerable only in the owner's own demo deployment. So every deployment ships the kill switch
  **off by default**, and the owner's deployment turns it on; budget alerts are on everywhere
  ([aws.md → Budget alarms](aws.md#budget-alarms)).

**Never tolerable:**

- unbounded AWS spend, or a missing budget alarm;
- a live Resend **write** nobody requested (replay, rotate secret, webhook change, send);
- burning the shared Resend API budget;
- real recipient data in the repo, the deployed demo's database, logs or MCP output; secrets in the repo;
- security or PII exposure through any surface, MCP tool output included;
- implying affiliation with Resend;
- misstating Resend behavior.

## Domain vocabulary

| Concept | Use | Never | Code identifier |
| --- | --- | --- | --- |
| One Resend webhook delivery's content | event | message (that is SQS's), notification | `WebhookEvent`, `webhook_events` |
| Its stable id (`msg_...`) | svix_id | event id, webhook id | `svixId` / `svix_id` |
| The immutable event table | ledger | log, event store | `webhook_events` |
| State derived from the event set | projection | status cache, view | `projectEmail`, `email_state` |
| Asking Resend to redeliver an event | replay | resend, retry | `replay` |
| Re-queuing DLQ messages | redrive | replay | `redrive` |
| Finding and closing missing events | reconcile | sync, backfill | `reconcile`, `reconcile_runs` |
| A reaction queued in the same transaction | outbox entry | job, task | `outbox`, `dedupe_key` |
| Someone who deploys Ledger | adopter | customer, tenant, integrator | — |
| The control that stops compute when the monthly cap is hit | kill switch | circuit breaker | — |
| A countable threshold or named event that reopens a deferral | tripwire | "when demand warrants" | — |

## Non-goals / out of scope

From [idea §3](../docs/idea.md#3-goals-and-non-goals) and the owner calibration:

- Multi-database connectors, warehouse loading, analytics dashboards (the Ingester covers these).
- Multi-tenant hosting. One installation, one team.
- Sending email, except operational alerts through Resend.
- A full web UI. A minimal read-only page is a deferral, see [Open questions](#open-questions).
- Projections for non-email events in v0 (stored raw).
- Upstream PRs to the Webhook Ingester.

## Open questions

Each bullet is unconfirmed. Do not build on an `[Unverified]` claim without confirming it. Scope
questions carry a tripwire instead. Carried from [idea §10](../docs/idea.md#10-open-questions)
(numbered `§10.N`) plus what research on 2026-10-15 surfaced.

**Owed by a slice (MUST, owner 2026-10-15).** Every unverified fact names the slice that owes it.
That slice MUST settle the fact, or prove the design safe under either answer, before it is done,
so nothing ships resting on a guess. This matters most for anything touching duplicate effects or
security. Slices are named by phase and milestone until
[build-checklist.md](build-checklist.md) assigns card anchors.

**Unverified facts.** For Resend behavior, the canonical row (evidence, experiment, owing slice) is
in [resend.md → \[Unverified\]](resend.md#unverified). The bullets below say what each one decides.

- **Replay keeps `svix-id` ([RS-U01](resend.md#unverified)).** If false, reconcile replays the same event forever and effects duplicate. Settled by an Ask-first replay. · *recovery · M1*, MUST be settled `[Unverified]`
- **List Events ids are `svix-id`s ([RS-U02](resend.md#unverified)).** The reconcile id diff depends on it. Read-only check after the first real delivery. · *recovery · M1*, MUST be settled `[Unverified]`
- **List Events reach (§10.2, [RS-U03](resend.md#unverified)).** Decides the longest recoverable outage, the reconciler's default lookback, and whether events missed while the kill switch is tripped are recoverable. · *recovery · M1*, re-measured before M2 closes `[Unverified]`
- **Disabled webhooks: replays, events created while disabled, threshold ([RS-U04–U06](resend.md#unverified)).** Decides how fast the reconciler detects a disabled webhook and whether re-enabling needs a reconcile. The design reads `status` every run, so it is safe either way. · *recovery · M1* `[Unverified]`
- **Event timestamps (§10.3, [RS-U10](resend.md#unverified)).** Top-level `created_at` is "when the webhook event was created". Whether it tracks the real event, and stays stable across replays, is unstated. Affects projection tie-breaking. · *foundations · M1* `[Unverified]`
- **Bounce after delivery (§10.4, [RS-U11](resend.md#unverified)), and `Temporary` bounces ([RS-U12](resend.md#unverified)).** Decides precedence override vs exposing both outcomes, and what counts as a hard bounce. · *foundations · M1* `[Unverified]`
- **Reconcile cadence vs the shared API budget (§10.5).** What default cadence never competes meaningfully with the team's own API traffic ([RS-19](resend.md#facts))? Settled in [integrations.md](integrations.md). `[Unverified]`
- **Failure responses and timeout ([RS-U07, RS-U08](resend.md#unverified)).** Whether a `401` stops Resend's retries (it contradicts [idea §5.2](../docs/idea.md#52-ingest)), and Resend's delivery timeout. · *durable ingest · M1* `[Unverified]`
- **Rotation header format ([RS-U09](resend.md#unverified)).** How both signatures appear during the 24 h overlap. Security-relevant. Safe either way with per-secret verification. · *recovery · M1* `[Unverified]`
- **Test sends without a verified domain ([RS-U14](resend.md#unverified)).** Decides whether the [verify stage](features.md#adopter-lifecycle) needs a verified domain. · *durable ingest · M1* `[Unverified]`
- **Kill-switch reach ([AWS-U01, AWS-U02](aws.md#unverified)).** Whether the budget deploys from us-east-2 and reaches a us-east-2 topic, and whether a route throttle of `0` stops API Gateway billing after a trip. Together they decide whether the hard cap holds. Settled by the first guardrails deploy and the trip drill. · *durable ingest · M1*, MUST be settled `[Unverified]`
- **Smaller AWS gaps ([AWS-U03–U07](aws.md#unverified)).** Idle ESM polling cost, when the body is base64-encoded, the account concurrency quota, secret deletion on teardown, free-tier coverage. Each is safe either way and names its slice. `[Unverified]`
- **Smaller Resend gaps ([RS-U13, U15–U19](resend.md#unverified)).** List Events visibility lag, test-address event sequences, idempotency-key scope, invalid-key status code, orphaned `listen` webhooks, the `email.suppressed` object. Each row names its slice. `[Unverified]`

**Scope questions (deferred on a tripwire):**

- **Inngest adapter (§10.7).** A second worker implementation as a comparison. Tripwire: M2 is done **and** a row in [What this project must demonstrate](#what-this-project-must-demonstrate) names a claim only it can prove.
- **Minimal read-only UI (§10.8).** Tripwire: M2 is done **and** a demo step cannot be shown through CLI or MCP output.
- **Inbound email projection (§10.9).** `email.received` carries metadata only; the body and attachments come from separate APIs ([email.received](https://resend.com/docs/webhooks/emails/received)). Stored raw in v0. Tripwire: M2 is done **and** a row in What this project must demonstrate names inbound email.
- **Project domain.** No domain is bought or verified in Resend yet; sends from `onboarding@resend.dev` reach the owner's own address, and the API Gateway URL serves as the webhook endpoint. Tripwire: the first slice that must send email to anyone other than the owner's Resend account address, or that needs a stable public demo URL.
- **Final name (§10.10).** "Ledger" is a working name. Deferred to M3. Tripwire: before the first npm publish.
- **MVP CLI read path.** Does the M1 CLI read the database directly ([idea §7](../docs/idea.md#7-implementation-plan) phase 1), or only through the SDK ([module boundaries](../AGENTS.md#module-boundaries))? Decided in [architecture.md](architecture.md) (bootstrap step 7).

**Resolved** (kept so the §10 carry is traceable; canonical facts move to [resend.md](resend.md)):

- **Secret rotation (§10.1).** For 24 hours after a rotation, both secrets sign ([RS-04](resend.md#facts)). Verification MUST accept both during that window.
- **Retry window.** Resend's docs disagree: "up to 24 hours" on one page, a schedule spanning ≈ 27.6 h on another. Ledger designs to the longer window ([resend.md → Constraint 3](resend.md#constraints-and-sharp-edges)), which is safe under either.
- **Upstream contribution (§10.6).** Closed. Upstream PRs are not planned (owner calibration, 2026-10-15).
