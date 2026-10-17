# Migrations and grants

The rule is [ADR-018](../../../../.ai/architecture.md#adr-018--migrations-run-from-the-deploy-command-before-the-code-that-needs-them):
drizzle-kit migrations, expand/contract only, run by the deploy command with the direct URL before
`cdk deploy` ships the code that needs them. The runtime role and its order are
[integrations.md → Decision — Neon](../../../../.ai/integrations.md#decision--neon). This file is the
mechanics.

## Generating

- **The schema is the source.** Edit `packages/db/src/schema/<kebab>.ts`, then run
  `pnpm db:generate --name <what-it-does>` from the root: it runs `drizzle-kit generate` in
  `packages/db` with the flags passed through ([Commands](../../../../AGENTS.md#commands)).
- **Read the SQL before committing it.** Check it creates exactly what the schema says: every
  `CHECK`, unique constraint and index named, nullability as decided, no `DROP` or `RENAME` you did
  not mean. drizzle-kit can read a rename as drop-and-add and prompts for it. Under expand/contract a
  column is never removed and added in one migration (a rename is an add now and a drop a deploy
  later, [below](#expand-and-contract)), so a prompt means two steps were combined: split them,
  never answer it with a rename.
- **Schema and migration land in one commit.** A schema change without its migration is drift
  (`wf-after-apply-check` blocks it), and a migration without its schema change is overwritten by
  the next `generate`.
- **Frozen once merged to `main` or applied to a kept database.** A frozen migration has run
  somewhere; the fix is a new forward migration, and changing a frozen one is Ask-first
  ([Permissions](../../../../AGENTS.md#permissions)). Before that (pushed to a slice branch, applied
  only to a throwaway or Testcontainers database), delete it and regenerate freely.
- **No down migrations.** Expand/contract is forward-only.

## Custom migrations

For SQL `generate` cannot emit: grants, and any statement with no schema counterpart.

```sh
pnpm db:generate --custom --name grant-<table>
```

`--custom` writes an empty migration file to fill in by hand
([custom migrations](https://orm.drizzle.team/docs/kit-custom-migrations)), with its journal entry
and a snapshot equal to the previous one; `migrate()` applies it in sequence with the generated
ones. A custom migration never creates or alters a table
or column: that is the schema's, or the next `generate` diffs against a shape it never saw.

## Expand and contract

Every migration is safe to run **before** the code that needs it and **under** the code deployed
before it, because the deploy command migrates first and the previous Lambdas keep running.

| Change | Expand (this deploy) | Contract (a later deploy) |
| --- | --- | --- |
| New table, column or index; a constraint on a new column | Add it; a new column is nullable or has a default | — |
| New `CHECK` or unique constraint on an existing column | Ship the code that satisfies it. The diff review catches this row: it narrows what the previous deploy may write (`23514`, `23505`) and the lint sees no `DROP` | Add the constraint, which validates every existing row |
| `NOT NULL` on an existing column | Add it nullable; backfill (the backfill fails loudly on a row it cannot fill, never invents a value) | `SET NOT NULL`, once every row is filled and every writer sets it |
| Rename a column | Add the new column, write both, backfill | Drop the old one, once no deployed code reads it |
| Drop a column or table | Stop writing it. A `NOT NULL` column with no default gets `DROP NOT NULL` (marked `replace:`: the lint reads `DROP`). Every query on the table names its columns, so no deployed query selects it | Remove it from the schema and generate the `DROP`, a deploy later |
| Change a column's type | Add a column of the new type, as a rename | Drop the old one |

The contract step ships only after a deploy whose code no longer touches what it removes; the
deploy command enforces it through the marker's SHA ([below](#the-contract-step-marker)). A
contract step on `webhook_events` other than the retention job's (slice 7) contradicts the
[Immutable ledger](../../../../.ai/data-modeling.md#immutable-ledger) and needs a superseding ADR.

## The contract-step marker

ADR-018's DDL lint (slice 2) fails a migration containing `DROP`, `RENAME`, `ALTER … TYPE` or
`SET NOT NULL` unless it is marked. The mark is the file's first line:

```sql
-- contract-step: <commit SHA>                     -- a true contract step
-- contract-step: replace: <name>, <widen|narrow>  -- a same-name replace or DROP NOT NULL
```

- **`<commit SHA>`** is the full SHA of the commit that stopped using the object (the expand
  step's code change). The deploy command refuses, before migrating, any pending migration whose
  SHA is not an ancestor of the stack's `DeployedCommit` output (`git merge-base --is-ancestor`; skipped when no app stack exists yet),
  so a `DROP` never runs under Lambdas that still read the object
  ([ADR-018](../../../../.ai/architecture.md#adr-018--migrations-run-from-the-deploy-command-before-the-code-that-needs-them);
  the check is [pp-infra](../../pp-infra/SKILL.md)'s). Two commits in one deploy therefore take two
  deploys.
- **`replace:`** ships with its code ([closed-set changes](#closed-set-changes)); it carries no SHA
  and the deploy check skips it.

A contract step is **generated** like any schema change, so drizzle-kit's snapshot follows the
schema; the marker line is added at the top of the generated file before it is frozen. That is the
one hand edit a generated migration takes.

## Closed-set changes

A closed set is `text` + `CHECK` ([conventions](../../../../.ai/data-modeling.md#modeling-conventions-canonical)),
so changing its members replaces the constraint in one migration: drop the old `CHECK`, add the
new one under the same name. That contains `DROP`, so it carries the marker with a `replace:`
reason saying which way it goes:

- **Widen** (add a member): safe at any deploy. The migration runs before the code that writes the
  new value, so the core Zod enum and the `CHECK` gain the member in the same change.
- **Narrow** (remove a member): a contract step. First a deploy whose code no longer writes the
  value and rows no longer hold it; `ADD CONSTRAINT … CHECK` validates existing rows, so a leftover
  row fails the migration loudly instead of passing silently.

What `generate` emits for a changed `check()`: drizzle-kit 0.31.11 writes a same-name
`ALTER TABLE … DROP CONSTRAINT`, then `ALTER TABLE … ADD CONSTRAINT … CHECK`, in one migration
(observed in slice 1 by removing `bounced` from `email_state_status_check`); read the SQL anyway.
Safe either way: the closed-set integration tests insert every member of the core tuple, and that
mutation failed [email-state.repository.int.test.ts](../../../../packages/db/src/email-state.repository.int.test.ts).

## Grants

Order, through the direct URL (S-05, [integrations.md → Decision — Neon](../../../../.ai/integrations.md#decision--neon)):
the deploy command ensures the runtime role exists, then migrates, then deploys. The local setup
command and the Testcontainers harness follow the same order
([pp-testing → Postgres harness](../../pp-testing/SKILL.md#postgres-harness)).

- **Every change that creates a table grants that table's DML to the runtime role**, in a custom
  migration of the same change, after the migration that creates it:
  ```sql
  GRANT SELECT, INSERT ON webhook_events TO <runtime role>;
  ```
- **The role is named by one constant** in `packages/db`, shared with the deploy command
  (integrations.md): `RUNTIME_ROLE = 'ledger_runtime'` in `prepare-database.ts`. SQL cannot import
  it, so the migration spells the same literal; the harness connects as the role the constant
  names, so a mismatch fails as `permission denied`.
- **The narrowest DML each table needs**, from its Mutability in the
  [Model index](../../../../.ai/data-modeling.md#model-index):

  | Mutability | Grant |
  | --- | --- |
  | Append-only (`webhook_events`) | `SELECT, INSERT`. Never `UPDATE` or `DELETE`; the retention job adds a column-level `UPDATE` on the columns it rewrites (slice 7) |
  | Recomputed, status transitions, set-once (projections, `outbox`, `api_tokens`, `reconcile_runs`) | `SELECT, INSERT, UPDATE` |
  | Claimed and deleted (`local_queue_messages`) | `SELECT, INSERT, UPDATE, DELETE` |

  The slice that lands the table confirms its row against the table's entry.
- **Never** `ALL`, DDL, `TRUNCATE`, a grant on the migrations table, or `ALTER DEFAULT PRIVILEGES`:
  per-table grants keep each table's privileges visible in the migration that created it.
- **The role's server-side timeouts.** The role-ensure step also runs `ALTER ROLE <runtime role>
  SET idle_in_transaction_session_timeout = …` and `SET lock_timeout = …`, both below the worker
  timeout (values: the slice 2 pre-proposal's), and re-runs them on every deploy. They bound a
  Lambda frozen or killed mid-transaction, whose row and advisory locks would otherwise hold
  server-side and dead-letter the workers queued behind them; the client timeouts cannot
  ([connection](schema-and-repositories.md#connection)). Role-level settings, not session `SET`.
  Whether Neon's pooler applies them is PG-U06, MUST be settled in slice 2
  ([integrations.md → \[Unverified\]](../../../../.ai/integrations.md#unverified)). Evidence: an
  integration test where an idle transaction holds a lock and the worker still commits (slice 2).
- An identity column's sequence needs no separate grant for `INSERT` (`[Unverified]`, unlike
  `serial`); the harness inserting as the runtime role proves it in slice 1.
- Evidence: the integration test where the runtime role gets `permission denied` on
  `DELETE FROM webhook_events` and on `CREATE TABLE` (slice 2,
  [build-checklist](../../../../.ai/build-checklist.md#2--durable-ingest-on-aws)).

## Running migrations

- **One code path** for the deploy command, the local setup command and the harness, so the tested
  path is the deployed path: `prepareDatabase({ ownerUrl, runtimePassword })` in
  `packages/db/src/prepare-database.ts`. It creates the runtime role only when absent, then runs
  the programmatic `migrate()` from `drizzle-orm/node-postgres/migrator`
  ([migrations](https://orm.drizzle.team/docs/migrations)), which keeps drizzle-kit out of every
  runtime (slice 1, D20).
- **The direct URL, never the pooled one, never from a runtime Lambda** (ADR-018).
- **The migrate connection sets `lock_timeout`** (a few seconds) as a connection option. Pending
  migrations apply in one transaction ([integrations.md → Decision — Neon](../../../../.ai/integrations.md#decision--neon))
  under live traffic, so DDL waiting behind a running transaction (a dispatcher batch holding
  `outbox` rows across its sends, [ADR-017](../../../../.ai/architecture.md#adr-017--the-dispatcher-is-triggered-after-commit-plus-an-hourly-sweep))
  queues every later statement on that table until the set commits. A timeout fails the deploy
  before `cdk deploy` with nothing applied; re-run it. The direct URL has no pooler, so this is the
  one session setting allowed. The migrate connection runs as the owner role, so the runtime role's
  role-level timeouts ([grants](#grants)) do not apply to it.
- Applied migrations are recorded in `drizzle.__drizzle_migrations` by default
  ([drizzle-kit migrate](https://orm.drizzle.team/docs/drizzle-kit-migrate)). Pending migrations
  run in one transaction: drizzle-orm 0.45.4's `PgDialect.migrate` (`pg-core/dialect.js`) creates
  the `drizzle` schema and the migrations table outside it, then applies every pending migration's
  statements and their `__drizzle_migrations` rows inside one `session.transaction`, so a failing
  statement rolls back the whole set. So no `CREATE INDEX CONCURRENTLY`
  (it cannot run inside a transaction block, and tables at the
  [scale ceiling](../../../../.ai/about.md#platform-scale-assumptions) index in moments).
- CI applies every migration to a fresh Postgres before the integration tests (slice 1,
  [build-checklist](../../../../.ai/build-checklist.md#1--local-ledger-and-read-path)).
