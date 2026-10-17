# Proposal — slice 1: Local ledger and read path

## Why

Slice 1 is the next spine card ([build-checklist → 1](../../../.ai/build-checklist.md#1--local-ledger-and-read-path))
and the first slice that stores anything. Every later slice writes through what it lands: slice 2
swaps the in-process queue for SQS behind the same queue port and serves the same `createApi` app
through `@hono/aws-lambda`. Slice 4's replays dedupe on the `svix_id` key this slice migrates. Slice
5's MCP tools call the SDK methods this slice generates. Locally is the cheapest point to prove
ingest, the worker transaction and the read path: the integration tier runs against real Postgres
in seconds with no AWS account ([ADR-013](../../../.ai/architecture.md#adr-013--pure-core-and-local-mode)).
A migration is cheap to regenerate only until it is merged to `main` or applied to a kept database.
Two `[Unverified]` rows MUST settle here: RS-U21 decides whether `email_recipients` is exact, and
RS-U22 decides whether real events verify locally at all
([Open questions owed by slice](../../../.ai/architecture.md#open-questions-owed-by-slice)).

The decision-complete brief is the checked pre-proposal
[2026-10-17-slice-1-local-ledger-and-read-path.md](../../../.ai/pre-proposals/2026-10-17-slice-1-local-ledger-and-read-path.md)
(cited below as *PP*). Every decision it settles (D1–D43, C1–C16, R1–R16) is carried forward
unchanged.

## What Changes

The card's `Ships` list, verbatim. Each bullet's state on `HEAD` is PP §5's (re-checked: only the PP
itself has landed since `04dc19e`).

1. Local ingest verifies signature and timestamp on the raw body against the configured secret set, first match wins, and returns `200` with a fixed body or `401`; evidence: unit tests with old, new and both signatures, forged and stale requests.
2. `packages/db` Drizzle schema and expand-only migrations for `webhook_events`, `email_state`, `email_recipients` and `recipient_state`; CI applies every migration to a fresh Postgres before the integration tests (ADR-018).
3. Worker runs one transaction per message behind the in-process queue port, deduplicating on `svix_id` (ADR-004, ADR-013); evidence: Testcontainers tests for a duplicate insert, a crash between steps, and a NUL payload stored with U+FFFD, projected and committed ([Immutable ledger](../../../.ai/data-modeling.md#immutable-ledger)).
4. Recipient rows locked in sorted `address_hash` order after the email lock; evidence: concurrency integration test with two emails sharing a recipient.
5. Projections hold masks and keyed address hashes only, under an address-hash key the setup script generates once into `.env.local` ([PII & retention](../../../.ai/data-modeling.md#pii--retention)); evidence: integration test finding no raw address or subject in any projection row.
6. Unknown and non-email event types, and schema-failing payloads of known types, stored raw, projection skipped, metric emitted; evidence: unit test.
7. The shared logger emits only the fields in [data-modeling.md → Log fields](../../../.ai/data-modeling.md#log-fields), never a payload or an error's `message` / `detail` from parsing or Postgres; evidence: unit test feeding a failing message with a test address and a `CHECK` violation, asserting no log line holds the address or subject.
8. Minimal read API (OpenAPI, Zod), SDK, `ledger email <email_id>` and `ledger recipient <address>` with `--json` in the error shape, auth skipped only on loopback; evidence: SDK ↔ API contract tests and CLI `--json` output tests.
9. `pnpm openapi:export` writes the committed `packages/sdk/openapi.json`, and a `pnpm verify` stage fails when it or the generated SDK types drift ([ADR-011](../../../.ai/architecture.md#adr-011--one-contract-many-surfaces)); evidence: the stage fails on a stale fixture.
10. `pnpm sim --duplicates 0.2 --shuffle` against the local process (`apps/local`) passes invariants 1 and 2.
11. RS-U21 settled by the Ask-first two-recipient send to `delivered@resend.dev` and `bounced@resend.dev`, observed through `resend webhooks listen`, with the result in resend.md.
12. RS-U15 recorded from the Ask-first test-address sends, with simulator fixtures mirroring the observed sequences; RS-U18 checked by a read-only `GET /webhooks` after an interrupted `listen` session.
13. RS-U22 settled in the first approved `listen` session: the temporary webhook's secret read with `resend webhooks get <id>`, loaded into the local secret set, and one forwarded delivery verified by local ingest, with the result in resend.md.

How each bullet lands, in one line (detail in [design.md](design.md)):

- **1:** `createIngest` in `packages/ingest` verifies with `resend`'s `webhooks.verify` once per
  secret (Resend set, then the simulator secret), enqueues an `ingestEnvelopeSchema` envelope, and
  answers `ok` / `unauthorized` / `unavailable` (PP D9–D12).
- **2:** four Drizzle tables, one generated and one custom grant migration, run by programmatic
  `migrate()` through `prepareDatabase`; a Testcontainers harness and an `int` verify stage
  (PP D18, D20, D40, D43).
- **3, 4, 6:** `RecordEventCommand`: sanitize, insert-if-absent on `svix_id`, lock email →
  `recipient_state` sorted → `email_recipients` sorted, recompute from the event set, commit; the
  in-process queue redelivers and dead-lists (PP D3, D8, D13, D14, D17, D19).
- **5:** `hashAddress` keyed by `LEDGER_ADDRESS_HASH_KEY`, which `pnpm db:setup` writes once
  (PP D1, D2, D31).
- **7:** `createLogger` with an allow-list format and `errorFields` that never reads `message` /
  `detail` (PP D15, D16).
- **8:** `createApi(deps)` with `email.get` and `recipient.get`, one `onError`, one `defaultHook`,
  `route_not_found`; `createLedgerClient`; `ledger email` and `ledger recipient`; `apps/local`
  composes it all on loopback (PP D21–D29, D32–D35, D41).
- **9:** `packages/api/scripts/export-openapi.ts`, `pnpm openapi:export`, and a `drift` stage with a
  canary on every run (PP D42, D43).
- **10:** `pnpm sim` goes live when `LEDGER_URL` is non-empty, labels every address with the run
  namespace, adds a walk probe email, settles, and checks invariants 1 and 2 (PP D37, D38).
- **11–13:** owner-run `listen` experiments, every write Ask-first and approved when it runs;
  results to resend.md; `testAddressSequences` fixtures (PP D36, D39).

No **BREAKING** change for adopters: nothing is deployed yet. Two internal behaviors change and are
specified in the modified capabilities: `apps/api`'s handler becomes a stub until slice 2 (PP C12,
D35), and a fixed seed's `pnpm sim` output changes once because every address gains the run label
(PP D38).

**Out of scope** (PP §3): the card's Deferred tail ("SQS, DLQ, CDK and bearer tokens (slice 2). DLQ
operations (slice 3). Rotation runbook and retired-secret test (slice 4). `email.explainDelivery`
and MCP (slice 5). `docker compose` local mode (slice 2B).") plus, each with its carrier in PP §3:
the `ingest.rejected{reason}` metric (slice 4); the secret-reading port and its TTL cache, the EMF
writer, ADR-015's worker pause, pool timeouts, the runtime role's timeouts, the runtime-role
`DELETE` / `CREATE TABLE` refusal test and the migration DDL lint (slice 2); a durable local queue
(slices 2 and 2B); `health.get` and token operations (slice 2); a `bin` entry (slice 8); a scripted
`listen` secret load (tripwire: the second walk that runs a `listen` session); SDK retries (slice 5);
the shared read-API contract suite (slice 2); projection rebuild (tripwire: the first change that
alters projection output).

## Capabilities

### New Capabilities

Mapped in PP §23.

- `webhook-ingest`: verify-then-enqueue at the local `POST /webhooks/resend`: the secret set, first
  match wins, `source` stamping, fixed bodies, `401` / `200` / `503`.
- `event-ledger`: the immutable ledger and its worker transaction: one row per `svix_id`, all or
  nothing, sanitized and raw storage, lock order, projections recomputed from the event set, the
  in-process queue's at-least-once delivery and batch failures.
- `projection-privacy`: no raw address, sender or subject in any projection row; keyed address
  hashes at the ledger boundary; the log allow-list.
- `read-api`: `email.get` and `recipient.get` over HTTP, masks only, one error shape with registered
  codes, `route_not_found`, loopback-only auth skip.
- `sdk`: `createLedgerClient`, `{ data, error }` results, `api_unavailable`, the bearer header.
- `cli`: `ledger email` and `ledger recipient`, exit codes, `--json`, human layouts, control
  characters mapped to `*`.
- `local-stack`: `pnpm db:setup` and `apps/local`'s composition and boot assertion.

### Modified Capabilities

- `address-masking`: ADDED requirement "Keyed address hash" (PP D1). Existing requirements
  unchanged.
- `simulator`: ADDED a live run against `apps/local` with invariants 1 and 2 (PP D37, R16) and
  labelled addresses plus the walk probe (PP D38); MODIFIED "Seeded history generation" (labels,
  probe) and "Projection output, masks only" (a live scenario).
- `verify-gate`: MODIFIED the stage list to `install, docker, secrets, lint, links, typecheck, drift,
  unit, int, synth, e2e` (PP D43); ADDED contract drift with its canary (PP R14) and migrations on a
  fresh Postgres before integration tests (PP R15).

## Impact

- **Code:** `packages/core` (`hashAddress`, `sanitizeForJsonb`, `ingestEnvelopeSchema`, the error
  registry mirror, `signWebhook` and `testAddressSequences` in `./testing`, `ledgerHistory`
  options), `packages/shared`, `packages/db`, `packages/ingest`, `packages/worker`, `packages/api`,
  `packages/sdk`, `apps/local`, `apps/cli`, `apps/api` (stubbed), `sim`, `scripts/verify.mjs`,
  `scripts/openapi-drift.mjs` (new), root `package.json`, `biome.json`, `vitest.config.ts`,
  `tsconfig.json`, `.env.example`.
- **Public contract:** two read operations (`email.get`, `recipient.get`), already in
  [api-contract.md](../../../.ai/api-contract.md#emailget) under slice 1; one new error code; two new
  environment variables; two CLI commands already named in the contract.
- **Schema:** four tables and two migrations, pure expand.
- **No** AWS resource, no Resend API call from Ledger code (`webhooks.verify` is local crypto,
  RS-02). The owner's experiments use the Resend CLI.
- **Docs** (PP §22): build-checklist card, data-modeling.md, api-contract.md, architecture.md,
  resend.md, about.md, features.md, root AGENTS.md (Commands, Projects), `.env.example`,
  rsa-manual-test `environment.md`, and fact corrections in pp-backend, pp-database, pp-testing,
  pp-cli and pp-general references, plus `WALKTHROUGH.md` in this folder. One edit loosens on its
  face: the C14 move of two library bullets to slice 2. It goes through the independent-helper gate
  ([root AGENTS.md → Never loosen a rule](../../../AGENTS.md#never-loosen-a-rule-to-fit-what-was-built))
  and its verdict goes in the commit body.

**Ask-first items** ([root AGENTS.md → Permissions](../../../AGENTS.md#permissions)). Every row but
the last was approved by the owner on 2026-10-17 in one itemized round (PP §7, approvals table):

| Item | Exact scope approved | PP §7 row |
| --- | --- | --- |
| Dependency `drizzle-orm` | `0.45.4` exact, `dependencies` of `packages/db` | `drizzle-orm` |
| Dependency `pg`, `@types/pg` | `pg` `8.23.1` exact, `dependencies` of `packages/db`; `@types/pg` `8.23.1` exact, `devDependencies` of `packages/db` | `pg` + `@types/pg` |
| Dependency `drizzle-kit` | `0.31.11` exact, `devDependencies` of `packages/db` | `drizzle-kit` |
| Dependency `@testcontainers/postgresql` | `12.2.1` exact, `devDependencies` of `packages/db` | `@testcontainers/postgresql` |
| Dependency `resend` | `6.33.0` exact, `dependencies` of `packages/ingest` | `resend` |
| Dependency `winston` | `3.19.0` exact, `dependencies` of `packages/shared` | `winston` |
| Dependency `openapi-fetch` | `0.17.0` exact, `dependencies` of `packages/sdk` | `openapi-fetch` |
| Dependency `openapi-typescript` | `7.13.0` exact, `devDependencies` of `packages/sdk` | `openapi-typescript` |
| Dependency `typescript` 5 (conditional) | `5.9.3` exact, `devDependencies` of `packages/sdk` only, added only if `openapi-typescript` fails under TypeScript 7.0.2 | `typescript` 5 fallback |
| Public env var `LEDGER_WEBHOOK_SECRETS` | Optional, comma-separated `whsec_…` values, read by `apps/local` ingest | `LEDGER_WEBHOOK_SECRETS` |
| Public env var `LEDGER_ADDRESS_HASH_KEY` | 64 hex characters, written once by `pnpm db:setup`, read by `apps/local` and `pnpm sim` | `LEDGER_ADDRESS_HASH_KEY` |
| Error code `route_not_found` | `404`, raised by the `packages/api` not-found handler | `route_not_found` |
| CI change | Two new stages in `scripts/verify.mjs` (`drift` after `typecheck`, `int` after `unit`); no `.github/workflows/ci.yml` edit | CI change |
| Schema / migrations | The four tables of PP §8; migrations `create-ledger-tables` and `grant-ledger-tables`; unfrozen until merged to `main` | Schema |
| Dependency `zod` in `apps/cli`, `apps/local` | `4.6.7` exact, `dependencies` of both, for `cli.config.ts` and `local.config.ts` (pp-general's config loader) | Approved by the owner at apply, 2026-10-17: "Approve zod in both apps" |
| Live Resend writes | Each `resend webhooks listen` session; three test sends (`delivered@` + `bounced@` together, `complained@`, `suppressed@resend.dev`); any leftover-webhook deletion | Live Resend writes — **held: approved one at a time, when each runs** |

`zod` `4.6.7` in `packages/shared`, `packages/db`, `packages/sdk` and `packages/worker`, and `hono`,
`@hono/zod-openapi` and `@hono/node-server` where they already are, are ratified by ADR-019 and need
no new approval. `"@ledger/<pkg>": "workspace:*"` entries are boundary declarations, not Ask-first
(PP §7, O-09). Anything outside these rows (another package, version, stage, env var or code, or a
`ci.yml` edit) stops for the owner at apply. No AWS resource or deploy is crossed.
