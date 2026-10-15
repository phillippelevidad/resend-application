# Integrations

> **TEMPLATE — not ratified.** Bootstrap step 6 in [bootstrap-checklist.md](bootstrap-checklist.md). The preview content below is illustrative, drafted from [docs/idea.md](../docs/idea.md) without research. Nothing here is binding until this banner and the instructions comment are removed.

<!-- AGENT INSTRUCTIONS
Purpose: Two things. Part 1 — the discipline for every call Ledger makes to Resend, and Ledger's
  relationship to Resend's Webhook Ingester. Part 2 — the Postgres host decision, with the
  comparison that justifies it. Keep it slim: Ledger has one vendor and one database; no generic
  integration framework, no multi-axis classifier.
Consumers: `packages/resend-client`, `packages/db`, `infra/`, architecture.md (ADRs cite the
  Postgres decision), check-before-launch.md, features.md (Ingester parity).
Inputs (read first): root AGENTS.md (decision lens: complement don't duplicate, cost brake; Module
  boundaries; Permissions); resend.md (step 4, `RS-NN`); aws.md (step 5, `AWS-NN`, Cost shape);
  bootstrap-checklist.md → Owner calibration (deploy and keep → idle cost dominates);
  docs/idea.md §2.2, §5.5, §5.8, §6.1, §9.
Research:
  - Webhook Ingester: https://github.com/resend/resend-webhooks-ingester (README, open issues and
    PRs, esp. #8, #12, #13) and https://resend.com/docs/webhooks/ingester.md. Re-check its license
    status on the day of writing and record the date. Read for behavior only; never copy code.
  - Postgres hosts, from each vendor's own docs and pricing page: idle cost, scale-to-zero and
    resume latency, free-tier limits and inactivity pausing, connectivity from Lambda without a
    VPC/NAT (public TLS endpoint, HTTP/WebSocket drivers, AWS RDS Data API), connection limits and
    pooling, support for interactive transactions with `SELECT … FOR UPDATE` (the worker needs
    them, idea §5.3), Drizzle driver support (orm.drizzle.team connect pages), teardown behavior.
  - Cross-check every AWS cost claim against aws.md; add missing facts there as `AWS-NN`, not here.
Required structure (headings MUST exist): `## Part 1 — Resend discipline` with
  `### Locked rules (MUST)` and `### Relationship to the Webhook Ingester`;
  `## Postgres host` (exact heading text: its anchor `#postgres-host` is cited by aws.md) with
  `### Requirements`, `### Comparison`, `### Decision — <host>` (Why it wins / What the loser wins /
  Fallback + trigger); `## Open decisions`.
Evidence rules: every comparison cell cites a vendor page + date, or reads `[Unverified]`; every
  Resend behavior cites an `RS-NN`; every AWS behavior an `AWS-NN`. Unsettled → about.md#open-questions.
  A choice outside Resend's public stack needs one line of reasoning (decision lens).
Owner decisions to surface (one batched round, each with a recommended pick):
  - The Postgres host (recommendation REQUIRED, with fallback and switch trigger).
  - Whether a third-party (non-AWS) database account is acceptable for a public AWS demo.
Done when: Part 1 rules each cite their source rule or fact; the comparison has no [Preview]
  cell; the Decision is ratified by the owner or marked `[!]` in the checklist; banner and comment
  removed.
-->

## Part 1 — Resend discipline

### Locked rules (MUST)

1. **One caller.** Every call to Resend's API goes through `packages/resend-client`
   ([module boundaries](../AGENTS.md#module-boundaries)). No other package imports the `resend`
   SDK for API calls. Signature verification in `apps/ingest` is local crypto, not an API call.
2. **One budget.** The client owns a single limiter below the per-team limit (`RS-06`
   `[Preview]`), honors `ratelimit-*` and `retry-after`, and leaves headroom for the team's
   sending traffic. Reconciler, dispatcher and CLI share it.
3. **Writes are Ask-first against a live account**: replay, rotate secret, create or update a
   webhook, send email ([Permissions](../AGENTS.md#permissions)). Tests use a fake Resend API.
4. **Verify, don't assume.** A Resend behavior is used in code only once it is an `RS-NN` fact in
   [resend.md](resend.md); otherwise it is an `[Unverified]` row and the code tolerates both
   outcomes.
5. **Test fixtures use Resend's test addresses** (`delivered@resend.dev`, `bounced@resend.dev`).
   Never a real recipient.
6. `[Preview]` **Idempotent writes.** Every send carries an idempotency key derived from the outbox
   `dedupe_key` (`RS-07`). Replays rely on ledger dedup, not on Resend.

### Relationship to the Webhook Ingester

Resend's [Webhook Ingester](https://github.com/resend/resend-webhooks-ingester) verifies and stores
raw events in many databases. Ledger **complements** it (idea §2.2): queue-buffered ingest,
order-independent state, outbox reactions, DLQ, operator and agent interfaces.

- Ledger MUST NOT rebuild what the Ingester already does well for its own sake (multi-database
  connectors, warehouse loading). Parity detail lives in [features.md](features.md).
- **The Ingester had no license file as of 2026-10-15.** Without a license, its code MUST NOT be
  copied, vendored or adapted into Ledger. Read it for behavior; write Ledger's own code. Re-check
  the license before citing this rule as current.
- `[Preview]` Where both converge (PR #13's reconcile-by-id approach), Ledger cites the PR as prior
  art in the ADR that adopts the approach.
- Upstream PRs are not planned (Owner calibration). The order-independent projection stays
  reusable in `packages/core` in case that changes.

## Postgres host

Part 2. Where Ledger's ledger, projections and outbox live.

### Requirements

Derived from the tie-break order (correctness > evidence > cost > scope > polish):

- **R1 Correctness:** interactive transactions with row locks (`SELECT … FOR UPDATE`) from the
  worker Lambda (idea §5.3).
- **R2 Idle cost:** near zero while the stack is kept up for an unknown review window.
- **R3 No NAT:** reachable from Lambda without a NAT gateway (`AWS-13`), while the reconciler
  still reaches Resend's API.
- **R4 Connections:** survives worker bursts within the ESM max-concurrency cap (pooling).
- **R5 Drizzle:** a supported driver.
- **R6 Teardown:** one documented step, nothing left billing.

### Comparison

`[Preview]` Every cell to be replaced by a cited value.

| Host | Idle cost | Scale to zero / resume | Lambda without NAT | Interactive tx + `FOR UPDATE` | Connection limits / pooling | Drizzle | Teardown |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **Neon** (serverless) | Free tier `[Preview]` | Yes; auto-suspend, cold resume `[Preview]` | Yes — public TLS endpoint, no VPC | WebSocket `Pool` yes; HTTP driver batches only `[Preview]` | Built-in pooler `[Preview]` | `neon-serverless`, `neon-http` | Delete project |
| **Aurora Serverless v2** | Min ACU or auto-pause `[Preview]` | Pause to 0 ACU `[Preview]` | Via RDS Data API without VPC `[Preview]`; else VPC → NAT for reconciler | Data API transactions `[Preview]` | Data API sidesteps pooling | `aws-data-api/pg` | Snapshot on delete unless skipped |
| **RDS + RDS Proxy** | Instance + Proxy hourly | No | VPC required → NAT for reconciler | Yes | Proxy | `node-postgres` | Snapshot on delete unless skipped |
| **Supabase** (free tier) | Free `[Preview]` | Pauses after inactivity `[Preview]` — conflicts with deploy-and-keep | Yes — public endpoint | Yes (direct or session pooler) `[Preview]` | Supavisor `[Preview]` | `postgres-js` | Delete project |

### Decision — `<pending>`

`[Preview]` Shape the ratified decision MUST take:

- **Why it wins:** which requirements it meets that the others don't, with the cited cells.
- **What the loser wins:** what the runner-up would have given (e.g. Aurora: everything inside
  AWS, one bill, IAM auth), stated honestly.
- **Fallback + trigger:** the runner-up, and the measurable event that would switch to it (e.g.
  free-tier limit hit, cold-resume latency breaking an SLO the simulator measures).
- **Deviation note:** if the host is outside AWS, one line of reasoning (decision lens).

## Open decisions

| Decision | Owner input needed | Recommended pick |
| --- | --- | --- |
| Postgres host | Yes | `[Preview]` Decided in step 6 research |
| Accept a non-AWS DB account for the demo | Yes | `[Preview]` — |
| Driver for the worker transaction (WebSocket pool vs Data API vs TCP) | No — follows the host | — |
