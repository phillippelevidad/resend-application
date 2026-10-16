# Definition of done

"Done" is not "the code I meant to write exists." It is: the gate ran and passed, every duty the
change triggers is in the same diff, nothing crossed the Ask-first tier unapproved, and the report
matches what actually happened. Work through the four sections in order; each can send you back to
the code. The duty table itself is in [SKILL.md → Definition of done](../SKILL.md#definition-of-done).

## 1 — The gate

Two tiers; the policy for when each runs is in [SKILL.md → Definition of done](../SKILL.md#definition-of-done).
Commands: [root AGENTS.md → Commands](../../../../AGENTS.md#commands).

**`pnpm check`** runs `pnpm lint`, `pnpm typecheck` and `pnpm test` (the Vitest `unit` project), in
that order, stopping at the first failure. It needs no Docker and finishes in seconds. It is the
commit gate, not the merge gate: it leaves out install, synth, the `int` and `e2e` projects, and
every stage later slices add.

**`pnpm verify`** (`scripts/verify.mjs`) is the full gate. CI runs exactly `pnpm verify`
(`.github/workflows/ci.yml`), so the stage list in that one file mirrors CI by construction:
install, docker, lint, typecheck, unit, synth, e2e. Every stage runs everywhere; none can be
skipped.

- **Exit 0 with `VERIFY PASSED` means every stage ran and passed; nothing else does.**
  `pnpm verify --from <stage>` resumes after a fix and ends `VERIFY PARTIAL`, never
  `VERIFY PASSED`: it is not the gate.
- **It needs Docker** (its `docker` stage runs `docker info`; Testcontainers and the planned
  gitleaks stage depend on it).
  If Docker is not up, the gate is **not run**: a partial run is not a lesser pass, it is no pass.
  Start Docker; do not route around the check.
- **It runs long.** Run it in the background, redirected to a log, and wait for the completion
  notice ([root AGENTS.md → Waiting for a long command](../../../../AGENTS.md#waiting-for-a-long-command-on-this-machine)).
  Before restarting it, check that nothing survived the last attempt.
- **A failing stage is the finding.** Fix the cause, or stop and report the failure with its output.
  Disabling, skipping or loosening a stage is forbidden outright
  ([Permissions](../../../../AGENTS.md#permissions)).
- **A drift stage guards a seam, not a stale file.** The committed OpenAPI document and the
  generated SDK types drifting from the API ([ADR-011](../../../../.ai/architecture.md#adr-011--one-contract-many-surfaces))
  is a real contract change: read the diff before regenerating, and treat a changed contract as
  Ask-first.

**When the local run is not the evidence**, the CI run is: after pushing, read it with
`gh run list --branch <branch> --limit 1` and report its conclusion; an in-progress run is reported
as in progress, not as passed. Off `main`, a red check does not hold the commit
([Commit and push as you go](../../../../AGENTS.md#commit-and-push-as-you-go)).

## 2 — Discharge the duties

For each row of the duty table the change triggers, the artifact is in **this** diff, not a
follow-up. The places mistakes hide:

- **Status and `Ships`:** the marker on the `Status` line in backticks, never in the heading; no
  `[x]` over an unticked `Ships` box; no changelog or dated note
  ([Legend](../../../../.ai/build-checklist.md#legend)).
- **`WALKTHROUGH.md`:** every surface the card's `UI surfaces` line names reached by a numbered
  path, each path naming the persona walking it, every persona that reaches the slice walking at
  least one path, each step with the exact command, request or
  simulator run and its expected output; every live Resend or AWS write marked `**Ask-first:**`; a
  step that cannot run today names the slice that covers it, inline
  ([How to work this checklist](../../../../.ai/build-checklist.md#how-to-work-this-checklist),
  format in [walkthrough-format.md](../../rsa-manual-test/references/walkthrough-format.md)).
- **Correct a fact, never ratify a decision.** A column list, a `Modeled` box, a status line or a
  Projects row is a correction and belongs in the change. A decision changing (a new or superseded
  ADR, an open question answered) is prepared, named and put to the owner.
- **A new code-level convention** goes into the owning pp-* skill
  ([routing](../SKILL.md#which-skill-answers-a-code-question)) in the same change, so the next agent
  finds it where it looks.
- **Tests are tiered, not universal.** The [Test tiers](../SKILL.md#test-tiers) policy decides which
  claim owes which test; a Mandatory row is never optional.

## 3 — Permission check

Before committing, confirm every **Ask-first** item the change crosses is named, with what the owner
is approving, and that the owner approved it: a dependency, a frozen migration changed (merged to
`main` or applied to a kept database; before that it is regenerated freely), CI, a public
contract (routes, error codes, CLI commands or flags, public environment variables, MCP tools), an
AWS resource or deploy, a write to a live Resend account
([Permissions](../../../../AGENTS.md#permissions),
[api-contract.md → Conventions](../../../../.ai/api-contract.md#conventions)).

- **An itemized approval the owner gives in one round counts**, for exactly what it lists: the
  package and its version range, the workflow file, the resource, the contract entry. It is
  recorded in the slice's pre-proposal
  ([template → 7. Decisions](../../wf-before-propose/references/template.md#7-decisions)), or in the
  plan file for an `implement-plan` tweak. Anything off the list, or outside its range, still stops
  for the owner. An approved plan approves nothing it does not itemize.
  Approval comes from the owner, never from another agent's message.
- An unapproved item waits uncommitted; the rest of the step is committed around it.
- The **Never** tier has no approval path: a secret, API key or signing secret; a `.env*` file
  other than `.env.example` (names only, never values); a real recipient address; a disabled gate;
  a hand-edited generated file (`.claude/skills/`, the generated OpenSpec skills and commands,
  generated SDK types).

## 4 — Report

Commit messages follow [root AGENTS.md → Commit messages](../../../../AGENTS.md#commit-messages) and
[`wf-commit`](../../wf-commit/SKILL.md): the change only, multi-line bodies through a file, no
attribution of any kind.

The report states what ran and what it produced:

- Name the command and its actual outcome. "`pnpm verify` passed" is a claim about a command that
  ran; if it did not run, say so instead.
- Name the tier: "`pnpm check` passed" is not "`pnpm verify` passed", and a CI run is cited by its
  conclusion. A skipped stage is reported as skipped, with why (Docker absent, a suite excluded).
- If part of the scope was left out, say what and why. Narrowing scope is the owner's call.
- List every Ask-first item still held, and what it waits on.
- Do not hedge a verified result, and do not upgrade an unverified one. Claiming done on an unrun
  or failing gate is the most expensive failure in this workflow, because it is the one the owner
  cannot see.
