# template — the pre-proposal document

The document has one job: **`opsx:propose` must be able to write `proposal.md`, every `specs/<capability>/spec.md` delta, `design.md` and `tasks.md` from it without asking the owner anything.** Every section below exists because one of those four artifacts needs it.

Two rules govern the whole document:

- **A section that does not apply is written as `Not touched — <why>`, never deleted.** Absence proved costs a line. Absence forgotten is the defect that reaches the migration.
- **Every claim carries its authority** — a `doc.md#anchor`, a `file:line`, a decision-lens clause, or `owner-ruled <date>`. A sentence with no authority is this skill guessing, which is the thing it exists to prevent.

Write in the house voice of the `.ai/` docs: tight, RFC-2119 where a rule is being stated, cross-reference instead of repeating. Links to `.ai/` docs are relative (`../about.md#anchor`) since the file sits in `.ai/pre-proposals/`.

---

## Skeleton

### Front matter — the metadata block

Slice number and title · change name (kebab, what the OpenSpec change will be called) · date · the card's current `Status` marker · `Depends on` and whether those slices are actually done · the track (spine / parallel) · the apps touched · a one-line link to any earlier pre-proposal for the same slice with what changed since · a **`Checked`** row reading `Not yet`, which [`wf-before-propose-check`](../../.agents/skills/wf-before-propose-check/SKILL.md) replaces in place with its date and counts once the verification gate has run.

### 1. Why now

Three to six sentences. What the slice unlocks, what is blocked without it, and what makes it the right next card. Argue from build cost and testability — [the lens forbids arguing from adopter or reviewer harm in the gap between slices](../../AGENTS.md#decision-lens--evidence-over-claims-right-sized), because a gap a named later slice carries is the plan working.

### 2. Scope — the `Ships` list, verbatim

Every `Ships` bullet quoted from the card, numbered, **nothing added, dropped or reworded**. Rewrite inline links to paths that resolve from this file. This list is the scope contract, and quoting it verbatim is what lets a later reader see that the proposal did not drift.

### 3. Out of scope

The card's `Deferred tail`, verbatim, plus anything the harvest suggested that the card does not carry. Each deferral names either the later slice that carries it or a **countable threshold / named observable event** — never "when demand warrants". A deferral whose own trigger cannot fire without the thing being deferred must say so; that is the lens's admitted-fallback case.

### 4. Prerequisites

Slices that must land first and whether they have · owner ops that must exist (a Resend API key, a webhook signing secret, an AWS account with its budget alarms) · env vars · any `about.md` open question the slice depends on. Say what is blocking today versus what merely lags.

### 5. Reality check — per-`Ships`-item verdict

A table: item · verdict (**absent** / **partial** / **already done**) · evidence (`file:line`) · what remains. Partial rows say exactly what is missing. "Already done" rows say the bullet needs ticking, not building.

### 6. Contradictions and how each resolves

One row per contradiction found in phase 3: what the two sources say (quoted, anchored), which one governs, and why — or, if it needed the owner, the ruling and its date. Empty is a valid answer, written as "none found, having checked: …" with the pairs you checked.

### 7. Decisions

`D1`, `D2`, … Each one: the decision in a sentence, why, the authority (`doc.md#anchor`, lens clause, or `owner-ruled <date>`), and what it rules out. This is the section `design.md` is written from, so a decision that a reader would have to re-derive is a failed section. Decisions the owner ruled in this run are marked as such, distinct from decisions the docs already carried.

Open the section, before `D1`, with an **Ask-first approvals** table: one row per Ask-first item the slice crosses ([Permissions](../../AGENTS.md#permissions)) — the exact package and version range, workflow file, resource, contract entry or frozen migration — its status (`owner-approved <date>` in the owner round, or `held`) and the task group that uses it. An itemized approval counts for exactly what the row names; anything off the table, or outside its range, still stops at apply ([`pp-workflow` → definition-of-done.md → 3](../../.agents/skills/pp-workflow/references/definition-of-done.md#3--permission-check)). `None — the slice crosses no Ask-first item` is a complete answer where it is true.

### 8. Data model

For each table added or changed: purpose · every column with its type and nullability · enums with every member and what each means · uniqueness constraints (including `NULLS NOT DISTINCT` where it matters) · indexes and the query each serves · FKs and which are ownership keys · which `jsonb` buckets exist and their code-owned contract · the base fields · the unique key every write is idempotent on (`svix_id`, the outbox `dedupe_key`) and what a duplicate insert does · migration order, expand/contract, and any backfill.

State the [schema authority](../data-modeling.md) explicitly: the Drizzle schema in `packages/db` owns table and column shape, and its migrations are expand/contract only. Flag the whole section **Ask-first** — a schema change pauses for owner approval at apply time, unless section 7's Ask-first approvals table names it as approved.

`Not touched — no schema change` is a complete answer where it is true.

### 9. State machines and transitions

Per projection: its states, how each is recomputed from the event set rather than advanced by arrival ([ADR-003](../architecture.md#adr-003--projection-is-a-pure-function-of-the-event-set)), the rule that decides a tie, what each change writes, and which reactions it dispatches through the outbox. A mutation that bypasses the projection function is a defect worth naming here.

### 10. Backend surface

One row per operation, matching [`api-contract.md`](../api-contract.md)'s shape: operation id · read or operate · semantics · in/out by entity and shape · auth and scope (`read` / `operate`) · idempotency key where a write demands one · which surfaces expose it (SDK method, CLI command, MCP tool) · **new or already existing**.

Do not assign endpoint paths or verbs unless [`api-contract.md`](../api-contract.md) already has — it is the only place operations are named, and inventing a path here creates a second source of truth.

### 11. Async — outbox, jobs, webhooks

Outbox event types and their payload shape · SQS consumers and their idempotency argument · scheduled jobs and what stops two runs overlapping · inbound webhooks, their verification, and their replay behavior · DLQ and redrive · retry and backoff ownership. SQS standard owns delivery and is never relied on for ordering; the outbox owns reactions.

### 12. Surfaces — read API, SDK, CLI, MCP

Per surface the card's `UI surfaces` line names: the operation it calls, from [`api-contract.md`](../api-contract.md) · the SDK method · the CLI command and its flags, `--json` included · the MCP tool and its input schema · actor and scope (what a `read` token sees vs. an `operate` one) · what the human and `--json` output carry, timestamps and masks included · **every error code it raises**, from [the registry](../api-contract.md#error-codes), with its `message` and `hint` in the [error shape](../../AGENTS.md#error-shape).

Surface wording is [`pp-backend`](../../.agents/skills/pp-backend/SKILL.md#surfaces--sdk-cli-mcp)'s domain for the SDK and the shared rules, [`pp-cli`](../../.agents/skills/pp-cli/SKILL.md#output-and-exit-codes)'s for the CLI and [`pp-mcp`](../../.agents/skills/pp-mcp/SKILL.md#tool-registration-and-least-privilege)'s for the MCP server. **Write each `message` and `hint` out, do not describe it** — a hint left for implementation is a hint invented at 2am. A new error code, or a changed command, flag or tool, is a public-contract change: flag it Ask-first.

### 13. Recovery paths — redrive, replay, reconcile

How the slice's data survives loss, duplicates and outage: which path reaches it — DLQ redrive ([ADR-008](../architecture.md#adr-008--backpressure-bounded-concurrency-partial-batch-failure-dlq)), gap detection and replay through ingest ([ADR-007](../architecture.md#adr-007--recovery-by-id-diff-and-replay-through-ingest)), the worker pausing its event source on a database outage ([ADR-015](../architecture.md#adr-015--the-worker-pauses-its-own-event-source-on-a-database-outage)) — and what a redriven or replayed message does when it arrives: a duplicate on `svix_id`, never a second effect. `Not touched` names the path that already covers the slice's data.

### 14. Business rules and invariants

The MUST / MUST NOT list, each stated under duplicate, out-of-order and replayed delivery: what holds when an event arrives twice, late, or through a replay. These become the `spec.md` requirements, so write them behaviorally — what the system does, not how it is coded.

### 15. Authorization and idempotency

How the caller is authenticated on each surface (webhook signature, bearer token) · which scopes may do what · the idempotency key per write and what a duplicate does · what an unsigned or out-of-scope request must return · what the integration suite must prove. No loss and no duplicate effects are what the integration tests exist for, so name the cases.

### 16. Cost and the Resend budget

Every AWS resource the slice adds and whether it charges while idle ([`aws.md → Cost shape`](../aws.md#cost-shape), the [cost brake](../../AGENTS.md#decision-lens--evidence-over-claims-right-sized)) · every call to Resend's API, which goes through `resend-client` and shares its 10 req/s budget ([ADR-012](../architecture.md#adr-012--resend-client-is-the-sole-resend-api-caller)) · how a burst or a reconcile run stays inside that budget. An always-on resource needs a stated, measured reason in an ADR. Otherwise: `Not touched — no AWS resource and no Resend call added.`

### 17. PII and retention

Which fields carry personal data (addresses, subjects, bodies) and which tables hold the raw value, a mask or a keyed hash ([`data-modeling.md#pii--retention`](../data-modeling.md#pii--retention)) · how long raw payloads are kept and how they are redacted ([ADR-014](../architecture.md#adr-014--raw-payload-retention-and-redaction)) · what may appear in logs, spans, outbox payloads and `last_error` (resource ids such as `svix_id` and `email_id`, never PII) · what each surface returns — masks only, MCP tool output included · any erasure duty. `Not touched` needs a reason, not silence.

### 18. Integrations, env and owner ops

Providers and their adapter ports · new env vars with their naming convention and `.env.example` entries · secrets · the one-time owner actions that must happen outside the code, and what stays inert until they do. Owner ops are **not** open questions — they are work items with an owner.

### 19. Decision lens, in writing

Two parts, both required:

- **The self-service test.** For each stage of [`deploy → connect the webhook → ingest → query → recover → tear down`](../about.md#guiding-principles) this slice touches: does a step still need a human on the owner's side or an unbounded wait? Name the manual fallback and whether it sits on or off the adopter's path. "Nothing owed" is a valid answer; an unanswered test is the omission the rule exists to catch.
- **The cost brake.** What was chosen, what cheaper thing was rejected and why, and what would have been over-engineering at [the scale ceiling](../about.md#platform-scale-assumptions).

### 20. Test plan

What proves each requirement: unit tier, integration tier (duplicate and out-of-order delivery always), and what `pnpm verify` covers versus what it structurally cannot see. Name the tests that would fail if a mechanism were removed — a requirement with no such test is a requirement that will quietly rot.

### 21. Walkthrough plan

Every finished slice is walked by hand (`rsa-manual-test` executes it; the owner approves or walks the Ask-first steps), so the change owes a `WALKTHROUGH.md` in [the walkthrough format](../../.agents/skills/rsa-manual-test/references/walkthrough-format.md). Sketch it here: **every surface the card's `UI surfaces` line names reached by a numbered path** (a path MAY group surfaces walked together), in the order a person meets them, each path naming the persona walking it, each step with its command or request and its expected output where known. Mark every step that writes to a live Resend account or AWS `**Ask-first:**`. Any step that cannot be completed today names the slice that covers it, inline. A surface the card claims but no path reaches is a finding against this slice.

### 22. Docs to update

The doc-update duties the change owes at apply time: the build-checklist `Status` line and `Ships` boxes updated in place · the data-modeling Model index `Modeled` boxes · [`api-contract.md`](../api-contract.md), its error-code registry included · the root `AGENTS.md` Projects table · and **every `.ai/` correction a contradiction or an owner ruling created in this run**. That last group is why phase 4 records rulings instead of editing docs.

### 23. OpenSpec mapping

What `opsx:propose` should produce:

- The change name and the directory it will live in.
- Every spec delta by **capability path** (the directory under `openspec/specs/`), each marked `ADDED` (no such directory yet) or `MODIFIED` (it exists — say which requirements move). Preserve the existing organization; `find openspec/specs -name spec.md` is the authority on what exists.
- The requirements each delta carries, in behavior terms, drawn from section 14.
- Suggested task groups and their PR boundaries, ordered so each is independently verifiable, with the Ask-first ones flagged and the `pnpm verify` gate last.

### 24. Risks

What could go wrong, how likely, what it would cost, and the cheapest thing that would catch it early.

### 25. Owner ops still open

The **only** section allowed to contain unresolved items, and only ops — an account to create, a secret to provision, a test send to approve. Anything here that is really a decision belongs in section 7. If an unknown no research settles blocks the slice — Resend behaviour the docs leave open, or a legal or commercial question — name it, record it under [`about.md → Open questions`](../about.md#open-questions) tagged `[Unverified]`, and put it to the owner in the owner-decision round rather than resolving it.

---

## Write gate

Before handing off, check and **report the actual result**:

1. **No unresolved markers.** `grep -niE 'TBD|TODO|to be decided|open question|\?\?|decide later|unclear' <file>` returns nothing outside sections 3, 6, 22 and 25, where the words appear legitimately (a named deferral, a recorded contradiction, an `about.md` open question the slice depends on). Read every hit; do not just count them.
2. **Every `Ships` bullet** appears verbatim in section 2, has a verdict in section 5, and has a home in one of sections 8–13.
3. **Every table** has columns, types, constraints, indexes and an idempotency-key decision. **Every operation** has a kind, auth scope and an idempotency answer. **Every surface** names its operation, its `--json` output, and each error code it raises with the `message` and `hint` written out.
4. **Every decision** carries an authority. **Every deferral** carries a countable threshold or a named observable event. **Every Ask-first item** the document names has its row in section 7's approvals table.
5. **The self-service test is answered in writing** for the stages the slice touches.
6. **Every capability path** in section 23 is marked `ADDED` or `MODIFIED` against what `openspec/specs/` actually holds.
7. **Every section is present**, with `Not touched — <why>` where it does not apply.

Then give the owner the file path and the one-line hand-off, and stop.
