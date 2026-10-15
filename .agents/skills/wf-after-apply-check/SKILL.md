---
name: wf-after-apply-check
description: Adversarially verifies the code `opsx:apply` actually wrote — first against the change it was built from, then against the ratified `.ai/` docs, then hunting correctness bugs and security holes in the diff itself. The last gate before a slice is called done and archived, and the first one in the chain that reads code rather than documents, so it asks what no document review could — does the code behind each ticked box do what the task said, does anything the docs still claim remain true, and would this diff survive a hostile reader? It runs `pnpm verify` and reports its actual result, re-verifies every claim the pre-apply review could not confirm, walks the slice's `WALKTHROUGH.md` against the code, and reconciles every divergence by deciding which side is wrong — repairing the code where a doc or a binding `pp-*` rule settles it, correcting the doc where the implementation made the better call, one commit per fix so any one can be reverted alone. It fixes autonomously to the limit of what the ratified docs and the decision lens settle, and puts only a genuine owner decision at the end. Load this immediately after `opsx:apply` finishes and before `opsx:archive`, and whenever the user asks to verify, check, audit, review or sanity-check an implementation, a slice, a build or a diff ("verify the implementation", "is slice N actually done", "check the code against the proposal", "did apply build what we asked", "review what was built", "audit the slice", "hunt for bugs in what we just shipped", "security check this slice", "is this ready to archive", "did we miss anything"), or names a change under `openspec/changes/` with any doubt about its code attached. Load it too when `pnpm verify` is green and nobody has read the diff, when a slice is about to be ticked in the build-checklist, or when `opsx:archive` is invoked on a change this gate never ran against. It owns the verification, the repair and the done-or-not verdict; it never implements an unbuilt task, never archives the change, and never ratifies a new decision into `.ai/`.
---

# wf-after-apply-check — the first gate that reads code

**Owns:** verifying the diff against the change, the ratified `.ai/` docs and the binding `pp-*` skills · the correctness and security hunt over the diff · the `pnpm verify` gate and its honest result · repairing what those settle, one commit per fix · the doc duties the change owes · `VERIFICATION.md` · the owner round · the done-or-not verdict.

**Does not own:** implementing a task nobody built (→ `opsx:apply`) · verifying the change artifacts before code exists (→ [`wf-after-propose-check`](../wf-after-propose-check/SKILL.md), which already ran) · archiving (→ `opsx:archive`) · ratifying a new or superseding decision into `.ai/` (→ [`wf-open-question`](../wf-open-question/SKILL.md) mode 3) · writing the code-level rules (→ the [`pp-*` skills](../../../AGENTS.md#patterns-and-practices), which this skill only enforces).

**Precedence:** a ratified `.ai/` decision and a binding `pp-*` rule both outrank anything the change or the code says, and [`pp-money`](../pp-money/SKILL.md) wins wherever it collides with `pp-backend` or `pp-database`. The [decision lens](../../../AGENTS.md#decision-lens--evidence-over-claims-right-sized) and the [risk appetite](../../../.ai/about.md#risk-appetite) outrank this skill's own reasoning. The slice card's `Ships` list is still the scope contract — repairs may complete it, never widen it.

## Why this exists

Three gates already ran, and all three read **documents**. This one reads **code**, which diverges from its plan in ways no document review can predict. Four structural facts, each a defect class:

1. **A ticked box is a claim, not evidence.** `opsx:apply` ticks the task it just worked on. Nothing between that tick and the archive checks that the code behind it does what the task said — and the ticks accumulate fastest exactly where the builder was most tired.
2. **`pnpm verify` green is the floor, not the ceiling.** Exit 0 proves the suite that *exists* passes. It cannot see a requirement nobody wrote a test for, a screen state nobody wrote at all, an outbox `dedupe_key` that is present but not unique, a `.ai` doc that now lies, or a flow the owner cannot walk. Every one of those ships green.
3. **A divergence is not automatically a defect — a *silent* one always is.** The plan was written by someone who had not seen the code. Sometimes the implementation is simply right and the plan was wrong. That is allowed. What is not allowed is that nothing records it, because the next slice reads the plan and the docs, never the diff.
4. **This is the last moment anything is cheap.** After `opsx:archive` the change artifacts stop being read and `.ai/` becomes the only memory. A doc that lies here lies forever, and slice N+1 is built on it.

So the stance is adversarial toward the **diff**, never toward the owner: read it as though a competent builder wrote 25,000 lines in one pass, from a plan they read once, believed every sentence of, and never opened again after task 3. Find the code that does not do what its task claimed, the docs that quietly became false, the bug that no test was ever going to catch, and the line a hostile caller would enjoy — then **fix them** rather than hand the owner a list.

## How light this is (MUST)

The owner deleted an earlier family of workflow skills for turning one-hour jobs into fifteen-hour sessions. This one is bounded by its inputs, not by its ambition:

- **Do not convene a council, do not spawn a lens, do not run a refuter, do not review the review.**
- **Helper readers: at most 4, in one wave, read-only, split by *surface* — never by pass.** A surface split reads the diff once; a pass split reads it four times. Each helper gets one section of [diff-review.md](references/diff-review.md) and returns findings with `file:line`. Under ~800 changed lines, read it yourself and spawn none.
- **Never send a helper to read a `.ai/` doc or a `pp-*` skill.** Their exact wording is what binds, and a summary drops the words the rules turn on. Helpers read *code*.
- **A helper finding is a lead, not a fact.** Open the `file:line` yourself before you act on it. A confident wrong finding that becomes a commit is worse than the bug it invented.
- **One owner round, at most 3 decisions**, plus one grouped Ask-first approval if the repairs need one. More than that means the implementation is unsound rather than the docs silent — say so and stop.
- If a pass runs long, cut the least-load-bearing one and **say in the report which one you cut.** A short honest run beats a long thorough one nobody will authorize again.

## The fix ladder — which side is wrong

Every finding here is a **divergence between two things that were supposed to agree**: the code, the change artifacts, and the ratified docs. The first question is never "how do I fix this" — it is **which of them is wrong**. Work down; stop at the first rung that settles it.

| Rung | When | What you do |
| --- | --- | --- |
| **1 — the code is wrong** | a ratified `.ai/` doc, a binding `pp-*` `Always`/`Never`, a spec delta's scenario, or plain correctness settles it | Fix the code. Cite the `doc.md#anchor` or the skill's rule, quoted verbatim, or the `file:line` that proves the bug. One commit |
| **2 — the plan was wrong and the code is right** | the implementation made the better call and the repo or a binding rule proves it | Keep the code. Write the departure and its reason into `design.md`, and correct `tasks.md` / the spec delta so they describe what exists. **Never leave it silent** |
| **3 — a ratified doc now contradicts working code** | rung 1 or 2 settled which is right, and a `.ai/` doc says otherwise | Correct the doc — but only the **duties this change owes** (status and `Ships` boxes, the `Modeled` index, `api-contract.md`, `views.md`, a folder tree, `.env.example`) or a plain factual correction. A *decision* changing is rung 5 |
| **4 — the decision lens settles it** | the docs are silent, the lens is not | Fix it. Name the clause and **write the argument into the artifact**, not just the report. Build cost and testability are the reasons that survive; [integrator harm in the gap is not available](../../../AGENTS.md#decision-lens--evidence-over-claims-right-sized) |
| **5 — two lawful paths still stand, or the repair is Ask-first** | both survive every rung above, or the fix is a DB schema change, a new dependency, a CI change or a public-contract change | Do not pick silently and do not commit. Prepare the fix, hold it for the owner round |
| **6 — a legal, fiscal or commercial unknown** | no research settles it | Do not decide. Route it to [`wf-open-question`](../wf-open-question/SKILL.md) and record it in [about.md → Open questions](../../../.ai/about.md#open-questions) as a task, not an edit |

**Three hard stops, and none of them bend:**

- **Never disable, skip, or loosen a gate to make it green.** That is the [`Never` tier](../../../AGENTS.md#permissions) — no approval path exists. A failing stage *is* the finding.
- **Never invent a fact** to justify a repair — a price, a rate, a provider behaviour, a statute, a build estimate. That is rung 5 or 6, never rung 4.
- **Never edit an applied migration** ([`pp-database` → Never](../pp-database/SKILL.md)); a schema fix is a new forward migration, and it is Ask-first.

**If you are implementing rather than repairing, stop.** Unticked tasks, a whole group with no code behind it, or a slice whose UI surfaces do not exist is an *apply* job. Say so, point at `opsx:apply`, and do not quietly become it.

## Committing the repairs

**One commit per fix.** The owner reviews this diff after the fact, and a commit that carries one decision can be read in thirty seconds and reverted with `git revert <sha>` without taking four other fixes with it. Bundling is the thing that makes an autonomous repair pass unreviewable.

- The message describes **the change only** — no trailer, no `Co-Authored-By`, no agent or model credit ([Commit messages](../../../AGENTS.md#commit-messages)).
- Multi-line messages go through a **file**: write it, then `git commit -F <file>`. The default shell here is PowerShell while the Bash tool is Git Bash, and an inline here-string reaches `git` as literal `@` lines.
- Edit source files with the **Edit/Write tools**, never `sed`, heredocs or inline Python ([Editing files](../../../AGENTS.md#editing-files-on-this-machine)) — quoting failures on this machine have written a literal `NUL` byte into a `.ts` file.
- **Push after every commit** ([Commit and push as you go](../../../AGENTS.md#commit-and-push-as-you-go)) — a repair pass that dies mid-run must not take its finished fixes with it.
- Record the sha of every commit as you go. The **fix table** in the report is built from them and it is the owner's whole review surface.
- Doc-only repairs still get their own commit, for the same reason.

## Reference docs

| Doc | Open when |
| --- | --- |
| [findings.md](references/findings.md) | Passes 2, 3 and 5 — the seven finding classes, each with its tell, what it costs after archive, and how it closes; plus the doc-duty ledger |
| [diff-review.md](references/diff-review.md) | Pass 4 — the per-surface correctness and security checklists, and the brief to hand each helper reader verbatim |

Load [`pp-workflow`](../pp-workflow/SKILL.md) and [`pp-general`](../pp-general/SKILL.md) alongside this skill, always. Load the task-relevant `pp-*` skills **for every surface the diff touches** — that is not optional, it is what pass 4 checks against. [`wf-before-propose`'s doc-map](../wf-before-propose/references/doc-map.md) is the navigation aid for the `.ai/` anchors; use it rather than re-deriving them.

## Pipeline

| Pass | Costs | Produces |
| --- | --- | --- |
| **0 — Resolve** | seconds | the change, the diff range, the gate running in the background, and the verify-vs-implement verdict |
| **1 — Mechanical** | one script | every defect a machine can decide, plus five worklists for the reading |
| **2 — Fidelity to the change** | the four artifacts, read against the diff | ticked boxes with nothing behind them, and departures nobody wrote down |
| **3 — Fidelity to `.ai/`** | the ratified docs, read against what shipped | the docs that now lie, and the duties nobody discharged |
| **4 — The diff itself** | ≤4 helpers, one wave | correctness and security findings, each with `file:line` |
| **5 — The walk** | `WALKTHROUGH.md` read against the code | the slice the owner cannot actually walk |
| **6 — Repair, ask, report** | one commit per fix | fixed tree, a green gate, `VERIFICATION.md`, the fix table, at most one owner round |

### Pass 0 — Resolve, and start the gate

Find the change: the directory the user named, else the newest under `openspec/changes/` that is not `archive/`. No change at all means `opsx:propose` never ran — say so and stop.

Establish the **diff range**, because everything downstream is scoped by it: `git merge-base main HEAD`, unless the user names a base. Confirm it with `git diff --stat <base>...HEAD` and say the number out loud in the report — a reviewer who does not know what was read cannot judge what was missed.

**Read nothing that was generated.** A lock file, the emitted OpenAPI document, `packages/api-client/`, build output and binary assets are the *shadow* of a decision taken somewhere else, and reading them spends the budget the files carrying decisions need. The script excludes them from every worklist — but it counts them, because their presence or absence answers duty questions the reading cannot ([diff-review.md → What not to read](references/diff-review.md#what-not-to-read)).

**Start `pnpm verify` in the background now.** It needs Docker and it is the slowest thing in the run, so it should be burning wall-clock while you read rather than after. If Docker is not up, say so plainly and treat the gate as **not run** — [exit 0 with every stage run is the only definition of done](../pp-workflow/references/definition-of-done.md), and a partial run is not a lesser pass, it is no pass.

Then read the **whole slice card** in [`build-checklist.md`](../../../.ai/build-checklist.md) from the file, and the change's `REVIEW.md` if it has one — its *"What this review could not confirm"* section is a worklist written specifically for this gate, by the last reader who had the whole change in their head. Finally make the verify-vs-implement call above, once, before spending anything.

### Pass 1 — Mechanical checks

```bash
node .agents/skills/wf-after-apply-check/scripts/check.mjs                    # newest active change, vs main
node .agents/skills/wf-after-apply-check/scripts/check.mjs <change> --base <ref>
```

It runs `openspec validate --strict` and then everything that tool cannot: unticked tasks, every backticked identifier the change promised that the tree does not contain, the doc duties `pp-workflow` owes checked one by one against the actual files, generated-artifact coupling (a contract change with no regenerated client, a `schema.prisma` change with no migration), and a set of tripwire greps over **added lines only** — a client-supplied `tenant_id`, raw unparameterised SQL, a new table with no RLS, `GRANT ALL`, a hardcoded secret shape, `process.env` in a client component, float arithmetic on money, a suppressed type error, a skipped test, PII in a log, and stray `TODO`/`NUL`/scratch residue.

It also builds **five worklists**, and this is where the expensive defects hide:

- **`unbuilt`** — identifiers the change committed to that the source tree has never heard of. The inverse of the pre-apply check, and the single highest-value list in this run: it is the shape of a ticked box with nothing behind it.
- **`undeclared`** — files in the diff that no task names. Either scope crept or a task's text is wrong; both matter.
- **`duties`** — each doc obligation with its verdict, so the ones that are genuinely discharged stop costing you reading.
- **`unconfirmed`** — the bullets `REVIEW.md` said it could not confirm, lifted verbatim. Every one of them is now checkable.
- **`surfaces`** — the diff bucketed into schema / backend / frontend / tests-docs, with line counts. This is the split you hand the helpers in pass 4.

`BLOCK` items are wrong as written. `READ` items are for your judgement — the script says "this is the shape of a defect", not "this is one". **A clean run is not a finished slice.** It means the cheap defects are gone and the reading can start.

### Pass 2 — Fidelity: did the code do what the change said?

Read the four artifacts, then read the diff against them. Three questions, in this order:

1. **Is there code behind every ticked box?** Walk `tasks.md` top to bottom against the `unbuilt` worklist. For each task, find the code and read the **verification clause the task states about itself** — "verify a duplicate `svix_id` leaves exactly one `outbox` row" is a claim with a test behind it or it is nothing. A box ticked over an absent verification is [B1](references/findings.md), and it is the defect this whole gate exists for.
2. **Does every spec requirement have something that would fail if it broke?** Each `### Requirement:` with its `#### Scenario:` is a test that should exist. A requirement with no test is not a requirement, it is a hope — and the change is green with the behaviour absent.
3. **What did the builder decide that the plan did not?** Every divergence between `design.md` and the code. Classify with the fix ladder: the code is wrong (rung 1), or the plan was (rung 2, and the plan gets corrected). Both are fine outcomes; **neither may stay silent**, because the next slice reads the plan.

### Pass 3 — Fidelity to `.ai/`: is anything the docs still claim now false?

The change artifacts are archived and forgotten; `.ai/` is the memory. This pass is what keeps it true.

Two directions, and both matter:

**Do the docs still describe the system?** Take every `.ai/` statement the slice touched — the model sections, the ADRs, `api-contract.md`'s operation entries, `views.md`'s screen rows, the vocabulary in `about.md` — and check it against the code that now exists. A doc that describes an earlier plan is [B3](references/findings.md), the most expensive class in this file, because it is invisible and it compounds.

**Were the duties discharged?** The `duties` worklist gives you the mechanical verdict; you judge the substance. [findings.md](references/findings.md) carries the full ledger, but the ones routinely missed are the `Modeled` checkbox, an `api-contract.md` entry whose *scope or transition* changed rather than its name, and the project `AGENTS.md` folder tree after a new folder appeared.

Then run the **self-service test** yourself rather than reading the proposal's answer: walk `deploy → point the Resend webhook → ingest → query → recover → tear down` for the stages this slice touches, and at each step ask *who has to do something by hand for this to work?* A fallback the code introduced but the deferred tail does not name is scope that quietly left the plan.

### Pass 4 — The diff itself: bugs, then a hostile reader

This is the pass with no upstream equivalent, and it is the reason this skill reads code at all.

Open [diff-review.md](references/diff-review.md). Split the diff by the script's `surfaces` worklist, hand each helper **one surface and that doc's section for it**, verbatim, and run them in one wave. Each returns findings as `file:line` · what breaks · which rule or which input · the cheapest fix. Then **open every one yourself before acting on it.**

Two lenses per surface, and they are not the same lens:

- **Correctness** asks *what input makes this wrong?* The recurring shapes here are read-then-write races, a missing transaction boundary, an outbox row outside its transaction, a handler that is not idempotent under at-least-once delivery, an off-by-one in a cap, a null the type system was told could not happen, a screen state nobody wrote, and state that started depending on arrival order somewhere in the middle.
- **Security** asks *what would a hostile caller do with this?* And in this codebase the first question is always **verification at the edge** — nothing unverified reaches the queue — and every other class is downstream of it. Then authorization before the command runs, a client-supplied value trusted, PII in a log or a URL, a secret in the tree, an unvalidated input, and a storage path or object id that belongs to somebody else.

The finding that matters most is the one `pnpm verify` structurally cannot see: **a policy that exists but permits, a guard that runs but checks the wrong thing, a test that asserts the happy path only.** Those pass every stage and they are exactly what this pass is for.

### Pass 5 — The walk: can the owner actually use this?

[`WALKTHROUGH.md`](../../../.ai/build-checklist.md#how-to-work-this-checklist) is the slice's own acceptance script, and this is the last chance to find out it does not work. Read it against the code, step by step:

- **Does each step's mechanism exist and connect?** The URL is routed, the button calls the action, the action reaches the command, the command returns what the screen renders, the seed row the step names is in `seed.sql`. The failure shape is a capability that exists on the server and is unreachable from the screen.
- **Does the copy on the step match the copy in the code?** A walkthrough quoting a user-facing string the code does not contain means one of them moved, and the owner will find out mid-walk.
- **Does every step that cannot be completed today name the slice that carries it, inline?** That rule has teeth: an unwalkable step with no destination *is* the slice not being done, and `pnpm verify` cannot see it.
- **Does every role on the card's `UI surfaces` line have a path?** A claimed flow no role can reach is [a finding against this slice](../../../.ai/build-checklist.md#how-to-work-this-checklist), not a note for a later one.

Where the walkthrough is wrong and the code is right, fix the walkthrough. Where the code cannot support the walk, that is a rung-1 code fix — or, if it is real unbuilt scope, the slice is not done and you say so.

### Pass 6 — Repair, ask, report

Apply the fix ladder, one commit per fix, per [Committing the repairs](#committing-the-repairs). Rules:

- **Fix at the layer that owns the rule.** A business rule goes in `packages/core`, never in the CLI, the MCP server or a handler. A copy fix goes where the string lives. A behaviour that changed goes in the spec delta *and* the code.
- **Fix every occurrence.** Many files describe the same objects; a contradiction closed in one is a contradiction still.
- **A repair that needs a schema change, a new dependency, a CI change or a contract change is Ask-first.** Prepare it — write the migration, stage the edit — and hold it for the owner round. Do not commit it.
- **Re-run the script after editing**, and **re-run `pnpm verify` after the last code commit.** A repair pass that ends without a green gate has not ended.

Then write **`VERIFICATION.md`** in the change directory — at most ~30 lines, current-state, no history of runs:

```markdown
# Verification — <date>

**Verdict:** done, ready for `opsx:archive` · or · not done — <what is open>
**Gate:** `pnpm verify` exit 0, every stage run · or · <the stage that failed, or why it did not run>
**Read:** `<base>...<head>` — <n> files, <n> lines · the four change artifacts · <the .ai docs checked> · <the pp-* skills loaded>
**Fixed:** <n>, one commit each — <sha list>

## Judgement calls the owner should know about
- <what you decided under rungs 1–4, and the one sentence that would change it>

## What this verification could not confirm
- <the thing only a browser, the owner, or a professional can settle>
```

That last section is the point of the file: `opsx:archive` and slice N+1 should know which claims were verified and which were taken on trust.

Then the owner round, only for rung-5 items, batched into one `AskUserQuestion` call. Prefer **one** option stated as a recommendation to confirm; offer a second only when it is genuinely live, and label your pick `(Recommended)` first. Each option carries what it means, what it costs, and how reversible it is. Apply the answers, commit them the same way, and re-run the gate.

## Report — ELI5, and short

The owner reads this at the end of a long day. Plain words, short sentences, paths and commands exact. Open with the gate result and what you changed on disk, because those are the two facts everything else depends on.

**The fix table is the centrepiece.** Every autonomous repair, one row, with its sha — that table is the entire review surface for work the owner did not watch, and `git revert <sha>` per row is what makes trusting it cheap.

```
**Done.**  ·or·  **Not done — <n> thing(s) open.**

`pnpm verify` — exit 0, every stage ran.  ·or·  <what failed, in one line>

I read `<base>...HEAD` — <n> files, <n> lines — plus the four change files and the .ai docs
behind them. I found <n> real problems and fixed <n>. Each fix is its own commit.

What I changed (<n> commits, one per fix)
| # | Commit | What was wrong | What I did | Why I was allowed to |
|---|--------|----------------|------------|----------------------|
| 1 | `abc1234` | <plain sentence> | <plain sentence> | <the rule, doc or line> |
Revert any single one with `git revert <sha>`.

The big ones (<n>)
- <plain sentence: what would have gone wrong, and for whom> → <what the fix is>

Worth your eyes (<n>, no action needed)
- <the judgement call you made, and the one sentence from you that would change it>

Your call (<n>, ideally 0)
- <the question in one line>
  **My pick: <A>** — <what it means, what it costs>
  <B, only if genuinely live> — <what it means, what it costs>

What I could not check
- <the browser step, the failed lookup, the pass you cut, the thing only you know>

Done. Run `opsx:archive`.  ·or·  <what is still open and what closes it>
```

**"Worth your eyes" is the tier that keeps this skill usable.** A judgement made under rungs 1–4 is settled and the owner is not being asked to re-decide it — but where it commits the product to something they might feel differently about, say what you decided, why you judged it fine, and what one sentence would change it. Do not inflate it: a fix the docs plainly dictate belongs in the table, not here.

Give the archive hand-off **only when the slice is actually done** — the gate green with every stage run, no unticked task, no rung-5 item open, the doc duties discharged, and the walkthrough walkable end to end. Otherwise say plainly what is open and what closes it.

Do not paste the diff back. Do not archive the change — that is `opsx:archive`, and it is the owner's call to make once they have read the table.
