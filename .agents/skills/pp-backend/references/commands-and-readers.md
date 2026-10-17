# Commands, readers and transactions

The shape every write and every read in a logic package takes. The class shape is
[ADR-019](../../../../.ai/architecture.md#adr-019--application-and-surface-stack); the transaction
rules are [ADR-004](../../../../.ai/architecture.md#adr-004--immutable-ledger-keyed-on-svix_id-one-transaction-per-message)
and [ADR-006](../../../../.ai/architecture.md#adr-006--transactional-outbox-for-reactions). The
patterns rejected outright (bus, generic repository, ambient transaction, auto-mapper, DI
container) are listed once, in pp-general's
[rejected patterns](../../pp-general/references/adding-things.md#rejected-patterns).

## The shape

- **A class with one public `execute(input)`.** A `.command.ts` writes; a `.reader.ts` reads. The
  input is an exported `type <Name>Input` in the same file; the output is the class's own exported
  type, or a domain type from `packages/core`.
- **Dependencies through the constructor**, assigned in its body (never parameter properties,
  [type stripping](../../pp-general/references/imports-and-tsconfig.md#node-24-runs-ts-directly)),
  wired in `main.ts` or by the package factory ([composition.md](composition.md)).
- **Called directly.** A route handler, the worker loop or the reconciler calls
  `new XCommand(deps).execute(input)` or an instance the factory built. The call stays greppable.

```ts
// the shape, not an API
export type RecordEventInput = { envelope: IngestEnvelope };

export class RecordEventCommand {
  readonly #db: Database;
  constructor(db: Database) { this.#db = db; }

  async execute(input: RecordEventInput): Promise<RecordEventOutcome> {
    return this.#db.transaction(async (tx) => {
      // insert ON CONFLICT DO NOTHING → duplicate? return
      // lock, load the event set, project with @ledger/core, write, outbox rows
    });
  }
}
```

## A command owns its transaction

- **It opens exactly one:** `db.transaction(async (tx) => …)` (Drizzle; Postgres default READ
  COMMITTED, which ADR-004 relies on). Throwing inside it rolls it back.
- **`tx` is passed down explicitly** to every repository call, which takes the executor first
  ([pp-database](../../pp-database/SKILL.md)). Nothing reads a transaction from module or
  async-local state.
- **No external call inside it:** no Resend call, no SQS send, no Lambda invoke, no HTTP. A
  reaction is an outbox row in the same transaction; a post-commit step (the worker's dispatcher
  invoke, ADR-017) runs after `transaction()` resolves. A crash at any point inside is nothing or
  everything (ADR-004).
- **One named exception:** the dispatcher delivers a claimed batch inside the transaction that holds
  its `pg_try_advisory_xact_lock` and the claimed rows, because ADR-017 commits each batch's
  outcomes with the batch, so a crash re-sends at most one batch. Each delivery carries an HTTP
  timeout well below the Lambda timeout ([reactions-and-recovery.md](reactions-and-recovery.md#dispatcher)).
- **Locks in one order:** the email row, then recipient rows sorted by `address_hash`, each created
  with `INSERT … ON CONFLICT DO NOTHING` before its `SELECT … FOR UPDATE`, inputs read after the
  locks (ADR-004). A second lock order anywhere is a deadlock waiting for a burst.
- **Pooler-safe only:** transaction-scoped locks (`pg_advisory_xact_lock`,
  `pg_try_advisory_xact_lock`), row locks; never a session lock, `SET`, `LISTEN` or `PREPARE`
  ([integrations.md → How it is used](../../../../.ai/integrations.md#decision--neon)).

## A reader never writes

- **No insert, update, delete or lock.** A reader that needs a write is a command.
- **One snapshot when it reads more than one table:** a `REPEATABLE READ`, read-only transaction
  around every read, so a worker commit between two of them cannot answer one response from two
  moments (`GetEmailReader`; transaction-scoped, so pooler-safe). A single-statement reader needs
  none.
- **It returns a read shape**, never a raw row: the route's mapper turns it into the wire object
  and applies the masks ([read-api.md](read-api.md#mappers)).
- **It computes nothing a projection owns.** State comes from `email_state`, `email_recipients`
  and `recipient_state`; a derived answer such as `email.explainDelivery` is a pure `packages/core`
  function the reader calls over loaded rows ([api-contract.md](../../../../.ai/api-contract.md#emailexplaindelivery)).
- **It pages by keyset** on the column pair the index serves (pp-database), forward only, with the
  list envelope ([Conventions → Pagination](../../../../.ai/api-contract.md#conventions)).

## Idempotency: the constraint decides

Delivery is at-least-once everywhere: Resend (RS-06), SQS standard (AWS-06), the DLQ redrive
(AWS-21), the reconciler's replays (ADR-007), the dispatcher's invokes (ADR-017). Running the same
command twice on the same input MUST leave one row and one effect.

| Guard | Absorbs | Enforced by |
| --- | --- | --- |
| `webhook_events.svix_id` | Svix retries, redrives, replays | `INSERT … ON CONFLICT (svix_id) DO NOTHING`; a conflict commits as a duplicate ([Idempotency keys](../../../../.ai/data-modeling.md#idempotency-keys)) |
| `outbox.dedupe_key` | A worker retry re-emitting a reaction | Its unique constraint, `ON CONFLICT DO NOTHING` |
| Projection PKs plus row locks | Concurrent workers on one key | `ON CONFLICT DO NOTHING`, then `FOR UPDATE` |
| A run's advisory lock | Two `reconcile.start` calls | `pg_advisory_xact_lock`, then the check, then the insert ([reconcile_runs](../../../../.ai/data-modeling.md#reconcile_runs--one-row-per-recovery-run)) |
| `reconcile_runs.claimed_at` | One run's async invoke delivered twice (AWS-53) | `UPDATE … SET claimed_at = now() WHERE id = $1 AND claimed_at IS NULL`; zero rows exits ([reconciler](reactions-and-recovery.md#reconciler)) |

- **Never a read-then-write guard** (select, then insert if absent). Two workers both read "absent".
  The unique constraint or the lock is the guard; the insert reports what happened.
- **Never dedupe on the SQS `messageId`**: a redrive changes it (AWS-21).
- **Where idempotency is not the answer:** order is the projection's job (ADR-003: fold the event
  set, never patch from the previous row); concurrency is the row locks' job. A dedupe key fixes
  neither.

## Errors from a command

Throw the shared error class with a registered `code`; subclass only when a caller branches on it
([errors.md](../../pp-general/references/errors.md#one-base-class)). The ADR-015 connection-class
error is raised by `packages/db` and branched on by the worker
([ingest-and-worker.md](ingest-and-worker.md#database-outage-adr-015)). A command never formats an
error for a surface; the surface's one mapper does.
