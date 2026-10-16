---
name: implement-plan
description: >-
  Implements and verifies a small change from a plan file — a tweak too small
  for an OpenSpec change — by delegating the work to subagents, then gates it on
  `pnpm verify` exiting 0 (the cheap checks for what was touched until slice 0
  lands `pnpm verify`). Use when the owner asks to implement, execute or verify
  a plan file (.plan.md, _step-*.md, or an equivalent YAML-frontmatter plan).
  Never for a build-checklist slice, a public contract change or a migration —
  those go through opsx:propose, opsx:apply and wf-after-apply-check.
---

# Implement Plan

## When this skill applies

The owner's path for **small tweaks too small for an OpenSpec change**: a fix, a refactor, a doc or
tooling change with a plan file behind it. It sits beside the slice workflow, not in place of it.

**Stop and route to OpenSpec** (`wf-before-propose` → `opsx:propose` → `opsx:apply` →
`wf-after-apply-check`) when the plan:

- ships or advances a `Ships` bullet of a slice in [build-checklist.md](../../../.ai/build-checklist.md);
- adds or changes a public contract (an operation, route, error code, CLI command or flag, MCP tool —
  [api-contract.md](../../../.ai/api-contract.md));
- adds a table or a migration, or changes a pushed one.

Say which bullet triggered the stop, and do nothing else.

**Load alongside:** [`pp-workflow`](../pp-workflow/SKILL.md) always; [`pp-general`](../pp-general/SKILL.md)
whenever the plan touches TypeScript; and every skill
[pp-workflow → Which skill answers a code question](../pp-workflow/SKILL.md#which-skill-answers-a-code-question)
names for the paths the plan touches. Their duties and `Never` lists bind every implementer and
verifier prompt. Ask-first changes ([root AGENTS.md → Permissions](../../../AGENTS.md#permissions))
stop for the owner's approval even inside an approved plan.

## Orchestrator mandate (non-negotiable)

When this skill is active, you are an **orchestrator only**. You coordinate end-to-end execution; you
do not do the work.

### You MUST delegate to subagents

Every substantive action runs in a **fresh subagent** (the Agent or Task tool, whichever the host
offers):

- implementation (code, docs, scripts, config, tests)
- exploration of unfamiliar code areas
- scoped test commands and the **verify gate**
- plan-compliance and quality audits

Prefer many narrow subagents over one large mixed-context session.

### You MUST NOT execute yourself

Do **not** use your own tools for:

- editing source, config, docs or tests
- running shell commands (tests, scripts, builds, formatters, the verify gate)
- performing the plan audit or claiming PASS/FAIL from your own inspection
- combining implementation and verification in one turn

### What the orchestrator may do directly

- Read the plan file (and the plan or docs it references) to build an execution map
- Launch, batch and monitor subagents; decide parallel vs serial waves
- Update plan frontmatter todo `status` only after a verifier PASS for that todo
- Commit and push ([Commits](#commits))
- Summarize rounds, evidence, blockers and completion for the owner

If you catch yourself about to edit a file or run a command, **stop** and delegate.

---

## Inputs

The owner invokes this skill with a prompt like:

> Use the implement-plan skill on `<path-to-plan.md>`

The plan file comes from a planning mode (Cursor Plan Mode, Claude Code plan mode) or an equivalent
workflow. It is the single source of truth for scope, approach and acceptance.

### Expected plan format

#### Frontmatter

```yaml
---
name: "Short plan title"
overview: "One-line description (may be quoted if it contains colons)"
todos:
  - id: tighten-mask-helper # semantic slug OR UUID — both are valid
    content: "Task description"
    status: pending | in-progress | completed | error
isProject: false
---
```

Use the plan's `id` strings exactly when assigning and reporting work. On intake, schedule only todos
with `status: pending` or `error`, unless the owner asks to redo `completed` work or re-verify the
whole plan.

A plan with no frontmatter todos is valid: derive the todos from its numbered steps or headings, and
report the derived list before the first wave.

#### Body (often larger than the todo list)

The body is usually the authoritative spec. Common sections (any subset may appear):

| Section pattern | Role for orchestration |
| --- | --- |
| Goal / overview | Acceptance intent; tie-breaker when a todo line is terse |
| **Out of scope** / **not recommended** | Hard boundaries; implementers must not expand scope |
| **Phase A / B / C** (or numbered steps) | Sequencing within or across todos; may override naive parallelization |
| Design decisions / tables | Constraints implementers must follow |
| **Files to touch** / **Files to add** | Scope checklist for the verifier |
| Mermaid / flowcharts | Context only, not a work item unless a todo says so |
| SQL, grep queries, CLI commands | Operator-run, script-run or automated; classify per todo (below) |
| **Verification** / **done** with `- [ ]` checklists | Acceptance criteria; the verifier evaluates them line by line |
| **After deploy** / operational next steps | Owner work; never delegated as implementation |
| Links to other plan or doc files | Load them when a todo or phase depends on them |

Read the full plan (and referenced files the body depends on) before delegating. Extract:

1. **Todos** — the primary split axis (`pending` / `error` only by default)
2. **Body requirements** — phases, tables, snippets and file lists the todos only summarize
3. **Verification** — verify todos **plus** body checklists, matrices and "done when" prose
4. **Work type** per todo (table below)
5. **Shared output paths** — todos that update the same file are serialized or given one owner

### Work types (classify every todo before delegating)

| Type | Examples in the plan body | Delegate to |
| --- | --- | --- |
| **Code** | New modules, wiring, refactors | read-write implementer |
| **Docs** | `.ai/` doc fixes, README sections, runbook notes | read-write implementer |
| **Script / tooling** | Scripts under `scripts/`, Biome or Vitest config | read-write implementer |
| **Automated verify** | Targeted unit, property or integration tests named in the plan | shell or implementer; **scoped and time-bounded** ([Scoped verification](#scoped-verification)) |
| **Local execute** | `pnpm sim`, a script with env vars, git-ignored artifacts | shell or implementer if the inputs exist; else report **blocked** with the exact command |
| **Operator / owner** | A deploy, an AWS resource, a write to a live Resend account, dashboard actions, wait windows | **Never** an implementer's scope. Ask-first ([Permissions](../../../AGENTS.md#permissions)); the verifier accepts it only with recorded evidence or the owner's sign-off |

If a todo mixes types, split it into sub-steps in the implementer prompt or serialize subagents.

### Mapping todos to body content

Each implementer prompt attaches:

- the todo `id` and `content`
- the body headings that implement that todo (e.g. "Phase B: mask helper")
- the rows of **Files to touch** and **Out of scope** that apply
- the **Verification** items that apply to that todo only

Never assume the todo line alone is enough; long plans put the spec in the body.

If the plan path is missing or unreadable, stop and ask the owner for a valid plan file.

---

## Scoped verification

Broad checks waste time and rarely help a narrow plan. **Every** implementer, shell and verifier
prompt includes these rules.

### The verify gate (mandatory)

**The plan is not done until the gate passes.** After every implementation wave and every fix round,
delegate a **shell subagent** to run, from the repo root:

```bash
pnpm verify
```

`pnpm verify` mirrors CI stage for stage, and exit 0 means every stage ran and passed
([pp-workflow → Definition of done](../pp-workflow/SKILL.md#definition-of-done)). It runs long
(Testcontainers, the gitleaks Docker image), so the subagent runs it in the background, redirected to
a log, and waits for completion ([root AGENTS.md → Waiting for a long command](../../../AGENTS.md#waiting-for-a-long-command-on-this-machine)).
The one-minute cap below does not apply to it.

**Until slice 0 lands `pnpm verify`**, the gate is the cheap checks for what the plan touched
([root AGENTS.md → Commit and push](../../../AGENTS.md#commit-and-push-as-you-go)): the scoped tests,
the linter or formatter for those files if one exists, and `pnpm exec openspec validate <change>
--type change --strict` when `openspec/` was touched. Record which checks stood in for the gate.

- Record the command, working directory, exit code and a short summary of any failure.
- On a non-zero exit, delegate implementers to fix only what the gate reported, then re-run the gate
  in a fresh shell subagent. Repeat until it exits 0.
- **Never** disable, skip or weaken a gate stage to get to 0 ([Permissions → Never](../../../AGENTS.md#permissions)).
- Do not mark the plan complete, return a verifier PASS, or report success while the gate is red.
- Pass the gate evidence (command, exit code) into every verifier prompt for that round.

### Allowed scoped checks

Run only what the plan implies for the files and behavior it changed:

| Check | How to scope |
| --- | --- |
| Unit and property tests | One test file, or `vitest run <path>` / `-t "<describe name>"` matching the plan's area |
| Integration tests | Only if the plan names them or they cover the exact module touched |
| Typecheck | `pnpm --filter <package> exec tsc --noEmit`, only when compile errors are likely and the plan cares |

When the plan is vague, pick the **smallest** test files that exercise the changed code.

### Time limits

- **At most one minute wall-clock per scoped test command** (hard cap). The verify gate is exempt.
- Prefer one focused file over a directory. If a run exceeds a minute, stop, report the partial run
  and the timeout, and narrow it in the next fix round.
- If a scoped test cannot finish in a minute, report **blocked** with the exact command, and let the
  verify gate carry it.

Pass these limits verbatim into implementer and shell prompts.

---

## Subagent roles

Use **at least two distinct roles** on every run:

| Role | Kind | Mode | Responsibility |
| --- | --- | --- | --- |
| **Implementer** | general-purpose | read-write | Implement plan todos: code, config, docs, tests |
| **Verifier** | general-purpose or explore | **read-only** | Audit the work against the plan; findings only, no fixes |
| **Explorer** (optional) | explore | read-only | Recon before implementation when the plan names unfamiliar areas |
| **Shell runner** | shell or general-purpose | runs commands only | The verify gate and scoped, time-bounded tests |

Never combine implementation and verification in one subagent invocation.

---

## Core workflow

### Phase 0 — Plan intake (orchestrator only)

Read the plan and build an execution map:

- the [When this skill applies](#when-this-skill-applies) check — route to OpenSpec if it trips
- ordered todos still `pending` or `error`
- **phase order** from the body, even when the todos look independent
- work type per todo
- which todos can run in **parallel** (no shared files, no phase dependency, no shared output)
- the scoped checks derived from the plan
- the gate: `pnpm verify` (or its stand-in) after every implement or fix wave
- the projects the plan touches ([root AGENTS.md → Projects](../../../AGENTS.md#projects))
- referenced plan or doc paths to pass into subagent prompts

### Phase 0b — Re-verify-only mode

When every todo is already `completed`, or the owner asks to verify without implementing:

- skip Phase 2
- run the Phase 3 gate (fix until it exits 0)
- run the Phase 3b verifier against the full plan
- on FAIL, enter the Phase 4 fix loop for the failing items only

### Phase 1 — Optional exploration (parallel)

When the plan references unfamiliar modules or many files, delegate **one read-only explorer per
distinct area** (e.g. `apps/worker` vs `packages/db`), in parallel. Each summarizes existing patterns,
entry points and constraints for specific plan sections, and implements nothing. Discard their
context before implementation.

### Phase 2 — Implementation

For each wave:

1. Prefer **one implementer per todo** when todos are independent.
2. Split a large todo by body section (e.g. schema vs handler) across several implementers.
3. Launch **in parallel** every implementer that does not depend on another's output.
4. Run strictly sequential todos one wave at a time.

**Every implementer prompt includes:**

- the absolute path to the plan file (and referenced docs)
- the todo id(s) and `content` it owns
- the linked body sections by heading
- the applicable **Files to touch** rows
- the **Out of scope** and operational sections it must not perform
- what "done" looks like for its work type
- the instruction to follow root `AGENTS.md` (module boundaries, the one error shape, Never tier) and
  the loaded `pp-*` skills, and to match the surrounding code
- the [Scoped verification](#scoped-verification) rules, verbatim
- the instruction to run only the scoped tests its todo implies before reporting done
- for gate-fix rounds: fix only what the gate reported, then report done
- for operator steps: stop with **blocked** and list the exact commands for the owner
- **no git commands** — the orchestrator commits ([root AGENTS.md](../../../AGENTS.md#commit-and-push-as-you-go))
- the instruction **not** to claim the whole plan is complete, only its own todos

After each implementer finishes, discard its context. Pass the verifier only artifacts (paths
changed, todo ids addressed), never the implementer's reasoning. Mark a todo `completed` or `error`
in the plan only after the verifier confirms it.

### Phase 3 — Verify gate (before any verifier PASS)

After each implementation wave (or once, if the plan is small), and after every fix round:

1. Delegate a **shell subagent** to run the gate.
2. If it fails, delegate implementers to fix what it reported, then return to step 1.
3. Go to Phase 3b only when the gate exits **0**.

Never skip the gate because an implementer reported success or because scoped tests passed.

### Phase 3b — Verification (a fresh subagent every round)

Delegate a **new read-only verifier**. Its prompt includes:

- the plan path (the verifier reads it fresh)
- the todo ids and files touched in the last wave
- the gate evidence for this round (command, exit code 0, summary)
- the loaded `pp-*` skills, whose `Never` lists it checks the diff against
- a required **findings report**:
  - **PASS** — no blocking issues, or
  - **FAIL** — numbered findings, each with its plan reference (todo id or body section), expected
    behavior, actual behavior, severity (`blocking` | `minor`) and a fix direction (not a fix)

**The verifier checks, line by line:**

- every in-scope todo is actually done
- every applicable body **Verification** item is satisfied, or N/A with a reason
- the **Files to touch** table matches the diff, or the omission is justified
- no **Out of scope** work was introduced; operational sections were not implemented
- deliverables the plan names exist and contain their required sections
- operator todos carry evidence or the owner's sign-off, or are correctly reported blocked
- the code matches the plan's intent, not only "tests are green"
- the gate passed this round (exit 0, evidence supplied). **FAIL** if the evidence is missing or red
- scoped tests ran or were correctly deferred (command, exit code, duration, the one-minute cap)
- every doc duty the change triggers is discharged in the same diff
  ([pp-workflow → Definition of done](../pp-workflow/SKILL.md#definition-of-done))
- no secret, API key, signing secret or real recipient address in a changed file; git-ignored paths
  respected ([Permissions → Never](../../../AGENTS.md#permissions))
- no PASS without fresh evidence

The verifier never fixes. Findings only.

### Phase 4 — Fix loop (on FAIL)

1. Delegate **fresh implementers** (in parallel when findings are independent), each with the plan
   path, the finding numbers it resolves, and a minimal-scope instruction. Never re-implement
   unrelated todos.
2. Run Phase 3 again, then a **completely new** verifier (never resume the previous one).

Repeat until the verifier returns **PASS** with zero blocking findings and the gate exits 0.

---

## Iteration rules

```
loop:
  implement (1+ subagents, parallel when safe)
  gate      (shell: pnpm verify, or its stand-in; red → fix implementer → gate)
  verify    (1 fresh read-only subagent)
  if blocking findings: fix (1+ subagents) → gate
  until verifier PASS && gate exit 0
```

Hard rules:

- **Never** reuse a subagent across implement, verify and fix phases
- **Never** let the verifier implement fixes
- **Never** skip verification because an implementer reported success
- Stop at **10** verify rounds; report the remaining findings to the owner

## Parallelization guide

Parallelize when todos have no ordering dependency, touch disjoint files, or explore different
projects. Serialize when the body orders the steps, a later todo needs an earlier artifact, several
todos modify one file, or an operator todo's output feeds the next todo. When in doubt, serialize the
conflicting todos and parallelize the rest. "Optional" todos are still verified.

---

## Commits

Commit and push each completed plan step without being asked
([root AGENTS.md → Commit and push](../../../AGENTS.md#commit-and-push-as-you-go)), using
[`wf-commit`](../wf-commit/SKILL.md): run the step's cheap checks first, stage by path, never
`git add -A`. Off `main`, a red check does not hold the commit; name what is red in the body. An
Ask-first change waits uncommitted for the owner's approval while the rest of the step is committed.
Helper subagents run no git commands.

## Completion criteria

The run is complete only when:

- the gate exits 0 (`pnpm verify`, or its recorded stand-in before slice 0)
- a verifier returns **PASS** with zero blocking findings
- every todo is satisfied and marked `completed` in the plan frontmatter
- every step is committed and pushed
- the owner has a summary: plan name and path; implement, verify, fix and gate rounds; todos
  completed; gate evidence; scoped-check evidence (commands, outcomes, durations); deferred minor
  notes; anything blocked on the owner

If the plan cannot be fully implemented (missing inputs, an ambiguous spec, an Ask-first step), stop
after the latest verifier round, report the blockers, and list what the owner must settle in the plan.

## Invocation examples

- **Full plan:** "Use the implement-plan skill on `fix-mask-edge-case.plan.md`"
- **One todo retry:** "Use implement-plan for todo `tighten-mask-helper` from `<plan.md>` and
  re-verify the full plan"
- **Re-verify only:** "Use implement-plan to verify `<plan.md>` without re-implementing"
