# Design — slice 1: Local ledger and read path

## Context

See [proposal.md → Why](proposal.md#why). The pre-proposal
[2026-10-17-slice-1-local-ledger-and-read-path.md](../../../.ai/pre-proposals/2026-10-17-slice-1-local-ledger-and-read-path.md)
(*PP*) is decision-complete and checked (16 repairs, nothing left for the owner). Each decision
below keeps its PP number (D1–D43) and carries what `opsx:apply` needs to build it. The PP keeps the
full authority trail, the contradictions C1–C16, and two build tables this design points at rather
than copies: **PP §8** (every column, nullability, check, index and grant of the four tables) and
**PP §12** (every response body, human layout, error message and hint). This design adds no
decision the PP did not settle.

State on `HEAD` (PP §5, re-checked 2026-10-17: only the PP has landed since `04dc19e`):

- `packages/{shared,db,ingest,worker,sdk}/src/index.ts` are `export {}` stubs. `packages/api`'s
  `createApi()` is routeless; `apps/api/src/api.handler.ts` serves `handle(createApi())`.
- `apps/local/src/main.ts` serves the routeless API on loopback, already refuses a non-loopback
  `--host` (`is-loopback-host.ts`, e2e `main.e2e.test.ts`), and writes hand-built JSON lines.
- `apps/cli` has the program, the output writer and the exit mapping, but no command.
- `packages/core` has the slice 0 schemas, projections, masks, `normalizeAddress` and
  `@ledger/core/testing` (`ledgerHistory`, `emailHistory`). No keyed hash, sanitizer or ingest
  envelope.
- `pnpm sim` is offline only. `scripts/verify.mjs` runs
  `install, docker, secrets, lint, links, typecheck, unit, synth, e2e`. The Vitest `int` project
  has no `globalSetup`.
- None of `drizzle-orm`, `pg`, `drizzle-kit`, Testcontainers, `resend`, `winston`, `openapi-fetch`,
  `openapi-typescript` is installed.

Binding constraints: ADR-001, ADR-002, ADR-003, ADR-004, ADR-005, ADR-008, ADR-009, ADR-011,
ADR-013, ADR-016, ADR-018, ADR-019 ([Decisions](../../../.ai/architecture.md#decisions)); the module
boundaries in root [AGENTS.md](../../../AGENTS.md#module-boundaries); and the `pp-general`,
`pp-backend`, `pp-database`, `pp-testing`, `pp-cli` and `pp-workflow` skills.

## Goals / Non-Goals

**Goals:**

- One write path, proven on real Postgres: verify → enqueue → one transaction per message →
  projections recomputed from the event set. Slice 2 swaps only the queue adapter and the HTTP
  adapter.
- Every `Ships` bullet's evidence is a test the gate runs, except the live simulator run (a walk
  step) and the Resend experiments (owner-run).
- One contract, many surfaces: the read API's OpenAPI document is the source of the SDK types, and a
  drift stage that proves itself keeps them equal.

**Non-Goals** (design-level; scope exclusions are in proposal.md):

- No port for secret reading, no TTL cache: ingest takes its secret set as typed config (C2).
- No incremental projection update: every projectable event recomputes (ADR-003).
- No runtime role connection locally: `apps/local` connects as the owner; the harness proves the
  grants (D30).
- No CLI-side input validation: the API validates, the CLI renders (D28).
- No `@ledger/api/testing` contract suite yet: it lands with the second runner in slice 2.

## Decisions

### Module layout

| Package | File → export | Decision |
| --- | --- | --- |
| `packages/core` | `hash-address.ts` → `hashAddress`, `addressHashKeyId` | D1 |
| | `sanitize-for-jsonb.ts` → `sanitizeForJsonb` | D3 |
| | `error-codes.ts` → `errorCodes`, `errorCodeSchema`, `errorRegistry`, `RUNBOOK_BASE_URL` | D4 |
| | `ingest-envelope.schema.ts` → `ingestEnvelopeSchema`, `eventSourceSchema`, `IngestEnvelope` | D12 |
| | `testing/sign-webhook.ts` → `signWebhook`; `testing/test-address-sequences.ts` → `testAddressSequences` (public via `./testing`) | D37, D39 |
| `packages/shared` | `ledger-error.ts` → `LedgerError`; `config-error.ts` → `ConfigError`; `load-config.ts` → `loadConfig` | D5, D6 |
| | `create-logger.ts` → `createLogger`, `errorFields`, `LogFields` | D15 |
| | `queue.port.ts` → `QueuePort`; `clock.port.ts` → `ClockPort`; `metrics.port.ts` → `MetricsPort`; `log-metrics.adapter.ts` → the logger-backed metrics writer | D7, D16 |
| | `in-process-queue.adapter.ts` → `InProcessQueueAdapter` | D8 |
| | `testing.ts` → `FakeClock`, `RecordingMetrics` (via `./testing`) | D7 |
| `packages/db` | `schema/webhook-events.ts`, `schema/email-state.ts`, `schema/email-recipients.ts`, `schema/recipient-state.ts` | D18 |
| | `executor.ts` → `Executor`, `Transaction`; `create-database.ts` → `createDatabase` | PP §8 |
| | `classify-database-error.ts` → `classifyDatabaseError` | D22, C3 |
| | `prepare-database.ts` → `prepareDatabase`, `RUNTIME_ROLE` | D20 |
| | `*.repository.ts`, one per table | PP §8 Repositories |
| | `testing/postgres-global-setup.ts`; `testing.ts` → `createTestDatabase` (via `./testing`) | D40 |
| | `drizzle/0000_create-ledger-tables.sql`, `drizzle/0001_grant-ledger-tables.sql`, `drizzle.config.ts` | D20 |
| `packages/ingest` | `create-ingest.ts` → `createIngest`, `IngestResponse`; `ingest-bodies.ts` → `INGEST_BODY_OK`, `INGEST_BODY_UNAUTHORIZED`, `INGEST_BODY_UNAVAILABLE`, `INGEST_CONTENT_TYPE` | D9–D11 |
| `packages/worker` | `to-ledger-row.ts` → `toLedgerRow`; `record-event.command.ts` → `RecordEventCommand`; `create-worker.ts` → `createWorker` | D13, D14, D17 |
| `packages/api` | `create-api.ts` → `createApi(deps)`; `get-email.route.ts`, `get-recipient.route.ts`; `get-email.reader.ts`, `get-recipient.reader.ts`; `email-response.mapper.ts`, `recipient-response.mapper.ts`; `scripts/export-openapi.ts` | D21–D25, D42 |
| `packages/sdk` | `create-ledger-client.ts` → `createLedgerClient`, `apiUnavailable`, `internalError`; `openapi-types.ts` (generated); `openapi.json` (generated, package root); `testing.ts` → `FakeLedgerClient` | D26 |
| `apps/cli` | `cli.config.ts`, `run-operation.ts`, `commands/email-get.cli.ts` → `emailGetCli`, `commands/recipient-get.cli.ts` → `recipientGetCli`; `create-output.ts` gains `json`, `result`, `failure`, `notice`, `printable` | D28, D34 |
| `apps/local` | `local.config.ts`, `ingest-fetch.ts` → `ingestFetch`, `main.ts`; `setup/main.ts`, `setup/merge-local-env.ts` → `mergeLocalEnv`; `sdk-contract.int.test.ts` | D29–D32, D41 |
| `apps/api` | `api.handler.ts` → `export {}` with a comment pointing at slice 2 | D35, C12 |
| `sim` | `src/main.ts` (live mode), `src/live-run.ts`, `src/invariants/invariant-1.ts`, `src/invariants/invariant-2.ts` | D37, D38 |
| `scripts` | `openapi-drift.mjs` (the `drift` stage); `verify.mjs` gains `drift` and `int` | D42, D43 |

Each package's `index.ts` re-exports its primary exports; `./testing` subpaths are added to
`package.json` `exports` only where a consumer in this diff imports them. File names follow
pp-general's role suffixes. Closed sets are Zod enums with `as const` tuples, never a TypeScript
`enum` or a `pgEnum`.

### Core and kernel

**D1 — Keyed address hash in core.** `hashAddress(key: Uint8Array, address: string)` returns
`<key_id>.<hex HMAC-SHA-256(key, normalizeAddress(address))>`; `addressHashKeyId(key)` is the first
8 hex characters of `HMAC-SHA-256(key, "ledger:key-id")`. Both use `node:crypto` `createHmac`, a
Node built-in, so core stays pure (ADR-013). Normalizing inside means no caller can hash an
unnormalized address. *Rejected:* an inline HMAC elsewhere; an unkeyed hash (dictionary-reversible
over known addresses).

**D2 — Key form.** `LEDGER_ADDRESS_HASH_KEY` is 64 lowercase hex characters, decoded to 32 bytes at
the composition root and passed as config. Anything else fails the boot assertion, naming the
variable. An empty key would hash under the wrong key silently.

**D3 — Sanitizer.** `sanitizeForJsonb(value) → { value, sanitized }` replaces every `\u0000` and every
lone UTF-16 surrogate with U+FFFD in every string, object keys included (`jsonb` rejects them in keys
too), leaves valid pairs intact, and sets `sanitized` exactly when something changed. Pure core.

**D4 — Error registry mirror.** `errorCodes` is the `as const` tuple of every
[registry](../../../.ai/api-contract.md#error-codes) code plus `route_not_found`; `errorRegistry`
maps each to its HTTP status (`null` for run-outcome and client-side codes), default `message`,
`hint` and `docs`. `docs` is the Resend page the registry names or `` `${RUNBOOK_BASE_URL}#${code}` ``,
where `RUNBOOK_BASE_URL` is the `origin` remote's public GitHub tree plus `/blob/main/docs/runbook.md`.
The runbook is slice 3's, so those links 404 until then (a named later slice carries it). The
registry-drift test is slice 5's. PP §12 holds the exact messages and hints this slice raises.

**D5 — `LedgerError`, `ConfigError`.** `LedgerError` is pp-general's class verbatim (`code`,
`message`, `hint`, `docs`, `cause`, fields assigned in the body). `ConfigError extends Error`
carries the variable's name, never its value; the CLI exits `2` on it and `apps/local` exits `1`.

**D6 — Config loader.** `loadConfig(schema, env)` parses with Zod and throws `ConfigError` naming
each failing path and its expectation, never a value. Each composition root owns a
`<root>.config.ts`.

**D7 — Ports landing now:** queue, clock (`now(): Date`), metrics: exactly the three pp-backend marks
"Lands 1". Test doubles: `FakeClock` and a recording metrics double in `@ledger/shared/testing`.

**D8 — In-process queue.** `InProcessQueueAdapter.enqueue(envelope)` serializes the envelope to a JSON
string body, as SQS would hold it, and stores `{ messageId, body }` with `envelope.svixId` recorded
beside it (a body that fails to parse has no readable id, and `messageId` is not an allow-listed log
key). `start(consumer)` delivers up to 10 messages per call (ADR-008's batch size);
`consumer(messages) → { batchItemFailures }`. Failed messages are redelivered after 1 s, up to 5
receives (AWS-09's default), then moved to an in-memory dead list with one `queue.dead_lettered`
line carrying `svix_id` and `receive_count`. `messageId` is a counter. At-least-once, no order
(ADR-002). It does no I/O, so it lives in `packages/shared`. *Rejected:* a durable local queue now
(slice 2B owns `local_queue_messages`).

### Ingest

**D9 — `createIngest`.** `createIngest({ secrets: { resend: readonly string[]; simulator: string | undefined }, queue, clock, logger, metrics })`
returns `(request: { rawBody: string; headers: { 'svix-id'?; 'svix-timestamp'?; 'svix-signature'? } }) => Promise<{ status: 200 | 401 | 503; body: string }>`.
In order: (1) any `svix-*` header missing → `401`; (2) `webhooks.verify` once per secret, the
Resend set in configured order then the simulator secret, first match wins and sets `source`, any
throw counts as no match; (3) no match → `401`, one `ingest.request_rejected` line with no fields
(an unverified `svix-id` is attacker-controlled); (4) build the envelope (D12), `receivedAt` from
the clock; (5) `enqueue` rejects → `503`, `ingest.enqueue_failed` with `svix_id` and `error_name`;
(6) resolved → `200`, metric `ingest.accepted` with `svix_id` and `type` when a string. At least one
secret overall is checked at boot (D29). *Rejected:* `ingest.rejected{reason}` now (slice 4, C4);
the secret-reading port (slice 2, C2).

**D10 — The `Resend` instance.** `resend` 6.33.0's `new Resend()` throws `Missing API key` without
one, and ingest holds no API key. Ingest constructs `new Resend('ingest-verifies-only')` once at
factory time, with a comment citing RS-02 and this decision. The constant never reaches a request
(ingest makes no API call) and does not match the `re_` gitleaks rule. *Rejected:* importing
`standardwebhooks` directly, a second dependency for the same call when
[integrations.md → Locked rules](../../../.ai/integrations.md#locked-rules-must) rule 1 names
`webhooks.verify`.

**D11 — Fixed bodies.** `text/plain; charset=utf-8`; `ok`, `unauthorized`, `unavailable`; exported
constants so slice 2's Lambda reuses them. A signed non-JSON body fails `verify` (which ends in
`JSON.parse`) and answers `401`; RS-26 says no real event takes that path.

**D12 — Ingest envelope.** `ingestEnvelopeSchema`:
`{ svixId: string (min 1), receivedAt: ISO 8601 with offset, source: 'live' | 'simulated', rawBody: string, headers: { 'svix-timestamp': string } }`.
`svix-signature` is dropped: nothing re-verifies a stored event. `eventSourceSchema` is the
`source` check's tuple. The slice 0 `webhookEnvelopeSchema` (the Resend payload) keeps its name (C8).

### Worker

**D13 — `createWorker`.** `createWorker({ db, clock, logger, metrics, addressHashKey })` returns
`{ processBatch(messages) → Promise<{ batchItemFailures: { itemIdentifier }[] }> }`, an object so
slice 2 can add `resume` (ADR-015). Messages run one at a time on the function's single size-1 pool
(ADR-005). Each message gets its own result; the failure list is built from those results, never
assumed (AWS-05). A failing message logs `worker.message_failed` with `errorFields`.

**D14 — `RecordEventCommand`, one transaction per message, READ COMMITTED:**

1. Parse the body with `ingestEnvelopeSchema`, then `JSON.parse(rawBody)`. Either failing is a defect:
   the message fails and is redelivered.
2. `sanitizeForJsonb(payload)`; when `sanitized`, emit `worker.payload_sanitized`.
3. `toLedgerRow` (D17), then `INSERT … ON CONFLICT (svix_id) DO NOTHING RETURNING svix_id`. No row →
   duplicate: emit `worker.duplicates`, commit, done.
4. Not projectable → emit `projection.unknown_event_type`, commit, done.
5. Lock: `email_state` insert-if-absent then `SELECT … FOR UPDATE`; then, for the **new event's**
   distinct `to_hashes` sorted by code unit, `recipient_state` insert-if-absent then `FOR UPDATE`;
   then the same, in the same order, for `email_recipients (email_id, address_hash)` (C9).
6. Read, after the locks, every `webhook_events` row with this `email_id` as `LedgerEvent[]`, with
   `recipientKeys` = `to_hashes`.
7. `projectEmail`; `UPDATE email_state`; write every `email_recipients` row of the projection
   (insert-then-lock in sorted order for rows the new event did not name, then `UPDATE`).
8. For each locked hash, `projectRecipient(hash, every email_recipients row for it)` →
   `UPDATE recipient_state`. Only the new event's recipients are recomputed: an event folds only into
   rows its own `data.to` names (RS-27).
9. Commit; emit `worker.processing_lag` (now − `receivedAt`, ms).

Placeholder values a lock insert writes (status null, counts 0, `last_event_at` the new event's
`event_created_at`, deliverability `ok`, the new event's mask) satisfy every `NOT NULL` and are
overwritten before commit, so no other transaction reads them. A null `lastEventAt` after folding
the new event is a defect and throws. No external call inside the transaction. A throw anywhere rolls
back everything, the ledger insert included. *Rejected:* patching a projection; a read-then-write
guard instead of `ON CONFLICT`; any other lock order.

### Logging and metrics

**D15 — Logger.** `createLogger({ functionName, stream? })` → `{ info, warn, error }(message, fields?)`.
Without `stream`, a Winston Console transport to stdout; with one (any `{ write(chunk) }`), a Winston
Stream transport for tests (C15). One format for both: `level`, RFC 3339 `timestamp`,
`function_name`, `cold_start` when set; only the exact keys of
[Log fields](../../../.ai/data-modeling.md#log-fields) plus `*_count` / `*_ms` keys with number
values; under an allowed key only a string, number or boolean; everything else dropped.
`errorFields(err)` → `{ error_name, error_code?, pg_code? }`, walking `cause` for the first SQLSTATE
and the first `LedgerError` code, never reading `message`, `detail` or `params`. `apps/local` builds
one logger each for `ingest`, `worker` and `api`. The constant messages are listed in PP §12 → Log
output.

**D16 — Metrics.** `MetricsPort` has `count(name, value)` and `duration(name, ms)`, `name` a union of
the [Technology](../../../.ai/architecture.md#technology) set. The one implementation writes through
the logger: the message is the metric name, the field `value_count` or `value_ms`, beside any
allow-listed ids. Emitted: `ingest.accepted`, `worker.duplicates`, `worker.payload_sanitized`,
`projection.unknown_event_type`, `worker.processing_lag`. *Rejected:* an EMF writer now (no Lambda to
read it, slice 2).

### Data

**D17 — `toLedgerRow(envelope, payload, addressHashKey)`.** Pure; each column read independently,
null where unreadable (ADR-004): `svix_id`, `received_at`, `source` from the envelope; `type` when a
string; `event_created_at` when `created_at` is an ISO 8601 date-time with offset; `email_id` when
`type` is one of the ten outbound `emailEventTypes` and the value is a string (so `email.received`
stays null); `to_hashes` = `data.to` through `hashAddress`, same positions, when outbound and `to` is
a string array; `payload` the sanitized parse output, never the Zod output. `projectable` iff
outbound, `emailEventSchema.safeParse` succeeds, `event_created_at`, `email_id` and `to_hashes` are
non-null, and `to_hashes.length === data.to.length`: `projectEmail`'s own skip rules, so the worker
locks exactly what the projection folds.

**D18 — Schema.** The four tables, column for column, as **PP §8** gives them: snake_case; closed sets
as `text` plus a named `check()` built from the core tuple, never `pgEnum`; `timestamptz`; no foreign
key, cascade, trigger or view; every constraint and index named in the `pgTable`. Key points:
`webhook_events` PK `svix_id`, `type` nullable with no `CHECK` (RS-25, C5), index
`(email_id, event_created_at)`, grant `SELECT, INSERT` only; `email_state` PK `email_id`;
`email_recipients` composite PK `(email_id, address_hash)` and index `(address_hash)`;
`recipient_state` PK `address_hash`; the three projection tables granted `SELECT, INSERT, UPDATE`.
Repositories are executor-first, one object per table, only the functions PP §8 lists; locking
functions take `Transaction`, the rest `Executor`. `createDatabase({ url, max: 1 })` → `{ db, pool }`
with `pool.on('error')` logging `db.pool_error` with `error_name` and `pg_code` only.

**D19 — Ships 6's unit test** is `to-ledger-row.test.ts` (unknown type, `contact.created`,
`email.received`, a schema-failing known type → payload unchanged, typed columns null where
unreadable, `projectable: false`). The integration test proves storage, no projection row and one
metric line each.

**D20 — Migrations.** `drizzle-kit generate --name create-ledger-tables` (all four tables), then
`--custom --name grant-ledger-tables` (four `GRANT`s to `ledger_runtime`). They run only through
programmatic `migrate()` from `drizzle-orm/node-postgres/migrator`, which keeps drizzle-kit out of
every runtime. `prepareDatabase({ ownerUrl, runtimePassword })` ensures the role
(`CREATE ROLE ledger_runtime LOGIN PASSWORD …` only when absent; the role's timeouts are slice 2's,
C13), then migrates on the owner's direct URL with `options: '-c lock_timeout=5s'`. `RUNTIME_ROLE`
and the grant migration spell the same literal, so a mismatch fails as `permission denied` in the
harness. Pure expand: no `DROP`, `RENAME`, `ALTER … TYPE` or `SET NOT NULL`. A root `pnpm db:generate`
runs `drizzle-kit generate` in `packages/db` with flags passed through.

### Read API, SDK, CLI

**D21 — `createApi(deps)`**, `deps = { db, logger, addressHashKey, requestId: () => string }`. Hono's
`requestId` middleware with `headerName: ''` and the injected generator (`crypto.randomUUID` in
`apps/local`); no response header; no token middleware in this slice. Two routes built with
`createRoute`, the operation id as `operationId`, responses `200`, `400`, `404`, `500`, `503`: `email.get`
(`GET /emails/{email_id}`) and `recipient.get` (`POST /recipients/lookup`). Each calls one reader and
one mapper. OpenAPI `info`: title `Ledger read API`, version `0.0.0`. Response bodies are PP §12's.

**D22 — Errors.** `defaultHook` maps every request-validation failure to `400 validation_failed` with a
message naming the field. `onError` runs `classifyDatabaseError(err)` first (a match →
`503 database_unavailable`, C3), then a `LedgerError` → its registry status, else
`500 internal_error`, logged as `api.internal_error` with `request_id` and `errorFields`. The
contract test sends `recipient.get` without `Content-Type`; if `@hono/zod-openapi` answers `415`
outside both hooks, `onError` or an explicit check maps it to `400 validation_failed` (field `body`)
before the slice is done.

**D23 — Unmatched path.** `app.notFound` answers `404 route_not_found` in the error shape for any
method and path no route serves (C16; owner-approved code). *Rejected:* Hono's default `404 Not Found`
text, a raw framework response.

**D24 — Address lookup.** Body `{ address }`; valid = trimmed length 3–320, one `@` with a non-empty
part on each side. The reader hashes with `hashAddress` (normalizing). The response echoes only
`address_masked`.

**D25 — `email_id` validation.** `^[A-Za-z0-9._-]{1,128}$`: Resend's UUIDs and the simulator's
namespaced ids.

The mappers follow PP §12: `recipients` ordered by `address_hash` (never returned); `timeline` in fold
order `(event_created_at` nulls last, `rank(type)`, `svix_id)`; `bounce_type` / `bounce_sub_type`
read from `data.bounce` only on `email.bounced`, by a non-throwing parse; an absent `email_state`
with timeline rows → `200`, `status: null`, zero counts, `recipients: []`.

**D26 — SDK.** `createLedgerClient({ baseUrl, token })` builds an `openapi-fetch` client from the
generated `paths`, sends `Authorization: Bearer <token>`, and uses `AbortSignal.timeout(31_000)` per
request (just above AWS-02's 30 s). Methods `emails.get(emailId)` and `recipients.get(address)`
(address in the body) return `{ data, error }` and never throw for an API error; a shapeless
response, a network failure or a timeout becomes `error: apiUnavailable`; an unknown `code` passes
through. `@ledger/sdk/testing` exports `FakeLedgerClient` for the CLI tests. *Rejected:* retries now
(slice 5).

**D27 — `LEDGER_TOKEN` required from slice 1.** The CLI config requires `LEDGER_URL` (a URL) and
`LEDGER_TOKEN` (non-empty). Any value works while the loopback server skips the check; `pnpm db:setup`
writes the fixed placeholder `local-loopback-no-auth` when unset, which slice 2's setup can recognize
and replace. *Rejected:* an optional token slice 2 would have to make required; a per-walk `export`.

**D28 — CLI commands.** `ledger email <email_id> [--json]` and `ledger recipient <address> [--json]`,
no `argParser`, no CLI-side validation; `cli.config.ts` and `run-operation.ts` hold the shared
config-load → SDK call → render → exit path. Exit codes and streams follow
[pp-cli → Output and exit codes](../../../.agents/skills/pp-cli/SKILL.md#output-and-exit-codes) and
PP §12 → CLI behavior.

**D33 — Local start.** Root script `"ledger": "node --env-file-if-exists=.env.local apps/cli/src/main.ts"`;
walks run `pnpm -s ledger …` so `--json` stays one document. No `bin` until slice 8 (C7).

**D34 — Human layouts.** PP §12's layouts. Every printed value passes through `printable(value)`,
which maps C0, DEL and C1 to `*`; `null` prints as `—`; empty sections print `  —`; timestamps ISO
8601; columns space-padded.

### Local mode

**D29 — `apps/local` composition.** `local.config.ts`: required `DATABASE_URL`,
`LEDGER_ADDRESS_HASH_KEY`; optional `LEDGER_WEBHOOK_SECRETS` (split on `,`, trimmed, each
`^whsec_[A-Za-z0-9+/=]+$`) and `LEDGER_SIMULATOR_SECRET` (same pattern); a refinement requiring at
least one secret. `main.ts` builds one size-1 pool per composed function that touches the database
(worker, api; ingest has none), a logger per function, the in-process queue, `createIngest`,
`createWorker`, `createApi`, then `queue.start(worker.processBatch)`. A config failure exits `1`
through the logger, naming the variable. Flags stay `--port` and `--host`; the loopback guard stays.

**D30 — Locally, functions connect with `DATABASE_URL` as the owner.** `db:setup` still ensures the
runtime role because the grant migration needs it. The harness runs every integration test as the
runtime role, so a missing grant fails the gate. *Rejected:* a second local credential for no
evidence (lens clause 2).

**D31 — `pnpm db:setup`** → `pnpm --filter @ledger/app-local setup` →
`node --env-file-if-exists=../../.env.local src/setup/main.ts`: (1) read `.env.local` (created if
missing) and, for each of `DATABASE_URL` (compose, `127.0.0.1:55432`), `LEDGER_ADDRESS_HASH_KEY`,
`LEDGER_SIMULATOR_SECRET`, `LEDGER_URL` (`http://127.0.0.1:3200`) and `LEDGER_TOKEN`
(`local-loopback-no-auth`), write it only when unset or empty, through the pure
`mergeLocalEnv(text, generate)`; (2) print `db:setup: wrote <NAME> to .env.local` per name, never a
value; (3) `prepareDatabase` with a random runtime password; (4) `db:setup: ready` / exit 0, or
`db:setup: failed: <constant reason>` / exit 1. `scripts/dev-full.mjs` runs it after Postgres is
healthy and before `pnpm build`.

**D32 — Ingest mount.** `ingestFetch(ingest)` reads the request's `arrayBuffer()` as UTF-8, passes the
three lowercase `svix-*` headers, and returns D11's status, body and content type. `main.ts` serves
`POST /webhooks/resend` through it and everything else through `api.fetch`, mirroring slice 2's HTTP
API routes.

**D35 — `apps/api` stub.** `api.handler.ts` becomes `export {}` with a pointer to slice 2: it can no
longer build `createApi(deps)`, and `infra` synthesizes no function that references it.

### Simulator and live experiments

**D36 — `listen` session protocol** (Ships 11–13, owner-run, every write Ask-first, approved when it
runs): tunnel to port 4318 (RS-33) → **Ask-first** `resend webhooks listen --url <tunnel> --forward-to http://127.0.0.1:3200/webhooks/resend`
→ the owner, in their own terminal, runs read-only `resend webhooks list` / `get <id>` (responses
carry signing secrets, RS-05, so never through an agent transcript) and puts the secret into
`LEDGER_WEBHOOK_SECRETS` in `.env.local`, then restarts `apps/local` → **Ask-first** sends from
`onboarding@resend.dev`: `delivered@` + `bounced@resend.dev` in one email (RS-U21), then
`complained@`, then `suppressed@resend.dev` (RS-U15) → observe `listen` stdout, ingest's status and
`ledger email` (RS-U22) → Ctrl+C; then a second short **Ask-first** session killed by closing its
terminal and an owner-run `resend webhooks list` (RS-U18). A leftover webhook is deleted only on
approval. Results become new `RS-NN` facts in resend.md; no `svix_id`, email id or secret from these
deliveries enters a tracked file.

**D37 — `pnpm sim` live mode.** Live iff `LEDGER_URL` is set and non-empty (shell wins over
`.env.local`; `LEDGER_URL= pnpm sim` is offline). The run: generate as offline and print the header
and projection JSON (recipient order follows the keyed hashes); send every arranged event one at a
time as `POST $LEDGER_URL/webhooks/resend`, body `JSON.stringify(payload)`, signed with `signWebhook`
over `LEDGER_SIMULATOR_SECRET` and the wall-clock timestamp; print `sent requests=<k> accepted=<a>`;
settle by polling `webhookEventsRepository.countPresent` every 250 ms up to 30 s; run
`invariant-1.ts` and `invariant-2.ts` through `packages/db` reads (an email with no projectable event
and no `email_state` row counts as equal); print the result lines and `not checked` lines for 3
and 4; exit `0` iff both pass and `a = k`. Missing prerequisites exit `2`; nothing listening exits
`1` after the first request. Exact lines: the `simulator` spec delta. `sim/src/main.e2e.test.ts`
spawns with `LEDGER_URL` removed, so a developer's shell cannot flip it live. `signWebhook` uses
Node's `crypto`, no signing library.

**D38 — Labels and the walk probe.** `ledgerHistory` gains `labelEveryAddress?: boolean` (default
`false`, so core's properties keep exercising bare addresses); `pnpm sim` always passes `true`. With
it, every address is `<local>+<namespace>-<n>@resend.dev`, and the history gains the probe email
`<namespace>-probe` (spec: "The walk probe email"). A fixed seed's output changes once, with this
change.

**D39 — Observed sequences.** Once RS-U15 is observed, `testAddressSequences` holds per test address
the ordered event types and `bounce.type` / `subType`, nothing captured from the delivery;
`ledgerHistory` with `labelEveryAddress` appends one email per sequence. A core unit test projects
each sequence to the deliverability its observation implies.

### Tests and gates

**D40 — Harness.** `postgres-global-setup.ts` starts `postgres:18.6-alpine` (the compose tag), runs
`prepareDatabase` against a template database, marks it a template, and provides the URLs and
template name. `createTestDatabase()` → `{ db, owner, drop }` clones the template per test file and
connects `db` as `ledger_runtime`. If a project-level `globalSetup` does not run under the `int`
project, the `int` project gets its own config file with that setup, and the about.md bullet records
it.

**D41 — Contract tests** live in `apps/local/src/sdk-contract.int.test.ts`: `createApi(deps)` under
`@hono/node-server` on `127.0.0.1:0` over a harness database, rows seeded through
`RecordEventCommand`, calls through `createLedgerClient`. `apps/local` gains `@ledger/sdk` and
`@ledger/db` as `workspace:*` dev dependencies.

**D42 — OpenAPI export and drift.** `packages/api/scripts/export-openapi.ts` (added to the root
`tsconfig.json` `include`) writes `app.getOpenAPI31Document()` from a `createApi` built with inert
deps to `<out>/openapi.json`, 2-space indent plus final newline, `--out` defaulting to
`packages/sdk`. Root `openapi:export` runs it, then
`pnpm --filter @ledger/sdk exec openapi-typescript openapi.json -o src/openapi-types.ts`.
`scripts/openapi-drift.mjs` regenerates both into a temp directory, runs the one-byte canary first,
then compares bytes with the committed files (LF via `.gitattributes`). Both generated files are
excluded from Biome.

**D43 — Stage order:** `install, docker, secrets, lint, links, typecheck, drift, unit, int, synth, e2e`.
`drift` is `node scripts/openapi-drift.mjs`; `int` is `pnpm test:int`. CI runs `pnpm verify`
unchanged; no `ci.yml` edit.

### Evidence map

Every reliability claim this slice makes, and the test that proves it (PP §20 holds each test's full
case list and what removing the mechanism must break):

| Claim | Evidence (tier) |
| --- | --- |
| Verify before enqueue; rotation; fixed bodies (Ships 1) | `packages/ingest/src/create-ingest.test.ts` (unit); `sign-webhook.test.ts` (unit, round trip) |
| Keyed hash (D1, D2) | `packages/core/src/hash-address.prop.test.ts` (property) |
| Sanitizer (D3) | `packages/core/src/sanitize-for-jsonb.prop.test.ts` (property + unit cases) |
| Migrations, grants, closed sets (Ships 2) | the `int` stage's global setup; `packages/db/src/*.repository.int.test.ts` (int, as `ledger_runtime`) |
| One row per event; all or nothing; sanitized storage (Ships 3) | `packages/worker/src/record-event.command.int.test.ts` (int: sequential and concurrent duplicate, redrive shape, `CHECK (false) NOT VALID` fault, NUL and lone surrogate) |
| Lock order (Ships 4) | same file: two emails sharing a recipient, interleaved by polling `pg_stat_activity`, never by sleeping |
| No raw PII in projections (Ships 5) | `packages/worker/src/projection-pii.int.test.ts` (int) |
| Unprojectable stored raw (Ships 6) | `packages/worker/src/to-ledger-row.test.ts` (unit) + the worker int test |
| Log allow-list (Ships 7) | `packages/shared/src/create-logger.test.ts` (unit) |
| Batch failure list exact (Mandatory worker failure path) | `packages/worker/src/create-worker.int.test.ts` (int) |
| At-least-once local queue (D8) | `packages/shared/src/in-process-queue.adapter.test.ts` (unit, `FakeClock`) |
| Read API masks (Mandatory redaction) | `packages/api/src/get-email.route.int.test.ts`, `get-recipient.route.int.test.ts` (int) |
| Error mapping (Ships 8) | `packages/api/src/create-api.test.ts` (unit); `packages/sdk/src/create-ledger-client.test.ts` (unit, `node:http`); `apps/local/src/sdk-contract.int.test.ts` (int) |
| CLI exit codes and `--json` (Ships 8) | `apps/cli/src/commands/email-get.cli.test.ts`, `recipient-get.cli.test.ts` (unit, fake SDK) |
| Loopback only; boot assertion (Mandatory local auth skip) | `apps/local/src/main.e2e.test.ts` (e2e) |
| Setup never overwrites (D31) | `apps/local/src/setup/merge-local-env.test.ts` (unit) |
| Contract drift (Ships 9) | the `drift` stage and its canary |
| Invariants 1 and 2 (Ships 10) | `sim/src/invariants/invariant-1.test.ts`, `invariant-2.test.ts` (unit, pass and fail); the live run in the walkthrough |
| Observed sequences (Ships 12) | `packages/core/src/testing/test-address-sequences.test.ts` (unit) |

`int` timeouts are set from the first measured run, never guessed.

## Risks / Trade-offs

- **`resend.dev` test sends refused (RS-34, RS-U14)** → Ships 11–12 cannot settle; run the
  two-recipient send first, record the `403`, mark the card `[!]` with a one-line reason, and the
  owner rules on the project domain.
- **`openapi-typescript` 7.13.0 fails under TypeScript 7.0.2** → it is the first command of the read-API
  group; the pre-approved `typescript` 5.9.3, scoped to `packages/sdk` devDependencies, is the
  fallback; never in the root `tsc` pass.
- **drizzle-kit (via `tsx`) cannot load a schema importing `@ledger/core` source** → the first
  `generate` finds out; fallback: the `check()` literals list the members, and the closed-set
  integration test pins them against the core tuple.
- **RS-U22 negative (forwarded deliveries do not verify locally)** → record it in resend.md; RS-U15
  and RS-U21 still settle from `listen` stdout; the owner decides whether the card's Goal line
  changes.
- **A project-level Vitest `globalSetup` does not run** → the first `pnpm test:int`; D40's fallback.
- **`@hono/zod-openapi` answers `415` outside the error shape** → the contract test catches it; D22's
  mapping.
- **Timing flakes in concurrency tests** → interleave by polling `pg_stat_activity`, never sleeps.
- **Sim runs colliding on compose Postgres** → D38's labels; the walk's rerun is deliberate.
- **Trade-off — events acknowledged but still in the in-process queue are lost if `apps/local`
  dies.** Accepted locally: local traffic is simulator and test-address traffic only. SQS (slice 2)
  and `local_queue_messages` (slice 2B) remove it.
- **Trade-off — `docs` runbook links 404 until slice 3.** A named later slice carries it.

## Migration Plan

- Two new migrations, pure expand, no backfill. Nothing is deployed and no kept database exists, so
  they stay regenerable until merged to `main`; after that, any change is a new forward migration
  (ADR-018).
- Local rollout: `pnpm db:setup` (or `pnpm dev:full`) migrates compose Postgres. Rollback before merge
  is removing the compose Postgres volume by hand (no script drops it) and regenerating.
- `apps/api` loses its routeless handler until slice 2; `infra` references no function, so `synth`
  is unaffected.

## Open Questions

Each is safe to settle during apply without changing the specs, the approach or the task breakdown;
each has a decided fallback, and its about.md bullet records the finding:

- `@hono/zod-openapi`'s answer to a missing `Content-Type` (D22).
- drizzle-kit's output layout and file names; whether pending migrations run in one transaction; how
  `check()` regenerates (safe either way: the closed-set tests pin the members).
- The `Executor` / `Transaction` types derived from the installed `drizzle-orm` `.d.ts`.
- Whether a Vitest project's `globalSetup` runs (D40).
- `openapi-typescript` under TypeScript 7; drizzle-kit loading `@ledger/core` source (the two new
  bullets PP §22 adds, resolved at install).
- RS-U14, RS-U15, RS-U18, RS-U21, RS-U22: settled by the owner's experiments (D36). The code paths
  are safe either way; the outcomes change resend.md, the fixtures (D39) and possibly the card's
  status, not the design.
