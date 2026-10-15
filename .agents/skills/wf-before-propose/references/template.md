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

Three to six sentences. What the slice unlocks, what is blocked without it, and what makes it the right next card. Argue from build cost and testability — [the lens forbids arguing from integrator harm in the gap](../../AGENTS.md#decision-lens--evidence-over-claims-right-sized), because no real user meets it.

### 2. Scope — the `Ships` list, verbatim

Every `Ships` bullet quoted from the card, numbered, **nothing added, dropped or reworded**. Rewrite inline links to paths that resolve from this file. This list is the scope contract, and quoting it verbatim is what lets a later reader see that the proposal did not drift.

### 3. Out of scope

The card's `Deferred tail`, verbatim, plus anything the harvest suggested that the card does not carry. Each deferral names either the later slice that carries it or a **countable threshold / named observable event** — never "when demand warrants". A deferral whose own trigger cannot fire without the thing being deferred must say so; that is the lens's admitted-fallback case.

### 4. Prerequisites

Slices that must land first and whether they have · owner ops that must exist (accounts, provider apps, secrets, DNS) · env vars · provider decisions · any `about.md` open question the slice depends on. Say what is blocking today versus what merely lags.

### 5. Reality check — per-`Ships`-item verdict

A table: item · verdict (**absent** / **partial** / **already done**) · evidence (`file:line`) · what remains. Partial rows say exactly what is missing. "Already done" rows say the bullet needs ticking, not building.

### 6. Contradictions and how each resolves

One row per contradiction found in phase 3: what the two sources say (quoted, anchored), which one governs, and why — or, if it needed the owner, the ruling and its date. Empty is a valid answer, written as "none found, having checked: …" with the pairs you checked.

### 7. Decisions

`D1`, `D2`, … Each one: the decision in a sentence, why, the authority (`doc.md#anchor`, lens clause, or `owner-ruled <date>`), and what it rules out. This is the section `design.md` is written from, so a decision that a reader would have to re-derive is a failed section. Decisions the owner ruled in this run are marked as such, distinct from decisions the docs already carried.

### 8. Data model

For each table added or changed: purpose · every column with its type and nullability · enums with every member and what each means · uniqueness constraints (including `NULLS NOT DISTINCT` where it matters) · indexes and the query each serves · FKs and which are ownership keys · which `jsonb` buckets exist and their code-owned contract · the base fields · the unique key every write is idempotent on (`svix_id`, the outbox `dedupe_key`) and what a duplicate insert does · migration order, expand/contract, and any backfill.

State the [schema authority](../data-modeling.md) explicitly: the Drizzle schema in `packages/db` owns table and column shape, and its migrations are expand/contract only. Flag the whole section **Ask-first** — a schema change pauses for owner approval at apply time.

`Not touched — no schema change` is a complete answer where it is true.

### 9. State machines and transitions

Per aggregate: states, allowed transitions, the guard on each, what each transition writes to the append-only log, and which side effects it dispatches through the outbox. Transitions are the only mutator; a mutation that is not a transition is a defect worth naming here.

### 10. Backend surface

One row per operation, matching [`api-contract.md`](../api-contract.md)'s shape: operation id · read `[resource | view-shaped]` or command · semantics (a command names the exactly-one transition it fires) · in/out by entity and shape · auth and scope (`read` / `operate`) · idempotency key where a write demands one · which views it serves · **new or already existing**.

Do not assign endpoint paths or verbs unless [`api-contract.md`](../api-contract.md) already has — it is the only place operations are named, and inventing a path here creates a second source of truth.

### 11. Async — outbox, jobs, webhooks

Outbox event types and their payload shape · SQS consumers and their idempotency argument · scheduled jobs and what stops two runs overlapping · inbound webhooks, their verification, and their replay behavior · DLQ and redrive · retry and backoff ownership. SQS standard owns delivery and is never relied on for ordering; the outbox owns reactions.

### 12. UI surfaces

Per view the card's `UI surfaces` line names, cross-referenced to its [`views.md`](../views.md) entry: app · route shape · actor and scope (what a `read` token sees vs. an `operate` one) · reads tagged `[composed]` or `[view-shaped]` · actions and the command each fires · **all four required states — empty, loading, error, success** · the key strings and where their vocabulary comes from · formatting (timestamps, `--json` output in the [error shape](../../AGENTS.md#error-shape)) · the a11y floor.

Copy is `pp-ux-copy`'s domain and its forbidden terms are forbidden. Where a string is not settled, propose it here rather than leaving it for implementation — a screen with unwritten copy is a screen that gets invented at 2am.

### 13. BFF orchestration

Per view: the composed reads it fans out to, the view-shaped reads it calls, the commands its actions fire, caching and revalidation, and how round-trips are kept down. BFFs hold no business logic and never trust a client-supplied scope.

### 14. Business rules and invariants

The MUST / MUST NOT list, each stated under duplicate, out-of-order and replayed delivery: what holds when an event arrives twice, late, or through a replay. These become the `spec.md` requirements, so write them behaviorally — what the system does, not how it is coded.

### 15. Authorization and idempotency

How the caller is authenticated on each surface (webhook signature, bearer token) · which scopes may do what · the idempotency key per write and what a duplicate does · what an unsigned or out-of-scope request must return · what the integration suite must prove. No loss and no duplicate effects are what the integration tests exist for, so name the cases.

### 16. Money and fiscal

Only if the slice touches checkout, order, payment, split, payout, commission, promotion, fiscal document, reconciliation, return or dispute. Then: idempotency keys, line items and derived totals, immutable provider capture, the reconciliation ledger, payout holds, the fiscal gate, and reversals. `pp-money` binds and wins over `pp-backend` and `pp-database` wherever they collide. Otherwise: `Not touched — no money path in this slice.`

### 17. PII and data protection

Which fields are personal data, the legal basis, retention, what may appear in logs and spans (resource ids such as `svix_id` and `email_id` only, never PII), and any erasure duty. `Not touched` needs a reason, not silence.

### 18. Integrations, env and owner ops

Providers and their adapter ports · new env vars with their naming convention and `.env.example` entries · secrets · the one-time owner actions that must happen outside the code, and what stays inert until they do. Owner ops are **not** open questions — they are work items with an owner.

### 19. Decision lens, in writing

Two parts, both required:

- **The self-service test.** For each stage of `discover → sign up → live → operate → get paid → leave` this slice touches: does a step still need a human on the owner's side or an unbounded wait? Name the manual fallback and whether it sits on or off the integrator's path. "Nothing owed" is a valid answer; an unanswered test is the omission the rule exists to catch.
- **The cost brake.** What was chosen, what cheaper thing was rejected and why, and what would have been over-engineering at [the scale ceiling](../about.md#platform-scale-assumptions).

### 20. Test plan

What proves each requirement: unit tier, integration tier (duplicate and out-of-order delivery always), and what `pnpm verify` covers versus what it structurally cannot see. Name the tests that would fail if a mechanism were removed — a requirement with no such test is a requirement that will quietly rot.

### 21. Walkthrough plan

The owner hand-exercises every finished slice, so the change owes a `WALKTHROUGH.md`. Sketch it here: **one numbered path per role the card's `UI surfaces` line names**, in the order a person meets them, with the URL or command for each step. Any step that cannot be completed today names the slice that covers it, inline. A flow the card claims but no role can reach is a finding against this slice.

### 22. Docs to update

The doc-update duties the change owes at apply time: the build-checklist `Status` line and `Ships` boxes updated in place · the data-modeling Model index `Modeled` boxes · [`api-contract.md`](../api-contract.md) · [`views.md`](../views.md) if a screen changed · the project `AGENTS.md` folder tree · and **every `.ai/` correction a contradiction or an owner ruling created in this run**. That last group is why phase 4 records rulings instead of editing docs.

### 23. OpenSpec mapping

What `opsx:propose` should produce:

- The change name and the directory it will live in.
- Every spec delta by **capability path** (the directory under `openspec/specs/`), each marked `ADDED` (no such directory yet) or `MODIFIED` (it exists — say which requirements move). Preserve the existing organization; `find openspec/specs -name spec.md` is the authority on what exists.
- The requirements each delta carries, in behavior terms, drawn from section 14.
- Suggested task groups and their PR boundaries, ordered so each is independently verifiable, with the Ask-first ones flagged and the `pnpm verify` gate last.

### 24. Risks

What could go wrong, how likely, what it would cost, and the cheapest thing that would catch it early.

### 25. Owner ops still open

The **only** section allowed to contain unresolved items, and only ops — an account to create, a signature to obtain, a professional to consult. Anything here that is really a decision belongs in section 7. If a legal or fiscal unknown blocks the slice, name it and route it to [`wf-open-question`](../../.agents/skills/wf-open-question/SKILL.md) rather than resolving it.

---

## Write gate

Before handing off, check and **report the actual result**:

1. **No unresolved markers.** `grep -niE 'TBD|TODO|to be decided|open question|\?\?|decide later|unclear' <file>` returns nothing outside sections 3, 6, 22 and 25, where the words appear legitimately (a named deferral, a recorded contradiction, an `about.md` open question the slice depends on). Read every hit; do not just count them.
2. **Every `Ships` bullet** appears verbatim in section 2, has a verdict in section 5, and has a home in one of sections 8–13.
3. **Every table** has columns, types, constraints, indexes and an idempotency-key decision. **Every operation** has a kind, auth scope and an idempotency answer. **Every view** has an actor, its reads, its actions and all four states.
4. **Every decision** carries an authority. **Every deferral** carries a countable threshold or a named observable event.
5. **The self-service test is answered in writing** for the stages the slice touches.
6. **Every capability path** in section 23 is marked `ADDED` or `MODIFIED` against what `openspec/specs/` actually holds.
7. **Every section is present**, with `Not touched — <why>` where it does not apply.

Then give the owner the file path and the one-line hand-off, and stop.
