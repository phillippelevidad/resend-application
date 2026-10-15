# Features

**Status (MUST).** Only [Adopter lifecycle](#adopter-lifecycle) binds. Journeys, capability
sections and [Ingester parity](#ingester-parity-reference-non-binding) are reference inventories
for scoping: a bullet there MUST NOT be read as a commitment. Commitments live in the lifecycle
table, an [ADR](architecture.md), or a [build-checklist](build-checklist.md) card.

**Pointer format.** Every stance and bullet ends in `evidence: <kind> · <slice>`. Evidence names a
unit, property or integration test, a simulator invariant
([idea §5.9](../docs/idea.md#59-the-chaos-and-simulation-harness)) or a cited doc page; until it
exists, the pointer names the kind and the slice that owes it. A slice is named by its
[idea §7](../docs/idea.md#7-implementation-plan) phase and [milestone](about.md#milestones)
(e.g. *recovery · M1*); [architecture.md](architecture.md) assigns the final IDs and
[build-checklist.md](build-checklist.md) the card anchors that replace these names. Resend behavior
is cited by its [resend.md](resend.md) id (`RS-NN`, or `RS-UNN` while unverified), never
paraphrased from memory.

## Adopter lifecycle

The stages a team adopting Ledger passes through, in order. The set is closed. Every row MUST carry
a stance; a stage where Ledger owes nothing says so. A stage that needs a human outside the adopter,
or an undocumented manual step, is a defect unless recorded here with its reason. This table is
what the [self-service test](about.md#guiding-principles) is argued against.

| Stage | What the adopter does | Stance (evidence · slice) |
| --- | --- | --- |
| **discover** | Reads the README; decides whether Ledger fits beside the Ingester | The README states the problem, the [positioning](about.md#positioning) against the Ingester (complement, same reconcile approach as its PR #13, no affiliation), and links every reliability claim to its evidence. Each milestone leaves the README claims coherent ([lens clause 3](../AGENTS.md#decision-lens--evidence-over-claims-right-sized)). evidence: link check in CI + 0 unlinked claims ([success metrics](about.md#success-metrics)) · foundations · M1 |
| **deploy** | Runs one command against their own AWS account (CDK bootstrapped) | One stack, serverless, no always-on resources; the budget alarm with a hard monthly cap is created by the same deploy ([owner calibration](bootstrap-checklist.md#owner-calibration-ratified-2026-10-15)). The Postgres database is the one external prerequisite; its host is decided in [integrations.md](integrations.md#postgres-host). Whether an adopter's deploy ships the kill switch, and its default, is decided in [aws.md](aws.md#budget-alarms). Target: newcomer deploy ≤ 15 min. evidence: CDK assertion test on the synthesized template (no NAT gateway, no provisioned DB, budget present) · durable ingest · M1; timed README walkthrough · polish · M2 |
| **connect webhook** | Creates a Resend webhook pointing at the deployed ingest URL; stores its signing secret | A documented one-time step per installation: the secret goes to Secrets Manager, never an env file or the repo. Not scripted while the endpoint URL is stable across redeploys of the same stack. Tripwire: if a redeploy changes the URL, the step recurs and MUST be scripted ([owner operations](about.md#platform-scale-assumptions)). evidence: deploy guide walked in the slice WALKTHROUGH · durable ingest · M1 |
| **verify** | Confirms real events arrive and the state is right | The adopter sends **one** email from their own Resend account to `delivered@resend.dev`, a test address Resend documents ([RS-32](resend.md#facts); whether it is exempt from the `resend.dev` own-address rule is [RS-U14](resend.md#unverified)), then reads it with `ledger email <id>` (`sent` → `delivered`) and a health read (queue and DLQ at 0). The simulator never targets a stack holding an adopter's real data, and an adopter's stack never accepts a second, test signing secret: how the owner's demo runs the simulator against AWS is decided in [architecture.md](architecture.md). Locally, real traffic arrives via `resend webhooks listen`, which creates a temporary webhook, so each session is Ask-first ([RS-33](resend.md#facts)). evidence: WALKTHROUGH of the deployed slice; unit test that ingest accepts only the configured Resend secrets · durable ingest · M1 |
| **query** | Asks "what happened to email X / recipient Y?" | CLI `ledger email`, `ledger recipient` from M1 (read path decided in [architecture.md](architecture.md), see [open questions](about.md#open-questions)). Read API, SDK and MCP read tools over one contract ([api-contract.md](api-contract.md)) at M2; the application developer's SDK/HTTP surface is the gap that slice carries. evidence: projection property tests · foundations · M1; CLI output contract tests · local v0 · M1; contract tests per surface · interfaces · M2 |
| **operate** | Watches health; handles poison messages | CloudWatch alarms → SNS → email, each alarm with a runbook entry. Poison messages isolated in a DLQ; inspect and redrive from the CLI, not a console click. Threshold alert emails through Resend arrive with reactions. evidence: integration test (poison isolated after N attempts, others unaffected) + simulator invariant 4 · durable ingest · M1; `--chaos worker-crash` sends no duplicate alert · reactions · M2 |
| **recover** | Closes gaps after an outage longer than Resend's retry schedule | Scheduled and on-demand `ledger reconcile`: ids diffed against List Events, missing ones replayed through normal ingest — the same approach as Ingester PR #13, not a new one. Rate-limit aware, leaving headroom in the shared team budget. A disabled webhook stops the run with `webhook_disabled` and a hint. Recoverable range is bounded by List Events reach and the retry window, both `[Unverified]` ([open questions](about.md#open-questions)). evidence: integration test against a fake Resend API (outage past the retry schedule → 100% recovered, 0 duplicates); disabled-webhook test; `retry-after` test · recovery · M1 |
| **rotate secret** | Rotates the Resend signing secret without dropped deliveries | Resend signs with both the new and the previous secret for 24 h after a rotation ([RS-04](resend.md#facts); header format during the overlap: [RS-U09](resend.md#unverified)); ingest verifies against the configured secret set, so the adopter adds the new secret, rotates, and retires the old one inside that window. Documented in the runbook; the 24 h window bounds the manual step. evidence: unit test (old, new, both accepted during overlap; retired secret → `401`) · recovery · M1 |
| **extend** | Reacts to state changes in their own app | Two committed seams, both from [idea §5.6](../docs/idea.md#56-reactions-via-a-transactional-outbox) and [§5.3](../docs/idea.md#53-worker-and-the-event-ledger): a signed app callback delivered through the outbox; unknown and non-email event types stored raw, never fatal. Any other seam is deferred on a tripwire. evidence: unit test (unknown type stored raw, projection skipped, metric emitted) · local v0 · M1; simulator invariant 3 under `--chaos worker-crash` · reactions · M2 |
| **tear down** | Removes everything | One command, **owner-triggered**, never automatic ([lens clause 7](../AGENTS.md#decision-lens--evidence-over-claims-right-sized)). The kill switch stops compute; it does not tear down. What the command leaves behind is listed in [check-before-launch.md](check-before-launch.md#cost--teardown). The guide tells the adopter to delete the Resend webhook too, or Resend retries a dead endpoint through its schedule and then auto-disables it ([RS-09, RS-11](resend.md#facts)). evidence: post-destroy listing of stack-tagged resources · durable ingest · M1 |

## Journeys

Operation names are provisional until [api-contract.md](api-contract.md) lists every surface named
here.

### J1 — First deploy

- **Actor:** application developer adopting Ledger.
- **Trigger:** wants recipient deliverability without writing webhook plumbing.
- **Steps:** deploy → connect webhook → one test send to `delivered@resend.dev` → `ledger email <id>` shows `delivered`.
- **Surfaces:** deploy command; `email.get`; health read.
- **Evidence:** timed README walkthrough ([success metrics](about.md#success-metrics)) · polish · M2.

### J2 — Support lookup

- **Actor:** support / on-call engineer.
- **Trigger:** "I never got the password-reset email."
- **Steps:** `ledger email <id>` → status, timeline, bounce detail → `ledger recipient <address>` → deliverability and the email that caused it.
- **Surfaces:** `email.get`, `recipient.get`.
- **Evidence:** CLI output contract tests · local v0 · M1; projection property tests · foundations · M1.

### J3 — Outage → recovery

- **Actor:** operator.
- **Trigger:** ingest down longer than Resend's retry schedule.
- **Steps:** alarm fires → `ledger gaps --since 24h` → `ledger reconcile --dry-run` → `ledger reconcile` → `ledger gaps` shows zero missing.
- **Surfaces:** `gaps.list`, `reconcile.start`.
- **Evidence:** fake-API integration test, 100% recovered, 0 duplicates · recovery · M1.

### J4 — Poison message → redrive

- **Actor:** operator.
- **Trigger:** DLQ depth alarm > 0.
- **Steps:** `ledger dlq inspect` → fix deployed → `ledger dlq redrive` → depth returns to 0.
- **Surfaces:** DLQ inspect and redrive operations.
- **Evidence:** poison-isolation integration test + simulator invariant 4 · durable ingest · M1.

### J5 — Secret rotation

- **Actor:** operator.
- **Trigger:** scheduled rotation or suspected leak.
- **Steps:** add the new secret to the configured set → rotate at Resend → confirm `ingest.rejected` stays flat → retire the old secret within 24 h.
- **Surfaces:** runbook; `ingest.rejected{reason}` metric.
- **Evidence:** multi-secret unit test · recovery · M1.

### J6 — Agent explanation via MCP

- **Actor:** AI agent acting for support.
- **Trigger:** "Did delivered@resend.dev get the confirm email? Why not?"
- **Steps:** MCP read tools fetch state and timeline → deterministic explanation with a next step, no hidden LLM call.
- **Surfaces:** MCP `get_email_status`, `explain_delivery`; operate tools unregistered without the `operate` scope.
- **Evidence:** MCP tool tests; test that operate tools are absent under a read token; redaction test on tool output · interfaces · M2.

### J7 — Burst

- **Actor:** application developer, indirectly (a broadcast).
- **Trigger:** thousands of webhooks in seconds, up to the [ceiling](about.md#platform-scale-assumptions) of 10,000 in 10 s.
- **Steps:** ingest keeps returning `200` → queue depth rises → worker drains at the bounded rate.
- **Surfaces:** `ledger simulate --burst 10000/10s` (owner demo); health read.
- **Evidence:** simulator invariants after burst · durable ingest · M1; published p50/p99 ingest latency and drain time in `docs/results.md` · M3.

## Ingest

- Signature and timestamp verified on the raw body before enqueue; bad signature → `401`. evidence: unit test · local v0 · M1.
- `200` on enqueue, `503` on enqueue failure so Resend retries ([RS-10](resend.md#facts)). evidence: unit test · durable ingest · M1.
- No database in the request path: a database outage is not a failed delivery. evidence: `--chaos db-outage` keeps ingest at `200` with 0 lost · durable ingest · M1.

## Ledger & projections

- One row per `svix_id`, ever; duplicates counted, never re-applied. evidence: property test + simulator invariant 1 · local v0 · M1.
- `projectEmail` is a pure function of the event set: permutation invariance, idempotence, monotonicity, oracle agreement. evidence: fast-check properties · foundations · M1.
- Recipient deliverability derived from email states, with the email that caused each transition. evidence: property test · local v0 · M1.
- Unknown event types stored raw, projection skipped, metric emitted. evidence: unit test · local v0 · M1.

## Recovery

- Gap detection by id diff against List Events; replays re-enter through ingest. evidence: fake-API integration test · recovery · M1.
- Rate-limit aware against the shared team budget ([RS-19, RS-20](resend.md#facts)). evidence: fake-API test with `retry-after` · recovery · M1.
- A disabled webhook stops the run with `webhook_disabled` ([RS-11](resend.md#facts), [RS-U04](resend.md#unverified)). evidence: integration test · recovery · M1.

## Reactions

- Outbox entry in the same transaction as the event. evidence: simulator invariant 3 · reactions · M2.
- Signed app callback; operational alert email through Resend with idempotency keys derived from the `dedupe_key` ([RS-24](resend.md#facts); keys expire after 24 h, so retries stop before that, [Constraint 8](resend.md#constraints-and-sharp-edges)). evidence: `--chaos worker-crash` yields no duplicate dispatch · reactions · M2.

## Interfaces

- One contract, four surfaces: read API, SDK, CLI, MCP ([api-contract.md](api-contract.md)). evidence: contract tests · interfaces · M2.
- One error shape everywhere ([error shape](../AGENTS.md#error-shape)). evidence: registry-mirror test · interfaces · M2.
- MCP read-only by default; no secrets and optional redaction in tool output. evidence: tool-registration and redaction tests · interfaces · M2.
- SDK and CLI published to npm with semver. evidence: published package versions · M3.

## Operations

- Structured JSON logs carrying `svix_id`, `email_id`, `type`; EMF metrics; one runbook entry per alarm. evidence: alarm-to-runbook link check · durable ingest · M1.
- Budget alarm with a hard monthly cap from the first deploy; idle cost near zero ([success metrics](about.md#success-metrics)). evidence: CDK assertion test + recorded kill-switch trip drill ([aws.md](aws.md#budget-alarms)) · durable ingest · M1.

## Evidence harness

- `ledger simulate` with duplicate, shuffle, burst and chaos knobs; four invariants checked after every run. evidence: the run output itself · local v0 · M1 (duplicates, shuffle), durable ingest · M1 (burst, chaos).
- Real-AWS burst numbers published in `docs/results.md`. evidence: the results doc · M3.

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
