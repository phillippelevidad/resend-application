---
name: wf-before-propose-check
description: Adversarially reviews the pre-proposal `wf-before-propose` wrote, before `opsx:propose` reads it — verifying every anchor, quote and `file:line` against the ratified `.ai/` docs and the repo as it stands today, checking every `Ships` bullet for drift, and closing every contradiction and leftover ambiguity that would make the proposal ask a question or write something false. It repairs what the docs, the repo or the decision lens settle, and puts only a genuine owner decision at the end, with one recommended pick. Load this immediately after `wf-before-propose`, and whenever the user asks to check, review, audit, verify or sanity-check a pre-proposal ("check the pre-proposal", "review the doc before propose", "is this ready for propose", "did wf-before-propose miss anything", "audit `.ai/pre-proposals/…`"), or names a file under `.ai/pre-proposals/` with any doubt attached. Load it too when `opsx:propose` starts asking questions about a slice that already has a pre-proposal — that means this gate never ran, or ran and did not hold. It owns the verification and the repair; it never creates the OpenSpec change, never authors a missing pre-proposal from scratch, and never edits ratified `.ai/` docs.
---

# wf-before-propose-check — assume the document is confidently wrong, then prove where

**Owns:** verifying the pre-proposal against the ratified `.ai/` docs and the repo · repairing what the docs, the repo or the decision lens settle · the owner-decision round · the ready-for-propose verdict.

**Does not own:** authoring a missing pre-proposal (→ [`wf-before-propose`](../wf-before-propose/SKILL.md)) · creating the OpenSpec change (→ `opsx:propose`) · verifying the change once it exists (→ [`wf-after-propose-check`](../wf-after-propose-check/SKILL.md)) · implementing it (→ `opsx:apply`) · editing ratified `.ai/` docs (→ [`wf-open-question`](../wf-open-question/SKILL.md) mode 3) · any code-level rule (→ the [`pp-*` skills](../../../AGENTS.md#patterns-and-practices)).

**Precedence:** a ratified `.ai/` decision outranks anything the pre-proposal says. The [decision lens](../../../AGENTS.md#decision-lens--evidence-over-claims-right-sized) and the [risk appetite](../../../.ai/about.md#risk-appetite) outrank this skill's own reasoning. The slice card's `Ships` list is still the scope contract — repairs may sharpen it, never widen it.

## Why this exists

`wf-before-propose` front-loads a great deal of reading into one long pass, and the failures it produces are the failures of any long pass: an anchor half-remembered, a quote paraphrased into something the doc does not quite say, a reality check written before the last commit landed, a decision recorded with an authority that does not authorize it. None of those look wrong. They read as confident prose, which is exactly why `opsx:propose` will build on them without hesitating — and then the defect surfaces at the migration, where it costs the slice.

Three priors, each of which has already happened in a real run of this workflow:

1. **The authority that does not say that.** An ADR stated two mutually exclusive dedupe keys in one sentence, and slice 2 found it after the schema was written.
2. **The ruling nobody made.** Slice 2 carried seven `RULED` markers written by the drafting agent on top of its own recommendations, and five `.ai/` rewrites were made citing them. The owner later overturned one. A ruling from a question round settles build shape; a legal or fiscal duty is settled only by a `.human/` brief.
3. **Confident prose about unread code.** The reality check is the cure for it, and is itself written by an agent that may have grepped for the wrong string.

So the stance here is adversarial toward the *document*, never toward the owner: **read it as though someone competent wrote it in a hurry and believed every sentence.** Your job is to find the sentences that are not true, and then — this is the part that makes the skill worth running — to *fix them from the docs* rather than hand the owner a list.

## How light this is (MUST)

The owner deleted an earlier family of workflow skills for turning one-hour jobs into fifteen-hour sessions with adversarial pipelines and parallel auditors. This is the focused version: **one agent, one script, one pass.**

- **Do not convene a council, do not spawn a lens, do not run a refuter, do not review the review.**
- **Sub-agents: at most 4, in one wave, read-only, for repo lookups only** — "does this table/route/operation exist" questions. Never to read a `.ai/` doc or a `pp-*` skill: their exact wording is what binds, and a summary drops it. Under ~6 open lookups, do them inline instead.
- **One owner round, at most 3 questions.** More than that means the pre-proposal is unsound, not that the docs are silent — say so and stop.
- If a pass is running long, cut the least-load-bearing pass and **say in the report which one you cut.** A short honest run beats a long thorough one nobody will authorize again.

## The fix ladder — what licenses a repair

Work down. Stop at the first rung that settles it.

| Rung | When | What you do |
| --- | --- | --- |
| **1 — a ratified doc settles it** | `.ai/` states the rule | Fix it. Cite the `doc.md#anchor` and quote the binding wording verbatim |
| **2 — the repo settles it** | the code is the fact | Fix it. Cite `file:line` |
| **3 — the decision lens settles it** | the docs are silent, the lens is not | Fix it. Name the clause and **write the argument in the doc**, not just in the report. Build cost and testability are the reasons that survive; [integrator harm in the gap is not available](../../../AGENTS.md#decision-lens--evidence-over-claims-right-sized) |
| **4 — two lawful paths still stand** | both survive the lens | Do not pick silently. Hold it for the owner round |
| **5 — a legal, fiscal or commercial unknown** | no research settles it | Do not decide. Route it to [`wf-open-question`](../wf-open-question/SKILL.md) and record it in §25 |

**The hard stop: a repair that needs you to invent a fact — a price, a rate, a provider behaviour, a statute, a deadline, a build estimate — is rung 4 or 5, never rung 3.** Rung 3 rearranges known facts under a stated clause. It does not manufacture one.

**If you are rewriting rather than repairing, stop.** More than a third of the sections missing, a §2 that does not match the card at all, or no reality check worth the name means this is an authoring job. Say so, point at `wf-before-propose`, and do not quietly become it.

## Reference doc

| Doc | Open when |
| --- | --- |
| [findings.md](references/findings.md) | Passes 2–4 — the eight finding classes, each with its tell, what it costs downstream, and how it is closed; plus the per-section conformance table |

Load [`pp-workflow`](../pp-workflow/SKILL.md) alongside this skill. Load the task-relevant `pp-*` skills **when the slice touches their surface** — their wording is what the document's rules must be consistent with, and `pp-money` wins wherever it collides with `pp-backend` or `pp-database`. [`wf-before-propose`'s doc-map](../wf-before-propose/references/doc-map.md) is the navigation aid for both the `.ai/` anchors and the repo reality-check recipes; use it rather than re-deriving them.

## Pipeline

| Pass | Costs | Produces |
| --- | --- | --- |
| **0 — Resolve** | seconds | the document, the slice card, and the rewrite-vs-repair verdict |
| **1 — Mechanical** | one script | every defect a machine can decide: links, anchors, `file:line`, `Ships` drift, cross-references, capability verdicts, residue |
| **2 — Authority** | the bulk of the reading | every quote and every anchor checked against what the doc actually says |
| **3 — Reality** | ≤4 read-only lookups | the reality check re-verified against the repo as it stands today |
| **4 — Readiness** | one pass | every ambiguity `opsx:propose` would stop and ask about |
| **5 — Repair, ask, report** | one edit pass | the fixed document, at most one owner round, the ELI5 report |

### Pass 0 — Resolve

Find the document: the path the user named, else the newest file in `.ai/pre-proposals/`. No document at all is not a finding — it means `wf-before-propose` has not run. Say so and stop.

Read the metadata block for the slice id, then read the **whole card** in [`build-checklist.md`](../../../.ai/build-checklist.md). The card is the scope contract and every later pass compares against it, so read it from the file, never from the pre-proposal's quotation of it — a quotation that drifted is precisely what pass 1 is looking for.

Then make the rewrite-vs-repair call above, once, before spending anything.

### Pass 1 — Mechanical checks

```bash
node .agents/skills/wf-before-propose-check/scripts/check.mjs .ai/pre-proposals/<file>.md
```

Run it against the document **in place** — every path resolves relative to the file, so a copy elsewhere reports its whole link set as broken.

It decides only what is decidable: link targets and heading anchors, `file:line` bounds, the `Ships` list diffed verbatim against the card, `D<n>` / `X<n>` / `rule <n>` cross-references, `ADDED` vs `MODIFIED` against what `openspec/specs/` actually holds, unresolved markers attributed to their section, missing sections, decisions with no authority line, and `owner-ruled` claims on legal or fiscal subjects.

It also builds **two worklists for the reading passes**, and these are where the expensive defects hide:

- **`identifiers`** — every backticked identifier the source tree has never heard of, split into the ones *grafted onto something real* (`WebhookEvent.replayedAt`: the type exists, the field does not — [F1](references/findings.md)) and the ones wholly new, which are usually just what the slice builds. Walk the first list item by item.
- **`cross-section`** — every object described in three or more of §8–§15, which is exactly where the document contradicts itself ([F3](references/findings.md)). Compare the descriptions; they must agree.

`BLOCK` items are wrong as written. `READ` items are for your judgement — the script is saying "this is the shape of a defect", not "this is one". **A clean run is not a clean document.** It means the cheap defects are gone and the expensive reading can start.

### Pass 2 — Authority

**Read the whole document first, in one pass, before checking anything.** Do not sample. The defects that cost the slice are in the section nobody thought to look at, and the cross-section contradictions ([F3](references/findings.md)) are invisible to a reader who only opened four sections. A pre-proposal runs 700–900 lines; reading it is cheap next to what it authorizes.

Then check the claims. The script proves an anchor *resolves*; only reading proves it **says what the document claims it says.** Expect a paraphrase that softened a MUST, an ADR cited for a rule stated in a *different* ADR, and a "the docs are silent here" that is not. §7, §8, §14 and §15 carry the most weight — they become schema and spec requirements — but every section gets read.

### Pass 3 — Reality: does the mechanism exist, and can the named actor reach it?

This is the pass that finds the expensive defects, and it asks **two** questions, not one.

**Does it exist?** Re-run the reality check rather than trusting §5, using the [doc-map recipes](../wf-before-propose/references/doc-map.md#reality-check-recipes--what-the-repo-already-contains), and check git for anything that landed after the document was written. Widen the recipes to **`seed.sql`, migrations, and test fixtures** — a backfill that assumes every seeded `email_state` row has a `webhook_events` row is wrong the moment two seeded rows do not, and only the seed file says so. Look for the partial that reads as done: a Drizzle table with no migration, a migration missing the unique key idempotency rests on, an operation with no OpenAPI declaration.

**Can the actor reach it?** Take each thing the document says an integrator, the owner or an agent over MCP does, and trace the path they walk. The failure shape is a capability that exists on the server and is unreachable from the surface: a row whose id no endpoint returns, a token scope nothing grants, a status field no query sources, a command no CLI flag or MCP tool exposes. The document will read as complete, because every piece is named — and the owner will not be able to walk the slice, which is the [MUST every finished slice owes](../../../AGENTS.md#decision-lens--evidence-over-claims-right-sized).

An "already done" verdict that is wrong makes the change skip real work. An "absent" verdict that is wrong makes it rebuild something and collide. A "reachable" that is wrong ships a flow nobody can complete.

### Pass 4 — Readiness for `opsx:propose`

`opsx:propose` asks the owner when it meets ambiguity affecting **scope, externally observable behaviour, compatibility, or acceptance criteria.** That is not a vague standard — it is a checklist, and it is the actual definition of "ready" here. Walk the document against those four and ask, in each case, *could a competent implementer read this and stop?*

The concrete test, per artifact `opsx:propose` must write:

| It writes | From | Which means |
| --- | --- | --- |
| `proposal.md` | §1, §2, §3, §24 | Why, the scope verbatim, what is out, and the risks |
| `specs/<capability>/spec.md` | §14, §23 | **Every rule in §14 must survive being written as `### Requirement:` with `#### Scenario:` WHEN/THEN blocks.** A rule that cannot produce a scenario is not yet a requirement — sharpen it |
| `design.md` | §7, §8, §9, §10, §11, §15, §19 | Decisions with authority, and a reader who never has to re-derive one |
| `tasks.md` | §23's task groups, §20, §21 | Ordered, independently verifiable, Ask-first flagged, `pnpm verify` last |

Then §12's four required states per view, §17's PII answer, and §21's one path per role.

**Run §19's self-service test yourself rather than reading the document's answer.** It is the sharpest detector in the repo and the document grades its own homework: walk `discover → sign up → live → operate → get paid → leave` for the stages this slice touches and ask, at each step, *who on the owner's side has to do something for this to work?* An owner script, a database query to find a row id, a manual publish, an unbounded wait — each is a human on the integrator's path, and each is the lens's admitted-fallback case whether or not §19 admits it. The cheapest removal usually already exists: a read that loads the row anyway can return its id, and a route that exists needs only a button.

[findings.md](references/findings.md) carries all eight classes.

### Pass 5 — Repair, ask, report

Edit the document in place, applying the fix ladder. Rules:

- **Repair in the house voice** — tight, RFC-2119 where a rule is stated, every claim carrying its authority. A repair that reads as a patch is a repair the next reader will distrust.
- **No changelog.** Update the metadata block's **`Checked`** row in place — one line: date, and `N repaired, M for the owner`. Add the row if it is missing. Do not append a history of runs; these docs record what is currently true.
- **Do not edit any `.ai/` doc.** Where a repair reveals that a ratified doc is wrong, the fix goes in **§22 Docs to update** so the change carries it at apply time.
- **Re-run the script after editing.** A repair that broke an anchor or a cross-reference is the easiest defect in the world to introduce.

Then the owner round, only for rung-4 items, batched into one `AskUserQuestion` call. Prefer **one** option stated as a recommendation the owner confirms; offer a second only when it is genuinely live, and label your pick `(Recommended)` first. Each option carries what it means, what it costs, and how reversible it is. Apply the answers, mark them `owner-ruled <date>` in §7, and re-run the script one last time.

## Report — ELI5, and short

The owner reads this at the end of a long day. Plain words, short sentences, paths and commands exact, no jargon that has to be decoded. Open by saying what changed on disk — **only the pre-proposal**, no code and no `.ai/` edits — because that is the first thing they need to know.

Three tiers, and the middle one matters most:

```
**Ready.**  ·or·  **Not ready — <n> thing(s) for you to decide.**

Only `.ai/pre-proposals/<file>.md` changed. No code, no `.ai/` doc edits — those are §22 work the change owes at apply time.

I read the whole doc and checked it against the code and the `.ai/` docs. <one line on what held up>. I found <n> real problems and fixed all of them.

The big ones (<n>)
- <plain sentence: what would have gone wrong> → <what the fix is>  — <authority>

The rest (<n>)  ← a table once there are more than three
| # | Problem | Fix |

Worth your eyes (<n>, no action needed)
- <the judgement call you made, what you decided, and the one sentence that would change it>

Your call (<n>, ideally 0)
- <the question in one line>
  **My pick: <A>** — <what it means, what it costs>
  <B, only if genuinely live> — <what it means, what it costs>

What I could not check
- <the lookup that failed, the pass you cut, the thing only the owner knows>

Ready. Run `opsx:propose` and point it at `.ai/pre-proposals/<file>.md` as the source of scope, decisions and specs.
```

**"Worth your eyes" is the tier that keeps this skill usable.** A judgement you made under rung 1–3 is settled and the owner is not being asked to re-decide it — but where it commits the product to something they might feel differently about, say what you decided, why you judged it fine, and what one sentence from them would change it. That is not a question; it costs them five seconds and nothing if they agree. Do not inflate it: a fix the docs plainly dictate belongs in the fixed list, not here.

Give the hand-off line **only when the document is actually ready** — no rung-4 items open, the script clean of `BLOCK`, and §25 holding owner ops only. Otherwise say plainly what is still open and what closes it.

Do not paste the document back. Do not create the change, scaffold artifacts, or start implementing — even if the original request said "build slice N". This skill ends at the verified document.
