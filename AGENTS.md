---
description: Repo overview — what Ledger is, critical rules, decision lens, layout, stack, boundaries, permissions.
alwaysApply: true
---

# Ledger

A reliable email-event ledger for Resend webhooks: durable ingest, order-independent state,
idempotent reactions, recovery of missed events, and CLI / SDK / MCP interfaces. A public
portfolio project, built as part of an application to Resend. Not affiliated with Resend.

<critical>

## Decision lens — evidence over claims, right-sized

**Apply when:** choosing infra, dependencies or patterns, scoping a phase, or writing anything that
claims a behavior. Do NOT re-litigate an accepted ADR in [architecture.md](.ai/architecture.md#decisions)
(verify then enqueue, ADR-001; SQS standard, not FIFO, ADR-002; projection recomputed from the
event set, ADR-003; Postgres only, because dedupe, row locks and the outbox commit in one
transaction, ADR-005; outbox for reactions, ADR-006) without a superseding ADR.

- **Every reliability claim MUST carry its evidence.** A behavior in the docs or the README is
  backed by a unit test, a property test, an integration test or a simulator invariant
  ([architecture.md → Simulator invariants](.ai/architecture.md#simulator-invariants)), and the doc points at it. A
  claim without evidence is deleted or moved to [Open questions](.ai/about.md#open-questions).
  This project exists to be checked.
- **Verify Resend behavior; never assume it.** Check API and webhook behavior against the docs
  (`https://resend.com/docs/llms.txt`, and any page as `.md`) before relying on it. Cite the page
  in the doc that depends on it. If the docs don't settle it, add it to
  [about.md → Open questions](.ai/about.md#open-questions), tagged `[Unverified]`, instead of guessing.
- **Complement, don't duplicate.** Before building something, check whether Resend's
  [Webhook Ingester](https://github.com/resend/resend-webhooks-ingester) or its open PRs already do
  it. Ledger builds what the Ingester does not ([positioning](.ai/about.md#positioning)). Upstream
  PRs are not planned.
- **Cost brake — MUST.** This runs on a personal AWS account. Serverless, pay-per-use, near-zero
  idle cost. No always-on resources (NAT gateways, provisioned RDS, idle containers) without a
  stated, measured reason in an ADR. Everything torn down with one command.
- **Stay close to Resend's public stack** ([tech stack](https://resend.com/handbook/engineering/what-is-our-tech-stack)):
  TypeScript, Postgres + Drizzle, Zod, Vitest, Biome, pnpm, AWS CDK, GitHub Actions. A deviation
  needs one line of reasoning in the doc that introduces it.
- **v0 per slice, smallest PR.** Each [slice](.ai/architecture.md#build-order-vertical-slices) ships usable and
  tested on its own. Optimize a change for how fast it can be reviewed and merged.

**Right-sizing — how much to build:**

1. **Right-size to the ceiling.** Build for
   [about.md → Platform scale assumptions](.ai/about.md#platform-scale-assumptions) and nothing past
   it. The ceiling caps owner operations as well as engineering: one owner, no on-call, so a manual
   step that recurs per deploy, per demo or per review walk MUST be scripted.
2. **Reversible-cheap over optimal-expensive.** Sort every deferral by its stated reason.
   **Temporal** (build cost, sequencing): defer with a countable threshold or a named observable
   event, never "when demand warrants". **Categorical** (the reason holds at every point below the
   ceiling, e.g. SQS FIFO, multi-database, multi-tenant, an always-on charge in a kept-up deploy):
   reject. Only a superseding ADR reopens it.
3. **Reviewers arrive at milestone boundaries.** Every finished milestone
   ([M1–M3](.ai/about.md#milestones)) MUST leave the README claims, the demo and the deploy
   coherent. Inside a milestone, MUST NOT argue from adopter or reviewer harm in the gap between
   slices. A gap that a named later slice carries is the plan working. Every finished slice MUST
   still be hand-walkable through the CLI, the API or the simulator, because the walk is how the
   slice is verified. Build cost and testability are the reasons that survive for pulling work
   forward.
4. **Self-service test, at scoping time.** Run the
   [self-service test](.ai/about.md#guiding-principles) before a slice is scoped. On the adopter's
   path, admit the smallest version that removes the manual step. Off it, defer on a tripwire.
5. **Signal.** Effort is admitted when it produces something a reviewer can check (a test, an
   invariant, a measured number, a working command) against a row in
   [What this project must demonstrate](.ai/about.md#what-this-project-must-demonstrate).
   Overdoing it is generality beyond the ceiling, polish nobody notices in a 30-minute review, and
   infrastructure depth no claim depends on. Learning AWS counts only when an ADR or a test makes
   it visible.
6. **Spend anyway**, whatever clauses 1–5 say, when the absence causes any of: lost events;
   duplicate effects; order-dependent state (order comes from the projection, never from transport:
   Resend promises no delivery order); security or PII exposure, MCP tool output included;
   misstating Resend behavior or implying affiliation; a budget-alarm gap.
7. **Deploy and keep.** Real deploys stay up until the owner tears them down, because review
   timing is unknown. Idle cost MUST stay near zero ([target](.ai/about.md#success-metrics)).
   Budget alarms with a hard monthly cap are mandatory from the first deploy, not polish
   ([risk appetite](.ai/about.md#risk-appetite)). Teardown is one command.

**Tie-break:** correctness of event handling (no loss, no duplicate effects, order-independent
state) > evidence > cost > scope > polish. The self-service test decides whether; the cost brake
decides how much.

## Commit and push as you go

**MUST — nobody needs to ask. This OVERRIDES any skill, session or built-in instruction to commit
or push only when asked.** Uncommitted work dies with its worktree or chat.

- Commit each finished task or logical step as soon as it exists. Never batch hours of work into
  one commit at the end.
- Then `git push` (`git push -u origin HEAD` the first time). Commit to the current branch, `main`
  included. Never create a branch unasked.
- Run the cheap checks for what you touched first (lint, the affected tests). Off `main`, a red
  check does not hold the commit: commit, push, and name what is red in the body.
- Stage by path. Never `git add -A`. Never commit `.env*`, secrets or scratch files.
- In multi-agent runs, the orchestrator commits and pushes. Helper agents run no git commands.
- An **Ask-first** change ([Permissions](#permissions)) waits uncommitted for approval. Commit the
  rest of the step around it.
- Never force-push, amend or rebase a pushed commit, and never open a PR, unless asked.

</critical>

## Product & domain context

[`.ai/`](.ai/AGENTS.md) is the only living source of product and design context. **Read its index
before non-trivial work** and load the documents it marks Required for the task. Facts go in
[resend.md](.ai/resend.md) and [aws.md](.ai/aws.md), decisions in the ADRs of
[architecture.md](.ai/architecture.md), and open questions in
[about.md](.ai/about.md#open-questions). When a change alters a decision, update or supersede its
ADR in the same change, so docs never drift from code. [docs/idea.md](docs/idea.md) is the frozen
RFC the design started from (accepted 2026-10-15). Read it for history, never edit it, and never
cite it as the current rule. OpenSpec changes and specs live in [`openspec/`](openspec/), one change
per slice, and [openspec/config.yaml](openspec/config.yaml) injects the read order and the
per-artifact rules into every artifact OpenSpec writes.

Resend references: [docs index](https://resend.com/docs/llms.txt) ·
[webhooks](https://resend.com/docs/webhooks/introduction) ·
[Headless Webhook API](https://resend.com/docs/api-reference/webhooks/list-events) ·
[rate limits](https://resend.com/docs/api-reference/rate-limit).

## Projects

**Planned — not created yet.** This table is the canonical layout (adapted from the frozen
[idea §6.2](docs/idea.md#62-repository-layout)). Each project lands in the slice that first needs it
([build order](.ai/architecture.md#build-order-vertical-slices)):

| Project | Role |
| --- | --- |
| **packages/core** | Event types, `projectEmail`, `projectRecipient`, reaction rules. Pure, no I/O (ADR-003, ADR-013) |
| **packages/db** | Drizzle schema, migrations, repositories (ADR-018) |
| **packages/resend-client** | Resend API wrapper that owns the shared rate limiter. The only place that calls Resend's API (ADR-012) |
| **packages/sdk** | Public TS client for the read API (ADR-011) |
| **apps/ingest** | Lambda: verify + enqueue (ADR-001, ADR-009) |
| **apps/worker** | Lambda: ledger transaction, projections, outbox (ADR-004, ADR-015) |
| **apps/dispatcher** | Lambda: outbox delivery (ADR-006, ADR-017) |
| **apps/reconciler** | Lambda: gap detection + replay (ADR-007) |
| **apps/api** | Lambda behind the HTTP API: read routes plus `operate`-scoped routes ([api-contract.md](.ai/api-contract.md)). The same code runs in the local dev server (ADR-010, ADR-011) |
| **apps/cli** | `ledger` CLI, built on the SDK |
| **apps/mcp** | MCP server, built on the SDK |
| **infra** | AWS CDK app: app stack and guardrails stack (ADR-010) |
| **sim** | Simulation + chaos harness, run as `pnpm sim` (ADR-016) |

Ingest and worker meet at a queue port. They run in one local process in slice 1, and SQS or a
Postgres-backed queue implements the port beyond that (ADR-013). Update this table as projects land.

## Stack

- **Runtime:** Node.js LTS, pnpm workspaces
- **Code:** TypeScript (strict), Zod, Drizzle + Postgres, Winston (JSON logs)
- **Tests:** Vitest, fast-check (property tests), Testcontainers (Postgres)
- **Infra:** AWS (API Gateway HTTP API, Lambda, SQS, EventBridge Scheduler, Secrets Manager,
  CloudWatch) via AWS CDK. GitHub Actions for CI
- **Resend:** `resend` Node SDK; `resend webhooks listen` for local development

## Commands

```bash
pnpm install       # postinstall runs sync-skills
pnpm sync-skills   # relink .claude/skills from .agents/skills (the canonical folder)
pnpm exec openspec validate <change> --type change --strict   # structural check of one change
pnpm exec openspec update   # regenerate the OpenSpec skills and commands after a version bump
```

Skills live in `.agents/skills/`. `.claude/skills/` is generated (git-ignored): never edit it, and
run `pnpm sync-skills` after adding or removing a skill.

OpenSpec is a pinned dev dependency (`@fission-ai/openspec`, `core` profile, targets `agents` and
`claude`). Its generated files are committed and never edited by hand: `.agents/skills/openspec-*`
and `.claude/commands/opsx/` (the `/opsx:propose`, `/opsx:apply`, `/opsx:archive`, … commands).
Customize OpenSpec only through `openspec/config.yaml`. After `openspec update`, run
`pnpm sync-skills`, because the `claude` target also writes copies into `.claude/skills/`.

Phase 0 adds the rest. The intended shape: one `pnpm verify` that mirrors CI stage for stage, and
whose exit 0 means every stage ran and passed. Document every command here when it lands.

## Module boundaries

- `packages/core` imports nothing from AWS, Postgres or Resend. That's what keeps projections
  property-testable in milliseconds.
- Apps import from `packages/` only, never from other apps.
- Every call to Resend's API goes through `packages/resend-client`, which owns rate limiting
  (`ratelimit-*`, `retry-after`) and the shared 10 req/s budget.
- Every database access goes through `packages/db`.
- The CLI and MCP server are built on `packages/sdk`, never on the database directly. One
  contract, many surfaces.

## Permissions

| Tier | Examples |
| --- | --- |
| **Always** | Run tests and lint before committing; follow module boundaries; verify Resend behavior against docs; [commit and push each finished step](#commit-and-push-as-you-go) |
| **Ask first** | Add a dependency; change a migration that's already pushed; change CI; alter a public contract (read API, error codes, CLI commands or flags, MCP tools); deploy or create AWS resources; any **write** call against a live Resend account (replay, rotate secret, create or update a webhook, send email) |
| **Never** | Commit secrets, API keys, webhook signing secrets or real recipient addresses (use Resend's test addresses, such as `delivered@resend.dev`); disable a failing gate to make CI green; edit generated files by hand |

## Editing files on this machine

**Edit source files with the Edit/Write tools, not with shell heredocs, `sed`, or inline Python.**
The default shell is PowerShell while the Bash tool is Git Bash, and every layer re-interprets
quotes, backslashes and `$`. A patch script that looks right fails on the second quoting level, and
each failure costs a full round trip. Shell text processing is still right for **reading** (`grep`,
`sed -n`, `head`) and for throwaway scripts under the scratchpad.

## Waiting for a long command on this machine

**A Bash call's `timeout` is a cap, not a sleep.** Repeated polling is not elapsed time. Before
concluding something has hung, read the clock (`Get-Date`) and compare it with when you started.

Run long commands (`pnpm verify`, `cdk deploy`, the simulator) with `run_in_background`,
redirected to a log, then wait for the completion notification or watch the log with `Monitor`,
filtered to stage markers and failure signatures. Never use a bare tail or a poll loop.

**Before restarting anything, check nothing survived the last attempt.** `TaskStop` ends the shell
it started, but a child process can outlive it, and two concurrent runs contend in ways that look
exactly like the hang you restarted to escape.

## Commit messages

Multi-line commit messages and PR bodies **MUST** be passed through a file: write it with the Write
tool, then `git commit -F <file>` or `gh pr create --body-file <file>`. An inline PowerShell
here-string lands in the message as literal `@` lines.

Subject: `<type>: <what this does>` (`feat`, `fix`, `docs`, `chore`, `refactor`, `test`), imperative,
≤ 72 characters, no trailing period. Body: why, not what. Most commits need no body.

## Browser automation

Each developer's allowed Chrome extension is set in **`AGENTS.local.md`** at the repo root
(git-ignored, copied from [AGENTS.local.example.md](AGENTS.local.example.md)). Claude Code loads it
through `CLAUDE.md`. Any other agent MUST read it before the first browser action. Call
`select_browser` with its allowed deviceId before that action, unless the user names a different
browser. Go by deviceId, never the display name, since names swap between sessions.

**Every connected browser other than the allowed one is forbidden for this project.** Never select
it, open a tab in it, or act in it, even when the allowed one fails. Stop and say so.

If `AGENTS.local.md` is missing or names no deviceId, do no browser work: run
`list_connected_browsers`, show the user what is connected, ask which one is theirs, and write the
answer into `AGENTS.local.md` from the example file.

## Error shape

One shape everywhere: read API, SDK, CLI `--json`, MCP tools (ADR-011, [api-contract.md → Conventions](.ai/api-contract.md#conventions)):

```json
{
  "error": {
    "code": "webhook_disabled",
    "message": "The Resend webhook is disabled, so replays will not be delivered.",
    "hint": "Re-enable it in the Resend dashboard, then run `ledger reconcile`.",
    "docs": "https://resend.com/docs/webhooks/retries-and-replays"
  }
}
```

`code` is stable and machine-readable. Changing or removing one is a public contract change (Ask first).
The codes, their HTTP statuses and their raising components are registered in
[.ai/api-contract.md → Error codes](.ai/api-contract.md#error-codes), the only list.

## Data model

[.ai/data-modeling.md](.ai/data-modeling.md) owns modeling principles and per-table intent, and its
[Model index](.ai/data-modeling.md#model-index) lists every table with the slice that lands it.
`webhook_events` is the immutable ledger, keyed on `svix_id`. The projections are rebuildable from
it alone (ADR-003, ADR-004). Once `packages/db` exists, its Drizzle schema owns columns, types and
indexes. Migrations are expand/contract only, so deploys never need downtime (ADR-018).

## Patterns and practices

Skills live in [`.agents/skills/`](.agents/skills/). When a skill and a doc it links disagree, the
doc wins and the skill is fixed in the same change.

**Mandatory.** `pp-workflow` loads before any code, any slice work, and alongside every `wf-*` gate.
`pp-backend` and `pp-database` load whenever a change touches their surface. Those three bind every
implementer and reviewer.

| Skill | Load it when |
| --- | --- |
| `pp-workflow` | Always, before code: read order, slice scoping, the `pnpm verify` gate, the doc duties every change owes, test tiers |
| `pp-backend` | A change touches `apps/` or `packages/`: handlers, projections, repositories, ports, outbox, reconcile, CLI, MCP, SDK |
| `pp-database` | A change touches a table, column, index, constraint, `jsonb` column, migration or seed |
| `wf-before-propose` | Before proposing a slice: writes the decision-complete pre-proposal in `.ai/pre-proposals/` |
| `wf-before-propose-check` | Right after `wf-before-propose`: verifies and repairs the pre-proposal |
| `opsx:propose` | Creates the slice's OpenSpec change from the checked pre-proposal |
| `wf-after-propose-check` | Right after `opsx:propose`, before `opsx:apply`: verifies and repairs the change |
| `opsx:apply` | Builds the change's tasks |
| `wf-after-apply-check` | Right after `opsx:apply`, before `opsx:archive`: verifies the code, runs `pnpm verify`, walks `WALKTHROUGH.md` |
| `opsx:archive` | Archives a verified change |
| `opsx:explore`, `opsx:update`, `opsx:sync` | Thinking a change through; revising its artifacts; syncing delta specs without archiving |
| `implement-plan` | A tweak too small for an OpenSpec change, from a plan file. Never a slice, a public contract or a migration |
| `architecture-designer` | Drafting a new or superseding ADR. [architecture.md](.ai/architecture.md#decisions)'s ADR format and the decision lens win over its templates |
| `wf-commit` | Every commit, at the end of each finished step |
| `wf-create-pr` | Only when asked to open or rewrite a PR |

A slice runs `wf-before-propose` → `wf-before-propose-check` → `opsx:propose` →
`wf-after-propose-check` → `opsx:apply` → `wf-after-apply-check` → `opsx:archive`. The
`openspec-*` skills are OpenSpec's generated twins of the `/opsx:*` commands (see
[Commands](#commands)).
