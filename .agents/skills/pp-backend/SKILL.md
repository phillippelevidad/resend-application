---
name: pp-backend
description: Ledger's backend patterns — package factories over ports and the hand-wired `main.ts` of each `apps/*` entry point, the port set, commands and readers with one `execute(input)` and the transaction a command owns, verify-then-enqueue ingest, the worker's one transaction per message with partial batch failure and the outage pause, the outbox, dispatcher, reconciler and DLQ redrive, `packages/resend-client` (sole Resend caller, limiter, error mapping), the read API on Hono, the SDK, and the rules every surface shares. Load it before writing or reviewing anything under `packages/{core,ingest,worker,dispatcher,reconciler,api,sdk,resend-client,aws,shared}/**` or `apps/{ingest,worker,dispatcher,reconciler,api,local}/**` — "add a route", "expose an operation", "write the handler", "wire main.ts", "add a port", "call Resend", "emit a reaction", "make this idempotent", "handle the batch failure", "SDK method". Load it alongside pp-workflow and pp-general, not instead of them; pp-database owns `packages/db`, pp-cli and pp-mcp own their apps. When it and a linked doc disagree, the doc wins and this file is fixed.
---

# pp-backend — patterns and practices, functions, read API and SDK

How Ledger's functions, read API and SDK are built, and the gate that checks them. Rules link their
ADR or `.ai/` doc; this skill owns only the backend mechanics no doc owns.

**Owns:** factories and composition roots · ports · commands, readers, transactions · ingest,
worker, dispatcher, reconciler and DLQ patterns · the outbox · `resend-client` · the read API on
Hono · the SDK · the rules every surface shares.

**Does not own:** process → [pp-workflow](../pp-workflow/SKILL.md) · naming, imports, boundaries,
errors, logging, PII in code, config → [pp-general](../pp-general/SKILL.md) · schema, repositories,
migrations, grants → [pp-database](../pp-database/SKILL.md) · tests, fakes, `sim` →
[pp-testing](../pp-testing/SKILL.md) · CDK, bundling → [pp-infra](../pp-infra/SKILL.md) · CLI →
[pp-cli](../pp-cli/SKILL.md) · MCP → [pp-mcp](../pp-mcp/SKILL.md).

**Precedence:** [pp-general → Precedence](../pp-general/SKILL.md#precedence).

| Reference | Open when |
| --- | --- |
| [composition.md](references/composition.md) | Writing a factory, a `main.ts` or a `.handler.ts`; adding or implementing a port |
| [commands-and-readers.md](references/commands-and-readers.md) | Writing a command or reader; opening a transaction; making a write idempotent |
| [ingest-and-worker.md](references/ingest-and-worker.md) | Touching verification, the envelope, the worker transaction, batch failure or the ADR-015 pause |
| [reactions-and-recovery.md](references/reactions-and-recovery.md) | Outbox rows, the dispatcher, the reconciler, DLQ inspect or redrive |
| [resend-client.md](references/resend-client.md) | Any call to Resend's API; the limiter; mapping a Resend error |
| [read-api.md](references/read-api.md) | A route, a mapper, middleware, `onError`, the OpenAPI document |
| [sdk.md](references/sdk.md) | An SDK method, its return style, retries, the generated types |

## Always

- Logic in a package factory `create<Thing>(deps)` over ports and typed config, returning a
  function over domain inputs; each `apps/*` is event adaptation plus a `main.ts` that builds
  everything once at module scope, with one `pg` pool of size 1
  ([ADR-013](../../../.ai/architecture.md#adr-013--pure-core-and-local-mode),
  [ADR-005](../../../.ai/architecture.md#adr-005--postgres-only); [composition.md](references/composition.md)).
- Writes in a command, reads in a reader: one public `execute(input)`, `type <Name>Input` beside it
  ([ADR-019](../../../.ai/architecture.md#adr-019--application-and-surface-stack)). A command opens
  one `db.transaction`, passes `tx` down, and makes no external call inside it
  ([commands-and-readers.md](references/commands-and-readers.md)).
- Verify the signature against every configured secret, first match wins, before enqueueing;
  `200` only after the enqueue resolved ([ADR-001](../../../.ai/architecture.md#adr-001--verify-then-enqueue),
  [ADR-009](../../../.ai/architecture.md#adr-009--multi-secret-verification-and-timestamp-tolerance)).
- The ledger insert, the projection writes and the outbox rows in one transaction per message
  ([ADR-004](../../../.ai/architecture.md#adr-004--immutable-ledger-keyed-on-svix_id-one-transaction-per-message),
  [ADR-006](../../../.ai/architecture.md#adr-006--transactional-outbox-for-reactions)).
- Idempotent on `svix_id` or the outbox `dedupe_key`, enforced by the constraint: delivery is
  at-least-once ([ADR-002](../../../.ai/architecture.md#adr-002--sqs-standard-not-fifo),
  [Idempotency keys](../../../.ai/data-modeling.md#idempotency-keys)).
- Projections by the pure `packages/core` functions over the full event set
  ([ADR-003](../../../.ai/architecture.md#adr-003--projection-is-a-pure-function-of-the-event-set)).
- Partial batch failure from per-message results, bounded concurrency, poison to the DLQ
  ([ADR-008](../../../.ai/architecture.md#adr-008--backpressure-bounded-concurrency-partial-batch-failure-dlq));
  on a database outage the worker pauses its own event source
  ([ADR-015](../../../.ai/architecture.md#adr-015--the-worker-pauses-its-own-event-source-on-a-database-outage)).
- Recovery by id diff, replayed through ingest ([ADR-007](../../../.ai/architecture.md#adr-007--recovery-by-id-diff-and-replay-through-ingest)).
- Every Resend API call through `packages/resend-client`, the sole caller: its limiter, status-then-name
  mapping and `User-Agent` ([ADR-012](../../../.ai/architecture.md#adr-012--resend-client-is-the-sole-resend-api-caller)).
- Each route: one `createRoute` per api-contract entry, one command or reader, one mapper that
  applies the masks ([read-api.md](references/read-api.md)).

## Case-by-case

| Do this | Deciding test |
| --- | --- |
| Add a port | It is in [composition.md → Ports](references/composition.md#ports), or an ADR names it |
| Return an object of functions from a factory | One Lambda serves two event kinds (the worker: batch and resume) |
| Run a step after commit instead of writing an outbox row | Losing it is harmless because a sweep repeats it (the dispatcher invoke, [ADR-017](../../../.ai/architecture.md#adr-017--the-dispatcher-is-triggered-after-commit-plus-an-hourly-sweep)); any other effect is an outbox row |
| Make an external call inside a transaction | It is the dispatcher's claimed batch (ADR-017); nothing else qualifies |
| Settle a slice-owned choice here | Never: write "the slice N pre-proposal settles it" and the constraint the docs fix |

## Never

Each entry names its alternative.

- **A side effect inside the worker transaction** → an outbox row, delivered by the dispatcher
  ([ADR-006](../../../.ai/architecture.md#adr-006--transactional-outbox-for-reactions)).
- **State order taken from transport** (arrival, SQS order, FIFO, `received_at`) → the projection
  folds the event set; Resend promises no delivery order ([ADR-002](../../../.ai/architecture.md#adr-002--sqs-standard-not-fifo),
  [ADR-003](../../../.ai/architecture.md#adr-003--projection-is-a-pure-function-of-the-event-set)).
- **Redis (or any second store) as a queue, cache or source of truth** → SQS through the queue port,
  Postgres for truth ([ADR-005](../../../.ai/architecture.md#adr-005--postgres-only)).
- **A read-then-write guard** (select, then insert if absent) → the unique constraint or lock decides
  ([commands-and-readers.md](references/commands-and-readers.md#idempotency-the-constraint-decides)).
- **Dedupe on the SQS `messageId`** → `svix_id`; a redrive changes the `messageId` (AWS-21).
- **An unverified payload reaching the queue, a `2xx` before the enqueue resolved, or ingest touching
  the database** → verify, enqueue, then answer ([ADR-001](../../../.ai/architecture.md#adr-001--verify-then-enqueue)).
- **A content-invalid verified event sent to the DLQ** → store it raw, skip the projection
  ([ADR-004](../../../.ai/architecture.md#adr-004--immutable-ledger-keyed-on-svix_id-one-transaction-per-message)).
- **A handler that catches and returns success, or an empty batch response by default** → the
  failure list from per-message results (AWS-05; [ingest-and-worker.md](references/ingest-and-worker.md#worker-per-batch)).
- **A Lambda event type in a package, or logic in a `.handler.ts`** → a domain input and the package
  factory ([composition.md](references/composition.md)).
- **An ambient or second transaction, or `tx` not passed down** → one `db.transaction`, `tx` explicit.
- **A route not built with `createRoute`, a row on the wire, or a database connection before the token
  tag check** → [read-api.md](references/read-api.md).
- **A raw address, subject or body in a log line, outbox payload, `last_error` or output** → ids,
  hashes and masks ([PII & retention](../../../.ai/data-modeling.md#pii--retention)).
- **A hand-edited `openapi.json` or generated SDK type** → regenerate from `packages/api` ([sdk.md](references/sdk.md)).

## Surfaces — SDK, CLI, MCP

[api-contract.md → Conventions](../../../.ai/api-contract.md#conventions) binds every surface.

**Every surface:**

- **One contract.** The CLI and the MCP server are built on `packages/sdk`, never on the database
  or a server package; they present and orchestrate, the read API decides
  ([ADR-011](../../../.ai/architecture.md#adr-011--one-contract-many-surfaces),
  [review grep 13](../pp-general/references/boundaries.md#review-greps)).
- **api-contract first.** Every operation, route, error code, CLI command or flag, public variable
  and MCP tool is in [api-contract.md](../../../.ai/api-contract.md) before code; adding or changing
  one is Ask-first ([Permissions](../../../AGENTS.md#permissions)).
- **One error shape**, codes only from the [registry](../../../.ai/api-contract.md#error-codes), each
  surface mapping once at its edge ([one mapping per surface](../pp-general/references/errors.md#one-mapping-per-surface)).
- **Masks only**, never raw PII or the payload, on every surface, MCP tool output included.
- **`LEDGER_URL` and `LEDGER_TOKEN`** from the environment, never a `--token` flag; scope is decided
  server-side from the bearer token.

**The SDK** returns `{ data, error }` like Resend's SDK (RS-23; owner, O-10), the one named
exception to [pp-general → Never](../pp-general/SKILL.md#never)'s "no `Result` type"; its build
path, error mapping and read-only retries are [sdk.md](references/sdk.md). **The CLI and the MCP
server** unwrap it and map once ([pp-cli → Output and exit codes](../pp-cli/SKILL.md#output-and-exit-codes),
[pp-mcp → Tool registration and least privilege](../pp-mcp/SKILL.md#tool-registration-and-least-privilege)).

## Gate — then read the diff

**Gate:** [pp-workflow → Definition of done](../pp-workflow/SKILL.md#definition-of-done); the
mandatory tiers this skill's paths trigger are in [Test tiers](../pp-workflow/SKILL.md#test-tiers).

**Then read the diff**, each item yes or no; the greps run from the repo root and expect no output
unless noted: verify before enqueue, `200` only after it, with its test ·
pp-general [review greps](../pp-general/references/boundaries.md#review-greps) 5, 6, 8 and 9 · no `process.env`, pool or client built outside `main.ts` ·
each `db.transaction(` passes `tx` down and holds no Resend, SQS, invoke or `fetch` call (the
dispatcher's batch excepted) · every side effect an outbox row ·
every insert on a key in [Idempotency keys](../../../.ai/data-modeling.md#idempotency-keys) uses `ON CONFLICT` on it (`git grep -n "onConflict" -- packages/db`, read each) ·
the worker returns `batchItemFailures` built from per-message results · idempotency proven by an
integration test against real Postgres · `git grep -niE "redis|bullmq|ioredis" -- packages apps` ·
no projection input read from `received_at` (`git grep -nE "receivedAt|received_at" -- 'packages/core/**/*.projection.ts' 'packages/core/**/*.rule.ts'`) ·
every route through `createRoute` (`git grep -nE "\.(get|post|put|patch|delete)\(['\"]/" -- packages/api`) ·
every response built by a `.mapper.ts` · the request-id middleware sets no response header ·
the generated SDK files changed only with `pnpm openapi:export` · no `throw` for an API error in
`packages/sdk` · every new failure path mapped to a registered `code` · masks only on every surface ·
the api-contract entry and its Ask-first approval for any contract change.
