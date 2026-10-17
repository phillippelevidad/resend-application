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
  **Access (owner, 2026-10-15):** recordings in the README. On request, the owner issues a
  `read`-scoped token for the kept deploy and revokes it after the review. The deployed URL is
  never published ([check-before-launch.md → CBL-20](check-before-launch.md#public-repo-hygiene)).

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
| Queues and workers that survive spikes, retries, duplicate events, concurrency and partial failure | BE; stack ("queues absorb spikes") | Worker-transaction integration tests; `fast-check` permutation and duplication properties ([project-email.projection.prop.test.ts](../packages/core/src/project-email.projection.prop.test.ts)); simulator burst + chaos invariants ([architecture.md → Simulator invariants](architecture.md#simulator-invariants)) |
| Relational data models; safe database changes | BE | `packages/db` Drizzle schema ([webhook-events.ts](../packages/db/src/schema/webhook-events.ts) and its siblings, [the first migration](../packages/db/drizzle/0000_create-ledger-tables.sql)); expand/contract migrations run in CI by the `int` stage of [`scripts/verify.mjs`](../scripts/verify.mjs), which migrates a fresh Postgres before any [repository integration test](../packages/db/src/webhook-events.repository.int.test.ts) runs as the runtime role (slice 1), and linted for contract-breaking DDL (slice 2) |
| Infrastructure as code (AWS CDK); serverless background work on Lambda | BE; stack | `infra/` CDK app; one-command deploy and teardown |
| Operate what you build: monitoring, safe deploys, incident recovery, runbooks | BE; [incidents](https://resend.com/handbook/engineering/how-we-handle-incidents), [on-call](https://resend.com/handbook/engineering/how-we-handle-on-call-rotations) | CloudWatch alarms in CDK; runbook; budget alarms + kill switch ([aws.md](aws.md#budget-alarms)) |
| Idempotency, retries, rate limits, partial failure | DT | Outbox `dedupe_key` + Resend idempotency keys; `packages/resend-client` rate-limit tests; `--chaos worker-crash` and `--chaos dispatcher-crash` never duplicate an alert |
| One contract across SDK, CLI, MCP and docs; clear errors; backward compatibility | DT; Philosophy ("predictable by design") | One read-API contract ([api-contract.md](api-contract.md)); the [error shape](../AGENTS.md#error-shape); semver at M3 |
| AI agents as users, with their own discovery and security needs | DT | MCP read-only by default; operate tools unregistered without scope; redaction tests on tool output |
| Zero friction; documentation is the product | Philosophy | Newcomer deploy target in [Success metrics](#success-metrics); recovery through the Headless Webhook API with no dashboard step; 0 unlinked claims |
| Ship a minimal version early, in small PRs, after a written design | [shipping](https://resend.com/handbook/engineering/how-we-ship-new-features), [PRs](https://resend.com/handbook/engineering/how-we-handle-pull-requests), [RFCs](https://resend.com/handbook/engineering/how-we-use-rfcs) | [docs/idea.md](../docs/idea.md) as the RFC; v0 per slice; PR history |

## Milestones

No dates. Slice IDs map to milestones in [architecture.md](architecture.md); [build-checklist.md](build-checklist.md)
carries one card per slice. A reviewer may arrive
at any milestone boundary, so each one MUST leave the README claims, the demo and the deploy coherent.

- **M1 — MVP:** foundations, local v0, durable ingest on AWS, recovery, and a usable CLI. Evidence over breadth.
- **M2 — Feature complete:** every [idea §7](../docs/idea.md#7-implementation-plan) phase at v0 depth, real AWS deploy, simulator evidence.
- **M3 — Stretch:** SDK and CLI published to npm with semver; real AWS load numbers from the 10k burst; a learning log of the AWS and distributed-systems decisions.

Upstream PRs to Resend's Webhook Ingester are not planned.

## Success metrics

| Metric | Target | Evidence |
| --- | --- | --- |
| Simulator invariants after burst + chaos | 0 lost, 0 duplicated, N/N states correct | `sim` run output |
| Recovery after an outage past Resend's retry window | 100% of events recovered, 0 duplicates | Fake-API integration test · [slice 4](build-checklist.md#4--recovery) |
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
- **Emails per recipient:** a broadcast's recipients are distinct. The simulator burst spreads its recipients over `+label` test addresses (RS-32).
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
| The Lambda resource that polls SQS and invokes the worker | ESM (event source mapping) | "ESM" for the JavaScript module system: write "ES modules" | `AWS::Lambda::EventSourceMapping` |

## Non-goals / out of scope

From [idea §3](../docs/idea.md#3-goals-and-non-goals), as ratified by the owner (2026-10-15):

- Multi-database connectors, warehouse loading, analytics dashboards (the Ingester covers these).
- Multi-tenant hosting. One installation, one team.
- Sending email, except reaction alert emails through Resend (operational alerts go through CloudWatch → SNS).
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
security. Each bullet links its [build-checklist.md](build-checklist.md) card.

**Unverified facts.** For Resend behavior, the canonical row (evidence, experiment, owing slice) is
in [resend.md → \[Unverified\]](resend.md#unverified). The bullets below say what each one decides.

- **Replay keeps `svix-id` ([RS-U01](resend.md#unverified)) and passes the timestamp window ([RS-U20](resend.md#unverified)).** If the id changes, reconcile replays the same event forever and effects duplicate; if the timestamp is stale, ingest rejects every replay. Settled by one Ask-first replay. · [slice 4](build-checklist.md#4--recovery), MUST be settled `[Unverified]`
- **List Events ids are `svix-id`s ([RS-U02](resend.md#unverified)).** The reconcile id diff depends on it. Read-only check after the first real delivery. · [slice 4](build-checklist.md#4--recovery), MUST be settled `[Unverified]`
- **List Events reach (§10.2, [RS-U03](resend.md#unverified)).** Decides the longest recoverable outage, the reconciler's default lookback, and whether events missed while the kill switch is tripped are recoverable. · [slice 4](build-checklist.md#4--recovery), re-measured in [slice 7](build-checklist.md#7--polish-and-retention) before M2 closes `[Unverified]`
- **Disabled webhooks: replays, events created while disabled, threshold ([RS-U04–U06](resend.md#unverified)).** Decides how fast the reconciler detects a disabled webhook and whether re-enabling needs a reconcile. The design reads `status` every run, so it is safe either way. · [slice 4](build-checklist.md#4--recovery) `[Unverified]`
- **Event timestamps (§10.3, [RS-U10](resend.md#unverified)).** Top-level `created_at` is "when the webhook event was created". Whether it tracks the real event, and stays stable across replays, is unstated. Affects projection tie-breaking; the projection is safe either way ([project-email.projection.prop.test.ts](../packages/core/src/project-email.projection.prop.test.ts), the tie-heavy RS-U10 test). · [slice 0](build-checklist.md#0--foundations), experiment in [slice 4](build-checklist.md#4--recovery) `[Unverified]`
- **Bounce after delivery (§10.4, [RS-U11](resend.md#unverified)), and non-`Permanent` bounce types ([RS-U12](resend.md#unverified)).** Decides precedence override vs exposing both outcomes, and which bounce types `soft_bouncing` folds. `Permanent` is the hard bounce ([RS-35](resend.md#facts)). Precedence is safe either way on RS-U11 ([project-email.projection.prop.test.ts](../packages/core/src/project-email.projection.prop.test.ts), "a bounce outranks delivered in either world (RS-U11)"). Deliverability is safe either way on RS-U12: every non-`Permanent` value folds into `soft_bouncing` ([project-recipient.projection.prop.test.ts](../packages/core/src/project-recipient.projection.prop.test.ts), "only `Permanent` yields hard_bounced; any other bounce.type yields soft_bouncing (RS-U12)"). · [slice 0](build-checklist.md#0--foundations) `[Unverified]`
- **Postgres host (Neon Free) behavior ([PG-U01–U04, PG-U06, PG-U07](integrations.md#unverified)).** Whether Neon's 90-day inactivity deletion can reach a kept-up Free project (deletion would lose the ledger), whether row locks hold through its transaction-mode pooler, whether idle use stays inside the wake budget, whether a connection survives a compute suspend, whether its pooler applies role-level timeouts (PG-U06), and which error it raises over the Free storage limit (PG-U07). · [slice 2](build-checklist.md#2--durable-ingest-on-aws) (PG-U03 moved to [slice 4](build-checklist.md#4--recovery), [architecture.md](architecture.md#open-questions-owed-by-slice)); PG-U01, PG-U02 and PG-U06 MUST be settled in slice 2, PG-U07 by [slice 3](build-checklist.md#3--operations-and-evidence-on-aws) `[Unverified]`
- **Failure responses and timeout ([RS-U07, RS-U08](resend.md#unverified)).** Whether a `401` stops Resend's retries (it contradicts [idea §5.2](../docs/idea.md#52-ingest)), and Resend's delivery timeout. · [slice 2](build-checklist.md#2--durable-ingest-on-aws) (RS-U07); [slice 3](build-checklist.md#3--operations-and-evidence-on-aws) (RS-U08's measured p99 comes from the burst) `[Unverified]`
- **Rotation header format ([RS-U09](resend.md#unverified)).** How both signatures appear during the 24 h overlap. Security-relevant. Safe either way with per-secret verification. · [slice 4](build-checklist.md#4--recovery) `[Unverified]`
- **Test sends without a verified domain ([RS-U14](resend.md#unverified)).** Decides whether the [verify stage](features.md#adopter-lifecycle) needs a verified domain. · [slice 2](build-checklist.md#2--durable-ingest-on-aws) `[Unverified]`
- **Kill-switch reach ([AWS-U01, AWS-U02](aws.md#unverified)).** Whether the budget deploys from us-east-2 and reaches a us-east-2 topic, and whether a route throttle of `0` stops API Gateway billing after a trip. Together they decide whether the hard cap holds. Settled by the first guardrails deploy and the trip drill. · [slice 2](build-checklist.md#2--durable-ingest-on-aws), MUST be settled `[Unverified]`
- **Smaller AWS gaps ([AWS-U03–U07, AWS-U09](aws.md#unverified)).** Idle ESM polling cost, when the body is base64-encoded, the account concurrency quota, secret deletion on teardown, free-tier coverage, whether a redeploy re-enables a disabled event source. Each is safe either way and names its slice. · [slice 2](build-checklist.md#2--durable-ingest-on-aws) `[Unverified]`
- **Smaller Resend gaps ([RS-U13, U15–U19, U22](resend.md#unverified)).** List Events visibility lag, test-address event sequences, idempotency-key scope, invalid-key status code, orphaned `listen` webhooks, the `email.suppressed` object (RS-U19, safe either way: [email-event.schema.test.ts](../packages/core/src/email-event.schema.test.ts)), how a `listen` session's signing secret reaches local ingest. Each row names its slice. `[Unverified]`
- **Per-event recipient lists ([RS-U21](resend.md#unverified)).** Whether a bounce on a multi-recipient email lists only the impacted recipients in `data.to`. If not, a healthy co-recipient would read `hard_bounced`. Settled by one Ask-first two-recipient send. · [slice 1](build-checklist.md#1--local-ledger-and-read-path), MUST be settled `[Unverified]`

**Library behavior the `pp-*` skills assume.** Each is checked against the installed version by
the slice named; the skill file states the fallback. None touches duplicate effects or ordering.

- **Lambda's log-level filter and Winston's lowercase levels ([pp-general → logging-and-pii](../.agents/skills/pp-general/references/logging-and-pii.md)).** If the filter rejects `info`, the format writes the uppercase name. · [slice 2](build-checklist.md#2--durable-ingest-on-aws) `[Unverified]`
- **`@hono/zod-openapi`'s `415` ([pp-backend → read-api](../.agents/skills/pp-backend/references/read-api.md)).** Whether a missing `Content-Type` reaches `defaultHook` or `onError`, or bypasses the error shape. · [slice 1](build-checklist.md#1--local-ledger-and-read-path) `[Unverified]`
- **Drizzle and `pg` ([pp-database → schema-and-repositories](../.agents/skills/pp-database/references/schema-and-repositories.md), [migrations-and-grants](../.agents/skills/pp-database/references/migrations-and-grants.md)).** identity on `bigint`; whether an identity sequence needs no `INSERT` grant (moved from slice 1: none of slice 1's four tables has an identity column; slice 2's `api_tokens` is the first); `pg`'s code-less connection errors, matched by message, pinned with PG-U04 · [slice 2](build-checklist.md#2--durable-ingest-on-aws). `[Unverified]`
- **CDK bundling and synth ([pp-infra → cdk-app](../.agents/skills/pp-infra/references/cdk-app.md), [env-and-inputs](../.agents/skills/pp-infra/references/env-and-inputs.md), [scripts](../.agents/skills/pp-infra/references/scripts.md)).** A CommonJS `require()` inside an ES-module bundle, and `pg-native` at bundle time (a bundle smoke check); every construct synthesizing without a concrete account; resolving the `aws-cdk` CLI entry to spawn it without a shell; the read cost of month-to-date spend ([AWS-U10](aws.md#unverified)). · [slice 2](build-checklist.md#2--durable-ingest-on-aws) `[Unverified]`
- **MCP SDK v2 ([pp-mcp](../.agents/skills/pp-mcp/SKILL.md), [mcp-tests](../.agents/skills/pp-mcp/references/mcp-tests.md)).** Whether the SDK's own argument-rejection text quotes the argument (the redaction test covers it); the v2 client's tool-listing call. · [slice 5](build-checklist.md#5--mcp-server-and-contract-hardening) `[Unverified]`

**Scope questions (deferred on a tripwire):**

- **Inngest adapter (§10.7).** A second worker implementation as a comparison. Tripwire: M2 is done **and** a row in [What this project must demonstrate](#what-this-project-must-demonstrate) names a claim only it can prove.
- **Minimal read-only UI (§10.8).** Tripwire: M2 is done **and** a demo step cannot be shown through CLI or MCP output.
- **Inbound email projection (§10.9).** `email.received` carries metadata only; the body and attachments come from separate APIs ([email.received](https://resend.com/docs/webhooks/emails/received)). Stored raw in v0. Tripwire: M2 is done **and** a row in What this project must demonstrate names inbound email.
- **Project domain.** No domain is bought or verified in Resend yet; sends from `onboarding@resend.dev` reach the owner's own address, and the API Gateway URL serves as the webhook endpoint. Tripwire: the first slice that must send email to anyone other than the owner's Resend account address, or that needs a stable public demo URL.
- **Final name (§10.10).** "Ledger" is a working name. Deferred to M3. Tripwire: before the first npm publish. Owed by [slice 8](build-checklist.md#8--npm-release).

**Resolved** (kept so the §10 carry is traceable; canonical facts move to [resend.md](resend.md)):

- **MVP CLI read path.** Through the SDK, from slice 1: a minimal read API, SDK and CLI run locally, and each M1 slice adds its operations ([architecture.md → ADR-011](architecture.md#adr-011--one-contract-many-surfaces); owner, 2026-10-15).
- **Secret rotation (§10.1).** For 24 hours after a rotation, both secrets sign ([RS-04](resend.md#facts)). Verification MUST accept both during that window.
- **Retry window.** Resend's docs disagree: "up to 24 hours" on one page, a schedule spanning ≈ 27.6 h on another. Ledger designs to the longer window ([resend.md → Constraint 3](resend.md#constraints-and-sharp-edges)), which is safe under either.
- **Reconcile cadence vs the shared API budget (§10.5).** Hourly by default, through a 2 req/s client limiter per single-flight caller ([ADR-012](architecture.md#adr-012--resend-client-is-the-sole-resend-api-caller)) that yields when `ratelimit-remaining` runs low ([integrations.md → Locked rules](integrations.md#locked-rules-must); owner, 2026-10-15).
- **MCP SDK line and tool annotations.** The package is `@modelcontextprotocol/server` v2, stable since 2.0.0 on 2026-07-27 ([npm](https://registry.npmjs.org/@modelcontextprotocol/server); [ADR-019](architecture.md#adr-019--application-and-surface-stack)); `@modelcontextprotocol/sdk` is the v1 maintenance line ([SDK README](https://github.com/modelcontextprotocol/typescript-sdk)). The 2026-07-28 spec keeps `readOnlyHint`, `destructiveHint` and `idempotentHint` on `ToolAnnotations` with unchanged meanings and defaults ([schema.ts](https://raw.githubusercontent.com/modelcontextprotocol/modelcontextprotocol/main/schema/2026-07-28/schema.ts), checked 2026-10-16), so [api-contract.md → Conventions](api-contract.md#conventions) stands. Annotations stay untrusted hints; the read API enforces scope.
- **Toolchain ([pp-general → imports-and-tsconfig](../.agents/skills/pp-general/references/imports-and-tsconfig.md)).** Node 24 strips a workspace package's `.ts` reached through pnpm's `node_modules` link: `apps/local/src/main.e2e.test.ts` boots `node apps/local/src/main.ts`, importing `@ledger/api` through the link, on Windows locally and Linux in CI. No `tsx`. Type-check is one root `tsc -p tsconfig.json` (≈0.7 s over 301 files on TypeScript 7.0.2), so the `tsc -b` + `noEmit` question is moot. "A relative path leaving the package" is not configured in Biome; review grep 10 carries it.
- **Biome `overrides` scoping ([pp-general → imports-and-tsconfig](../.agents/skills/pp-general/references/imports-and-tsconfig.md#lint-enforcement-biome)).** On Biome 2.5.15, a folder-scoped `noRestrictedImports` entry replaces the base ban list, not merges with it, so `biome.json` repeats each folder's full list. [import-boundaries.test.ts](../packages/core/src/import-boundaries.test.ts) pins it: in `packages/aws`, `@aws-sdk/client-sqs` raises nothing and a deep `@ledger/db/src/x.ts` import still raises the rule.
- **`openapi-typescript` under TypeScript 7.** `openapi-typescript` 7.13.0 fails under TypeScript 7.0.2 (`TypeError: Cannot read properties of undefined (reading 'createKeywordTypeNode')`): TypeScript 7's main export holds only `version` and `versionMajorMinor`, so `ts.factory` is absent. The owner-approved fallback `typescript` 5.9.3 sits in `packages/sdk` `devDependencies` only, where `openapi-typescript` resolves it as its peer; the root `tsc` pass stays on 7.0.2 (checked 2026-10-17 on a scratch OpenAPI 3.1 document).
- **Drizzle and `pg`, slice 1 ([pp-database → schema-and-repositories](../.agents/skills/pp-database/references/schema-and-repositories.md), [migrations-and-grants](../.agents/skills/pp-database/references/migrations-and-grants.md)).** drizzle-kit 0.31.11 writes `drizzle/` flat: `NNNN_<name>.sql` plus `meta/_journal.json` and one `meta/NNNN_snapshot.json` per migration. In drizzle-orm 0.45.4 `NodePgDatabase` and `PgTransaction` both extend `PgDatabase`, so `Executor` is that one type, no union ([executor.ts](../packages/db/src/executor.ts)). Pending migrations run in one transaction: `PgDialect.migrate` (`pg-core/dialect.js`) applies every pending migration and its `__drizzle_migrations` row inside one `session.transaction`, after creating the migrations table outside it. A changed `check()` regenerates as a same-name `DROP CONSTRAINT`, then `ADD CONSTRAINT … CHECK`; safe either way, because removing `bounced` from `email_state_status_check` failed [email-state.repository.int.test.ts](../packages/db/src/email-state.repository.int.test.ts), which inserts every member of the core tuple (checked 2026-10-17).
- **Vitest project `globalSetup` ([pp-testing → vitest-layout](../.agents/skills/pp-testing/references/vitest-layout.md#root-config)).** An inline project's own `globalSetup` runs: under Vitest 5.0.5, `pnpm test:int` runs the `int` project's [postgres-global-setup.ts](../packages/db/src/testing/postgres-global-setup.ts) once, and its `project.provide` values reach `inject` in the tests, so `int` needs no config file of its own (checked 2026-10-17).
- **drizzle-kit loading a schema that imports `@ledger/core` source.** drizzle-kit 0.31.11 loads `packages/db/src/schema/*.ts` through its bundled `tsx` register, `@ledger/core`'s `.ts` source included, so the `check()` lists are built from the core tuples and D18's literal-list fallback is unused (checked 2026-10-17 by `pnpm db:generate`).
- **MCP stdio entry.** The installed `@modelcontextprotocol/server` 2.3.1 ships both `serveStdio(factory)` and `StdioServerTransport` plus `connect()`; `apps/mcp/src/main.ts` uses `serveStdio` ([pp-mcp](../.agents/skills/pp-mcp/SKILL.md#stack-and-layout)).
- **Upstream contribution (§10.6).** Closed. Upstream PRs are not planned (owner, 2026-10-15; [decision lens](../AGENTS.md#decision-lens--evidence-over-claims-right-sized)).
