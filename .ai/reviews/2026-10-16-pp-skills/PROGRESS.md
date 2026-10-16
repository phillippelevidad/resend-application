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
| 3 — `pp-backend`, `pp-database`, `pp-testing`, `pp-infra`, `pp-cli` + `pp-mcp` | done — `pp-backend` and `pp-database` rewritten, four skills added; O-10 written as decided in all three surfaces | `stages/PHASE-3-BRIEF.md`; [decisions.md](decisions.md#settled-in-phase-3); the queue below |
| 4 — consumer routing and cross-skill fixes | done — every consumer routes through pp-workflow's table; the queue applied; 0 broken links over 73 files | `stages/PHASE-4-BRIEF.md`; [decisions.md](decisions.md#settled-in-phase-4); the Phase 5 queue below |
| 5 — adversarial review and fixes | done — five reviewers, 61 findings (2 BLOCK); every one triaged, all but the owner items applied; 0 broken links over 51 files | `stages/PHASE-5-BRIEF.md`; [decisions.md](decisions.md#settled-in-phase-5); the owner checkpoint below |
| 5b — owner checkpoint | **next** — O-16 to O-21 below | Apply what the owner picks; then the run is closed |

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

## Queue for Phase 4

**Done (2026-10-16).** Every item below is applied, except: `openspec/config.yaml` needed no edit
(its two pp-* mentions are generic or still valid); `template.md:74`'s path depth was already right
(its links resolve from `.ai/pre-proposals/`, where the document is written); pp-testing's Open
questions row was dropped (O-14). Kept for the record.

Proposed by the Phase 2 and 3 agents, outside their own folders. Old/new text for each is in the
agents' reports as summarized here; re-derive it against the files as they stand. Owner decisions
O-05 to O-10 and the repository naming edit are already applied ([decisions.md](decisions.md)).

**Review scripts** (`wf-after-apply-check/scripts/check.mjs`):
- ~974 integration filter `/integration/` misses `*.int.test.ts` → `/\.int\.test\.ts$/` (one
  suffix, per pp-general and pp-testing); its message `*.integration.{spec,test}.ts` →
  `*.int.test.ts` (pp-testing → Test files and tiers).
- ~1003 `/projec/i` also fires on `packages/core/**`, so slice 0 would BLOCK: exclude
  `^packages/core/` (pure projections are proven by `*.prop.test.ts`).
- ~1005 the redrive/DLQ trigger BLOCKs a `packages/aws` change: exclude `^packages/aws/` (its
  evidence is the adapter's `*.test.ts`, T-06).
- ~930 wording: "app role" → "runtime role".

**Routing lists** (hard-coded names; `research-consumer-contract.md` §2):
- Root `AGENTS.md` → Patterns and practices: a row per skill (8), the Mandatory sentence names
  pp-general too; pp-workflow row gains "the Ask-first check, which pp-* skill answers a code
  question".
- `implement-plan/SKILL.md:30–31`, `wf-before-propose/SKILL.md:27`,
  `wf-before-propose-check/SKILL.md:57`, `wf-after-apply-check/SKILL.md:75`: load pp-general
  always, and the path skills by surface.
- `wf-after-propose-check/references/tech-review.md`: routing table rows for all 8 (:18 pp-workflow
  "…, naming, boundaries" → "…, skill routing"); :57 replace the copied pp-database Never list with
  a link to `pp-database#never` (recommended) so it cannot drift.
- `wf-after-apply-check/references/diff-review.md`: `**/*.spec.ts` → `**/*.test.ts`; :62
  migrations path → `packages/db/drizzle/`; :98 `infra/` → pp-infra; :134–136 Surfaces → pp-cli and
  pp-mcp (SDK stays pp-backend); tests and `sim/` → pp-testing; :166 and `findings.md:78`
  mandatory-tier cell gains verify-before-enqueue (ADR-001) and masks-only MCP output (slice 5).
- `wf-after-apply-check/references/findings.md` B4 table: add the duty rows it lacks (Commands
  line; What-this-project-must-demonstrate evidence; code-level convention → owning pp-* skill;
  RS-NN cited; RS-UNN/AWS-UNN/PG-UNN row updated).
- `wf-after-propose-check/references/findings.md:122`: append the Commands line and the owning
  pp-* skill.
- `wf-before-propose/references/template.md:74`: check the `../../.agents/skills/…` path depth.

**Cross-skill edits:**
- pp-workflow → Test tiers (T-06): split DLQ redrive. Postgres tier keeps "a redriven message under
  a new SQS `messageId` leaves one row (AWS-21)" and the local-mode redrive (slice 2B); SQS redrive's
  evidence is the `packages/aws` adapter against the port contract plus the slice 3 poison run (sim
  invariant 4), linking `pp-testing/references/fakes-and-doubles.md#dlq-redrive`.
- pp-general → logging-and-pii: stdout only, except `apps/mcp` (stdout is JSON-RPC: every level to
  stderr, Winston `stderrLevels`); `apps/cli` logs nothing.
- pp-general → coding-standards role suffixes: `email.cli.ts` → `email-get.cli.ts` (C-01); add
  `.stack.ts` (`app.stack.ts` → `AppStack`) and `.construct.ts` rows (pp-infra).
- pp-general → errors.md surface table: anchor the links (`pp-cli#output-and-exit-codes`,
  `pp-mcp#output`).
- pp-general → boundaries grep 14: allow `process.env` in `infra/src/main.ts` and
  `infra/scripts/*.ts` (`':!infra/scripts/*.ts'`).
- pp-testing → Fakes at the port: add "or the SDK client in CLI and MCP tests".
- pp-backend → resend-client.md: construct `new Resend(key, { baseUrl, userAgent })` with `baseUrl`
  from typed config, since unset the SDK reads `process.env.RESEND_BASE_URL` (resend@6.33.0); the
  AWS adapters take their SDK client from `main.ts`.
- `.gitignore`: add `cdk.out/` and `cdk.context.json` (CBL-19).

**Open questions rows** (pp-workflow DoD duty for every `[Unverified]` a skill wrote), each with the
slice that settles it:
- pp-general (5): type stripping under `node_modules`; `tsc -b` with `noEmit`; Biome `overrides`
  per folder; a "leaves the package" import pattern (slice 0); Lambda level filter vs lowercase
  Winston levels (slice 2).
- pp-backend (1): whether `@hono/zod-openapi`'s `415` passes through `defaultHook`/`onError`
  (slice 1).
- pp-database (7): drizzle-kit output layout; identity on `bigint`; the `Executor` type; pg's
  code-less errors (slice 2, PG-U04); `generate` output for a changed `check()`; identity sequence
  grant; migrations in one transaction (slice 1 unless noted).
- pp-mcp (3): `serveStdio` vs `StdioServerTransport`; SDK argument-rejection text; the v2 client's
  tool listing (slice 5).
- pp-infra (5): `require()` inside an ES-module bundle; `pg-native` at bundle time; synth without
  an account; spawning the CDK CLI without a shell; Cost Explorer read cost (an `AWS-U10` row in
  aws.md) (slice 2).
- pp-testing (1): the Postgres major (see O-14; a `PG-U06` row in integrations.md if not decided).

**Then:** an anchor and link check over every `.agents/skills/pp-*` file (all eight now exist).

## Owner checkpoint after Phase 5

The docs do not settle these. Each is held: nothing below is applied yet.

| ID | Finding | Question | Recommended |
| --- | --- | --- | --- |
| O-16 | R3-01 (BLOCK) | ADR-018 and integrations.md → Decision — Neon put a new table's grant "in the same migration"; pp-database puts it in a custom migration right after the generated one (a grant inside the generated SQL is a second hand edit). drizzle-orm's `migrate()` runs every pending migration in one transaction (source on `main`), so both are atomic | Amend the docs to "in a custom migration right after the generated one" (integrations.md, ADR-018, pp-testing's postgres-harness.md:26). Alternative: the skill appends the `GRANT` to the generated file |
| O-17 | R4-04 | api-contract → Conventions says internal variables are "declared in the CDK construct of the function that reads them"; pp-infra keeps the names in one `infra` module and sets each only on its reader. Ask-first (Conventions) | Amend Conventions to "their names in one module, each set only on the function that reads it" (S-02 precedent) |
| O-18 | R5-09 | Conventions say every `202` command waits and takes `--no-wait`; `dlq.startRedrive` answers `202` with nothing to poll. Ask-first (CLI flags) | Conventions: `--no-wait` only where the Surfaces line names it (`reconcile.start`); `dlq.startRedrive` returns at once, progress via `health.get` |
| O-19 | R5-10 | The MCP SDK rejects a type-invalid argument itself, with its own `isError` text outside the error shape | Record the exception in Conventions → Errors at slice 5 (Ask-first); typed schemas help the model, and the redaction test covers the text |
| O-20 | R5-11 | `reconcile`'s Surfaces line names MCP input `dry_run` only; its In line adds `lookback`, which tool-anatomy lists | Where a Surfaces line names MCP inputs they are the full set, otherwise the In line; drop `lookback` from tool-anatomy; slice 5 records each tool's inputs |
| O-21 | R5-12 | commander 15 echoes excess arguments in its usage error, so `ledger email <id> a@x.com` prints an address to stderr | Accept: it is the user's own argv on their own terminal, never logged, sent or printed under `--json`; note it in pp-cli |

**Triaged, not applied (with reasons):** R1's extra `check.mjs` BLOCK for a `packages/core` change
without a `*.prop.test.ts` (the core row is not in pp-workflow's Mandatory list, so the script
would be stricter than the policy); R3-07's rename of `connection-error.ts` (a file that *is* the
thing takes no suffix; pp-general's gate wording was the defect and is fixed). Sizes:
pp-workflow stays 13.6 KB (the added rows are binding duties) and pp-database 12.7 KB; the other
six are 11.9–12.6 KB.

## Queue for Phase 5 (adversarial review)

**Done (2026-10-16).** Answers: the dispatcher exception is mandated by ADR-017, the lock retaken
per batch (R2-01); the build checklist confirms pp-backend's slice owners, except the
`ingest.rejected` reason (slice 4, R2-04); the secret port fits ADR-013; the contract-step marker
stays on the generated migration (the migrator hashes but never compares); every closed-set change
stays marked, with a `replace:` reason, no lint exemption; the `check.mjs` skip now covers every
path that never touches Postgres; diff-review's `infra` bucket and tech-review gained tables (a
helper cannot open the skills); the changed-`check()` row names slice 1; the library bullets stay
id-less and join the owed-by-slice table. Kept for the record.

- The dispatcher delivers while holding its claim transaction (ADR-017), against pp-backend B-02's
  "no external call inside it": pp-backend writes it as the one named exception. Confirm, or amend.
- pp-database places the contract-step marker on the generated migration, not a custom one (a
  custom `DROP` would leave drizzle-kit's snapshot behind). Confirm with slice 2's DDL lint.
- Widening a closed set drops and re-adds its `CHECK`, which trips the DDL lint: pp-database marks
  every closed-set change. Confirm, or have the lint exempt a same-name drop and re-add.
- pp-backend wrote slice owners different from the brief (resume event in slice 2, each tick's shape
  with its target's slice): the build checklist wins; confirm.
- pp-backend added a secret-reading port to the port table (ADR-013 puts Secrets Manager in
  `packages/aws`).
- Sizes: pp-workflow, pp-general, pp-backend, pp-database, pp-testing and pp-infra SKILL.md run
  12.6 to 13.9 KB against the ~12 KB target. Phase 4 added lines to pp-workflow (Test tiers) and
  pp-testing; re-measure.
- From Phase 4: the after-apply `check.mjs` mandatory-tier triggers now skip `packages/core` and
  `sim/` for **every** trigger (the queue named only the projection trigger): core is pure and the
  simulator is evidence, not the path under test. Confirm against pp-workflow → Test tiers.
- From Phase 4: diff-review's new `infra` bucket has a one-paragraph section (pp-infra's `Never`,
  gate and Cost brake in code), not Correctness/Security tables like the other surfaces; and
  tech-review has no design-level section for pp-testing or pp-infra. Decide whether either earns
  a table.
- From Phase 4: the Open questions row "what `generate` emits for a changed `check()`" carries a
  tripwire (the first change that widens a closed set), not a slice, unlike the owed-by-slice rule.
  Safe either way (the SQL is read), but confirm the exception or name a slice.
- From Phase 4: the library-behavior Open questions rows (six bullets, about twenty facts) carry
  no `XX-UNN` id, so they are
  absent from architecture.md → Open questions owed by slice. Decide whether they need ids.

## Owner checkpoint after Phase 3

**Outcome (2026-10-16): O-11 to O-15 approved as recommended and applied.** O-11 and O-12 in
api-contract.md → Error codes and Conventions; O-13 as a "to amend in the slice 1 pre-proposal"
note on ADR-019's CLI line; O-14 in integrations.md → Decision — Neon and pp-testing (its
`[Unverified]` is resolved, so drop pp-testing's row from the Open questions queue above); O-15 in
pp-general → adding-things and pp-infra.

| ID | Question | Recommended |
| --- | --- | --- |
| O-11 | The SDK has no code for "no answer" (`fetch` throws). Widen `api_unavailable`'s Meaning to cover it (Ask-first registry edit) | Approve |
| O-12 | `internal_error` "Raised by" adds `apps/cli` and `apps/mcp` for an unexpected client-side failure, so a `--json` caller always gets an error object (Ask-first) | Approve |
| O-13 | commander 15.0.0 is npm `latest` (2026-05-29, ES modules only); 14 gets security fixes only, until May 2027. Amend ADR-019 to 15 | Amend in the slice 1 pre-proposal |
| O-14 | The Postgres major for Neon and the Testcontainers image (integrations.md names none; Neon supports 14–18) | 18, an exact minor tag pinned, recorded in integrations.md → Decision — Neon |
| O-15 | pp-infra uses one shared function construct from the second function, not pp-general's third duplicate: a copy that misses a cost-brake property is a cost or teardown defect | Accept as the infra-path exception |

Left to their slice pre-proposals, not the owner now: an error code for an unmatched read-API path
(slice 1, Ask-first then); the kill-switch function's home (slice 2; pp-infra recommends
`apps/kill-switch` plus a package shared with the re-arm script); the migration runner (slice 1,
programmatic `migrate()` recommended); MCP `outputSchema` (slice 5); `ledger --version` (slice 8).

## Consumer contract: what Phase 4 MUST keep

- These anchors survive: `pp-workflow#read-order`, `#definition-of-done`, `#test-tiers`;
  `pp-database#new-table-recipe`, `#never`; `pp-backend#never`, `#surfaces--sdk-cli-mcp`; and the
  Phase 2 and 3 fixed anchors in `stages/PHASE-2-BRIEF.md` and `stages/PHASE-3-BRIEF.md`.
- Every skill has `## Always`, `## Never` (each entry names its alternative) and a
  `## Gate — then read the diff` section.
- The rules the `check.mjs` scripts cite by owner skill stay in that skill's `Never` list, or the
  cited strings are updated in the same change.
