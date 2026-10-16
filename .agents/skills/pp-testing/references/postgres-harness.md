# Postgres harness

The integration tier exists because the database enforces the rule: the unique key on `svix_id`,
the row locks, the grants, the transaction that commits all or nothing. A mocked client proves none
of it ([Test tiers](../../pp-workflow/SKILL.md#test-tiers)). The deployed driver is
`drizzle-orm/node-postgres`, the one these tests use, so the driver path is the deployed one
([integrations.md → Decision — Neon](../../../../.ai/integrations.md#decision--neon)); the topology
is not: tests reach Postgres directly, Lambdas go through Neon's transaction-mode pooler. A
session-level feature (`SET`, `pg_advisory_lock`, `LISTEN`, SQL `PREPARE`) passes here and breaks
deployed, so pooler safety rests on [pp-database → Never](../../pp-database/SKILL.md#never), the
[diff-review row](../../wf-after-apply-check/references/diff-review.md#security) and
[PG-U02](../../../../.ai/integrations.md#unverified)'s deployed concurrency test. The harness is
Postgres access, so it lives in `packages/db` and is exported through `@ledger/db/testing`
([module boundaries](../../../../AGENTS.md#module-boundaries)). Schema, grants and migrations are
[pp-database](../../pp-database/SKILL.md)'s; this file owns how tests get a database.

## Lifecycle (one run)

The `int` project's global setup, `packages/db/src/testing/postgres-global-setup.ts`
([vitest-layout.md](vitest-layout.md#root-config)):

1. **Start one container** with `@testcontainers/postgresql`'s `PostgreSqlContainer(image)`, the
   image argument required and [pinned](#the-image), its database set by `.withDatabase()` to the
   template's name, never `postgres` ([Testcontainers → PostgreSQL](https://node.testcontainers.org/modules/postgresql/)).
   The container's user is the owner role.
2. **Ensure the runtime role**, through the same function the deploy command calls (S-05), with a
   password the harness generates for the run. That function also applies the deploy command's
   role-level `idle_in_transaction_session_timeout` and `lock_timeout`
   ([pp-database → Grants](../../pp-database/references/migrations-and-grants.md#grants)); the
   harness passes short test values (seconds, the idle one below `lock_timeout`, both above the
   longest lock wait a [concurrency test](#faults-and-concurrency) polls for). Without them the
   idle-holder test passes for the wrong reason. Roles are cluster-wide, so every clone sees it.
3. **Migrate the template** as the owner, through the one migrate entry point the deploy command
   and the local setup command also call
   ([pp-database → Running migrations](../../pp-database/references/migrations-and-grants.md#running-migrations)).
   Each table-creating change grants its DML to the runtime role in a custom migration, so the
   template carries the grants. This step is how "CI applies every migration to a fresh Postgres before the integration
   tests" holds ([slice 1](../../../../.ai/build-checklist.md#1--local-ledger-and-read-path)).
4. **Close every connection to the template, then mark it a template:**
   `ALTER DATABASE <template> WITH is_template = true`. "No other sessions can be connected to the
   source database while it is being copied"
   ([Postgres → Template databases](https://www.postgresql.org/docs/current/manage-ag-templatedbs.html)).
5. **Hand the tests what they need** with `project.provide(…)`: the owner URL of the maintenance
   database, the runtime role's credentials and the template name. Tests read them with `inject`
   from `vitest`; type them by augmenting `ProvidedContext`
   ([Vitest → globalSetup](https://vitest.dev/config/globalsetup)).
6. **Teardown** stops the container.

Steps 2 and 3 are code that does not exist yet: slice 1 lands the role-and-migrate entry point in
`packages/db` and the harness calls it; slice 2's deploy command calls the same one. Its name is the
slice 1 pre-proposal's.

**Why not `snapshot()` / `restoreSnapshot()`.** The module's restore drops the container's database
and recreates it from the snapshot, in place
([source](https://raw.githubusercontent.com/testcontainers/testcontainers-node/main/packages/modules/postgresql/src/postgresql-container.ts)).
One database restored in place cannot serve files running in parallel; a clone per file can.

## Per test file

```ts
// shape, not an API: slice 1 writes it
import { createTestDatabase, type TestDatabase } from '@ledger/db/testing';

let t: TestDatabase;
beforeAll(async () => { t = await createTestDatabase(); });
afterAll(async () => { await t.drop(); });
```

- `createTestDatabase()` runs `CREATE DATABASE "<unique name>" TEMPLATE <template>` over the owner
  URL, then opens the file's handles: `t.db`, a Drizzle database **connected as the runtime role**,
  which is what tests pass to repositories, commands and readers; `t.owner`, an owner connection to
  the same clone, for [fault injection](#faults-and-concurrency) only.
- `drop()` closes both pools, then `DROP DATABASE … WITH (FORCE)`.
- **One clone per file, never truncated, never shared.** Tests inside a file share it, so each test
  generates its own `svix_id`s, `email_id`s and test addresses (`delivered+<n>@resend.dev`) and
  asserts only on its own ids. A test never depends on another test's rows or order.
- **Grants are tested for free.** A query the runtime role may not run fails as `permission denied`
  in the test that needs it. The slice 2 role test asserts it directly: `DELETE FROM webhook_events`
  and `CREATE TABLE` as the runtime role are refused
  ([slice 2](../../../../.ai/build-checklist.md#2--durable-ingest-on-aws)).
- `CREATE DATABASE` copies the template's tables and their grants, but not database-level `GRANT`s
  (Postgres → Template databases). The clone keeps the default `CONNECT` for `PUBLIC`; a
  database-level grant the deploy command adds MUST be re-applied by `createTestDatabase()`.

## Faults and concurrency

- **A crash between steps** (ADR-004's evidence): make a later step fail inside the real
  transaction from `t.owner`, for example
  `ALTER TABLE email_state ADD CONSTRAINT test_fault CHECK (false) NOT VALID`, which rejects every
  new row while leaving existing ones alone. Run the message: it throws, and **nothing** committed
  (no `webhook_events` row either). Drop the constraint, run the same message again: one row of
  everything. The fault lives in the file's own clone and dies with it.
- **A concurrent duplicate** (two copies of one `svix_id` in flight at once, AWS-06): pre-seed the
  email with one event, then lock its `email_state` row `FOR UPDATE` in an open transaction on
  `t.owner`. Run the same envelope in two size-1 pools: A inserts into `webhook_events` and waits on
  the lock; B waits on A's uncommitted `svix_id`. Poll `pg_stat_activity` until both wait, release,
  and assert one `webhook_events` row, B committed as a duplicate, no second `outbox` row. Repeat
  with A failing (`pg_terminate_backend` on A while both wait): B inserts and projects.
- **Two concurrent containers** (the recipient lock order, ADR-017's two invokes): open one pool of
  size 1 per simulated Lambda container, as production does
  ([ADR-005](../../../../.ai/architecture.md#adr-005--postgres-only)). Interleave by observation, not
  by sleeping: hold transaction A open, start B, poll `pg_stat_activity` from `t.owner` until B's
  `wait_event_type` is `Lock`, then commit A, and assert the final rows.
- **An idle lock holder** (slice 2, the role-level timeouts of
  [pp-database → Grants](../../pp-database/references/migrations-and-grants.md#grants)): a role
  setting applies at connect, to that role's sessions only, so the holder is a fresh client **as
  the runtime role**, never `t.owner`, and the timeouts are the ones [step 2](#lifecycle-one-run)
  applied, never a session `SET`. The holder locks the email's `email_state` row and goes idle;
  run a message for that email; assert the holder's session is terminated and the worker's
  transaction commits one row of everything. A second test reads the runtime role's `rolconfig`
  and asserts both settings are present, which is what proves the role-ensure path sets them.
- **Never** a mocked client, a stubbed repository or a `vi.mock` of `pg` to fake a failure: the
  failure has to come from Postgres for the test to prove what Postgres does.

## Payloads Postgres cannot store

`jsonb` rejects `\u0000` (`22P05`) and a lone surrogate (`22P02`), and only Postgres says so, so
proving the sanitizer prevents them is integration tier (slice 1, where the ledger insert lands).
Feed a verified event of a known type whose payload holds each through the real worker transaction
and assert: no throw (never dead-lettered), one `webhook_events` row whose payload carries U+FFFD in
their place, the event **projected** (its `email_state` row reflects it), and one `worker.payload_sanitized`
emitted (a recording double of the [metrics helper's interface](../../pp-backend/references/composition.md) captures it)
([ADR-004](../../../../.ai/architecture.md#adr-004--immutable-ledger-keyed-on-svix_id-one-transaction-per-message);
the rule is [pp-database](../../pp-database/references/schema-and-repositories.md#unstorable-characters)'s).
A redelivery of the same event is a duplicate, not a second row. The pure sanitizer gets its own
unit or property test in `packages/core`: it replaces `\u0000`, a lone high and a lone low
surrogate with U+FFFD, and leaves a valid surrogate pair intact.

## Outage tests

ADR-015's "database stopped, ESM pause requested, no message reaches the DLQ" and slice 2's health
test "with Postgres stopped" stop the server, which would break every other file on the shared
container. **A test that stops or breaks the server starts its own container** through the same
setup function as the global setup (steps 1–4), stops it mid-test, and asserts the consequence.
It is the one exception to one container per run ([Case-by-case](../SKILL.md#case-by-case)).

## The image

**Postgres 18.** The harness MUST run the major the Neon project runs, which is 18
([integrations.md → Decision — Neon](../../../../.ai/integrations.md#decision--neon)). The image tag
names an exact 18.x minor, never `latest` or a bare major, so CI runs are reproducible; slice 1
picks the minor when it adds the harness.

`@testcontainers/postgresql` is a dev dependency of `packages/db` only, Ask-first when slice 1 adds
it ([Permissions](../../../../AGENTS.md#permissions)). The harness needs Docker locally and in CI
([pp-workflow → Definition of done](../../pp-workflow/references/definition-of-done.md#1--the-gate)).
