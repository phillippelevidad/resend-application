---
name: pp-workflow
description: Ledger's process discipline, end to end — the read order and where to stop, slice scoping and the in-scope test, the `pnpm verify` gate (the cheap checks for what was touched until slice 0 lands it), the doc duties every change owes, the test-tier policy, the Ask-first permission check, report honesty, and which pp-* skill answers a code question. Process only, no code rule; it links the rule in `.ai/` or root AGENTS.md instead of restating it. Load it alongside every `wf-*` gate, and before scoping, proposing, building or reviewing any slice of the build checklist — "start slice N", "is this in scope", "am I done", "can I tick this", "which test does this need", "which skill covers this". Load it before the code-level pp-* skills, not instead of them. When it and a linked doc disagree, the doc wins and this file is fixed.
---

# pp-workflow — how a Ledger change is scoped, built and closed

Start in the right place, finish before claiming done. The procedure and the gate are here; every
rule they apply lives in `.ai/` or root `AGENTS.md`.

**Owns:** read order · slice scoping · definition of done (gate, doc duties, permission check,
report) · test-tier policy · skill routing.
**Does not own any code-level rule.** Those are [pp-general](../pp-general/SKILL.md) and the path
skills ([Which skill answers a code question](#which-skill-answers-a-code-question)). Precedence:
[pp-general → Precedence](../pp-general/SKILL.md#precedence).

| Reference | Open when |
| --- | --- |
| [read-order.md](references/read-order.md) | Starting a non-trivial task: which docs, how far, where to stop |
| [slice-scoping.md](references/slice-scoping.md) | Picking a slice, exploding `Ships`, testing scope, or work stalls |
| [definition-of-done.md](references/definition-of-done.md) | About to claim done, tick a box, commit or report |

## Read order

[`.ai/AGENTS.md`](../../../.ai/AGENTS.md) → [about.md](../../../.ai/about.md) →
[architecture.md → Build order](../../../.ai/architecture.md#build-order-vertical-slices) → the slice
card in [build-checklist.md](../../../.ai/build-checklist.md#how-to-work-this-checklist) → its `Refs`
→ the pre-proposal in `.ai/pre-proposals/`, if one exists → the OpenSpec change, once proposed.
Load each `.ai/` doc the index marks Required for the task.

The chain is a prefix: the task shape sets how far down it you read (a slice, a tweak via
[`implement-plan`](../implement-plan/SKILL.md), an ADR via
[`architecture-designer`](../architecture-designer/SKILL.md), a review via a `wf-*` gate). **Stop
reading when the next doc cannot change the diff.** Entry points and stopping rules:
[read-order.md](references/read-order.md).

## Slice scoping

- The card's `Ships` list is the done-list, every bullet names its evidence, and a reworded bullet
  is a scope change ([How to work this checklist](../../../.ai/build-checklist.md#how-to-work-this-checklist)).
- v0 per slice, smallest PR; right-size to the ceiling; the self-service test runs, in writing, at
  scoping time ([decision lens](../../../AGENTS.md#decision-lens--evidence-over-claims-right-sized),
  [Guiding principles](../../../.ai/about.md#guiding-principles)).
- Tie-break: correctness of event handling (no loss, no duplicate effects, order-independent
  state) > evidence > cost > scope > polish.
- A candidate change is in scope only if the five-row in-scope test says so.
- A card blocked by an owner decision or an unverified fact is marked `[!]` on its `Status` line
  with a one-line reason ([Legend](../../../.ai/build-checklist.md#legend)); the question is parked,
  not resolved.

Procedure, the in-scope test and stall handling: [slice-scoping.md](references/slice-scoping.md).

## Definition of done

A change is done when `pnpm verify` exits 0 (every stage ran and passed, mirroring CI) and every
duty below that the change triggers is discharged in the same diff. Until slice 0 lands
`pnpm verify`, the cheap checks for what was touched stand in (lint, the affected tests,
`openspec validate --strict` when `openspec/` was touched), and the report names which ran.

| If the change… | It must also contain |
| --- | --- |
| Adds or changes an operation, route, error code, CLI command or flag, public environment variable, or MCP tool | The [api-contract.md](../../../.ai/api-contract.md) entry, and the owner's Ask-first approval ([Conventions](../../../.ai/api-contract.md#conventions)) |
| Lands a table in the schema and a migration | The ticked `Modeled` box in [data-modeling.md → Model index](../../../.ai/data-modeling.md#model-index) |
| Adds, removes or repurposes a project folder | The [root AGENTS.md → Projects](../../../AGENTS.md#projects) table |
| Lands a command | Its line in [root AGENTS.md → Commands](../../../AGENTS.md#commands) |
| Completes or advances a slice | The card's `Status` line and `Ships` boxes, updated in place ([Legend](../../../.ai/build-checklist.md#legend)) |
| Ships a slice | `WALKTHROUGH.md` in the change folder before `Status` is ticked ([build-checklist](../../../.ai/build-checklist.md#how-to-work-this-checklist)) |
| Lands the evidence for a row of [What this project must demonstrate](../../../.ai/about.md#what-this-project-must-demonstrate) | That row's evidence column, linked |
| Ratifies or contradicts a decision | The `.ai/` doc corrected, or an ADR added or superseded, in the same change ([root AGENTS.md](../../../AGENTS.md#product--domain-context)) |
| Leaves a question unresolved | An [about.md → Open questions](../../../.ai/about.md#open-questions) entry tagged `[Unverified]`, and the card marked `[!]` with a one-line reason |
| Settles an `RS-UNN`, `AWS-UNN` or `PG-UNN` row | That row updated in [resend.md](../../../.ai/resend.md#unverified), [aws.md](../../../.ai/aws.md#unverified) or [integrations.md](../../../.ai/integrations.md#unverified) |
| Relies on a Resend behavior | The `RS-NN` fact it rests on, cited ([resend.md](../../../.ai/resend.md)) |
| Introduces an environment variable | A public one ([Conventions](../../../.ai/api-contract.md#conventions)): its `.env.example` line (names only, never values). An internal, CDK-set one: `infra` only, never `.env.example` ([pp-infra](../pp-infra/SKILL.md)). Either: a boot-time assertion if it is required ([pp-general](../pp-general/SKILL.md)) |
| Touches a mandatory-tier surface | An integration test against real Postgres, or the named test for the other Mandatory rows ([Test tiers](#test-tiers)) |
| Introduces a code-level convention no doc owns | The owning pp-* skill updated in the same change ([routing](#which-skill-answers-a-code-question)) |

**Permission check.** Every Ask-first item the change crosses is named, and the owner approved it
([Permissions](../../../AGENTS.md#permissions)); an unapproved one waits uncommitted.
**Report honesty.** Name the command and its actual outcome; a skipped stage is reported as
skipped, with why. Do not hedge a verified result, and do not upgrade an unverified one.
Mechanics: [definition-of-done.md](references/definition-of-done.md).

## Test tiers

**The tier is the deciding test, not the author's judgement.** A claim's kind fixes the evidence
that proves it; a lower tier does not count. Harness, file naming, arbitraries and invariant code:
[pp-testing](../pp-testing/SKILL.md).

| Claim | Proven by |
| --- | --- |
| Pure `packages/core` logic: projections, masks, reaction rules | Unit and fast-check property tests, no I/O ([ADR-003](../../../.ai/architecture.md#adr-003--projection-is-a-pure-function-of-the-event-set)) |
| What the database enforces, and paths that commit through it | Integration tests against real Postgres (Testcontainers) |
| Behavior under duplicates, reordering, bursts, outages | A [simulator invariant](../../../.ai/architecture.md#simulator-invariants), by number |
| A latency, throughput or cost number | A measured run and the command behind it |

**Mandatory (MUST).** A change touching one of these is not done without its test:

- **Integration against real Postgres:** idempotency on `svix_id` and the outbox `dedupe_key` (a
  duplicate delivery leaves one row and one effect), order-independent projections, outbox
  delivery, reconcile and replay, the Postgres side of DLQ redrive (a redriven message under a new
  SQS `messageId` leaves one row, AWS-21; local mode's redrive, slice 2B), migrations, and auth
  boundaries (token scopes) (ADR-004, ADR-006, ADR-007, ADR-008, ADR-018 in
  [Decisions](../../../.ai/architecture.md#decisions)).
- **SQS redrive:** the `packages/aws` adapter tested against its port contract, plus the slice 3
  poison run (simulator invariant 4)
  ([pp-testing → DLQ redrive](../pp-testing/references/fakes-and-doubles.md#dlq-redrive)).
- **Verify before enqueue:** a forged, stale or unsigned request never reaches the queue port, and
  `200` follows only a successful enqueue ([ADR-001](../../../.ai/architecture.md#adr-001--verify-then-enqueue)).
- **PII masking in MCP output:** every tool's actual output carries masks only
  ([slice 5](../../../.ai/build-checklist.md#5--mcp-server-and-contract-hardening)).

Coverage is never a goal. A regression test names the bug it locks down. Assert the consequence
(the row, the effect, the response), not the call. A mocked database client never counts as the
integration tier.

## Which skill answers a code question

Load every row that matches, alongside this skill. Until a skill exists, use the `.ai/` doc it
would link; never invent a convention.

| Question or path | Skill |
| --- | --- |
| Any TypeScript: naming, imports, tsconfig, boundaries, errors, logging, PII in code, config and env, versions, adding things | [pp-general](../pp-general/SKILL.md), always, plus the path's skill |
| `packages/db/**`, a table, column, index, constraint, `jsonb`, migration or seed | [pp-database](../pp-database/SKILL.md) |
| `packages/sdk/**`, handlers, ports, projections, outbox, reconcile, redrive, the rest of `packages/**` and `apps/**` | [pp-backend](../pp-backend/SKILL.md) |
| `apps/cli/**` | [pp-cli](../pp-cli/SKILL.md) |
| `apps/mcp/**` | [pp-mcp](../pp-mcp/SKILL.md) |
| `infra/**`, deploy, teardown, budget alarms | [pp-infra](../pp-infra/SKILL.md) |
| `*.test.ts`, `sim/**`, a harness, an arbitrary, an invariant | [pp-testing](../pp-testing/SKILL.md) |
| Scope, done, which tier, Ask-first | This skill |

## Always

- Follow the [read order](#read-order) before non-trivial work, and load the skills the
  [routing table](#which-skill-answers-a-code-question) names before writing code.
- Verify Resend behavior against its docs and cite the page; what the docs don't settle goes to
  Open questions as `[Unverified]` ([lens](../../../AGENTS.md#decision-lens--evidence-over-claims-right-sized)).
- Run the gate and report its actual result before claiming done ([Definition of done](#definition-of-done)).
- Commit and push each finished step, staged by path; helper agents run no git command
  ([root AGENTS.md](../../../AGENTS.md#commit-and-push-as-you-go), [`wf-commit`](../wf-commit/SKILL.md)).
- Edit `.ai/` docs in their house style: tight, RFC 2119, current state only
  ([`.ai/AGENTS.md` → Rules](../../../.ai/AGENTS.md#rules)).
- Use the [domain vocabulary](../../../.ai/about.md#domain-vocabulary) in docs, specs and tasks.

## Never

- **A reliability claim without its evidence** → link the test, property or invariant, or move the
  claim to Open questions ([lens](../../../AGENTS.md#decision-lens--evidence-over-claims-right-sized)).
- **An operation that appears nowhere in `.ai/api-contract.md`** → name it there first, with its
  surfaces, scope and errors, get the Ask-first approval, then implement against it
  ([Conventions](../../../.ai/api-contract.md#conventions)).
- **An Ask-first change made alone** (a dependency, a pushed migration, CI, a public contract, an AWS
  resource or deploy, a write to a live Resend account) → leave it uncommitted and ask
  ([Permissions](../../../AGENTS.md#permissions)).
- **A failing gate disabled to make CI green** → fix the cause, or stop and report the failure with
  its output ([Permissions](../../../AGENTS.md#permissions)).
- **Done claimed on an unrun, partial or failing gate** → say what ran, what passed and what is
  open ([definition-of-done.md](references/definition-of-done.md#4--report)).
- **A secret, API key, signing secret, real recipient address or `.env*` file in a commit** → Resend's
  test addresses (`delivered@resend.dev`); `.env.example`, names only ([Permissions](../../../AGENTS.md#permissions)).
- **Building ahead of the active slice**, or folding in a Deferred-tail item → leave it where it is
  documented ([in-scope test](references/slice-scoping.md#3--the-in-scope-test)).
- **Resolving an open question inside a doc or in code** → park it in
  [Open questions](../../../.ai/about.md#open-questions), mark the card `[!]`; the owner ratifies.
- **Re-litigating an accepted ADR** → write a superseding ADR ([architecture.md → Decisions](../../../.ai/architecture.md#decisions)).
- **A categorical deferral built quietly** (SQS FIFO, a second database, multi-tenant) → a
  superseding ADR ([Deferred (YAGNI)](../../../.ai/architecture.md#deferred-yagni)).
- **Citing [docs/idea.md](../../../docs/idea.md) as the current rule** → cite the ratified `.ai/` doc
  that carries it; the RFC is frozen history.

## Gate — then read the diff

`pnpm verify` exits 0 with every stage run ([Definition of done](#definition-of-done)); until slice 0
lands it, the cheap checks for what was touched, each named in the report. Then read the diff:

Each `Ships` bullet the change advances has its named evidence in the diff (the test, property,
invariant run, measured number or command) · every duty row the diff triggers is discharged in the
same diff · no Ask-first item lands unapproved (a new `package.json` dependency, an edited pushed
migration, `.github/**`, a public-contract change, an AWS resource, a live Resend write) · every
operation the diff names is in `.ai/api-contract.md` · every mandatory-tier surface touched has its
[test](#test-tiers) · no reliability claim in a doc or the README lacks a pointer to its evidence · no
`docs/idea.md` link cited as the rule · no `[x]` over an unticked `Ships` box and no marker in a
heading · staged by path: no scratch file, and no `.env*` but `.env.example` (`git ls-files`).
