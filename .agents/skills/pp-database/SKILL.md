---
name: pp-database
description: Ledger's database conventions as a review checklist — Drizzle `pgTable` schema in `packages/db`, expand/contract migrations, base fields, idempotency keys behind unique constraints, `text` + `CHECK` instead of `pgEnum`, keyed hashes and masks instead of raw PII, projections recomputed from the event set. A stub that points at data-modeling.md and the ADRs instead of restating them. Load it whenever a change touches a table, column, index, constraint, `jsonb` column, migration or seed, and alongside any `wf-*` gate reviewing one. When it and a linked doc disagree, the doc wins and this file is fixed.
---

# pp-database — schema and migrations

**Stub.** Every entry links the rule that binds it. [data-modeling.md](../../../.ai/data-modeling.md)
owns the principles and per-table intent; the Drizzle schema in `packages/db` owns columns, types
and indexes. When this file and a linked doc disagree, the doc wins: fix this file in the same change.

## New-table recipe

[data-modeling.md → Modeling something new](../../../.ai/data-modeling.md#modeling-something-new) is
the checklist a new table either satisfies or does not: idempotency key first, classify the table,
[base fields](../../../.ai/data-modeling.md#base-fields--the-checklist-for-every-new-model),
[conventions](../../../.ai/data-modeling.md#modeling-conventions-canonical),
[anti-patterns](../../../.ai/data-modeling.md#anti-patterns-must-not),
[PII classification](../../../.ai/data-modeling.md#pii--retention), Model index row.

## Always

- Schema as Drizzle `pgTable` in `packages/db`; every database access through its repositories
  ([root AGENTS.md → Module boundaries](../../../AGENTS.md#module-boundaries)).
- Migrations expand/contract, run by the deploy command before the code that needs them
  ([ADR-018](../../../.ai/architecture.md#adr-018--migrations-run-from-the-deploy-command-before-the-code-that-needs-them)).
- Every idempotency key (`svix_id`, the outbox `dedupe_key`) backed by a primary key or unique
  constraint, proven by a duplicate-insert integration test
  ([Idempotency keys](../../../.ai/data-modeling.md#idempotency-keys)).
- Closed sets as `text` + `CHECK`, mirrored by a Zod enum in `packages/core`; surrogate keys as
  identity `bigint` ([conventions](../../../.ai/data-modeling.md#modeling-conventions-canonical)).
- An address stored as `address_hash` (keyed HMAC) plus `address_masked`
  ([PII & retention](../../../.ai/data-modeling.md#pii--retention)).
- All SQL pooler-safe ([integrations.md → Decision — Neon](../../../.ai/integrations.md#decision--neon)).

## Never

Each entry names its alternative. The full list is
[data-modeling.md → Anti-patterns](../../../.ai/data-modeling.md#anti-patterns-must-not).

- Editing an applied migration. Instead: a new forward migration, Ask-first ([Permissions](../../../AGENTS.md#permissions)).
- A `pgEnum`. Instead: `text` + `CHECK` ([conventions](../../../.ai/data-modeling.md#modeling-conventions-canonical)).
- Deduplicating on anything but `svix_id`. Instead: the `webhook_events` primary key ([ADR-004](../../../.ai/architecture.md#adr-004--immutable-ledger-keyed-on-svix_id-one-transaction-per-message)).
- Updating or deleting a `webhook_events` row outside the retention job. Instead: append; redaction is the retention job's alone ([ADR-014](../../../.ai/architecture.md#adr-014--raw-payload-retention-and-redaction)).
- Patching a projection incrementally, or ordering its input by `received_at`, insertion order or `id`. Instead: recompute it from the event set ([ADR-003](../../../.ai/architecture.md#adr-003--projection-is-a-pure-function-of-the-event-set)).
- A projection column with no source in the event set. Instead: derive it, or drop it.
- A uniqueness rule enforced by reading first. Instead: the constraint decides.
- Business logic in a trigger or procedure, or a view used as an API. Instead: `packages/core` and the read API ([ADR-011](../../../.ai/architecture.md#adr-011--one-contract-many-surfaces)).
- Foreign keys or cascades between `webhook_events` and projections. Instead: projections are rebuildable and reference nothing.
- `jsonb` for anything a query filters on or a projection reads. Instead: a typed column; `jsonb` only for the raw payload, the outbox payload and the local queue envelope.
- A raw address, subject or display name outside `webhook_events.payload`, an unkeyed hash, or a plaintext token. Instead: keyed hash plus mask; tokens hashed ([PII & retention](../../../.ai/data-modeling.md#pii--retention)).
- A `tenant_id`, `deleted_at`, secret or real recipient address in any table, seed or fixture. Instead: one installation; no soft delete; Resend test addresses.

## Gate — then read the diff

Base fields present · a unique constraint behind every idempotency key · nullability and every
`CHECK` set stated · each index serving a named query · no cascade onto the ledger · the DML-only
runtime role's grants on every new table, never `DELETE` on `webhook_events`
([integrations.md → Runtime role](../../../.ai/integrations.md#decision--neon)) · a migration for every schema change, and none edited · the
`Modeled` box ticked ([pp-workflow → Definition of done](../pp-workflow/SKILL.md#definition-of-done)).
