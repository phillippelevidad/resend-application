# Indexes and `jsonb`

## Indexes

An index costs every write and every migration that touches its table, and buys nothing until a
query uses it. So:

- **Each index serves a query named in the same change**: the repository function that issues it,
  cited in a one-line comment beside the index (`// serves loadEventsForEmail`). An index nobody
  names is speculative and is dropped from the diff.
- **A key is already an index.** A primary key or unique constraint serves lookups on its leading
  columns: the reconcile diff is a primary-key lookup on `svix_id` and needs nothing more
  ([`webhook_events`](../../../../.ai/data-modeling.md#webhook_events--the-immutable-ledger)).
- **The data-modeling entry names the table's indexes** (`webhook_events (email_id, event_created_at)`,
  `email_recipients (address_hash)`, the outbox sweep's partial index); the slice that lands the
  table writes them with the query that uses them.
- **Columns in the order the query uses them:** equality columns first, then the range or sort
  column.
- **No foreign keys**, so there are no foreign-key columns to index
  ([Anti-patterns](../../../../.ai/data-modeling.md#anti-patterns-must-not)).

### Keyset pages

List reads page forward with a cursor `after` and `limit` 1–100
([api-contract.md → Conventions](../../../../.ai/api-contract.md#conventions)). A keyset page sorts on
a tuple that ends in the unique `id`, filters with a row comparison on the same tuple, and has an
index on exactly that tuple:

```sql
-- the order and the predicate use the same tuple; the index is (sort_col, id)
WHERE (sort_col, id) < ($1, $2) ORDER BY sort_col DESC, id DESC LIMIT $3
```

- Sorting by a non-unique column alone gives unstable pages; the `id` tie-break makes the order
  total.
- Where the sort **is** the identity `id` (`api_tokens.id` and `reconcile_runs.id`, which the read
  API pages on, [base fields](../../../../.ai/data-modeling.md#base-fields--the-checklist-for-every-new-model)),
  the primary key serves the page and no index is added.
- `id` never orders anything a projection reads ([Timestamps & ordering](../../../../.ai/data-modeling.md#timestamps--ordering)):
  a page order is presentation, never state.
- Which tuple each list operation sorts on is the slice that lands the operation.

### Partial indexes

A partial index serves a query that always carries the same predicate over a small slice of a
table. The one the model names is the outbox sweep: `(next_attempt_at) WHERE status = 'pending'`
([`outbox`](../../../../.ai/data-modeling.md#outbox--reactions-awaiting-delivery)), so the claim reads
only due rows. Declared in the `pgTable` with ``.where(sql`…`)``
([indexes & constraints](https://orm.drizzle.team/docs/indexes-constraints)); the query's predicate
must match the index's for the planner to use it. A partial **unique** index carries a rule that
holds only for some rows: `api_tokens (bootstrap) WHERE bootstrap`
([Idempotency keys](../../../../.ai/data-modeling.md#idempotency-keys)).

## `jsonb`

`jsonb` is allowed in exactly three places
([conventions](../../../../.ai/data-modeling.md#modeling-conventions-canonical)):

| Column | Holds | Its Zod schema |
| --- | --- | --- |
| `webhook_events.payload` | The parsed `{ type, created_at, data }` body (RS-26), raw until the retention job | The event schemas in `packages/core` (ADR-003) |
| `outbox.payload` | What the dispatcher sends: ids, `type`, hashes and masks | One schema per `kind`, beside the rule that writes it |
| `local_queue_messages.body` | The ingest envelope (ADR-001) | The envelope schema the queue port uses |

Anything a query filters on or a projection reads is a typed column instead: `webhook_events`
extracts `type`, `event_created_at`, `email_id`, `to_hashes` and `source` at insert
([Immutable ledger](../../../../.ai/data-modeling.md#immutable-ledger)). A fourth `jsonb` column is a
data-modeling change first.

- **Parse on read, never cast.** Drizzle's `.$type<T>()` is compile-time only: it "won't check
  runtime values" ([column types](https://orm.drizzle.team/docs/column-types/pg)). Leave the column
  `unknown` and parse it with its Zod schema in the repository. A cast asserts a shape the database
  never enforced. For `outbox.payload` and `local_queue_messages.body`, Ledger wrote the value, so a
  parse failure is a bug and throws.
- **A payload that fails its schema is still a row.** A verified event whose payload fails its
  type's schema is stored raw, with the typed columns null where unreadable, skipped by projections
  and counted ([ADR-004](../../../../.ai/architecture.md#adr-004--immutable-ledger-keyed-on-svix_id-one-transaction-per-message)).
  So `webhook_events.payload` is read with a non-throwing parse (`safeParse`), and a failure is an
  outcome the caller counts, never an exception that drops the row.
- **Store the body as received.** Write the value `JSON.parse` produced from the raw request, never
  the Zod output: Zod objects strip unknown keys by default, and the ledger keeps every field
  Resend sent. Never pass a pre-serialized string either; the column would hold a JSON string, not
  the object. `jsonb` itself normalizes key order and whitespace, which is why a stored row is never
  re-verified ([Immutable ledger](../../../../.ai/data-modeling.md#immutable-ledger)).
- **Never raw PII in `outbox.payload`**: ids, hashes and masks only, and never a third-party
  response body ([PII & retention](../../../../.ai/data-modeling.md#pii--retention)).
- **Retention rewrites `webhook_events.payload` only**, through the slice 7 job, by the rule in
  [ADR-014](../../../../.ai/architecture.md#adr-014--raw-payload-retention-and-redaction). Nothing
  else updates a `jsonb` value in place.
