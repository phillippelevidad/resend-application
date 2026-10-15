# findings — the eight classes, their tells, and what closes each

Ordered by what they cost **at build time**, not by how often they appear. `opsx:apply` reads these four artifacts and writes code from them without re-deriving anything, so the price of every class below is paid in a diff.

For each class: **the tell** (how to spot it cheaply), **what it costs**, **how it closes** (which [fix-ladder](../SKILL.md#the-fix-ladder--what-licenses-a-repair) rung, and the usual shape of the repair).

---

## A1 — It was decided upstream and the change does not carry it

The signature class of this gate, because the pre-proposal was **already verified**. Anything missing downstream is a regression against a checked document — the cheapest defect to find here and the most expensive to miss.

**The tell.** The script's `coverage` worklist is the entry point; the reading is the judgement. Four shapes:

| Shape | What you are looking at |
| --- | --- |
| A `§14` rule with no requirement | A MUST that survives in nobody's spec, so no scenario tests it and nothing fails if it is not built |
| A `§12` surface with no task | An operation, CLI command or MCP tool the card promises, named in the pre-proposal, that `tasks.md` never asks anyone to build |
| A `§22` doc edit with no task | The change lands leaving a ratified `.ai/` doc saying something the code now contradicts |
| A `§8` column or `§10` operation that vanished | Usually the nullability, the index, or the idempotency answer — the parts that compress best and cost most |

For each item, decide between three: **covered by something that does not name it** (fine — note it and move on), **deliberately dropped with a reason stated in the change** (fine), or **gone** (a finding).

**What it costs.** The slice ships without a rule nobody notices until an adopter meets it, or with a doc that now lies. Neither is visible to `pnpm verify`.

**How it closes.** Rung 3 — the pre-proposal settles it, and the repair is to restore it at the right altitude: a rule becomes a `### Requirement:` with a `#### Scenario:`, a surface becomes a task, a doc edit becomes a task. Where the drop was deliberate and merely unstated, write the reason instead of restoring the work.

---

## A2 — The technical approach departs from a binding rule, silently

**The tell.** The design commits to something a ratified ADR or a `pp-*` `Never` list forbids, and no sentence acknowledges it. Silence is the whole defect: a departure that is argued is a decision, and this repo explicitly allows one — *"If the design must depart from one, say so explicitly and propose superseding it — never diverge silently."*

Two sources, both mandatory in pass 3:

- **The ADRs.** Every architecture decision the change touches, whether the change cites it or not. A `design.md` that cites no ADR at all is not outside the ratified set; it is a design nobody checked against it.
- **The `pp-*` `Never` lists.** Short, concrete, already prioritised. [tech-review.md](tech-review.md) routes them.

**What it costs.** Discovered at review with the code already written, which is a rewrite rather than a paragraph. Worse, an unargued departure that happens to be *right* still costs: the ratified doc keeps saying the old thing, and the next slice builds on it.

**How it closes.** Rung 1 — the rule governs, so either the design conforms or the departure becomes explicit. An explicit departure owes three things: the argument in `design.md`, a `§22`-style doc edit as a **task**, and — where it supersedes an ADR — a task that says so. Never edit `.ai/` from this skill.

---

## A3 — The design would produce a diff the gate rejects

Distinct from A2: nothing here is *forbidden*, it is simply not how this codebase is built, and the mismatch surfaces as failing tests or a rejected review rather than as a rule violation.

**The tell.** Read `design.md` as the diff it becomes, and run each touched skill's *"then read the diff"* gate checklist against it. The recurring shapes:

- A table added with no base fields, or an idempotency key (`svix_id`, an outbox `dedupe_key`) with no unique constraint behind it.
- A read-then-write where a constraint decides — two concurrent submits both pass it.
- A command that moves state without a persisted transition, or a mutation that is not a transition at all.
- A side effect fired inline where the outbox belongs, or a handler with no idempotency argument.
- The CLI or the MCP server reaching the database instead of going through `packages/sdk`, aggregating business rules, or trusting a client-supplied value.
- A backfill with no failure behaviour stated — "backfill from X" without saying what happens to a row where X is absent.

**What it costs.** Rework at the exact moment the owner wanted to be walking the slice, plus an integration suite that goes red for a structural reason nobody planned for.

**How it closes.** Rung 1, citing the skill's rule verbatim. The repair usually costs one sentence in `design.md` plus one clause in a task — *"…, failing loudly where none exists"*, *"…, and verify a second insert for the same `svix_id` is refused by the database"*.

---

## A4 — The four artifacts disagree

**The tell.** Pick each concrete object the change touches — a column, a status, a route, a field, a scope, a CLI flag, a `CHECK` member — and read **every** mention of it across `proposal.md`, `design.md`, the deltas and `tasks.md`. Then compare. The gap is usually altitude: the proposal describes the intent, the design the mechanism, the spec the behaviour, the task the step, and one of them drifted while the others did not.

This is the class a single-file reader cannot see, which is why pass 2 reads all four. The script hands you `orphans` as a starting point — named in a spec or the data model and in no task, or named only in `tasks.md` — but the contradictions themselves are reading work.

**What it costs.** `opsx:apply` picks one reading, silently. There is a 50% chance it picks the one the owner would not have, and no artifact records that a choice was made.

**How it closes.** Rung 1 or 2 — one reading is nearly always settled by a ratified doc or by the code. Fix **every** occurrence, not the one you found first, and state the resolution once, as a decision in `design.md`, so the next reader sees a decision rather than a coincidence.

---

## A5 — The mechanism does not exist, or the actor cannot reach it

**The tell.** The change names a field, column, route, token claim, port, id or capability as though it were there. Grep it. Three shapes:

- *Absent.* A gate written against a field the type does not carry. No column sourcing a state a row is promised. No enum member for a status the copy announces.
- *Present but unreachable.* The row exists and no endpoint returns its id. The operation exists and no CLI command or MCP tool reaches it. The read exists and filters out exactly the rows the caller needs.
- *Named in prose, never in code.* "Replay is gated on the **webhook being enabled**." Which field? Which response from which call? The sentence names nothing to grep, so it reads as settled and implements as nothing. **The sweep: take every gate, guard, cap and precondition the change states, and demand the name of what the code reads to decide it.**

The script helps with the first shape only, listing every backticked identifier the repo has never heard of and separating the ones **grafted onto something that does exist** from the ones wholly new — which are usually just what the change builds. Its `freshness` list is the other half: anything that landed since the change was written makes its claim unverified again.

**What it costs.** A slice the owner cannot hand-exercise, which the lens makes a MUST regardless of the fact that no adopter is watching, because the walk is how the slice is verified at all.

**How it closes.** Rung 2 — the repo is the fact. The cheap repair is usually already half-built: a read that loads the row anyway can return its id; an operation that exists needs its CLI command; a claim the token already carries needs reading rather than adding. Write it as a decision in `design.md` with the reachability it restores, and add the task — a fix needing new backend code is a different conversation from one needing a field on an existing response.

---

## A6 — A requirement that cannot become a test, or a task that cannot be checked

**The tell.** Two halves, one per artifact.

*Specs.* Every `### Requirement:` needs at least one `#### Scenario:` with a WHEN and a THEN that could **fail**. The script checks the shape; you check the substance:

| Shape | Fix |
| --- | --- |
| A scenario whose THEN restates the WHEN | Write the observable outcome someone could see or a test could assert |
| A requirement naming a class, a file, or an endpoint | Wrong altitude. Rewrite as behaviour — *"if the implementation can change without changing externally visible behaviour, it does not belong in the spec"* |
| A requirement on event handling with no duplicate or out-of-order statement | State what holds on first delivery, and what a redelivery or a late event must not change |
| A rule that reads as a description | Sharpen it until it can refuse something |

*Tasks.* Each task states **how completion is checked, inside the task**. "Add the migration" is intent; "Add the migration, and verify it applies against a freshly migrated database **and refuses** a second row with the same `svix_id`" is a task. A separate verification task is right only where the check spans several tasks.

**What it costs.** A requirement with no failing test is a requirement that ships unbuilt and unnoticed — the change goes green with the behaviour absent.

**How it closes.** Rungs 1–3, almost always by writing the scenario or the check clause. If writing it needs a fact you would have to invent, it is rung 5, not rung 4.

---

## A7 — The order would fail at build time

**The tell.** `tasks.md` read as a sequence rather than a list. The recurring shapes:

- A backfill before the expand migration it writes into, or a contract step shipped in the same deploy as its expand ([ADR-018](../../../../.ai/architecture.md#adr-018--migrations-run-from-the-deploy-command-before-the-code-that-needs-them)) — the migration blocks mid-apply, which is the most expensive place to find anything.
- A route before the handler it exposes, an SDK method or CLI command before the `api-contract.md` entry it implements.
- An Ask-first task not flagged — a change to a pushed migration, a new dependency, a CI change, a public-contract change, an AWS deploy or a live Resend write that apply would commit without the owner.
- `pnpm verify` not last, or absent. Exit 0 with every stage run is the only definition of done.
- A task bundling three independent things, so it cannot fail cleanly or land as one PR.
- The [doc-update duties `pp-workflow` owes](../../pp-workflow/SKILL.md#definition-of-done) missing entirely: the build-checklist `Status` line and `Ships` boxes in place, the data-modeling **Model index** `Modeled` checkbox, `api-contract.md`, the root `AGENTS.md` **Projects** table, `.env.example`.

**What it costs.** A half-applied migration, or a build that stops at task 4 of 9 with the owner holding the pieces.

**How it closes.** Rung 2 or 3. Reorder, and put the **reason inline in the task** — an ordering constraint recorded only in prose is one that gets lost the next time someone reshuffles the list.

---

## A8 — Scope drifted, or a human is still on the integrator's path

**The tell.** Two things the change is contractually bound to get right, both cheap to check and both routinely quietly wrong.

*Scope.* The script diffs the `Ships` list verbatim in both directions, so the mechanical half is done. What remains is judgement: work in the design that no `Ships` bullet authorises; a `Ships` bullet with no task; a deferral in the tail that a spec still writes a requirement for; a deferral with no countable threshold or named observable event — *"when demand warrants"* is not one, and a deferral whose own trigger cannot fire without the deferred thing must say so.

*The self-service test.* Do not read the proposal's answer — run it. Walk `deploy → connect the webhook → ingest → query → recover → tear down` for the stages this change touches, and at each step ask *who running Ledger has to do something by hand for this to work?* The fallbacks that hide: an owner script (the command's own comment often says so), a database query to find an id the product never shows, a manual replay or approval, an unbounded wait with no in-product diagnosis.

Then place it: **off** the integrator's path it costs owner hours, is correctly cheap, and defers on a tripwire. **In** their path to a working ledger it costs time-to-first-event and adoption — and it must be admitted, not answered with "escalate only on measured pain", because that pain is never measured; the adopter leaves instead of reporting it.

**What it costs.** A slice sized at 1–3 days that is not; a bullet the owner ticks having never built it; or a proposal claiming a self-service flow the product does not have, with the claim already carried into the specs.

**How it closes.** Rung 1 for scope — the card governs, so orphan work moves to the deferred tail with the slice that carries it, or is cut, and a homeless bullet gets a task. Never resolve drift by editing the card; that is the change's work at apply time, recorded as a task. Rung 4 for the self-service half, and the lens names the ceiling: **admit only the smallest version that removes the fallback.** Where that version is copy, a stance, a price, or something an existing slice already ships, admit nothing. Where the removal is genuinely a new capability, price it and hold it for the owner round — rung 5, not a repair.

---

## Per-artifact conformance — what each one owes

Read with the OpenSpec templates (`openspec instructions <artifact> --change <name> --json` prints each one) plus this repo's rules in [`openspec/config.yaml`](../../../../openspec/config.yaml). This is the checking pass over them.

### `proposal.md`

| Owes | The miss to look for |
| --- | --- |
| **Why**, argued from build cost and testability | An argument from adopter or reviewer harm in the gap — [not available](../../../../AGENTS.md#decision-lens--evidence-over-claims-right-sized), no real user meets it |
| The `Ships` list, verbatim | Script-checked both ways. Judge only whether rewritten links changed meaning |
| **What Changes**, specific per surface, breaking changes marked | A bullet naming a surface with no mechanism, or a mechanism with no surface |
| **Capabilities**, split New / Modified | Script-checked against `openspec/specs/` and the delta files. Judge whether a "modified" one really changes *requirements* rather than implementation |
| The deferred tail, each with a carrying slice or a countable trigger | "When demand warrants"; a deferral whose own trigger cannot fire without the deferred thing |
| The self-service test, in writing | A8 — run it, do not read it |
| **Impact**: apps, schema, contract, dependencies, env, AWS resources and cost, PII | `Ask-first` unmarked on schema or contract; cost silence where an AWS resource is added; `Not touched` with no reason |
| Open questions surfaced, never resolved | An [`about.md` open question](../../../../.ai/about.md#open-questions) answered here. Surface it, tagged `[Unverified]`, and let the owner rule in the owner-decision round |

### `specs/<capability>/spec.md`

| Owes | The miss to look for |
| --- | --- |
| A `## Purpose` on a new capability; none on a delta to an existing one | Script-checked |
| Behaviour only — observable, testable, duplicate- and order-aware | A6: a class name, a file, an endpoint path, a library choice. `api-contract.md` is the only place operations get paths and verbs |
| Every requirement with ≥1 WHEN/THEN scenario that could fail | Script-checked for shape; read for substance |
| The [domain vocabulary](../../../../.ai/about.md#domain-vocabulary) from `about.md` | A term outside it reaching the spec, then the CLI output and the docs |
| Duplicate and out-of-order expectations stated | "What holds on first delivery" written, "what a redelivery or a late event must not change" omitted |

### `design.md`

| Owes | The miss to look for |
| --- | --- |
| **Context** — constraints only, no restated motivation | A second copy of the proposal's Why, which then drifts from it |
| **Goals / Non-Goals** at design level | A non-goal that is really scope the card carries |
| **Decisions**, each with authority and a rejected alternative | A2, A3. Every `D<n>` cited by a task must exist here; a decision with no Y is one the builder re-opens |
| **Data model** — columns, types, nullability, enums, constraints, indexes, FKs, idempotency keys, expand/contract migration order, backfill behaviour | A nullable never stated; an idempotency key with no unique constraint; a contract step shipped in the same deploy as its expand; a backfill with no failure behaviour |
| **Risks / Trade-offs**, each with a mitigation | A risk with no mitigation, which is a worry rather than a risk |
| **Migration Plan** where it applies | Ordering left in prose, or the rollback story unwritten |
| **Open Questions** only where they cannot change the specs, the approach or the tasks | A question that *would* change the tasks. That is a rung-5 owner item, not a deferred unknown |

### `tasks.md`

| Owes | The miss to look for |
| --- | --- |
| `- [ ] N.M` checkboxes, all unticked | Script-checked. A ticked box means this is not a pre-apply state |
| Each task independently verifiable, with the check in the task | A6 |
| Dependency order | A7 |
| Ask-first tasks flagged and named | A7 — flagged but vague is nearly as bad; say what the owner is approving |
| The `pp-workflow` doc duties | A7 |
| `pnpm verify` last, reported honestly | "Run the tests" standing in for the gate |
| A `WALKTHROUGH.md` task | The slice cannot be ticked without one, and it is what proves what `pnpm verify` structurally cannot see |
