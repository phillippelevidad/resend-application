# Ledger

> **TEMPLATE — not ratified.** Bootstrap step 1 in [bootstrap-checklist.md](bootstrap-checklist.md). The preview content below is illustrative, drafted from [docs/idea.md](../docs/idea.md) without research. Nothing here is binding until this banner and the instructions comment are removed.

<!-- AGENT INSTRUCTIONS
Purpose: the canonical product doc. Who Ledger is for, what the repo must prove, how far it scales,
whose risk may run thin, the words to use, what is out of scope, and every unconfirmed claim.

Consumers: every wf-* skill. wf-before-propose reads #target-personas, #domain-vocabulary,
#non-goals--out-of-scope, #platform-scale-assumptions, #risk-appetite (references/doc-map.md) and
writes unverified items to #open-questions. wf-before-propose-check, wf-after-propose-check and
wf-after-apply-check rank #risk-appetite above their own reasoning and run the self-service test
from #guiding-principles. The decision lens in root AGENTS.md links #platform-scale-assumptions,
#what-this-project-must-demonstrate and #risk-appetite. .ai/AGENTS.md routes every [Unverified] tag here.

Inputs (read first): root AGENTS.md; bootstrap-checklist.md → "Owner calibration (ratified
2026-10-15)" (binding, not re-asked); docs/idea.md in full (§2.2, §3, §4, §7, §9, §10 most).
MAY read about/ (git-ignored) for role context. NEVER copy personal details, names, employers,
locations or the owner's gap list into this file. Public-safe abstractions only.

Research:
- Webhook Ingester: current connector count, status of PR #13 (/reconcile) and issue #8, read from
  https://github.com/resend/resend-webhooks-ingester and https://resend.com/docs/webhooks/ingester.md.
  Positioning MUST match what the Ingester does today.
- Role requirements: the public Resend job posts (Backend Engineer; Software Engineer, Developer
  Tools). Paraphrase as abstract requirements. No quotes that identify people.
- Resend values / stack: https://resend.com/handbook/engineering/what-is-our-tech-stack and the
  public handbook. Cite each page used.
- Any Resend behavior stated here (rate limit, retention, retry window): verify against
  https://resend.com/docs/llms.txt and cite, or link resend.md once step 4 lands. Never restate a
  fact canonical in resend.md / aws.md; link it.

Required structure (anchors skills cite; heading text MUST be exactly):
  ## Target personas · ## Guiding principles · ## What this project must demonstrate ·
  ## Milestones · ## Success metrics · ## Platform scale assumptions · ## Positioning ·
  ## Risk appetite · ## Domain vocabulary · ## Non-goals / out of scope (slug
  non-goals--out-of-scope) · ## Open questions.
  The self-service test MUST appear verbatim under Guiding principles with the flow
  `deploy → connect the webhook → ingest → query → recover → tear down`.
  Milestones MUST match the owner calibration exactly (M1/M2/M3, no dates).

Decision lens rewrite (part of this step; do it in root AGENTS.md, not here). Keep the heading
text "Decision lens — evidence over claims, right-sized" exactly (skills cite its anchor). Keep the
existing evidence, verify-Resend, complement, stack and v0 bullets. Add these clauses, drawn from
the calibration:
  1. Right-size to the ceiling in about.md#platform-scale-assumptions; it caps owner operations
     as well as engineering.
  2. Reversible-cheap over optimal-expensive. Sort every deferral by its stated reason: temporal
     (cost, sequencing) → defer with a countable threshold or named observable event, never "when
     demand warrants"; categorical (holds at every point below the ceiling: SQS FIFO,
     multi-database, multi-tenant) → reject, reopened only by a superseding ADR.
  3. Reviewers arrive after the last slice. MUST NOT argue from adopter or reviewer harm in the
     gap between slices; a gap a named later slice carries is the plan working. MUST still leave
     every finished slice hand-walkable through the CLI, the API or the simulator. Surviving
     reasons to pull work forward: build cost and testability.
  4. The self-service test (from #guiding-principles), asked at scoping time.
  5. Signal clause: effort is admitted when it produces something a reviewer can check (a test, an
     invariant, a measured number, a working command) against a row in
     #what-this-project-must-demonstrate. Overdoing it = generality beyond the ceiling, polish
     nobody notices in a 30-minute review, infrastructure depth no claim depends on. AWS learning
     counts only when an ADR or a test makes it visible.
  6. Spend anyway when absence causes: lost events; duplicate effects; order-dependent state;
     security or PII exposure, including MCP tool output; misstating Resend behavior or implying
     affiliation; a gap in budget alarms.
  7. Deploy-and-keep AWS posture inside the cost brake: real deploys stay up until the owner tears
     them down; idle cost near zero; budget alarms with a hard monthly cap are mandatory, not polish;
     teardown is one command.
  8. Tie-break: keep the existing order; add "the self-service test decides whether, the cost
     brake decides how much".
  Then score the draft against decision-lens-suite.md (step 2) before ratifying.

Evidence rules: every reliability claim links its test, property, invariant or cited page
(root AGENTS.md → Decision lens). Anything unconfirmed is tagged [Unverified] and listed under
Open questions. Delete every [Preview] tag; a line still needing one is not ready.

Owner decisions to surface (one batched round, one recommended pick each):
  - Confirm the lens draft and the risk appetite (required by the checklist).
  - Monthly budget cap in USD for the hard alarm (recommend a small round number the owner would
    not mind losing; aws.md designs the alarm).
  - Success-metric targets: idle cost ceiling, newcomer deploy time (recommend idea §7's
    15 minutes), burst numbers to publish (recommend p50/p99 ingest latency + drain time).
  - Open question 10 (final name): recommend deferring to M3 with tripwire "before the first npm
    publish".

Done when: every anchor above resolves; idea §10 is carried into Open questions; the lens is
rewritten in root AGENTS.md and confirmed by the owner; no [Preview] tag remains; banner and this
comment are removed.
-->

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
- **Reviewer** [Preview]: a Resend engineer with about 30 minutes. Reads the README, runs the
  demo or reads its recorded output, and checks a few claims against their evidence. Arrives after
  the last slice.

## Guiding principles

- **Evidence over claims (MUST):** every reliability claim links its evidence ([root lens](../AGENTS.md#decision-lens--evidence-over-claims-right-sized)).
- **Correct under real delivery (MUST):** duplicates, reordering, bursts and outages change nothing in the projected state.
- **Headless by default (SHOULD):** everything the owner can do, a script or an agent can do too (CLI `--json`, SDK, MCP).
- **Near-zero idle cost (MUST):** see the cost brake in the [lens](../AGENTS.md#decision-lens--evidence-over-claims-right-sized).

**Self-service test (MUST).** Walk `deploy → connect the webhook → ingest → query → recover → tear down`
and ask at each step: *who running Ledger has to do something by hand for this to work (an owner
script, a SQL query, a console click), or wait without bound, and is that intended?* Name the
manual fallback and where it sits. **In** the adopter's path, admit the smallest version that
removes it. **Off** it (owner-only demo ops), it is correctly cheap and defers on a tripwire.
Applied at scoping time by the [decision lens](../AGENTS.md#decision-lens--evidence-over-claims-right-sized).

## What this project must demonstrate

Each row is a role requirement or a Resend value, and where the repo proves it. A row without
evidence is a gap, not a claim.

| Requirement / value | Where the repo proves it |
| --- | --- |
| Queues and workers that handle spikes, retries, duplicates, partial failures | [Preview] worker transaction, `fast-check` properties, simulator invariants ([idea §5.9](../docs/idea.md#59-the-chaos-and-simulation-harness)) |
| Infrastructure as code; operating what you build (monitoring, safe deploys) | [Preview] `infra/` CDK stack, alarms, runbook, budget alarm |
| Relational data model; safe database changes | [Preview] `packages/db` Drizzle schema, expand/contract migrations |
| Idempotency, rate limits, authn/authz | [Preview] outbox `dedupe_key` + Resend idempotency keys; `packages/resend-client` budget; `read`/`operate` scopes |
| Interfaces developers and agents depend on: clear errors, compatibility | [Preview] SDK, CLI, MCP on one contract; the [error shape](../AGENTS.md#error-shape); semver at M3 |
| Agents as users with their own security needs | [Preview] MCP read-only by default, operate tools unregistered without scope, redaction |
| Headless direction: everything programmatic | [Preview] recovery via the Headless Webhook API, no dashboard step |

## Milestones

No dates. Slice IDs map to milestones in [architecture.md](architecture.md).

- **M1 — MVP:** foundations, local v0, durable ingest on AWS, recovery, and a usable CLI. Evidence over breadth.
- **M2 — Feature complete:** every [idea §7](../docs/idea.md#7-implementation-plan) phase at v0 depth, real AWS deploy, simulator evidence.
- **M3 — Stretch:** SDK and CLI published to npm with semver; real AWS load numbers from the 10k burst; a learning log of the AWS and distributed-systems decisions.

Upstream PRs to Resend's Webhook Ingester are not planned.

## Success metrics

| Metric | Target | Evidence |
| --- | --- | --- |
| Simulator invariants after burst + chaos | 0 lost, 0 duplicated, N/N states correct | `sim` run output |
| Newcomer: clone → deployed → demo run | [Preview] ≤ 15 min ([idea §7](../docs/idea.md#7-implementation-plan)) | README walkthrough |
| Idle AWS cost per month | [Preview] near zero; hard cap set by the owner | Budget alarm, billing export |
| Unlinked reliability claims in README / docs | 0 | Review |

## Platform scale assumptions

Design ceiling, not a growth plan:

- **Installation:** one deployment, one Resend team, one webhook endpoint [Preview].
- **Load:** the demo burst, 10,000 events in 10 s ([idea §5.9](../docs/idea.md#59-the-chaos-and-simulation-harness)). Nothing is engineered past it.
- **Resend API budget:** 10 req/s per team, shared with the team's sending traffic ([rate limits](https://resend.com/docs/api-reference/rate-limit)). Ledger's calls MUST leave headroom.
- **Events per email:** small lifecycle counts; opens and clicks are counters ([idea §5.4](../docs/idea.md#54-order-independent-projections)).

**Owner operations are capped too (MUST).** One owner, no team, no on-call rotation. A manual step
that recurs per deploy, per demo or per reviewer walk does not survive repeated reviews, so it is
in the adopter's path and MUST be scripted. Manual work is tolerable only off that path
([Risk appetite](#risk-appetite)).

## Positioning

- Resend's [Webhook Ingester](https://resend.com/docs/webhooks/ingester) answers *what happened?*: verified, idempotent raw rows in your database of choice.
- Ledger answers *what is true now, what should happen, and what did we miss?*: order-independent state, idempotent reactions, queue-buffered ingest, recovery, CLI / SDK / MCP.
- Ledger **complements** the Ingester; it does not compete on connectors. Comparison: [idea §2.2](../docs/idea.md#22-what-already-exists-the-resend-webhook-ingester) [Preview: re-verify].
- Ledger MUST NOT imply affiliation with, or endorsement by, Resend, anywhere.

## Risk appetite

The [lens](../AGENTS.md#decision-lens--evidence-over-claims-right-sized) decides *how much* to build;
this decides *whose exposure* may run thin meanwhile.

- **MAY run thin:** only the owner's own demo operations (e.g. a manual step in the owner's
  personal account), and only with a cheap reversal and a countable tripwire.
- **MUST be discharged:** anything an adopter or a reviewer meets on the self-service path.

**Never tolerable:**

- unbounded AWS spend, or a missing budget alarm;
- a live Resend **write** nobody requested (replay, rotate secret, webhook change, send);
- burning the shared 10 req/s budget;
- real recipient addresses or secrets in the repo;
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
| Someone who deploys Ledger | adopter | customer, tenant | — |

## Non-goals / out of scope

From [idea §3](../docs/idea.md#3-goals-and-non-goals) and the owner calibration:

- Multi-database connectors, warehouse loading, analytics dashboards (the Ingester covers these).
- Multi-tenant hosting. One installation, one team.
- Sending email, except operational alerts through Resend.
- A full web UI.
- Projections for non-email events in v0 (stored raw).
- Upstream PRs to the Webhook Ingester.

## Open questions

Each bullet is unconfirmed. Do not build on an `[Unverified]` claim without confirming it.

- Secret rotation: does Resend sign with both secrets for an overlap period, or switch immediately? Decides whether multi-secret verification is required. `[Unverified]`
- List Events retention: how far back does it go? Bounds the recoverable outage and the default lookback. `[Unverified]`
- Event timestamps: is `created_at` set when the event occurs or when it is generated? Affects projection tie-breaking. `[Unverified]`
- Asynchronous bounces after delivery: how common, and is precedence override the right semantics? `[Unverified]`
- Reconcile cadence vs the shared 10 req/s: what default never competes with sending traffic? `[Unverified]`
- Upstream contribution: is `packages/core` useful to the Ingester (issue #8)? Calibration says no PRs planned. `[Unverified]`
- Inngest adapter: worth it as a comparison, or scope creep? `[Unverified]`
- Minimal read-only UI: worth adding, or are CLI + MCP enough? `[Unverified]`
- Inbound email: is there a compelling `email.received` projection? `[Unverified]`
- Final name: "Ledger" is a working name. `[Unverified]`
- [Preview] MVP CLI: reads the database directly ([idea §7](../docs/idea.md#7-implementation-plan) phase 1) or only via the SDK ([module boundaries](../AGENTS.md#module-boundaries))? Settled in step 7. `[Unverified]`
