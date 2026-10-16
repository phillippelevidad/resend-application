# Read order

Reading everything is as wrong as reading nothing. The `.ai/` corpus is a reference, not a
narrative: an agent that loads all of it reaches the code with no budget left for it. The chain
below is fixed; **the task shape sets how far down it you go**.

The canonical order is in [build-checklist.md → How to work this checklist](../../../../.ai/build-checklist.md#how-to-work-this-checklist),
and [openspec/config.yaml](../../../../openspec/config.yaml) injects the same order into every
artifact OpenSpec writes. This file is the procedure for applying it.

## The chain, and what each link answers

| # | Doc | Answers | Read |
| --- | --- | --- | --- |
| 1 | [`.ai/AGENTS.md`](../../../../.ai/AGENTS.md) | Which docs exist, which this task needs, the doc rules | Whole file: it is short and it is the router |
| 2 | [about.md](../../../../.ai/about.md) | Product, the scale ceiling, risk appetite, vocabulary, non-goals, open questions | Whole file on a first substantive task; afterwards only the sections the task touches |
| 3 | [architecture.md → Build order](../../../../.ai/architecture.md#build-order-vertical-slices) | Which slice this is, what precedes it, what it walks | The build-order section, [Reliability core](../../../../.ai/architecture.md#reliability-core) when event handling is touched, and **only** the ADRs the card cites |
| 4 | The card in [build-checklist.md](../../../../.ai/build-checklist.md) | Goal, `Ships`, UI surfaces, `Ops`, Deferred tail, `Status` | The one card |
| 5 | The card's `Refs` | The models, operations, facts and journeys that carry the slice | Each anchor, never the whole file it sits in |
| 6 | The pre-proposal in `.ai/pre-proposals/` | Every decision already settled for this slice | Whole file, when it exists |
| 7 | The OpenSpec change in `openspec/changes/slice-<id>-<kebab>/` | What is to be built, in what order | `proposal.md`, `design.md`, the delta specs and `tasks.md`, once proposed |

Outside the chain: root [`AGENTS.md`](../../../../AGENTS.md) is always loaded (wiring, Projects,
module boundaries, permissions). Do not re-read it as a step; consult its Projects table before
placing a new file. The Required docs the index names load by task: [resend.md](../../../../.ai/resend.md)
for any code touching webhooks or Resend's API, [aws.md](../../../../.ai/aws.md) for infra,
[data-modeling.md](../../../../.ai/data-modeling.md) for schema, [api-contract.md](../../../../.ai/api-contract.md)
for any public contract.

## Entry points by task shape

The chain is a prefix rule: read from 1 down to the task's depth, then stop.

| Task shape | Read through | Then load |
| --- | --- | --- |
| A question about product, scope or vocabulary | 2 | — |
| Picking or scoping the next slice | 4 | [slice-scoping.md](slice-scoping.md) |
| Proposing a slice | 6 | [`wf-before-propose`](../../wf-before-propose/SKILL.md) and the chain in [root AGENTS.md → Patterns and practices](../../../../AGENTS.md#patterns-and-practices) |
| Building a proposed slice | 7 | The skills the [routing table](../SKILL.md#which-skill-answers-a-code-question) names for each path in `tasks.md` |
| Reviewing a pre-proposal, a change or a diff | What the gate names | The `wf-*` gate, plus every pp-* skill for the surfaces it touches |
| A tweak too small for an OpenSpec change, from a plan file | 1, then the plan's own references | [`implement-plan`](../../implement-plan/SKILL.md); it routes to OpenSpec when the plan touches a `Ships` bullet, a public contract or a migration |
| A new or superseding ADR | 3, plus every ADR it touches and [decision-lens-suite.md](../../../../.ai/decision-lens-suite.md) | [`architecture-designer`](../../architecture-designer/SKILL.md); [architecture.md → Decisions](../../../../.ai/architecture.md#decisions) format and the decision lens win over its templates |
| A bug in behavior a doc already describes | 3, for the ADR that owns the behavior | The owning code-level skill |
| Editing an `.ai/` doc | 1 (its Rules), then the doc | [decision-lens-suite.md](../../../../.ai/decision-lens-suite.md) first when the edit touches the decision lens |

## Stopping rules

- **A link is a jump, not an obligation.** Follow a cross-reference when the task needs the rule
  behind it. A doc reached by two hops is usually one hop too far.
- **Stop reading when the next doc cannot change the diff.** [aws.md](../../../../.ai/aws.md) cannot
  change a `packages/core` projection; [features.md](../../../../.ai/features.md) is Optional and
  serves scoping, not a migration.
- **When docs disagree, the more specific one is not automatically right.** `.ai/` docs are current
  state, so a contradiction is a defect: correct the fact in the same change, or park the decision
  under [about.md → Open questions](../../../../.ai/about.md#open-questions) and stop.
- **Never as the rule:** [docs/idea.md](../../../../docs/idea.md) (frozen RFC, history only),
  `.ai/reviews/` (a historical record), `.ai/commands/` (never context unless asked for by name).
- **Read pp-* skills yourself.** A sub-agent's summary of a skill is not a read of it.
- **Never answer a versioned-API question from memory** — check what is installed
  ([pp-general → Check the installed version, not memory](../../pp-general/SKILL.md#check-the-installed-version-not-memory)).
