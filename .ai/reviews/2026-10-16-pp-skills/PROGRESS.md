# pp-* skills build run 2026-10-16: progress

Builds the `pp-*` (patterns and practices) skills in `.agents/skills/` that bind every implementer
and reviewer. Resume from the first phase that is not marked done. Decisions are in
[decisions.md](decisions.md). Research and briefs live in the run's local `stages/`, which is
git-ignored.

**Resume in a fresh chat:** "continue the pp-skills run". Read this file, then
[decisions.md](decisions.md), then the brief for the next phase in `stages/`.

| Phase | Status | Output |
| --- | --- | --- |
| 0 — research and tracker | done | `stages/research-*.md` (four reports), this file, [decisions.md](decisions.md) |
| 1 — decision docs: ADR-019, ADR-013 amendment, doc tensions | done — ADR-019 added; ADR-011, ADR-013 and ADR-018 amended; S-01 to S-11 settled | `stages/PHASE-1-BRIEF.md`; edits to `.ai/` and root `AGENTS.md` |
| 1b — owner checkpoint | done — O-01 to O-04 approved as recommended and applied | [decisions.md](decisions.md#open-for-the-owner-at-the-phase-1-checkpoint) |
| 2 — `pp-general`, `pp-workflow` | **in progress** — `stages/PHASE-2-BRIEF.md` written (G-01 to G-14, fixed anchors); two agents writing the skills | Two skills in parallel; every other skill links them |
| 3 — `pp-backend`, `pp-database`, `pp-testing`, `pp-infra`, `pp-cli` + `pp-mcp` | pending | Five agents in parallel, on disjoint folders |
| 4 — consumer routing | pending | Skill-name lists in root `AGENTS.md`, `wf-*`, `implement-plan`, `openspec/config.yaml` and the `check.mjs` strings; anchor and link check |
| 5 — adversarial review and fixes | pending | Reviewers check each skill against `.ai/` (the doc wins), then fixes |

## Skill set (owner, 2026-10-16)

| Skill | Kind | Owns |
| --- | --- | --- |
| `pp-workflow` | rewrite, keeps its anchors | Read order, slice scoping, definition of done, test-tier policy |
| `pp-general` | new | Naming, imports and tsconfig, module boundaries, adding things, error classes and mapping, logging, PII, config and env, target versions |
| `pp-backend` | rewrite | Handler factories and composition roots, ports, ingest, worker, dispatcher and reconciler patterns, outbox, `resend-client`, the read API on Hono, the SDK |
| `pp-database` | rewrite | Drizzle schema, repositories and transaction passing, migrations, grants, indexes, `jsonb` governance |
| `pp-testing` | new | Vitest layout, naming, Testcontainers harness, fast-check arbitraries, simulator invariants |
| `pp-infra` | new | CDK, bundling, Lambda configuration, cost-brake mechanics, teardown, CDK assertion tests, deploy scripts |
| `pp-cli` | new | Commands, output, exit codes, `--json` |
| `pp-mcp` | new | Tools, least privilege, masked output, operate gating |

## Consumer contract: what Phase 4 MUST keep

- These anchors survive: `pp-workflow#read-order`, `#definition-of-done`, `#test-tiers`;
  `pp-database#new-table-recipe`, `#never`; `pp-backend#never`, `#surfaces--sdk-cli-mcp`.
- Every skill has `## Always`, `## Never` (each entry names its alternative) and a
  `## Gate — then read the diff` section.
- The rules the `check.mjs` scripts cite by owner skill stay in that skill's `Never` list, or the
  cited strings are updated in the same change.
