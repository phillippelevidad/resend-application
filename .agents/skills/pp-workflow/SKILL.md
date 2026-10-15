---
name: pp-workflow
description: Ledger's working conventions in one checklist — read order, slice scoping, the `pnpm verify` gate, the doc duties every change owes, test tiers, Ask-first, naming and module boundaries. A stub that points at the canonical rule instead of restating it. Load it alongside every `wf-*` gate, and before scoping, proposing, building or reviewing any slice of the build checklist. It owns no rule of its own; when it and a linked doc disagree, the doc wins and this file is fixed.
---

# pp-workflow — how a Ledger change is scoped, built and closed

**Stub.** Every entry links the rule that binds it. This file adds no rule. When it and a linked
doc disagree, the doc wins: fix this file in the same change.

## Read order

[`.ai/AGENTS.md`](../../../.ai/AGENTS.md) → [about.md](../../../.ai/about.md) →
[architecture.md → Build order](../../../.ai/architecture.md#build-order-vertical-slices) → the slice
card in [build-checklist.md](../../../.ai/build-checklist.md#how-to-work-this-checklist) → its `Refs`
→ the pre-proposal in `.ai/pre-proposals/`, if one exists. Load each `.ai/` doc the index marks
Required for the task.

## Slice scoping

- The card's `Ships` list is the done-list, and every bullet names its evidence
  ([build-checklist → How to work this checklist](../../../.ai/build-checklist.md#how-to-work-this-checklist)).
- v0 per slice, smallest PR; right-size to the ceiling; the self-service test runs at scoping time
  ([decision lens](../../../AGENTS.md#decision-lens--evidence-over-claims-right-sized),
  [about.md → Guiding principles](../../../.ai/about.md#guiding-principles)).
- Tie-break: correctness of event handling (no loss, no duplicate effects, order-independent
  state) > evidence > cost > scope > polish ([lens](../../../AGENTS.md#decision-lens--evidence-over-claims-right-sized)).

## Definition of done

A change is done when `pnpm verify` exits 0 (every stage ran and passed, mirroring CI) and every
duty below that the change triggers is discharged in the same diff.

| If the change… | It must also contain |
| --- | --- |
| Adds or changes an operation, route, error code, CLI command or flag, or MCP tool | The [api-contract.md](../../../.ai/api-contract.md) entry, and the owner's Ask-first approval ([Conventions](../../../.ai/api-contract.md#conventions)) |
| Lands a table in the schema and a migration | The ticked `Modeled` box in [data-modeling.md → Model index](../../../.ai/data-modeling.md#model-index) |
| Adds, removes or repurposes a project folder | The [root AGENTS.md → Projects](../../../AGENTS.md#projects) table |
| Completes or advances a slice | The card's `Status` line and `Ships` boxes, updated in place ([Legend](../../../.ai/build-checklist.md#legend)) |
| Ships a slice | `WALKTHROUGH.md` in the change folder before `Status` is ticked ([build-checklist](../../../.ai/build-checklist.md#how-to-work-this-checklist)) |
| Ratifies or contradicts a decision | The `.ai/` doc corrected, or an ADR added or superseded, in the same change ([root AGENTS.md → Product & domain context](../../../AGENTS.md#product--domain-context)) |
| Leaves a question unresolved | An [about.md → Open questions](../../../.ai/about.md#open-questions) entry tagged `[Unverified]`, and the card marked `[!]` with a one-line reason |
| Settles an `RS-UNN`, `AWS-UNN` or `PG-UNN` row | That row updated in [resend.md](../../../.ai/resend.md#unverified), [aws.md](../../../.ai/aws.md#unverified) or [integrations.md](../../../.ai/integrations.md#unverified) |
| Relies on a Resend behavior | The `RS-NN` fact it rests on, cited ([resend.md](../../../.ai/resend.md)) |
| Introduces an environment variable | `.env.example`, and a boot-time assertion if it is required |
| Touches a mandatory-tier surface | An integration test against real Postgres ([Test tiers](#test-tiers)) |

## Test tiers

- **Unit and property tests** (Vitest, fast-check) for everything in `packages/core`: projections,
  masks, reaction rules. No I/O ([ADR-003](../../../.ai/architecture.md#adr-003--projection-is-a-pure-function-of-the-event-set),
  [ADR-013](../../../.ai/architecture.md#adr-013--pure-core-and-local-mode)).
- **Integration tests against real Postgres** (Testcontainers) are mandatory for idempotency on
  `svix_id` and the outbox `dedupe_key`, order-independent projections, outbox delivery, reconcile
  and replay, DLQ redrive, migrations, and auth boundaries (token scopes)
  ([ADR-004](../../../.ai/architecture.md#adr-004--immutable-ledger-keyed-on-svix_id-one-transaction-per-message),
  [ADR-006](../../../.ai/architecture.md#adr-006--transactional-outbox-for-reactions),
  [ADR-007](../../../.ai/architecture.md#adr-007--recovery-by-id-diff-and-replay-through-ingest)).
- **Simulator invariants** for behavior under duplicates, reordering, bursts and outages
  ([architecture.md → Simulator invariants](../../../.ai/architecture.md#simulator-invariants)).

## Always

- Verify Resend behavior against its docs and cite the page; what the docs don't settle goes to
  Open questions as `[Unverified]` ([lens](../../../AGENTS.md#decision-lens--evidence-over-claims-right-sized)).
- Follow the [module boundaries](../../../AGENTS.md#module-boundaries) and the
  [one error shape](../../../AGENTS.md#error-shape).
- Commit and push each finished step ([root AGENTS.md](../../../AGENTS.md#commit-and-push-as-you-go)).
- Name things in the [domain vocabulary](../../../.ai/about.md#domain-vocabulary).

## Never

- A reliability claim without its evidence. Instead: link the test, property or invariant, or move
  the claim to Open questions ([lens](../../../AGENTS.md#decision-lens--evidence-over-claims-right-sized)).
- An Ask-first change made alone: a dependency, a pushed migration, CI, a public contract, an AWS
  resource or deploy, or a write to a live Resend account. Instead: leave it uncommitted and ask
  ([Permissions](../../../AGENTS.md#permissions)).
- A failing gate disabled to make CI green. Instead: fix the cause ([Permissions](../../../AGENTS.md#permissions)).
- A secret, API key, signing secret or real recipient address in a commit. Instead: use Resend's
  test addresses (`delivered@resend.dev`) ([Permissions](../../../AGENTS.md#permissions)).
- Re-litigating an accepted ADR. Instead: write a superseding ADR ([architecture.md → Decisions](../../../.ai/architecture.md#decisions)).
- A categorical deferral built quietly (SQS FIFO, a second database, multi-tenant). Instead: a
  superseding ADR ([Deferred (YAGNI)](../../../.ai/architecture.md#deferred-yagni)).
- Citing [docs/idea.md](../../../docs/idea.md) as the current rule. It is a frozen RFC.
