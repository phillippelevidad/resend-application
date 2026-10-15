---
name: wf-before-propose
description: Assembles a decision-complete pre-proposal for one build-checklist slice into `.ai/pre-proposals/` — the brief `opsx:propose` reads instead of asking questions. It resolves the slice card, harvests the ADRs, models, operations, surfaces and rules that carry it, audits every `Ships` bullet against what the repo already contains, surfaces the contradictions the ratified docs hold, decides everything the docs and the decision lens determine, and asks the owner only what genuinely survives — one batched round, one recommended pick. Load this whenever the user names a slice before proposing ("slice 3", "slice 2B", "prep the next slice", "pre-proposal for X", "get ready to propose", "before propose", "what does slice N need", "what's missing for the next slice"), whenever an OpenSpec change is about to be created for a checklist slice, and whenever `opsx:propose` starts asking questions the `.ai/` docs already answer — that is the signal this skill was skipped. It owns the pre-proposal document and the question gate; it never creates the OpenSpec change, never edits ratified `.ai/` docs, and never writes code.
---

# wf-before-propose — spend the time here, so the proposal never has to ask

**Owns:** slice resolution · the doc harvest · the reality check against the repo · the contradiction sweep · the question gate · the pre-proposal document and its write gate.

**Does not own:** creating the OpenSpec change (→ `opsx:propose`, run after this) · implementing it (→ `opsx:apply`) · editing the ratified `.ai/` docs (→ the change itself at apply time, recorded under §22 Docs to update) · any code-level rule (→ the [`pp-*` skills](../../../AGENTS.md#patterns-and-practices)).

**Precedence:** a ratified `.ai/` decision outranks anything derived here. The [decision lens](../../../AGENTS.md#decision-lens--evidence-over-claims-right-sized) and the [risk appetite](../../../.ai/about.md#risk-appetite) outrank this skill's own reasoning. The slice card's `Ships` list **is** the scope contract — this skill may explode it, never widen it.

## Why this exists

`opsx:propose` is written for projects with no ratified documentation, so its default move on an ambiguity is to ask the user. Here that is almost always wrong: the answer is in [`.ai/`](../../../.ai/AGENTS.md), and a question usually means the doc was not opened. But those docs run to thousands of lines across several files, and they occasionally contradict each other — an ADR that states two mutually exclusive dedupe keys in one sentence (say, `svix_id` and `(email_id, type)`) is found mid-flight, and it stops the slice at its migration.

So the failure this skill prevents is not "the proposal asked a question" — it is **finding the contradiction after the schema is written.** Front-load the reading, front-load the owner's rulings, and hand `opsx:propose` a document where everything it must write is already decided.

## Reference docs — open both, they are the working material

| Doc | Open when |
| --- | --- |
| [doc-map.md](references/doc-map.md) | Phases 1–3 — which `.ai/` anchor holds which fact, the `Slices:` index trick, and the repo reality-check recipes |
| [template.md](references/template.md) | Phase 5 — the pre-proposal's sections, what each must carry, and the write gate |

Load [`pp-workflow`](../pp-workflow/SKILL.md) alongside this skill (read order, slice scoping, definition of done). Load [`pp-database`](../pp-database/SKILL.md) and [`pp-backend`](../pp-backend/SKILL.md) **when the slice touches their surface** — their wording is what the pre-proposal's rules must be consistent with. Where they collide, the [decision lens tie-break](../../../AGENTS.md#decision-lens--evidence-over-claims-right-sized) settles it: correctness of event handling (no loss, no duplicate effects, order-independent state) outranks everything else.

## Output

`.ai/pre-proposals/<YYYY-MM-DD>-<change-name>.md` — create the folder if it is missing.

`<change-name>` is kebab-case and matches what the OpenSpec change will be called, so the two line up: `slice-<n>-<card title kebabbed>` — e.g. `2026-11-02-slice-4-recovery.md`, `2026-11-14-slice-2b-local-mode-queue.md`. Check [`openspec/changes/archive/`](../../../openspec/changes/) for the naming already in use.

These documents are permanent and never deleted. Re-running on the same slice **the same day rewrites the file in place**; on a later day it writes a new dated file whose metadata block links the earlier one and says in one line what changed. One slice per document — the change name maps 1:1, and a document covering two slices cannot be handed to `opsx:propose`.

## Pipeline

| Phase | Produces |
| --- | --- |
| **0 — Resolve** | the slice card, its status and dependencies, the change name, the output path |
| **1 — Harvest** | every binding clause the slice rests on, quoted, each carrying its `doc.md#anchor` |
| **2 — Reality check** | a per-`Ships`-item verdict against the repo: absent · partial (`file:line`) · already done |
| **3 — Contradiction sweep** | every place the ratified docs disagree with each other or with the code |
| **4 — Decide, then ask** | decisions with their authority; at most one batched owner round |
| **5 — Write** | the pre-proposal document |
| **6 — Write gate** | the completeness checks, reported to the user, and the hand-off line |

### Phase 0 — Resolve the slice

Find the card in [`build-checklist.md`](../../../.ai/build-checklist.md): headings are `### <N> — <Title>` and are deliberately marker-free, so the status lives on the card's first bullet. Read the **whole** card — `Status`, `Goal`, `Depends on`, `Refs`, `Ships`, `UI surfaces`, `Ops`, `Deferred tail`.

- `[x]` — already done. Stop and ask whether this is a re-spec before writing anything.
- `[!]` — blocked. The one-line reason usually points at an [open question](../../../.ai/about.md#open-questions); the owner settles it in the owner-decision round, not this skill. Say so and stop.
- `Depends on` naming a slice that is not `[x]` — the owner may still proceed on a parallel track, but record it under **Prerequisites** as a stated risk rather than silently assuming it lands.
- The user named something with no card — there is no scope contract. Say so plainly, then either work the nearest card or proceed with the scope stated in the conversation, recorded in the document as exactly that.

### Phase 1 — Harvest the binding clauses

Follow the read order in [pp-workflow](../pp-workflow/SKILL.md#read-order), then use [doc-map.md](references/doc-map.md) to go **anchor by anchor** — reading these files end to end burns the context the later phases need, and index rows are summaries that never substitute for the section they link.

Two rules make the harvest usable:

- **Quote binding wording verbatim.** RFC-2119 clauses are what the proposal turns on, and a paraphrase silently drops the word the rule rests on. Every claim in the final document carries the `doc.md#anchor` it came from.
- **Never delegate reading the `.ai/` docs or a `pp-*` skill to a sub-agent.** A summary loses exactly the wording that binds. Sub-agents are for read-only repo lookups in phase 2 — one wave, capped, and only when the slice is large enough that inline reading would crowd out the writing.

The navigation trick that saves the most time: [`api-contract.md`](../../../.ai/api-contract.md) entries each carry a `- **Slices:**` line, so grepping the slice number yields every operation the slice owes without reading the file whole. The card's `UI surfaces` line names the endpoints, CLI commands and MCP tools that expose them.

### Phase 2 — Reality check against the repo

`opsx:propose` writes confident prose about a repo it has not read — "add table X" when X exists, "new capability" when `openspec/specs/` already holds it. Give it the truth up front. Per [doc-map.md](references/doc-map.md)'s recipes, check the Drizzle schema, the migrations, `openspec/specs/`, the `packages/` and `apps/` folders, and the surfaces (read API, CLI, MCP).

Produce one verdict per `Ships` bullet: **absent** · **partial** (with `file:line` and what is missing) · **already done** (with the evidence, and a note that the bullet needs ticking rather than building). This table is what stops the change re-building what an earlier slice already shipped.

### Phase 3 — Contradiction sweep

Read the harvest against itself. The pairs that reliably disagree: the card's `Ships` vs. the model section's field table; an ADR's prose vs. its own constraint; [`api-contract.md`](../../../.ai/api-contract.md)'s `Slices:` assignment vs. the card's scope; the card's `UI surfaces` line vs. the operations, CLI commands and MCP tools that exist to serve it; the docs vs. what the code already does.

Every contradiction becomes either a **resolution** (one reading is plainly right — say which, and why) or a **question** for phase 4. A contradiction found here costs a paragraph; the same one found at migration time costs the slice.

### Phase 4 — Decide what the docs decide, ask only what survives

This is the gate the whole skill exists for. For each gap, in order:

1. **Search before asking.** Name the anchors you checked. A question you cannot pair with "I read these sections and they are silent" is a question you have not earned.
2. **If the docs determine it, decide it.** Record the decision with the anchor that authorizes it. Never ask the owner to confirm what is already ratified — that is the noise this skill exists to remove.
3. **If the docs are silent but the [decision lens](../../../AGENTS.md#decision-lens--evidence-over-claims-right-sized) determines it, decide it.** Apply the lens in writing: the cost brake, the self-service test, reversible-cheap over optimal-expensive, and the temporal-vs-categorical split in `Deferred (YAGNI)`. Name the clause you used. The lens forbids arguing from adopter or reviewer harm in the gap between slices — build cost and testability are the reasons that survive.
4. **If two lawful paths still stand, ask** — via `AskUserQuestion`, every question in one batched round. Each option carries what it means, its cost and reversibility, and the doc or lens clause behind it. Put the recommendation first with `(Recommended)` in its label; the second option exists so the owner can see what was rejected, not to manufacture a choice.
5. **If it is an unknown no research settles — Resend behaviour the docs leave open, or a legal or commercial question — do not decide it.** Record it under [`about.md → Open questions`](../../../.ai/about.md#open-questions) tagged `[Unverified]` and put it to the owner in the owner-decision round. Name it, say whether the slice is blocked on it or a named later slice carries it, and move on.

**More than four surviving questions for one slice means the harvest was shallow, not that the docs are silent.** Go back to phase 1 before asking. Two rounds is the ceiling, and the second exists only for a follow-up that a first answer opened.

An owner ruling that contradicts a ratified `.ai/` doc does not license editing that doc here — record it under **Docs to update** so the change carries the edit at apply time.

### Phase 5 — Write the document

Follow [template.md](references/template.md). Its one structural rule: **a section that does not apply is written as `Not touched — <why>`, never dropped.** Absence proved is worth a line; absence forgotten is the defect that reaches the migration.

### Phase 6 — Write gate

Run the checks in [template.md](references/template.md), including the literal grep for unresolved markers, and report the actual result. Then hand off in one line:

> Drafted. Run [`wf-before-propose-check`](../wf-before-propose-check/SKILL.md) against `.ai/pre-proposals/<file>.md` before `opsx:propose` — this document is one long pass by one agent, and the gate is what verifies it against the docs and the code.

The write gate is this skill checking its own work, which is exactly why it is not the last word. `wf-before-propose-check` reads the document cold, and the defects it finds — a paraphrased MUST, a mechanism no actor can reach, a reality check written before the last commit — are the ones a self-check structurally cannot see.

Do not create the change, do not scaffold artifacts, do not start implementing — even if the original request said "build slice N". This skill ends at the document.
