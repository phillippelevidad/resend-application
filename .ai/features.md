# Features

**Status (MUST).** Only [Adopter lifecycle](#adopter-lifecycle) binds. Journeys, capability
sections and [Ingester parity](#ingester-parity-reference-non-binding) are reference inventories
for scoping: a bullet there MUST NOT be read as a commitment. Commitments live in the lifecycle
table, an [ADR](architecture.md), or a [build-checklist](build-checklist.md) card.

**Pointer format.** Every stance and bullet ends in `evidence: <kind> · <slice>`. Evidence names a
unit, property or integration test, a simulator invariant
([idea §5.9](../docs/idea.md#59-the-chaos-and-simulation-harness)) or a cited doc page; until it
exists, the pointer names the kind and the slice that owes it. A slice is named by its
[build-checklist.md](build-checklist.md) card (e.g. `[slice 4](build-checklist.md#4--recovery)`),
which sits under its [milestone](about.md#milestones). Resend behavior is cited by its
[resend.md](resend.md) id (`RS-NN`, or `RS-UNN` while unverified), never paraphrased from memory.

## Adopter lifecycle

The stages a team adopting Ledger passes through, in order. The set is closed. Every row MUST carry
a stance; a stage where Ledger owes nothing says so. A stage that needs a human outside the adopter,
or an undocumented manual step, is a defect unless recorded here with its reason. This table is
what the [self-service test](about.md#guiding-principles) is argued against.

| Stage | What the adopter does | Stance (evidence · slice) |
| --- | --- | --- |
| **discover** | Reads the README; decides whether Ledger fits beside the Ingester | The README states the problem, the [positioning](about.md#positioning) against the Ingester (complement, same reconcile approach as its PR #13, no affiliation), and links every reliability claim to its evidence. Each milestone leaves the README claims coherent ([lens clause 3](../AGENTS.md#decision-lens--evidence-over-claims-right-sized)). evidence: link check in CI + 0 unlinked claims ([success metrics](about.md#success-metrics)) · [slice 0](build-checklist.md#0--foundations) |
| **deploy** | Runs one command against their own AWS account (CDK bootstrapped) | One stack, serverless, no always-on resources; the budget alarm with a hard monthly cap is created by the same deploy ([owner calibration](bootstrap-checklist.md#owner-calibration-ratified-2026-10-15)). The Postgres database is the one external prerequisite; its host is decided in [integrations.md](integrations.md#postgres-host). Whether an adopter's deploy ships the kill switch, and its default, is decided in [aws.md](aws.md#budget-alarms). Target: newcomer deploy ≤ 15 min. evidence: CDK assertion test on the synthesized template (no NAT gateway, no provisioned DB, budget present) · [slice 2](build-checklist.md#2--durable-ingest-on-aws); timed README walkthrough · [slice 7](build-checklist.md#7--polish-and-retention) |
| **connect webhook** | Creates a Resend webhook pointing at the deployed ingest URL; stores its signing secret | A documented one-time step per installation: the secret goes to Secrets Manager, never an env file or the repo. Not scripted while the endpoint URL is stable across redeploys of the same stack. Tripwire: if a redeploy changes the URL, the step recurs and MUST be scripted ([owner operations](about.md#platform-scale-assumptions)). evidence: deploy guide walked in the slice WALKTHROUGH · [slice 2](build-checklist.md#2--durable-ingest-on-aws) |
| **verify** | Confirms real events arrive and the state is right | The adopter sends **one** email from their own Resend account to `delivered@resend.dev`, a test address Resend documents ([RS-32](resend.md#facts); whether it is exempt from the `resend.dev` own-address rule is [RS-U14](resend.md#unverified)), then reads it with `ledger email <id>` (`sent` → `delivered`) and a health read (queue and DLQ at 0). The simulator never targets a stack holding an adopter's real data, and an adopter's stack never accepts a second, test signing secret: the simulator secret exists only behind an off-by-default deploy flag that the owner's deployment sets ([ADR-016](architecture.md#adr-016--the-simulator-reaches-aws-only-through-an-opt-in-simulator-secret)). Locally, real traffic arrives via `resend webhooks listen`, which creates a temporary webhook, so each session is Ask-first ([RS-33](resend.md#facts)). evidence: WALKTHROUGH of the deployed slice · [slice 2](build-checklist.md#2--durable-ingest-on-aws); unit test that ingest rejects a simulator-signed request when the simulator secret is absent · [slice 3](build-checklist.md#3--operations-and-evidence-on-aws) |
| **query** | Asks "what happened to email X / recipient Y?" | CLI `ledger email`, `ledger recipient` over the read API and SDK from M1: local in slice 1, deployed in slice 2, so the application developer's SDK/HTTP surface exists from M1 ([ADR-011](architecture.md#adr-011--one-contract-many-surfaces)). MCP read tools over the same contract ([api-contract.md](api-contract.md)) at M2. evidence: projection property tests · [slice 0](build-checklist.md#0--foundations); CLI output and SDK ↔ API contract tests, grown per slice · [slice 1](build-checklist.md#1--local-ledger-and-read-path); MCP tool, registration and redaction tests and the error-registry mirror test · [slice 5](build-checklist.md#5--mcp-server-and-contract-hardening) |
| **operate** | Watches health; handles poison messages | CloudWatch alarms → SNS → email, each alarm with a runbook entry. Poison messages isolated in a DLQ; inspect and redrive from the CLI, not a console click. Threshold alert emails through Resend arrive with reactions. evidence: integration test (poison isolated after N attempts, others unaffected) + simulator invariant 4 · [slice 3](build-checklist.md#3--operations-and-evidence-on-aws); `--chaos worker-crash` sends no duplicate alert · [slice 6](build-checklist.md#6--reactions) |
| **recover** | Closes gaps after an outage longer than Resend's retry schedule | Scheduled and on-demand `ledger reconcile`: ids diffed against List Events, missing ones replayed through normal ingest — the same approach as Ingester PR #13, not a new one. Rate-limit aware, leaving headroom in the shared team budget. A disabled webhook stops the run with `webhook_disabled` and a hint. Recoverable range is bounded by List Events reach and the retry window, both `[Unverified]` ([open questions](about.md#open-questions)). evidence: integration test against a fake Resend API (outage past the retry schedule → 100% recovered, 0 duplicates); disabled-webhook test; `retry-after` test · [slice 4](build-checklist.md#4--recovery) |
| **rotate secret** | Rotates the Resend signing secret without dropped deliveries | Resend signs with both the new and the previous secret for 24 h after a rotation ([RS-04](resend.md#facts); header format during the overlap: [RS-U09](resend.md#unverified)); ingest verifies against the configured secret set, so the adopter adds the new secret, rotates, and retires the old one inside that window. Documented in the runbook; the 24 h window bounds the manual step. evidence: unit test (old, new, both accepted during overlap) · [slice 1](build-checklist.md#1--local-ledger-and-read-path); unit test (retired secret → `401`) and runbook entry · [slice 4](build-checklist.md#4--recovery) |
| **extend** | Reacts to state changes in their own app | Two committed seams, both from [idea §5.6](../docs/idea.md#56-reactions-via-a-transactional-outbox) and [§5.3](../docs/idea.md#53-worker-and-the-event-ledger): a signed app callback delivered through the outbox; unknown and non-email event types stored raw, never fatal. Any other seam is deferred on a tripwire. evidence: unit test (unknown type stored raw, projection skipped, metric emitted) · [slice 1](build-checklist.md#1--local-ledger-and-read-path); simulator invariant 3 under `--chaos worker-crash` · [slice 6](build-checklist.md#6--reactions) |
| **tear down** | Removes everything | One command, **owner-triggered**, never automatic ([lens clause 7](../AGENTS.md#decision-lens--evidence-over-claims-right-sized)). The kill switch stops compute; it does not tear down. What the command leaves behind is listed in [aws.md → Teardown](aws.md#teardown). The guide tells the adopter to delete the Resend webhook too, or Resend retries a dead endpoint through its schedule and then auto-disables it ([RS-09, RS-11](resend.md#facts)). evidence: post-destroy listing of stack-tagged resources · [slice 2](build-checklist.md#2--durable-ingest-on-aws) |

## Journeys

Every surface named here resolves to an operation in [api-contract.md](api-contract.md), or is
listed there as not an operation ([Coverage](api-contract.md#coverage)).

### J1 — First deploy

- **Actor:** application developer adopting Ledger.
- **Trigger:** wants recipient deliverability without writing webhook plumbing.
- **Steps:** deploy → connect webhook → one test send to `delivered@resend.dev` → `ledger email <id>` shows `delivered`.
- **Surfaces:** deploy command; `email.get`; `health.get`.
- **Evidence:** timed README walkthrough ([success metrics](about.md#success-metrics)) · [slice 7](build-checklist.md#7--polish-and-retention).

### J2 — Support lookup

- **Actor:** support / on-call engineer.
- **Trigger:** "I never got the password-reset email."
- **Steps:** `ledger email <id>` → status, timeline, bounce detail → `ledger recipient <address>` → deliverability and the email that caused it.
- **Surfaces:** `email.get`, `recipient.get`.
- **Evidence:** CLI output contract tests · [slice 1](build-checklist.md#1--local-ledger-and-read-path); projection property tests · [slice 0](build-checklist.md#0--foundations).

### J3 — Outage → recovery

- **Actor:** operator.
- **Trigger:** ingest down longer than Resend's retry schedule.
- **Steps:** alarm fires → `ledger gaps --since 24h` → `ledger reconcile --dry-run` → `ledger reconcile` → `ledger gaps` shows zero missing.
- **Surfaces:** `gaps.list`, `reconcile.start`.
- **Evidence:** fake-API integration test, 100% recovered, 0 duplicates · [slice 4](build-checklist.md#4--recovery).

### J4 — Poison message → redrive

- **Actor:** operator.
- **Trigger:** DLQ depth alarm > 0.
- **Steps:** `ledger dlq inspect` → fix deployed → `ledger dlq redrive` → depth returns to 0.
- **Surfaces:** `dlq.listMessages` (`ledger dlq inspect`), `dlq.startRedrive` (`ledger dlq redrive`), `health.get`.
- **Evidence:** poison-isolation integration test + simulator invariant 4 · [slice 3](build-checklist.md#3--operations-and-evidence-on-aws).

### J5 — Secret rotation

- **Actor:** operator.
- **Trigger:** scheduled rotation or suspected leak.
- **Steps:** add the new secret to the configured set → rotate at Resend → confirm `ingest.rejected` stays flat → retire the old secret within 24 h.
- **Surfaces:** runbook; `ingest.rejected{reason}` metric.
- **Evidence:** multi-secret unit test (old, new, both) · [slice 1](build-checklist.md#1--local-ledger-and-read-path); retired-secret → `401` unit test and runbook entry · [slice 4](build-checklist.md#4--recovery).

### J6 — Agent explanation via MCP

- **Actor:** AI agent acting for support.
- **Trigger:** "Did delivered@resend.dev get the confirm email? Why not?"
- **Steps:** MCP read tools fetch state and timeline → deterministic explanation with a next step, no hidden LLM call.
- **Surfaces:** MCP `get_email_status` (`email.get`), `explain_delivery` (`email.explainDelivery`); operate tools unregistered without the `operate` scope, decided at startup through `token.getCurrent`.
- **Evidence:** MCP tool tests; test that operate tools are absent under a read token; redaction test on tool output · [slice 5](build-checklist.md#5--mcp-server-and-contract-hardening).

### J7 — Burst

- **Actor:** application developer, indirectly (a broadcast).
- **Trigger:** thousands of webhooks in seconds, up to the [ceiling](about.md#platform-scale-assumptions) of 10,000 in 10 s.
- **Steps:** ingest keeps returning `200` → queue depth rises → worker drains at the bounded rate.
- **Surfaces:** `pnpm sim --burst 10000/10s` (owner demo, [ADR-016](architecture.md#adr-016--the-simulator-reaches-aws-only-through-an-opt-in-simulator-secret)); `health.get`.
- **Evidence:** simulator invariants after burst · [slice 3](build-checklist.md#3--operations-and-evidence-on-aws); published p50/p99 ingest latency and drain time in `docs/results.md` · [slice 9](build-checklist.md#9--real-aws-burst-numbers).

## Ingest

- Signature and timestamp verified on the raw body before enqueue; bad signature → `401`. evidence: unit test · [slice 1](build-checklist.md#1--local-ledger-and-read-path).
- `200` on enqueue, `503` on enqueue failure so Resend retries ([RS-10](resend.md#facts)). evidence: unit test · [slice 2](build-checklist.md#2--durable-ingest-on-aws).
- No database in the request path: a database outage is not a failed delivery. evidence: `--chaos db-outage` keeps ingest at `200` with 0 lost · [slice 3](build-checklist.md#3--operations-and-evidence-on-aws).

## Ledger & projections

- One row per `svix_id`, ever; duplicates counted, never re-applied. evidence: property test + simulator invariant 1 · [slice 1](build-checklist.md#1--local-ledger-and-read-path).
- `projectEmail` is a pure function of the event set: permutation invariance, idempotence, monotonicity, oracle agreement. evidence: fast-check properties · [slice 0](build-checklist.md#0--foundations).
- Recipient deliverability derived from email states, with the email that caused each transition. evidence: property test · [slice 1](build-checklist.md#1--local-ledger-and-read-path).
- Unknown event types stored raw, projection skipped, metric emitted. evidence: unit test · [slice 1](build-checklist.md#1--local-ledger-and-read-path).

## Recovery

- Gap detection by id diff against List Events; replays re-enter through ingest. evidence: fake-API integration test · [slice 4](build-checklist.md#4--recovery).
- Rate-limit aware against the shared team budget ([RS-19, RS-20](resend.md#facts)). evidence: fake-API test with `retry-after` · [slice 4](build-checklist.md#4--recovery).
- A disabled webhook stops the run with `webhook_disabled` ([RS-11](resend.md#facts), [RS-U04](resend.md#unverified)). evidence: integration test · [slice 4](build-checklist.md#4--recovery).

## Reactions

- Outbox entry in the same transaction as the event. evidence: simulator invariant 3 · [slice 6](build-checklist.md#6--reactions).
- Signed app callback; operational alert email through Resend with idempotency keys derived from the `dedupe_key` ([RS-24](resend.md#facts); keys expire after 24 h, so retries stop before that, [Constraint 8](resend.md#constraints-and-sharp-edges)). evidence: `--chaos worker-crash` yields no duplicate dispatch · [slice 6](build-checklist.md#6--reactions).

## Interfaces

- One contract, four surfaces: read API, SDK, CLI, MCP ([api-contract.md](api-contract.md)). evidence: contract tests, starting in [slice 1](build-checklist.md#1--local-ledger-and-read-path) and grown per slice; MCP surface · [slice 5](build-checklist.md#5--mcp-server-and-contract-hardening).
- One error shape everywhere ([error shape](../AGENTS.md#error-shape)). evidence: registry-mirror test · [slice 5](build-checklist.md#5--mcp-server-and-contract-hardening).
- MCP read-only by default; no secrets and masks only in tool output ([api-contract.md → Conventions](api-contract.md#conventions)). evidence: tool-registration and redaction tests · [slice 5](build-checklist.md#5--mcp-server-and-contract-hardening).
- SDK and CLI published to npm with semver. evidence: published package versions · [slice 8](build-checklist.md#8--npm-release).

## Operations

- Structured JSON logs carrying `svix_id`, `email_id`, `type`; EMF metrics; one runbook entry per alarm. evidence: alarm-to-runbook link check · [slice 3](build-checklist.md#3--operations-and-evidence-on-aws).
- Budget alarm with a hard monthly cap from the first deploy; idle cost near zero ([success metrics](about.md#success-metrics)). evidence: CDK assertion test + recorded kill-switch trip drill ([aws.md](aws.md#budget-alarms)) · [slice 2](build-checklist.md#2--durable-ingest-on-aws).

## Evidence harness

- `pnpm sim` ([ADR-016](architecture.md#adr-016--the-simulator-reaches-aws-only-through-an-opt-in-simulator-secret)) with duplicate, shuffle, burst and chaos knobs; four invariants checked after every run. evidence: the run output itself · [slice 1](build-checklist.md#1--local-ledger-and-read-path) (duplicates, shuffle), [slice 3](build-checklist.md#3--operations-and-evidence-on-aws) (burst, chaos).
- Real-AWS burst numbers published in `docs/results.md`. evidence: the results doc · [slice 9](build-checklist.md#9--real-aws-burst-numbers).

## Ingester parity (reference, non-binding)

Against Resend's [Webhook Ingester](https://resend.com/docs/webhooks/ingester), re-verified
2026-10-15 at `main` @ [`41dda70`](https://github.com/resend/resend-webhooks-ingester/commit/41dda701f98138490528935689baae6edafc3524)
(committed 2026-05-27), plus open [PR #13](https://github.com/resend/resend-webhooks-ingester/pull/13)
(last updated 2026-09-25, no reviews). Ledger's column states intent; each cell's evidence is in the
sections above.

| Capability | Ingester | Ledger |
| --- | --- | --- |
| Signature verification | Yes — `svix` `Webhook.verify` (`src/lib/verify-webhook.ts`) | Yes |
| Several signing secrets during rotation | No — one `RESEND_WEBHOOK_SECRET` | Yes |
| Idempotent raw storage | Yes — unique `svix_id`; ClickHouse collapses duplicates only on background merge | Yes — Postgres `svix_id` primary key |
| Recover missed events | No on `main`; open PR #13 (Postgres-only `/reconcile`: List Events diff + replay) | Yes — the same approach, replays land in the queue path |
| Database connectors | 9 endpoints, 10 listed databases (README) | Postgres only ([non-goal](about.md#non-goals--out-of-scope)) |
| Ingest decoupled from storage | No — writes in the request; a failed write returns `500` | Yes — queue buffer |
| Backpressure under spikes | No | Yes — bounded worker concurrency |
| Current per-email state, order-independent | No — append-only rows; status computed at read time | Yes |
| Per-recipient deliverability state | No | Yes |
| Safe side effects (outbox) | No | Yes |
| Poison isolation (DLQ + redrive) | No | Yes |
| Unknown event types | Routed by type prefix; an unknown prefix returns `400` | Stored raw, never fatal |
| CLI / SDK / MCP | No — only `POST /{connector}` | Yes |
| Deploy targets | Vercel, Railway, Render, Docker image | AWS via CDK |
