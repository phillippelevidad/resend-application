# Build checklist

> **TEMPLATE — not ratified.** Bootstrap step 10 in [bootstrap-checklist.md](bootstrap-checklist.md). The preview content below is illustrative, drafted from [docs/idea.md](../docs/idea.md) without research. Nothing here is binding until this banner and the instructions comment are removed.

<!-- AGENT INSTRUCTIONS
Purpose: The per-slice execution tracker. One card per vertical slice: goal, dependencies, refs,
  a capability-level Ships done-list, the surfaces a walkthrough exercises, owner ops, and the
  deferred tail. It is the progress layer over architecture.md's build order and owns neither the
  ordering nor the rationale.
Consumers: wf-before-propose, wf-before-propose-check, wf-after-propose-check,
  wf-after-apply-check. Their scripts PARSE this file, and they also detect the repo root by the
  existence of .ai/build-checklist.md: deleting or renaming it breaks every wf-* script.
Inputs (read first): root AGENTS.md (decision lens, Permissions); .ai/AGENTS.md; about.md
  (milestones, non-goals); bootstrap-checklist.md Owner calibration (binding: M1 MVP, M2 Feature
  complete, M3 Stretch, no dates; deploy-and-keep AWS posture with mandatory budget alarms);
  architecture.md#build-order-vertical-slices (step 7: the FINAL slice list, ids and milestone
  mapping come from there, not from this preview); data-modeling.md; api-contract.md (every
  operation a card implies MUST have an entry whose Slices line names the card); features.md.
Research: none external. Cross-check every Refs anchor resolves and every Ships bullet is
  traceable to an ADR, a data-modeling section, an api-contract entry or a features.md row.
Parser contract (verified against the scripts; do not restyle):
  - Card heading: level-3 heading, then `<ID> — <Title>` with an em dash; ID matches \d+[A-Za-z]?
    (e.g. 2, 2B). Headings carry NO status marker: they are link anchors.
  - Card bullets are top-level, in this order: Status, Goal, Depends on, Refs, Ships, UI surfaces,
    Ops, Deferred tail. Status holds the marker in backticks.
  - Ships is followed by indented one-line checkbox bullets (two spaces, dash, box, text). Only
    the todo and done boxes are allowed there; no nesting; no continuation prose.
  - A card region runs from its heading to the next level-3 heading, crossing milestone headings.
    The scripts count every checkbox line in that region, so NO checkbox line may appear anywhere
    in this file outside a Ships list: not in the intro, the legend, milestone intros or here.
  - Change folders are named slice-<id>-<kebab-title>; the scripts read the id from that name.
Required structure (in this order): intro prose · `## How to work this checklist` (anchor cited
  by skills) · `## Legend` · `## M1 — MVP` · `## M2 — Feature complete` · `## M3 — Stretch`, each
  holding its cards.
Evidence rules: every Ships bullet names the evidence that proves it (test, property, invariant,
  measured number, working command). A bullet with no checkable evidence is cut, per the owner's
  working definition of overdoing it.
Owner decisions to surface: the M1 slice cut (owned by step 7; do not re-ask here), and whether
  slice 1's CLI reads Postgres directly (idea §7 phase 1) or goes through the SDK (AGENTS.md
  module boundaries). This preview phrases slice 1 neutrally; the ratified card MUST pick one.
Done when: banner and this comment removed; one card per slice in architecture.md's build order,
  ids and titles identical; every card has all eight fields; every Status starts at todo; a dry
  run of the three check.mjs scripts against a scratch change resolves a card and its Ships list.
-->

Execution tracker, one card per vertical slice. **This file does not own ordering or rationale**:
both are canonical in [architecture.md → Build order](architecture.md#build-order-vertical-slices).
The "what" of each slice is assembled from [features.md](features.md),
[data-modeling.md](data-modeling.md) and [api-contract.md](api-contract.md); links point out rather
than restate. Milestones carry no dates
([owner calibration](bootstrap-checklist.md#owner-calibration-ratified-2026-10-15)).

## How to work this checklist

- **Read order:** [`.ai/AGENTS.md`](AGENTS.md) → [about.md](about.md) →
  [architecture.md → Build order](architecture.md#build-order-vertical-slices) → the card you are
  taking → its `Refs`.
- **Spine vs. parallel tracks.** The spine is the slice order in architecture.md; finish each spine
  slice before the next. A slice with a letter suffix (e.g. `2B`) is a branch off its number, not a
  spine link, and MAY run in parallel once its `Depends on` are done. Take the first unblocked todo
  slice on the track you are advancing.
- **Continuous deploy, one public demo.** Under the deploy-and-keep posture, slices from durable
  ingest onward deploy to the owner's AWS account as they finish; the README demo is published once
  M1 is done. A gap that a **named later slice** carries is fine; a finished slice whose surfaces
  cannot be exercised by hand is not finished.
- **The walkthrough a slice owes.** Every slice's change folder (`openspec/changes/slice-<id>-<kebab>/`)
  MUST contain a `WALKTHROUGH.md` before its `Status` is ticked: numbered steps, one path per surface
  the card's `UI surfaces` line names, each with the exact CLI command, API request or simulator run
  and its expected output. A step that cannot be completed today MUST name the slice that covers it,
  inline. A surface the card claims but no step reaches is a finding against this slice.
- **Ships are capability-level.** Explode them into tasks when the slice starts (OpenSpec
  `tasks.md`), not up front.
- **Status only, no history.** Update the `Status` line and the `Ships` boxes in place; no
  changelog, no dated notes. An unresolved question goes to
  [about.md → Open questions](about.md#open-questions) and the card is marked blocked with a
  one-line reason.

## Legend

`[ ]` todo · `[~]` in progress · `[x]` done · `[!]` blocked on an owner decision (one-line why).

The marker lives on the card's `Status` line, in backticks, and nowhere else. Headings MUST stay
marker-free. A ticked `Status` over an unticked `Ships` box is the card lying.

## M1 — MVP

Foundations, local v0, durable ingest on AWS, recovery, and a usable CLI; evidence over breadth.
_(Preview: only slices 0 and 1 are drafted; the rest of M1 comes from architecture.md.)_

### 0 — Foundations

- **Status:** `[ ]`
- **Goal:** A monorepo where the projection logic is proven by property tests and CI gates every push.
- **Depends on:** — (foundational).
- **Refs:** [architecture.md → Build order](architecture.md#build-order-vertical-slices) · [idea §7 phase 0](../docs/idea.md#7-implementation-plan) · [idea §5.4](../docs/idea.md#54-order-independent-projections)
- **Ships:**
  - [ ] pnpm workspace with Biome, Vitest and strict TypeScript; one `pnpm verify` that mirrors CI stage for stage.
  - [ ] GitHub Actions CI running `pnpm verify` on every push and PR.
  - [ ] `packages/core` event types and `projectEmail`, with no AWS, Postgres or Resend imports.
  - [ ] fast-check properties green: permutation invariance, idempotence, monotonicity, oracle agreement.
- **UI surfaces:** `pnpm verify` locally; the CI run on a pushed commit.
- **Ops:** — none.
- **Deferred tail:** Recipient projection and Drizzle schema ([slice 1](#1--local-v0)). Any AWS resource (durable-ingest slice).

### 1 — Local v0

- **Status:** `[ ]`
- **Goal:** Real Resend events, verified locally, land once in a Postgres ledger and project into correct email and recipient state.
- **Depends on:** 0.
- **Refs:** [architecture.md → Build order](architecture.md#build-order-vertical-slices) · [idea §7 phase 1](../docs/idea.md#7-implementation-plan) · [api-contract.md → email.get](api-contract.md#emailget) · [api-contract.md → recipient.get](api-contract.md#recipientget)
- **Ships:**
  - [ ] Local ingest verifies signature and timestamp on the raw body and rejects forgeries with `401`.
  - [ ] Drizzle schema and migrations for the ledger and both projections; one transaction per event keyed on `svix_id`.
  - [ ] `projectRecipient` with property tests; recipient state upserted in the event transaction.
  - [ ] `ledger email` and `ledger recipient` print state and timeline, with `--json` in the error shape.
  - [ ] `ledger simulate --duplicates --shuffle` passes simulator invariants 1 and 2.
- **UI surfaces:** `POST /webhooks/resend` (local) · `resend webhooks listen` · `ledger email <id>` · `ledger recipient <address>` · `ledger simulate --duplicates 0.2 --shuffle`.
- **Ops:** owner: a Resend test API key and webhook signing secret in a local, git-ignored `.env`; use only `@resend.dev` test addresses.
- **Deferred tail:** SQS, DLQ and CDK (durable-ingest slice). Read API and SDK (interfaces slice). Multi-secret verification (recovery slice).

## M2 — Feature complete

Every [idea §7](../docs/idea.md#7-implementation-plan) phase at v0 depth, a real AWS deploy, simulator
evidence. _(Preview stub.)_

### 5 — Reactions

- **Status:** `[ ]`
- **Goal:** Reactions fire exactly once on top of at-least-once delivery.
- **Depends on:** the durable-ingest slice (id from architecture.md).
- **Refs:** [idea §5.6](../docs/idea.md#56-reactions-via-a-transactional-outbox)
- **Ships:**
  - [ ] Outbox rows written in the event transaction; dispatcher with retries and backoff.
  - [ ] `--chaos worker-crash` run produces no duplicate dispatch (simulator invariant 3).
- **UI surfaces:** `ledger simulate --chaos worker-crash:0.05`.
- **Ops:** owner approves any live send through Resend (Ask-first); a verified sending domain for alerts.
- **Deferred tail:** Threshold alert rules beyond the v0 set.

## M3 — Stretch

npm releases with semver, real AWS load numbers, a learning log. _(Preview stub.)_

### 7 — Publish SDK and CLI to npm

- **Status:** `[ ]`
- **Goal:** Adopters install the SDK and CLI from npm with semver guarantees.
- **Depends on:** the interfaces slice (id from architecture.md).
- **Refs:** [api-contract.md → Conventions](api-contract.md#conventions)
- **Ships:**
  - [ ] Versioned release workflow publishing `packages/sdk` and `apps/cli` with provenance.
- **UI surfaces:** `npx <cli-package> email <id>` against the deployed stack.
- **Ops:** owner: npm account and package names; adding the release workflow changes CI (Ask-first).
- **Deferred tail:** Changelog automation.
