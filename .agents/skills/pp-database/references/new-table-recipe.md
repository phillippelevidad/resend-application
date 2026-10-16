# New-table recipe

The procedure for landing a table, in order. The rule each step applies is
[data-modeling.md → Modeling something new](../../../../.ai/data-modeling.md#modeling-something-new);
the columns come from the table's data-modeling entry and the slice that lands it, never from this
file. Each step exists because skipping it produces a defect that costs a forward migration:
a missing key duplicates under concurrency, a missing grant passes as the owner and fails as the
runtime role, a stray foreign key breaks the rebuild.

## 0 — Is it already modeled?

1. Find the table in the [Model index](../../../../.ai/data-modeling.md#model-index) and read its
   `###` entry: kind, mutability, idempotency key, PII class, indexes, `_Schema:_` path, evidence.
2. Not there? Then the data-modeling entry comes first, in the same change: walk
   [Modeling something new](../../../../.ai/data-modeling.md#modeling-something-new) steps 1–5 and add
   the index row (`[ ]`) and the `###` entry. **No key, no table**, unless at-least-once is
   deliberate and a key downstream absorbs it.
3. A table outside the active slice's `Ships` list is out of scope
   ([pp-workflow → Slice scoping](../../pp-workflow/SKILL.md#slice-scoping)).

## 1 — The schema file

`packages/db/src/schema/<kebab>.ts`, at the entry's `_Schema:_` path, exported from `src/index.ts`
([schema files](schema-and-repositories.md#schema-files)). In this order:

1. The key: the natural primary key (`svix_id`, `email_id`, `address_hash`), or an identity `bigint`
   `id` when there is none ([base fields](../../../../.ai/data-modeling.md#base-fields--the-checklist-for-every-new-model)).
2. The base fields by their "Include when" rule: `created_at` or `received_at` always; `updated_at`
   on mutable rows only, never on `webhook_events`; `event_created_at` on a row derived from one
   event; `status` where there is a lifecycle; `dedupe_key` where processing causes an external
   effect; `address_hash` + `address_masked` in place of any address.
3. The load-bearing columns from the entry, each with its nullability decided.
4. In the third argument: every `check()` (closed sets, from the core tuple), every unique
   constraint (each idempotency key not already the primary key), every index the entry names,
   each beside the query it serves ([indexes](indexes-and-jsonb.md#indexes)).

The mechanics, on a table that does not exist:

```ts
// packages/db/src/schema/sample-runs.ts — illustration only; no such table is planned
import { sql } from 'drizzle-orm';
import { bigint, check, pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import { sampleRunStatuses } from '@ledger/core'; // ['pending', 'done'] as const

export const sampleRuns = pgTable(
  'sample_runs',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    status: text('status', { enum: sampleRunStatuses }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [check('sample_runs_status_check', sql`${t.status} in ('pending', 'done')`)],
);
```

No `.references(`, no `pgEnum`, no `tenant_id`, no `deleted_at`
([Anti-patterns](../../../../.ai/data-modeling.md#anti-patterns-must-not)).

## 2 — Generate and read the migration

`drizzle-kit generate --name create-<table>` in `packages/db`, then read the SQL: one
`CREATE TABLE`, every constraint and index named as declared, no `DROP`, no `RENAME`
([generating](migrations-and-grants.md#generating)). A new table is pure expand, so it carries no
contract-step marker.

## 3 — Grant the runtime role

`drizzle-kit generate --custom --name grant-<table>`, then the narrowest DML the table's mutability
needs, never `DELETE` on `webhook_events` ([grants](migrations-and-grants.md#grants)). The
`wf-after-apply-check` script reads every `CREATE TABLE` in the change and looks for a
`GRANT … ON <table> … TO` beside it.

## 4 — The repository

`packages/db/src/<kebab-table>.repository.ts`: executor-first functions, only those a command or
reader in the same diff calls; `ON CONFLICT` for every idempotency key; every `jsonb` read parsed
([repositories](schema-and-repositories.md#repositories)).

## 5 — The tests the table owes

Integration tests against real Postgres, connected as the runtime role through the harness
([pp-testing → Postgres harness](../../pp-testing/SKILL.md#postgres-harness)); the tier is
[pp-workflow → Test tiers](../../pp-workflow/SKILL.md#test-tiers)':

- **Each idempotency key:** inserting the same key twice leaves one row, and the second call
  reports a duplicate ([Idempotency keys](../../../../.ai/data-modeling.md#idempotency-keys)).
- **Each closed set:** every member of the core tuple inserts; a value outside it fails with
  SQLSTATE `23514`.
- **Grants:** the repository's writes succeed as the runtime role. A write the grants should refuse
  (`DELETE` on `webhook_events`) gets `permission denied` (slice 2 owns that test).
- **The entry's own evidence lines**, in the slice they name.

## 6 — Docs and the gate

- Tick `Modeled` in the [Model index](../../../../.ai/data-modeling.md#model-index) in this change,
  never before ([pp-workflow → Definition of done](../../pp-workflow/SKILL.md#definition-of-done)).
- Where the schema and the entry now disagree on a column, the schema wins and the entry is
  corrected; where they disagree on intent, the schema is the bug
  ([split rule](../../../../.ai/data-modeling.md#how-to-use)).
- A new root script for the migration commands gets its [Commands](../../../../AGENTS.md#commands)
  line.
- Run the gate and read the diff ([SKILL.md → Gate](../SKILL.md#gate--then-read-the-diff)).

## Adding a column

Steps 1–6 on the existing table, plus [expand and contract](migrations-and-grants.md#expand-and-contract):
a new column on a table with rows is nullable or has a default; `NOT NULL` without a default is a
later contract step. A new column needs no new grant (table-level grants cover it), except
`webhook_events`, where the retention job's grant is column-level.

## Pre-commit checklist

- [ ] The table's data-modeling entry exists, and the table is in the active slice
- [ ] The idempotency key is a primary key or unique constraint, in the migration
- [ ] Base fields by their "Include when" rule; `updated_at` only on mutable rows
- [ ] Every column's nullability decided; explicit snake_case column names
- [ ] Closed sets are `text` + named `check()` from the core tuple; no `pgEnum`; no `CHECK` on `webhook_events.type`
- [ ] Addresses only as `address_hash` + `address_masked`; no raw PII outside `webhook_events.payload`
- [ ] `jsonb` only in its three places, each with its Zod schema
- [ ] Each index named and serving a query in this diff
- [ ] No foreign key, no cascade, no trigger, no view
- [ ] The migration is generated, read, and expand-only; no existing migration modified
- [ ] A custom migration grants the runtime role the narrowest DML; no `DELETE` on `webhook_events`
- [ ] Duplicate-insert and closed-set integration tests pass as the runtime role
- [ ] `Modeled` ticked; any column drift between the schema and the entry corrected in the doc
