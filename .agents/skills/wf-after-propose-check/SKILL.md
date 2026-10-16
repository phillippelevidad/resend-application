---
name: wf-after-propose-check
description: Adversarially reviews the OpenSpec change `opsx:propose` wrote — `proposal.md`, `design.md`, every `specs/<capability>/spec.md` and `tasks.md` — before `opsx:apply` builds from it. The last gate before code, and it asks two questions the pre-proposal gate could not — did the change carry forward everything the pre-proposal and the slice card settled, and is the technical approach the one the ratified ADRs and the binding `pp-*` skills require? It verifies every anchor, quote and `file:line`, hunts the decisions and rules that vanished in compression, walks each touched skill's `Never` list against the design, re-runs the reality check against the repo as it stands today, and closes every ambiguity that would make `opsx:apply` guess or build in the wrong order. It repairs what the docs, the skills, the repo or the decision lens settle, and puts only a genuine owner decision at the end. Load this immediately after `opsx:propose` and before `opsx:apply`, and whenever the user asks to check, review, audit, verify or sanity-check a proposal, a change, a design or a task list ("check the proposal", "is this ready to build", "review the change before apply", "did propose miss anything", "tech review the design", "audit `openspec/changes/…`"), or names a directory under `openspec/changes/` with any doubt attached. Load it too when `opsx:apply` starts asking questions, builds something no spec named, or reaches for an approach the `pp-*` skills forbid — that means this gate never ran, or ran and did not hold. It owns the verification and the repair; it never authors a missing artifact from scratch, never implements the change, and never edits ratified `.ai/` docs.
---

# wf-after-propose-check — the last reader before the code

**Owns:** verifying the change against the pre-proposal, the ratified `.ai/` docs, the binding `pp-*` skills and the repo · repairing what those settle · the owner-decision round · `REVIEW.md` · the ready-for-apply verdict.

**Does not own:** authoring a missing artifact (→ `opsx:propose`) · verifying the pre-proposal itself (→ [`wf-before-propose-check`](../wf-before-propose-check/SKILL.md), which already ran) · implementing the change (→ `opsx:apply`) · editing ratified `.ai/` docs (→ a task the change carries; a question nothing settles goes under [`about.md` → Open questions](../../../.ai/about.md#open-questions) tagged `[Unverified]`, and to the owner in the owner-decision round) · writing the code-level rules (→ the [`pp-*` skills](../../../AGENTS.md#patterns-and-practices), which this skill only enforces).

**Precedence:** a ratified `.ai/` decision and a binding `pp-*` rule both outrank anything the change says, and where two rules collide the [decision-lens tie-break](../../../AGENTS.md#decision-lens--evidence-over-claims-right-sized) decides: correctness of event handling (no loss, no duplicate effects, order-independent state) outranks everything else. The decision lens and the [risk appetite](../../../.ai/about.md#risk-appetite) outrank this skill's own reasoning. The slice card's `Ships` list is still the scope contract — repairs may sharpen it, never widen it.

## Why this exists

`wf-before-propose-check` left a verified pre-proposal: 700–900 lines where every claim carried its authority. `opsx:propose` then compressed it into four artifacts at four different altitudes, in one pass, against templates that press for brevity — *"1–2 sentences on the problem"*. Compression is not a neutral operation. Four structural facts follow from it, and each is a defect class:

1. **Something was dropped, and the writer chose what.** A rule that never became a requirement, a surface that never became a task, a `§22` doc edit nobody carried. The pre-proposal was verified; anything missing downstream is a **regression against a checked document**, which is the cheapest possible thing to find and the most expensive to miss.
2. **The *how* has never been checked by anyone.** The pre-proposal's technical content came from the `.ai/` docs and was audited against them. `design.md` adds decisions those docs never carried — new indexes, new call shapes, new orderings — and the only reader they have ever had is the agent that wrote them.
3. **One document became four, so they can now disagree.** The same column is described in `proposal.md`, `design.md`, a spec delta and a task, written minutes apart at different altitudes. `opsx:apply` reads all four and silently picks one.
4. **"Decided" is not "buildable".** A requirement with no scenario proves nothing. A task with no verification clause is a description of intent. A backfill ordered before the migration it writes into fails halfway through, on the owner's machine, at the most expensive moment there is.

So the stance is adversarial toward the *artifacts*, never toward the owner: **read them as though a competent writer produced them in one pass from a document they read once, and believed every sentence.** Find the sentences that are not true, the ones that quietly left, and the ones that are true but unbuildable — then *fix them from the docs and the skills* rather than handing the owner a list.

**A departure is fine. A silent departure is the defect.** The change is allowed to make a better technical call than the pre-proposal, and even to depart from an ADR — [the OpenSpec design rules say so](../../../openspec/config.yaml), on one condition: *"say so explicitly and propose superseding it — never diverge silently."* Your job on a departure is not to reverse it. It is to make it visible, argued, and carried into `§22`'s doc edits.

## How light this is (MUST)

The owner deleted an earlier family of workflow skills for turning one-hour jobs into fifteen-hour sessions with adversarial pipelines and parallel auditors. This is the focused version: **one agent, one script, one pass.**

- **Do not convene a council, do not spawn a lens, do not run a refuter, do not review the review.**
- **Sub-agents: at most 4, in one wave, read-only, for repo lookups only** — "does this table/route/operation/helper exist" questions. Never to read a `.ai/` doc or a `pp-*` skill: their exact wording is what binds, and a summary drops the words the rules turn on. Under ~6 open lookups, do them inline instead.
- **One owner round, at most 3 questions.** More than that means the change is unsound rather than the docs silent — say so and stop.
- The change is ~1,500 lines and the pre-proposal ~900. That is one reading pass, not five. If a pass runs long, cut the least-load-bearing one and **say in the report which one you cut.** A short honest run beats a long thorough one nobody will authorize again.

## The fix ladder — what licenses a repair

Work down. Stop at the first rung that settles it.

| Rung | When | What you do |
| --- | --- | --- |
| **1 — a ratified doc or a binding skill settles it** | `.ai/` states the rule, or a `pp-*` skill's `Always`/`Never` does | Fix it. Cite the `doc.md#anchor` or the skill's rule and quote the binding wording verbatim. Event-handling correctness wins collisions ([tie-break](../../../AGENTS.md#decision-lens--evidence-over-claims-right-sized)) |
| **2 — the repo settles it** | the code is the fact | Fix it. Cite `file:line` |
| **3 — the pre-proposal settles it** | it was verified, and nothing above outranks it | Restore what was dropped, **or** — where the change made a deliberate better call — write the departure and its reason into `design.md` where it is currently silent |
| **4 — the decision lens settles it** | the docs are silent, the lens is not | Fix it. Name the clause and **write the argument into the artifact**, not just the report. Build cost and testability are the reasons that survive; [adopter or reviewer harm in the gap is not available](../../../AGENTS.md#decision-lens--evidence-over-claims-right-sized) |
| **5 — two lawful paths still stand** | both survive every rung above | Do not pick silently. Hold it for the owner round |
| **6 — an unverified Resend behaviour, or a legal or commercial unknown** | no research settles it | Do not decide. Record it under [`about.md` → Open questions](../../../.ai/about.md#open-questions) tagged `[Unverified]`, put it to the owner in the owner-decision round, and record it in `proposal.md`'s open-questions section |

**The hard stop: a repair that needs you to invent a fact — a price, a rate, a provider behaviour, a statute, a deadline, a build estimate — is rung 5 or 6, never rung 4.** Rung 4 rearranges known facts under a stated clause. It does not manufacture one.

**If you are rewriting rather than repairing, stop.** A `proposal.md` whose scope does not match the card at all, a `design.md` with no decisions, specs with no scenarios, or a `tasks.md` that is a list of headings — that is an authoring job. Say so, point at `opsx:propose`, and do not quietly become it.

## Reference docs

| Doc | Open when |
| --- | --- |
| [findings.md](references/findings.md) | Passes 2, 4 and 5 — the eight finding classes, each with its tell, what it costs at build time, and how it closes; plus the per-artifact conformance table |
| [tech-review.md](references/tech-review.md) | Pass 3 — how to review a design document against skills written to review a diff: the routing map, the `Never` lists that matter most, and the schema / backend / surfaces checklists |

Load [`pp-workflow`](../pp-workflow/SKILL.md) and [`pp-general`](../pp-general/SKILL.md) alongside this skill, always. Load every skill [pp-workflow's routing table](../pp-workflow/SKILL.md#which-skill-answers-a-code-question) names **for every surface the change touches** — that is not optional here, it is the whole of pass 3. [`wf-before-propose`'s doc-map](../wf-before-propose/references/doc-map.md) is the navigation aid for both the `.ai/` anchors and the repo reality-check recipes; use it rather than re-deriving them.

## Pipeline

| Pass | Costs | Produces |
| --- | --- | --- |
| **0 — Resolve** | seconds | the change, the pre-proposal, the card, and the repair-vs-reject verdict |
| **1 — Mechanical** | one script | every defect a machine can decide, plus four worklists for the reading |
| **2 — Fidelity** | the pre-proposal, read against the change | what was dropped, reworded, or silently redecided in compression |
| **3 — Technique** | the touched `pp-*` skills and the ADRs | the design that would produce a diff the gate rejects |
| **4 — Reality** | ≤4 read-only lookups | mechanisms that exist, actors who can reach them, and what landed since |
| **5 — Buildability** | one pass | every place `opsx:apply` would stop, guess, or build in the wrong order |
| **6 — Repair, ask, report** | one edit pass | fixed artifacts, `REVIEW.md`, at most one owner round, the ELI5 report |

### Pass 0 — Resolve

Find the change: the directory the user named, else the newest under `openspec/changes/` that is not `archive/`. No change at all is not a finding — it means `opsx:propose` has not run. Say so and stop.

Find the pre-proposal it was written from — `.ai/pre-proposals/<change-name>.md` by convention. **No pre-proposal is not a blocker**, but it removes the fidelity pass entirely and leaves the card as the only upstream; say that plainly in the report, because it is a materially thinner review.

Read the **whole card** in [`build-checklist.md`](../../../.ai/build-checklist.md) from the file, never from the proposal's quotation of it. Then make the rewrite-vs-repair call above, once, before spending anything.

### Pass 1 — Mechanical checks

```bash
node .agents/skills/wf-after-propose-check/scripts/check.mjs           # newest active change
node .agents/skills/wf-after-propose-check/scripts/check.mjs <change>  # or name one
```

It runs `openspec validate --strict` and then everything that tool does not: link targets and heading anchors across all four artifacts, `file:line` bounds, the `Ships` list diffed verbatim against the card in both directions, `D<n>` citations resolved against `design.md`, capability paths cross-checked three ways (the proposal's lists ↔ the delta files ↔ what `openspec/specs/` holds), requirement/scenario shape, endpoint paths that belong only in `api-contract.md`, operations `api-contract.md` has never heard of, pre-ticked task boxes, the `pnpm verify` gate's position, Ask-first flags against the triggers it can detect, the doc-update duties `pp-workflow` owes, unresolved markers, and a set of binding-pattern tripwires (Redis as the queue, state order taken from transport, business logic in a trigger, a database view as a contract, a `pgEnum`, a cascade onto the ledger, personal data with no PII answer).

It also builds **four worklists**, and this is where the expensive defects hide:

- **`coverage`** — what the pre-proposal named and the change does not carry: rules with no requirement, surfaces with no task, `§22` doc edits nobody scheduled, tables and operations that vanished. This is [A1](references/findings.md), and it is the highest-value list in the run.
- **`orphans`** — committed to in a spec or the data model and named in no task (work nobody will do), and named only in `tasks.md` (invented at the task layer, so no spec proves it).
- **`identifiers`** — every backticked name the source tree has never heard of, split into the ones *grafted onto something real* (`EmailProjection.lastEventAt`: the type exists, the field does not) and the ones wholly new, which are usually just what the change builds.
- **`freshness`** — what landed in the repo since the change was written. Every claim resting on those files is unverified again.

`BLOCK` items are wrong as written. `READ` items are for your judgement — the script is saying "this is the shape of a defect", not "this is one". **A clean run is not a buildable change.** It means the cheap defects are gone and the reading can start.

### Pass 2 — Fidelity: what did compression cost?

**Read all four artifacts first, in one pass, before checking anything** — then read the pre-proposal's `§7`, `§8`, `§10`, `§11`, `§12`, `§14`, `§20`, `§22` and `§23`, which are the sections the artifacts were written *from*. Do not sample either side. The contradiction across two files ([A4](references/findings.md)) is invisible to a reader who opened one, and the dropped rule is invisible to a reader who trusted the summary.

Three questions, in this order:

1. **What left?** Walk the `coverage` worklist item by item. For each, decide: covered by something that does not name it, deliberately dropped with a stated reason, or gone. Only the third is a finding — but it is the one that ships a slice missing a rule nobody notices until an adopter does.
2. **What changed meaning?** The `Ships` bullets are script-checked verbatim. Judge the rest: a MUST softened to "should", a gate condition rewritten from "not `active`" to "`pending` only", a decision restated with its teeth removed.
3. **What was redecided?** Every `D<n>` in `design.md` that the pre-proposal did not carry, and every one whose content moved. A new decision is not a defect — it is a decision **nothing has checked**, so give it the scrutiny the pre-proposal's got: what authority settles it, and what does it rule out?

### Pass 3 — Technique: would this design produce a diff the gate rejects?

This is the pass that has no upstream equivalent, and it is the reason this skill exists separately from `wf-before-propose-check`.

The `pp-*` skills are written to be read against a **diff**. Here there is no diff yet — so read the design as the diff it will become, and walk each touched skill's **`Never` list** and its gate's *"then read the diff"* checklist against it. Those lists are short, concrete and already prioritised; you are not inventing a review standard, you are applying one.

Open [tech-review.md](references/tech-review.md) for the routing map and the per-surface checklists. The shape of the finding is always the same: **the design commits to something a binding rule forbids, and nobody has noticed because the design reads as a plan rather than as code.** A projection patched incrementally instead of recomputed from the event set. A read-then-write where a constraint belongs. A Resend API call named inside a handler. A CLI command or MCP tool doing work the read API owns. A side effect fired inside the worker transaction. Each is a paragraph to fix here and a rewrite to fix at build time.

Then the ADRs: every architecture decision the change touches, whether it cites it or not. A departure must be **argued in `design.md` and carried as a `§22` doc edit**; a departure that is merely silent is [A2](references/findings.md), and it is the class that gets discovered at review with the code already written.

### Pass 4 — Reality: does the mechanism exist, and can the named actor reach it?

Two questions, not one.

**Does it exist?** Re-verify rather than trusting the proposal's audit table, using the [doc-map recipes](../wf-before-propose/references/doc-map.md#reality-check-recipes--what-the-repo-already-contains), and start from the script's `freshness` list — anything that landed after the change was written invalidates the claim resting on it. Widen the recipes to **migrations under `packages/db/`, simulator histories, and test fixtures**: a backfill that assumes every stored event has an `email_id` is wrong the moment two do not, and only the fixtures say so. Look for the partial that reads as done — a Drizzle table with no migration, a key with no unique constraint behind it, an operation with no `api-contract.md` entry.

**Can the actor reach it?** Take each thing the change says an application developer, on-call engineer, operator or AI agent does, and trace the path they walk. The failure shape is a capability that exists on the server and is unreachable from the CLI or the MCP server: a row whose id no endpoint returns, a token scope nothing checks, a status field no query sources, an operation with no CLI subcommand. The change will read as complete, because every piece is named — and the owner will not be able to walk the slice, which is the [MUST every finished slice owes](../../../AGENTS.md#decision-lens--evidence-over-claims-right-sized).

**Run the self-service test yourself rather than reading the proposal's answer.** Walk `deploy → connect the webhook → ingest → query → recover → tear down` for the stages this change touches and ask, at each step, *who running Ledger has to do something by hand for this to work?* An owner script, a database query to find a row id, a manual replay, an unbounded wait — each is a human on the adopter's path whether or not the proposal admits it.

### Pass 5 — Buildability: what would `opsx:apply` stop and ask?

`opsx:apply` implements tasks in order, pausing only at Ask-first gates. It does not re-derive decisions and it does not read the pre-proposal. So the test is concrete, per artifact:

| Artifact | The reader is | Which means |
| --- | --- | --- |
| `proposal.md` | someone deciding whether this is still the right change | Why, the scope verbatim, what is out with a trigger, the self-service answer, and the risks |
| `specs/<capability>/spec.md` | the test author, and every future reader of that capability | **Every requirement survives as behaviour with a WHEN/THEN scenario that could fail.** A requirement naming a class, a file or an endpoint is at the wrong altitude — rewrite it as behaviour |
| `design.md` | the builder, at 2am | Every decision with its authority and its rejected alternative, so nothing gets re-derived. A decision the builder would reverse is one that did not explain itself |
| `tasks.md` | the builder, in order | Each task independently verifiable **with the check stated in the task**, ordered so nothing depends on a later one, Ask-first flagged — citing, in the task, the owner's itemized pre-approval where one covers it exactly, since apply never reads the pre-proposal — doc duties present, `pnpm verify` last |

Then the ordering, which is the defect a reading pass catches and nothing else does: **a backfill before the expand migration it writes into, a contract step in the same deploy as its expand, a route before the handler it exposes, an SDK method or CLI command before the `api-contract.md` entry it implements.** An ordering constraint recorded only in prose is one that gets lost. Put it in the task, in order, with the reason inline.

[findings.md](references/findings.md) carries all eight classes.

### Pass 6 — Repair, ask, report

Edit the artifacts in place, applying the fix ladder. Rules:

- **Repair at the altitude of the artifact you are in.** A behaviour rule goes in the spec, its mechanism in `design.md`, its ordering in `tasks.md`. A fix pasted at the wrong altitude is a fix the next reader distrusts — and a spec that names a class is the specific way this goes wrong.
- **Fix every occurrence.** These are four files describing the same objects; a contradiction closed in one of them is a contradiction still.
- **No changelog.** These artifacts record what is currently true.
- **Do not edit any `.ai` doc.** Where a repair reveals a ratified doc is wrong, the fix becomes a **task** in `tasks.md`, so the change carries it at apply time.
- **Re-run the script after editing.** A repair that broke an anchor or a `D<n>` citation is the easiest defect in the world to introduce.

Then write **`REVIEW.md`** in the change directory — at most ~25 lines, current-state, no history of runs:

```markdown
# Review — <date>

**Verdict:** ready for `opsx:apply` · or · not ready — <what is open>
**Checked against:** the slice card · `.ai/pre-proposals/<file>.md` · <the pp-* skills loaded> · the repo at `<sha>`
**Repaired:** <n> (<one clause each, the load-bearing ones only>)

## Judgement calls the builder should know about
- <what you decided under rungs 1–4, and the one sentence that would change it>

## What this review could not confirm
- <the lookup that failed, the pass you cut, the thing only the owner or a professional can settle>
```

That last section is the point of the file: `opsx:apply` should know which claims were verified and which were taken on trust, because those are exactly the ones to stop on.

Then the owner round, only for rung-5 items, batched into one `AskUserQuestion` call. Prefer **one** option stated as a recommendation to confirm; offer a second only when it is genuinely live, and label your pick `(Recommended)` first. Each option carries what it means, what it costs, and how reversible it is. Apply the answers, mark them `owner-ruled <date>` in `design.md`, and re-run the script one last time.

## Report — ELI5, and short

The owner reads this at the end of a long day. Plain words, short sentences, paths and commands exact, no jargon that has to be decoded. Open by saying what changed on disk — **only the change artifacts**, no code and no `.ai/` edits — because that is the first thing they need to know.

Four tiers, and the middle two matter most:

```
**Ready to build.**  ·or·  **Not ready — <n> thing(s) for you to decide.**

Only files under `openspec/changes/<change>/` changed. No code, no `.ai/` doc edits — those are
tasks the change now carries.

I read all four files, the pre-proposal behind them, and checked them against the code and the
rules. <one line on what held up>. I found <n> real problems and fixed all of them.

The big ones (<n>)
- <plain sentence: what would have gone wrong at build time> → <what the fix is>  — <authority>

The rest (<n>)  ← a table once there are more than three
| # | Problem | Fix |

Worth your eyes (<n>, no action needed)
- <the judgement call you made, what you decided, and the one sentence that would change it>

Your call (<n>, ideally 0)
- <the question in one line>
  **My pick: <A>** — <what it means, what it costs>
  <B, only if genuinely live> — <what it means, what it costs>

What I could not check
- <the lookup that failed, the pass you cut, the thing only you know>

Ready. Run `opsx:apply` — it will pause at the <n> Ask-first task(s) the itemized pre-approval does not cover: <name them>.
```

**"Worth your eyes" is the tier that keeps this skill usable.** A judgement made under rungs 1–4 is settled and the owner is not being asked to re-decide it — but where it commits the product to something they might feel differently about, say what you decided, why you judged it fine, and what one sentence from them would change it. That is not a question; it costs them five seconds and nothing if they agree. Do not inflate it: a fix the docs plainly dictate belongs in the fixed list, not here.

Give the hand-off line **only when the change is actually ready** — no rung-5 items open, the script clean of `BLOCK`, every spec requirement carrying a scenario, and `tasks.md` ordered with `pnpm verify` last. Otherwise say plainly what is still open and what closes it, and name the Ask-first pauses either way so nothing about them is a surprise mid-build.

Do not paste the artifacts back. Do not start implementing — even if the original request said "build slice N". This skill ends at the verified change.
