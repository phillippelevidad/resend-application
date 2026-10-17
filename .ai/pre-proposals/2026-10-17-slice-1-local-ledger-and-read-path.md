# Pre-proposal — slice 1: Local ledger and read path

| Field | Value |
| --- | --- |
| **Slice** | 1 — [Local ledger and read path](../build-checklist.md#1--local-ledger-and-read-path) |
| Change name | `slice-1-local-ledger-and-read-path` → `openspec/changes/slice-1-local-ledger-and-read-path/` (`openspec/changes/` holds only `archive/2026-10-17-slice-0-foundations/`) |
| Date | 2026-10-17 |
| Card status | `[ ]` (0 of 13 `Ships` boxes ticked) |
| Depends on | 0 — `[x]` ([card](../build-checklist.md#0--foundations)) |
| Track | Spine (0 → **1** → 2 → …) |
| Touches | `packages/core`, `packages/shared`, `packages/db`, `packages/ingest`, `packages/worker`, `packages/api`, `packages/sdk`, `apps/local`, `apps/cli`, `apps/api` (stubbed), `sim`, `scripts/`, root `package.json`, `biome.json`, `vitest.config.ts`, `tsconfig.json`, `.env.example`, `.ai/` docs, root `AGENTS.md`, six skills' text |
| Earlier pre-proposal | None for this slice |
| Branch | `worktree-slice-1` |
| Checked | Not yet |

## 1. Why now

Slice 1 is the next spine card. It is the first slice that stores anything, and every later slice
writes through what it lands: slice 2 swaps the in-process queue for SQS behind the same queue port
and serves the same `createApi` app through `@hono/aws-lambda`. Slice 4's replays dedupe on the
`svix_id` key this slice puts in the migration. Slice 5's MCP tools call the SDK methods this slice
generates. Building ingest, the worker transaction and the read path locally first is the cheapest
point to prove them. The integration tier runs against real Postgres in seconds with no AWS
account ([ADR-013](../architecture.md#adr-013--pure-core-and-local-mode)). A migration is cheap to
regenerate only until it is merged to `main` or applied to a kept database
([data-modeling.md → Modeling conventions](../data-modeling.md#modeling-conventions-canonical)).
Two `[Unverified]` rows MUST be settled here: RS-U21 decides whether `email_recipients` is exact,
and RS-U22 decides whether real events verify locally at all
([architecture.md → Open questions owed by slice](../architecture.md#open-questions-owed-by-slice)).

## 2. Scope — the `Ships` list, verbatim

1. Local ingest verifies signature and timestamp on the raw body against the configured secret set, first match wins, and returns `200` with a fixed body or `401`; evidence: unit tests with old, new and both signatures, forged and stale requests.
2. `packages/db` Drizzle schema and expand-only migrations for `webhook_events`, `email_state`, `email_recipients` and `recipient_state`; CI applies every migration to a fresh Postgres before the integration tests (ADR-018).
3. Worker runs one transaction per message behind the in-process queue port, deduplicating on `svix_id` (ADR-004, ADR-013); evidence: Testcontainers tests for a duplicate insert, a crash between steps, and a NUL payload stored with U+FFFD, projected and committed ([Immutable ledger](../data-modeling.md#immutable-ledger)).
4. Recipient rows locked in sorted `address_hash` order after the email lock; evidence: concurrency integration test with two emails sharing a recipient.
5. Projections hold masks and keyed address hashes only, under an address-hash key the setup script generates once into `.env.local` ([PII & retention](../data-modeling.md#pii--retention)); evidence: integration test finding no raw address or subject in any projection row.
6. Unknown and non-email event types, and schema-failing payloads of known types, stored raw, projection skipped, metric emitted; evidence: unit test.
7. The shared logger emits only the fields in [data-modeling.md → Log fields](../data-modeling.md#log-fields), never a payload or an error's `message` / `detail` from parsing or Postgres; evidence: unit test feeding a failing message with a test address and a `CHECK` violation, asserting no log line holds the address or subject.
8. Minimal read API (OpenAPI, Zod), SDK, `ledger email <email_id>` and `ledger recipient <address>` with `--json` in the error shape, auth skipped only on loopback; evidence: SDK ↔ API contract tests and CLI `--json` output tests.
9. `pnpm openapi:export` writes the committed `packages/sdk/openapi.json`, and a `pnpm verify` stage fails when it or the generated SDK types drift ([ADR-011](../architecture.md#adr-011--one-contract-many-surfaces)); evidence: the stage fails on a stale fixture.
10. `pnpm sim --duplicates 0.2 --shuffle` against the local process (`apps/local`) passes invariants 1 and 2.
11. RS-U21 settled by the Ask-first two-recipient send to `delivered@resend.dev` and `bounced@resend.dev`, observed through `resend webhooks listen`, with the result in resend.md.
12. RS-U15 recorded from the Ask-first test-address sends, with simulator fixtures mirroring the observed sequences; RS-U18 checked by a read-only `GET /webhooks` after an interrupted `listen` session.
13. RS-U22 settled in the first approved `listen` session: the temporary webhook's secret read with `resend webhooks get <id>`, loaded into the local secret set, and one forwarded delivery verified by local ingest, with the result in resend.md.

## 3. Out of scope

The card's Deferred tail, verbatim: "SQS, DLQ, CDK and bearer tokens ([slice 2](../build-checklist.md#2--durable-ingest-on-aws)). DLQ operations ([slice 3](../build-checklist.md#3--operations-and-evidence-on-aws)). Rotation runbook and retired-secret test ([slice 4](../build-checklist.md#4--recovery)). `email.explainDelivery` and MCP ([slice 5](../build-checklist.md#5--mcp-server-and-contract-hardening)). `docker compose` local mode ([slice 2B](../build-checklist.md#2b--local-mode-queue-and-docker-compose))."

Also out, each with its carrier:

| Not built here | Carried by / tripwire |
| --- | --- |
| The `ingest.rejected{reason}` metric and how `reason` tells a stale timestamp from a bad signature | [slice 4](../build-checklist.md#4--recovery) ([pp-backend → ingest-and-worker](../../.agents/skills/pp-backend/references/ingest-and-worker.md#ingest-in-order), step 3). Slice 1 answers `401` and logs one constant line |
| The secret-reading port, its 5-minute TTL cache and the Secrets Manager adapter (ADR-009) | [slice 2](../build-checklist.md#2--durable-ingest-on-aws) ([pp-backend → Ports](../../.agents/skills/pp-backend/references/composition.md#ports): "Secret reading … Lands 2"). Slice 1 ingest takes its secret set as typed config (D9) |
| The EMF line writer behind the metrics interface | [slice 2](../build-checklist.md#2--durable-ingest-on-aws), with the first Lambda. Slice 1 ships the interface and the local writer through the logger (D16) |
| The worker's ADR-015 branch (fresh-connection retry, ESM pause), pool `connectionTimeoutMillis` / `query_timeout`, the runtime role's server-side timeouts | [slice 2](../build-checklist.md#2--durable-ingest-on-aws) ([pp-database → Connection](../../.agents/skills/pp-database/references/schema-and-repositories.md#connection), [Grants](../../.agents/skills/pp-database/references/migrations-and-grants.md#grants): "values: the slice 2 pre-proposal's") |
| The `DELETE` / `CREATE TABLE` refusal test as the runtime role; the migration DDL lint | [slice 2](../build-checklist.md#2--durable-ingest-on-aws) |
| A durable local queue: the in-process queue loses enqueued, uncommitted events if `apps/local` dies | Slice 2 (SQS) and [slice 2B](../build-checklist.md#2b--local-mode-queue-and-docker-compose) (`local_queue_messages`). Local traffic is simulator and test-address traffic only |
| `health.get`, `ledger health`, token operations | Slice 2 ([api-contract.md](../api-contract.md#healthget)) |
| A `bin` entry for `ledger` | [slice 8](../build-checklist.md#8--npm-release) (the npm bundle). Slice 1 walks it as `pnpm -s ledger` (D33) |
| Scripting the per-`listen`-session secret load (RS-U22's manual copy) | Tripwire: the second walk, in any slice, that runs a `listen` session. Off the adopter's path (§19) |
| The SDK's read retries | [slice 5](../build-checklist.md#5--mcp-server-and-contract-hardening) ([pp-backend → sdk](../../.agents/skills/pp-backend/references/sdk.md#retries-slice-5)) |
| The shared read-API contract suite in `@ledger/api/testing` | Slice 2, when `@hono/aws-lambda` is its second runner ([pp-testing → Shared contract suites](../../.agents/skills/pp-testing/references/vitest-layout.md#shared-contract-suites): "written when the second implementation lands") |
| Projection rebuild on a logic or column change | Tripwire: the first change after slice 1 that alters projection output or adds a projection column ([Deferred (YAGNI)](../architecture.md#deferred-yagni)) |

## 4. Prerequisites

- **Slices:** slice 0 is `[x]`. Nothing blocks.
- **Ask-first approvals:** the table in §7, every row owner-approved 2026-10-17 except the live Resend writes, which are approved one at a time when each runs.
- **Owner ops** (§25): Docker running (the `docker` stage, Testcontainers, compose Postgres). For
  Ships 11–13 only: a Resend API key (`RESEND_API_KEY`) in the git-ignored `.env.local`, the Resend
  CLI installed, a public tunnel of the owner's choice for `listen --url` (RS-33), and approval of
  each `listen` session and each test send.
- **Env vars:** `DATABASE_URL`, `LEDGER_ADDRESS_HASH_KEY`, `LEDGER_SIMULATOR_SECRET` and `LEDGER_URL` are written by `pnpm db:setup` when unset (D31). `LEDGER_WEBHOOK_SECRETS` is set by hand per `listen` session (D36). `LEDGER_TOKEN` takes any non-empty value in slice 1 (D27).
- **Open questions the slice depends on:** RS-U21 and RS-U22 (MUST settle), RS-U15 and RS-U18 (Ships 11–13). RS-U14 is slice 2's, but a negative answer blocks Ships 11–12 (§24).

## 5. Reality check — per-`Ships`-item verdict

Checked against the repo at `04dc19e` on 2026-10-17.

| # | Verdict | Evidence | What remains |
| --- | --- | --- | --- |
| 1 | **absent** | `packages/ingest/src/index.ts:2` is `export {}`. `resend` is not installed: no `package.json` lists it | Everything: factory, verify loop, fixed bodies, the local mount, the unit tests |
| 2 | **absent** | `packages/db/src/index.ts:2` is `export {}`. No `drizzle/` folder. `drizzle-orm`, `pg`, drizzle-kit and Testcontainers are not installed. `vitest.config.ts:17` leaves the `int` project without a `globalSetup` ("lands in slice 1"). `scripts/verify.mjs:16` has no `int` stage | Schema, migrations, grants, the harness, the `int` stage |
| 3 | **absent** | `packages/worker/src/index.ts:2` is `export {}`. `packages/shared/src/index.ts:2` is `export {}` (no queue port). Core has no sanitizer | Queue port and in-process queue, sanitizer, `RecordEventCommand`, the integration tests |
| 4 | **absent** | No worker code | Lock order in the command, the concurrency test |
| 5 | **partial** | Masks exist in core: `mask-address.ts`, `mask-from.ts`, `mask-text.ts`, `normalize-address.ts`. `projectEmail` already masks recipient rows (`project-email.projection.ts`, `newRecipientRow`) and keys them by the caller's `recipientKeys` (`ledger-event.ts:4-6`: "slice 1 passes `to_hashes`"). **No keyed hash function** exists in core, and no setup script exists | `hashAddress` in core, the setup command, the PII integration test |
| 6 | **partial** | `projectEmail` already skips unknown, non-email and schema-failing events without throwing (`project-email.projection.ts`, `toProjectedEvent`; test `project-email.projection.test.ts`). Nothing stores them or emits a metric | Raw storage, the metric, the unit test (D19) |
| 7 | **absent** | No logger. `apps/local/src/main.ts:10,45` writes hand-built JSON lines | Logger, allow-list, the unit test; `apps/local` moves to it |
| 8 | **partial** | `createApi()` is routeless (`packages/api/src/create-api.ts:5-7`). `apps/local` already refuses a non-loopback `--host` (`apps/local/src/main.ts:33-37`, `is-loopback-host.ts`, e2e test `main.e2e.test.ts:110`). The CLI scaffold has the program, the output writer and the exit mapping but no command (`apps/cli/src/create-program.ts:17`). `packages/sdk/src/index.ts:2` is `export {}`. `openapi-fetch` is not installed | Routes, readers, mappers, error handlers, SDK, two commands, the contract and `--json` tests |
| 9 | **absent** | No `openapi:export` script in root `package.json`; no `packages/sdk/openapi.json`; `openapi-typescript` not installed | Export, generation, the `drift` stage with its canary |
| 10 | **partial** | `pnpm sim` exists offline: it prints a projection and sends nothing (`sim/src/main.ts:10`). `@ledger/core/testing` has `ledgerHistory` | The live mode, the invariant checkers, mandatory address labels (C10) |
| 11 | **absent** | `resend.md` RS-U21 row: `[Unverified]` | The Ask-first experiment and the resend.md update |
| 12 | **absent** | RS-U15 and RS-U18 rows: `[Unverified]` | The experiments, fixtures, resend.md |
| 13 | **absent** | RS-U22 row: `[Unverified]` | The experiment and resend.md |

`openspec/specs/` holds `address-masking`, `core-import-boundary`, `event-schemas`, `projections`,
`simulator` and `verify-gate`. Slice 1 modifies `simulator`, `verify-gate` and `address-masking`
and adds seven capabilities (§23).

## 6. Contradictions and how each resolves

| # | Sources | Governs | Resolution |
| --- | --- | --- | --- |
| C1 | Ships 5: "an address-hash key the setup script generates once into `.env.local`". [integrations.md → Decision — Neon](../integrations.md#decision--neon) and [pp-database → Grants](../../.agents/skills/pp-database/references/migrations-and-grants.md#grants) call it "the local setup command". None exists (`git ls-files scripts` lists no setup) | Both, same thing | Slice 1 lands it as `pnpm db:setup` (D31): it fills `.env.local`, ensures the runtime role and migrates, in the S-05 order. `pnpm dev:full` calls it |
| C2 | [pp-backend → Ports](../../.agents/skills/pp-backend/references/composition.md#ports): secret reading "Lands 2", yet the same row says apps/local passes a static implementation "so the factory always takes the port" | The table's "Lands 2" | Slice 1's ingest takes `{ resend, simulator }` as typed config (D9). Slice 2 introduces the port, its TTL cache and the AWS adapter together |
| C3 | [api-contract.md → email.get / recipient.get](../api-contract.md#emailget) list `database_unavailable` under **Slices: 1**. [pp-database → classification](../../.agents/skills/pp-database/references/schema-and-repositories.md#connection-error-classification): "Where it is applied … is the slice 2 pre-proposal's to settle", and "the slice 2 classification unit test pins each row" | api-contract.md (a doc beats a skill, [pp-general → Precedence](../../.agents/skills/pp-general/SKILL.md#precedence)) | Slice 1 lands the classifier in `packages/db` with its unit test and applies it in the read API's `onError` (D22). The worker's ADR-015 branch stays slice 2. pp-database's two sentences are corrected (§22). This moves evidence earlier and loosens nothing |
| C4 | [architecture.md → Technology](../architecture.md#technology) lists `ingest.rejected{reason}` in the metric set. [pp-backend → ingest-and-worker](../../.agents/skills/pp-backend/references/ingest-and-worker.md#ingest-in-order) step 3 gives the `reason` mechanism to "the slice that ships the metric (slice 4)" | The skill's slice assignment: the Technology table fixes the set, not the slice | Slice 1 does not emit `ingest.rejected` (§3). No doc edit |
| C5 | [data-modeling.md → `webhook_events`](../data-modeling.md#webhook_events--the-immutable-ledger) gives `type` as `text, no CHECK` with no nullability. ADR-004: schema-failing events are stored with "typed columns null where unreadable" | ADR-004 | `type` is nullable, null when the payload carries no string `type` (D17, §8). A `NOT NULL` would dead-letter a verified event for its content, which ADR-004 forbids. The field table gains the nullability (§22) |
| C6 | `.env.example:12`: `LEDGER_SIMULATOR_SECRET` is "for a deployed stack … (ADR-016, slice 3)". [ADR-016](../architecture.md#adr-016--the-simulator-reaches-aws-only-through-an-opt-in-simulator-secret): "Locally (slices 1 and 2B), ingest reads an optional `LEDGER_SIMULATOR_SECRET` from `.env.local`" | ADR-016 | The `.env.example` comment is corrected (§22) |
| C7 | [rsa-manual-test → environment.md](../../.agents/skills/rsa-manual-test/references/environment.md#surfaces-by-slice): "(no `bin` until slice 1)". [pp-cli → Stack and layout](../../.agents/skills/pp-cli/SKILL.md#stack-and-layout): "the npm bundle is slice 8's" | Neither binds a `bin` to slice 1; pp-cli gives the start mechanism to this pre-proposal | No `bin` in slice 1. A root `pnpm ledger` script runs the CLI with `.env.local` (D33). environment.md is corrected (§22) |
| C8 | `packages/core` already exports `webhookEnvelopeSchema` for the Resend payload `{ type, created_at, data }` (`webhook-envelope.schema.ts:3-9`). ADR-001 calls the queue message `{svixId, receivedAt, source, rawBody, headers subset}` "the envelope" | Both, different things | The queue message gets its own `ingestEnvelopeSchema` (D12). The existing payload schema keeps its name: renaming it touches a done spec for no gain |
| C9 | ADR-004 prose: "every projection row is created with `INSERT … ON CONFLICT DO NOTHING` before its `SELECT … FOR UPDATE`". [data-modeling.md → `email_recipients`](../data-modeling.md#email_recipients--outcome-per-email-and-recipient): "Locking: the row is written under the email's lock" | ADR-004, read literally | `email_recipients` rows are also inserted, then locked, then updated, after the `recipient_state` locks (D14). Under the email lock this adds no contention and no new lock order |
| C10 | [pp-testing → simulator.md](../../.agents/skills/pp-testing/references/simulator.md#seed-and-determinism): namespaced `+label` addresses keep runs apart on a persistent store. `ledgerHistory`'s pool makes the label optional (`ledger-history.ts`, `fc.option(fc.nat(9))`), so bare `delivered@resend.dev` recipients fold every run into one `recipient_state` row, breaking invariant 2 on the second run against compose Postgres | simulator.md's intent | `ledgerHistory` gains an option that labels every address with the run's namespace, and `pnpm sim` always sets it (D38) |
| C11 | Slice 0's done bullet 8: "`pnpm sim` prints the projection of a generated, shuffled history". Slice 1's `UI surfaces`: `pnpm sim --duplicates 0.2 --shuffle` "against the local process", with no target flag | Both, if the mode follows `LEDGER_URL` | `.env.example:8,18` already says `pnpm sim` reads `LEDGER_URL` and `DATABASE_URL` from slice 1. A run with `LEDGER_URL` set goes live; without it, slice 0's offline run is unchanged and its e2e test keeps passing (D37) |
| C12 | `apps/api/src/api.handler.ts:6` serves `handle(createApi())`, and root AGENTS.md → Projects describes that scaffold. Slice 1's `createApi` takes its dependencies (D21), which `apps/api` cannot build before slice 2 | ADR-013 (apps compose; `apps/api`'s logic lands in slice 2) | `apps/api`'s handler becomes an `export {}` stub like `apps/ingest` and `apps/worker` until slice 2. The Projects text is corrected (§22) |
| C13 | [pp-testing → harness](../../.agents/skills/pp-testing/references/postgres-harness.md#lifecycle-one-run) step 2: the role-ensure function "also applies the deploy command's role-level `idle_in_transaction_session_timeout` and `lock_timeout`". [integrations.md](../integrations.md#decision--neon): "values fixed by slice 2" | integrations.md | Slice 1's role-ensure creates the role only. Slice 2 adds the two `ALTER ROLE … SET`, their values and the idle-holder test. pp-testing's step 2 gains "(from slice 2)" (§22) |
| C14 | [about.md → library bullets](../about.md#open-questions): "identity on `bigint`" and "whether an identity sequence needs no `INSERT` grant" are owed by slice 1. None of slice 1's four tables has an identity column (§8; [Base fields](../data-modeling.md#base-fields--the-checklist-for-every-new-model): natural PKs) | The code: nothing in slice 1 can check them | Both items move to slice 2, whose `api_tokens` is the first identity column. They sit in slice 1's "MAY close safe either way" column ([Open questions owed by slice](../architecture.md#open-questions-owed-by-slice)), so moving them is a fact correction. The edit still goes through the independent-helper gate at apply (§22) |
| C15 | [pp-general → logging-and-pii](../../.agents/skills/pp-general/references/logging-and-pii.md#logger): "Console transport to stdout only". [pp-testing → fakes](../../.agents/skills/pp-testing/references/fakes-and-doubles.md#which-double-per-seam): "The real logger, its output captured; how it takes a stream is the slice 1 pre-proposal's" | Both | Production uses the Console transport. A test passes a stream and gets a Stream transport with the same format and allow-list (D15) |
| C16 | [pp-backend → read-api](../../.agents/skills/pp-backend/references/read-api.md#errors-one-onerror-one-defaulthook): "An unmatched path has no registry code today … adding a code is Ask-first". [pp-general → errors](../../.agents/skills/pp-general/references/errors.md#one-mapping-per-surface): "a raw framework error reaching a client is a defect" | Both, so the only lawful path is a new registry code | `route_not_found` (404) goes on the Ask-first list (§7, D23). Hono's default `404 Not Found` text is rejected: it is a raw framework response |

## 7. Decisions

**Ask-first approvals** (owner, 2026-10-17, one itemized round; every recommended option taken, `resend` at `6.33.0`):

| Item | Exact scope | Status | Used by |
| --- | --- | --- | --- |
| `drizzle-orm` | `0.45.4` exact (npm `latest`, published 2026-10-08), `dependencies` of `packages/db` | owner-approved 2026-10-17 | Group 4 |
| `pg` + `@types/pg` | `pg` `8.23.1` exact (2026-09-30), `dependencies` of `packages/db`; `@types/pg` `8.23.1` exact, `devDependencies` of `packages/db` | owner-approved 2026-10-17 | Group 4 |
| `drizzle-kit` | `0.31.11` exact (2026-09-21), `devDependencies` of `packages/db`. It brings `tsx` and `esbuild` transitively, used only by drizzle-kit to load `drizzle.config.ts` and the schema. No Ledger entry point runs on `tsx` ([pp-general → Never](../../.agents/skills/pp-general/SKILL.md#never) targets our own runners) | owner-approved 2026-10-17 | Group 4 |
| `@testcontainers/postgresql` | `12.2.1` exact (2026-10-13; pulls `testcontainers` `^12.2.1`), `devDependencies` of `packages/db` only ([pp-testing → The image](../../.agents/skills/pp-testing/references/postgres-harness.md#the-image)) | owner-approved 2026-10-17 | Group 4 |
| `resend` | `6.33.0` exact (2026-10-14), `dependencies` of `packages/ingest`, for `webhooks.verify` only. This is the version RS-02, RS-22 and RS-23 were verified against, and it wraps `standardwebhooks` `1.1.1`. Its source, read 2026-10-17: `Webhooks.verify` → `new Webhook(secret).verify(payload, headers)`; `new Resend()` throws `Missing API key` without one (D10). `6.34.1` (2026-10-16) is the alternative | owner-approved 2026-10-17 | Group 5 |
| `winston` | `3.19.0` exact (2025-12-07), `dependencies` of `packages/shared` | owner-approved 2026-10-17 | Group 2 |
| `openapi-fetch` | `0.17.0` exact (2026-02-11), `dependencies` of `packages/sdk` | owner-approved 2026-10-17 | Group 8 |
| `openapi-typescript` | `7.13.0` exact (2026-02-11), `devDependencies` of `packages/sdk`. Declares peer `typescript ^5.x`; the repo pins TypeScript `7.0.2` (§24) | owner-approved 2026-10-17 | Group 7 |
| `typescript` 5 fallback | `5.9.3` exact, `devDependencies` of `packages/sdk` only, **added only if** `openapi-typescript` fails to generate under 7.0.2. Never in the root `tsc` pass | owner-approved 2026-10-17 | Group 7, conditional |
| `zod` in `packages/shared`, `packages/db`, `packages/sdk`, `packages/worker` | `4.6.7` exact, the scaffold version ADR-019 ratified (owner, 2026-10-16) | ratified — no new approval ([ADR-019](../architecture.md#adr-019--application-and-surface-stack)) | Groups 2–8 |
| `@hono/node-server` in `apps/local` (already there); `hono` + `@hono/zod-openapi` in `packages/api` (already there) | Installed versions | ratified — scaffold packages (ADR-019) | Groups 7, 9 |
| Public env var `LEDGER_WEBHOOK_SECRETS` | Comma-separated `whsec_…` values: the local Resend signing-secret set, verified before the simulator secret. Optional. Read by `apps/local` ingest. Added to [api-contract.md → Conventions](../api-contract.md#conventions) and `.env.example` | owner-approved 2026-10-17 | Groups 5, 9, 11 |
| Public env var `LEDGER_ADDRESS_HASH_KEY` | 64 hex characters (32 random bytes): the deployer-held address-hash key ([PII & retention](../data-modeling.md#pii--retention)). Written once by `pnpm db:setup`. Read by `apps/local` (worker, read API) and `pnpm sim`; from slice 2, by the deploy command for the `ledger/database` secret | owner-approved 2026-10-17 | Groups 3, 6, 7, 9, 10 |
| Error code `route_not_found` | `404`; meaning "No operation at this method and path"; hint "Check `LEDGER_URL`, and that the CLI or SDK version matches the API's"; docs: runbook; raised by the `packages/api` not-found handler. New row in [Error codes](../api-contract.md#error-codes) (C16, D23) | owner-approved 2026-10-17 | Group 7 |
| CI change | Two new stages in `scripts/verify.mjs`, which CI runs unchanged: `drift` (after `typecheck`) and `int` (after `unit`). No edit to `.github/workflows/ci.yml` | owner-approved 2026-10-17 | Groups 4, 7 |
| Schema | The four tables of §8 and the two new migrations `create-ledger-tables` and `grant-ledger-tables`. Pure expand; unfrozen until merged to `main` | owner-approved 2026-10-17 | Group 4 |
| Live Resend writes | Each `resend webhooks listen` session (it creates a temporary webhook, RS-33), and three test sends: `delivered@resend.dev` + `bounced@resend.dev` together, `complained@resend.dev`, `suppressed@resend.dev`; any deletion of a leftover temporary webhook. **Approved one at a time, when each runs**, never in this round ([integrations.md → Locked rules](../integrations.md#locked-rules-must), rule 8) | held — per action at walk time | Group 11 |

Anything else (another dependency, version or stage, a `ci.yml` edit, another env var or code)
stops at apply. Workspace `"@ledger/<pkg>": "workspace:*"` entries are boundary declarations, not
Ask-first ([pp-general → adding-things](../../.agents/skills/pp-general/references/adding-things.md#add-a-dependency), O-09).

### Core and kernel

**D1 — The keyed address hash lives in core.** `hashAddress(key: Uint8Array, address: string): string`
returns `<key_id>.<hex HMAC-SHA-256(key, normalizeAddress(address))>`. `addressHashKeyId(key)` returns
the first 8 hex characters of `HMAC-SHA-256(key, "ledger:key-id")`. Both use `node:crypto`'s
`createHmac`: a Node built-in, not an AWS, Postgres or Resend import, so core stays pure under
ADR-013. `hashAddress` normalizes inside, so no caller can hash an unnormalized address.
Authority: [PII & retention](../data-modeling.md#pii--retention) ("one function each, in `packages/core`"),
[pp-general → PII in code](../../.agents/skills/pp-general/references/logging-and-pii.md#pii-in-code).
Rules out: an inline HMAC anywhere else; an unkeyed hash.

**D2 — The key's form.** `LEDGER_ADDRESS_HASH_KEY` is 64 lowercase hex characters, decoded to 32 bytes
at the composition root and passed in as config. A value that is not 64 hex characters fails the boot
assertion, naming the variable. Authority: data-modeling ("32 random bytes held by the deployer");
[config-and-env](../../.agents/skills/pp-general/references/config-and-env.md#secrets) (an empty key
"hashes under the wrong key silently").

**D3 — The sanitizer.** A pure core function, `sanitizeForJsonb(value: unknown): { value: unknown; sanitized: boolean }`.
It replaces every `\u0000` and every lone UTF-16 surrogate with U+FFFD in every string, object keys
included, because `jsonb` rejects them in keys too. It leaves valid surrogate pairs intact, and
`sanitized` is true when anything was replaced. Authority: ADR-004;
[pp-database → Unstorable characters](../../.agents/skills/pp-database/references/schema-and-repositories.md#unstorable-characters).

**D4 — The error registry mirror in core.** `error-codes.ts` exports `errorCodes` (the `as const`
tuple of every [registry](../api-contract.md#error-codes) code, `route_not_found` included once
approved), `errorCodeSchema` (its Zod enum), and `errorRegistry`: per code, its HTTP status (`null`
for run-outcome and client-side codes), the default `message`, the hint and `docs`. `docs` is the
Resend page the registry names, or `` `${RUNBOOK_BASE_URL}#${code}` ``. `RUNBOOK_BASE_URL` is one
constant: the `origin` remote's public GitHub tree plus `/blob/main/docs/runbook.md`. The runbook
file is slice 3's, so those links 404 until then. That is a gap a named later slice carries. The
drift test against the doc is slice 5's. Authority: [Error codes](../api-contract.md#error-codes)
("the enum lands with the first error in slice 1"); [pp-general → errors](../../.agents/skills/pp-general/references/errors.md#one-base-class).

**D5 — `LedgerError` and `ConfigError` in `packages/shared`.** `LedgerError` is pp-general's class
verbatim (`code`, `message`, `hint`, `docs`, `cause`, fields assigned in the body). `ConfigError extends Error`
is thrown by the config loader, and the CLI and `apps/local` branch on it (exit `2` / exit `1`). It
carries the variable's name and never its value. Authority: [errors.md](../../.agents/skills/pp-general/references/errors.md);
[pp-cli → anatomy](../../.agents/skills/pp-cli/references/command-anatomy.md#the-composition-root) (config error → exit `2`).

**D6 — Config loader.** `loadConfig(schema, env)` in `packages/shared` parses with Zod. On failure it
throws `ConfigError` naming each failing path and its expectation, never a value. Each composition
root has its own `<root>.config.ts`. Authority: [config-and-env](../../.agents/skills/pp-general/references/config-and-env.md).

**D7 — Ports landing in slice 1:** queue (`queue.port.ts` → `QueuePort`), clock (`clock.port.ts` →
`ClockPort { now(): Date }`), metrics (`metrics.port.ts` → `MetricsPort`, D16). Exactly the three
[pp-backend → Ports](../../.agents/skills/pp-backend/references/composition.md#ports) marks "Lands 1".
The test fakes are `FakeClock` and a recording metrics double, in `@ledger/shared/testing`.

**D8 — The in-process queue.** `packages/shared/src/in-process-queue.adapter.ts` → `InProcessQueueAdapter`
implements `QueuePort.enqueue(envelope)` by serializing the envelope to a JSON string body, as SQS
holds it, and pushing `{ messageId, body }`. It adds the local consumer the port needs:
`start(consumer)` delivers up to 10 messages per call, mirroring the ESM batch size (ADR-008),
`consumer(messages) → { batchItemFailures }`. Failed messages are redelivered after 1 s, up to 5
receives (ADR-008's `maxReceiveCount` default, AWS-09). They then move to an in-memory dead list with
an error log line carrying `svix_id`. So no message is dropped without reaching a dead store, per the
Reliability core's No-loss design test. The `messageId` is a counter. Delivery is at-least-once and
order is not preserved by contract (ADR-002, ADR-003). It lives in `packages/shared` because it does
no I/O. Authority: ADR-013 ("slice 1 runs both in one local process … with an in-process implementation").

### Ingest

**D9 — Ingest factory.** `createIngest({ secrets: { resend: readonly string[]; simulator: string | undefined }, queue, clock, logger, metrics })`
returns `(request: { rawBody: string; headers: { 'svix-id'?: string; 'svix-timestamp'?: string; 'svix-signature'?: string } }) => Promise<IngestResponse>`.
`IngestResponse` is `{ status: 200 | 401 | 503; body: string }`. In order
([pp-backend → Ingest, in order](../../.agents/skills/pp-backend/references/ingest-and-worker.md#ingest-in-order)):

1. Any of the three `svix-*` headers missing → `401`, nothing enqueued.
2. `webhooks.verify` once per secret: the Resend set in configured order, then the simulator secret.
   The first match wins and sets `source` (`live` / `simulated`). Any throw counts as no match.
3. No match → `401`, nothing enqueued, one log line `ingest.request_rejected` with no fields. The
   `svix-id` of an unverified request is attacker-controlled, so it is not logged.
4. Envelope built (D12), `receivedAt` from the clock port.
5. `queue.enqueue` rejects → `503`, log `ingest.enqueue_failed` with `svix_id` and `error_name`.
6. Resolved → `200`, metric `ingest.accepted` (D16) with `svix_id` and `type` (read from the payload
   `verify` returned, a string or absent).

At least one secret MUST be configured overall, checked at boot (D29), because an empty set would
`401` every delivery ([ingest-and-worker](../../.agents/skills/pp-backend/references/ingest-and-worker.md#ingest-in-order)
step 1: an infra fault never answers `401`). Authority: ADR-001, ADR-009, ADR-016.

**D10 — The `Resend` instance ingest verifies with.** In `resend` 6.33.0, `new Resend()` throws
`Missing API key` unless a key is passed or `RESEND_API_KEY` is set (`dist/index.mjs`, the `Resend`
constructor). Ingest holds no API key ([Secrets layout](../integrations.md#secrets-layout): ingest
reads only signing secrets). It constructs `new Resend('ingest-verifies-only')` once at factory time,
with a comment citing RS-02 and this decision. The constant is not a key: it never reaches a request,
because ingest makes no API call, and it does not match the `re_` gitleaks rule. Alternative
rejected: importing `standardwebhooks` directly. That is a second dependency for the same call, and
[integrations.md → Locked rules](../integrations.md#locked-rules-must) rule 1 names `webhooks.verify`.

**D11 — Fixed ingest bodies.** `Content-Type: text/plain; charset=utf-8`; `200` → `ok`; `401` →
`unauthorized`; `503` → `unavailable`. Exported constants from `packages/ingest`, so slice 2's Lambda
reuses them. They carry no payload, PII or secret, because Resend stores them (RS-12, Constraint 11).
Ingest is not an operation, so no error shape applies ([Ingest boundary](../api-contract.md#ingest-boundary)).
A correctly signed body that is not JSON fails `verify`, which ends with `JSON.parse`, so it answers
`401`. RS-26 says every Resend payload is a JSON object, so no real event takes that path. Authority:
[pp-backend → ingest-and-worker](../../.agents/skills/pp-backend/references/ingest-and-worker.md#ingest-in-order)
step 6 ("Its exact bytes are the slice 1 pre-proposal's").

**D12 — The ingest envelope.** `packages/core/src/ingest-envelope.schema.ts` → `ingestEnvelopeSchema`:
`{ svixId: string (min 1), receivedAt: ISO 8601 with offset, source: 'live' | 'simulated', rawBody: string, headers: { 'svix-timestamp': string } }`.
The headers subset is `svix-timestamp` alone, for forensics. `svix-signature` is dropped: nothing
re-verifies a stored event ([Immutable ledger](../data-modeling.md#immutable-ledger)). `eventSourceSchema`
(`['live', 'simulated']`) is exported beside it as the `source` `CHECK`'s tuple. Authority: ADR-001;
[pp-database → jsonb](../../.agents/skills/pp-database/references/indexes-and-jsonb.md#jsonb) ("the envelope schema the queue port uses").

### Worker

**D13 — Worker factory.** `createWorker({ db, clock, logger, metrics, addressHashKey })` returns
`{ processBatch(messages: readonly { messageId: string; body: string }[]): Promise<{ batchItemFailures: { itemIdentifier: string }[] }> }`.
It returns an object because slice 2 adds `resume` for ADR-015's second event kind
([pp-backend → Case-by-case](../../.agents/skills/pp-backend/SKILL.md#case-by-case)). Messages run
one at a time on the function's single size-1 pool (ADR-005, [composition](../../.agents/skills/pp-backend/references/composition.md#the-composition-root)).
Each message gets its own result, and the failure list is built from those results, never assumed
(AWS-05).

**D14 — `RecordEventCommand`, one transaction per message** (`packages/worker/src/record-event.command.ts`), at READ COMMITTED:

1. Parse the body with `ingestEnvelopeSchema`, then `JSON.parse(rawBody)`. Either failing is a code
   defect: the message fails and is redelivered (D8).
2. `sanitizeForJsonb(payload)`. When `sanitized`, emit `worker.payload_sanitized`.
3. Extract the typed columns once (D17) and `INSERT … ON CONFLICT (svix_id) DO NOTHING RETURNING svix_id`.
   No row returned → duplicate: emit `worker.duplicates`, commit, done.
4. Not projectable (D17) → emit `projection.unknown_event_type`, commit, done.
5. Lock: `INSERT INTO email_state (email_id) … ON CONFLICT DO NOTHING`, then `SELECT … FOR UPDATE`.
   Then for each of the **new event's** distinct `to_hashes`, sorted by code unit:
   `INSERT INTO recipient_state … ON CONFLICT DO NOTHING`, then `FOR UPDATE`. Then the same, in the
   same order, for `email_recipients (email_id, address_hash)` rows (C9).
6. Read inputs after the locks: every `webhook_events` row with this `email_id` (`svix_id`, `type`,
   `event_created_at`, `to_hashes`, `payload`) as `LedgerEvent[]`, with `recipientKeys` = `to_hashes`.
7. `projectEmail(emailId, events)`. `UPDATE email_state` with every column, then write every
   `email_recipients` row of the projection (insert-then-lock as in step 5 for rows the new event did
   not name, then `UPDATE`).
8. For each locked hash, read every `email_recipients` row with that `address_hash`, call
   `projectRecipient(hash, rows)`, and `UPDATE recipient_state`. Only the new event's recipients are
   recomputed: an event folds only into rows its own `data.to` names (RS-27, `foldRecipient` in
   `project-email.projection.ts`), so no other `recipient_state` input changed.
9. Commit. Emit `worker.processing_lag` (clock now − `receivedAt`, in ms).

The placeholder values a lock insert writes (status null, counts 0, deliverability `ok`, the new
event's mask) are overwritten in the same transaction before commit, so no other transaction ever
reads them. No external call happens inside the transaction. A throw anywhere rolls everything back,
including the `webhook_events` insert. Authority: ADR-004, ADR-003, [data-modeling.md → Idempotency keys](../data-modeling.md#idempotency-keys),
[pp-backend → commands-and-readers](../../.agents/skills/pp-backend/references/commands-and-readers.md#a-command-owns-its-transaction).
Rules out: patching a projection; a read-then-write guard; any lock order but email → `recipient_state` sorted → `email_recipients` sorted.

### Logging and metrics

**D15 — The logger takes an optional stream** (C15). `createLogger({ functionName, stream? })` in
`packages/shared` returns `{ info, warn, error }(message: string, fields?: LogFields)`. Without
`stream`: a Winston Console transport to stdout (production, `apps/local`). With `stream` (any
`{ write(chunk: string) }`): a Winston Stream transport, used by tests. One format serves both:

- It writes `level` (lowercase), an RFC 3339 `timestamp`, `function_name`, and `cold_start` when the
  caller sets it.
- It keeps only allow-listed keys: the exact keys in [Log fields](../data-modeling.md#log-fields),
  plus keys ending `_count` or `_ms` whose value is a number.
- Under an allowed key it keeps only a string, number or boolean.
- It drops everything else, nested objects and arrays included.

`errorFields(err)` builds `{ error_name, error_code?, pg_code? }`. It walks the `cause` chain for
the first SQLSTATE and the first `LedgerError` `code`, and never reads `message`, `detail` or
`params`. `apps/local` passes `functionName` `ingest`, `worker` and `api` to one logger each.
Authority: [pp-general → logging-and-pii](../../.agents/skills/pp-general/references/logging-and-pii.md#logger);
[pp-testing → fakes](../../.agents/skills/pp-testing/references/fakes-and-doubles.md#which-double-per-seam).

**D16 — Metrics in slice 1.** `MetricsPort` has `count(name, value)` and `duration(name, ms)`. `name`
is a union of the [Technology](../architecture.md#technology) set. Slice 1's one implementation writes
through the logger: the message is the metric name and the field is `value_count` or `value_ms`,
beside any allow-listed ids the caller passes. Emitted in slice 1: `ingest.accepted`,
`worker.duplicates`, `worker.payload_sanitized`, `projection.unknown_event_type`,
`worker.processing_lag`. Not emitted: `ingest.rejected` (C4) and the three `reconcile.*` metrics
(slice 4). Authority: [pp-general → Metrics](../../.agents/skills/pp-general/references/logging-and-pii.md#metrics)
("Locally, the same helper writes through the logger").

### Data

**D17 — Typed-column extraction** (worker, pure, `packages/worker/src/to-ledger-row.ts` → `toLedgerRow(envelope, payload, addressHashKey)`).
Each column is read independently, null where unreadable (ADR-004):

| Column | Value |
| --- | --- |
| `svix_id`, `received_at`, `source` | From the envelope |
| `type` | `payload.type` when it is a string, else null |
| `event_created_at` | `payload.created_at` when it is an ISO 8601 date-time with offset, else null |
| `email_id` | `payload.data.email_id` when `type` is one of `emailEventTypes` (the ten outbound types) and the value is a string, else null. So `email.received` stays null ([data-modeling](../data-modeling.md#webhook_events--the-immutable-ledger)) |
| `to_hashes` | `payload.data.to` mapped through `hashAddress`, same positions, when `type` is outbound and `to` is an array of strings, else null |
| `payload` | The sanitized value `JSON.parse` produced, never the Zod output ([jsonb](../../.agents/skills/pp-database/references/indexes-and-jsonb.md#jsonb)) |

`projectable` is true iff `type` is outbound, `emailEventSchema.safeParse(payload)` succeeds,
`event_created_at`, `email_id` and `to_hashes` are non-null, and `to_hashes.length === data.to.length`.
These are `projectEmail`'s own skip rules (`toProjectedEvent`), so the worker locks and projects
exactly the events the projection would fold.

**D18 — Schema** (Drizzle, one file per table at data-modeling's `_Schema:_` paths). All of §8.
Authority: the four [data-modeling.md](../data-modeling.md#tables) entries and their
[Base fields](../data-modeling.md#base-fields--the-checklist-for-every-new-model);
[pp-database → New-table recipe](../../.agents/skills/pp-database/references/new-table-recipe.md).

**D19 — Ships 6's unit test** is `to-ledger-row.test.ts`. An unknown type, a non-email type
(`contact.created`), `email.received`, and a known type whose payload fails its schema each yield a
row with the payload unchanged, typed columns null where unreadable, and `projectable: false`. The
integration test then proves the row is stored, no projection row exists for it, and one
`projection.unknown_event_type` line is emitted (§20). Authority: Ships 6 ("evidence: unit test");
[pp-workflow → Test tiers](../../.agents/skills/pp-workflow/SKILL.md#test-tiers) (what the database
enforces is the integration tier).

**D20 — Migrations.** One `drizzle-kit generate --name create-ledger-tables` (all four tables), then
one `--custom --name grant-ledger-tables` granting the runtime role. They run through **programmatic
`migrate()`** from `drizzle-orm/node-postgres/migrator`, the one path for `pnpm db:setup`, the harness
and slice 2's deploy command. This keeps drizzle-kit out of every runtime. The migrate connection is
the owner role on the direct URL, with `lock_timeout` set as a connection option (`options: '-c lock_timeout=5s'`).
The runtime role constant is `RUNTIME_ROLE = 'ledger_runtime'` in `packages/db`. The grant migration
spells the same literal, so a mismatch fails as `permission denied` in the harness. The entry point
is `prepareDatabase({ ownerUrl, runtimePassword })` in `packages/db`: it ensures the role (`CREATE ROLE ledger_runtime LOGIN PASSWORD …`
only when absent, idempotent; timeouts from slice 2, C13), then migrates. Authority: ADR-018;
[pp-database → Running migrations](../../.agents/skills/pp-database/references/migrations-and-grants.md#running-migrations)
("is the slice 1 pre-proposal's; the programmatic one keeps drizzle-kit out of every runtime");
[harness](../../.agents/skills/pp-testing/references/postgres-harness.md#lifecycle-one-run) ("Its name is the slice 1 pre-proposal's").

### Read API, SDK, CLI

**D21 — `createApi(deps)`.** `deps` is `{ db, logger, addressHashKey, requestId: () => string }`.
Middleware: Hono `requestId` with `headerName: ''` and the injected generator (`apps/local`:
`crypto.randomUUID`). It sets no response header. Slice 1 has no token middleware. Routes:
`get-email.route.ts` → `getEmailRoute` (`email.get`, `GET /emails/{email_id}`) and
`get-recipient.route.ts` → `getRecipientRoute` (`recipient.get`, `POST /recipients/lookup`). Each is
built with `createRoute`, the operation id as `operationId`, and response schemas for `200`, `400`,
`404`, `500` and `503` (the error shape). Each calls one reader (`GetEmailReader`, `GetRecipientReader`
in `packages/api`) and one mapper (`email-response.mapper.ts`, `recipient-response.mapper.ts`).
OpenAPI `info`: title `Ledger read API`, version `0.0.0` until slice 8. Authority: ADR-019;
[read-api.md](../../.agents/skills/pp-backend/references/read-api.md).

**D22 — Errors at the read API** (C3). `defaultHook` turns every request-validation failure into
`400 validation_failed`, with a message naming the field (§12). `onError` runs `classifyDatabaseError(err)`
from `packages/db` first: a match answers `503 database_unavailable`. A `LedgerError` answers its
registry status. Anything else, a run-outcome or a client-side code included, answers
`500 internal_error`, logged as `api.internal_error` with `request_id` and `errorFields`. The 415
library bullet: the contract test sends `recipient.get` without `Content-Type`. If
`@hono/zod-openapi` bypasses both hooks, `onError` or an explicit check maps it to `400 validation_failed`
(field `body`) before the slice is done.

**D23 — Unmatched path** (C16). `app.notFound` answers `404` with `route_not_found` in the error
shape, for any method and path no route serves (Hono answers an unmatched method with not-found
too). The code is owner-approved 2026-10-17 (§7).

**D24 — Address lookup.** `recipient.get`'s body is `{ address: string }`. Valid means trimmed length
3–320 with one `@` that has a non-empty part on each side. The reader hashes with `hashAddress`, so
it normalizes too (D1). The response echoes only `address_masked` from the row
([Redaction](../api-contract.md#conventions)).

**D25 — `email_id` validation.** Path param `^[A-Za-z0-9._-]{1,128}$`. That covers Resend's UUID ids
and the simulator's namespaced ids. Authority: [Error codes](../api-contract.md#error-codes)
(`validation_failed`: "bad id"); [data-modeling.md → conventions](../data-modeling.md#modeling-conventions-canonical)
(Resend ids stored verbatim as `text`).

**D26 — SDK** (`packages/sdk`). `createLedgerClient({ baseUrl, token })` builds an `openapi-fetch`
client from the generated `paths`. It sends `Authorization: Bearer <token>` on every request and
uses `AbortSignal.timeout(31_000)` per request, just above AWS-02's 30 s. Methods:
`ledger.emails.get(emailId)` and `ledger.recipients.get(address)` (the address goes in the body).
Each returns `{ data, error }` and never throws for an API error. A response without the error
shape, or a network failure or timeout, becomes `error: apiUnavailable`. An unknown `code` passes
through. Exports: `createLedgerClient`, `apiUnavailable`, `internalError`, the response types, and
`@ledger/sdk/testing` → `FakeLedgerClient` for the CLI tests. Generated types:
`packages/sdk/src/openapi-types.ts`. Authority: [pp-backend → sdk](../../.agents/skills/pp-backend/references/sdk.md)
("Its path is the slice 1 pre-proposal's"), RS-23 style (owner, O-10).

**D27 — `LEDGER_TOKEN` is required from slice 1.** The SDK takes `baseUrl` and `token`, both required
([sdk.md](../../.agents/skills/pp-backend/references/sdk.md#the-client)), and "the request shape never
changes, so no client changes between slices" ([Conventions → Auth in slice 1](../api-contract.md#conventions)).
So the CLI's config requires `LEDGER_URL` (a URL) and `LEDGER_TOKEN` (non-empty). In slice 1 any
value works, because the loopback server skips the check. The walkthrough sets a placeholder. Rules
out: an optional token that slice 2 would have to make required.

**D28 — CLI commands.** `apps/cli/src/commands/email-get.cli.ts` → `emailGetCli`
(`ledger email <email_id> [--json]`) and `recipient-get.cli.ts` → `recipientGetCli`
(`ledger recipient <address> [--json]`). No `argParser` on either argument, and no CLI-side
validation. Plus `cli.config.ts`, `run-operation.ts`, and the output writer gaining `json`, `result`,
`failure`, `notice` and `printable` (D34). Authority: [pp-cli](../../.agents/skills/pp-cli/SKILL.md).

### Local mode

**D29 — `apps/local` composition.** `main.ts` parses `local.config.ts`:

- required: `DATABASE_URL`, `LEDGER_ADDRESS_HASH_KEY`;
- optional: `LEDGER_WEBHOOK_SECRETS` (split on `,`, each entry trimmed, each matching `^whsec_[A-Za-z0-9+/=]+$`) and `LEDGER_SIMULATOR_SECRET` (same pattern);
- a refinement: at least one secret overall.

It builds one size-1 pool per composed function (ingest has none: it never touches the database),
the logger per function, the in-process queue, `createIngest`, `createWorker` and `createApi`. Then
`queue.start(worker.processBatch)`. The connection is the owner URL, `DATABASE_URL` (D30). A config
failure exits `1` through the logger, naming the variable. Flags stay `--port` and `--host`.
Authority: [ADR-013](../architecture.md#adr-013--pure-core-and-local-mode);
[pp-backend → composition](../../.agents/skills/pp-backend/references/composition.md#the-composition-root)
(one size-1 pool per composed function).

**D30 — Locally, the composed functions connect with `DATABASE_URL`, not as the runtime role.**
`pnpm db:setup` still ensures the role, because the grant migration needs it to exist. Lens clause 2
(reversible-cheap): connecting as the runtime role locally would add a second credential to
generate, store and pass for no evidence. The harness already runs every integration test as the
runtime role, so a missing grant fails in `pnpm verify` and CI
([pp-testing → harness](../../.agents/skills/pp-testing/references/postgres-harness.md#per-test-file)).
Slice 2's deployed functions use the runtime role's pooled URL
([integrations.md](../integrations.md#decision--neon)). Rules out: a local password variable for the
runtime role.

**D31 — `pnpm db:setup`**, root script → `pnpm --filter @ledger/app-local setup` →
`node --env-file-if-exists=../../.env.local src/setup/main.ts` (a composition root):

1. Read `.env.local` (created if missing). For each of `DATABASE_URL` (the compose URL,
   `127.0.0.1:55432`), `LEDGER_ADDRESS_HASH_KEY` (32 random bytes, hex), `LEDGER_SIMULATOR_SECRET`
   (`whsec_` + base64 of 32 random bytes) and `LEDGER_URL` (`http://127.0.0.1:3200`): write it only
   when unset or empty. Never overwrite a value.
2. Print one line per name written, never a value: `db:setup: wrote <NAME> to .env.local`.
3. `prepareDatabase` against `DATABASE_URL`, with a random runtime password used only to create the
   role locally (D30).
4. Print `db:setup: ready` and exit 0, or `db:setup: failed: <constant reason>` and exit 1.

The env-file merge is a pure function, `mergeLocalEnv(text, generate)`, with a unit test: it
generates when absent, never overwrites, and preserves other lines. `pnpm dev:full` runs
`pnpm db:setup` after Postgres is healthy and before `pnpm build`. Authority: Ships 5 ("the setup
script generates once into `.env.local`"); [integrations.md](../integrations.md#decision--neon) (role
→ migrate order in "the local setup command"); lens clause 1 (a step that recurs per walk is scripted).

**D32 — Mounting ingest beside the read API.** `apps/local/src/ingest-fetch.ts` → `ingestFetch(ingest)`
adapts a Fetch `Request`: it reads `arrayBuffer()` and decodes it as UTF-8, passes the three
lowercase `svix-*` headers, and returns a `Response` with D11's status, body and content type.
`main.ts` serves `fetch: (request) => request.method === 'POST' && new URL(request.url).pathname === '/webhooks/resend' ? ingestFetch(ingest)(request) : api.fetch(request)`.
This mirrors slice 2's HTTP API, which routes only `POST /webhooks/resend` to ingest. Everything
else reaches the read API, and an unmatched path answers `route_not_found`. Authority:
[composition.md](../../.agents/skills/pp-backend/references/composition.md#the-composition-root) ("How
it mounts `POST /webhooks/resend` beside the read API is the slice 1 pre-proposal's").

**D33 — How the CLI starts locally** (C7). Root script `"ledger": "node --env-file-if-exists=.env.local apps/cli/src/main.ts"`.
The walk runs `pnpm -s ledger <command>`: `-s` keeps pnpm's banner off stdout, so `--json` stays one
document. No `bin` until slice 8. Authority: [pp-cli → Stack and layout](../../.agents/skills/pp-cli/SKILL.md#stack-and-layout)
("How the bin starts in the workspace and loads `.env.local` is the slice 1 pre-proposal's").

**D34 — Human output layouts** (pp-cli: "human output layouts → the slice 1 pre-proposal"). Every
printed value passes through the output writer's `printable(value)`, which maps C0, DEL and C1 to
`*`. Bounce types, ids and types are open strings from a payload, so this keeps a terminal escape
out of human output. Masks already have that property (D13 of slice 0). `null` prints as `—`.
Timestamps print as ISO 8601. Columns are padded with spaces. Layouts are in §12.

**D35 — `apps/api` is stubbed** (C12): `api.handler.ts` becomes `export {}` with a comment pointing at
slice 2. `infra` synthesizes no function yet, so nothing references it.

### Live Resend experiments

**D36 — `listen` session protocol** (Ships 11–13, owner-run, every write Ask-first):

1. The owner starts a public tunnel to port 4318 (RS-33's default).
2. **Ask-first:** `resend webhooks listen --url <tunnel URL> --forward-to http://127.0.0.1:3200/webhooks/resend`.
3. Read-only: `resend webhooks list`, then `resend webhooks get <temporary id>`. The signing secret
   is never pasted into the conversation, a log or a file other than `.env.local` (RS-05).
4. The secret goes into `LEDGER_WEBHOOK_SECRETS` in `.env.local`, and `apps/local` is restarted.
5. **Ask-first** sends from `onboarding@resend.dev`: `delivered@resend.dev` + `bounced@resend.dev`
   in one email (RS-U21), then `complained@resend.dev`, then `suppressed@resend.dev` (RS-U15).
6. Observe the `listen` stdout per event: type, `data.to`, `bounce.type` / `subType`. Observe
   ingest's `200` and `ledger email <id>`. That settles RS-U22: a forwarded delivery verified
   locally, or it `401`s, which is recorded as the answer.
7. End the session with Ctrl+C. To settle RS-U18, a second, short approved session is killed without
   Ctrl+C (its terminal is closed), then a read-only `resend webhooks list` follows. A leftover
   webhook is deleted only on approval.

Results go to resend.md: each settled row becomes a new `RS-NN` fact citing the experiment and date,
and the `[Unverified]` row is struck through with a pointer, per resend.md's rules. No `svix_id`,
email id or secret from these deliveries enters a tracked file.

**D37 — `pnpm sim` live mode** (C11). If `LEDGER_URL` is set (in the shell or `.env.local`), the run
is live:

1. Generate the history exactly as offline (D38). Print the two header lines and the projection
   JSON, recipient keys omitted as before. Keys are now keyed hashes, so the recipient order follows
   them.
2. Send every arranged event, duplicates and shuffle included, one at a time. Each is a
   `POST $LEDGER_URL/webhooks/resend` with body `JSON.stringify(payload)`, signed with
   `signWebhook` (`@ledger/core/testing`, [simulator.md → Signing](../../.agents/skills/pp-testing/references/simulator.md#signing))
   over `LEDGER_SIMULATOR_SECRET` and the wall-clock `svix-timestamp`.
3. Print `sent requests=<k> accepted=<a>`, where `a` counts the `200`s.
4. **Settle:** poll the count of the run's generated `svix_id`s present in `webhook_events`, through a
   `packages/db` read, every 250 ms. The run is settled when the count equals the generated count.
   It fails at a 30 s bound with `sim: not settled after 30s (<present>/<generated> stored)`. Each
   message commits its projections in its own transaction, so a stored event means projected.
5. Run `invariant-1.ts` (every generated `svix_id` stored exactly once) and `invariant-2.ts` (every
   `email_state`, `email_recipients` and `recipient_state` row of the run equals `projectEmail` /
   `projectRecipient` of the ground truth, with `recipientKeys` = `hashAddress(key, to[i])`). Both
   read through `packages/db`. An email with no projectable event has no `email_state` row, and
   that counts as equal.
6. Print `invariant 1 pass stored=<n>/<n>` or `invariant 1 fail missing=<k> svix_ids=<up to 5 ids>`;
   `invariant 2 pass emails=<m> recipients=<r>` or `invariant 2 fail email_ids=<…>`; then
   `invariant 3 not checked (slice 6)` and `invariant 4 not checked (slice 3)`.
7. Exit `0` iff every checked invariant passed and `a = k`, else `1`.

Live mode also requires `LEDGER_SIMULATOR_SECRET`, `DATABASE_URL` and `LEDGER_ADDRESS_HASH_KEY`. A
missing one prints `sim: <NAME> is required when LEDGER_URL is set` and exits `2`. Without
`LEDGER_URL`, slice 0's offline behavior is byte-for-byte unchanged. Authority: `.env.example`
(`LEDGER_URL` and `DATABASE_URL` "read by … `pnpm sim` (slice 1)"); ADR-016; [simulator.md → Ground truth and runs](../../.agents/skills/pp-testing/references/simulator.md#ground-truth-and-runs)
("How a run detects settling is the slice 1 pre-proposal's").

**D38 — Every simulator address carries the run's label** (C10). `ledgerHistory` takes
`labelEveryAddress?: boolean` (default `false`, so core's properties keep exercising bare addresses).
`pnpm sim` always passes `true`, so every address is `<local>+<namespace>-<n>@resend.dev`, and two
runs never share an email, a `svix_id` or a recipient. A fixed seed's offline output changes once,
with this change. Slice 0 promises identical output for a fixed seed and namespace, not across
versions.

**The walk probe.** With the same option, every history also gets one fixed email, so a walker can
look up a recipient whose raw address they know. Sim stdout prints masks only, and a mask hides the
label's digits.

- Email id: `<namespace>-probe`.
- Recipients: `delivered+<namespace>@resend.dev` and `bounced+<namespace>@resend.dev`.
- Events: `email.sent` to both, `email.delivered` to the first, and `email.bounced` with
  `bounce: { type: 'Permanent', subType: 'General' }` to the second (RS-27, RS-28, RS-35).

Its projection is `status: bounced`, the first recipient `ok` and the second `hard_bounced`, caused
by `<namespace>-probe`. It is part of the ground truth, so invariants 1–2 cover it. Authority: lens
clause 3 (every finished slice hand-walkable); the in-scope test's row 3
([slice-scoping](../../.agents/skills/pp-workflow/references/slice-scoping.md#3--the-in-scope-test)).

**D39 — RS-U15's "simulator fixtures".** Once RS-U15 is observed, `@ledger/core/testing` gains
`testAddressSequences`: per test address, the observed ordered event types and `bounce.type` /
`subType`, with no id, timestamp or address captured from the live delivery. `ledgerHistory` with
`labelEveryAddress` appends one email per sequence to every history, with fresh namespaced ids and
labelled addresses. So every `pnpm sim` run, offline and live, sends the observed real-world
sequences through ingest and the worker and checks them under invariants 1–2. A core unit test
projects each sequence and asserts the deliverability its observation implies. Authority: Ships 12;
[pp-testing → Never](../../.agents/skills/pp-testing/SKILL.md#never) ("a `svix_id` captured from a
live delivery … in a fixture or sim run").

### Tests and gates

**D40 — Harness.** `packages/db/src/testing/postgres-global-setup.ts` uses image
`postgres:18.6-alpine`, the compose tag, an exact 18.x minor ([integrations.md](../integrations.md#decision--neon),
Postgres 18). It runs `prepareDatabase` against the template, marks it a template, and provides URLs
and the template name. `@ledger/db/testing` exports `createTestDatabase()` → `{ db, owner, drop }`
([pp-testing → harness](../../.agents/skills/pp-testing/references/postgres-harness.md)). The `int`
project's own `globalSetup` is the [Unverified] library bullet, settled by the first
`pnpm test:int`. If a project's `globalSetup` does not run, the `int` project gets its own config
file with that setup, and the bullet records it.

**D41 — Where the SDK ↔ API contract tests live.** In `apps/local/src/sdk-contract.int.test.ts`. It
serves `createApi(deps)` through `@hono/node-server` on `127.0.0.1:0` over a harness database, seeds
rows through `RecordEventCommand` (the real write path), and calls through `createLedgerClient`.
That satisfies ADR-019's "under `@hono/node-server` (slice 1)", and `packages/sdk` stays free of
server code ([vitest-layout](../../.agents/skills/pp-testing/references/vitest-layout.md#shared-contract-suites):
"Where the SDK ↔ API contract tests live is the slice 1 pre-proposal's"). Slice 2 lifts the suite
into `@ledger/api/testing` for its second runner. `apps/local` gains `@ledger/sdk` and `@ledger/db`
(for `/testing`) as `workspace:*` dev dependencies.

**D42 — OpenAPI export and drift.**

- `packages/api/scripts/export-openapi.ts` (added to the root `tsconfig.json` `include`) writes
  `app.getOpenAPI31Document()` from a `createApi` built with inert deps to
  `<out>/openapi.json`, pretty-printed with 2 spaces and a final newline. `--out` defaults to
  `packages/sdk`.
- Root `"openapi:export"` runs it, then
  `pnpm --filter @ledger/sdk exec openapi-typescript openapi.json -o src/openapi-types.ts`.
- `scripts/openapi-drift.mjs`, the `drift` stage, regenerates both files into a temp directory and
  compares bytes with the committed copies (LF is guaranteed by `.gitattributes`). Before the real
  check it runs a canary on every run: a copy of the fresh `openapi.json` with one byte changed MUST
  be reported as drift. That is "the stage fails on a stale fixture", the house pattern of
  `secrets` and `links`.
- Output: `drift: canary caught 1/1`, then `drift: openapi.json and openapi-types.ts match packages/api`.
  Or `drift: <file> differs from packages/api; run pnpm openapi:export and read the diff (a changed contract is Ask-first)`,
  exit 1.
- Both generated files are excluded from Biome in `biome.json`: generated output is never
  hand-edited or reformatted ([Permissions](../../AGENTS.md#permissions)).

Authority: [ADR-011](../architecture.md#adr-011--one-contract-many-surfaces) (export script, committed
files, drift stage); [pp-backend → sdk](../../.agents/skills/pp-backend/references/sdk.md#build-path);
the canary pattern of [verify-gate](../../openspec/specs/verify-gate/spec.md).

**D43 — `pnpm verify` stage order:** `install, docker, secrets, lint, links, typecheck, drift, unit, int, synth, e2e`.
CI runs it unchanged. Authority: [ADR-011](../architecture.md#adr-011--one-contract-many-surfaces) (drift stage),
[ADR-018](../architecture.md#adr-018--migrations-run-from-the-deploy-command-before-the-code-that-needs-them) (CI migrates before the integration tests).

## 8. Data model

**Schema authority:** the Drizzle schema in `packages/db` owns table and column shape. Its
migrations are expand/contract only, generated, read and committed with the schema
([data-modeling.md → How to use](../data-modeling.md#how-to-use), ADR-018). **Ask-first:** this
whole section pauses for owner approval at apply unless §7's "Schema" row is approved. The
migrations freeze once merged to `main`; after that, any change is a new forward migration.

Conventions on all four tables:

- snake_case names written out;
- closed sets as `text` + a named `check()` from the core tuple, never `pgEnum`;
- `timestamptz`, UTC;
- no foreign key, cascade, trigger or view;
- no `tenant_id` or `deleted_at`;
- every constraint and index named and declared in the `pgTable`.

### `webhook_events` — `packages/db/src/schema/webhook-events.ts`

| Column | Type | Null | Notes |
| --- | --- | --- | --- |
| `svix_id` | `text` | no | **PK** (`webhook_events_pkey`). The idempotency key: `INSERT … ON CONFLICT (svix_id) DO NOTHING RETURNING svix_id`; no row returned = duplicate |
| `type` | `text` | yes | No `CHECK` (RS-25). Null when the payload has no string `type` (C5) |
| `event_created_at` | `timestamptz` | yes | Null when `created_at` is not a valid ISO date-time (schema-failing payload) |
| `received_at` | `timestamptz` | no | From the envelope, no default. The table's base time field ([Base fields](../data-modeling.md#base-fields--the-checklist-for-every-new-model)) |
| `email_id` | `text` | yes | Outbound email types only (D17) |
| `to_hashes` | `text[]` | yes | Keyed hashes, same positions as `data.to` (D17) |
| `source` | `text` | no | `webhook_events_source_check`: `live`, `simulated` (`eventSourceSchema`) |
| `payload` | `jsonb` | no | The sanitized parsed body (D3) |

- **No `updated_at`:** the table is append-only.
- **Index:** `webhook_events_email_id_event_created_at_idx` on `(email_id, event_created_at)`. It
  serves `webhookEventsRepository.loadForEmail` (the worker's step 6) and `listTimeline` (`email.get`).
- **Grant:** `SELECT, INSERT`. Never `UPDATE` or `DELETE` ([Grants](../../.agents/skills/pp-database/references/migrations-and-grants.md#grants)).

### `email_state` — `packages/db/src/schema/email-state.ts`

| Column | Type | Null | Notes |
| --- | --- | --- | --- |
| `email_id` | `text` | no | **PK**, the email lock target |
| `status` | `text` | yes | `email_state_status_check`: the eight `emailStatusSchema` members. Null until an outcome event |
| `from_masked`, `subject_masked` | `text` | yes | Null when no projected event carries `from` / `subject` (`EmailState`). data-modeling lists them as `text`; the doc gains the nullability (§22) |
| `open_count`, `click_count` | `integer` | no | Default `0` |
| `first_opened_at`, `first_clicked_at` | `timestamptz` | yes | |
| `last_event_at` | `timestamptz` | yes | Null only in the lock placeholder, overwritten in the same transaction |
| `event_count` | `integer` | no | Default `0` |
| `created_at` | `timestamptz` | no | Default `now()` |
| `updated_at` | `timestamptz` | no | Default `now()`. Set by the repository's `UPDATE`, no trigger |

- **Grant:** `SELECT, INSERT, UPDATE`.

### `email_recipients` — `packages/db/src/schema/email-recipients.ts`

| Column | Type | Null | Notes |
| --- | --- | --- | --- |
| `email_id`, `address_hash` | `text` | no | **Composite PK** `email_recipients_pkey` |
| `address_masked` | `text` | no | |
| `status` | `text` | yes | `email_recipients_status_check`: the eight members |
| `status_at` | `timestamptz` | yes | |
| `bounce_type`, `bounce_sub_type` | `text` | yes | Open strings (RS-28, RS-35) |
| `sticky_signal` | `text` | yes | `email_recipients_sticky_signal_check`: `hard_bounced`, `suppressed`, `complained` |
| `sticky_signal_at` | `timestamptz` | yes | |
| `sticky_signal_svix_id` | `text` | yes | |
| `soft_signal` | `text` | yes | `email_recipients_soft_signal_check`: `delivered`, `bounced` |
| `soft_signal_at` | `timestamptz` | yes | |
| `soft_signal_svix_id` | `text` | yes | |
| `created_at`, `updated_at` | `timestamptz` | no | Default `now()` |

- **Index:** `email_recipients_address_hash_idx` on `(address_hash)`. It serves
  `emailRecipientsRepository.listByAddressHash` (the worker's step 8).
- **Locking:** under the email lock, inserted then locked (C9).
- **Grant:** `SELECT, INSERT, UPDATE`.

### `recipient_state` — `packages/db/src/schema/recipient-state.ts`

| Column | Type | Null | Notes |
| --- | --- | --- | --- |
| `address_hash` | `text` | no | **PK**, the recipient lock target and `recipient.get`'s lookup |
| `address_masked` | `text` | no | |
| `deliverability` | `text` | no | `recipient_state_deliverability_check`: `ok`, `soft_bouncing`, `hard_bounced`, `complained`, `suppressed` |
| `since` | `timestamptz` | yes | Null while `ok` was decided by no event |
| `cause_email_id` | `text` | yes | Same |
| `created_at`, `updated_at` | `timestamptz` | no | Default `now()` |

- **Grant:** `SELECT, INSERT, UPDATE`.

**Migration order:** `0000_create-ledger-tables.sql` (generated; four `CREATE TABLE`s, their checks,
two indexes), then `0001_grant-ledger-tables.sql` (custom; four `GRANT`s to `ledger_runtime`). Pure
expand: no `DROP`, `RENAME`, `ALTER … TYPE` or `SET NOT NULL`, so no contract-step marker. No
backfill. File names follow drizzle-kit's own scheme; its output layout is a library bullet
([schema-and-repositories](../../.agents/skills/pp-database/references/schema-and-repositories.md#layout)).

**Repositories** (executor-first, one object each, only what a command or reader in this change calls):

- `webhookEventsRepository`: `insertIfAbsent`, `loadForEmail`, `listTimeline`, `countPresent(db, svixIds)` (sim).
- `emailStateRepository`: `createIfAbsent`, `lockEmail(tx, emailId)`, `update`, `get`, `listByEmailIds` (sim).
- `emailRecipientsRepository`: `createIfAbsent`, `lockRows(tx, emailId, hashes)`, `update`, `listByEmail`, `listByAddressHash`.
- `recipientStateRepository`: `createIfAbsent`, `lockRecipients(tx, hashes)`, `update`, `get`, `listByAddressHashes` (sim).

Locking functions take `Transaction`; the rest take `Executor`. Both types live in
`packages/db/src/executor.ts`, derived from the installed `.d.ts` (a library bullet). Connection
factory: `createDatabase({ url, max: 1 })` → `{ db, pool }`, with `pool.on('error')` logging
`error_name` and `pg_code` only ([Connection](../../.agents/skills/pp-database/references/schema-and-repositories.md#connection)).

## 9. State machines and transitions

The projections are slice 0's pure functions, unchanged: `projectEmail` and `projectRecipient` in
`packages/core`, specified by `openspec/specs/projections`
([ADR-003](../architecture.md#adr-003--projection-is-a-pure-function-of-the-event-set)). Slice 1 adds
how they are committed:

- **Recomputed, never advanced.** Every projectable event triggers a full recompute of the email's
  state from every stored event for that `email_id`, and of each named recipient's
  `recipient_state` from every `email_recipients` row for that hash (D14, steps 6–8).
- **Ties:** `(event_created_at, rank(type), svix_id)` inside `projectEmail`; `projectRecipient`'s
  signal tie-breaks. The worker adds no ordering of its own and reads no `received_at`.
- **Writes:** `email_state` and the email's `email_recipients` rows; `recipient_state` for the new
  event's recipients.
- **Reactions:** none. The outbox is slice 6's. No mutation bypasses the projection functions.

## 10. Backend surface

| Operation | Kind | Semantics | In → Out | Scope | Idempotency | Surfaces | Status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `email.get` | read `[view-shaped]` | Projected state, every recipient's outcome, the timeline ([entry](../api-contract.md#emailget)) | `email_id` → §12 email object | `read`, unenforced on loopback in slice 1 | Idempotent; no Resend call | SDK `ledger.emails.get` · CLI `ledger email <email_id>` · MCP `get_email_status` (slice 5) | **New** |
| `recipient.get` | read `[resource]`, sent as `POST` | Deliverability and the email that caused it ([entry](../api-contract.md#recipientget)) | body `{ address }` → §12 recipient object | `read`, same | Idempotent; no Resend call | SDK `ledger.recipients.get` · CLI `ledger recipient <address>` · MCP `get_recipient_status` (slice 5) | **New** |

Paths and verbs are api-contract.md's (`GET /emails/{email_id}`, `POST /recipients/lookup`).
`POST /webhooks/resend` is not an operation (§11, D32). No other operation names slice 1
(`grep 'Slices:.*1 — Local' .ai/api-contract.md` → only these two).

## 11. Async — outbox, jobs, webhooks

- **Inbound webhook:** `POST /webhooks/resend` on `apps/local`. It verifies against
  `LEDGER_WEBHOOK_SECRETS` then `LEDGER_SIMULATOR_SECRET`, enqueues, then answers (D9–D11, D32).
  Replay behavior is slice 4's (RS-U01).
- **Queue and consumer:** the in-process queue (D8) with one consumer, `worker.processBatch` (D13).
  Idempotency is `svix_id` at the ledger insert, so a redelivery commits as a duplicate (ADR-004).
  Transport order is never relied on (ADR-002).
- **Retry ownership:** the queue redelivers failed messages up to 5 receives, then puts them on the
  in-memory dead list (D8). No backoff beyond the fixed 1 s delay.
- **DLQ and redrive:** none in slice 1 (slices 2–3, 2B).
- **Outbox:** none (slice 6).
- **Scheduled jobs:** none.
- **Live inbound, owner experiments only (Ships 11–13):** `resend webhooks listen` forwards real
  deliveries, with their original Svix headers (RS-33), to the same local `POST /webhooks/resend`.
  They verify against the session's secret in `LEDGER_WEBHOOK_SECRETS` (D36), and from there take
  the ordinary path.

## 12. Surfaces

### `POST /webhooks/resend` (local, not an operation)

| Case | Status | Body |
| --- | --- | --- |
| Any `svix-*` header missing, no secret matches, or the timestamp is more than 5 min off (RS-02) | `401` | `unauthorized` |
| Verified, enqueued | `200` | `ok` |
| Verified, enqueue failed | `503` | `unavailable` |

All are `text/plain; charset=utf-8`. No registry code applies ([Ingest boundary](../api-contract.md#ingest-boundary)).

### `email.get` — `GET /emails/{email_id}` → SDK `ledger.emails.get(emailId)` → CLI `ledger email <email_id> [--json]`

Actor: support / on-call engineer (J2); scope `read`. `200` body (masks only; every timestamp ISO 8601 UTC or `null`):

```json
{
  "object": "email",
  "email_id": "…",
  "status": "bounced",
  "from_masked": "…",
  "subject_masked": "…",
  "open_count": 0,
  "click_count": 0,
  "first_opened_at": null,
  "first_clicked_at": null,
  "last_event_at": "2026-10-17T12:00:02.000Z",
  "event_count": 3,
  "recipients": [
    { "address_masked": "…", "status": "bounced", "status_at": "…", "bounce_type": "Permanent", "bounce_sub_type": "General" }
  ],
  "timeline": [
    { "svix_id": "msg_…", "type": "email.sent", "event_created_at": "…", "bounce_type": null, "bounce_sub_type": null }
  ]
}
```

- `recipients` are ordered by `address_hash`, which is never returned. `timeline` is every
  `webhook_events` row with that `email_id`, in fold order `(event_created_at` nulls last,
  `rank(type), svix_id)`.
- `bounce_type` / `bounce_sub_type` are read from `data.bounce` only on `email.bounced`, by a
  non-throwing parse in the reader.
- Never returned: the payload, `to`, raw `from` / `subject`, bounce `message` / `diagnosticCode`,
  `address_hash`, the signal columns ([Redaction](../api-contract.md#conventions)).
- If `email_state` is absent but timeline rows exist (every event unprojectable), the response is
  `200` with `status: null`, zero counts and `recipients: []`.

Human (`--json` absent), stdout:

```text
email       <email_id>
status      bounced
from        <from_masked>
subject     <subject_masked>
events      3, last 2026-10-17T12:00:02.000Z
opens       0
clicks      0

recipients
  <address_masked>   bounced     2026-10-17T12:00:02.000Z   Permanent / General
  <address_masked>   delivered   2026-10-17T12:00:01.000Z

timeline
  2026-10-17T12:00:00.000Z   email.sent        msg_…
  2026-10-17T12:00:01.000Z   email.delivered   msg_…
  2026-10-17T12:00:02.000Z   email.bounced     msg_…   Permanent / General
```

`opens` and `clicks` add `, first <timestamp>` when non-zero. A missing bounce pair prints nothing.
Empty sections print `  —`.

### `recipient.get` — `POST /recipients/lookup` → SDK `ledger.recipients.get(address)` → CLI `ledger recipient <address> [--json]`

Actor: support engineer, application developer; scope `read`. `200` body:

```json
{ "object": "recipient", "address_masked": "…", "deliverability": "hard_bounced", "since": "…", "cause_email_id": "…" }
```

Human, stdout:

```text
recipient        <address_masked>
deliverability   hard_bounced
since            2026-10-17T12:00:02.000Z
caused by        <cause_email_id>
```

### Error codes raised, in the [error shape](../../AGENTS.md#error-shape)

`docs` for each is `` `${RUNBOOK_BASE_URL}#<code>` `` (D4).

| Code | HTTP | Where | `message` | `hint` |
| --- | --- | --- | --- | --- |
| `validation_failed` | 400 | `email.get` (`email_id`) | `email_id must be 1 to 128 characters from A-Z, a-z, 0-9, '.', '_' and '-'.` | `Fix the field the message names, then retry.` |
| `validation_failed` | 400 | `recipient.get` (`address`) | `address must be an email address of at most 320 characters.` | `Fix the field the message names, then retry.` |
| `validation_failed` | 400 | `recipient.get` (`body`: missing, not JSON, wrong content type) | `The request body must be a JSON object with an address field.` | `Send Content-Type: application/json with a JSON body.` |
| `email_not_found` | 404 | `email.get` | `No event has been recorded for this email id.` | `Events may still be queued, or missed: run \`ledger gaps\`` (registry) |
| `recipient_not_found` | 404 | `recipient.get` | `No event has ever named this address.` | `Check the address. If it was emailed recently, run \`ledger gaps\`` (registry) |
| `route_not_found` | 404 | any unmatched method and path | `No operation at this method and path.` | `Check LEDGER_URL, and that the CLI or SDK version matches the API's.` |
| `database_unavailable` | 503 | both operations | `The database is unreachable.` | `The queue holds events meanwhile (ADR-015); retry, then \`ledger worker resume\`. \`ledger health\` shows storage used` (registry) |
| `internal_error` | 500 | API `onError`; CLI defect path | `An unexpected error occurred.` | `Retry; if it persists, read the API logs by request id` (registry) |
| `api_unavailable` | — (SDK) | SDK: response without the shape, network failure, timeout | `The Ledger API did not answer with a Ledger response.` | `Check \`LEDGER_URL\`. The kill switch may be tripped: check the budget alerts, then run the re-arm script` (registry) |

No message carries an id, address, subject or input value. `unauthorized` and `forbidden` are not
raised in slice 1 (no token store).

### CLI behavior

From [pp-cli → Output and exit codes](../../.agents/skills/pp-cli/SKILL.md#output-and-exit-codes):

- Success: exit `0`; stdout carries the layout, or under `--json` exactly `data`.
- Registry error: exit `1`. Under `--json`, `{ "error": … }` on stdout. Otherwise stderr gets the
  `message` line, then `hint: <hint>`.
- Usage error (missing argument, unknown option) or a missing / invalid `LEDGER_URL` or
  `LEDGER_TOKEN`: exit `2`. Stderr gets commander's message or the variable's name; no call is made.
- Defect: exit `1`. Under `--json`, the `internal_error` object; otherwise `ledger: unexpected failure.`
  (`apps/cli/src/exit-code-for.ts:5`).
- `ledger recipient` echoes only the API's `address_masked`.

### `pnpm sim` (live)

D37's lines. Offline: unchanged from slice 0.

### `pnpm verify` (Ships 2, 9)

D43's stage list:

- `drift` prints D42's lines.
- `int` runs `pnpm test:int`. The global setup prepares the template, so every migration has run
  before the first test (R15).
- A failure ends `VERIFY FAILED: <stage>`, exit 1 (unchanged).

### Log output (Ships 7)

One JSON line per event, on stdout. The keys are D15's allow-list. The messages are constants:
`local server listening`, `ingest.request_rejected`, `ingest.enqueue_failed`, `worker.message_failed`,
`queue.dead_lettered`, `api.internal_error`, `db.pool_error`, and the metric names of D16 (each with
`value_count` or `value_ms`). No line carries a payload, an address, a subject, a header, or an
error's `message` / `detail`.

## 13. Recovery paths

- **Duplicates:** a Svix retry, a simulator `--duplicates` copy or an in-process redelivery hits
  `ON CONFLICT (svix_id) DO NOTHING` and commits as a duplicate, with no second effect (ADR-004).
- **A failed message** is redelivered by the in-process queue up to 5 times, then put on its
  in-memory dead list (D8). The durable equivalents are slice 2's SQS DLQ and slice 2B's
  `local_queue_messages`.
- **Loss:** an event acknowledged with `200` but still queued when `apps/local` dies is lost locally
  (§3). On AWS, SQS holds it (slice 2). Missed events in general are slice 4's reconcile. A replay
  re-enters through ingest and dedupes on `svix_id`, subject to RS-U01.
- **Outage:** a database down during a read answers `database_unavailable` (D22). During a write the
  message fails and is redelivered. The pause is slice 2's (ADR-015).

## 14. Business rules and invariants

These become the spec requirements. Each states what holds under duplicate, out-of-order and replayed delivery.

- **R1 (verify before enqueue):** a request whose `svix-signature` matches no configured secret, whose `svix-timestamp` is more than 5 minutes off, or that lacks a `svix-*` header MUST get `401` and MUST NOT reach the queue port. `200` MUST follow only a resolved enqueue. A rejected enqueue MUST get `503` (ADR-001, RS-01, RS-02).
- **R2 (secret set):** during a rotation, a request signed by the old secret, the new secret or both MUST verify. Verification tries Resend secrets first, then the simulator secret, and stamps `source` from the first match (ADR-009, ADR-016, RS-04).
- **R3 (fixed body):** ingest bodies MUST be exactly `ok`, `unauthorized` or `unavailable`, never echoing payload, PII or a secret (RS-12).
- **R4 (one row per event):** delivering an event any number of times, in any order, sequentially or concurrently, MUST leave exactly one `webhook_events` row for its `svix_id`. Later copies commit as duplicates and change no projection (ADR-004).
- **R5 (all or nothing):** a failure at any step of a message's transaction MUST leave no row from that message. A later redelivery MUST then commit one row of everything (ADR-004).
- **R6 (never dead-lettered for content):** a verified event whose payload holds `\u0000` or a lone surrogate MUST be stored with U+FFFD in their place, counted as sanitized, and projected when it passes its schema. A verified event of an unknown or non-email type, or one failing its type's schema, MUST be stored raw with typed columns null where unreadable, skip projection, and be counted (ADR-004, RS-25).
- **R7 (lock order):** two messages for different emails that share recipients, in any order and concurrently, MUST both commit, with no deadlock, and leave every projection row equal to the projection of the stored events (ADR-004, architecture.md → Risks).
- **R8 (projections equal the event set):** after any set of deliveries settles, every `email_state`, `email_recipients` and `recipient_state` row MUST equal `projectEmail` / `projectRecipient` of the stored events for its key (ADR-003; sim invariant 2).
- **R9 (no raw PII in projections):** no projection column MAY hold a raw input address, `from` or subject. Addresses appear only as `address_hash` (keyed, D1) and `address_masked` ([PII & retention](../data-modeling.md#pii--retention)).
- **R10 (log allow-list):** every log line MUST carry only allow-listed keys with scalar values, and MUST NOT carry a payload, an address, a subject, or an error's `message` / `detail`, even when the failure is a parse error or a Postgres `CHECK` violation quoting the row.
- **R11 (read surfaces mask):** `email.get` and `recipient.get` MUST return masks only, never the payload, a raw address, subject or bounce diagnostic, nor the address hash. An input address MUST be echoed only as its mask.
- **R12 (one error shape):** every read-API failure, an unmatched path included, MUST answer in the error shape with a registered code. The SDK MUST return, never throw, an API error, mapping a shapeless response or network failure to `api_unavailable`. The CLI MUST exit `0` / `1` / `2` per the contract, with the error object on stdout under `--json`.
- **R13 (loopback only):** the local server, which skips auth, MUST refuse to start on a non-loopback host.
- **R14 (contract drift):** `pnpm verify` MUST fail when `packages/sdk/openapi.json` or `packages/sdk/src/openapi-types.ts` differs from what `packages/api` generates, and MUST prove it on every run with a canary.
- **R15 (migrations in CI):** every migration MUST apply to a fresh Postgres, as the owner, with the runtime role ensured first, before any integration test runs.
- **R16 (simulator invariants):** a live `pnpm sim --duplicates 0.2 --shuffle` against `apps/local` MUST report invariants 1 and 2 passed, report 3 and 4 as not checked, and exit non-zero if a checked invariant fails or a request is not accepted.

## 15. Authorization and idempotency

- **Webhook:** Svix signature plus timestamp, per secret (R1, R2). No other auth on ingest.
- **Read API:** no token check in slice 1, only while bound to loopback (R13; `apps/local/src/main.ts:33`).
  The SDK still sends `Authorization: Bearer <LEDGER_TOKEN>` (D27). Scopes are enforced from slice 2.
- **Idempotency keys:** `webhook_events.svix_id` (PK; a duplicate commits with no effect).
  `email_state.email_id`, `email_recipients (email_id, address_hash)` and `recipient_state.address_hash`
  (PKs; insert-if-absent, then lock). All are in the migration
  ([Idempotency keys](../data-modeling.md#idempotency-keys)). Reads are idempotent.
- **Integration suite must prove:** R4 sequentially and concurrently; R5 by the `CHECK (false) NOT VALID`
  fault; R6 for NUL and lone surrogates; R7 with two pools; every closed set's members accepted and
  one outsider refused (`23514`); all of it connected as `ledger_runtime`.

## 16. Cost and the Resend budget

**Not touched — no AWS resource and no Resend API call added by Ledger code.** No `resend-client`.
Ingest's `webhooks.verify` is local crypto (RS-02). The owner's Ask-first experiments (§7, D36) are
three test sends from the owner's account (RS-32: they count against the sending quota) and up to
two `listen` sessions (temporary webhooks, RS-33). They are made with the Resend CLI, not Ledger
code, and spend a handful of requests, far inside the 10 req/s team budget (RS-19). Testcontainers
and compose Postgres run locally at no cost.

## 17. PII and retention

- **Raw only in `webhook_events.payload`**, which is raw until slice 7's retention job (ADR-014).
- **Projections:** `address_hash` (keyed, D1, D2), `address_masked`, `from_masked`, `subject_masked`
  only. Proved by the R9 integration test.
- **Logs:** the allow-list (D15). Ingest never logs an unverified `svix-id`. Error lines carry
  `error_name`, `error_code` and `pg_code`, never `message` or `detail`. Proved by the Ships 7 unit
  test.
- **Surfaces:** masks only (R11), proved by the route-level redaction test in `packages/api`, fed
  `delivered@resend.dev` and a subject ([pp-workflow → Mandatory](../../.agents/skills/pp-workflow/SKILL.md#test-tiers)).
  An address travels only in `recipient.get`'s body. CLI human output maps control characters to `*` (D34).
- **Fixtures and sim:** `@resend.dev` addresses only, `+label` on every sim address (D38). Live
  experiment data never enters a tracked file (D36).
- **Keys:** `LEDGER_ADDRESS_HASH_KEY` and the signing secrets live only in `.env.local` (git-ignored;
  the gitleaks stage scans history). They are never logged, printed or returned. `db:setup` prints
  names only.
- **Local DB:** holds test-address data only (sim and test sends).
- **Erasure duty:** none in slice 1. Retention N is slice 7's.

## 18. Integrations, env and owner ops

- **Provider:** Resend, verify only (`resend` 6.33.0 in `packages/ingest`, D10). No API calls.
- **Ports:** queue, clock and metrics (D7).
- **Env vars** (public, [Conventions](../api-contract.md#conventions)):

| Variable | New? | Read by | `.env.example` line |
| --- | --- | --- | --- |
| `DATABASE_URL` | existing | `apps/local`, `db:setup`, `pnpm sim` (live) | comment unchanged |
| `LEDGER_ADDRESS_HASH_KEY` | **new, Ask-first** | `apps/local`, `pnpm sim` (live); slice 2's deploy command | `# Address-hash key, 64 hex characters; written once by pnpm db:setup, never changed (data-modeling.md → PII & retention).` |
| `LEDGER_WEBHOOK_SECRETS` | **new, Ask-first** | `apps/local` ingest | `# Local Resend signing secrets, comma-separated whsec_ values; one per resend webhooks listen session (RS-U22).` |
| `LEDGER_SIMULATOR_SECRET` | existing | `apps/local` ingest, `pnpm sim` | Comment corrected (C6): `# Simulator signing secret: written locally by pnpm db:setup; for a deployed stack, the stack's simulator secret (ADR-016, slice 3).` |
| `LEDGER_URL` | existing | CLI, `pnpm sim` (selects live mode) | Comment gains "written locally by pnpm db:setup" |
| `LEDGER_TOKEN` | existing | CLI | Comment: `# Required by the CLI; any value while the loopback server skips auth (slice 1), enforced from slice 2.` |
| `RESEND_API_KEY` | existing | the Resend CLI (owner experiments) | unchanged |

No internal (CDK-set) variable is added.
- **Owner ops** (work items, not decisions; §25): Docker; for Ships 11–13, the Resend API key in
  `.env.local`, the Resend CLI, a tunnel, and per-action approvals. Until those happen, Ships 11–13
  stay inert and everything else ships.

## 19. Decision lens, in writing

**Self-service test.** Stages this slice touches ([Guiding principles](../about.md#guiding-principles),
[Adopter lifecycle](../features.md#adopter-lifecycle)):

- **connect the webhook (local only):** real local traffic needs a `resend webhooks listen`
  session, and copying that session's secret into `.env.local` plus a restart (D36). This is a
  manual step on every session. It sits **off** the adopter's path: adopters connect and verify on
  the deployed stack (slice 2's verify stage), and locally the simulator is the default loop
  (RS-33, Constraint 6). It is owner-only demo ops, so it stays cheap and defers on a tripwire: the
  second walk, in any slice, that runs a `listen` session (§3).
- **ingest:** automated. Signed requests in, `200` / `401` / `503` out. Nothing owed.
- **query:** automated. `ledger email`, `ledger recipient`, the SDK, plain HTTP. Nothing owed.
- **Local stack bring-up** (the developer's deploy analogue): `pnpm dev:full` runs `pnpm db:setup`,
  which writes `.env.local` and migrates. No manual SQL, no hand-made key. Nothing owed.
- deploy, recover and tear down: not touched (slices 2 and 4).

**Cost brake.**

- **Chosen:**
  - the in-process queue (ADR-013), over standing up the Postgres queue early (slice 2B);
  - typed config for ingest secrets, over the port plus TTL cache with no second consumer (C2);
  - a local metrics writer through the logger, over EMF with no Lambda to read it (D16);
  - connecting locally as the owner, over a second local credential, since the harness proves the grants (D30);
  - the drift stage's built-in canary, over a hand-staled commit per review (lens clause 1);
  - Node built-ins for the sim's HTTP and signing ([pp-testing → Never](../../.agents/skills/pp-testing/SKILL.md#never): no signing library);
  - one harness container per run, cloned per file.
- **Rejected as over-engineering at the ceiling:**
  - a `bin` and npm-style install (slice 8);
  - SDK retries (slice 5);
  - a durable local queue;
  - an EMF writer now;
  - a scripted `listen` wrapper before a second session needs it;
  - a per-test-file container.

## 20. Test plan

| Requirement | Test (tier) | Fails if removed |
| --- | --- | --- |
| R1, R2, R3 (Ships 1) | `packages/ingest/src/create-ingest.test.ts` (unit), signing with `signWebhook`: old secret → `200`; new → `200`; one header carrying both `v1,` signatures → `200`; signed by an unconfigured secret (forged) → `401`, queue empty; `svix-timestamp` 6 min old (stale) → `401`, queue empty; a header missing → `401`; queue double whose `enqueue` rejects → `503`; bodies exactly `ok` / `unauthorized` / `unavailable`; simulator-secret request → envelope `source: simulated`, Resend-secret request → `live` | The per-secret loop (rotation fails); the order of verify and enqueue |
| `signWebhook` ↔ `webhooks.verify` | `packages/ingest/src/sign-webhook.test.ts` (unit): the round trip verifies; a one-byte body change is rejected ([simulator.md](../../.agents/skills/pp-testing/references/simulator.md#signing)) | A signer that drifts from Svix's scheme |
| D1, D2 | `packages/core/src/hash-address.prop.test.ts` (property): deterministic; addresses that normalize equal hash equal; the format `^[0-9a-f]{8}\.[0-9a-f]{64}$`; two keys → different `key_id` prefixes | An unkeyed or unnormalized hash |
| D3 | `packages/core/src/sanitize-for-jsonb.prop.test.ts` (property + unit cases): replaces `\u0000`, a lone high and a lone low surrogate, in values and keys; leaves valid pairs; `sanitized` exact | A sanitizer that misses keys or breaks pairs |
| R15 (Ships 2) | The `int` stage itself: the global setup runs `prepareDatabase`, then every migration, as the owner, before any test; then every closed-set test (each `check()`'s tuple members insert as `ledger_runtime`, one outsider → `23514`) in `packages/db/src/*.repository.int.test.ts` | A migration that fails, a missing grant, a tuple / `CHECK` drift |
| R4 (Ships 3) | `packages/worker/src/record-event.command.int.test.ts`: "a duplicate delivery leaves one `webhook_events` row and unchanged projections" (sequential); "two concurrent copies of one `svix_id` leave one row, the second committed as a duplicate" ([harness → concurrent duplicate](../../.agents/skills/pp-testing/references/postgres-harness.md#faults-and-concurrency)); the redrive shape: the same `svix_id` under a new `messageId` | `ON CONFLICT` on the insert |
| R5 (Ships 3) | Same file: "a fault after the ledger insert commits nothing, and the redelivery commits one row of everything" (`CHECK (false) NOT VALID` on `email_state` from `t.owner`) | One transaction per step |
| R6 (Ships 3) | Same file: NUL in `subject` and a lone surrogate in a `tags` value → one row with U+FFFD, `email_state` reflects the event, one `worker.payload_sanitized` line (recording metrics double), no throw | The sanitizer or its call |
| R6 (Ships 6) | `packages/worker/src/to-ledger-row.test.ts` (unit, D19); plus `record-event.command.int.test.ts`: the four kinds stored, no projection row, one `projection.unknown_event_type` each | Raw storage; the metric |
| R7 (Ships 4) | `record-event.command.int.test.ts`: "two emails sharing a recipient commit in either interleaving without deadlock": A holds its transaction after locking; B starts; poll `pg_stat_activity` until B waits on `Lock`; commit A; assert both commit and rows equal the projections; the recipient listed in opposite `data.to` order | Sorted recipient locks |
| R8 | The worker int tests assert rows against `projectEmail` / `projectRecipient`; sim invariant 2 (Ships 10) | Any patching path |
| R9 (Ships 5) | `packages/worker/src/projection-pii.int.test.ts`: events to `delivered@resend.dev` and `bounced@resend.dev` with a `from` and a subject; every text column of every projection row is free of the normalized raw addresses, the raw `from` and the raw subject | A raw address in a projection |
| R10 (Ships 7) | `packages/shared/src/create-logger.test.ts` (unit): log a worker-style failure whose `cause` is a constructed pg error (`code: '23514'`, `detail: 'Failing row contains (… delivered@resend.dev …)'`) and a Zod parse failure quoting a subject, plus a payload object under a non-allowed key; every captured line parses; no line contains the address or the subject; `pg_code: 23514` and `error_name` present; non-scalar values dropped | The allow-list; `errorFields` reading `message` |
| R11 | `packages/api/src/get-email.route.int.test.ts` (int; mandatory redaction): the response holds no raw address or subject; plus timeline order, `email_not_found`, `validation_failed`. `get-recipient.route.int.test.ts`: lookup by address, `recipient_not_found`, masked echo, no `Content-Type` → `400 validation_failed` (the 415 bullet) | Mapper passthrough |
| R12 (Ships 8) | `apps/local/src/sdk-contract.int.test.ts` (int, D41): SDK ↔ API over `@hono/node-server`, the success and error paths of both operations; `route_not_found` on an unmatched path. `packages/api/src/create-api.test.ts` (unit): a database at `127.0.0.1:1` → `503 database_unavailable`; an unexpected throw → `500 internal_error` with no internals. `packages/sdk/src/create-ledger-client.test.ts` (unit, `node:http` on `127.0.0.1`): a shapeless `502` → `api_unavailable`; a closed port → `api_unavailable`; an unknown `code` passes through | Error mapping at any surface |
| R12 (Ships 8) | `apps/cli/src/commands/email-get.cli.test.ts`, `recipient-get.cli.test.ts` (unit, fake SDK): every row of [cli-tests → What every command's test asserts](../../.agents/skills/pp-cli/references/cli-tests.md#what-every-commands-test-asserts), plus: the recipient's address reaches the fake as the argument and no output line holds it; a missing `LEDGER_URL` → exit `2` naming it; a bounce type holding `\u001b` prints `*` in human output | Exit mapping; the masked echo |
| R13 | `apps/local/src/main.e2e.test.ts` (e2e, updated): boots with a placeholder `DATABASE_URL` and key (no Docker: the pool connects lazily); `GET /` → `404 route_not_found` shape; unsigned `POST /webhooks/resend` → `401` `unauthorized`; `--host 0.0.0.0` → exit 1 (kept); missing `LEDGER_ADDRESS_HASH_KEY` → exit 1 naming it | Loopback guard; config assertion |
| D31 | `apps/local/src/setup/merge-local-env.test.ts` (unit) | Overwriting a key |
| D8 | `packages/shared/src/in-process-queue.adapter.test.ts` (unit, `FakeClock`): at-least-once; failures redelivered up to 5 receives then dead-listed with a log line; batch ≤ 10 | Silent drop |
| Batch failure (Mandatory, worker failure path) | `packages/worker/src/create-worker.int.test.ts`: a batch of three where one body fails `ingestEnvelopeSchema` returns exactly that `messageId`; the other two commit | An empty or assumed failure list |
| R14 (Ships 9) | The `drift` stage itself: its canary on every run, then the committed files | The comparison (the canary misses) |
| R16 (Ships 10) | `sim/src/invariants/invariant-1.test.ts`, `invariant-2.test.ts` (unit): each checker over a constructed ground truth and rows, pass and fail cases; `sim/src/main.e2e.test.ts` (offline, unchanged plus labels); the live run itself in the walkthrough (A2) | A checker that cannot fail |
| D39 (Ships 12) | `packages/core/src/testing/test-address-sequences.test.ts` (unit): each observed sequence projects to the deliverability its observation implies | Fixtures that do not match the observation |

`int` timeouts are set from the first measured run, never guessed
([vitest-layout](../../.agents/skills/pp-testing/references/vitest-layout.md#root-config)).

`pnpm verify` covers all of the above except the live run of `pnpm sim` (a walk step) and the
Resend experiments. It cannot see:

- Neon's pooler (PG-U02, slice 2);
- Resend's live payload shapes beyond the three sends;
- a process crash losing in-process queued events (§3, accepted locally).

## 21. Walkthrough plan

`openspec/changes/slice-1-local-ledger-and-read-path/WALKTHROUGH.md`, in [the format](../../.agents/skills/rsa-manual-test/references/walkthrough-format.md).

Personas reaching slice 1:

- **Reviewer:** the simulator and CLI.
- **Support / on-call engineer:** J2 through `ledger email` and `ledger recipient`.
- **Application developer:** recipient lookup over HTTP, ingest's boundary, and the real-traffic loop.

Not reaching it:

- **Operator:** health, gaps, reconcile and DLQ land in slices 2–4.
- **AI agent:** MCP is slice 5's.

Every `UI surfaces` entry is reached:

- `POST /webhooks/resend` (local): A2, C2, D5.
- `resend webhooks listen`: D2.
- `ledger email`: A3, B1, B3, D6.
- `ledger recipient`: B2, B4, D7.
- `pnpm sim --duplicates 0.2 --shuffle`: A2.

**Before you start:** `pnpm install`; Docker running; `pnpm dev:full` in a background terminal,
waiting for `LEDGER READY` (this runs `pnpm db:setup`). Then `export LEDGER_TOKEN=unused-in-slice-1`.
`LEDGER_URL` comes from `.env.local`, which `pnpm -s ledger` and `pnpm sim` load.

- **This walk creates:** a sim run namespace's rows; for Path D, a temporary webhook and three test
  emails' rows.
- **Ask-first steps:** D2, D4 (×3), D8, T1 (if a webhook is left over).

- **Path A — `pnpm sim` → `POST /webhooks/resend` → `ledger email` (Reviewer).**
  - A1: `pnpm -s sim --duplicates 0.2 --shuffle`. Expect exit `0`; line 1 `sim seed=… namespace=…`;
    a `sent requests=<k> accepted=<k>` line; `invariant 1 pass stored=<n>/<n>`; `invariant 2 pass emails=<m> recipients=<r>`;
    invariants 3 and 4 `not checked`.
  - A2: rerun with A1's printed seed and namespace. Expect identical stdout: every event is now a
    duplicate, and invariants 1–2 still pass.
  - A3: `pnpm -s ledger email <namespace>-probe --json`, with A1's namespace (D38's walk probe).
    Expect exit `0`, `"object": "email"`, `"status": "bounced"`, two recipients (`delivered`, and
    `bounced` with `Permanent` / `General`), and masks only. The same `status` and `event_count` show
    in A1's JSON for that email.
- **Path B — J2 support lookup (Support / on-call engineer).**
  - B1: `pnpm -s ledger email <namespace>-probe`. Expect the human layout (§12), no `\u001b[`.
  - B2: `pnpm -s ledger recipient bounced+<namespace>@resend.dev`. Expect `deliverability   hard_bounced`
    and `caused by   <namespace>-probe`, with the address only as its mask. Then
    `pnpm -s ledger recipient delivered+<namespace>@resend.dev --json`: `"deliverability": "ok"`.
  - B3: `pnpm -s ledger email no-such-email --json`. Expect exit `1`, `"code": "email_not_found"` on stdout.
  - B4: `pnpm -s ledger recipient never-seen+walk@resend.dev`. Expect exit `1`; stderr holds the
    message and `hint: Check the address. …`; stdout empty.
  - B5: `pnpm -s ledger email 'bad id!' --json`. Expect exit `1`, `"code": "validation_failed"`.
  - B6: `pnpm db:down`; `pnpm -s ledger email <namespace>-probe --json`. Expect exit `1`,
    `"code": "database_unavailable"`. Then `pnpm db:up`.
  - B7: `pnpm -s ledger email`. Expect exit `2`, commander's missing-argument message, stdout empty.
- **Path C — HTTP surface and ingest boundary (Application developer).**
  - C1: `curl -s -X POST "$LEDGER_URL/recipients/lookup" -H 'content-type: application/json' -d '{"address":"bounced+<namespace>@resend.dev"}'`.
    Expect `200`, `"object": "recipient"`, `"deliverability": "hard_bounced"`, masked address.
  - C2: an unsigned or bad-signature `POST $LEDGER_URL/webhooks/resend` (the format's worked example).
    Expect `401`, body `unauthorized`.
  - C3: `curl -s "$LEDGER_URL/nope"`. Expect `404`, `"code": "route_not_found"`.
  - C4: `pnpm --filter @ledger/app-local start --host 0.0.0.0 --port 3299`. Expect exit `1` and a
    refusal line naming loopback.
- **Path D — real Resend traffic, locally (Application developer). Every write Ask-first.**
  - D1: start a tunnel to port 4318 (the owner's tool).
  - D2: **Ask-first:** `resend webhooks listen --url <tunnel> --forward-to "$LEDGER_URL/webhooks/resend"`.
  - D3: read-only `resend webhooks get <temporary id>`. Put its secret into `LEDGER_WEBHOOK_SECRETS`
    in `.env.local` (never pasted elsewhere). Restart `apps/local`.
  - D4: **Ask-first:** send `delivered@resend.dev` + `bounced@resend.dev` in one email; then
    `complained@resend.dev`; then `suppressed@resend.dev` (curl against Resend's Send Email, the
    format's worked example). If the response is `403 validation_error`, RS-U14 is negative and
    Ships 11–12 block (§24).
  - D5: `listen` stdout shows each event and its forwarded status. Expect `200` from local ingest
    (RS-U22 positive), or `401` (RS-U22 negative, recorded).
  - D6: `pnpm -s ledger email <the two-recipient email id> --json`. Expect two recipients: the
    `delivered@` one `delivered`, the `bounced@` one `bounced` (RS-U21 positive), or otherwise, as
    recorded.
  - D7: `pnpm -s ledger recipient delivered@resend.dev` → `ok`; `pnpm -s ledger recipient bounced@resend.dev`
    → `hard_bounced` if `bounce.type` was `Permanent`.
  - D8: **Ask-first:** a second short `listen` session, killed by closing its terminal. Then a
    read-only `resend webhooks list`: count the temporary webhooks left behind (RS-U18), never
    printing the response.
- **Teardown:** T1, **Ask-first if needed:** delete a webhook D8 left behind. T2: Ctrl+C the first
  `listen` session. T3: `pnpm dev:stop`.

**Cannot reach today:**

| Not reachable | Carried by |
| --- | --- |
| Bearer-token enforcement, `ledger health`, the deployed ingest | [slice 2](../build-checklist.md#2--durable-ingest-on-aws) |
| A DLQ and its inspection | [slice 3](../build-checklist.md#3--operations-and-evidence-on-aws), [slice 2B](../build-checklist.md#2b--local-mode-queue-and-docker-compose) |
| `ingest.rejected`, the rotation runbook, the retired-secret test | [slice 4](../build-checklist.md#4--recovery) |
| MCP tools, `ledger explain` | [slice 5](../build-checklist.md#5--mcp-server-and-contract-hardening) |
| `docker compose up` local mode | [slice 2B](../build-checklist.md#2b--local-mode-queue-and-docker-compose) |

## 22. Docs to update

Applied by the change, in the commits that land each piece:

- [build-checklist.md](../build-checklist.md#1--local-ledger-and-read-path): tick Ships 1–13 as each
  lands; `Status` `[~]` from the first, `[x]` after the walk. `[!]` with a one-line reason if Ships
  11–12 block on RS-U14 (§24).
- [data-modeling.md](../data-modeling.md):
  - Model index: tick `Modeled` for the four tables.
  - `webhook_events` field table: nullability of `type`, `event_created_at`, `email_id` and
    `to_hashes` (C5); `received_at` has no default.
  - `email_state`: `from_masked` / `subject_masked` nullable.
  - Slice 1 evidence lines → the tests in §20.
  - PII evidence "an invariant" → `projection-pii.int.test.ts` (Ships 5's wording).
  - Log-fields evidence → `create-logger.test.ts`.
  - Open questions: RS-U21 → resolved with the fact id.
- [api-contract.md](../api-contract.md):
  - Conventions → Public environment variables: `LEDGER_WEBHOOK_SECRETS`, `LEDGER_ADDRESS_HASH_KEY`.
  - Error codes: the `route_not_found` row (owner-approved 2026-10-17).
  - `validation_failed`'s Hint cell reads as a hint: "Fix the field the message names, then retry"
    (it currently describes, "`message` names the field"). A fact correction; the code is unchanged.
- [architecture.md](../architecture.md):
  - Reliability core evidence: No loss → sim invariant 1 (slice 1, local); Order independence → sim
    invariant 2 under `--shuffle`.
  - ADR-001, ADR-004, ADR-009, ADR-011, ADR-018 and ADR-019 **Evidence** → the slice 1 tests.
- [resend.md](../resend.md): RS-U15, RS-U18, RS-U21 and RS-U22 settled as new `RS-NN` facts with
  date and experiment, the rows struck through with pointers. Constraint 12: RS-02 re-checked against
  pinned `resend` 6.33.0 (D10's constructor finding included). Sources: the experiments.
- [about.md](../about.md):
  - What this project must demonstrate, rows 1 (worker-transaction integration tests), 2 (`packages/db`
    schema; migrations in CI) and 6 (the read-API contract): link the evidence.
  - Open questions: the RS-U15/U18/U21/U22 bullets → settled.
  - Library bullets resolved with findings: `@hono/zod-openapi` 415; drizzle-kit output layout; the
    `Executor` type; pending migrations in one transaction; `check()` regeneration (safe either way,
    cite the closed-set tests); Vitest project `globalSetup`.
  - Two new bullets, resolved in the same change at install: `openapi-typescript` under TypeScript 7
    (or the 5.9.3 fallback); drizzle-kit loading a schema that imports `@ledger/core` source.
  - **Helper-gated edit (C14):** the identity-on-`bigint` and identity-sequence-grant items move to
    slice 2. They loosen an evidence requirement on their face, so an independent helper reviews the
    diff against the code (no identity column in slice 1) before it is applied, and the verdict goes
    in the commit body.
- [features.md](../features.md): the slice 1 pointers (Ingest, Ledger & projections, extend, rotate
  secret, query, J2, J5) link their tests.
- Root [AGENTS.md](../../AGENTS.md):
  - Commands: `pnpm db:setup`, `pnpm db:generate` (`drizzle-kit generate` in `packages/db`, flags
    passed through), `pnpm openapi:export`, `pnpm ledger` / `pnpm -s ledger`; `pnpm test:int` no
    longer "lands in slice 1"; the verify stage list with `drift` and `int`; `pnpm dev:full` runs
    `db:setup`.
  - Projects: the `apps/api` scaffold note (C12).
- [.env.example](../../.env.example): §18's lines (C6).
- [rsa-manual-test → environment.md](../../.agents/skills/rsa-manual-test/references/environment.md):
  slice 1 rows with exact start commands (`pnpm -s ledger`, `pnpm db:setup`, `pnpm sim` live when
  `LEDGER_URL` is set); "no `bin` until slice 8" (C7); traps: `pnpm -s` for `--json`, the
  placeholder `LEDGER_TOKEN`.
- Skill corrections, each a fact this slice settles (no rule loosened):
  - [pp-backend → composition](../../.agents/skills/pp-backend/references/composition.md): the
    ingest mount (D32).
  - [pp-backend → read-api](../../.agents/skills/pp-backend/references/read-api.md): unmatched path
    → `route_not_found`; the 415 finding.
  - [pp-backend → ingest-and-worker](../../.agents/skills/pp-backend/references/ingest-and-worker.md):
    the fixed body bytes (D11).
  - [pp-backend → sdk](../../.agents/skills/pp-backend/references/sdk.md): the types path (D26).
  - [pp-database → schema-and-repositories](../../.agents/skills/pp-database/references/schema-and-repositories.md):
    the `Executor`, `createDatabase`; the classifier lands in slice 1 and is applied in the read API (C3).
  - [pp-database → migrations-and-grants](../../.agents/skills/pp-database/references/migrations-and-grants.md):
    the role name, programmatic `migrate()`, `prepareDatabase`, the `db:generate` script.
  - [pp-testing → postgres-harness](../../.agents/skills/pp-testing/references/postgres-harness.md):
    the entry-point name, the image `postgres:18.6-alpine`, step 2 "(timeouts from slice 2)" (C13).
  - [pp-testing → vitest-layout](../../.agents/skills/pp-testing/references/vitest-layout.md): the
    `globalSetup` finding; the contract-test location (D41).
  - [pp-testing → fakes-and-doubles](../../.agents/skills/pp-testing/references/fakes-and-doubles.md):
    the logger's stream (D15).
  - [pp-testing → simulator](../../.agents/skills/pp-testing/references/simulator.md): settle
    detection and live-mode selection (D37), mandatory labels (D38).
  - [pp-cli](../../.agents/skills/pp-cli/SKILL.md): the bin and start (D33), layouts → this document §12.
  - [pp-general → logging-and-pii](../../.agents/skills/pp-general/references/logging-and-pii.md):
    the optional stream (D15).
- `scripts/verify.mjs` header comment (the `int` and drift stages landed).

The C14 move is the one edit that loosens on its face. It goes through the independent-helper gate
([Never loosen a rule](../../AGENTS.md#never-loosen-a-rule-to-fit-what-was-built)). Every other line
above is a fact correction or an evidence link.

## 23. OpenSpec mapping

Change `slice-1-local-ledger-and-read-path` at `openspec/changes/slice-1-local-ledger-and-read-path/`.
Against `find openspec/specs -name spec.md` (six capabilities):

| Capability path | Delta | Requirements |
| --- | --- | --- |
| `webhook-ingest` | **ADDED** | R1, R2, R3; D9–D12; the local mount (D32) |
| `event-ledger` | **ADDED** | R4, R5, R6, R7, R8; D14, D17; the in-process queue's at-least-once delivery (D8) |
| `projection-privacy` | **ADDED** | R9; the keyed address hash format (D1, D2) at the ledger boundary; R10 (log allow-list) |
| `read-api` | **ADDED** | `email.get`, `recipient.get` (§12); R11; R12's API half; R13; `route_not_found` (D23) |
| `sdk` | **ADDED** | `createLedgerClient`, `{ data, error }`, `api_unavailable`, the bearer header (D26, D27) |
| `cli` | **ADDED** | `ledger email`, `ledger recipient`, exit codes, `--json`, human layouts, control-character mapping (D28, D33, D34) |
| `local-stack` | **ADDED** | `pnpm db:setup` (D31); the composition and boot assertion (D29) |
| `address-masking` | **MODIFIED** | ADDED requirement "Keyed address hash" (D1). Existing requirements unchanged |
| `simulator` | **MODIFIED** | ADDED requirements "Live run against a local process" (D37, R16) and "Every address labelled with the run namespace, plus the walk probe" (D38); "Seeded history generation" MODIFIED: addresses always carry the label, and the history holds the probe email. "Projection output, masks only" keeps its offline scenario and gains a live one (keys are keyed hashes). "Deterministic output", "Duplicate and shuffle knobs" and "Bad flags" unchanged |
| `verify-gate` | **MODIFIED** | "One gate, identical locally and in CI": the stage list becomes D43's. ADDED "Contract drift fails the gate and proves itself" (R14) and "Migrations apply to a fresh Postgres before integration tests" (R15) |

Task groups, each one or more commits pushed as it lands, ordered so each is independently verifiable:

1. **Dependencies** (Ask-first, §7): install the approved packages; `workspace:*` entries; lockfile. Gate `pnpm check`.
2. **Kernel** (`packages/shared`): `LedgerError`, `ConfigError`, `loadConfig`, the logger and its
   Ships 7 test, clock, metrics port and local writer, queue port, in-process queue and tests.
3. **Core additions:** `hashAddress` / `addressHashKeyId`, `sanitizeForJsonb`, `ingestEnvelopeSchema`
   / `eventSourceSchema`, the error registry mirror; their tests.
4. **Database** (one commit for schema + migrations + Model index ticks, per [slice-scoping → Commit shape](../../.agents/skills/pp-workflow/references/slice-scoping.md#5--commit-shape)):
   schema files, generate + grant migrations, `Executor`, `createDatabase`, classifier and its unit
   test, `prepareDatabase`, repositories; harness, `int` project `globalSetup`, `int` verify stage
   (Ask-first CI); closed-set and duplicate-insert repository tests. Gate `pnpm check` + `pnpm test:int`.
5. **Ingest:** `createIngest`, the `Resend` instance (D10), fixed bodies, `signWebhook` in
   `@ledger/core/testing`, unit and round-trip tests (Ships 1).
6. **Worker:** `toLedgerRow`, `RecordEventCommand`, `createWorker`; unit and integration tests (Ships 3, 4, 5, 6).
7. **Read API:** routes, readers, mappers, request id, `defaultHook`, `onError`, `notFound`
   (Ask-first code); route tests; `export-openapi.ts`, `openapi:export`, generated files, Biome
   exclusion, the `drift` stage (Ask-first CI; Ships 9).
8. **SDK and CLI:** `createLedgerClient`, `@ledger/sdk/testing`; the CLI config, output writer,
   `run-operation`, two commands and their tests (Ships 8).
9. **Local stack:** `apps/local` composition, `ingest-fetch`, `setup/main.ts` + `mergeLocalEnv`,
   `db:setup`, `dev:full` step, `ledger` root script, updated e2e test, contract tests; `apps/api` stub;
   `.env.example` (Ask-first env vars).
10. **Simulator:** `labelEveryAddress`, live mode, settle, invariant checkers and tests (Ships 10).
11. **Live Resend experiments** (each action Ask-first, owner-run; D36): RS-U22, RS-U21, RS-U15,
    RS-U18; resend.md; `testAddressSequences` and its test (Ships 11–13). Depends on group 9.
12. **Docs** (§22) and `WALKTHROUGH.md` (§21).
13. **Gate:** `pnpm verify` → `VERIFY PASSED`; `pnpm exec openspec validate slice-1-local-ledger-and-read-path --type change --strict`; CI green on the pushed `HEAD`.

## 24. Risks

| Risk | Likelihood | Cost | Cheapest early catch |
| --- | --- | --- | --- |
| `resend.dev` test addresses are not exempt from the own-address rule (RS-34, RS-U14), so D4's sends `403` | Medium | Ships 11–12 cannot settle in slice 1; the card goes `[!]` until the project-domain tripwire is acted on ([about.md → Open questions](../about.md#open-questions), "Project domain") | Run the two-recipient send first in group 11. A `403` settles RS-U14 early, and the owner decides the domain |
| `openapi-typescript` 7.13.0 (peer `typescript ^5.x`) does not run under TypeScript 7.0.2 | Medium | Ships 9 blocked | First command of group 7. The pre-approved 5.9.3 fallback scoped to `packages/sdk` |
| drizzle-kit (through `tsx`) cannot load a schema importing `@ledger/core` source | Low | The closed-set tuples need another route into the schema | First `generate` in group 4. Fallback: the `check()` literal lists the members, and the closed-set integration test pins them against the core tuple |
| `listen`'s forwarded deliveries are not signed with a secret the local verifier can read (RS-U22 negative) | Low–medium | The Goal's "real … events, verified locally" fails. RS-U15 and RS-U21 still settle from stdout | D5's first forwarded delivery. If negative, record it, and the owner decides whether the Goal line changes (a card edit) |
| A project-level Vitest `globalSetup` does not run | Low | The harness never starts | The first `pnpm test:int` in group 4; D40's fallback |
| `@hono/zod-openapi` answers `415` outside the error shape | Medium | R12 broken for `recipient.get` | The contract test in group 7 (D22's mapping) |
| The concurrent-duplicate and two-email tests flake on timing | Low | A red `int` stage | Interleave by polling `pg_stat_activity`, never by sleeping ([harness](../../.agents/skills/pp-testing/references/postgres-harness.md#faults-and-concurrency)) |
| A sim run collides with an earlier one on compose Postgres | Low after D38 | False invariant 2 failures | D38's labels. The walk's A2 reruns on purpose |

## 25. Owner ops still open

- **Docker** running for `pnpm verify`, `pnpm test:int` and `pnpm dev:full`.
- **For Ships 11–13 only:**
  - a Resend API key in `.env.local` (`RESEND_API_KEY`);
  - the Resend CLI installed;
  - a public tunnel to port 4318 (RS-33);
  - approval of each `listen` session, each of the three sends, and any leftover-webhook deletion, at the time it runs.
- No `[Unverified]` question blocks drafting. RS-U14 becomes a blocker only if D4's send is refused
  (§24); the owner then rules on the project domain.
