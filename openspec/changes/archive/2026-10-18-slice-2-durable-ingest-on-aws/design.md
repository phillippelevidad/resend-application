# Design — slice 2: Durable ingest on AWS

## Context

See [proposal.md → Why](proposal.md#why). The pre-proposal
[2026-10-17-slice-2-durable-ingest-on-aws.md](../../../../.ai/pre-proposals/2026-10-17-slice-2-durable-ingest-on-aws.md)
(*PP*) is decision-complete and checked (15 repairs, nothing left for the owner). Each decision
below keeps its PP number (D1–D44) and carries what `opsx:apply` needs to build it. The PP keeps the
authority trail for every decision and the contradictions C1–C19. Everything the build needs is in
this file: [Data model](#data-model) (PP §8), [Surfaces](#surfaces) (PP §12) and
[Walkthrough plan](#walkthrough-plan) (PP §21).

State on `HEAD` (PP §5, re-checked 2026-10-17; only the PP, its repair and this change have landed
since `e62bf50`):

- `infra/src/app.stack.ts` and `guardrails.stack.ts` are empty; `app.stack.test.ts` asserts zero
  resources. `apps/ingest`, `apps/worker` and `apps/api` hold one `export {}` handler stub each.
  `packages/aws/src/index.ts` is `export {}` with no `@aws-sdk/*` dependency. `esbuild` exists only as
  transitive copies (0.18.20, 0.25.12, 0.28.2).
- `packages/ingest/src/create-ingest.ts:81-137` already answers `200` after enqueue, `401` on no match
  and `503` on a rejected enqueue; its secrets are static typed config (`:18-21`). No secret port, no
  cache, no base64 decode.
- `packages/worker/src/create-worker.ts:31-44` builds `batchItemFailures` from per-message results
  (proven on Postgres by `create-worker.int.test.ts`). No `resume`, retry or pause.
- `packages/db`: four schema files, migrations `0000` and `0001` (frozen, merged to `main`);
  `classify-database-error.ts:6-71` with its unit test; `prepareDatabase`
  (`prepare-database.ts:23-38`) creates the role only, no `ALTER ROLE … SET`.
- `packages/api/src/create-api.ts:92-95`: no auth middleware; two routes. The SDK has `emails` and
  `recipients`; the CLI registers two commands (`create-program.ts:25-26`). The four token error codes
  already exist in `packages/core/src/error-codes.ts:5-24`.
- `apps/local` serves auth-free on loopback; the in-process queue keeps no enqueue time
  (`in-process-queue.adapter.ts:14-22`).
- `scripts/verify.mjs:17-35` runs `install, docker, secrets, lint, links, typecheck, drift, unit, int,
  synth, e2e`; its comment (`:13-14`) names the planned "migration lint (slice 2)". Root
  `package.json` has `synth` and no deploy script.

Binding constraints: ADR-001, ADR-002, ADR-004, ADR-005, ADR-008, ADR-009, ADR-010, ADR-011,
ADR-013, ADR-015, ADR-016, ADR-018, ADR-019 ([Decisions](../../../../.ai/architecture.md#decisions)); the
module boundaries in root [AGENTS.md](../../../../AGENTS.md#module-boundaries) (only `packages/aws`
imports `@aws-sdk/*`; apps are wiring only); [aws.md → Budget alarms](../../../../.ai/aws.md#budget-alarms);
and the `pp-general`, `pp-backend`, `pp-database`, `pp-testing`, `pp-cli`, `pp-infra` and `pp-workflow`
skills. No ADR is departed from, so none is superseded.

## Goals / Non-Goals

**Goals:**

- One port per AWS seam (D1), each with a local implementation, so `apps/local` and the Lambda roots
  compose the same factories and a shared contract suite pins both sides.
- Every fail-closed path decided before a deploy can lose an event: `503` on any ingest
  infrastructure fault (D13), pause instead of dead-letter (D15), deploy refusals before any stack
  change or secret write, all but the `key_id` check also before migrating (D33), teardown refusal
  on queued events (D34).
- The cost brake and the budget wiring proven on the template in `pnpm check`, before any deploy
  (D27, D28, D32).
- The six owed `[Unverified]` rows settled by scripted, repeatable runs (D36, D37, D42).

**Non-Goals:**

- Partial `health.get` answers, a disarm flag, key rotation, paging flags on `ledger token list`
  (over-engineering at the ceiling, PP §19).
- A third stack or a custom resource for migrations (ADR-018); a CloudWatch dashboard; any alarm
  beyond the usage trip and the kill switch's `Errors` (slice 3).
- `@types/aws-lambda` and `aws-sdk-client-mock`: each handler declares the narrow event shape it
  reads, and each adapter test stubs `send(command)` in a few lines.
- Asynchronous Lambda invoke for the dispatcher and reconciler (slices 4, 6).

## Decisions

### Module layout

New or changed files, by project. Names follow pp-general's role suffixes; one route, reader,
command or mapper per file.

| Project | Files |
| --- | --- |
| `packages/core` | `token-scopes.ts` (`tokenScopes`, `tokenScopeSchema`), `event-source-states.ts` (`eventSourceStates`, `eventSourceStateSchema`) |
| `packages/shared` | `secret-reader.port.ts`, `event-source-control.port.ts`, `queue-attributes.port.ts`, `function-invoke.port.ts`; `static-secret-reader.adapter.ts`, `static-event-source-control.adapter.ts`, `in-process-function-invoke.adapter.ts`; `in-process-queue.adapter.ts` (also implements `QueueAttributesPort`); `function-env.ts`; `api-token.ts`; `emf-metrics.adapter.ts`; `create-logger.ts` (`context`); `testing.ts` (four fakes, five contract suites) |
| `packages/db` | `schema/api-tokens.ts`; `drizzle/0002_create-api-tokens.sql`, `0003_grant-api-tokens.sql`; `api-tokens.repository.ts`; `database.repository.ts` (`storageBytes`, `STORAGE_LIMIT_BYTES`, `STORAGE_PROBE_THRESHOLD`); `deploy-checks.ts` (`storedAddressHashKeyId`, `pendingContractSteps`); `run-transaction.ts` (`runTransaction`, D15); `prepare-database.ts`, `create-database.ts`, `classify-database-error.ts` (changed); `testing.ts` (timeouts, outage container helper) |
| `packages/ingest` | `create-ingest.ts` (secret port, `SECRET_SET_TTL_MS`, `503`), `signing-secrets.schema.ts` (the Zod parse of the secret value) |
| `packages/worker` | `create-worker.ts` (ADR-015 branch, `resume`); `record-event.command.ts` (`runTransaction` in place of `db.transaction`, D15) |
| `packages/api` | `auth.middleware.ts` (`authMiddleware`, `requireScope`); `get-health.route.ts`, `get-health.reader.ts`, `health-response.mapper.ts`, `health-response.schema.ts`; `resume-event-source.route.ts`, `resume-event-source.command.ts`, `event-source-response.schema.ts`; `get-current-token.route.ts`, `list-tokens.route.ts`, `create-token.route.ts`, `revoke-token.route.ts` with their reader or command, `token-response.mapper.ts`, `token-response.schema.ts`; `create-api.ts` (deps, middleware, `onError` per route); `testing.ts` (`readApiContract`) |
| `packages/sdk` | `create-ledger-client.ts` (six methods, five types), `testing.ts` (`FakeLedgerClient` grows them); regenerated `openapi.json`, `src/openapi-types.ts` |
| `packages/aws` | The eleven modules of D26 |
| `apps/ingest`, `apps/worker`, `apps/api` | `main.ts` (composition root), `<fn>.handler.ts` (CDK entry: binds `handler` to what `main.ts` built), `create-<fn>-handler.ts` (ingest and worker: the event adapter, tested without loading `main.ts`), `<fn>.config.ts` (internal variables, Zod) |
| `apps/kill-switch` (new, `@ledger/app-kill-switch`) | `main.ts`, `kill-switch.handler.ts`, `create-kill-switch-handler.ts`, `kill-switch.config.ts` |
| `apps/local` | `local.config.ts`, `main.ts`, `setup/main.ts`, `setup/merge-local-env.ts` (changed) |
| `apps/cli` | `commands/health-get.cli.ts`, `worker-resume-event-source.cli.ts`, `token-create.cli.ts`, `token-list.cli.ts`, `token-revoke.cli.ts`, `token-get-current.cli.ts`; `create-program.ts` (the `worker` and `token` groups) |
| `infra` | `src/ledger-function.construct.ts`, `src/function-env.ts`, `src/app.stack.ts`, `src/guardrails.stack.ts`, `src/main.ts`; `scripts/deploy.ts` + `run-deploy.ts`, `teardown.ts` + `run-teardown.ts`, `rearm.ts`, `trip-drill.ts`, `db-check.ts` |
| `scripts/` | `migration-lint.mjs` (new), `verify.mjs`, `secret-scan.mjs` (changed) |

### Kernel and core

#### D1 — Ports landing in slice 2

Each in `packages/shared/src/<name>.port.ts`:

| Port | Methods | Implementations |
| --- | --- | --- |
| `SecretReaderPort` | `read(secretId: string): Promise<string>` | `SecretsManagerSecretReaderAdapter` (`packages/aws`); `StaticSecretReaderAdapter` (`packages/shared`): answers one value for the one id it was built with and rejects any other |
| `EventSourceControlPort` | `getState(): Promise<EventSourceState>`, `enable(): Promise<void>`, `disable(): Promise<void>` | `LambdaEventSourceControlAdapter` (`packages/aws`), bound to one function name; `StaticEventSourceControlAdapter` (`packages/shared`): reports `enabled`, enable and disable are no-ops |
| `QueueAttributesPort` | `read(): Promise<QueueSnapshot>`, `QueueSnapshot = { visible, inFlight, oldestAgeSeconds: number \| null, dlqVisible, dlqInFlight }` | `SqsQueueAttributesAdapter` (`packages/aws`); `InProcessQueueAdapter` (D40) |
| `FunctionInvokePort` | `invoke(payload: unknown): Promise<unknown>`, synchronous (awaits the result) | `LambdaFunctionInvokeAdapter` (`packages/aws`, `RequestResponse`), bound to one function name; `InProcessFunctionInvokeAdapter` (`packages/shared`) over a local function |

Stateful fakes in `@ledger/shared/testing`: `FakeSecretReader`, `FakeEventSourceControl`,
`FakeQueueAttributes`, `FakeFunctionInvoke`. Each holds the state the port reads and writes; a test
asserts the resulting state, not the call.

**Shared port contract suites**, one per port with two implementations, in `@ledger/shared/testing`:
`queuePortContract`, `secretReaderPortContract`, `eventSourceControlPortContract`,
`queueAttributesPortContract`, `functionInvokePortContract`. Each is run once per implementation:
the local one directly, the `packages/aws` one over its stubbed client (D26). A suite holds only the
behavior both share (for `QueuePort`: `enqueue` resolves on acceptance and rejects on a failed send,
which R4 rests on; for `EventSourceControlPort`: `getState` answers a member of `eventSourceStates`,
`enable` and `disable` resolve). A behavior only one side has stays in that side's own test.

#### D2 — Internal variable names

`packages/shared/src/function-env.ts`, one `as const` object per function; `infra/src/function-env.ts`
sets each value on its reader only. Each app's `<fn>.config.ts` parses its object's keys with Zod at
boot.

| Object | Keys | Values |
| --- | --- | --- |
| `ingestEnv` | `SIGNING_SECRETS_ARN`, `QUEUE_URL` | ARN of `ledger/webhook-signing-secrets`; source queue URL |
| `workerEnv` | `DATABASE_SECRET_ARN` | ARN of `ledger/database`. The worker finds its own mapping by its own name from the reserved `AWS_LAMBDA_FUNCTION_NAME` (AWS-56) |
| `apiEnv` | `DATABASE_SECRET_ARN`, `QUEUE_URL`, `DLQ_URL`, `WORKER_FUNCTION_NAME` | ARN; both queue URLs; the worker's physical name |
| `killSwitchEnv` | `APP_STACK_NAME`, `ALERT_TOPIC_ARN` | `LedgerApp`; the alert topic's ARN |

No key is Lambda-reserved; every value is an ARN, URL or name; all four together stay far inside
AWS-56's 4 KB.

#### D3 — Token mint, tag check and hash

`packages/shared/src/api-token.ts`, `node:crypto` only:

- Format `ldg_<random>_<tag>`: `random` is 32 random bytes as 64 lowercase hex; `tag` is
  `HMAC-SHA-256(tagKey, random)` as 64 lowercase hex. Hex because base64url's alphabet holds `_`.
- `mintApiToken(tagKey: Uint8Array): { token: string; tokenHash: string }`.
- `hasValidTag(token: string, tagKey: Uint8Array): boolean`: shape `^ldg_[0-9a-f]{64}_[0-9a-f]{64}$`,
  then `timingSafeEqual` of the recomputed tag. No I/O.
- `hashApiToken(token: string): string`: SHA-256 of the whole string, 64 hex. Unkeyed is enough:
  `random` carries 256 bits.
- `tagKey` is 32 bytes given as 64 lowercase hex: `LEDGER_TOKEN_TAG_KEY` locally, `tokenTagKey` in the
  `ledger/database` secret on AWS.

Callers: `packages/api` (`token.create`), the deploy command, `pnpm db:setup`. Rules out: a plaintext
token at rest; a database read before the tag check.

#### D4 — Core closed sets

`tokenScopes = ['read', 'operate'] as const` (`tokenScopeSchema`, feeding `api_tokens`' `CHECK`).
`eventSourceStates = ['enabled', 'paused', 'changing'] as const` (`eventSourceStateSchema`), mapped
from Lambda's `State`: `Enabled` → `enabled`, `Disabled` → `paused`, any other (`Creating`,
`Enabling`, `Disabling`, `Updating`) → `changing` (AWS-18).

#### D5 — EMF metrics writer

`EmfMetricsAdapter` implements `MetricsPort` by writing one EMF JSON line per call through an
injected sink (`process.stdout.write` on Lambda): namespace `Ledger`, one empty dimension set, unit
`Count` or `Milliseconds`, plus the caller's allow-listed log fields. No library. Lambda roots use
it; `apps/local` keeps `LogMetricsAdapter`. The hourly resume emits no metric, so an idle hour costs
no custom-metric charge (AWS-12).

#### D6 — Per-invocation log fields

`createLogger` gains an optional `context: () => LogFields`, merged into every line through the same
allow-list. Each Lambda handler updates a per-container holder `{ request_id: context.awsRequestId,
cold_start }` at the start of each invocation (one invocation per container at a time, so lines
never interleave). `apps/local` passes none.

### Database

#### D7 — `api_tokens`

One schema file, one generated migration, one grant migration (`SELECT, INSERT, UPDATE`, the
set-once row of pp-database's grants). Columns in [Data model](#data-model).

#### D8 — `apiTokensRepository`

`packages/db/src/api-tokens.repository.ts`, executor-first:

- `insert(db, row)` → the row (`RETURNING`). Used by `token.create` and `--issue-operate-token`.
- `insertBootstrapIfAbsent(db, row)`: `INSERT … ON CONFLICT DO NOTHING` on the partial unique
  `(bootstrap) WHERE bootstrap`; the row or `undefined`. Deploy command and `db:setup`.
- `findActiveByHash(db, tokenHash)` → `{ id, name, scope }` of an unrevoked row. The middleware.
- `findById(db, id)`; `listPage(db, { limit, afterId })` (newest first, `id < afterId`, served by the
  PK).
- `lockActiveOperate(tx)` → active `operate` rows `ORDER BY id FOR UPDATE`; `lockById(tx, id)`;
  `markRevoked(tx, id)` (`revoked_at = now(), updated_at = now() WHERE id = $1 AND revoked_at IS
  NULL`). The lock functions take a `Transaction`.

#### D9 — Pool timeouts and the classifier

`createDatabase({ url, max, logger })` sets `connectionTimeoutMillis: 5_000` and
`query_timeout: 15_000` (named constants beside the factory, both below every function timeout). The
classifier gains:

- `pg`'s code-less `Query read timeout`
  (`node_modules/.pnpm/pg@8.23.1/node_modules/pg/lib/client.js:707`) as connection-class: the
  role's `lock_timeout` (10 s, D10) ends every lock wait server-side first, so a 15 s silence means
  the server is unreachable for the worker's purposes. A misread pauses at most one hour. `pg` keeps
  that connection open after the timeout (`client.js:706-726`; it destroys the stream only in
  pipeline mode), which is why D15's retry must not reuse it.
- `53100` (`disk_full`) as ADR-015's out-of-storage class. Safe either way until PG-U07 (slice 3): an
  unmatched code follows ADR-008, as today.

And it narrows (code review issue 8; the owner: "Narrow the classifier"): a Node socket code counts
only with a pg origin, inside a `DrizzleQueryError` or emitted by the connection of a
`DatabaseClient`, the pg `Client` subclass `createDatabase`'s pools and `prepareDatabase` connect
with. A bare socket code is any client's, and the AWS SDK rejects with Node's raw error
(`@smithy/node-http-handler` 4.12.1), so an AWS port failure, raw or as a `cause`, never answers
`503 database_unavailable` or pauses the worker. `onError` therefore classifies first, with no
`internal_error` case ahead of it; D19's and D20's wrapping stays, so the `500` logs the AWS error's
name. Evidence: [pp-database → Connection-error classification](../../../../.agents/skills/pp-database/references/schema-and-repositories.md#connection-error-classification).

#### D10 — `prepareDatabase` grows three things

One path for the deploy command, `pnpm db:setup` and the harness:

- `roleTimeouts: { idleInTransactionMs, lockTimeoutMs }`: after ensuring the role, it runs
  `ALTER ROLE ledger_runtime SET idle_in_transaction_session_timeout = …` and `… SET lock_timeout = …`
  on every call. Deploy and setup `5_000` / `10_000` (both below the worker's 60 s; idle below lock,
  so an idle holder ends before a waiter's lock wait expires). Harness `2_000` / `5_000` (above the
  longest wait any concurrency test polls for).
- `resetPassword: boolean`: when `true`, an existing role's password is set to `runtimePassword`
  (`ALTER ROLE … PASSWORD`, quoted with `pg`'s `escapeLiteral`). The deploy passes `true` only when no
  usable password is stored (D33 step 6).
- The role name stays the constant `RUNTIME_ROLE`.

#### D11 — Storage read and its limit

`databaseRepository.storageBytes(db)` → `SELECT pg_database_size(current_database())`.
`STORAGE_LIMIT_BYTES = 1_000_000_000` (Neon Free's 1 GB read as decimal, so the probe refuses early).
The probe fails at `≥ STORAGE_PROBE_THRESHOLD = 0.95` of it, because `pg_database_size` and Neon's
accounting can differ; PG-U07's slice 3 measurement revisits both. `health.get` reports the bytes and
the limit.

#### D12 — Deploy refusal helpers in `packages/db`

- `storedAddressHashKeyId(db)`: the 8-character prefix of one stored `recipient_state.address_hash`
  (`LIMIT 1`), or `undefined` on an empty database; the deploy compares it with
  `addressHashKeyId(key)`.
- `pendingContractSteps(db)`: the pending migrations' (absent from `drizzle.__drizzle_migrations`)
  first lines, parsed for `-- contract-step: <40-hex SHA>`; `replace:` markers carry no SHA and are
  skipped.

Both run only in the deploy command, over the direct owner URL (D33 steps 4 and 7), and the
runtime role cannot read the `drizzle` schema. So `deploy-checks.int.test.ts` calls them through
the harness's owner connection, read-only. That is the role production uses for these reads.
Granting `ledger_runtime` read on the migration journal so the test could use `t.db` would widen
the DML-only role for a test's sake (integrations.md → Runtime role). Every other test in this
slice uses the runtime role.

### Ingest

#### D13 — The secret set on AWS

`createIngest` takes `secretReader: SecretReaderPort` and `signingSecretsId: string` in place of the
static `secrets.resend`; `simulatorSecret: string | undefined` stays typed config until slice 3
(ADR-016). Ingest reads `signingSecretsId` through the port and parses the value with Zod as a JSON
array of `whsec_…` strings, caching the last successful result per container for
`SECRET_SET_TTL_MS = 300_000` against the clock port (ADR-009). After the TTL it refreshes. A failed
read, a value that fails the parse, or a set with no secret at all (no Resend secret and no simulator
secret) answers `503` with the fixed body `unavailable`, logs `ingest.secrets_unavailable` with
`error_name`, enqueues nothing and emits no metric. A failed refresh never serves an expired set.

On AWS `apps/ingest`'s root passes `SecretsManagerSecretReaderAdapter` and `SIGNING_SECRETS_ARN`,
simulator `undefined`. Locally `apps/local` passes a `StaticSecretReaderAdapter` answering
`JSON.stringify` of its parsed `LEDGER_WEBHOOK_SECRETS` for the one id it was built with.

Why `503`, not `401`: a `401` would tell Resend the secret is wrong; an infrastructure fault must be
retried (RS-10), and it is what makes RS-U07 safe either way (D43).

#### D14 — `apps/ingest`

`create-ingest-handler.ts` exports `createIngestHandler(deps)`; `ingest.handler.ts` exports only
`handler`, that adapter bound to what `main.ts` built (one primary export per file, and the
adapter's test never loads `main.ts`). Per API Gateway payload 2.0
event (AWS-01):

1. Body: `isBase64Encoded` true → `Buffer.from(body, 'base64').toString('utf8')`; otherwise `body`, or
   `''` when absent. Headers are already lowercase in 2.0; the three `svix-*` are passed.
2. One info line, `ingest.request_decoded`, carrying `body_base64_count` (`1` or `0`). The `*_count`
   form is already on the log allow-list. It is how AWS-U04 is read from the verify delivery (D44).
3. `{ statusCode, headers: { 'content-type': INGEST_CONTENT_TYPE }, body, isBase64Encoded: false }`.
4. Anything thrown is caught at the edge, logged by `error_name`, and rethrown as a constant
   `LedgerError('internal_error', …)` with no `cause`.

### Worker

#### D15 — The ADR-015 branch in `processBatch`

`createWorker` takes `eventSource: EventSourceControlPort` and `storageLimitBytes`. For each message,
in order:

1. Run `RecordEventCommand`. Success → next message.
2. It throws and `classifyDatabaseError(err)` matches → run the same message once more, on a
   connection other than the one that failed. Success → next message.

   **The fresh connection is built, not assumed.** Drizzle 0.45.4's `transaction()` runs `rollback`
   on the failed client and then releases it with no error
   (`node_modules/.pnpm/drizzle-orm@0.45.4_@types+pg@8.23.1_pg@8.23.1/node_modules/drizzle-orm/node-postgres/session.cjs:224-228`),
   and pg-pool discards a released client only when given an error or when it is no longer
   queryable (`node_modules/.pnpm/pg-pool@3.14.0_pg@8.23.1/node_modules/pg-pool/index.js:392`).
   After a `Query read timeout` the client is still queryable (D9), so the stock path hands the
   hung connection back to the size-1 pool: the rollback waits another 15 s, the retry reuses it,
   and the whole path reaches about 60 s, the worker's timeout. The Lambda then dies before step 3,
   the batch is redelivered without a pause, and five such receives move the outage into the DLQ,
   which is what ADR-015 exists to prevent. So `packages/db` exports
   `runTransaction(database, fn)`, which `RecordEventCommand` uses in place of `db.transaction`: it
   checks a client out of the pool itself, runs `BEGIN`, `fn(tx)` over a Drizzle instance bound to
   that client, then `COMMIT`. On an error that `classifyDatabaseError` matches, it releases the
   client **with** the error (`client.release(err)`, so pg-pool removes it) and issues no
   `ROLLBACK` (the server rolls back when the connection closes). On any other error it rolls back
   and releases normally. The retry therefore costs at most one connect (5 s) and one query timeout
   (15 s), and the cold outage path, the first attempt's own connect included, is at most 5 + 15 +
   5 + 15 = 40 s. Rules out: relying on the pool to notice a hung socket, and ending the whole pool,
   which waits on that socket.

   **The batch deadline.** The 40 s bounds an unreachable server only: a database that is slow but
   still answering (each statement under the 15 s query timeout) is never classified, and one
   message's transaction runs several statements, so it can outlast the 60 s timeout and drain to
   the DLQ like the stock path above. So `processBatch(messages, deadline?)` takes the Lambda
   context's `getRemainingTimeInMillis` (`apps/worker` passes it; local mode passes none, because
   its in-process consumer has no timeout that kills it mid-batch). When the batch starts, the
   worker reads it against the clock port and sets the deadline that far ahead, less
   `BATCH_DEADLINE_RESERVE_MS = CONNECTION_TIMEOUT_MS + 5_000` (10 s): a `pool.connect()` already
   under way when the deadline passes cannot be cut short (≤ 5 s), and the pause gets 5 s for
   `UpdateEventSourceMapping` plus a container's first `ListEventSourceMappings` (D16). A passed
   deadline is an outage (step 3), checked before each attempt, the retry included. It also bounds
   the one transaction in flight: `runTransaction(database, fn, { signal })` destroys its
   checked-out client's socket when the signal aborts, so pg rejects the pending statement on the
   next tick, the client is discarded as on a classified failure, and the server rolls back when it
   sees the closed connection. The caller sees `database_unavailable`. A message whose `COMMIT` was
   cut may have committed and comes back as a duplicate, absorbed on `svix_id`. A slow database
   therefore pauses the worker, and the hourly resume probe (D16) re-enables it. Rules out: a check
   between messages alone, which never stops a transaction already running; and a server-side
   `statement_timeout` or `transaction_timeout`, which the server enforces only while it is
   answering, so the client-side bound would be needed anyway.
3. The retry matches too, or the deadline passed → list **every** message of the batch in
   `batchItemFailures` (a message already committed in this batch is redelivered as a duplicate,
   absorbed on `svix_id`), log `worker.database_unavailable`, call `eventSource.disable()`. A failing `disable` logs
   `worker.pause_failed` with `error_name`; the response is unchanged. Stop processing.
4. Any other error: that message alone is listed (ADR-008).

#### D16 — `worker.resume()` and how the worker finds its mapping

`resume(): Promise<ResumeResult>`, `ResumeResult = { outcome: 'resumed' | 'already_enabled' |
'probe_failed'; state: EventSourceState }`:

1. `eventSource.getState()`. `enabled` → `already_enabled`, no database connection.
2. Otherwise probe with `storageBytes` (D11), which connects and reads storage. A connection-class
   error, or storage at the threshold → `probe_failed`, state unchanged.
3. Success → `eventSource.enable()`, then `getState()` → `resumed`. A `changing` mapping (the
   worker just paused itself) is waited out by `enable()`, below.

`LambdaEventSourceControlAdapter` is constructed with a function name; it calls
`ListEventSourceMappings({ FunctionName })` once per container, requires exactly one mapping (else a
constant error), caches its UUID, and reads and updates it with `GetEventSourceMapping` and
`UpdateEventSourceMapping({ Enabled })`. The worker passes its own name; the read API, kill switch,
re-arm and deploy command pass `LedgerApp-worker`. A function cannot carry its own mapping's UUID as
a variable: that reference would be a CloudFormation cycle (C5).

A mapping mid-transition refuses the update with `ResourceInUseException` (or
`ResourceConflictException`, "another operation is in progress"; lambda/API_UpdateEventSourceMapping,
Errors). `enable()` and `disable()` wait it out: on either error they poll once a second
(`EVENT_SOURCE_SETTLE_POLL_MS`), return once the mapping settled at the target, update once it
settled elsewhere, and rethrow the SDK error unchanged when the budget runs out. The budget is
`EVENT_SOURCE_SETTLE_TIMEOUT_MS`, 10 s, unless the caller passes its own: it fits the worker's
outage pause after D27's 40 s inside the 60 s timeout, and a resume behind the read API's 25 s
synchronous invoke (D20). Evidence: `lambda-event-source-control.adapter.test.ts` → "on a mapping in
transition".

#### D17 — `apps/worker`

`create-worker-handler.ts` exports `createWorkerHandler(deps)`; `worker.handler.ts` exports only
`handler`, bound to what `main.ts` built (the layout of D14). The adapter branches on the event:

- **SQS batch** (`Records` whose entries carry `eventSource: 'aws:sqs'`): each record →
  `{ messageId, body }`, `processBatch`, return `{ batchItemFailures }` exactly as built.
- **Resume event** `{ "ledger": "resume-event-source" }` (Zod-parsed): `resume()`, return the
  `ResumeResult`. The schedule sends it asynchronously; the read API sends it synchronously.
- **Anything else:** throw a constant `LedgerError('internal_error', …)`.

A thrown error from `processBatch` is rethrown as a constant (AWS-05: a thrown exception fails the
whole batch, redelivered, never acknowledged). The root reads `ledger/database` once per container on
the first invocation through a memoized promise (D32) and builds the size-1 pool from it.

### Read API

#### D18 — Auth middleware

`packages/api/src/auth.middleware.ts`, after the request id and before every route, the not-found
handler included:

1. `Authorization` missing, not `Bearer <token>`, or `hasValidTag` false → `401 unauthorized`. No
   database connection opens.
2. `findActiveByHash(hashApiToken(token))`. No row → `401 unauthorized`. A classified database error
   → `503 database_unavailable`, **except** on `GET /health` (matched by the health route's exported
   method and path constants), which continues with the caller marked `verified: false`.
3. The caller `{ tokenId, name, scope, verified }` is set on the context.
4. Each `createRoute` carries `middleware: requireScope('read' | 'operate')`, its api-contract
   entry's **Scope**; `operate` satisfies `read`. Short → `403 forbidden`.

Every failure uses the registry's default `message` and `hint`, so a `401` never reveals which check
failed. `apps/local` uses the same middleware.

#### D19 — `health.get`

`get-health.route.ts`, `GetHealthReader`: reads `QueueAttributesPort`, `EventSourceControlPort` and,
under a try, `storageBytes`. A classified database error → `database.reachable: false`,
`storage_bytes: null`, never a failed response. A `verified: false` caller (step 2 already classified
the database unreachable) skips `storageBytes` and reports `reachable: false` at once, so a request
makes at most one database attempt: two stacked attempts (15 s query, then a 5 s reconnect and
another 15 s) would pass the read API's 25 s timeout and API Gateway's 30 s (AWS-02). An AWS read
error → `500 internal_error`, logged (v0; partial answers are a tripwire, PP §3).

The age read is CloudWatch `GetMetricStatistics` of `AWS/SQS` `ApproximateAgeOfOldestMessage`,
`Maximum`, dimension `QueueName` (the source queue URL's last segment), period 60 s over the last 5
minutes; no datapoint → `null` (an idle queue stops reporting after 6 h, AWS-22). `GetQueueAttributes`
returns no age (C4).

#### D20 — `worker.resumeEventSource`

`resume-event-source.route.ts`, `ResumeEventSourceCommand`, `POST /worker/resume`, `operate`: invokes
the worker through `FunctionInvokePort` with `{ "ledger": "resume-event-source" }`, parses the
`ResumeResult` with Zod, answers `200` `{ object: 'event_source', state, resumed }` (`resumed` is
`outcome === 'resumed'`). `probe_failed` → `503 database_unavailable` with the override message
([Surfaces](#surfaces)). An invoke failure or an unparseable result → `500 internal_error`. On an
enabled source it opens no database connection (the worker's step 1).

#### D21 — Token routes

Each one route file, one command or reader, one mapper:

- `token.getCurrent` → `GET /tokens/current` (`read`): the caller's row by `tokenId`.
- `token.list` → `GET /tokens` (`operate`): `limit` 1–100, default 20; `after` a token id; newest
  first by `token_id`; the list envelope with `has_more`.
- `token.create` → `POST /tokens` (`operate`): body `{ name, scope }`, `request.body.required: true`;
  `name` matches `^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$`; `scope` ∈ `tokenScopes`. Mints (D3), inserts
  with `bootstrap = false`, answers `201` with the row plus `token`, once.
- `token.revoke` → `POST /tokens/{token_id}/revoke` (`operate`): `token_id` (and `token.list`'s
  `after`) matches `^[1-9][0-9]{0,14}$`. `token_id` is a JSON number on the wire, so 15 digits keeps
  every value inside `Number.MAX_SAFE_INTEGER`; the column is read with
  `bigint({ mode: 'number' })`. One transaction: `lockActiveOperate`, then `lockById`. No row → `404
  token_not_found`. Already revoked → `200`, unchanged. Target active `operate` and the only active
  `operate` row → `409 last_operate_token`. Otherwise `markRevoked`, `200`. A token MAY revoke itself
  unless it is the last `operate` one. The lock order (all active `operate` rows first) is what makes
  two concurrent revokes serialize.

#### D22 — `createApi` deps and error mapping

`ApiDeps` becomes `{ db, logger, addressHashKey, tokenTagKey, requestId: (c: Context) => string,
queueAttributes, eventSource, workerInvoke, storageLimitBytes }`. `requestId` matches Hono 4.13.13's
`generator?: (c: Context) => string`: `apps/api` returns `c.env.lambdaContext.awsRequestId`
(`@hono/aws-lambda` 1.0.1 passes `{ event, requestContext, lambdaContext }` as the env), `apps/local`
`crypto.randomUUID()`. The `415` / malformed-JSON mapping in `onError` names the body per route
([Surfaces](#error-codes-raised)), keyed by the matched route's path.

#### D23 — `apps/api` and the shared contract suite

`api.handler.ts` serves `handle(app)` from `@hono/aws-lambda`; the app is built on the first
invocation from the memoized database secret (D32). The SDK ↔ API contract cases move into
`@ledger/api/testing` as `readApiContract(name, make)`, run by `apps/local/src/sdk-contract.int.test.ts`
under `@hono/node-server` and by `apps/api/src/api-lambda-contract.int.test.ts` through the
`@hono/aws-lambda` handler with synthetic payload-2.0 events (ADR-019 Evidence).

### SDK and CLI

#### D24 — SDK methods

`ledger.health.get()`, `ledger.worker.resumeEventSource()`, `ledger.tokens.getCurrent()`,
`ledger.tokens.list({ limit?, after? })`, `ledger.tokens.create({ name, scope })`,
`ledger.tokens.revoke(tokenId: string)`, each `{ data, error }`, never thrown. Exported types
`Health`, `EventSource`, `Token`, `CreatedToken`, `TokenList`. The SDK has no retries in v0 (slice 5
adds read retries; `tokens.create` is never retried). `FakeLedgerClient` grows the same methods.

#### D25 — CLI commands

One `<noun>-<verb>.cli.ts` each, registered under plain group commands (`worker`, `token`) made with
`.command()`: `health-get.cli.ts` (`ledger health`), `worker-resume-event-source.cli.ts`
(`ledger worker resume`), `token-create.cli.ts` (`ledger token create --name <name> --scope
<read|operate>`, both `requiredOption`, strings, no `argParser`), `token-list.cli.ts`
(`ledger token list`: `tokens.list({ limit: 100 })`, the contract's maximum, because the contract
names no paging flag), `token-revoke.cli.ts` (`ledger token revoke <token_id>`),
`token-get-current.cli.ts` (`ledger token current`). Every one takes `--json`. Layouts and notices in
[Surfaces](#surfaces).

### AWS adapters

#### D26 — `packages/aws`

Each adapter takes its SDK client from its composition root, and `packages/aws` also exports one
factory per client (`createSqsClient()`, `createLambdaClient()`, … one per approved
`@aws-sdk/client-*`) that the root calls at module scope. No app, script or `infra/` file imports
`@aws-sdk/*`: root AGENTS.md → Module boundaries ("Only `packages/aws` imports `@aws-sdk/*`") and
[pp-general → review grep 4](../../../../.agents/skills/pp-general/references/boundaries.md#review-greps),
and the clients are `dependencies` of `packages/aws` alone, so nothing else could resolve them.
Each unit test hands a stub with
`send(command)` that records commands and answers from a script, asserting the commands sent and the
mapping of each answer, error names cited from the API Reference. A call only a script makes uses the
concrete module: one implementation is no reason for a port.

| Module | Port or role | SDK calls |
| --- | --- | --- |
| `sqs-queue.adapter.ts` → `SqsQueueAdapter` | `QueuePort.enqueue` | `SendMessage` (body: the envelope JSON) |
| `sqs-queue-attributes.adapter.ts` | `QueueAttributesPort` | `GetQueueAttributes` (visible, not visible) ×2; CloudWatch `GetMetricStatistics` |
| `secrets-manager-secret-reader.adapter.ts` | `SecretReaderPort` | `GetSecretValue` |
| `lambda-event-source-control.adapter.ts` | `EventSourceControlPort` | `ListEventSourceMappings`, `GetEventSourceMapping`, `UpdateEventSourceMapping` |
| `lambda-function-invoke.adapter.ts` | `FunctionInvokePort` | `Invoke` (`RequestResponse`; a `FunctionError` or non-JSON payload is a constant error) |
| `kill-switch.ts` → `tripKillSwitch(clients, names)`, `restoreFromTrip(clients, names, declared)` | The trip and restore steps the kill switch, re-arm and drill share (D29, D35) | Lambda `ListFunctions`, `GetFunctionConcurrency`, `PutFunctionConcurrency`, `DeleteFunctionConcurrency`; the mapping calls; `apigatewayv2` `GetApis`, `GetStage`, `UpdateStage`, `DeleteRouteSettings`; SNS `Publish` |
| `stack-outputs.ts` | Script-only | CloudFormation `DescribeStacks` |
| `secret-writer.ts` | Script-only (deploy step 9) | `GetSecretValue`, `PutSecretValue` |
| `post-destroy-listing.ts` | Script-only (teardown) | Tagging `GetResources`; Secrets Manager `DescribeSecret` (pending deletion is not billable); Logs `DescribeLogGroups` (`/aws/lambda/LedgerApp-`, `/aws/lambda/LedgerGuardrails-` for the kill switch's implicit group, `/ledger/`) |
| `budget-spend.ts` | Script-only (re-arm) | Budgets `DescribeBudget` → `CalculatedSpend.ActualSpend` |
| `alarm-control.ts` | Script-only (drill) | CloudWatch `SetAlarmState`, `DescribeAlarms`; SNS `Publish`; Lambda `Invoke` (`Event`) |

### Infra

#### D27 — The app stack (`LedgerApp`)

Every value a named constant commented with its `AWS-NN`.

- **Functions** through `LedgerFunction` (`ledger-function.construct.ts`): `NodejsFunction`, local
  esbuild, `format: ESM`, `target: 'node24'`, `bundleAwsSDK: true`, `Runtime.NODEJS_24_X`,
  `Architecture.ARM_64`, an explicit `LogGroup` named `/ledger/<function name>` (30 days, `DESTROY`),
  `loggingFormat: TEXT` (D31), physical name `<stack>-<fn>`, no VPC, no reserved concurrency. Initial
  sizes, revisited from the first measured `REPORT` lines (CBL-21, slice 3):

  | Function | Name | Memory | Timeout | Why the timeout |
  | --- | --- | --- | --- | --- |
  | ingest | `LedgerApp-ingest` | 256 MB | 10 s | Under Svix's 15 s delivery timeout (RS-10) and API Gateway's 30 s (AWS-02) |
  | worker | `LedgerApp-worker` | 512 MB | 60 s | The outage path fits: the first attempt's connect (≤ 5 s) and query timeout (15 s), a fresh connection (≤ 5 s) and the retry's query timeout (15 s) is 40 s, with no rollback wait on the failed client (D15's `runTransaction`), so D15 step 3's pause always runs. A slow, not down, database meets D15's batch deadline 10 s before the timeout and takes the same pause. Feeds the visibility timeout (AWS-08) |
  | read API | `LedgerApp-api` | 256 MB | 25 s | Under the 30 s integration cap (AWS-02); one connect (5 s) plus one query (15 s) is the worst case (D18, D19) |

- **Queues:** source retention 13 days, DLQ 14 days (AWS-07, AWS-09), SSE-SQS (no key, AWS-25),
  `maxReceiveCount` 5, visibility timeout `6 × 60 + 0 = 360` s derived in code (AWS-08). No physical
  names.
- **Mapping:** batch size 10, no batching window, `ReportBatchItemFailures`, `MaximumConcurrency: 5`
  (≥ 2, AWS-04; below any new-account quota AWS-U05 reads; five size-1 pools against Neon's pooler).
- **HTTP API** `LedgerApp-http`: `POST /webhooks/resend` → ingest; `$default` → read API. A
  `$default` stage with `throttle: { rateLimit: 100, burstLimit: 200 }` (D30). The default
  `execute-api` endpoint is the URL.
- **Secrets:** `ledger/webhook-signing-secrets` and `ledger/database`, no physical name, `DESTROY`, no
  value in the template (CDK's generated placeholder until the deploy writes the value; until then
  ingest answers `503` and the worker and API fail to parse it). Each function gets `grantRead` on its
  own secrets only.
- **Schedule:** EventBridge Scheduler `LedgerApp-hourly`, `cron(0 * * * ? *)`, flexible window `OFF`,
  `MaximumRetryAttempts: 0`, `MaximumEventAgeInSeconds: 60` (the next tick supersedes a missed one,
  AWS-10), target the worker with `{ "ledger": "resume-event-source" }`.
- **Usage-trip alarm** `LedgerApp-usage-trip` (D30), here because it needs the API id, which the
  guardrails stack cannot import. Its action is the trip topic's ARN built with `formatArn` from the
  topic's fixed name: constructed, not a cross-stack reference.
- **IAM** by grants, plus: ingest `sqs:SendMessage` on the source queue; the read API
  `sqs:GetQueueAttributes` on both queues, `cloudwatch:GetMetricStatistics` (`*`, no resource-level
  form), `lambda:InvokeFunction` on the worker, `lambda:ListEventSourceMappings` (`*`) and
  `lambda:GetEventSourceMapping` on `event-source-mapping:*` with the `lambda:FunctionArn` condition;
  the worker the same mapping calls plus `UpdateEventSourceMapping`. Every function ARN in a policy is
  built with `formatArn` from its physical name, never a `Ref`, so no policy cycles back to its
  function.
- **Outputs:** `DeployedCommit`, `ApiUrl`, `SigningSecretsArn`, `DatabaseSecretArn`, `QueueUrl`,
  `DlqUrl`, `WorkerFunctionName`, `ThrottleRateLimit`, `ThrottleBurstLimit`.
- **Tag:** `Tags.of(app).add('ledger-project', 'ledger')` once in `infra/src/main.ts`. Stacks never
  read context; `main.ts` reads the `ledger:*` context keys and passes literal props.

#### D28 — The guardrails stack (`LedgerGuardrails`; imports nothing from the app stack)

- **Topics**, unencrypted (AWS-35), fixed names: `LedgerGuardrails-trip` (the kill switch subscribes)
  and `LedgerGuardrails-alert`. Each topic policy grants `SNS:Publish` to `budgets.amazonaws.com` and
  `cloudwatch.amazonaws.com`, conditioned on `aws:SourceAccount`. CloudWatch is granted explicitly
  because a CDK topic policy replaces the default one; the drill's alarm-driven trip proves the path.
  With `ledger:alertEmail` set, the address subscribes to both topics (two confirmations, CBL-03).
- **Budget** `LedgerGuardrails-monthly`: plain, monthly, cost, `CostTypes.IncludeCredit: false`
  (AWS-52), limit `ledger:budgetUsd` (default 50). Notifications (4 of AWS-33's 5): ACTUAL 50 %,
  ACTUAL 80 %, FORECASTED 100 % → alert topic; ACTUAL 100 % → trip topic (C17: one SNS subscriber per
  notification, so the address reaches both through the topics).
- **Drill budget** `LedgerGuardrails-drill`, only with `ledger:budgetDrill`: ACTUAL, `ABSOLUTE_VALUE`
  `0.1` (CloudFormation's minimum; 0.01 failed synth, WALKTHROUGH-RUN F3) → trip topic. The real budget keeps its once-a-month alert (AWS-34, C14).
- **Kill switch:** `LedgerGuardrails-kill-switch`, through `LedgerFunction`, 256 MB, 60 s, always
  deployed. With `ledger:killSwitch=on`, the trip topic's Lambda subscription exists; otherwise none.
  Output `KillSwitchArmed` (`true` / `false`) is what CBL-16 reads.
- **Alarm** `LedgerGuardrails-kill-switch-errors`: `Errors > 0`, one 60 s period, `notBreaching`,
  action → alert topic (item 4).
- **Outputs:** `KillSwitchArmed`, `TripTopicArn`, `AlertTopicArn`, `KillSwitchFunctionName`.
- **Region:** the deploying credentials' region (us-east-2). AWS-U01's us-east-1 fallback stays
  behind its tripwire.

Alarms across both stacks: two, inside AWS-28's ten free.

#### D29 — The kill switch's home and steps

`apps/kill-switch` (`@ledger/app-kill-switch`, a new Projects row): `create-kill-switch-handler.ts`
(bound by `kill-switch.handler.ts`, D14's layout) accepts an
SNS event (any message on the trip topic trips; a non-SNS payload throws a constant, which the drill
uses) and calls `tripKillSwitch` from `packages/aws`. In order, each step reading the current state
first so a re-run is safe:

1. Disable the worker's mapping (through `LedgerApp-worker`, D16). A mapping in transition is
   waited out for up to `KILL_SWITCH_SETTLE_TIMEOUT_MS`, 30 s: half the 60 s timeout (D28), so
   steps 2 and 3 still run inside it.
2. `PutFunctionConcurrency` `0` on every function whose name starts `LedgerApp-` (`ListFunctions`),
   so later slices' functions are covered with no edit (C18).
3. On `LedgerApp-http`'s `$default` stage: `DefaultRouteSettings` throttle `0` / `0`, and every
   existing `RouteSettings` entry `0` / `0`.
4. Publish what it changed (function names, states, throttle values; no id, URL or account) to the
   alert topic.

If step 1 still fails (the mapping never settled, or could not be read), steps 2 and 3 run anyway,
then step 1's error is rethrown before step 4, so Lambda's async retry runs the trip again and the
`Errors` alarm fires (owner, "Wait, then cap": a budget-alarm gap is a spend-anyway item). Until that
retry pauses it, the mapping still polls into a throttled worker, the risk step 1's order exists to
avoid, now bounded by the retry instead of left uncapped. Evidence: `kill-switch.test.ts` → "waits out a mapping in
transition", "caps concurrency and every throttle when the mapping never settles", "caps … when the
mapping cannot be read", "Lambda's retry after a failed step 1".

IAM: `lambda:ListFunctions` (`*`); concurrency calls on `function:LedgerApp-*`; mapping calls as D27
(condition on the worker's ARN); `apigateway:GET` on `arn:aws:apigateway:<region>::/apis` and
`…::/apis/*/stages/*`, `apigateway:PATCH` on `…::/apis/*/stages/*` (the AWS-U11 shape, commented as
wider than an id-scoped grant); `sns:Publish` on the alert topic. Its own function and the guardrails
stack are exempt.

#### D30 — Throttle, usage trip and the overshoot bound

- Steady `$default` throttle: rate 100 rps, burst 200 (item 7). Kill-switch stop values `0` / `0`; if
  `UpdateStage` rejects `0`, the lowest accepted value, recorded with its worst-case spend (AWS-U02's
  fallback).
- Usage trip: HTTP API `Count` (vended, AWS-30), `Sum` over 900 s, threshold 15,000, one evaluation
  period, `notBreaching`. It admits one burst (≈ 12k, item 7) with headroom.
- Worst-case cost per accepted request: API Gateway USD 1.0 × 10⁻⁶ (AWS-15); ingest invocation and
  256 MB × 0.1 s (AWS-20) ≈ 0.53 × 10⁻⁶; SQS send plus batched receive and delete ≈ 0.48 × 10⁻⁶
  (AWS-24); a tenth of a 512 MB worker invocation at 50 ms per event ≈ 0.36 × 10⁻⁶; ≈ 1 KB of log
  ingest ≈ 0.5 × 10⁻⁶ (AWS-29). So **c ≈ USD 3 × 10⁻⁶**.
- Above the threshold, a flood at the throttle cap trips within one alarm period plus evaluation
  (≤ 20 min): ≤ 120k requests ≈ USD 0.36.
- Just under the threshold, a sustained flood spends ≤ 60k requests/h ≈ USD 0.18/h until the budget
  trip, which lags by up to a day of billing data plus 12 h (AWS-34): ≤ 36 h ≈ **USD 6.5 above the
  cap**. These inputs and this bound go into aws.md → Budget alarms item 7.

#### D31 — `LoggingFormat.TEXT`

On every function, no application or system level filter. The logger writes one JSON object per
line, which Logs Insights parses as fields, and EMF written with `process.stdout.write` is parsed
under TEXT ([AWS → Node.js logging](https://docs.aws.amazon.com/lambda/latest/dg/nodejs-logging.html)).
Under TEXT no level filter applies, so Winston's lowercase levels cannot be dropped; the library
bullet about the JSON-format filter resolves as moot (C15).

#### D32 — Bundling checks

- `esbuild` `0.28.2` is a root devDependency; `infra/src/esbuild-installation.test.ts` resolves it from
  the repo root, so a missing one fails the gate instead of silently bundling in Docker (AWS-55).
- `infra/src/bundle-smoke.test.ts` (unit): synthesize both stacks; for each function asset, set its
  internal variable names to dummy values, `import()` its `index.mjs`, assert
  `typeof handler === 'function'`. It settles the `require()`-in-ESM and `pg-native` bullets: a failure
  adds esbuild's `createRequire` banner, or marks `pg-native` external, only then.
- So that import needs no AWS access, each root parses its config and builds its clients at module
  scope, but reads its secrets and builds its pool on the first invocation through one memoized
  promise per container (still once per container, reused by every warm invocation).
- `@aws-cdk/aws-lambda:useCdkManagedLogGroup: true` stays; the explicit-log-group assertion proves
  every function uses its own group.

### Scripts

All under `infra/scripts/`, run by `node --env-file-if-exists=.env.local infra/scripts/<name>.ts`
from root scripts `aws:deploy`, `aws:teardown`, `aws:rearm`, `aws:trip-drill`, `aws:db-check`. Each
line is prefixed `<script>: `; each ends `<script>: done`, `<script>: refused: <constant reason>` or
`<script>: failed: <constant reason>` (exit `1` for the last two). Reasons name the variable or
check, never a value.

#### D33 — `pnpm aws:deploy`

`deploy.ts` composes; `run-deploy.ts` sequences with injected steps, so order and fail-closed
behavior are unit-tested with fakes. Inputs: the env vars of [Surfaces → Environment](#environment),
the context keys `ledger:commit`, `ledger:alertEmail`, `ledger:budgetUsd`, `ledger:killSwitch`,
`ledger:budgetDrill` passed as `-c key=value`, and the CDK CLI spawned as
`spawn(process.execPath, [require.resolve('aws-cdk/bin/cdk'), …])` (aws-cdk 2.1145.0 exports
`./bin/cdk`; no shell).

Before step 1 the inputs are parsed with Zod: `LEDGER_DEPLOY_DATABASE_URL`,
`LEDGER_DEPLOY_DATABASE_POOLED_URL` and `LEDGER_ALERT_EMAIL` required; `LEDGER_ADDRESS_HASH_KEY` and
`LEDGER_TOKEN_TAG_KEY` required as 64 lowercase hex. A missing or malformed one refuses, naming the
variable; for either key the reason adds `run pnpm db:setup once to generate it`. The deploy command
never generates a key: a key made per deploy would orphan every stored hash. Steps, each fail-closed:

1. Refuse a working tree with tracked changes (`git status --porcelain --untracked-files=no`), so
   `DeployedCommit` names the code deployed.
2. Read the stacks (`stack-outputs.ts`): if the app stack exists, refuse while tripped (the worker's
   reserved concurrency reads `0`; "run `pnpm aws:rearm` first"), and record whether the worker's
   mapping is paused.
3. Refuse a disarming deploy: `KillSwitchArmed` is `true` and `LEDGER_KILL_SWITCH` is not `on`
   (CBL-16).
4. Refuse an unsafe contract step: for each `pendingContractSteps` SHA, `git merge-base --is-ancestor
   <SHA> <DeployedCommit>`; any exit but 0 refuses. `DeployedCommit` is the **already deployed**
   app stack's output, read in step 2, never the commit about to be deployed: the check asks whether
   the Lambdas running now have stopped using the object (ADR-018). Skipped with no app stack.
5. `cdk synth` with the context, then CBL-01's grep over `cdk.out/`, its `asset.*` esbuild bundles
   excepted (`whsec_|re_[A-Za-z0-9]{8}|postgres(ql)?://|ldg_[0-9a-f]{20}`); a hit refuses. The
   bundles match by themselves (library code) and no deploy input reaches them; rule gate cleared
   2026-10-17 on a measured synth (CBL-01).
6. With an app stack, read the database secret, then refuse a token tag key whose id (the first 8 hex
   characters of `HMAC-SHA-256(key, "ledger:key-id")`, `tokenTagKeyId`) differs from the id of the
   `tokenTagKey` the secret holds: written in step 9, it would fail every stored token's tag check
   (D3), the bootstrap one included, and step 10 prints no new one. Only ids are compared and neither
   key is printed; the reason names restoring the deployed `LEDGER_TOKEN_TAG_KEY` in `.env.local`. A
   secret that does not parse or holds no 64-hex `tokenTagKey` passes, as does a deploy with no app
   stack. Then `prepareDatabase` through `LEDGER_DEPLOY_DATABASE_URL` with D10's role timeouts.
   Password: when the database secret exists and parses, its `pooledUrl`'s password is reused
   (`resetPassword: false`); otherwise a new 24-byte hex password, `resetPassword: true`. No running
   function can hold a working connection then, because the secret it would read does not parse.
7. Refuse an address-hash key whose `key_id` differs from `storedAddressHashKeyId` (D12), before the
   key is written anywhere.
8. `cdk deploy LedgerGuardrails`, then `cdk deploy LedgerApp`, `--require-approval never` (the run
   itself is the owner's Ask-first approval).
9. Write `ledger/database` (`{ pooledUrl, addressHashKey, tokenTagKey }`; `pooledUrl` is
   `LEDGER_DEPLOY_DATABASE_POOLED_URL` with `ledger_runtime:<password>` as credentials and
   `sslmode=require`), and `ledger/webhook-signing-secrets` (JSON array) when
   `LEDGER_DEPLOY_WEBHOOK_SECRETS` is set, each only when it differs from the stored value. Values
   never pass through CDK (CBL-01).
10. `insertBootstrapIfAbsent` through the direct URL; print the token once, only when inserted.
    `--issue-operate-token <name>` also inserts and prints one more `operate` token.
11. Restore a pause recorded in step 2. It runs whenever step 8 started, also when step 8 failed
    (AWS-U09).
12. Print the API URL, the ingest URL (`<ApiUrl>/webhooks/resend`) and `KillSwitchArmed`.

`pnpm db:setup` writes both keys before it touches a database, so a machine with no local Postgres
still gets them (setup then ends `db:setup: failed: Postgres is unreachable …`, which root AGENTS.md
→ Commands notes beside `pnpm aws:deploy`).

#### D34 — `pnpm aws:teardown`

`teardown.ts` / `run-teardown.ts`: read the queue URLs from the app stack's outputs; when the source
queue or the DLQ holds any visible or in-flight message, refuse unless `--discard-queued`;
`cdk destroy LedgerApp --force`; only when that succeeded, `cdk destroy LedgerGuardrails --force`;
then `post-destroy-listing.ts`, exiting non-zero on a billable leftover (a secret pending deletion is
not one); finally print the two steps outside AWS: delete the Resend webhook, and optionally the Neon
project.

#### D35 — `pnpm aws:rearm`

`rearm.ts`: `restoreFromTrip`: `DeleteFunctionConcurrency` on every `LedgerApp-*` function, enable the
worker's mapping, restore the `$default` throttle from the `ThrottleRateLimit` and
`ThrottleBurstLimit` outputs, delete every `RouteSettings` entry (the stack declares none). Then read
the budget's `ActualSpend` (`budget-spend.ts`) and warn when it is at or above the limit (the usage
trip is then the only re-armable trigger this month, item 6). Last, print
`then: ledger reconcile → slice 4`. AWS-U10 settles at apply by reading the Budgets and Cost Explorer
pricing pages before the script lands.

#### D36 — `pnpm aws:trip-drill`

`trip-drill.ts`, one recorded run; refuses unless `KillSwitchArmed` is `true` and the stack is not
tripped:

1. `SetAlarmState` `LedgerApp-usage-trip` → `ALARM`: proves alarm → trip topic → kill switch.
2. Poll up to 5 minutes for D29's end state: mapping disabled, every `LedgerApp-*` concurrency `0`,
   the stage throttle at its stop values. The `UpdateStage` succeeding under D29's grant settles
   AWS-U11.
3. Five unsigned `POST`s to the ingest URL; record the status codes (AWS-U02: expect `429`). The
   billing half of AWS-U02 is read in Cost Explorer later (owner).
4. Invoke the kill switch asynchronously with a non-SNS payload, which it rejects; poll
   `LedgerGuardrails-kill-switch-errors` until `ALARM` (item 8's forced failure).
5. `restoreFromTrip`, then poll for the restored state.
6. Print `reconcile → slice 4` and a summary with no id or URL.

The recorded drill has two parts. This script is the alarm part, run in minutes. The budget part
settles AWS-U01 on its own clock (a budget refresh takes hours, AWS-34): `pnpm aws:deploy
--budget-drill`, wait for the drill budget's notification (the trip email, then the kill switch's
report), `pnpm aws:rearm`, then `pnpm aws:deploy` without the flag, which removes the drill budget.

#### D37 — `pnpm aws:db-check --email-id <id> [--idle-minutes <n>]`

`db-check.ts` reads `ledger/database` (the runtime role's pooled URL) and runs, through `packages/db`
functions only:

1. **PG-U06:** `SHOW idle_in_transaction_session_timeout` and `SHOW lock_timeout` through the pooled
   URL; prints them against D10's values (`5s`, `10s`).
2. **PG-U02:** two size-1 pools through the pooled URL. A opens a transaction, `lockEmail`s the email
   (`SELECT … FOR UPDATE`, no write) and holds it 2 s; B does the same and records its wait. B waiting
   until A commits is the pass. Writes nothing; the email is the verify send's.
3. **PG-U04** (only with `--idle-minutes`, at least 6, past Neon's 5-minute suspend): one connection
   idles, then queries; prints success or the classified error name.

A script rather than ad-hoc SQL keeps the walk free of SQL and the check repeatable after any Neon
change.

#### D38 — The `migrations` verify stage

`scripts/migration-lint.mjs`, Node built-ins, stage `{ name: 'migrations', command: 'node
scripts/migration-lint.mjs' }` right after `lint`. A canary first: an in-memory
`ALTER TABLE t DROP COLUMN c;` that must fail and a marked copy that must pass. Then every
`packages/db/drizzle/*.sql`: a statement matching `\bDROP\b`, `\bRENAME\b`, `\bALTER\b[^;]*\bTYPE\b`
or `\bSET\s+NOT\s+NULL\b` (case-insensitive, `--` comments and double-quoted identifiers stripped,
so a column named `"type"` is no keyword; string literals are kept, so a `DROP` inside a `DO`
block's `EXECUTE '…'` still fails) fails unless line 1 is
`-- contract-step: <40-hex SHA>` or `-- contract-step: replace: <name>, <widen|narrow>`. Prints
`migrations: canary caught 1/1` and `migrations: <n> checked, <k> unmarked`; exit 1 when `k > 0` or
the canary misses.

#### D39 — The gitleaks rule

`.gitleaks.toml` gains `ledger-api-token`, regex `ldg_[0-9a-f]{64}_[0-9a-f]{64}`;
`secret-scan.mjs`'s canary gains one fake token of that shape, built at runtime, and its line becomes
`secrets: canary caught 4/4 rules`. CBL-10's grep already names `ldg_`. Slice 2 is the first to mint a
credential that can read the ledger (lens clause 6).

### Local mode

#### D40 — `apps/local`

`local.config.ts` requires `LEDGER_TOKEN_TAG_KEY` (64 lowercase hex). The composition adds the auth
middleware's key; `InProcessQueueAdapter` as `QueueAttributesPort` (it gains `enqueuedAt` per message:
`visible` = waiting, `inFlight` = delivering, `oldestAgeSeconds` from the oldest `enqueuedAt`,
`dlqVisible` = the dead list, `dlqInFlight` 0); `StaticEventSourceControlAdapter`;
`StaticSecretReaderAdapter` over the parsed `LEDGER_WEBHOOK_SECRETS` (D13); and
`InProcessFunctionInvokeAdapter` over the local worker's `resume`, which answers `already_enabled`.
`--host` stays loopback-only; its refusal line drops "because local mode skips auth" and reads
`refusing to start: --host must be 127.0.0.1, ::1 or localhost`. Slice 2B decides the bind for
`docker compose`.

#### D41 — `pnpm db:setup`

`localEnvNames` gains `LEDGER_TOKEN_TAG_KEY` (32 random bytes, 64 hex), written once and never
overwritten, before the database is touched. After `prepareDatabase` (with D10's `5_000` / `10_000`),
`LEDGER_TOKEN` is (re)written only when it is empty, equals `local-loopback-no-auth`, fails
`hasValidTag` under the file's tag key, or matches no active row: setup inserts a bootstrap `operate`
token (`insertBootstrapIfAbsent`), or, when a bootstrap row already exists, an `operate` token named
`local-setup`, and writes its plaintext. It prints `db:setup: wrote LEDGER_TOKEN to .env.local`,
never the value. Locally the token is inserted as the owner (`DATABASE_URL`), as slice 1's D30
connects locally. `mergeLocalEnv` gains the one replacement rule for `LEDGER_TOKEN`; every other name
keeps "never overwritten".

### `[Unverified]` rows and experiments

#### D42 — How each owed row closes

| Row | Closes by | Kind |
| --- | --- | --- |
| AWS-U01 | Guardrails deploy succeeds in us-east-2, then the `--budget-drill` notification reaches email and trips the kill switch (D36) | MUST settle |
| AWS-U02 | Drill step 3's status codes; the billing half from Cost Explorer's API Gateway usage after the drill day | MUST settle |
| AWS-U11 | The Service Authorization Reference for API Gateway read at apply, then drill step 2's throttle update succeeding under D29's grant | MUST settle |
| PG-U01 | Neon's docs read at apply; Neon support if they are silent (owner op). The question: what counts as activity, and is an idle Free project in an AWS region deleted (slice 2's kept deploy opens no connection on an idle hour until slice 4's reconciler) | MUST settle |
| PG-U02 | `pnpm aws:db-check` step 2 | MUST settle |
| PG-U06 | `pnpm aws:db-check` step 1 | MUST settle |
| AWS-U03 | Safe either way: ≤ USD 0.26/month at five pollers; the 30-day measurement is CBL-18's | Safe |
| AWS-U04 | The verify delivery's `body_base64_count` (D44); the decode is unit-tested both ways | Settle |
| AWS-U05 | `aws lambda get-account-settings` before the first deploy; the quota recorded in aws.md with no account id | Settle |
| AWS-U06 | Listing the two secrets after the teardown drill (walk path T) | Settle |
| AWS-U07 | Safe either way (≤ USD 0.30/month at idle); the first bill is CBL-18's | Safe |
| AWS-U09 | Safe either way: deploy-command tests for the tripped refusal and the pause restore (C13) | Safe |
| AWS-U10 | The pricing pages read before `rearm.ts` lands; the budget read (D35) | Settle |
| AWS-U12 | Safe either way: every handler's catch-at-edge unit test (D14, D17) | Safe |
| PG-U04 | Safe either way (a connection error is retryable, D15); `--idle-minutes 6` observes it on the deploy | Safe |
| Library bullets | Identity on `bigint` and the sequence grant: the `api_tokens` repository test inserting as `ledger_runtime`; `pg`'s code-less errors: D9's classifier test plus PG-U04; CDK bundling: D32's tests; synth without an account: `pnpm synth` in CI; CDK CLI entry: `aws-cdk/bin/cdk`; Cost Explorer read cost: AWS-U10; Lambda level filter: moot under TEXT (C15) | Settle |

#### D43 — RS-U07 is proved safe by the exact-`200` contract

Ingest answers `401` only for a request no configured secret verifies; every infrastructure fault (an
unreadable or empty secret set, a failed enqueue) answers `503` (D13). So a `401` happens only when
the secret is wrong. If a `401` stops Resend's retries, those deliveries are missed and recovered by
`ledger reconcile` (slice 4) within List Events reach; if it does not, the retries end on their own
or auto-disable the webhook (RS-11), which the reconciler detects (ADR-007). Both readings end on the
path ADR-001 prescribes: fix the secret, re-enable, reconcile. Evidence: `create-ingest.test.ts`'s
`503` cases for the secret read and the enqueue. No experiment, no live write.

#### D44 — The verify stage

After the webhook exists (Ask-first) and its secret is placed by a redeploy: one Ask-first send to
`delivered@resend.dev`; `ledger email <id>` shows `delivered`; `ledger health` shows
`queue 0 visible, 0 in flight` and `dlq 0 visible`; the delivery's `ingest.request_decoded` line
shows `body_base64_count`, which settles AWS-U04 in aws.md. RS-U14 is already settled
([RS-42](../../../../.ai/resend.md#facts)).

### Evidence map

Every reliability claim this slice makes, and the test that proves it (PP §20). `pnpm verify` runs
all of them; it cannot see AWS behavior (the drill, the deployed lock test, the verify delivery, the
teardown listing), which the walk records, nor Neon's pooler (PG-U02, PG-U06) or the first bill
(CBL-18).

| Claim | Test (tier) | Fails if removed |
| --- | --- | --- |
| Ships 1, R20: cost brake, mapping, queues, environments | `infra/src/app.stack.test.ts`, `guardrails.stack.test.ts` (unit): one `Template` assertion per cost-brake property, each paired with a count; the throttle on the app template (C3); the mapping; retention and `maxReceiveCount`; the derived visibility timeout; secrets least privilege; per-function key sets equal to `function-env.ts`; outputs incl. `DeployedCommit`; the kill-switch flag both ways | Any cost-brake property; a variable on the wrong function |
| Ships 7: budget wiring | `guardrails.stack.test.ts`: `IncludeCredit: false`, four notifications; both topics unencrypted with both principals; the kill switch and its `Errors` alarm; no `Fn::ImportValue`; the drill budget only with its flag | Budget-alarm wiring |
| D32: bundles | `esbuild-installation.test.ts`, `bundle-smoke.test.ts` (unit) | A Docker fallback; an unloadable bundle |
| Ships 2, R1–R4 | `apps/ingest/src/create-ingest-handler.test.ts` (unit): signed plain and base64 → `200`; forged both ways → `401`; rejecting queue → `503`; fixed bodies and content type; `body_base64_count`. `packages/ingest/src/create-ingest.test.ts` (unit, `FakeClock`): unreadable and empty set → `503`, nothing enqueued; cache within 5 min, refresh after; a failed refresh never serves the expired set | The decode; the `503` on infra faults |
| R4 on SQS | `packages/aws/src/sqs-queue.adapter.test.ts` (unit, stubbed client): `SendMessage` input; a rejection propagates | — |
| Ships 3, R5 | `apps/worker/src/create-worker-handler.test.ts` (unit, fake worker): three records, one failure → exactly that id; a throw → rethrown constant; resume event → `ResumeResult`; unknown event → constant throw | An empty or assumed response |
| Ships 4, R6 (classification) | `packages/db/src/classify-database-error.test.ts` (unit, extended): `Query read timeout`, `53100` | The classification |
| Ships 4, R6, R7 | `packages/worker/src/database-outage.int.test.ts` (int, own container): batch with Postgres stopped → every id listed, `FakeEventSourceControl` reads `paused` after one batch, nothing dead-lettered; a non-connection failure lists only its message and leaves the source enabled. `packages/db/src/run-transaction.int.test.ts` (int): a first attempt ending in `Query read timeout` (the owner holds the row's lock, the test pool's `query_timeout` below the role's `lock_timeout`) is retried on a different backend (`pg_backend_pid()`), and the failed backend is gone from `pg_stat_activity` | The pause; the single retry; the fresh connection |
| Ships 4, R8 | `packages/worker/src/resume.int.test.ts` (int): enabled → `already_enabled` over a pool on a closed port; paused, database up → `resumed`; storage limit 1 byte → `probe_failed`, still `paused` | The probe; the storage check |
| Ships 4 (on demand) | `packages/api/src/resume-event-source.route.int.test.ts` (int, `FakeFunctionInvoke`): `operate` → `200`; `read` → `403`; `probe_failed` → `503` with the override | — |
| Ships 5, R9, R11–R13 | `packages/db/src/api-tokens.repository.int.test.ts` (int, as `ledger_runtime`): identity insert; scope members insert, outsider → `23514`; bootstrap twice → one row; two concurrent revokes of the last two `operate` → one `last_operate_token`. `packages/shared/src/api-token.test.ts` (unit). `packages/api/src/auth.middleware.test.ts` (unit, database at `127.0.0.1:1`): no, malformed, bad-tag → `401`, no connection. `packages/api/src/*token*.route.int.test.ts`: unknown and revoked → `401`; `read` on each `operate` route → `403`; create → `201`, plaintext once, hash stored; list paging; revoke idempotent; `token_not_found`; `last_operate_token` | Auth; the bootstrap key; the revoke lock |
| Ships 5 (deploy) | `infra/scripts/run-deploy.test.ts` (unit, fakes): a re-run inserts no second token and prints none; `--issue-operate-token` prints one | The bootstrap path |
| Ships 6, R10 | `packages/api/src/get-health.route.int.test.ts` (int, own container, real middleware): Postgres stopped → tagged `GET /health` `200`, `reachable: false`; bad tag → `401`; `GET /emails/{id}` → `503`; Postgres up: storage fields, fake queue and source values pass through. `get-health.reader.test.ts` (unit): a `verified: false` caller makes no `storageBytes` call | The outage exception; the one-attempt bound |
| Ships 8, R18 | The `migrations` stage's `DROP COLUMN` canary on every run | The lint |
| Ships 9, R14 | `infra/scripts/run-deploy.test.ts` (unit): each refusal (missing or malformed key or URL, dirty tree, tripped, disarming, unsafe contract step over a throwaway git repo, CBL-01 hit, key mismatch) stops before the next step; guardrails before app; the pause restored also when deploy fails. `packages/db/src/deploy-checks.int.test.ts` (int) | Each refusal |
| Ships 9, R15 | `infra/scripts/run-teardown.test.ts` (unit, fakes): non-empty queue or DLQ refuses without the flag; guardrails only after the app's success; a billable leftover exits `1`, a pending secret does not | The queue refusal; the order |
| Ships 10, R17 | `packages/db/src/runtime-role.int.test.ts` (int): `DELETE FROM webhook_events` and `CREATE TABLE` as `ledger_runtime` → `42501`; `rolconfig` holds both settings. `packages/worker/src/idle-lock-holder.int.test.ts`: a runtime-role client locks the email row and idles → terminated, and the worker commits one row of everything | The grants; the role timeouts |
| R16 | `packages/aws/src/kill-switch.test.ts` (unit, stubbed clients): mapping first; every prefixed function; both throttle kinds; re-run issues no change; `restoreFromTrip` restores | The order; a missed function |
| Adapters | One unit test per `packages/aws` module (D26) | Command drift |
| D1, R4 | The five shared port contract suites (unit), each run by both implementations | Two implementations drifting apart |
| D40, D41, R19 | `apps/local/src/main.e2e.test.ts` (updated, no Docker): `GET /` without a token → `401`; `GET /health` with a tag-valid token over a placeholder `DATABASE_URL` → `200`, `reachable: false`; non-loopback host → exit `1`; missing `LEDGER_TOKEN_TAG_KEY` → exit `1` naming it. `merge-local-env.test.ts`: the tag key written once; `LEDGER_TOKEN` replaced only in its four cases | Local auth; the token repair |
| D23 | `readApiContract` run by `apps/local/src/sdk-contract.int.test.ts` and `apps/api/src/api-lambda-contract.int.test.ts` (int) | Adapter drift |
| D25 | One `--json` test per new command (pp-cli → cli-tests), plus `token create` plaintext on stdout once, never stderr; `token list`'s notice on `has_more` | Exit mapping; the plaintext rule |

`int` timeouts are set from measured runs.

## Data model

The Drizzle schema in `packages/db` owns table and column shape; migrations are expand/contract only.
Owner-approved (proposal → Ask-first, Schema).

### `api_tokens` — `packages/db/src/schema/api-tokens.ts`

Credential record; insert, then revoke once.

| Column | Type | Null | Default / constraint | Notes |
| --- | --- | --- | --- | --- |
| `id` | `bigint GENERATED ALWAYS AS IDENTITY` | no | `api_tokens_pkey` | `token_id` on the wire; keyset page key (served by the PK); read with `bigint({ mode: 'number' })` |
| `name` | `text` | no | — | The operator's label; validated by the API (D21) |
| `token_hash` | `text` | no | `api_tokens_token_hash_key` UNIQUE | SHA-256 hex of the token |
| `bootstrap` | `boolean` | no | `false`; partial unique index `api_tokens_bootstrap_key` on `(bootstrap) WHERE bootstrap` | The deploy command's and setup's first `operate` token |
| `scope` | `text` | no | `api_tokens_scope_check` `CHECK (scope in ('read', 'operate'))` from `tokenScopes` | ADR-011 |
| `revoked_at` | `timestamptz` | yes | — | Null while active; set once |
| `created_at` | `timestamptz` | no | `now()` | Base field |
| `updated_at` | `timestamptz` | no | `now()` | Base field (C11); set by `markRevoked` |

- **Idempotency key:** `api_tokens_bootstrap_key`. `token.create` is deliberately not idempotent.
- **Indexes:** the PK, the `token_hash` unique key (the middleware's lookup), the partial bootstrap
  index. No other.
- **No** foreign key, trigger, `tenant_id`, `deleted_at` or plaintext. **PII:** none.

**Migrations**, in order, both pure expand with no contract-step marker:

1. `0002_create-api-tokens.sql`: `pnpm db:generate --name create-api-tokens`, read before commit.
2. `0003_grant-api-tokens.sql`: `pnpm db:generate --custom --name grant-api-tokens`:
   `GRANT SELECT, INSERT, UPDATE ON "api_tokens" TO "ledger_runtime";`. If the identity insert as
   `ledger_runtime` fails on the sequence, the same migration adds
   `GRANT USAGE ON SEQUENCE api_tokens_id_seq TO "ledger_runtime";`, before it freezes.

No backfill. `0000` and `0001` are untouched.

**Role-level settings** (not schema, D10): `ALTER ROLE ledger_runtime SET
idle_in_transaction_session_timeout = '5s'` and `SET lock_timeout = '10s'`, on every deploy and
setup.

### State machines

No projection changes; no outbox row (slice 6).

**Worker event source** (the mapping's `Enabled`, AWS-18; reported per D4):

| From | Event | To | Who |
| --- | --- | --- | --- |
| `enabled` | Connection-class failure twice in one message (D15) | `paused` | The worker |
| `paused` | Hourly schedule or `worker.resumeEventSource`; probe succeeds, storage below threshold | `enabled` | The worker's `resume` |
| `paused` | Probe fails | `paused` | — |
| any | Kill switch trips | `paused` (and every app function at concurrency `0`) | The kill switch |
| any | `pnpm aws:rearm` | `enabled` | The re-arm |
| `paused` | `pnpm aws:deploy` | `paused` kept (step 11) | The deploy command |

A tripped stack cannot resume itself: its resume invocations are throttled at concurrency `0`.

**Token:** `active` → `revoked` (terminal). **Kill switch:** `disarmed` (no subscription) or `armed` →
`tripped` → `armed` (re-arm). A deploy refuses `tripped` and refuses `armed` → `disarmed`.

## Surfaces

All JSON below is the SDK's `data` and the CLI's `--json` stdout. Times are RFC 3339 UTC. Every error
is the error shape with the registry's `docs`.

### `health.get` — `GET /health` → `ledger.health.get()` → `ledger health [--json]`

```json
{
  "object": "health",
  "queue": { "visible": 0, "in_flight": 0, "oldest_age_seconds": null },
  "dlq": { "visible": 0, "in_flight": 0 },
  "event_source": { "state": "enabled" },
  "database": { "reachable": true, "storage_bytes": 9437184, "storage_limit_bytes": 1000000000 }
}
```

During an outage: `"database": { "reachable": false, "storage_bytes": null, "storage_limit_bytes":
1000000000 }`, still `200`. Human:

```text
queue       0 visible, 0 in flight, oldest —
dlq         0 visible, 0 in flight
worker      enabled
database    reachable, 9.4 MB of 1.0 GB
```

`oldest <n>s` when non-null; `database    unreachable` during an outage. Errors: `unauthorized`,
`internal_error`. `read` and `operate` tokens both see it.

### `worker.resumeEventSource` — `POST /worker/resume` → `ledger.worker.resumeEventSource()` → `ledger worker resume [--json]`

`{ "object": "event_source", "state": "changing", "resumed": true }`. Human:
`worker      changing (resumed)`, `worker      enabled (resumed)`, or
`worker      enabled (already enabled)`. Errors: `unauthorized`, `forbidden`, `database_unavailable`
(probe failed) with message **"The database is unreachable or at its storage limit, so the event
source stays paused."** and the registry hint, `internal_error`. Locally it always answers
`enabled (already enabled)`.

### Token object

`{ "object": "token", "token_id": 3, "name": "review-2026-10-20", "scope": "read", "created_at": "…",
"revoked_at": null }`. Never a hash.

- **`token.create`** → `POST /tokens` → `ledger.tokens.create({ name, scope })` →
  `ledger token create --name <name> --scope <read|operate> [--json]`: `201`, the token object plus
  `"token": "ldg_…"`. Human (stdout):

  ```text
  token       3
  name        review-2026-10-20
  scope       read
  created     2026-10-20T09:00:00.000Z
  secret      ldg_…
  ```

  plus one stderr notice: `ledger: this is the only time the token is shown; store it now.` Errors:
  `unauthorized`, `forbidden`, `validation_failed`, `database_unavailable`, `internal_error`.
- **`token.list`** → `GET /tokens` → `ledger.tokens.list({ limit, after })` → `ledger token list
  [--json]`: `{ "object": "list", "has_more": false, "data": [ <token>, … ] }`. Human, one row per
  token: `  3   review-2026-10-20   read      2026-10-20T09:00:00.000Z   —` (last column `revoked_at`
  or `—`). With `has_more`: stderr `ledger: more tokens exist; showing the newest 100.` Errors:
  `unauthorized`, `forbidden`, `validation_failed`, `database_unavailable`, `internal_error`.
- **`token.revoke`** → `POST /tokens/{token_id}/revoke` → `ledger.tokens.revoke(tokenId)` →
  `ledger token revoke <token_id> [--json]`: `200`, the token object. Human: the create layout without
  `secret`, plus `revoked     <time>`. Errors: `unauthorized`, `forbidden`, `validation_failed`,
  `token_not_found`, `last_operate_token`, `database_unavailable`, `internal_error`.
- **`token.getCurrent`** → `GET /tokens/current` → `ledger.tokens.getCurrent()` →
  `ledger token current [--json]`: `200`, the caller's token object. Human: `token`, `name`, `scope`,
  `created`. Errors: `unauthorized`, `database_unavailable`, `internal_error`.

`email.get` and `recipient.get` gain `unauthorized`; `recipient.get`'s body message is unchanged.

### Error codes raised

Registry defaults (`packages/core/src/error-codes.ts`) unless a row overrides. No code is added.

| Code | Status | `message` | `hint` |
| --- | --- | --- | --- |
| `unauthorized` | 401 | Bearer token missing, malformed, bad-tag, unknown or revoked. | Set `LEDGER_TOKEN` to an active token. |
| `forbidden` | 403 | The token is valid but lacks the scope this operation needs. | Use an `operate` token, or ask its owner for one. |
| `validation_failed` (`name`) | 400 | name must be 1 to 64 characters from A-Z, a-z, 0-9, '.', '_' and '-', starting with a letter or digit. | Fix the field the message names, then retry. |
| `validation_failed` (`scope`) | 400 | scope must be read or operate. | Fix the field the message names, then retry. |
| `validation_failed` (`token_id`) | 400 | token_id must be a positive integer. | Fix the field the message names, then retry. |
| `validation_failed` (`limit`) | 400 | limit must be an integer from 1 to 100. | Fix the field the message names, then retry. |
| `validation_failed` (`after`) | 400 | after must be a token id, a positive integer. | Fix the field the message names, then retry. |
| `validation_failed` (`POST /tokens` body) | 400 | The request body must be a JSON object with name and scope fields. | Send Content-Type: application/json with a JSON body. |
| `token_not_found` | 404 | No token with this id. | List tokens with `ledger token list`. |
| `last_operate_token` | 409 | Revoking this token would leave no active `operate` token. | Create another `operate` token first. |
| `database_unavailable` | 503 | The database is unreachable. (resume: the override above) | The queue holds events meanwhile (ADR-015); retry, then `ledger worker resume`. `ledger health` shows storage used. |
| `internal_error` | 500 | An unexpected error occurred. | Retry; if it persists, read the API logs by request id. |
| `api_unavailable` | — (SDK) | The Ledger API did not answer with a Ledger response. | Check `LEDGER_URL`. The kill switch may be tripped: check the budget alerts, then run the re-arm script. |

### CLI behavior

Exit `0` / `1` / `2` as today. A missing `--name`, `--scope` or `<token_id>` is commander's usage
error, exit `2`, no SDK call. `ledger token create` prints the plaintext to stdout only, once. The
`api_unavailable` path is how a tripped stack reads from the CLI (CBL-17).

### Ingest (not an operation)

Unchanged bodies (`ok`, `unauthorized`, `unavailable`, `text/plain; charset=utf-8`). New `503`
causes: unreadable, unparseable or empty secret set (D13). New log lines:
`ingest.request_decoded` (`body_base64_count`), `ingest.secrets_unavailable` (`error_name`).

### Environment

Seven new public variables (owner-approved), each added to api-contract.md → Conventions and
`.env.example` (names only):

| Name | Read by | Form |
| --- | --- | --- |
| `LEDGER_TOKEN_TAG_KEY` | `apps/local`, `pnpm db:setup` (writes it once), `pnpm aws:deploy` (into `ledger/database`) | 64 lowercase hex |
| `LEDGER_DEPLOY_DATABASE_URL` | deploy | Neon direct URL, owner credentials |
| `LEDGER_DEPLOY_DATABASE_POOLED_URL` | deploy | Neon pooled URL, owner credentials (the deploy swaps in `ledger_runtime`) |
| `LEDGER_DEPLOY_WEBHOOK_SECRETS` | deploy (optional) | Comma-separated `whsec_…`, the deployed signing-secret set |
| `LEDGER_ALERT_EMAIL` | deploy (required) | The budget and kill-switch alert address; never committed |
| `LEDGER_KILL_SWITCH` | deploy | `on` \| `off`, default `off` |
| `LEDGER_BUDGET_USD` | deploy | Positive number, default `50` |

Unchanged: `LEDGER_ADDRESS_HASH_KEY` (now also read by the deploy command), `AWS_REGION`,
`AWS_PROFILE`, `LEDGER_URL`, `LEDGER_TOKEN`. Internal variables: D2. Secrets layout:
`ledger/database` holds `{ pooledUrl, addressHashKey, tokenTagKey }`;
`ledger/webhook-signing-secrets` holds a JSON array of `whsec_…`.

### PII

The plaintext token appears only in `token.create`'s response, `ledger token create`'s stdout, the
deploy command's step 10 and `db:setup`'s `.env.local` write; logs carry `token_id` alone. The two
keys live in `.env.local` and `ledger/database`, never in a log, output, template or variable. The
alert address lands in `cdk.out/` (git-ignored, CBL-19) and SNS only. Health and the kill-switch
report hold counts, names and states. No new column holds PII.

## Walkthrough plan

`WALKTHROUGH.md` in this folder, in
[the format](../../../../.agents/skills/rsa-manual-test/references/walkthrough-format.md). It runs well
past ~15 minutes: two deploys, a drill and a budget wait.

Personas: **Operator** (deploy, health, resume, tokens, drill, teardown), **Application developer**
(connecting the webhook, deployed ingest, HTTP with a token), **Support / on-call engineer**
(`ledger email`, `ledger recipient` deployed), **Reviewer** (a `read` token: what it can and cannot
do). Not reaching it: **AI agent** (MCP, slice 5).

Every `UI surfaces` entry is reached: deploy command B3, B4, B5, G4, G6, T3, C3; teardown command T1;
`POST /webhooks/resend` (deployed) C4; `ledger email` C5, D1; `ledger recipient` D2; `ledger health`
A3, C6, E3; `ledger worker resume` A4, E4; `ledger token create|list|revoke|current` A2, A5–A7,
F1–F5; trip drill and re-arm scripts G1–G6.

**Before you start:** `pnpm install`; Docker running; `pnpm dev:full` (runs `db:setup`, which mints
`LEDGER_TOKEN`). For deployed paths, set the deployed `LEDGER_URL` and `LEDGER_TOKEN` in the shell
(`export LEDGER_URL=…`; `read -rs LEDGER_TOKEN && export LEDGER_TOKEN`, so the token never lands in
history); a shell value wins over `.env.local`. **Creates:** local tokens; both stacks (kept); a drill
budget (removed in G6); the production webhook; one test email's rows; review tokens (revoked in F5).
**Ask-first:** B1, B4, C1, C2, C3, C4, E5, G1–G6, T1, and every `pnpm aws:*` run.

**Order:** A → B → G → T (teardown, then redeploy) → C → D, E, F. Teardown runs before the webhook
exists, so the redeploy's new ingest URL needs no webhook update.

- **A — local auth, health and tokens (Operator).** A1 `pnpm db:setup` over slice 1's `.env.local` →
  `db:setup: wrote LEDGER_TOKEN_TAG_KEY …` and `… LEDGER_TOKEN …`. A2 `pnpm -s ledger token current
  --json` → `"scope": "operate"`. A3 `pnpm -s ledger health --json` → `"state": "enabled"`,
  `"reachable": true`. A4 `pnpm -s ledger worker resume` → `enabled (already enabled)`. A5 `pnpm -s
  ledger token create --name walk-read --scope read` → the layout, notice on stderr. A6 `curl`
  `$LEDGER_URL/tokens` with the walk-read token → `403 forbidden`; with none → `401`. A7 revoke
  walk-read → revoked; revoking the only `operate` token → exit `1`, `last_operate_token`.
- **B — deploy (Operator).** B1 **Ask-first:** `aws lambda get-account-settings` (AWS-U05; record the
  concurrency quota only). B2 `pnpm synth` → no CBL-01 hit. B3 `pnpm aws:deploy` with a fresh
  `LEDGER_ADDRESS_HASH_KEY` against a database holding hashes → `aws:deploy: refused: …key_id…`
  before any stack change (on a fresh database this step reads `n/a`). B4 **Ask-first:** `pnpm
  aws:deploy` → guardrails then app, the first `operate` token printed once, `KillSwitchArmed true`;
  confirm both SNS emails (CBL-03). B5 re-run → no token printed.
- **G — trip drill and re-arm (Operator).** G1 **Ask-first:** `pnpm aws:trip-drill` → steps 1–5 pass,
  five `429`s (AWS-U02), the throttle update accepted (AWS-U11), the `Errors` alarm fires. G2
  `ledger health` while tripped → exit `1`, `api_unavailable`. G3 `reconcile → slice 4`. G4
  **Ask-first:** `pnpm aws:deploy --budget-drill`; wait for the drill notification and the kill
  switch's report email (AWS-U01). G5 **Ask-first:** `pnpm aws:rearm` → restored, spend warning if
  any. G6 **Ask-first:** `pnpm aws:deploy` → the drill budget is gone.
- **T — teardown (Operator).** T1 **Ask-first:** `pnpm aws:teardown` → app, then guardrails, listing
  clean, the two outside steps printed. T2 list the two secrets → pending deletion (AWS-U06). T3
  **Ask-first:** `pnpm aws:deploy` → the bootstrap row survives in Neon, no token prints; `pnpm
  aws:deploy --issue-operate-token walk-operate` prints one.
- **C — connect the webhook and verify (Application developer).** C1 **Ask-first:** create the
  webhook for the printed ingest URL (dashboard or `POST /webhooks`, RS-13), owner-run, its secret
  never pasted into a transcript (RS-05). C2 put the secret in `LEDGER_DEPLOY_WEBHOOK_SECRETS`. C3
  **Ask-first:** `pnpm aws:deploy` → the secret written. C4 **Ask-first:** one send to
  `delivered@resend.dev`. C5 `pnpm -s ledger email <id> --json` → `"status": "delivered"`. C6 `pnpm
  -s ledger health` → queue and DLQ at 0; then `aws logs filter-log-events --log-group-name
  /ledger/LedgerApp-ingest --filter-pattern '"ingest.request_decoded"'` (read-only; allow-listed
  fields only) → `body_base64_count` (AWS-U04).
- **D — support lookup, deployed (Support / on-call engineer).** D1 `ledger email <id>`, human layout.
  D2 `ledger recipient delivered@resend.dev` → `ok`, masked.
- **E — operate the deployed pipeline (Operator).** E1 `curl $LEDGER_URL/health` with no token →
  `401`. E2 with a bad-tag token → `401`. E3 `ledger health --json`. E4 `ledger worker resume` →
  `enabled (already enabled)`. E5 **Ask-first:** `pnpm aws:db-check --email-id <id> --idle-minutes 6`
  → PG-U06 values, PG-U02 serialized, PG-U04 outcome.
- **F — reviewer access (Reviewer, the Operator issuing).** F1 `ledger token create --name review-walk
  --scope read`. F2 (as the reviewer) `ledger token current` → `read`. F3 `ledger email <id>` → `200`.
  F4 `ledger token list` → exit `1`, `forbidden`; `ledger worker resume` → `forbidden`. F5 revoke
  `review-walk` and `walk-operate`; then `ledger token current` with the revoked token →
  `unauthorized` (CBL-20).
- **Teardown of the walk:** revoke walk tokens (F5); the stacks stay up (deploy and keep).

**Cannot reach today:**

| Not reachable | Carried by |
| --- | --- |
| `ledger reconcile` after a re-arm or a trip | [slice 4](../../../../.ai/build-checklist.md#4--recovery) |
| DLQ inspect and redrive; alarms with runbook entries; the burst and `--chaos db-outage` on AWS | [slice 3](../../../../.ai/build-checklist.md#3--operations-and-evidence-on-aws) |
| A durable local queue; local DLQ operations | [slice 2B](../../../../.ai/build-checklist.md#2b--local-mode-queue-and-docker-compose) |
| MCP tools | [slice 5](../../../../.ai/build-checklist.md#5--mcp-server-and-contract-hardening) |
| A deployed database outage (Neon cannot be stopped from the walk) | The Testcontainers outage test; slice 3's `--chaos db-outage` |

## Risks / Trade-offs

- [`AWS::Budgets::Budget` will not deploy in us-east-2 (AWS-U01)] → the first group-13 action deploys
  `LedgerGuardrails` alone, before the app stack; on failure the stack moves to us-east-1 behind its
  tripwire, the kill switch's clients targeting the app region through config.
- [A throttle of `0` is rejected or still bills (AWS-U02)] → drill step 3; D30's fallback (lowest
  accepted value, its spend stated in aws.md).
- [The AWS-U11 resource shape is wrong, so the kill switch cannot throttle] → read the Service
  Authorization Reference at apply; drill step 2; a real trip fails loudly on the `Errors` alarm.
- [Neon's pooler ignores the role settings (PG-U06 negative)] → `pnpm aws:db-check` step 1; the
  `SET LOCAL lock_timeout` fallback needs a pp-database rule change and goes to the owner then.
- [The CDK topic policy blocks the alarm's publish] → D28 grants CloudWatch explicitly; drill step 1
  proves it.
- [A bundle fails to load (CommonJS `require`, `pg-native`)] → D32's smoke check runs in
  `pnpm check`, before any deploy.
- [The tagging API lists just-deleted resources] → re-run the listing after a few minutes; the script
  names each leftover ARN's type.
- [The 5 s idle-in-transaction timeout cuts slice 6's dispatcher batch] → recorded for slice 6's
  pre-proposal, which sizes its delivery timeout or the role value.
- [`pg_database_size` and Neon's accounting differ] → D11's 95 % threshold; PG-U07 in slice 3.
- [The budget-drill notification takes longer than a day] → start G4 right after the first deploy.
- [Identity inserts need a sequence grant] → the repository int test runs as `ledger_runtime` before
  `0003` freezes.
- [Neon deletes an idle Free project (PG-U01) before slice 4's hourly reconciler gives it activity] →
  PG-U01 read at apply, before the first deploy; the answer, with what counts as activity, goes to
  the owner (lens clause 6: lost events).
- [Local mode's placeholder token stops working] → `pnpm db:setup` repairs it in its four cases; the
  e2e test pins the replacement rule.

## Migration Plan

1. Groups 1–12 build and test everything with no AWS access; `pnpm synth` and the bundle smoke check
   run in CI.
2. `0002` and `0003` apply through `prepareDatabase`: locally by `pnpm db:setup`, on Neon by the first
   `pnpm aws:deploy` (step 6), before the code that reads `api_tokens` is deployed (ADR-018). Both are
   pure expand; rollback is a redeploy of the previous commit, which ignores the table.
3. Group 13 runs each AWS action and live Resend write one at a time, each owner-approved when it
   runs, in the walk's order (A, B, G, T, C, D, E, F).
4. Rollback of a deploy: `pnpm aws:deploy` from the previous commit (no contract step exists to block
   it), or `pnpm aws:teardown`, which refuses while events are queued.

## Open Questions

None that changes the specs, the approach or the task breakdown. PG-U01's answer (Neon's inactivity
rule) is settled at apply before the first deploy; if it shows an idle kept deploy is deleted before
slice 4, the remedy goes to the owner as a named decision, and nothing built before group 13 changes.
