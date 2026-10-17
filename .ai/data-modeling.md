# Data modeling

How Ledger models its data. ADRs and system shape: [architecture.md](architecture.md). Verified
payload fields: [resend.md](resend.md) (`RS-NN`). Read the principles before designing any table or
column.

## How to use

1. Read every subsection of [Principles](#principles). They bind every table.
2. Find the table in the [Model index](#model-index): its stage and whether it is real yet.
3. Read only that table's `###` entry under [Tables](#tables).

**Split rule.** Once `packages/db` exists, its Drizzle schema owns columns, types and indexes. This
doc owns intent, idempotency keys, mutability, PII class and evidence. Field tables list only
load-bearing columns. Where they disagree on a column, the schema wins and this doc is corrected;
where they disagree on intent, the schema is a bug. `Modeled` is ticked `[x]` in the change that
lands the migration, never before.

## Model index

**Agents: tick `Modeled` in the change that lands the migration.** The index never substitutes for
the entry it links.

| Table | Role | Kind | Mutability | Stage | Modeled |
| --- | --- | --- | --- | --- | --- |
| [`webhook_events`](#webhook_events--the-immutable-ledger) | One row per Resend event, ever | Ledger | Append-only; the retention job masks PII in `payload` | 1 — Local ledger and read path | [x] |
| [`email_state`](#email_state--current-state-per-email) | Current state per email | Projection | Recomputed | 1 — Local ledger and read path | [x] |
| [`email_recipients`](#email_recipients--outcome-per-email-and-recipient) | Outcome per email and recipient | Projection | Recomputed | 1 — Local ledger and read path | [x] |
| [`recipient_state`](#recipient_state--deliverability-per-address) | Deliverability per address | Projection | Recomputed | 1 — Local ledger and read path | [x] |
| [`api_tokens`](#api_tokens--read-api-bearer-tokens) | Read API bearer tokens, hashed | Credential record | Insert, then revoke once | 2 — Durable ingest on AWS | [ ] |
| [`reconcile_runs`](#reconcile_runs--one-row-per-recovery-run) | One row per recovery run | Ops record | Insert, claim once, finish once | 4 — Recovery | [ ] |
| [`local_queue_messages`](#local_queue_messages--the-local-mode-queue) | SQS stand-in for local mode | Queue | Claimed, deleted or dead | 2B — Local-mode queue and docker compose | [ ] |
| [`outbox`](#outbox--reactions-awaiting-delivery) | Reactions awaiting delivery | Outbox | Status transitions only | 6 — Reactions | [ ] |

No table backs ADR-015 or the ADR-017 sweep. The paused state is the ESM's `Enabled` flag (AWS-18),
and the sweep reads `outbox.next_attempt_at`.

## Principles

### Immutable ledger

- `webhook_events` is the only authoritative store
  ([architecture.md → Source-of-truth rule](architecture.md#system-shape)).
- A row MUST NOT be updated or deleted. The one exception is the retention job, which MAY only
  rewrite PII inside `payload`: it masks the display fields and nulls the fields no projection reads
  ([PII & retention](#pii--retention); [ADR-014](architecture.md#adr-014--raw-payload-retention-and-redaction)).
- The ledger MUST accept any event in any order. There are no foreign keys from it to projections.
- Typed columns (`type`, `event_created_at`, `email_id`, `to_hashes`, `source`) are extracted once,
  at insert, and never change.
- `payload` is the parsed body, stored as `jsonb`. It is not the signed bytes: `jsonb` normalizes
  key order and whitespace, and redaction rewrites it. A stored row is therefore never
  re-verified. Verification happens once, at ingest
  ([ADR-001](architecture.md#adr-001--verify-then-enqueue)). This supersedes the "exactly what
  Resend signed" wording in [idea §5.2](../docs/idea.md#52-ingest) and
  [§6.3](../docs/idea.md#63-data-model-initial).
- `payload` is stored as received, minus what Postgres cannot store: `jsonb` rejects `\u0000` and
  lone surrogates. Before the insert, the worker replaces them in the parsed payload with U+FFFD
  (a pure `packages/core` function) and counts the event as sanitized. The sanitized event then
  takes the ordinary path: projected when it passes its type's schema, stored raw and counted when
  it does not. No retry, no savepoint. Such an event is never dead-lettered for its content
  ([ADR-004](architecture.md#adr-004--immutable-ledger-keyed-on-svix_id-one-transaction-per-message)).

### Projections are derived

- Every projection column MUST be computable from the event set alone. Dropping the projections
  and rebuilding them yields identical rows
  ([ADR-003](architecture.md#adr-003--projection-is-a-pure-function-of-the-event-set)). This holds
  before and after redaction, because redaction keeps every input a projection reads.
- Projections are recomputed from the full event set for the affected key. They are never patched
  incrementally from the previous row.
- Fold order is `(event_created_at, rank(type), svix_id)`, which is deterministic for any arrival
  order.
- Projection logic lives in `packages/core`. `packages/db` only loads events and writes the results.
- Per-recipient state folds each event's **own** `data.to` (RS-27), never the email's first-seen
  recipient list. RS-27 documents `to` as the *impacted* recipients, so a bounce reaches only the
  recipient it names, and a healthy co-recipient keeps its outcome. Slice 1 MUST confirm that reading
  (RS-U21).

### Idempotency keys

| Key | Absorbs | Where enforced |
| --- | --- | --- |
| `webhook_events.svix_id` (PK) | Svix retries, DLQ redrives, reconciler replays (same `svix-id`, RS-06, RS-08, RS-U01) | `INSERT … ON CONFLICT (svix_id) DO NOTHING` ([ADR-004](architecture.md#adr-004--immutable-ledger-keyed-on-svix_id-one-transaction-per-message)) |
| `email_state.email_id`, `email_recipients (email_id, address_hash)`, `recipient_state.address_hash` (PKs) | Concurrent workers on one key | `INSERT … ON CONFLICT DO NOTHING`, then `SELECT … FOR UPDATE`: the email row first, then recipient rows in sorted `address_hash` order; inputs read after the locks, at READ COMMITTED (ADR-004) |
| `outbox.dedupe_key` (UNIQUE) | Worker retries re-emitting a reaction | Unique constraint; the Resend `Idempotency-Key` is derived from it ([ADR-006](architecture.md#adr-006--transactional-outbox-for-reactions), RS-24) |
| `api_tokens.bootstrap` (partial UNIQUE `WHERE bootstrap`) | A re-run deploy command inserting a second first token | `INSERT … ON CONFLICT DO NOTHING`; `token_hash` stays UNIQUE as a collision guard only |

A unique key MUST live in the migration, not only in the Drizzle schema file. The SQS `messageId`
is never a key, because a redrive changes it (AWS-21).

_Evidence:_ `svix_id`: a sequential duplicate, two concurrent copies and a copy under a new
`messageId` each leave one row, and the projection keys' insert-then-lock order lets two emails
sharing recipients in opposite `data.to` order commit without deadlock, as the runtime role, in
[record-event.command.int.test.ts](../packages/worker/src/record-event.command.int.test.ts)
(slice 1). `outbox.dedupe_key` (slice 6) and `api_tokens.bootstrap` (slice 2) are pending.

### Timestamps & ordering

- `event_created_at` is the payload's top-level `created_at`, "when the webhook event was created"
  (RS-26). `received_at` is when Ledger got the event.
- Projections, and every "since", "first" or "last" value, MUST use `event_created_at`. Ordering by
  `received_at`, insertion order or a surrogate id is a correctness bug. Whether `created_at`
  tracks the real event time does not change which state results, because it is a sort key, with
  `rank` and `svix_id` as tie-breaks (RS-U10, ADR-003). Whether that state is *right* does depend
  on it where a rule uses recency (`soft_bouncing` clearing) and in displayed times (`since`,
  `status_at`, `first_opened_at`); the slice 4 replay experiment checks it (RS-U10).
- `received_at` is for lag metrics and operator forensics only.
- All timestamps are `timestamptz`, stored in UTC.

### Base fields — the checklist for every new model

| Field | Include when | Notes |
| --- | --- | --- |
| Natural PK (`svix_id`, `email_id`, `address_hash`) | **MUST** when the row is keyed by an external identity | The PK is the idempotency key |
| `id` (`bigint GENERATED ALWAYS AS IDENTITY`) | **MUST** when there is no natural key (`outbox`, `reconcile_runs`, `api_tokens`, `local_queue_messages`) | Never a public identifier, except `reconcile_runs.id` and `api_tokens.id`, which the read API exposes as `run_id` and `token_id` and pages on; never a sort key for anything a projection reads |
| `created_at` / `received_at` | **MUST** on every table | `timestamptz default now()` |
| `updated_at` | **MUST** on mutable rows; **MUST NOT** on append-only rows | Projections and `outbox` carry it; `webhook_events` does not |
| `event_created_at` | **MUST** on any row derived from one event | Distinct from row time |
| `status` | **MUST** where the row has a lifecycle | Closed set ([conventions](#modeling-conventions-canonical)) |
| `dedupe_key` | **MUST** on rows whose processing causes an external effect | See [Idempotency keys](#idempotency-keys) |
| `address_hash` + `address_masked` | **MUST** in place of any email address outside `webhook_events.payload` | See [PII & retention](#pii--retention) |
| `tenant_id` | **MUST NOT** | One installation, one team. Multi-tenant is a [categorical reject](architecture.md#deferred-yagni) |
| `deleted_at` | **MUST NOT** | No soft delete. The ledger is never deleted, and projections are rebuilt |

### Modeling conventions (canonical)

- Tables and columns are snake_case. Entity tables are plural (`webhook_events`, `reconcile_runs`).
  Per-key projections are named `<noun>_state` or `<noun>_recipients`. `outbox` keeps its name.
  Drizzle maps camelCase TS to snake_case.
- **Closed sets** are stored as `text` with a `CHECK` constraint and mirrored by a Zod enum in
  `packages/core`. Never as a `pgEnum`: Postgres cannot drop an enum value, so an enum has no clean
  contract step under expand/contract migrations
  ([ADR-018](architecture.md#adr-018--migrations-run-from-the-deploy-command-before-the-code-that-needs-them)).
  `webhook_events.type` has **no** `CHECK`, because unknown types are stored, not rejected (RS-25,
  ADR-004).
- Surrogate keys are identity `bigint`, never `serial` or a UUID. Public identifiers are Resend's
  (`svix_id`, `email_id`), the outbox `dedupe_key`, and the run and token ids the read API exposes
  (`run_id`, `token_id`).
- Resend identifiers (`msg_…`, email ids) are stored verbatim as `text`.
- Email addresses are normalized (trimmed, lowercased) by one function in `packages/core` before
  they are hashed or masked.
- `jsonb` only for the raw event payload, the outbox payload and the local queue envelope. Anything
  a query filters on, or a projection reads, is a typed column.
- Migrations are expand/contract only. A migration is frozen once merged to `main` or applied to
  a kept database, and never edited after that (Ask first); before that, it is regenerated freely.
  A contract step carries the marker [ADR-018](architecture.md#adr-018--migrations-run-from-the-deploy-command-before-the-code-that-needs-them)
  names.
- Every database access goes through `packages/db` repositories. All SQL is pooler-safe
  ([integrations.md → How it is used](integrations.md#decision--neon)).

### Anti-patterns (MUST NOT)

- Deduplicating events on anything but `svix_id` (for example `(email_id, type)` or the SQS
  `messageId`).
- Updating or deleting `webhook_events` rows outside the retention job.
- Patching a projection incrementally (`SET status = $new`) instead of recomputing it.
- Ordering anything that feeds a projection by `received_at`, insertion order or `id`.
- A projection column with no source in the event set.
- Deriving one recipient's outcome from another recipient's event, for example by applying a bounce
  to every address in the email's first-seen `to` list.
- Foreign keys from `webhook_events` to projections, or cascades from projections to the ledger.
- Performing a side effect in the worker transaction instead of writing an outbox row.
- A raw email address, subject or display name in any column other than `webhook_events.payload`.
  That includes `dedupe_key`, `outbox.payload`, `last_error` and every projection.
- An unkeyed hash of an address. Addresses are low-entropy, so a plain SHA-256 is reversible by
  dictionary.
- A plaintext token at rest.
- A `tenant_id` column or any multi-tenant plumbing.
- Secrets, API keys or signing secrets in any table.
- Real recipient addresses in fixtures, seeds, migrations or docs.

### PII & retention

Payloads hold personal data: addresses, subjects, click IPs and user agents, and bounce diagnostics
(RS-27–RS-29). This repo is public, and PII exposure through any surface is never tolerable
([about.md → Risk appetite](about.md#risk-appetite)). The rule is **raw only in the ledger payload;
everywhere else, a hash for lookup and a mask for display** (owner, 2026-10-15).

**Address hash.** `address_hash = <key_id>.<hex HMAC-SHA-256(key, normalize(address))>`.
`key_id` is the first 8 hex characters of `HMAC-SHA-256(key, "ledger:key-id")`. The key is 32
random bytes held by the deployer:
- It lives next to the database URL in `.env.local`, is generated once by the setup script, and is
  placed in the `ledger/database` secret by the deploy command
  ([integrations.md → Secrets layout](integrations.md#secrets-layout)).
- It is deployer-held because the Neon database outlives the teardown command
  ([integrations.md → Decision](integrations.md#decision--neon)). A key generated per deploy would
  orphan every stored hash.
- The deploy command MUST refuse a key whose `key_id` differs from a stored hash's prefix.

A support engineer who knows the address can look it up: the read API normalizes and hashes the
input (`ledger recipient <address>`, [features.md → J2](features.md#j2--support-lookup)). Whoever
holds only a dump of the projections cannot confirm a guessed address; `webhook_events.payload`
holds raw addresses until the retention job masks them
([ADR-014](architecture.md#adr-014--raw-payload-retention-and-redaction)).

**Masks.** A mask is computed by one `packages/core` function and is readable by support, but it
does not identify anyone.

| Input | Rule | Example |
| --- | --- | --- |
| Address, local part | Keep the first `min(3, ⌊n/3⌋)` characters, mask the rest | `delivered@resend.dev` → `del******@r*****.d**` |
| Address, each domain label | Keep the first character, mask the rest | (same) |
| Subject or display name, each word | Keep the first `min(3, ⌊n/3⌋)` characters, mask the rest; spaces and punctuation are kept | `Your invoice is ready` → `Y*** in***** ** r****` |

Every rule masks digits wherever they appear (one-time codes, order numbers), and maps every
control character (C0, DEL, C1) to `*`, so no mask carries a terminal escape into human CLI
output. A mask preserves
length in code points and is **idempotent**: `mask(mask(x)) = mask(x)`. This is what lets
redaction replace a raw value with its mask without changing any projection.

| Location | PII held | Class |
| --- | --- | --- |
| `webhook_events.payload` | Raw `to`, `from`, `subject`, `tags`, click `ipAddress` / `userAgent` / `link`, bounce `message` / `diagnosticCode`, `failed.reason`; in non-email events, contact `email`, `first_name`, `last_name` ([contact.created](https://resend.com/docs/webhooks/contacts/created)) and inbound metadata (RS-30) | Raw until the retention job (slice 7). It then keeps only what projections read: in outbound email events, `type`, `created_at`, `data.email_id`, `data.bounce.type` / `subType`, and `to`, `from`, `subject` replaced by their masks; in every other event type, unknown types included, `type` and `created_at`. Every other field, `tags` included, is nulled ([ADR-014](architecture.md#adr-014--raw-payload-retention-and-redaction)) |
| `webhook_events.to_hashes` | Keyed hashes only | Kept |
| Projections (`email_state`, `email_recipients`, `recipient_state`) | Hashes and masks only | Kept; holds no raw PII to redact |
| `api_tokens` | Token hashes only | Kept; a revoked row stays as an audit record |
| `outbox.payload`, `outbox.dedupe_key`, `last_error` | Ids, hashes and masks only; never a third-party response body | Kept |
| `local_queue_messages.body` | Raw envelope (local mode only) | Deleted on success; a dead row holds it until redriven or purged |
| Logs | None | Allow-listed ids, codes and numbers only ([Log fields](#log-fields)) |

- Fixtures, tests and docs use Resend test addresses only (`delivered@resend.dev`,
  `bounced@resend.dev`).
- The read API, CLI and MCP surface masks and never the raw payload. A route-level redaction test
  in `packages/api`, landing with each route whose mapper reads `webhook_events` or a queue
  envelope (from slice 1), and the redaction tests on MCP tool output in slice 5 check this.
- The retention period N is configurable and owed by slice 7. Resend keeps email data for 30 days
  (RS-31).

**Evidence:** the slice 0 and slice 1 items hold; the slice 2 and 7 items are pending.
- Slice 0: fast-check properties for the masks (idempotent, length-preserving, no digit revealed,
  at most 3 characters revealed per token, no control character), one `it` each in
  [mask-text.prop.test.ts](../packages/core/src/mask-text.prop.test.ts),
  [mask-address.prop.test.ts](../packages/core/src/mask-address.prop.test.ts) and
  [mask-from.prop.test.ts](../packages/core/src/mask-from.prop.test.ts).
- Slice 1: after the worker commits events to `delivered@resend.dev` and `bounced@resend.dev`
  with a `from` and a subject, no text column of any projection row holds either normalized
  address, the raw `from` or the raw subject, in
  [projection-pii.int.test.ts](../packages/worker/src/projection-pii.int.test.ts).
- Slice 2: a deploy-command test that refuses a mismatched `key_id`.
- Slice 7: a rebuild after redaction yields identical projections.

#### Log fields

The canonical log allow-list. Every app logs through the one shared logger, which keeps only these
fields and drops any other, masks included (AWS-29; ids are log fields, never metric dimensions,
AWS-12):

- **Allowed**, by these exact keys: `svix_id`, `email_id`, `type`, `request_id`, `run_id`,
  `token_id` (the `api_tokens.id`, never a token or its hash), `error_name`, `error_code` (a
  [registry](api-contract.md#error-codes) code), `pg_code` (the Postgres SQLSTATE), counts as
  `<name>_count`, durations as `<name>_ms`, `function_name`, `cold_start` and `timestamp`. The
  line's `level` and its message, a constant written in code, never interpolated.
- **Never:** an error's `message` or `detail` from parsing or Postgres (they can quote a row), an
  address or `address_hash`, a subject, request or response headers, a token or secret, the raw
  payload or any part of it.

**Evidence:** slice 1: a logger unit test logs a worker failure whose cause is a `CHECK` violation
(`23514`) quoting a test address, a parse failure quoting a subject, and a payload under a
non-allowed key, and finds no line holding the address or subject, `pg_code` and `error_name`
present, and every non-scalar dropped
([create-logger.test.ts](../packages/shared/src/create-logger.test.ts)).

## Tables

Load-bearing columns only. Every table also carries its
[base fields](#base-fields--the-checklist-for-every-new-model).

### `webhook_events` — the immutable ledger

| Column | Type | Why it matters |
| --- | --- | --- |
| `svix_id` | `text` PK | The `svix-id` header (`msg_…`). The dedupe key for retries, redrives and replays |
| `type` | `text` null, no `CHECK` | One of RS-25, or unknown. Unknown types are stored and counted, never rejected. Null when the payload has no string `type` |
| `event_created_at` | `timestamptz` null | The top-level `created_at` (RS-26). Fold order for projections. Null only on a schema-failing payload, which projections skip |
| `received_at` | `timestamptz`, no default | From the ingest envelope. Lag metric only |
| `email_id` | `text` null | `data.email_id` for the outbound email types (RS-27). Null for every other type. `email.received` carries a `data.email_id` too ([emails/received](https://resend.com/docs/webhooks/emails/received)), but it names an inbound email, so it stays null and projections skip it ([Deferred](#deferred)) |
| `to_hashes` | `text[]` null | Keyed hashes of `data.to`, in the same position. Feeds `email_recipients` after redaction has masked the raw `to` |
| `source` | `text` `CHECK (live, simulated)` | Which secret verified the request. `simulated` only through the simulator secret ([ADR-016](architecture.md#adr-016--the-simulator-reaches-aws-only-through-an-opt-in-simulator-secret)) |
| `payload` | `jsonb` | The parsed `{ type, created_at, data }` body (RS-26), as received minus what Postgres cannot store ([Immutable ledger](#immutable-ledger)). Not the signed bytes |

- **Source values:** `source` has no `replay` value: a replay takes no special path (ADR-007), and
  it is expected to carry the original `svix-id` ([RS-U01](resend.md#unverified), which slice 4
  MUST settle).
- **Indexes:** `(email_id, event_created_at)` for projection loads. The reconcile diff is a
  primary-key lookup on `svix_id` (ADR-007). The retention job's scan index and its `redacted_at`
  column land with it in slice 7.

_Schema: [`packages/db/src/schema/webhook-events.ts`](../packages/db/src/schema/webhook-events.ts)._
_Evidence: the slice 1 schema and worker items hold; the other items are pending._
- Slice 1 (schema): the `source` `CHECK` against `eventSourceSchema` and a duplicate
  `insertIfAbsent` leaving one row, as the runtime role, in
  [webhook-events.repository.int.test.ts](../packages/db/src/webhook-events.repository.int.test.ts).
- Slice 1 (worker): Testcontainers duplicate-insert tests (sequential, concurrent, under a new
  `messageId`) and a crash-between-steps test (a `CHECK (false) NOT VALID` fault commits nothing;
  the redelivery commits one row of everything); NUL and lone-surrogate payloads stored with
  U+FFFD, projected, committed and counted, never dead-lettered; unknown, non-email, inbound,
  schema-failing, array and JSON `null` payloads stored raw on their first receive, in
  [record-event.command.int.test.ts](../packages/worker/src/record-event.command.int.test.ts);
  the typed columns of each unprojectable kind in
  [to-ledger-row.test.ts](../packages/worker/src/to-ledger-row.test.ts).
- Slice 1: sim invariant 1.
- Slice 3: a unit test that a simulator-signed event is stamped `simulated`.
- Slice 4: replays dedupe on `svix_id` (RS-U01).
- Slice 7: a rebuild after redaction yields identical projections.

- **Slices:** 1 — Local ledger and read path; 3 — Operations and evidence on AWS; 4 — Recovery; 7 — Polish and retention

### `email_state` — current state per email

| Column | Type | Why it matters |
| --- | --- | --- |
| `email_id` | `text` PK | The lock target that serializes workers per email (ADR-004) |
| `status` | `text` null + `CHECK` | Outcome precedence over all the email's events, not recency. Terminal negatives outrank `delivered` (ADR-003). The closed set is the outcome-bearing email types of RS-25. Null until the event set holds an outcome event; never inferred from `opened` or `clicked` |
| `from_masked`, `subject_masked` | `text` null | Masks of `data.from` and `data.subject` (RS-27). Readable for support, with no raw PII. Null when no projected event carries `from` / `subject` |
| `open_count`, `click_count`, `first_opened_at`, `first_clicked_at` | `int`, `timestamptz` | Counters keep the state bounded. Opens are not reliable (RS-29) |
| `last_event_at`, `event_count` | `timestamptz`, `int` | Freshness, and the rebuild check |

- **Row creation:** a row is created on first sight (`INSERT … ON CONFLICT DO NOTHING`, then
  `SELECT … FOR UPDATE`).
- **Bounce detail:** per-recipient detail (`bounce_type`, `bounce_sub_type`) lives in
  `email_recipients`.

_Schema: [`packages/db/src/schema/email-state.ts`](../packages/db/src/schema/email-state.ts)._
_Evidence: the slice 0 item and the slice 1 schema and worker items hold; the other slice 1 item is pending._
- Slice 0: fast-check permutation, idempotence, monotonicity and oracle properties, one `it` each
  in [project-email.projection.prop.test.ts](../packages/core/src/project-email.projection.prop.test.ts).
- Slice 1 (schema): the `status` `CHECK` against `emailStatusSchema`, as the runtime role, in
  [email-state.repository.int.test.ts](../packages/db/src/email-state.repository.int.test.ts).
- Slice 1 (worker): the committed row equals `projectEmail` over the stored events after
  out-of-order arrival, duplicates and a redelivery after a fault, in
  [record-event.command.int.test.ts](../packages/worker/src/record-event.command.int.test.ts).
- Slice 1: sim invariant 2 under `--shuffle`.

- **Slices:** 0 — Foundations; 1 — Local ledger and read path; 5 — MCP server and contract hardening

### `email_recipients` — outcome per email and recipient

| Column | Type | Why it matters |
| --- | --- | --- |
| `email_id`, `address_hash` | `text`, composite PK | One row per recipient of an email |
| `address_masked` | `text` | What support sees |
| `status` | `text` null + `CHECK` | The same closed set as `email_state.status`, null likewise, folded only from events whose own `data.to` lists this recipient |
| `status_at` | `timestamptz` null | The `event_created_at` of the deciding event |
| `bounce_type`, `bounce_sub_type` | `text` null | From `data.bounce` (RS-28), open strings. A hard bounce is `Permanent` only (RS-35) |
| `sticky_signal` | `text` null + `CHECK (hard_bounced, suppressed, complained)` | The strongest sticky signal among the row's own events (a `Permanent` bounce, `email.suppressed`, `email.complained`), ranked `hard_bounced` > `suppressed` > `complained`, earliest on ties. `recipient_state` reads it, never `status`: a later `failed` or soft bounce outranks `suppressed` or `complained` in `status` and would hide it |
| `sticky_signal_at`, `sticky_signal_svix_id` | `timestamptz`, `text` null | That event's `event_created_at` and `svix_id`: the `recipient_state` recompute's tie-break keys |
| `soft_signal` | `text` null + `CHECK (delivered, bounced)` | The latest of the row's `email.delivered` and non-`Permanent` `email.bounced` events by `event_created_at`, `rank` and `svix_id`, so a soft bounce clears on a later delivery although `bounced` outranks `delivered` in `status` |
| `soft_signal_at`, `soft_signal_svix_id` | `timestamptz`, `text` null | That event's `event_created_at` and `svix_id` |

- **Indexes:** `(address_hash)` btree for the per-address recompute of `recipient_state`.
- **Locking:** the row is written under the email's lock.

_Schema: [`packages/db/src/schema/email-recipients.ts`](../packages/db/src/schema/email-recipients.ts)._
_Evidence: the slice 0 item and the slice 1 schema and worker items hold; the other slice 1 items are pending._
- Slice 0: a property test that a two-recipient email whose bounce names one recipient leaves the
  other recipient's outcome unchanged, in
  [project-email.projection.prop.test.ts](../packages/core/src/project-email.projection.prop.test.ts).
- Slice 1 (schema): the `status`, `sticky_signal` and `soft_signal` `CHECK`s against their core
  tuples, as the runtime role, in
  [email-recipients.repository.int.test.ts](../packages/db/src/email-recipients.repository.int.test.ts).
- Slice 1 (worker): the committed rows equal `projectEmail`'s recipients over the stored events,
  in any arrival order, in
  [record-event.command.int.test.ts](../packages/worker/src/record-event.command.int.test.ts).
- Slice 1: sim invariant 2; RS-U21 settled by the Ask-first two-recipient send.

- **Slices:** 0 — Foundations; 1 — Local ledger and read path

### `recipient_state` — deliverability per address

| Column | Type | Why it matters |
| --- | --- | --- |
| `address_hash` | `text` PK | What the API looks up after hashing the caller's input |
| `address_masked` | `text` | What support sees |
| `deliverability` | `text` `CHECK (ok, soft_bouncing, hard_bounced, complained, suppressed)` | What an application checks before sending. `hard_bounced`, `complained` and `suppressed` are sticky; `soft_bouncing` clears to `ok` on a `delivered` later by `event_created_at`, `rank` and `svix_id` breaking ties, so the result is the same in any arrival order. Only `bounce.type` exactly `Permanent` is `hard_bounced`; every other bounce (`Transient`, `Temporary`, `Undetermined`, any other string, no `bounce` object) is `soft_bouncing`, so the result does not depend on RS-U12's answer |
| `since` | `timestamptz` null | From `event_created_at`, never row time. Null while `ok` was decided by no event |
| `cause_email_id` | `text` null | The email that caused the transition ([features.md → J2](features.md#j2--support-lookup)). Null while `ok` was decided by no event |

- **Recompute:** each recompute reads every `email_recipients` row for the hash, under a lock taken
  in sorted `address_hash` order after the email lock
  ([architecture.md → Risks](architecture.md#risks--mitigations)).
- **Fold:** from the rows' signal columns, never their `status`, which a later `failed` or soft
  bounce lifts past a sticky outcome. Any `sticky_signal` → the highest by `hard_bounced` >
  `suppressed` > `complained`, its earliest by `sticky_signal_at`, `rank` and
  `sticky_signal_svix_id` giving `since` and `cause_email_id`. Else the latest `soft_signal` by
  `soft_signal_at`, `rank` and `soft_signal_svix_id`: `delivered` → `ok`, `bounced` →
  `soft_bouncing`. Else `ok`, with `since` and `cause_email_id` null.

_Schema: [`packages/db/src/schema/recipient-state.ts`](../packages/db/src/schema/recipient-state.ts)._
_Evidence: the slice 0 item and the slice 1 schema and concurrency items hold; the other items are pending._
- Slice 0: fast-check permutation, idempotence, sticky-monotonicity and oracle properties, one `it`
  each, with the tests that a hard bounce comes from `Permanent` only (RS-U12) and that a later
  delivery clears `soft_bouncing`, in
  [project-recipient.projection.prop.test.ts](../packages/core/src/project-recipient.projection.prop.test.ts).
- Slice 1 (schema): the `deliverability` `CHECK` against `deliverabilitySchema`, as the runtime
  role, in [recipient-state.repository.int.test.ts](../packages/db/src/recipient-state.repository.int.test.ts).
- Slice 1: a concurrency integration test with two emails sharing recipients in opposite
  `data.to` order, interleaved both ways by polling `pg_stat_activity`: both commit and every row
  equals `projectRecipient` over its `email_recipients` rows; an event naming one recipient leaves
  the other's row unchanged, in
  [record-event.command.int.test.ts](../packages/worker/src/record-event.command.int.test.ts).
- Slice 2: the same test through the pooler (PG-U02).
- Slices 1 and 3: sim invariant 2.

- **Slices:** 0 — Foundations; 1 — Local ledger and read path; 5 — MCP server and contract hardening

### `api_tokens` — read API bearer tokens

| Column | Type | Why it matters |
| --- | --- | --- |
| `id` | identity `bigint` | Revocation target |
| `name` | `text` | The operator's label |
| `token_hash` | `text` UNIQUE | SHA-256 of the token. A token is `ldg_`, 32 random bytes and an HMAC tag ([api-contract.md → Conventions](api-contract.md#conventions)); the random part makes an unkeyed hash sufficient; no plaintext at rest |
| `bootstrap` | `boolean` not null, default `false`, partial UNIQUE `WHERE bootstrap` | Marks the deploy command's first `operate` token, so a re-run inserts none ([Idempotency keys](#idempotency-keys)) |
| `scope` | `text` `CHECK (read, operate)` | The [ADR-011](architecture.md#adr-011--one-contract-many-surfaces) scopes |
| `revoked_at` | `timestamptz` null | Set once. A revoked token is rejected on the next request while the database is reachable, with no redeploy. During an outage only `health.get` answers, on the token's tag alone ([api-contract.md → Conventions](api-contract.md#conventions)) |

- **Issuance:** the deploy command inserts the first `operate` token, with `bootstrap = true` and
  `ON CONFLICT DO NOTHING`, through the direct URL it already holds (ADR-018), and prints it once,
  only when the insert happened. This adds no secret and no idle cost (AWS-11). To replace a lost
  or leaked first token, the deploy command takes `--issue-operate-token <name>`, which mints a new
  `operate` token through the same path whatever tokens exist.
- **Mint home:** token minting and the tag check live in `packages/shared`
  ([ADR-013](architecture.md#adr-013--pure-core-and-local-mode)). Three callers share them:
  `packages/api` (`token.create`), the deploy command and the local setup command.
- **Operations:** `token.create`, `token.list`, `token.revoke` (`operate`) and `token.getCurrent`
  (`read`), with no MCP surface ([api-contract.md](api-contract.md#tokencreate)).

_Schema: `packages/db/src/schema/api-tokens.ts` (once it exists)._
_Evidence: pending (slice 2)._
- A revoked token gets `401`.
- A `read` token gets `403` on an `operate` route.
- A re-run deploy command inserts no second first-token, and `--issue-operate-token` mints exactly one new one.

- **Slices:** 2 — Durable ingest on AWS

### `reconcile_runs` — one row per recovery run

| Column | Type | Why it matters |
| --- | --- | --- |
| `id` | identity `bigint` | Run id in `ledger gaps` output |
| `trigger`, `dry_run` | `text` `CHECK (scheduled, manual)`, `boolean` | Hourly cron or on demand (ADR-007). `ledger reconcile --dry-run` replays nothing |
| `started_at`, `finished_at` | `timestamptz` | A run with no `finished_at` past its time budget is abandoned (it crashed or its invoke was lost), never a running one. `reconcile.getRun` and `gaps.list` derive `run_abandoned` on read; it is never written to the row |
| `claimed_at` | `timestamptz` null | Set once by the invoked reconciler before any Resend call. A second invoke of the same run finds it set and exits without work (AWS-53) |
| `horizon_start`, `horizon_end` | `timestamptz` | The lookback horizon and the grace boundary actually checked (ADR-007) |
| `checked`, `missing`, `replayed`, `failed` | `int` | `missing > 0` is the loss signal |
| `error_code` | `text` null | Why a run stopped, as a registered error code (for example `webhook_disabled`) |

- **Start:** one transaction takes `pg_advisory_xact_lock` on a fixed key (transaction-scoped, so
  pooler-safe), then checks for an unfinished run inside its time budget with a statement issued
  after the lock, then inserts the new row. Locking the newest run row instead does not serialize
  starts under READ COMMITTED: the waiter re-reads the row it locked, not the new one.
- **Claim:** async invoke is at-least-once (AWS-53), so the start transaction alone does not keep
  one run from executing twice. The reconciler first runs
  `UPDATE reconcile_runs SET claimed_at = now() WHERE id = $1 AND claimed_at IS NULL`; zero rows
  means a duplicate invoke, which exits without work. The invoke sets `MaximumRetryAttempts: 0`,
  so a lost invoke reads abandoned and the next hourly run covers its horizon.
- **Time budget:** one constant, shared by the start check and the `run_abandoned` derivation
  ([api-contract.md → Error codes](api-contract.md#error-codes)).

_Schema: `packages/db/src/schema/reconcile-runs.ts` (once it exists)._
_Evidence: pending._
- Slice 4: a fake-API integration test where an outage outlasts the retry schedule. It expects
  100 % recovered and 0 duplicates.
- Slice 4: a disabled webhook writes `error_code = webhook_disabled`.
- Slice 4: a second invoke of a claimed run makes no Resend call; a run with no `finished_at` past
  its time budget reads `run_abandoned`.

- **Slices:** 4 — Recovery

### `local_queue_messages` — the local-mode queue

| Column | Type | Why it matters |
| --- | --- | --- |
| `id` | identity `bigint` | Claim order. Not an ordering guarantee anything relies on (ADR-003) |
| `body` | `jsonb` | The same envelope ingest puts on SQS |
| `visible_at`, `receive_count` | `timestamptz`, `int` | The visibility timeout and the `maxReceiveCount` threshold, mirroring SQS (AWS-08, AWS-09) |
| `dead_at` | `timestamptz` null | Set past `maxReceiveCount`. Mirrors the DLQ, so inspect and redrive work locally (ADR-008) |

- **Claiming:** a row is claimed in its own short transaction (`FOR UPDATE SKIP LOCKED`,
  `receive_count + 1`, `visible_at` = now + the visibility timeout, commit), processed in the
  ledger transaction, then deleted, so a failed attempt never rolls back its count. This is
  pooler-safe ([ADR-013](architecture.md#adr-013--pure-core-and-local-mode)).
- **Idempotency:** this table has no idempotency key by design. Delivery is at-least-once, exactly
  as with SQS, and the worker dedupes on `svix_id`.
- **Scope:** never used in the AWS deployment.

_Schema: `packages/db/src/schema/local-queue.ts` (once it exists)._
_Evidence: pending._
- Slice 2B: sim invariants pass in local mode.
- Slice 2B: a poison message reaches `dead_at` after `maxReceiveCount`.

- **Slices:** 2B — Local-mode queue and docker compose

### `outbox` — reactions awaiting delivery

| Column | Type | Why it matters |
| --- | --- | --- |
| `id` | identity `bigint` | Claim target for the dispatcher |
| `dedupe_key` | `text` UNIQUE | `<rule>:<svix_id>[:<address_hash>]`, with no raw address. Exactly-once effects; source of the `Idempotency-Key` |
| `svix_id` | `text` | The causing event. No foreign key |
| `kind` | `text` `CHECK (app_callback, alert_email)` | ADR-006 |
| `payload` | `jsonb` | What the dispatcher sends: ids, `type`, hashes and masks, never raw PII |
| `status` | `text` `CHECK (pending, sent, dead)` | `dead` after the cap, or past the 24 h idempotency horizon for alert emails ([resend.md → Constraint 8](resend.md#constraints-and-sharp-edges)) |
| `attempts`, `next_attempt_at`, `last_error` | `int`, `timestamptz`, `text` | Retry with backoff. The hourly sweep claims due rows (ADR-017). `last_error` holds a status and an error name, never a response body |

- **Writes:** rows are written only in the worker transaction of the event that caused them. A row
  caused by a `source = simulated` event is dispatched only to the simulator's receiver sink
  ([ADR-006](architecture.md#adr-006--transactional-outbox-for-reactions)).
- **Operational alerts:** reconcile gaps, DLQ depth and queue age go through CloudWatch → SNS
  (slice 3), never through the outbox.
- **Indexes:** a partial index on `next_attempt_at` where `status = 'pending'`, for the sweep.

_Schema: `packages/db/src/schema/outbox.ts` (once it exists)._
_Evidence: pending (slice 6)._
- `--chaos worker-crash` and `--chaos dispatcher-crash` produce no second effect at a receiver (sim invariant 3).
- An invoke dropped after commit is delivered by the sweep, once.
- A retry-horizon unit test.

- **Slices:** 6 — Reactions

## Modeling something new

1. Name the idempotency key first. No key, no table, unless at-least-once is deliberate and a key
   downstream absorbs it (as `local_queue_messages` relies on `svix_id`).
2. Classify the table: ledger, projection (derived, rebuildable), outbox, ops record, credential
   record or queue.
3. Apply the [base fields](#base-fields--the-checklist-for-every-new-model) and the
   [conventions](#modeling-conventions-canonical), then check every
   [anti-pattern](#anti-patterns-must-not).
4. Classify every PII column in [PII & retention](#pii--retention). An address becomes a hash plus
   a mask.
5. Add the Model index row (`[ ]`), then the `###` entry with its evidence lines and its `Slices:`
   line.
6. Tick `Modeled` in the change that lands the migration.

## Open questions

- **Recipients listed in `data.to` per event ([RS-U21](resend.md#unverified)).** Does a bounce
  (or a complaint or delivery) on a multi-recipient email list only the impacted recipients? RS-27
  says so, and `email_recipients` is exact under that reading. If the list were complete, no
  projection could pin a bounce to one recipient. Slice 1 MUST settle it with one Ask-first
  two-recipient send. Observed 2026-10-17: from `onboarding@resend.dev` with no verified domain,
  Resend kept only the first recipient (a second `to` and a `cc` were dropped), so that send cannot
  produce a multi-recipient email; it needs a verified sending domain
  ([about.md → Project domain](about.md#open-questions), owner decision). `[Unverified]`

## Deferred

| Defer | Kind | Because | Tripwire |
| --- | --- | --- | --- |
| Projections for contact, domain, topic and inbox events | temporal | Stored raw in `webhook_events`; no consumer ([architecture.md → Deferred](architecture.md#deferred-yagni)) | An [api-contract.md](api-contract.md) operation or a reaction rule that reads contact, domain or topic state |
| Inbound email projection, and `email_id` for `email.received` | temporal | `email.received` carries metadata only (RS-30); stored raw | M2 done **and** a row in [What this project must demonstrate](about.md#what-this-project-must-demonstrate) names inbound email |
| Address-hash key rotation | temporal | After redaction, a hash cannot be recomputed, so redacted rows can never be re-keyed. A leaked key reduces every stored hash to an unkeyed one, which a dictionary reverses ([Anti-patterns](#anti-patterns-must-not)), so a leaked key plus a database dump re-identifies redacted rows; unredacted rows already hold the raw address. `key_id` lets new rows use a new key | The key is suspected leaked, or an adopter asks to rotate it |
| Per-tenant columns | categorical | One installation, one team ([architecture.md → Deferred (YAGNI)](architecture.md#deferred-yagni)) | Superseding ADR only |
