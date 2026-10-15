# Data modeling

> **TEMPLATE — not ratified.** Bootstrap step 8 in [bootstrap-checklist.md](bootstrap-checklist.md). The preview content below is illustrative, drafted from [docs/idea.md](../docs/idea.md) without research. Nothing here is binding until this banner and the instructions comment are removed.

<!-- AGENT INSTRUCTIONS
Purpose: the modeling principles every table obeys, and each table's intent: idempotency key,
mutability, PII class, and the evidence for its invariants.
Consumers: wf-before-propose (#model-index for Stage and Modeled, one table entry, plus
#base-fields--the-checklist-for-every-new-model, #modeling-conventions-canonical,
#anti-patterns-must-not, #pii--retention); wf-after-propose-check and wf-after-apply-check (BLOCK a
change that lands a table without ticking Modeled; grep the Slices lines).
Split rule (keep it in the final doc): once packages/db exists, the Drizzle schema owns columns, types
and indexes; this doc owns intent, keys, mutability, PII class and evidence. Field tables list only
load-bearing columns. Modeled `[x]` is ticked in the change that lands the migration, never before.
Inputs (read first): architecture.md (ADR-003, 004, 006, 007, 013, 014; source-of-truth rule);
resend.md (payload fields per event type, `created_at` semantics, `svix-id` on replay); about.md;
docs/idea.md §5.3–5.6, §6.3.
Research: confirm every payload field a projection reads against the RS-NN fact for its event type.
An unconfirmed source field MUST NOT become a column; record it in about.md → Open questions.
Required structure (parser contract): `## Model index` with backticked table names and a `Modeled`
column of `[ ]` / `[x]`; the four principle headings above verbatim; one `###` entry per table,
titled with the backticked table name, an em dash and its role, ending with a Slices line in the form `<ID> — <Title>; …`, titles verbatim from
architecture.md's build order. Words marking something unsettled only under headings matching
deferred | open question | risk | non-goal | out of scope.
Evidence rules: each invariant (uniqueness, immutability, rebuildability, ordering) names its test or
simulator invariant in the entry footer; "pending — <kind> (slice N)" until it exists.
Owner decisions to surface (one batched round, recommended pick each): the Open questions items;
closed sets as text + CHECK vs pgEnum; surrogate key style.
Done when: every table in the build order has an entry; preview columns replaced by verified ones;
Open questions holds only unruled items; banner and comment removed.
-->

How Ledger models its data. ADRs and system shape: [architecture.md](architecture.md). Read the
principles before designing any table or column.

## How to use

1. Read every subsection of [Principles](#principles). They bind every table.
2. Find the table in the [Model index](#model-index): its stage and whether it is real yet.
3. Read only that table's `###` entry under [Tables](#tables).

**Split rule.** Once `packages/db` exists, its Drizzle schema owns columns, types and indexes. This
doc owns intent, idempotency keys, mutability, PII class and evidence. Where they disagree on a
column, the schema wins and this doc is corrected; where they disagree on intent, the schema is a bug.

## Model index

**Agents: tick `Modeled` in the change that lands the migration.** The index never substitutes for
the entry it links.

| Table | Role | Kind | Mutability | Stage | Modeled |
| --- | --- | --- | --- | --- | --- |
| [`webhook_events`](#webhook_events--the-immutable-ledger) | One row per Resend event, ever | Ledger | Append-only (redaction job only) | 1 — Local v0 | [ ] |
| [`email_state`](#email_state--current-state-per-email) | Current state per email | Projection | Recomputed | 1 — Local v0 | [ ] |
| [`recipient_state`](#recipient_state--deliverability-per-address) | Deliverability per address | Projection | Recomputed | 1 — Local v0 | [ ] |
| [`reconcile_runs`](#reconcile_runs--one-row-per-recovery-run) | One row per recovery run | Ops record | Insert, then finish once | 3 — Recovery | [ ] |
| [`outbox`](#outbox--reactions-awaiting-delivery) | Reactions awaiting delivery | Outbox | Status transitions only | 5 — Reactions | [ ] |
| [`local_queue_messages`](#local_queue_messages--the-local-mode-queue) | SQS stand-in for local mode | Queue | Claimed, deleted | 2B — Local-mode queue & docker compose | [ ] |

## Principles

### Immutable ledger

`webhook_events` is the source of truth ([architecture.md → System shape](architecture.md#system-shape)).
A row MUST NOT be updated or deleted, except by the retention job, which MAY only redact named PII
fields inside `payload` ([ADR-014](architecture.md#adr-014--raw-payload-retention-and-redaction)).
The ledger MUST accept any event in any order: no foreign keys from it to projections.

### Projections are derived

- Every projection column MUST be computable from the event set alone. Drop and rebuild yields
  identical rows ([ADR-003](architecture.md#adr-003--projection-is-a-pure-function-of-the-event-set)).
- Projections are recomputed from the full event set for the affected key, never patched
  incrementally from the previous row.
- Fold order is `(event_created_at, rank(type), svix_id)`: deterministic for any arrival order.
- Projection logic lives in `packages/core`; `packages/db` only loads events and writes results.

### Idempotency keys

| Key | Absorbs | Where enforced |
| --- | --- | --- |
| `webhook_events.svix_id` (PK) | Svix retries, manual and reconciler replays (same `svix-id`) | `INSERT … ON CONFLICT (svix_id) DO NOTHING` ([ADR-004](architecture.md#adr-004--immutable-ledger-keyed-on-svix_id-one-transaction-per-message)) |
| `outbox.dedupe_key` (UNIQUE) | Worker retries re-emitting a reaction | Unique constraint; Resend idempotency key derived from it ([ADR-006](architecture.md#adr-006--transactional-outbox-for-reactions)) |
| `email_state.email_id`, `recipient_state.address` (PK) | Concurrent workers on one key | Upsert under `SELECT … FOR UPDATE` |

A unique key MUST live in the migration, not only in the Drizzle schema file.

### Timestamps & ordering

- `event_created_at` is Resend's timestamp from the payload; `received_at` is when Ledger got it.
- Projections and every "since" / "first" / "last" value MUST use `event_created_at`. Ordering by
  `received_at`, insertion order or a surrogate id is a correctness bug.
- `received_at` is for lag metrics (`worker.processing_lag`) and operator forensics only.
- All timestamps are `timestamptz`, stored in UTC.

### Base fields — the checklist for every new model

| Field | Include when | Notes |
| --- | --- | --- |
| Natural PK (`svix_id`, `email_id`, `address`) | **MUST** when the row is keyed by an external identity | The PK is the idempotency key |
| `id` (identity `bigint`) | **MUST** when there is no natural key (`outbox`, `reconcile_runs`) | Never exposed as a public identifier |
| `created_at` / `received_at` | **MUST** — every table | `timestamptz default now()` |
| `updated_at` | **MUST** on mutable rows; **MUST NOT** on append-only | Projections, `outbox` |
| `event_created_at` | **MUST** on any row derived from one event | Distinct from row time |
| `status` | **MUST** where the row has a lifecycle | Closed set, mirrored by a Zod enum in `packages/core` |
| `dedupe_key` | **MUST** on rows whose processing causes an external effect | See [Idempotency keys](#idempotency-keys) |
| `tenant_id` | **MUST NOT** | Single team; multi-tenant is a [categorical reject](architecture.md#deferred-yagni) |
| `deleted_at` | **MUST NOT** | No soft delete; the ledger is never deleted, projections are rebuilt |

### Modeling conventions (canonical)

- Tables and columns snake_case. Entity tables plural (`webhook_events`, `reconcile_runs`);
  per-key projections `<noun>_state`; `outbox` as named. Drizzle maps camelCase TS to snake_case.
- Closed sets: `text` + `CHECK` constraint, mirrored by a Zod enum in `packages/core` (preview pick).
- Email addresses are trimmed and lowercased on write by one function in `packages/core`.
- Resend identifiers (`msg_…`, email ids) are stored verbatim as `text`.
- `jsonb` only for the raw event payload and the outbox payload. Anything a query filters on or a
  projection reads is a typed column.
- Migrations are expand/contract only. A pushed migration is never edited (Ask first).
- Every database access goes through `packages/db` repositories.

### Anti-patterns (MUST NOT)

- Deduplicating events on anything but `svix_id` (for example `(email_id, type)`).
- Updating or deleting `webhook_events` rows outside the retention job.
- Patching a projection incrementally (`SET status = $new`) instead of recomputing it.
- Ordering anything that feeds a projection by `received_at` or insertion order.
- A projection column with no source in the event set.
- Foreign keys from `webhook_events` to projections, or cascades from projections to the ledger.
- Performing a side effect in the worker transaction instead of writing an outbox row.
- A `tenant_id` column or any multi-tenant plumbing.
- Secrets, API keys or signing secrets in any table.
- Real recipient addresses in fixtures, seeds, migrations or docs.

### PII & retention

Payloads and projections hold personal data (addresses, subjects). This repo is public.

| Location | PII held | Class |
| --- | --- | --- |
| `webhook_events.payload` | from/to addresses, subject, possibly headers | Redact after N days; keep projection inputs ([ADR-014](architecture.md#adr-014--raw-payload-retention-and-redaction)) |
| `email_state` | `from_address`, `to_addresses`, `subject` | Follows the owner ruling under [Open questions](#open-questions) |
| `recipient_state.address` | the address itself (PK) | Kept while it is a deliverability record |
| `outbox.payload`, `outbox.dedupe_key` | callback body with an address; address inside the key | Key SHOULD carry a hash of the address, not the address |
| Logs | none | Log `svix_id`, `email_id`, `type`; MUST NOT log addresses or subjects |

- Fixtures, tests and docs use Resend test addresses only (`delivered@resend.dev`, `bounced@resend.dev`).
- Read API and MCP output MAY redact addresses and subjects ([ADR-011](architecture.md#adr-011--one-contract-many-surfaces)).

## Tables

Load-bearing columns only. Every table also carries its [base fields](#base-fields--the-checklist-for-every-new-model).

### `webhook_events` — the immutable ledger

| Column | Type | Why it matters |
| --- | --- | --- |
| `svix_id` | `text` PK | = Resend event id (`msg_…`); the dedupe key for retries and replays |
| `type` | `text` | Unknown types are stored and counted, never rejected |
| `event_created_at` | `timestamptz` | Fold order for projections |
| `received_at` | `timestamptz` | Lag metric only |
| `email_id` | `text` null | Null for non-email events; indexed with `event_created_at` |
| `source` | `text` | `live` / `replay` / `simulated` (see [Open questions](#open-questions)) |
| `payload` | `jsonb` | The event body Resend sent |

Indexes: `(email_id, event_created_at)` for projection loads; `(event_created_at)` for reconcile diffs.

_Schema: `packages/db/src/schema/webhook-events.ts` (once it exists). Evidence: pending — duplicate-insert integration test; sim invariant 1 (slice 1)._

- **Slices:** 1 — Local v0; 2 — Durable ingest; 3 — Recovery; 6 — Polish

### `email_state` — current state per email

| Column | Type | Why it matters |
| --- | --- | --- |
| `email_id` | `text` PK | Lock target that serializes workers per email |
| `status` | `text` | Outcome precedence, not recency ([ADR-003](architecture.md#adr-003--projection-is-a-pure-function-of-the-event-set)) |
| `to_addresses` | `text[]` | Feeds `recipient_state`; needs a GIN index for the per-address recompute |
| `bounced_at`, `bounce_type`, `bounce_sub_type` | `timestamptz`, `text` | Explains a negative outcome |
| `open_count`, `click_count`, first-seen timestamps | `int`, `timestamptz` | Counters keep the state bounded |
| `last_event_at`, `event_count` | `timestamptz`, `int` | Freshness and rebuild check |

Created on first sight (`INSERT … ON CONFLICT DO NOTHING`, then `SELECT … FOR UPDATE`).

_Schema: `packages/db/src/schema/email-state.ts` (once it exists). Evidence: pending — fast-check properties; sim invariant 2 (slices 0, 1)._

- **Slices:** 1 — Local v0; 4 — Read API & SDK

### `recipient_state` — deliverability per address

| Column | Type | Why it matters |
| --- | --- | --- |
| `address` | `text` PK | Lowercased; what an application checks before sending |
| `deliverability` | `text` | `ok` / `soft_bouncing` / `hard_bounced` / `complained` / `suppressed` |
| `since` | `timestamptz` | From `event_created_at`, never row time |
| `cause_email_id` | `text` | The email that caused the transition |

Recomputed from every `email_state` row for the address, under a lock taken in sorted-address order.

_Schema: `packages/db/src/schema/recipient-state.ts` (once it exists). Evidence: pending — concurrency integration test, two emails one recipient (slice 1)._

- **Slices:** 1 — Local v0; 4 — Read API & SDK

### `reconcile_runs` — one row per recovery run

| Column | Type | Why it matters |
| --- | --- | --- |
| `started_at`, `finished_at` | `timestamptz` | A run with no `finished_at` is a crashed run |
| `checked`, `missing`, `replayed`, `failed` | `int` | `missing > 0` is the loss signal worth alerting on |
| `error` | `text` null | Why a run stopped (for example `webhook_disabled`) |

_Schema: `packages/db/src/schema/reconcile-runs.ts` (once it exists). Evidence: pending — "down > 28h" integration test (slice 3)._

- **Slices:** 3 — Recovery; 4 — Read API & SDK

### `outbox` — reactions awaiting delivery

| Column | Type | Why it matters |
| --- | --- | --- |
| `dedupe_key` | `text` UNIQUE | Exactly-once effects; source of the Resend idempotency key |
| `kind` | `text` | `app_callback` / `alert_email` |
| `payload` | `jsonb` | What the dispatcher sends |
| `status` | `text` | `pending` / `sent` / `dead` |
| `attempts`, `next_attempt_at`, `last_error` | `int`, `timestamptz`, `text` | Retry with backoff; `dead` after the cap |

Written only in the transaction of the event that caused it.

_Schema: `packages/db/src/schema/outbox.ts` (once it exists). Evidence: pending — `--chaos worker-crash`; sim invariant 3 (slice 5)._

- **Slices:** 5 — Reactions

### `local_queue_messages` — the local-mode queue

| Column | Type | Why it matters |
| --- | --- | --- |
| `id` | identity `bigint` | Claim order |
| `body` | `jsonb` | Same envelope ingest puts on SQS |
| `visible_at`, `receive_count` | `timestamptz`, `int` | Visibility timeout and DLQ threshold, mirroring SQS |

Claimed with `FOR UPDATE SKIP LOCKED` ([ADR-013](architecture.md#adr-013--pure-core-and-local-mode)). Never used in the AWS deployment.

_Schema: `packages/db/src/schema/local-queue.ts` (once it exists). Evidence: pending — sim invariants pass in local mode (slice 2B)._

- **Slices:** 2B — Local-mode queue & docker compose

## Modeling something new

1. Name the idempotency key first. No key, no table.
2. Classify it: ledger, projection (derived, rebuildable), outbox, ops record or queue.
3. Apply the [base fields](#base-fields--the-checklist-for-every-new-model) and
   [conventions](#modeling-conventions-canonical); check every [anti-pattern](#anti-patterns-must-not).
4. Classify every PII column in [PII & retention](#pii--retention).
5. Add the Model index row (`[ ]`) and the `###` entry with its evidence line and `Slices:` line.
6. Tick `Modeled` in the change that lands the migration.

## Open questions

- **`payload` fidelity.** idea §5.2 says the worker stores "exactly what Resend signed", but `jsonb`
  normalizes key order and whitespace, so a stored row cannot be re-verified. Options: add
  `raw_body text`, or drop the claim. Preview lean: drop the claim unless a re-verify use case exists.
- **`source = replay` is not observable at ingest.** A replay carries the original `svix-id` and
  arrives like a live delivery. Options: the reconciler records the ids it replayed and the worker
  labels a matching first insert; or `source` keeps only `live` / `simulated`.
- **PII in projections after redaction.** ADR-014 keeps projections, which hold addresses and
  subjects. Options: redact `subject` / `to_addresses` on the same schedule (status and timestamps
  survive), or accept that projections retain PII.
- **Payload fields per event type** that feed projections are confirmed in [resend.md](resend.md)
  before any column is specified.

## Deferred

| Defer | Kind | Because | Tripwire |
| --- | --- | --- | --- |
| Projections for contact, domain, topic and inbox events | temporal | Stored raw in `webhook_events`; no consumer | First reaction or query that needs one |
| `api_tokens` table | temporal | v0 tokens live in Secrets Manager | Need to rotate or revoke a token without a redeploy |
| Inbound-email thread state | temporal | `email.received` stored raw ([idea §10](../docs/idea.md#10-open-questions)) | Owner schedules an inbound feature |
| Per-tenant columns | categorical | Single team ([architecture.md → Deferred (YAGNI)](architecture.md#deferred-yagni)) | Superseding ADR only |
