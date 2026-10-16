# Schema files, repositories, transactions

The mechanics of `packages/db`. What a table holds is [data-modeling.md](../../../../.ai/data-modeling.md);
file and export names follow [pp-general → Role suffixes](../../pp-general/references/coding-standards.md#role-suffixes).
Check every Drizzle call below against the installed version's `.d.ts` before writing it
([version rule](../../pp-general/SKILL.md#check-the-installed-version-not-memory)).

## Layout

```text
packages/db/
  drizzle.config.ts          # dialect postgresql, schema ./src/schema, out ./drizzle
  drizzle/                   # migrations, as drizzle-kit writes them; never edited after push
  src/
    index.ts                 # the one public surface: schema, repositories, Executor, classifier
    schema/<kebab>.ts        # one table per file, at data-modeling's `_Schema:_` path
    <kebab>.repository.ts    # one per table
    executor.ts              # the Executor and Transaction types
    connection-error.ts      # the classifier
    postgres-queue.adapter.ts  # slice 2B: the queue port over local_queue_messages (ADR-013)
```

`drizzle/` is drizzle-kit's default output and the path the `wf-*` scripts read. Whether the
installed drizzle-kit writes flat `.sql` files plus `meta/` or a folder per migration is
`[Unverified]`; the scripts match either.

## Schema files

- **One table per file**, named for the table in kebab-case at the entry's `_Schema:_` line (for
  example `packages/db/src/schema/webhook-events.ts`), exported from `src/index.ts`.
- **Every constraint and index lives in the `pgTable`'s third argument**, the callback that returns
  an array ([indexes & constraints](https://orm.drizzle.team/docs/indexes-constraints)), so
  `drizzle-kit generate` emits all of the DDL and nothing is hand-written beside it.
- **Column names are written out** in snake_case (`text('svix_id')`), so the SQL in the migration
  and the TypeScript key read the same in a grep. The TypeScript key is camelCase
  ([conventions](../../../../.ai/data-modeling.md#modeling-conventions-canonical)).
- **Name every constraint and index**, Postgres-style: `<table>_<columns>_key` (unique),
  `<table>_<column>_check`, `<table>_<columns>_idx`. A generated name changes when a column does.
- **Nullability is decided per column.** `.notNull()` unless the data-modeling entry says null, and
  then a one-line comment saying when it is null (`event_created_at`: a schema-failing payload).
- **Timestamps:** `timestamp('<col>', { withTimezone: true })`; row times default to `now()`.
- **Surrogate keys:** identity `bigint`, `.generatedAlwaysAsIdentity()`, `mode: 'number'` (ids stay
  below 2^53 at the [scale ceiling](../../../../.ai/about.md#platform-scale-assumptions)). Drizzle's
  docs show identity on `integer`; on `bigint` it is `[Unverified]` against the installed version.
- **Closed sets:** the core Zod enum's `as const` tuple feeds the column's `enum` option (types
  only: Drizzle "won't check runtime values", [column types](https://orm.drizzle.team/docs/column-types/pg)),
  and a `check()` lists the same members. The integration test inserts every member of the tuple
  and one value outside it (SQLSTATE `23514`), so the tuple and the `CHECK` cannot drift silently.
- **`updated_at`** is set by the repository's `UPDATE` (``updatedAt: sql`now()` ``). No trigger.

## Repositories

`packages/db/src/<kebab-table>.repository.ts`: one exported object of plain functions, each taking
the `Executor` first. No class, no state, no generic repository, no base type.

```ts
// packages/db/src/webhook-events.repository.ts — the shape; slice 1 names the functions
import type { Executor } from './executor.ts';
import { webhookEvents, type NewWebhookEvent } from './schema/webhook-events.ts';

export const webhookEventsRepository = {
  // ADR-004: the constraint dedupes; RETURNING says whether this call inserted.
  async insertIfAbsent(db: Executor, row: NewWebhookEvent): Promise<boolean> {
    const inserted = await db
      .insert(webhookEvents)
      .values(row)
      .onConflictDoNothing({ target: webhookEvents.svixId })
      .returning({ svixId: webhookEvents.svixId });
    return inserted.length === 1;
  },
};
```

- **`Executor`** is one exported type: the common supertype of the database object and a
  transaction, so the same function runs inside or outside one. Derive it from the installed
  `drizzle-orm` `.d.ts` (`[Unverified]`: whether the node-postgres transaction type extends the
  database type, or a union is needed); slice 1 writes it once. `Transaction`, exported beside it,
  is the transaction type alone, for a function that is only correct inside one (a lock).
- **They load and write rows.** A projection is computed by `packages/core` from the rows a
  repository loaded, and the result is written back by a repository
  ([Projections are derived](../../../../.ai/data-modeling.md#projections-are-derived)). A fold,
  a precedence rule or a mask inside a repository is a defect.
- **Uniqueness is the constraint's.** With `ON CONFLICT DO NOTHING`, `RETURNING` yields only the rows
  actually inserted ([Postgres → INSERT](https://www.postgresql.org/docs/current/sql-insert.html)),
  which is how the caller learns "duplicate" without a read first.
- **Reads parse `jsonb`** with its Zod schema before it leaves the repository
  ([jsonb](indexes-and-jsonb.md#jsonb)). The wire shape and its masks are the caller's mapper.

## Transactions and locks

The caller opens the transaction and passes `tx` down ([pp-backend](../../pp-backend/SKILL.md)); a
repository never opens one. On the `packages/db` side:

- **READ COMMITTED**, the Postgres default: no isolation level unless an ADR names one.
- **ADR-004's lock order:** each projection row created with `INSERT … ON CONFLICT DO NOTHING`, then
  `SELECT … FOR UPDATE` on the email row, then the recipient rows in sorted `address_hash` order;
  inputs read after the locks ([ADR-004](../../../../.ai/architecture.md#adr-004--immutable-ledger-keyed-on-svix_id-one-transaction-per-message)).
  The creating inserts follow the same order (the email row, then the recipient rows sorted by
  `address_hash`): an insert that conflicts with an uncommitted one waits for it
  ([unique checks](https://www.postgresql.org/docs/current/index-unique-checks.html)), so two emails
  creating the same recipients in opposite `data.to` order deadlock (`40P01`).
  A function that locks says so in its name (`lockEmail`), so the order reads in the command, and
  takes a `Transaction`, never an `Executor`: outside a transaction its lock releases at the
  statement's autocommit and serializes nothing.
- **Transaction-scoped locks only:** `FOR UPDATE`, `FOR UPDATE SKIP LOCKED` (the local queue and
  dispatcher claims), `pg_advisory_xact_lock`, `pg_try_advisory_xact_lock` (ADR-007, ADR-017), each
  advisory key a named constant in `packages/db`. The pooler is in transaction mode
  ([integrations.md → Decision — Neon](../../../../.ai/integrations.md#decision--neon)).

## Connection

One factory, called once at module scope by a composition root with typed config:
`drizzle-orm/node-postgres` over one `pg` pool of size 1, the pooled URL with `sslmode=require`
([ADR-005](../../../../.ai/architecture.md#adr-005--postgres-only)). It never reads `process.env`
([pp-general → Config](../../pp-general/references/config-and-env.md)); its name lands in slice 1.

- **Timeouts:** `connectionTimeoutMillis` and `query_timeout` in the pool config, both well below
  the function timeout. Both default to none ([Pool](https://node-postgres.com/apis/pool),
  [Client](https://node-postgres.com/apis/client)), so a blackholed connect ends as a Lambda timeout
  the classifier never sees: ADR-015 never pauses and the batch drains to the DLQ. Never
  `statement_timeout` or `lock_timeout` in this config: `pg` sends them as startup parameters
  ([source](https://raw.githubusercontent.com/brianc/node-postgres/master/packages/pg/lib/client.js)),
  which PgBouncer rejects by default ([`ignore_startup_parameters`](https://www.pgbouncer.org/config.html))
  and Neon's pooler page does not address; never `SET` either (pooler-safe SQL). The values, and
  whether a `Query read timeout` error is connection-class, are the slice 2 pre-proposal's.
- **`pool.on('error')` is registered**, logging the error's name and SQLSTATE only. An idle client
  dropped by the backend (a Neon suspend, PG-U04) emits on the pool, which has already removed it;
  with no listener, Node raises an uncaught error that kills the process ([Pool](https://node-postgres.com/apis/pool)).

## Connection-error classification

`database_unavailable` is raised by `packages/db` and nowhere else
([Error codes](../../../../.ai/api-contract.md#error-codes)). One function classifies an error, and
on a match returns a `DatabaseUnavailableError` (a subclass of the shared error class, code
`database_unavailable`, the original as `cause`); the ADR-015 worker branches on it
([ADR-015](../../../../.ai/architecture.md#adr-015--the-worker-pauses-its-own-event-source-on-a-database-outage),
[pp-general → Errors](../../pp-general/references/errors.md#one-base-class)). Where it is applied
(the transaction runner, the read API's database calls) is the slice 2 pre-proposal's to settle.

**Walk the `cause` chain first.** Drizzle wraps a failed query in `DrizzleQueryError` with the
driver error as `cause` ([source](https://raw.githubusercontent.com/drizzle-team/drizzle-orm/main/drizzle-orm/src/errors.ts)),
and `pg-pool` attaches the connect error as `cause` on its timeout. A match anywhere in the chain counts.

| Matches | Source |
| --- | --- |
| SQLSTATE class `08` (`08000`, `08001`, `08003`, `08004`, `08006`, `08007`, `08P01`) | [Postgres errcodes](https://www.postgresql.org/docs/current/errcodes-appendix.html) |
| `57P01` `admin_shutdown`, `57P02` `crash_shutdown`, `57P03` `cannot_connect_now` | same |
| Node socket codes: `ECONNREFUSED`, `ECONNRESET`, `ETIMEDOUT`, `EPIPE`, `ENOTFOUND`, `EAI_AGAIN`, `EHOSTUNREACH`, `ENETUNREACH` | Node system errors |
| `pg` errors with no `code`, by exact message: `Connection terminated unexpectedly`, `Connection terminated due to connection timeout`, `Client has encountered a connection error and is not queryable` | [pg client](https://raw.githubusercontent.com/brianc/node-postgres/master/packages/pg/lib/client.js), [pg-pool](https://raw.githubusercontent.com/brianc/node-postgres/master/packages/pg-pool/index.js) |

Never pg-pool's `timeout exceeded when trying to connect`: it is raised, with no `cause`, when no
pooled client frees up in time, which on a size-1 pool is a leaked checkout or a `db` call inside a
`tx`. That is a bug, so it follows ADR-008 to the DLQ instead of pausing the worker.

The lists are constants in `connection-error.ts`. The message matches are `[Unverified]` against
the installed `pg`; the slice 2 classification unit test (ADR-015's evidence) pins each row, and
what a Neon suspend actually raises is PG-U04's ([integrations.md → \[Unverified\]](../../../../.ai/integrations.md#unverified)).
Never log a `DrizzleQueryError`'s message: it embeds the query's `params`, which can hold an address.
