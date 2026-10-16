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
| 2 — `pp-general`, `pp-workflow` | done — `pp-general` added, `pp-workflow` rewritten; G-01 to G-14 settled | `stages/PHASE-2-BRIEF.md`; [decisions.md](decisions.md#settled-in-phase-2); the queue below |
| 3 — `pp-backend`, `pp-database`, `pp-testing`, `pp-infra`, `pp-cli` + `pp-mcp` | **in progress** — `stages/PHASE-3-BRIEF.md` written (B-, D-, T-, I-, C-, M- decisions; fixed anchors); five agents writing | Five agents in parallel, on disjoint folders |
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

## Queue from Phase 2 (proposed edits outside the two skills)

**Phase 3 (brief carries these):**
- pp-testing settles test file names. Phase 2 fixed `.test.ts`, `.prop.test.ts`, `.int.test.ts`
  (pp-general → role suffixes); pp-testing details them and says which tier proves DLQ redrive
  (it runs through SQS, not Postgres: likely an integration test at the `packages/aws` adapter).
- pp-backend: replace "JSON logs carrying `svix_id`, `email_id` and `type` only" with a link to
  data-modeling → Log fields and pp-general; drop the naming and boundary content pp-general owns.

**Phase 4 (consumer routing):**
- `wf-after-apply-check/scripts/check.mjs` ~971: the integration-test filter `/integration/`
  misses `*.int.test.ts`. New: `/\.(int|integration)\.(spec|test)\.[jt]sx?$/`, and the message's
  `*.integration.{spec,test}.ts` → `*.int.test.ts`.
- `wf-after-apply-check/references/diff-review.md`: `**/*.spec.ts` → `**/*.test.ts`; :166 and
  `findings.md:78` mandatory-tier cell gains verify-before-enqueue (ADR-001) and masks-only MCP
  output (slice 5).
- `wf-after-apply-check/references/findings.md` B4 table: add the pp-workflow duty rows it lacks
  (Commands line; What-this-project-must-demonstrate evidence; code-level convention → owning
  pp-* skill; RS-NN cited; RS-UNN/AWS-UNN/PG-UNN row updated).
- `wf-after-propose-check/references/findings.md:122`: append the Commands line and the owning
  pp-* skill to the duty list.
- `wf-after-propose-check/references/tech-review.md:18`: pp-workflow row "…, naming, boundaries"
  → "…, skill routing"; add the pp-general row.
- Root `AGENTS.md` → Patterns and practices: pp-general row, add it to the Mandatory sentence;
  pp-workflow row gains "the Ask-first check, which pp-* skill answers a code question".
- Five `[Unverified]` items in pp-general (Node type stripping under `node_modules`; `tsc -b`
  with `noEmit`; Biome `overrides` per folder and a "leaves the package" pattern; Lambda level
  filter vs Winston's lowercase levels) each owe an about.md Open questions entry (slice 0 settles
  the first three, slice 2 the last).

**Owner checkpoint — outcome (2026-10-16): O-05 to O-10 approved as recommended.** O-05 to O-09
are applied (`package.json`, aws.md AWS-54, data-modeling → Log fields, build-checklist → Legend,
pp-workflow's DoD env row, pp-general). O-10 is applied in pp-general; Phase 3 MUST mark B-06
"approved (O-10)" in pp-backend, pp-cli and pp-mcp when their agents finish.
- O-05 Root `package.json` `engines.node` `>=24 <25` → `>=24.12 <25` (type stripping is Stable
  from v24.12, G-03). Recommended: approve, applied in slice 0.
- O-06 data-modeling → Log fields: exact key names (`error_name`, `pg_code`, `<name>_count`,
  `<name>_ms`, `function_name`, `timestamp`) and add `error_code` (a registry code), which the
  list omits today. Recommended: approve.
- O-07 build-checklist → Legend: `[!]` "blocked on an owner decision" → "…or an unverified fact",
  as pp-workflow already applies it. Recommended: approve.
- O-08 `.env.example` lists public variables only (api-contract → Conventions), never the
  CDK-set internal ones; pp-workflow's DoD row says so. Recommended: approve.
- O-09 A `workspace:*` entry is not a third-party dependency, so not Ask-first (pp-general says
  so). Recommended: approve.
- O-10 (from Phase 3) The public SDK returns `{ data, error }` like Resend's SDK (RS-23), never
  throwing for an API error; the one named exception to pp-general's "no `Result` type". The CLI
  and MCP unwrap it and map once. Recommended: approve. Rejected, the SDK throws the shared error.

## Consumer contract: what Phase 4 MUST keep

- These anchors survive: `pp-workflow#read-order`, `#definition-of-done`, `#test-tiers`;
  `pp-database#new-table-recipe`, `#never`; `pp-backend#never`, `#surfaces--sdk-cli-mcp`.
- Every skill has `## Always`, `## Never` (each entry names its alternative) and a
  `## Gate — then read the diff` section.
- The rules the `check.mjs` scripts cite by owner skill stay in that skill's `Never` list, or the
  cited strings are updated in the same change.
