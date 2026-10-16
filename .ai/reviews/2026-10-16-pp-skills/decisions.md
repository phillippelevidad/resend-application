# pp-* skills build run 2026-10-16: decisions log

A historical record, not binding: every outcome below lives in the docs and skills it changed.

## Owner decisions (2026-10-16)

| ID | Question | Decision | Why |
| --- | --- | --- | --- |
| P-01 | Which stack do the skills prescribe for `apps/api` and the Lambda handlers? | Hono with `@hono/zod-openapi`, run through `@hono/aws-lambda` on Lambda and `@hono/node-server` locally. The other functions are plain typed handlers, each with a hand-wired composition root. Command and reader classes keep the `execute(input)` shape. The surfaces use `commander` 14 with `@commander-js/extra-typings` for the CLI, `@modelcontextprotocol/server` v2 for MCP, and `openapi-typescript` with `openapi-fetch` for the SDK. Lands as ADR-019 | CDK bundles with esbuild, and esbuild does not emit decorator metadata, so NestJS dependency injection needs build workarounds in CDK and in Vitest. NestJS also adds about 1 s of cold-start init, which falls on ingest's webhook timeout. `nestjs-zod` stops at Nest 11, now the legacy line. Resend's handbook names no backend framework, while Resend's CLI uses commander and Resend's MCP server uses SDK v2. The owner's patterns carry over without the container |
| P-02 | How is the skill set split? | 8 skills: `pp-workflow`, `pp-general`, `pp-backend`, `pp-database`, `pp-testing`, `pp-infra`, `pp-cli`, `pp-mcp` | Each skill loads by path. Testing is the project's evidence, so it gets its own skill |
| P-03 | Slice 1 runs ingest, worker and read API in one local process, yet "apps never import apps". How is that resolved? | Handler logic moves into packages: `packages/{ingest,worker,dispatcher,reconciler,api}` export factories over ports. Each `apps/*` becomes a thin runtime entry point: Lambda event adaptation plus its composition root. `apps/local` composes the same factories for local mode. `packages/shared` holds the kernel: logger, config, error base, clock, ports, token mint. Amends ADR-013 | The boundary stays absolute and pnpm's declared dependencies enforce it for free. Each package lands in the slice that first needs it |
| P-04 | How are the phases run? | Phases 0 and 1 run first, then the owner reviews the Phase 1 diff before Phase 2 | Every skill links the Phase 1 decisions |

## Settled in Phase 1 (decided by the docs or the decision lens)

Phase 1 fills these in as it applies them. Each row gives the tension, how it was resolved, and where
the resolution now lives.

| ID | Tension | Resolution | Lives in |
| --- | --- | --- | --- |
| S-01 | The log allow-list existed in three versions: the pp-backend stub, slice 1 and `internal_error` | One canonical list with an Allowed set and a Never set. `address_hash` is excluded, because no doc permits it in logs | [data-modeling.md → Log fields](../../data-modeling.md#log-fields), linked from slice 1 and the Risks row |
| S-02 | Are a Lambda's internal env vars part of the public contract? | Public variables are the ones a user sets for the CLI, SDK, MCP server, simulator or the deploy and setup commands. Variables CDK sets on a Lambda are internal and owned by `infra`. **Ask-first: held uncommitted for owner approval** | [api-contract.md → Conventions](../../api-contract.md#conventions) |
| S-03 | `token.list` is listed under Read operations but needs `operate` scope | Sections group operations by kind. Scope checks and MCP tool registration key on each entry's Scope | [api-contract.md → Read operations](../../api-contract.md#read-operations) |
| S-04 | Rule 2 says "any CLI-triggered call", yet the CLI never calls Resend | The rule now covers the Resend calls the API makes on a CLI or MCP request. A read-API route that calls Resend MUST restate the 2 × 2 req/s bound | [integrations.md → Locked rules](../../integrations.md#locked-rules-must) |
| S-05 | Runtime-role grants live in migrations, but the deploy command creates the role | Order: ensure the role exists, then migrate (each table-creating migration grants its DML), then deploy. The local setup and the Testcontainers harness follow the same order | [integrations.md → Decision — Neon](../../integrations.md#decision--neon), ADR-018 (amended) |
| S-06 | The definition of done requires `.env.example`, but the rules say "never commit `.env*`" | `.env.example` is excepted, with variable names only and never values. CBL-19 checks it | Root AGENTS.md (commit rules, Permissions), [CBL-19](../../check-before-launch.md) |
| S-07 | The docs said "Node.js LTS" while `engines` pins 24 | `nodejs24.x` on arm64 is supported until 2028-04-30 | [AWS-54](../../aws.md), Technology table |
| S-08 | The token mint has three callers and no home | `packages/shared` | [data-modeling.md → `api_tokens`](../../data-modeling.md#api_tokens--read-api-bearer-tokens), api-contract Auth |
| S-09 | "ESM" meant both the event source mapping and ES modules | In these docs "ESM" means event source mapping. The module system is written "ES modules" | [about.md → Domain vocabulary](../../about.md#domain-vocabulary) |
| S-10 | The SDK is generated from the API, but packages must not depend on server code | A committed `packages/sdk/openapi.json` exported from `packages/api`, committed generated types, and a `pnpm verify` drift stage | ADR-011 (amended) |
| S-11 | Does the 2026-07-28 MCP spec keep the tool-annotation fields? | Yes. Checked against `schema.ts`; the open question is resolved | [about.md](../../about.md#open-questions) (Resolved) |

## Settled in Phase 2

Code-level conventions no doc owned, decided by the docs and the decision lens. Each lives in
[pp-general](../../../.agents/skills/pp-general/SKILL.md) and its references.

| ID | Convention |
| --- | --- |
| G-01 | Packages `@ledger/<folder>` (`apps/*`: `@ledger/app-<folder>`), all `private` until slice 8 names them |
| G-02 | Internal packages ship TypeScript source; `exports` → `./src/index.ts`, the only barrel; `./testing` for test helpers |
| G-03 | Node 24 type stripping runs local `.ts` entry points: `.ts` relative imports, erasable syntax only, no `tsx`. `[Unverified]` under `node_modules`; slice 0 smoke test, fallback `tsx` |
| G-04 | One `tsconfig.base.json`: strict plus the settings type stripping requires; no `paths` |
| G-05 | Relative imports inside a package, the declared package name across; `core` ← `shared` ← the rest |
| G-06 | Biome enforces the boundaries; rule names checked against the installed version |
| G-07 | Kebab-case files with one role suffix from one table; `.test.ts`, `.prop.test.ts`, `.int.test.ts` beside the code |
| G-08 | One error base class with a registry `code`; throw, no `Result`; one mapping per surface |
| G-09 | Winston JSON to stdout only, allow-listed fields, constant messages; EMF lines from a small helper, no library |
| G-10 | Each composition root parses `process.env` once with Zod; `--env-file-if-exists=.env.local`, no `dotenv` |
| G-11 | The lockfile is the version truth; read the installed version's docs before coding |
| G-12 | The over-build procedure: step 0, third duplicate or a named ADR seam, the rejected-pattern table |
| G-13 | An address only in a request body; never in a URL, log, metric dimension, error text or MCP output |
| G-14 | Comments give the why and cite ids; no `.ai/` prose in code |

## Settled in Phase 3

Cross-cutting patterns, decided by the docs and the decision lens; slice-specific choices were left
to each slice's pre-proposal. Each lives in the skill named.

| IDs | Settled | Lives in |
| --- | --- | --- |
| B-01 to B-07 | Factories over ports; `main.ts` builds once at module scope; commands own their transaction; the port set; a hand-rolled `resend-client` limiter that throws mapped errors; one `.route.ts` per operation with the middleware order; the SDK build path; the SDK's `{ data, error }` (O-10) | [pp-backend](../../../.agents/skills/pp-backend/SKILL.md) |
| D-01 to D-07 | One table per schema file; repositories as one object of executor-first functions (owner-approved naming, 2026-10-16); `drizzle-kit generate` plus custom migrations; the contract-step marker; per-table grants in S-05 order; the connection-error classifier; `jsonb` governance; indexes that serve a named query | [pp-database](../../../.agents/skills/pp-database/SKILL.md) |
| T-01 to T-06 | Test files beside the code; Vitest `unit` and `int` projects; one container per run, a template clone per file, tests as the runtime role; arbitraries in `@ledger/core/testing`; fakes at the port; Svix signing on `node:crypto`; DLQ redrive evidence at the `packages/aws` adapter | [pp-testing](../../../.agents/skills/pp-testing/SKILL.md) |
| I-01 to I-04 | `NodejsFunction` with local esbuild, ES modules, `node24`, arm64, `@aws-sdk/*` bundled; stack layout; one `Template` assertion per cost-brake property; `.ts` scripts in `infra/scripts/`, never shadowing `pnpm deploy` | [pp-infra](../../../.agents/skills/pp-infra/SKILL.md) |
| C-01 to C-04 | commander with one `<noun>-<verb>.cli.ts` per command; exit `0`/`1`/`2` via `exitOverride()`; `styleText` colour on a TTY only; `202` waits by default | [pp-cli](../../../.agents/skills/pp-cli/SKILL.md) |
| M-01 to M-04 | MCP SDK v2 over stdio; `parseArgs`; operate tools only with an `operate` token and `--enable-operate`, failing closed; masks only, `isError` results, handlers never throw | [pp-mcp](../../../.agents/skills/pp-mcp/SKILL.md) |

## Owner checkpoint after Phase 2 (2026-10-16)

The owner approved the recommended option for each.

| ID | Decision | Lives in |
| --- | --- | --- |
| O-05 | `engines.node` `>=24.12 <25`: type stripping is Stable from v24.12 | Root `package.json`, [AWS-54](../../aws.md), pp-general |
| O-06 | Log fields by exact key, adding `error_code` (a registry code) | [data-modeling.md → Log fields](../../data-modeling.md#log-fields) |
| O-07 | `[!]` also means blocked on an unverified fact | [build-checklist.md → Legend](../../build-checklist.md#legend) |
| O-08 | `.env.example` lists public variables only; CDK-set ones live in `infra` | pp-workflow → Definition of done |
| O-09 | A `workspace:*` entry is not a third-party dependency, so not Ask-first | pp-general → adding-things |
| O-10 | The public SDK returns `{ data, error }` like Resend's SDK (RS-23); the one exception to "no `Result` type" | pp-general → errors, pp-backend → Surfaces |

## Open for the owner at the Phase 1 checkpoint

**Outcome (2026-10-16):** the owner approved the recommended option for O-01 to O-04, and all four
are applied. S-02 is committed, the slice 5 bullet is removed, the slice 1 drift-stage bullet is
added, and the local `AGENTS.local.md` carries the `.env.example` exception.

| ID | Question | Recommended |
| --- | --- | --- |
| O-01 | Approve S-02, a public-contract convention edit | Approve it. Without it, every CDK-set variable would be Ask-first |
| O-02 | The slice 5 Ships bullet "The about.md question on the MCP SDK line … closed when the package is picked" is now settled by ADR-019 and S-11 | Remove the bullet. This edits the card's scope |
| O-03 | ADR-011's drift stage has no Ships bullet | Add one to slice 1: "`pnpm openapi:export` writes the committed `packages/sdk/openapi.json`, and a `pnpm verify` stage fails when it or the generated SDK types drift; evidence: the stage fails on a stale fixture" |
| O-04 | Root AGENTS.md now allows `.env.example`. The git-ignored `AGENTS.local.md` still says "Never commit `.env*`" | Add the same exception to your local copy |
