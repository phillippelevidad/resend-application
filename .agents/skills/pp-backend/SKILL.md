---
name: pp-backend
description: Ledger's backend and surface conventions as a review checklist — verify then enqueue, one transaction per message, projections from the pure core, outbox for every side effect, idempotency on `svix_id` and `dedupe_key`, `resend-client` as the sole Resend caller, module boundaries, and the SDK / CLI / MCP surfaces with one error shape, masks only and MCP least privilege. A stub that points at the ADRs and api-contract.md instead of restating them. Load it whenever a change touches anything under `apps/` or `packages/` — a Lambda handler, projection, repository, port, outbox reaction, reconcile or redrive path, CLI command, MCP tool or SDK method — and alongside any `wf-*` gate reviewing one. When it and a linked doc disagree, the doc wins and this file is fixed.
---

# pp-backend — handlers, reactions and surfaces

**Stub.** Every entry links the rule that binds it. When this file and a linked doc disagree, the
doc wins: fix this file in the same change. Schema rules are in [pp-database](../pp-database/SKILL.md).

## Always

- Verify the Svix signature (every active secret, timestamp tolerance) before enqueueing
  ([ADR-001](../../../.ai/architecture.md#adr-001--verify-then-enqueue),
  [ADR-009](../../../.ai/architecture.md#adr-009--multi-secret-verification-and-timestamp-tolerance)).
- The ledger insert, the projection upsert and the outbox row in one transaction per message, with
  the transactional client passed down ([ADR-004](../../../.ai/architecture.md#adr-004--immutable-ledger-keyed-on-svix_id-one-transaction-per-message),
  [ADR-006](../../../.ai/architecture.md#adr-006--transactional-outbox-for-reactions)).
- Every handler idempotent on `svix_id` or the outbox `dedupe_key`: delivery is at-least-once
  ([ADR-002](../../../.ai/architecture.md#adr-002--sqs-standard-not-fifo)).
- Projections computed by pure `packages/core` functions over the event set
  ([ADR-003](../../../.ai/architecture.md#adr-003--projection-is-a-pure-function-of-the-event-set),
  [ADR-013](../../../.ai/architecture.md#adr-013--pure-core-and-local-mode)).
- Partial batch failure and bounded concurrency on the worker; poison messages to the DLQ
  ([ADR-008](../../../.ai/architecture.md#adr-008--backpressure-bounded-concurrency-partial-batch-failure-dlq));
  on a database outage the worker pauses its own event source
  ([ADR-015](../../../.ai/architecture.md#adr-015--the-worker-pauses-its-own-event-source-on-a-database-outage)).
- Recovery by id diff, replayed through ingest ([ADR-007](../../../.ai/architecture.md#adr-007--recovery-by-id-diff-and-replay-through-ingest)).
- JSON logs carrying `svix_id`, `email_id` and `type` only ([PII & retention](../../../.ai/data-modeling.md#pii--retention)).

## Never

Each entry names its alternative.

- A Resend API call outside `packages/resend-client`. Instead: its port, which owns the shared
  10 req/s budget ([ADR-012](../../../.ai/architecture.md#adr-012--resend-client-is-the-sole-resend-api-caller)).
- An app importing from another app, or I/O in `packages/core`. Instead: a shared package or a port
  ([Module boundaries](../../../AGENTS.md#module-boundaries)).
- A side effect inside the worker transaction. Instead: an outbox row, delivered by the dispatcher
  ([ADR-006](../../../.ai/architecture.md#adr-006--transactional-outbox-for-reactions),
  [ADR-017](../../../.ai/architecture.md#adr-017--the-dispatcher-is-triggered-after-commit-plus-an-hourly-sweep)).
- State order taken from transport (arrival, SQS order, FIFO). Instead: the projection orders by
  the event set; Resend promises no delivery order ([ADR-002](../../../.ai/architecture.md#adr-002--sqs-standard-not-fifo)).
- A second store, cache or queue standing in as source of truth. Instead: Postgres only
  ([ADR-005](../../../.ai/architecture.md#adr-005--postgres-only)).
- A read-then-write guard (count first, then insert). Instead: the constraint decides.
- An unverified payload reaching the queue, or a `2xx` before the enqueue succeeded. Instead:
  verify, enqueue, then acknowledge ([ADR-001](../../../.ai/architecture.md#adr-001--verify-then-enqueue)).
- A raw address, subject or body in a log line, outbox payload or `last_error`. Instead: ids,
  hashes and masks ([PII & retention](../../../.ai/data-modeling.md#pii--retention)).

## Surfaces — SDK, CLI, MCP

[api-contract.md → Conventions](../../../.ai/api-contract.md#conventions) binds every surface.

- The CLI and the MCP server are built on `packages/sdk`, never on the database; they present and
  orchestrate, the read API decides ([ADR-011](../../../.ai/architecture.md#adr-011--one-contract-many-surfaces)).
- Every operation is registered in [api-contract.md](../../../.ai/api-contract.md); adding or
  changing one is Ask-first.
- One error shape everywhere, codes only from the [registry](../../../.ai/api-contract.md#error-codes);
  each failure maps to a `code` with a written `message` and `hint`. CLI exit codes `0` / `1` / `2`
  and `--json` as the contract states.
- Masks only, never raw PII, on every surface, MCP tool output included.
- The caller's scope resolved server-side from its bearer token; operate MCP tools registered only
  with an `operate` token **and** `--enable-operate`.
- Tokens from `LEDGER_TOKEN`, never a `--token` flag; addresses only in request bodies.
- The SDK is types generated from the OpenAPI document plus a thin hand-written client (ADR-011).

## Gate — then read the diff

Verify before enqueue · one transaction with the transactional client passed down · every side
effect an outbox row · idempotency proven by an integration test against real Postgres · no Resend
call outside `resend-client` · no cross-app import · every new failure path mapped to a registered
`code` · masks only on every surface · the [api-contract.md](../../../.ai/api-contract.md) entry and
its Ask-first approval for any contract change.
