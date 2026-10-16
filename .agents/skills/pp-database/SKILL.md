---
name: pp-database
description: Ledger's database conventions — the Drizzle `pgTable` schema in `packages/db` (one table per file, constraints and indexes in the table), repositories as executor-first functions with the caller's transaction passed down, `drizzle-kit` migrations that are expand/contract and never edited after push, the runtime role's per-table grants, indexes that serve a named query, `jsonb` in its three allowed places parsed with Zod, the connection-error classifier behind `database_unavailable`, and the new-table recipe. Load it before writing or reviewing anything under `packages/db/**`, and whenever a change adds or alters a table, column, closed set, constraint, index, `jsonb` column, grant, migration or seed — "add a table", "add a column", "store X", "write a repository", "write a migration", "drop this column", "why permission denied", "index this query". Load it alongside pp-workflow and pp-general, not instead of them. When it and a linked doc disagree, the doc wins and this file is fixed.
---

# pp-database — schema, repositories, migrations

A pushed migration is never edited, so a wrong key, a missing grant or a stray cascade costs a
forward migration against live rows. What a table means is [data-modeling.md](../../../.ai/data-modeling.md);
once `packages/db` exists, its schema owns columns, types and indexes
([split rule](../../../.ai/data-modeling.md#how-to-use)). This skill owns the mechanics between them.

**Owns:** schema files · repositories and the `Executor` type · migrations (generated, custom,
contract step) · the runtime role's grants · indexes · `jsonb` governance · the connection-error
classifier · the new-table recipe.

**Does not own:** a table's intent, keys, PII class and columns → data-modeling.md and the slice
that lands it · who opens a transaction and what runs in it → [pp-backend](../pp-backend/SKILL.md) ·
the harness → [pp-testing → Postgres harness](../pp-testing/SKILL.md#postgres-harness) · the deploy
command → [pp-infra](../pp-infra/SKILL.md) · names, the error class, logging →
[pp-general](../pp-general/SKILL.md). Precedence: [pp-general → Precedence](../pp-general/SKILL.md#precedence).

| Reference | Open when |
| --- | --- |
| [new-table-recipe.md](references/new-table-recipe.md) | Adding a table or a column: the ordered recipe and the pre-commit checklist |
| [schema-and-repositories.md](references/schema-and-repositories.md) | Writing a schema file, a repository, a lock, or the connection-error classifier |
| [migrations-and-grants.md](references/migrations-and-grants.md) | Generating or reviewing a migration; a grant; an expand or contract step; a closed-set change |
| [indexes-and-jsonb.md](references/indexes-and-jsonb.md) | Adding an index or a list read; reading or writing a `jsonb` column |

## New-table recipe

The rule is [data-modeling.md → Modeling something new](../../../.ai/data-modeling.md#modeling-something-new):
idempotency key first, classify the table, apply the
[base fields](../../../.ai/data-modeling.md#base-fields--the-checklist-for-every-new-model) and
[conventions](../../../.ai/data-modeling.md#modeling-conventions-canonical), check the
[anti-patterns](../../../.ai/data-modeling.md#anti-patterns-must-not), classify each PII column
([PII & retention](../../../.ai/data-modeling.md#pii--retention)), add the Model index row. The
order of edits, in one change:

1. The data-modeling entry, if the table is not yet in the [Model index](../../../.ai/data-modeling.md#model-index).
2. `packages/db/src/schema/<kebab>.ts` at the entry's `_Schema:_` path, exported from `src/index.ts`.
3. `drizzle-kit generate`, then read the SQL it wrote.
4. A custom migration granting the runtime role that table's DML.
5. The repository, then the integration tests its keys and grants owe.
6. The `Modeled` tick, and the doc corrected where a column now disagrees.

Mechanics and the checklist: [new-table-recipe.md](references/new-table-recipe.md).

## Always

- One table per schema file; every `CHECK`, unique constraint and index declared in the `pgTable`,
  so drizzle-kit owns the DDL ([schema files](references/schema-and-repositories.md#schema-files)).
- Every database access through a `packages/db` repository ([Module boundaries](../../../AGENTS.md#module-boundaries)):
  exported functions, `Executor` first, no state; they load and write rows, and projection logic
  stays in core ([repositories](references/schema-and-repositories.md#repositories)).
- The caller opens the transaction and passes `tx` down; READ COMMITTED, ADR-004's lock order,
  transaction-scoped locks only ([ADR-004](../../../.ai/architecture.md#adr-004--immutable-ledger-keyed-on-svix_id-one-transaction-per-message)).
- Migrations generated from the schema, read and committed with it; expand/contract; run by the
  deploy command with the direct URL, before the code that needs them
  ([ADR-018](../../../.ai/architecture.md#adr-018--migrations-run-from-the-deploy-command-before-the-code-that-needs-them)).
- A table-creating change grants the runtime role that table's narrowest DML, in the same change
  ([integrations.md → Decision — Neon](../../../.ai/integrations.md#decision--neon), [grants](references/migrations-and-grants.md#grants)).
- Every idempotency key behind a primary key or unique constraint, proven by a duplicate-insert
  integration test ([Idempotency keys](../../../.ai/data-modeling.md#idempotency-keys)).
- Closed sets as `text` + `CHECK` with the core Zod enum's members; none on `webhook_events.type`;
  identity `bigint` surrogates; `timestamptz` ([conventions](../../../.ai/data-modeling.md#modeling-conventions-canonical)).
- An address as `address_hash` plus `address_masked`, both from core ([PII & retention](../../../.ai/data-modeling.md#pii--retention)).
- `jsonb` only in its three places, parsed with its Zod schema on read, the payload stored as
  received ([jsonb](references/indexes-and-jsonb.md#jsonb)).
- Each index serves a query named in the same change ([indexes](references/indexes-and-jsonb.md#indexes)).
- Connection-class errors classified once, in `packages/db`, into the `database_unavailable`
  subclass ([classifier](references/schema-and-repositories.md#connection-error-classification)).

## Case-by-case

| Do this | Deciding test |
| --- | --- |
| Add an index | A query in the diff filters or orders on its leading columns, and no key or index serves it |
| Make an index partial | Every query it serves carries the same predicate over a small slice (the outbox sweep) |
| Make a unique key partial | Uniqueness holds for a subset of rows only (`api_tokens.bootstrap`) |
| Write a custom migration | The change needs SQL `drizzle-kit generate` cannot emit: a grant, or a statement with no schema counterpart |
| Mark a migration `-- contract-step:` | It contains `DROP`, `RENAME`, `ALTER … TYPE` or `SET NOT NULL` (the slice 2 lint's list). A true contract step also needs the code deployed before it to no longer touch what it removes; a same-name replace (a closed set's `CHECK`, an index) or `DROP NOT NULL` starts its reason with `replace:` and ships with its code |
| Add a `NOT NULL` column to a table with rows | It has a default; otherwise nullable now, backfill, `SET NOT NULL` as a later contract step |
| Add a repository function | A command or reader in the same diff calls it |

## Never

Each entry names its alternative. The full modeling list:
[data-modeling.md → Anti-patterns](../../../.ai/data-modeling.md#anti-patterns-must-not).

- **Editing a pushed migration** → a new forward migration, Ask-first ([Permissions](../../../AGENTS.md#permissions)).
- **A `pgEnum`** → `text` + `CHECK`, mirrored by a core Zod enum ([conventions](../../../.ai/data-modeling.md#modeling-conventions-canonical)).
- **Business logic in a trigger or function (stored procedure)** → `packages/core`, called by a
  command; no trigger at all, `updated_at` included ([ADR-013](../../../.ai/architecture.md#adr-013--pure-core-and-local-mode)).
- **A view used as a contract** → a repository read plus an explicit mapper; the contract is
  api-contract.md ([ADR-011](../../../.ai/architecture.md#adr-011--one-contract-many-surfaces)).
- **A cascade or foreign key onto the ledger or a projection** → no foreign key; projections reference
  nothing and are rebuilt ([Immutable ledger](../../../.ai/data-modeling.md#immutable-ledger)).
- **Deduplicating on anything but `svix_id`** → its primary key, `ON CONFLICT DO NOTHING` ([ADR-004](../../../.ai/architecture.md#adr-004--immutable-ledger-keyed-on-svix_id-one-transaction-per-message)).
- **Updating or deleting a `webhook_events` row outside the retention job** → append; redaction is
  that job's alone ([ADR-014](../../../.ai/architecture.md#adr-014--raw-payload-retention-and-redaction)).
- **Patching a projection, or ordering its input by `received_at`, insertion order or `id`** → load
  the key's event set, fold it in core ([ADR-003](../../../.ai/architecture.md#adr-003--projection-is-a-pure-function-of-the-event-set)).
- **A projection column with no source in the event set** → derive it, or drop it.
- **A uniqueness rule enforced by reading first** → the constraint decides; `RETURNING` reports it.
- **A stateful repository class, a `BaseRepository` or a generic repository** → executor-first
  functions ([pp-general → Rejected patterns](../pp-general/references/adding-things.md#rejected-patterns)).
- **A transaction opened inside a repository, or an ambient one** → the caller's `tx`, passed explicitly.
- **Session-level SQL** (session advisory lock, `SET`, `LISTEN`/`NOTIFY`, SQL `PREPARE`) →
  `pg_advisory_xact_lock` or a row lock in one transaction ([integrations.md](../../../.ai/integrations.md#decision--neon)).
- **`sql.raw` with a runtime value** → the `sql` template, which binds parameters.
- **`jsonb` for anything a query filters on or a projection reads** → a typed column.
- **`$type<T>()` or `as` on a `jsonb` read, or the Zod output stored as `payload`** → parse on read;
  store the body as parsed from the request ([jsonb](references/indexes-and-jsonb.md#jsonb)).
- **A raw address, subject or display name outside `webhook_events.payload`, an unkeyed hash, or a
  plaintext token** → keyed hash plus mask; the token's hash ([PII & retention](../../../.ai/data-modeling.md#pii--retention)).
- **A `tenant_id`, `deleted_at`, secret or real recipient address in a table, seed, fixture or
  migration** → one installation, no soft delete, Resend test addresses.
- **A seed that writes ledger or projection rows** → events through ingest (`pnpm sim`).
- **`DELETE` on `webhook_events`, DDL or `ALL` for the runtime role** → the narrowest DML per table.
- **A migration run from a runtime Lambda or over the pooled URL** → the deploy command, direct URL.
- **A speculative index** → none until a query in the diff needs it.
- **A connection error classified outside `packages/db`, or by a second list** → the one classifier.
- **A driver error's `message`, `detail` or `params` logged or returned** → its name and SQLSTATE
  `code` ([pp-general → Errors](../pp-general/references/errors.md#catching)).

## Gate — then read the diff

**Gate.** Until slice 0 lands `pnpm verify`: lint and the `packages/db` integration tests for what
was touched, each named in the report (no Docker means skipped, reported as skipped). After it:
`pnpm verify` exits 0 with every stage run ([pp-workflow → Definition of done](../pp-workflow/SKILL.md#definition-of-done)).

**Then read the diff:** each new table's file at its `_Schema:_` path, exported from `src/index.ts` ·
base fields present · every column's nullability decided · every closed set a named `check()` with
the core tuple's members, no `pgEnum(` · a key or unique constraint behind every idempotency key,
with its duplicate-insert test · each index serving a query named in the diff · no `.references(`
or `cascade` reaching `webhook_events` or a projection · **the runtime role's grants on every new
table** (`GRANT … ON <table> … TO`, the narrowest DML, never `DELETE` on `webhook_events`) · a
migration for every schema change, generated, and none modified
(`git diff --name-status main -- 'packages/db/drizzle/*.sql'` shows only `A`) · `DROP`,
`RENAME`, `ALTER … TYPE` or `SET NOT NULL` only under a `-- contract-step:` first line · `jsonb`
only in its three places, no `$type<` and no `as` on a row field · no `sql.raw(` fed a variable · no
session-level SQL · the `Modeled` box ticked ([Definition of done](../pp-workflow/SKILL.md#definition-of-done)).
