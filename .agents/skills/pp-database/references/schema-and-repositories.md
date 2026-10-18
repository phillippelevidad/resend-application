# Schema files, repositories, transactions

The mechanics of `packages/db`. What a table holds is [data-modeling.md](../../../../.ai/data-modeling.md);
file and export names follow [pp-general → Role suffixes](../../pp-general/references/coding-standards.md#role-suffixes).
Check every Drizzle call below against the installed version's `.d.ts` before writing it
([version rule](../../pp-general/SKILL.md#check-the-installed-version-not-memory)).

## Layout

```text
packages/db/
  drizzle.config.ts          # dialect postgresql, schema ./src/schema, out ./drizzle
  drizzle/                   # migrations, as drizzle-kit writes them; never edited once frozen
  src/
    index.ts                 # the one public surface: schema, repositories, Executor, classifier
    schema/<kebab>.ts        # one table per file, at data-modeling's `_Schema:_` path
    <kebab>.repository.ts    # one per table
    executor.ts              # the Executor and Transaction types
    create-database.ts       # the connection factory
    run-transaction.ts       # runTransaction: a transaction that discards a failed connection
    prepare-database.ts      # ensure the runtime role, then migrate (pp-database → migrations)
    deploy-checks.ts         # the deploy command's read-only refusal checks (owner URL only)
    classify-database-error.ts  # the classifier
    database-unavailable.error.ts  # the database_unavailable subclass it returns
    testing.ts, testing/     # the int harness, exported as @ledger/db/testing (pp-testing)
    postgres-queue.adapter.ts  # slice 2B: the queue port over local_queue_messages (ADR-013)
```

`drizzle/` is drizzle-kit's default output and the path the `wf-*` scripts read. drizzle-kit
0.31.11 writes it flat: `NNNN_<name>.sql` per migration, plus `meta/_journal.json` (the order
`migrate()` reads) and one `meta/NNNN_snapshot.json` per migration (what the next `generate` diffs
against). Biome skips the folder: the files are drizzle-kit's output, never reformatted.

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
  below 2^53 at the [scale ceiling](../../../../.ai/about.md#platform-scale-assumptions)). On
  drizzle-orm 0.45.4, `bigint('id', { mode: 'number' }).generatedAlwaysAsIdentity()` generates
  `bigint GENERATED ALWAYS AS IDENTITY` and reads ids back as numbers (`api_tokens`, slice 2,
  [api-tokens.repository.int.test.ts](../../../../packages/db/src/api-tokens.repository.int.test.ts)).
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
  transaction, so the same function runs inside or outside one. In drizzle-orm 0.45.4 both
  `NodePgDatabase` and `PgTransaction` extend `PgDatabase`, so no union is needed:
  `Executor = PgDatabase<NodePgQueryResultHKT, …>` in `executor.ts`. `Transaction`, exported beside
  it, is the `PgTransaction` that `db.transaction(cb)` hands `cb`, for a function that is only
  correct inside one (a lock); the database object is not assignable to it.
- **They load and write rows.** A projection is computed by `packages/core` from the rows a
  repository loaded, and the result is written back by a repository
  ([Projections are derived](../../../../.ai/data-modeling.md#projections-are-derived)). A fold,
  a precedence rule or a mask inside a repository is a defect.
- **Uniqueness is the constraint's.** With `ON CONFLICT DO NOTHING`, `RETURNING` yields only the rows
  actually inserted ([Postgres → INSERT](https://www.postgresql.org/docs/current/sql-insert.html)),
  which is how the caller learns "duplicate" without a read first.
- **Reads parse `jsonb`** with its Zod schema before it leaves the repository
  ([jsonb](indexes-and-jsonb.md#jsonb)). The wire shape and its masks are the caller's mapper.

### Unstorable characters

`jsonb` rejects `\u0000` (`22P05`) and lone UTF-16 surrogates (`22P02`), which JSON allows.
Otherwise a verified event fails every receive and every redrive. So the payload never reaches the
insert holding one: before the insert, the worker runs a pure `packages/core` sanitizer that
replaces each, in every string of the parsed payload, with U+FFFD, and counts the event as
sanitized; the sanitized event then takes the ordinary path, projected when it passes its type's
schema, stored raw and counted when it does not
([ADR-004](../../../../.ai/architecture.md#adr-004--immutable-ledger-keyed-on-svix_id-one-transaction-per-message)).
The repository writes what it is given: no retry, no savepoint, and every insert error throws
unchanged. Evidence: an integration test feeding a NUL payload stores one row and projects it, and
a sanitizer property test (slice 1;
[pp-testing](../../pp-testing/references/postgres-harness.md#payloads-postgres-cannot-store)).

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

### runTransaction

`runTransaction(database, fn)` in `run-transaction.ts` is the transaction a caller opens when it
retries a connection-class failure (the worker's `RecordEventCommand`, ADR-015, D15 of the slice 2
change). It checks a client out of the pool itself, runs `BEGIN`, `fn(tx)` over a Drizzle
transaction bound to that client, then `COMMIT`. On an error `classifyDatabaseError` matches, it
releases the client **with** the error (`client.release(err)`, so pg-pool closes it) and sends no
`ROLLBACK`: the server rolls back when the connection closes. On any other error it rolls back and
releases normally.

Why not `db.transaction`: drizzle-orm 0.45.4 rolls back on the failed client and then releases it
with no error, and pg-pool keeps a released client that is still queryable, which a
`Query read timeout` leaves it. On a size-1 pool the rollback waits another query timeout and the
retry reuses the hung socket, which runs the worker past its function timeout before it can pause.
With `runTransaction` the retry costs one connect and one query timeout. Evidence: a retry after a
`Query read timeout` reports a different `pg_backend_pid()` and the timed-out backend leaves
`pg_stat_activity`; with `db.transaction` in its place the retry reports the same backend
([run-transaction.int.test.ts](../../../../packages/db/src/run-transaction.int.test.ts)).

## Connection

One factory, called once at module scope by a composition root with typed config:
`drizzle-orm/node-postgres` over one `pg` pool of size 1, the pooled URL with `sslmode=require`
([ADR-005](../../../../.ai/architecture.md#adr-005--postgres-only)). It never reads `process.env`
([pp-general → Config](../../pp-general/references/config-and-env.md)):
`createDatabase({ url, max, logger })` → `{ db, pool }` in `create-database.ts`.

- **Timeouts:** `connectionTimeoutMillis` and `query_timeout` in the pool config, both well below
  the function timeout. Both default to none ([Pool](https://node-postgres.com/apis/pool),
  [Client](https://node-postgres.com/apis/client)), so a blackholed connect ends as a Lambda timeout
  the classifier never sees: ADR-015 never pauses and the batch drains to the DLQ. Never
  `statement_timeout` or `lock_timeout` in this config: `pg` sends them as startup parameters
  ([source](https://raw.githubusercontent.com/brianc/node-postgres/master/packages/pg/lib/client.js)),
  which PgBouncer rejects by default ([`ignore_startup_parameters`](https://www.pgbouncer.org/config.html))
  and Neon's pooler page does not address; never `SET` either (pooler-safe SQL). The values are
  `CONNECTION_TIMEOUT_MS = 5_000` and `QUERY_TIMEOUT_MS = 15_000`, constants beside the factory:
  the query bound sits above the runtime role's `lock_timeout` (10 s), which ends every lock wait
  server-side first, so a query unanswered for 15 s means the server is unreachable, and its
  `Query read timeout` is connection-class ([below](#connection-error-classification)). A timed-out
  client stays open and queryable, so a retry MUST NOT reuse it ([runTransaction](#runtransaction)).
  These bound only a live client. A frozen or killed Lambda's open transaction is bounded
  server-side by the runtime role's `idle_in_transaction_session_timeout` and `lock_timeout`,
  set by the role-ensure step ([grants](migrations-and-grants.md#grants), PG-U06).
- **`pool.on('error')` is registered**, logging the error's name and SQLSTATE only. An idle client
  dropped by the backend (a Neon suspend, PG-U04) emits on the pool, which has already removed it;
  with no listener, Node raises an uncaught error that kills the process ([Pool](https://node-postgres.com/apis/pool)).

## Connection-error classification

`database_unavailable` is raised by `packages/db` and nowhere else
([Error codes](../../../../.ai/api-contract.md#error-codes)). One function classifies an error, and
on a match returns a `DatabaseUnavailableError` (a subclass of the shared error class, code
`database_unavailable`, the original as `cause`); the ADR-015 worker branches on it
([ADR-015](../../../../.ai/architecture.md#adr-015--the-worker-pauses-its-own-event-source-on-a-database-outage),
[pp-general → Errors](../../pp-general/references/errors.md#one-base-class)). It is
`classifyDatabaseError(err)` → `DatabaseUnavailableError | undefined`, landed in slice 1 and applied
in the read API's `onError` (C3 of the slice 1 change: api-contract.md lists `database_unavailable`
under slice 1); where the worker applies it (the ADR-015 branch) is the slice 2 pre-proposal's.

**Walk the `cause` chain first.** Drizzle wraps a failed query in `DrizzleQueryError` with the
driver error as `cause` ([source](https://raw.githubusercontent.com/drizzle-team/drizzle-orm/main/drizzle-orm/src/errors.ts)),
and `pg-pool` attaches the connect error as `cause` on its timeout. A match anywhere in the chain counts.

| Matches | Source |
| --- | --- |
| SQLSTATE class `08` (`08000`, `08001`, `08003`, `08004`, `08006`, `08007`, `08P01`) | [Postgres errcodes](https://www.postgresql.org/docs/current/errcodes-appendix.html) |
| `57P01` `admin_shutdown`, `57P02` `crash_shutdown`, `57P03` `cannot_connect_now` | same |
| Node socket codes: `ECONNREFUSED`, `ECONNRESET`, `ETIMEDOUT`, `EPIPE`, `ENOTFOUND`, `EAI_AGAIN`, `EHOSTUNREACH`, `ENETUNREACH` | Node system errors |
| `pg` errors with no `code`, by exact message: `Connection terminated unexpectedly`, `Connection terminated due to connection timeout`, `Client has encountered a connection error and is not queryable`, and `Query read timeout` (the pool's `query_timeout` fired, slice 2) | [pg client](https://raw.githubusercontent.com/brianc/node-postgres/master/packages/pg/lib/client.js), [pg-pool](https://raw.githubusercontent.com/brianc/node-postgres/master/packages/pg-pool/index.js) |
| `53100` `disk_full`, classified for Neon's storage-limit error on a Free project at its cap (whether Neon raises exactly this, and how `pg` surfaces it, is PG-U07, `[Unverified]`; an unmatched code follows ADR-008, as before). Not a connection error: classified here so the worker pauses and the queue holds instead of draining to the DLQ | [ADR-015](../../../../.ai/architecture.md#adr-015--the-worker-pauses-its-own-event-source-on-a-database-outage) |

Never pg-pool's `timeout exceeded when trying to connect`: it is raised, with no `cause`, when no
pooled client frees up in time, which on a size-1 pool is a leaked checkout or a `db` call inside a
`tx`. That is a bug, so it follows ADR-008 to the DLQ instead of pausing the worker.

The lists are constants in `classify-database-error.ts`. The message matches are checked against
the installed `pg` 8.23.1 (`lib/client.js`) and `pg-pool` 3.14.0 (`index.js`) source; the slice 1
unit test [classify-database-error.test.ts](../../../../packages/db/src/classify-database-error.test.ts)
pins each connection-class row, a real refused connection and the non-matches, and what a Neon
suspend actually raises is PG-U04's, the storage-limit row PG-U07's
([integrations.md → \[Unverified\]](../../../../.ai/integrations.md#unverified)).
Never log a `DrizzleQueryError`'s message: it embeds the query's `params`, which can hold an address.
