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
| [`webhook_events`](#webhook_events--the-immutable-ledger) | One row per Resend event, ever | Ledger | Append-only; the retention job masks PII in `payload` | 1 — Local ledger and read path | [ ] |
| [`email_state`](#email_state--current-state-per-email) | Current state per email | Projection | Recomputed | 1 — Local ledger and read path | [ ] |
| [`email_recipients`](#email_recipients--outcome-per-email-and-recipient) | Outcome per email and recipient | Projection | Recomputed | 1 — Local ledger and read path | [ ] |
| [`recipient_state`](#recipient_state--deliverability-per-address) | Deliverability per address | Projection | Recomputed | 1 — Local ledger and read path | [ ] |
| [`api_tokens`](#api_tokens--read-api-bearer-tokens) | Read API bearer tokens, hashed | Credential record | Insert, then revoke once | 2 — Durable ingest on AWS | [ ] |
| [`reconcile_runs`](#reconcile_runs--one-row-per-recovery-run) | One row per recovery run | Ops record | Insert, then finish once | 4 — Recovery | [ ] |
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
| `email_state.email_id`, `email_recipients (email_id, address_hash)`, `recipient_state.address_hash` (PKs) | Concurrent workers on one key | Upsert under `SELECT … FOR UPDATE`: the email row first, then recipient rows in sorted `address_hash` order |
| `outbox.dedupe_key` (UNIQUE) | Worker retries re-emitting a reaction | Unique constraint; the Resend `Idempotency-Key` is derived from it ([ADR-006](architecture.md#adr-006--transactional-outbox-for-reactions), RS-24) |
| `api_tokens.token_hash` (UNIQUE) | A token inserted twice by a re-run deploy command | Unique constraint |

A unique key MUST live in the migration, not only in the Drizzle schema file. The SQS `messageId`
is never a key, because a redrive changes it (AWS-21).

### Timestamps & ordering

- `event_created_at` is the payload's top-level `created_at`, "when the webhook event was created"
  (RS-26). `received_at` is when Ledger got the event.
- Projections, and every "since", "first" or "last" value, MUST use `event_created_at`. Ordering by
  `received_at`, insertion order or a surrogate id is a correctness bug. Whether `created_at`
  tracks the real event time does not matter: it is used only as a sort key, with `rank` and
  `svix_id` as tie-breaks (RS-U10, ADR-003).
- `received_at` is for lag metrics and operator forensics only.
- All timestamps are `timestamptz`, stored in UTC.

### Base fields — the checklist for every new model

| Field | Include when | Notes |
| --- | --- | --- |
| Natural PK (`svix_id`, `email_id`, `address_hash`) | **MUST** when the row is keyed by an external identity | The PK is the idempotency key |
| `id` (`bigint GENERATED ALWAYS AS IDENTITY`) | **MUST** when there is no natural key (`outbox`, `reconcile_runs`, `api_tokens`, `local_queue_messages`) | Never a public identifier, never a sort key for anything a projection reads |
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
  (`svix_id`, `email_id`) or the outbox `dedupe_key`.
- Resend identifiers (`msg_…`, email ids) are stored verbatim as `text`.
- Email addresses are normalized (trimmed, lowercased) by one function in `packages/core` before
  they are hashed or masked.
- `jsonb` only for the raw event payload, the outbox payload and the local queue envelope. Anything
  a query filters on, or a projection reads, is a typed column.
- Migrations are expand/contract only. A pushed migration is never edited (Ask first).
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
- It is deployer-held because the Neon database outlives `cdk destroy --all`
  ([integrations.md → Decision](integrations.md#decision--neon)). A key generated per deploy would
  orphan every stored hash.
- The deploy command MUST refuse a key whose `key_id` differs from a stored hash's prefix.

A support engineer who knows the address can look it up: the read API normalizes and hashes the
input (`ledger recipient <address>`, [features.md → J2](features.md#j2--support-lookup)). Whoever
holds only a database dump cannot confirm a guessed address.

**Masks.** A mask is computed by one `packages/core` function and is readable by support, but it
does not identify anyone.

| Input | Rule | Example |
| --- | --- | --- |
| Address, local part | Keep the first `min(3, ⌊n/3⌋)` characters, mask the rest | `delivered@resend.dev` → `del******@r*****.d**` |
| Address, each domain label | Keep the first character, mask the rest | (same) |
| Subject or display name, each word | Keep the first `min(3, ⌊n/3⌋)` characters, mask the rest; spaces and punctuation are kept | `Your invoice is ready` → `Y*** in***** ** r****` |

Every rule masks digits wherever they appear (one-time codes, order numbers). A mask preserves
length in code points and is **idempotent**: `mask(mask(x)) = mask(x)`. This is what lets
redaction replace a raw value with its mask without changing any projection.

| Location | PII held | Class |
| --- | --- | --- |
| `webhook_events.payload` | Raw `to`, `from`, `subject`, click `ipAddress` / `userAgent` / `link`, bounce `message` / `diagnosticCode`, `failed.reason` | Raw until the retention job (slice 7). It then masks `to`, `from` and `subject`, and nulls every other listed field, since no projection reads them ([ADR-014](architecture.md#adr-014--raw-payload-retention-and-redaction)) |
| `webhook_events.to_hashes` | Keyed hashes only | Kept |
| Projections (`email_state`, `email_recipients`, `recipient_state`) | Hashes and masks only | Kept; holds no raw PII to redact |
| `api_tokens` | Token hashes only | Kept; a revoked row stays as an audit record |
| `outbox.payload`, `outbox.dedupe_key`, `last_error` | Ids, hashes and masks only; never a third-party response body | Kept |
| `local_queue_messages.body` | Raw envelope (local mode only) | Deleted on success; a dead row holds it until redriven or purged |
| Logs | None | Log `svix_id`, `email_id`, `type`. MUST NOT log addresses, subjects or bodies (AWS-29) |

- Fixtures, tests and docs use Resend test addresses only (`delivered@resend.dev`,
  `bounced@resend.dev`).
- The read API, CLI and MCP surface masks and never the raw payload. The redaction tests on MCP tool
  output in slice 5 check this.
- The retention period N is configurable and owed by slice 7. Resend keeps email data for 30 days
  (RS-31).

**Evidence:** pending.
- Slice 0: fast-check properties for the masks (idempotent, length-preserving, no digit revealed,
  at most 3 characters revealed per token).
- Slice 1: an invariant that no projection column holds a raw input address or subject.
- Slice 2: a deploy-command test that refuses a mismatched `key_id`.
- Slice 7: a rebuild after redaction yields identical projections.

## Tables

Load-bearing columns only. Every table also carries its
[base fields](#base-fields--the-checklist-for-every-new-model).

### `webhook_events` — the immutable ledger

| Column | Type | Why it matters |
| --- | --- | --- |
| `svix_id` | `text` PK | The `svix-id` header (`msg_…`). The dedupe key for retries, redrives and replays |
| `type` | `text`, no `CHECK` | One of RS-25, or unknown. Unknown types are stored and counted, never rejected |
| `event_created_at` | `timestamptz` | The top-level `created_at` (RS-26). Fold order for projections |
| `received_at` | `timestamptz` | From the ingest envelope. Lag metric only |
| `email_id` | `text` null | `data.email_id` for the outbound email types (RS-27). Null for every other type, `email.received` included (RS-30) |
| `to_hashes` | `text[]` null | Keyed hashes of `data.to`, in the same position. Feeds `email_recipients` after redaction has masked the raw `to` |
| `source` | `text` `CHECK (live, simulated)` | Which secret verified the request. `simulated` only through the simulator secret ([ADR-016](architecture.md#adr-016--the-simulator-reaches-aws-only-through-an-opt-in-simulator-secret)) |
| `payload` | `jsonb` | The parsed `{ type, created_at, data }` body (RS-26). Not the signed bytes |

- **Source values:** a replay is indistinguishable from a live delivery, because it carries the
  original `svix-id` and takes no special path (ADR-007). So `source` has no `replay` value.
- **Indexes:** `(email_id, event_created_at)` for projection loads. The reconcile diff is a
  primary-key lookup on `svix_id` (ADR-007). The retention job's scan index and its `redacted_at`
  column land with it in slice 7.

_Schema: `packages/db/src/schema/webhook-events.ts` (once it exists)._
_Evidence: pending._
- Slice 1: Testcontainers duplicate-insert and crash-between-steps tests; sim invariant 1.
- Slice 3: a unit test that a simulator-signed event is stamped `simulated`.
- Slice 4: replays dedupe on `svix_id` (RS-U01).
- Slice 7: a rebuild after redaction yields identical projections.

- **Slices:** 1 — Local ledger and read path; 3 — Operations and evidence on AWS; 4 — Recovery; 7 — Polish and retention

### `email_state` — current state per email

| Column | Type | Why it matters |
| --- | --- | --- |
| `email_id` | `text` PK | The lock target that serializes workers per email (ADR-004) |
| `status` | `text` + `CHECK` | Outcome precedence over all the email's events, not recency. Terminal negatives outrank `delivered` (ADR-003). The closed set is the outcome-bearing email types of RS-25 |
| `from_masked`, `subject_masked` | `text` | Masks of `data.from` and `data.subject` (RS-27). Readable for support, with no raw PII |
| `open_count`, `click_count`, `first_opened_at`, `first_clicked_at` | `int`, `timestamptz` | Counters keep the state bounded. Opens are not reliable (RS-29) |
| `last_event_at`, `event_count` | `timestamptz`, `int` | Freshness, and the rebuild check |

- **Row creation:** a row is created on first sight (`INSERT … ON CONFLICT DO NOTHING`, then
  `SELECT … FOR UPDATE`).
- **Bounce detail:** per-recipient detail (`bounce_type`, `bounce_sub_type`) lives in
  `email_recipients`.

_Schema: `packages/db/src/schema/email-state.ts` (once it exists)._
_Evidence: pending._
- Slice 0: fast-check permutation, idempotence, monotonicity and oracle properties.
- Slice 1: sim invariant 2 under `--shuffle`.

- **Slices:** 0 — Foundations; 1 — Local ledger and read path; 5 — MCP server and contract hardening

### `email_recipients` — outcome per email and recipient

| Column | Type | Why it matters |
| --- | --- | --- |
| `email_id`, `address_hash` | `text`, composite PK | One row per recipient of an email |
| `address_masked` | `text` | What support sees |
| `status` | `text` + `CHECK` | The same closed set as `email_state.status`, folded only from events whose own `data.to` lists this recipient |
| `status_at` | `timestamptz` | The `event_created_at` of the deciding event |
| `bounce_type`, `bounce_sub_type` | `text` null | From `data.bounce` (RS-28). A hard bounce is `Permanent` only (RS-U12) |

- **Indexes:** `(address_hash)` btree for the per-address recompute of `recipient_state`.
- **Locking:** the row is written under the email's lock.

_Schema: `packages/db/src/schema/email-recipients.ts` (once it exists)._
_Evidence: pending._
- Slice 0: a property test that a two-recipient email whose bounce names one recipient leaves the
  other recipient's outcome unchanged.
- Slice 1: sim invariant 2; RS-U21 settled by the Ask-first two-recipient send.

- **Slices:** 0 — Foundations; 1 — Local ledger and read path

### `recipient_state` — deliverability per address

| Column | Type | Why it matters |
| --- | --- | --- |
| `address_hash` | `text` PK | What the API looks up after hashing the caller's input |
| `address_masked` | `text` | What support sees |
| `deliverability` | `text` `CHECK (ok, soft_bouncing, hard_bounced, complained, suppressed)` | What an application checks before sending ([idea §5.4](../docs/idea.md#54-order-independent-projections)) |
| `since` | `timestamptz` | From `event_created_at`, never row time |
| `cause_email_id` | `text` | The email that caused the transition ([features.md → J2](features.md#j2--support-lookup)) |

- **Recompute:** each recompute reads every `email_recipients` row for the hash, under a lock taken
  in sorted `address_hash` order after the email lock
  ([architecture.md → Risks](architecture.md#risks--mitigations)).

_Schema: `packages/db/src/schema/recipient-state.ts` (once it exists)._
_Evidence: pending._
- Slice 0: a property test that a hard bounce comes from `Permanent` only.
- Slice 1: a concurrency integration test with two emails and one recipient.
- Slice 2: the same test through the pooler (PG-U02).

- **Slices:** 0 — Foundations; 1 — Local ledger and read path; 5 — MCP server and contract hardening

### `api_tokens` — read API bearer tokens

| Column | Type | Why it matters |
| --- | --- | --- |
| `id` | identity `bigint` | Revocation target |
| `name` | `text` | The operator's label |
| `token_hash` | `text` UNIQUE | SHA-256 of the token. Tokens are 32 random bytes, so an unkeyed hash suffices; no plaintext at rest |
| `scope` | `text` `CHECK (read, operate)` | The [ADR-011](architecture.md#adr-011--one-contract-many-surfaces) scopes |
| `revoked_at` | `timestamptz` null | Set once. A revoked token is rejected on the next request, with no redeploy |

- **Issuance:** the deploy command inserts the first `operate` token through the direct URL it
  already holds (ADR-018), and prints it once. This adds no secret and no idle cost (AWS-11).
- **Operations:** the token operations and their surfaces are owned by
  [api-contract.md](api-contract.md).

_Schema: `packages/db/src/schema/api-tokens.ts` (once it exists)._
_Evidence: pending (slice 2)._
- A revoked token gets `401`.
- A `read` token gets `403` on an `operate` route.
- A re-run deploy command inserts no second first-token.

- **Slices:** 2 — Durable ingest on AWS

### `reconcile_runs` — one row per recovery run

| Column | Type | Why it matters |
| --- | --- | --- |
| `id` | identity `bigint` | Run id in `ledger gaps` output |
| `trigger`, `dry_run` | `text` `CHECK (scheduled, manual)`, `boolean` | Hourly cron or on demand (ADR-007). `ledger reconcile --dry-run` replays nothing |
| `started_at`, `finished_at` | `timestamptz` | A run with no `finished_at` past its time budget is a crashed run, never a running one |
| `horizon_start`, `horizon_end` | `timestamptz` | The lookback horizon and the grace boundary actually checked (ADR-007) |
| `checked`, `missing`, `replayed`, `failed` | `int` | `missing > 0` is the loss signal |
| `error_code` | `text` null | Why a run stopped, as a registered error code (for example `webhook_disabled`) |

_Schema: `packages/db/src/schema/reconcile-runs.ts` (once it exists)._
_Evidence: pending._
- Slice 4: a fake-API integration test where an outage outlasts the retry schedule. It expects
  100 % recovered and 0 duplicates.
- Slice 4: a disabled webhook writes `error_code = webhook_disabled`.

- **Slices:** 4 — Recovery

### `local_queue_messages` — the local-mode queue

| Column | Type | Why it matters |
| --- | --- | --- |
| `id` | identity `bigint` | Claim order. Not an ordering guarantee anything relies on (ADR-003) |
| `body` | `jsonb` | The same envelope ingest puts on SQS |
| `visible_at`, `receive_count` | `timestamptz`, `int` | The visibility timeout and the `maxReceiveCount` threshold, mirroring SQS (AWS-08, AWS-09) |
| `dead_at` | `timestamptz` null | Set past `maxReceiveCount`. Mirrors the DLQ, so inspect and redrive work locally (ADR-008) |

- **Claiming:** rows are claimed with `FOR UPDATE SKIP LOCKED` inside one transaction, which is
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

- **Writes:** rows are written only in the worker transaction of the event that caused them.
- **Operational alerts:** reconcile gaps, DLQ depth and queue age go through CloudWatch → SNS
  (slice 3), never through the outbox.
- **Indexes:** a partial index on `next_attempt_at` where `status = 'pending'`, for the sweep.

_Schema: `packages/db/src/schema/outbox.ts` (once it exists)._
_Evidence: pending (slice 6)._
- `--chaos worker-crash` yields no duplicate dispatch (sim invariant 3).
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
  two-recipient send. `[Unverified]`

## Deferred

| Defer | Kind | Because | Tripwire |
| --- | --- | --- | --- |
| Projections for contact, domain, topic and inbox events | temporal | Stored raw in `webhook_events`; no consumer ([architecture.md → Deferred](architecture.md#deferred-yagni)) | An [api-contract.md](api-contract.md) operation or a reaction rule that reads contact, domain or topic state |
| Inbound email projection, and `email_id` for `email.received` | temporal | `email.received` carries metadata only (RS-30); stored raw | M2 done **and** a row in [What this project must demonstrate](about.md#what-this-project-must-demonstrate) names inbound email |
| Address-hash key rotation | temporal | After redaction, a hash cannot be recomputed. A leaked key only weakens the hash to unkeyed strength, so it exposes no raw data. `key_id` makes a later multi-key scheme possible | The key is suspected leaked, or an adopter asks to rotate it |
| Per-tenant columns | categorical | One installation, one team ([architecture.md → Deferred (YAGNI)](architecture.md#deferred-yagni)) | Superseding ADR only |
