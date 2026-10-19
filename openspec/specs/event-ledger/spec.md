# event-ledger Specification

## Purpose

Records every verified event exactly once in the immutable ledger, keyed on `svix_id`, and commits
the email and recipient projections recomputed from the event set in the same transaction, so
duplicates, reordering and redelivery never change the result.

## Requirements

### Requirement: One ledger row per event
Delivering an event any number of times, in any order, sequentially or concurrently, SHALL leave exactly one `webhook_events` row for its `svix_id`. Every later copy SHALL commit as a duplicate, change no projection row, and emit the metric `worker.duplicates`.

#### Scenario: Sequential duplicate
- **WHEN** the same envelope is processed twice, one after the other
- **THEN** one `webhook_events` row exists, the projection rows equal those after the first copy, and one `worker.duplicates` metric line is written

#### Scenario: Concurrent duplicates
- **WHEN** two copies of one `svix_id` are processed concurrently on two connections
- **THEN** both commit, one `webhook_events` row exists, and the second commits as a duplicate

#### Scenario: Redelivery under a new message id
- **WHEN** the same `svix_id` arrives again as a queue message with a different message id
- **THEN** it commits as a duplicate and no projection row changes

### Requirement: All or nothing per message
Each message SHALL commit in one transaction: the ledger row and every projection write it causes commit together or not at all. A failure at any step SHALL leave no row from that message, and a later redelivery SHALL commit one row of everything.

#### Scenario: Fault after the ledger insert
- **WHEN** the projection write fails after the `webhook_events` insert in the same message
- **THEN** no `webhook_events`, `email_state`, `email_recipients` or `recipient_state` row from that message exists

#### Scenario: Redelivery after the fault
- **WHEN** the fault is removed and the same message is redelivered
- **THEN** exactly one `webhook_events` row exists and the projection rows equal the projection of the stored events

### Requirement: Unstorable characters never dead-letter an event
A verified event whose payload holds `\u0000` or a lone UTF-16 surrogate, in a value or an object key, SHALL be stored with U+FFFD in each such place and valid surrogate pairs intact, projected when it passes its schema, and counted once as `worker.payload_sanitized`.

#### Scenario: NUL in the subject
- **WHEN** an `email.sent` event's `data.subject` holds `\u0000`
- **THEN** one `webhook_events` row holds U+FFFD in its place, `email_state` reflects the event, and one `worker.payload_sanitized` metric line is written

#### Scenario: Lone surrogate in a tag value
- **WHEN** an event's tag value holds a lone high surrogate
- **THEN** the event is stored with U+FFFD in its place and the message commits without a retry

### Requirement: Unprojectable events are stored raw
A verified event of an unknown type, a non-email type, `email.received`, a known outbound type whose payload fails its schema, or a payload that is not a JSON object SHALL be stored with its payload unchanged and every typed column null where unreadable, SHALL skip projection, and SHALL emit `projection.unknown_event_type` (ADR-004; RS-25, RS-26).

#### Scenario: Unknown type
- **WHEN** an event of a type not listed in RS-25 is processed
- **THEN** one `webhook_events` row holds its payload, its `email_id` and `to_hashes` are null, no projection row is written, and one `projection.unknown_event_type` line is emitted

#### Scenario: Non-email type
- **WHEN** a `contact.created` event is processed (RS-25)
- **THEN** it is stored raw and no projection row is written

#### Scenario: Inbound email
- **WHEN** an `email.received` event is processed
- **THEN** it is stored with a null `email_id` and no projection row is written

#### Scenario: Schema-failing outbound event
- **WHEN** an `email.delivered` event lacks `data.email_id`
- **THEN** it is stored raw with its readable typed columns set, and no projection row is written

#### Scenario: Payload with no string type
- **WHEN** a verified payload carries no string `type`
- **THEN** it is stored with a null `type` and the message commits

#### Scenario: Payload that is not an object
- **WHEN** a verified payload is JSON `null` or an array
- **THEN** one `webhook_events` row stores it as that JSON value with every payload-derived column null, no projection row is written, the message commits on its first receive, and it never reaches the dead list (ADR-004)

### Requirement: Typed ledger columns
Each `webhook_events` row SHALL carry the `svix_id`, `received_at` and `source` from the envelope; the payload's `type` and `created_at` when readable; `email_id` and `to_hashes` only for the ten outbound email types (RS-25, RS-27), with `to_hashes[i]` the keyed hash of `data.to[i]`.

#### Scenario: Recipient hashes keep their positions
- **WHEN** an outbound event's `data.to` lists two addresses
- **THEN** its `to_hashes` holds their two keyed hashes in the same order

### Requirement: Projections equal the event set
After any set of deliveries settles, every `email_state`, `email_recipients` and `recipient_state` row SHALL equal the slice 0 projection functions applied to the stored events for its key. Each projectable event SHALL cause a full recompute, never an incremental patch. Arrival order SHALL NOT change any row (ADR-002, ADR-003).

#### Scenario: Out-of-order arrival
- **WHEN** an email's `email.bounced` event is processed before its `email.sent` and `email.delivered` events
- **THEN** the committed rows equal the projection of the three events, as if they had arrived in `created_at` order

#### Scenario: Recipient state follows the new event's recipients
- **WHEN** an event naming one recipient of a two-recipient email is processed
- **THEN** that recipient's `recipient_state` is recomputed from every `email_recipients` row for its hash, and the other recipient's row is unchanged (RS-27; per-recipient `data.to` is RS-43)

### Requirement: Lock order prevents deadlock
A message SHALL lock its `email_state` row first, then the `recipient_state` rows of the new event's distinct recipients in sorted `address_hash` order, then the email's `email_recipients` rows in the same order. Each row SHALL be inserted if absent before it is locked.

#### Scenario: Two emails sharing a recipient
- **WHEN** two messages for different emails that both name the same two recipients, listed in opposite `data.to` order, are processed concurrently
- **THEN** both commit with no deadlock, and every projection row equals the projection of the stored events

#### Scenario: First event for a new recipient
- **WHEN** an event names a recipient with no `recipient_state` row yet
- **THEN** the row is created and locked inside the message's transaction, and no other transaction reads its placeholder values

### Requirement: Processing lag is measured
Each committed message SHALL emit `worker.processing_lag`, the time from its `receivedAt` to its commit, in milliseconds.

#### Scenario: Committed message
- **WHEN** a message commits
- **THEN** one `worker.processing_lag` metric line is written with a millisecond value

### Requirement: At-least-once local delivery
The local in-process queue SHALL deliver each enqueued message at least once, in batches of at most 10, with no order guarantee (ADR-002). A failed message SHALL be redelivered after 1 second, up to 5 receives, and then moved to an in-memory dead list with one `queue.dead_lettered` log line carrying its `svix_id` and receive count.

#### Scenario: Transient failure
- **WHEN** a message fails on its first receive and succeeds on its second
- **THEN** it is committed once, and no dead-list entry exists

#### Scenario: Persistent failure
- **WHEN** a message fails on every receive
- **THEN** after its fifth receive it is on the dead list, one `queue.dead_lettered` line names its `svix_id` and `receive_count` 5, and it is never silently dropped

### Requirement: Batch failures list exactly the failed messages
Processing a batch SHALL return a failure list built from each message's own result: exactly the message ids that failed, so the others are acknowledged and the failed ones redelivered (ADR-008). On AWS the worker's handler SHALL return that list as `batchItemFailures` unchanged, and a thrown error SHALL fail the whole batch, never return an empty response (AWS-05).

#### Scenario: One bad message in a batch of three
- **WHEN** a batch of three holds one message whose body is not a valid envelope
- **THEN** the failure list holds exactly that message's id, and the other two events are committed

#### Scenario: Lambda response from per-message results
- **WHEN** the worker's handler receives three SQS records and one fails
- **THEN** it returns `batchItemFailures` holding exactly that record's `messageId`

#### Scenario: A thrown error fails the batch
- **WHEN** processing the batch throws
- **THEN** the handler rethrows a constant error, so the whole batch is redelivered and none is acknowledged

### Requirement: A database outage pauses the event source instead of dead-lettering
When a message fails with a database-connection error, the worker SHALL retry it once on a fresh connection, never on the connection that failed, and SHALL discard the failed connection without waiting on it. If the retry fails the same way, it SHALL report every message of the batch as failed, log `worker.database_unavailable`, disable its own event source and stop the batch, so an outage adds one receive per message and moves none to the DLQ (ADR-015).

#### Scenario: Postgres stopped during a batch
- **WHEN** a batch is processed while Postgres is stopped
- **THEN** every message id is in the failure list, the event source reads `paused` after exactly one batch, and no message reaches the DLQ

#### Scenario: Outage clears on the retry
- **WHEN** the first attempt fails with a connection error and the retry on a fresh connection succeeds
- **THEN** the message commits and the event source stays enabled

#### Scenario: Unanswered query is retried elsewhere
- **WHEN** a message's first attempt fails because a query got no answer within the query timeout
- **THEN** the retry runs on a different database connection, the failed connection is closed, and the batch ends within one connect plus two query timeouts

#### Scenario: Pause call fails
- **WHEN** disabling the event source fails
- **THEN** the failure is logged as `worker.pause_failed` with the error's name, and the batch response is unchanged

#### Scenario: Other errors do not pause
- **WHEN** a message fails with an error that is not a connection error
- **THEN** only that message is listed and the event source stays enabled (ADR-008)

### Requirement: Connection-class errors
The worker and the read API SHALL treat as connection-class, besides slice 1's set, a query that gets no answer within 15 seconds and SQLSTATE `53100` (`disk_full`), so an unresponsive or full database pauses rather than dead-letters.

#### Scenario: Query read timeout
- **WHEN** a query fails because no answer arrived within the query timeout
- **THEN** the classifier reports it as a connection-class error

#### Scenario: Out of storage
- **WHEN** a statement fails with SQLSTATE `53100`
- **THEN** the classifier reports it as a connection-class error

### Requirement: Resume only after a successful probe
On the resume event, the worker SHALL do nothing to the database when its event source is enabled. Otherwise it SHALL probe the database; it SHALL re-enable the source only when the probe connects and storage used is below 95 % of the storage limit, and SHALL report `resumed`, `already_enabled` or `probe_failed` with the resulting state.

#### Scenario: Already enabled
- **WHEN** the resume event arrives and the event source is enabled
- **THEN** it reports `already_enabled` and opens no database connection, even if the database is unreachable

#### Scenario: Paused, database back
- **WHEN** the event source is paused and the database answers with storage below the threshold
- **THEN** the event source is enabled and the outcome is `resumed`

#### Scenario: Paused, storage at the limit
- **WHEN** the event source is paused and storage used is at or above the threshold
- **THEN** the outcome is `probe_failed` and the event source stays paused

### Requirement: The hourly schedule resumes a paused worker
The hourly schedule SHALL send the worker the resume event, so a paused event source is re-enabled within the hour after the database returns, with no operator action (ADR-015).

#### Scenario: Next hourly tick
- **WHEN** the database recovers while the event source is paused
- **THEN** the next hourly resume event re-enables it after a successful probe

### Requirement: The runtime role cannot delete the ledger or change the schema
The role the functions connect as SHALL hold DML only: it SHALL be refused `DELETE` on `webhook_events` and `CREATE TABLE`, with SQLSTATE `42501`.

#### Scenario: Delete from the ledger
- **WHEN** the runtime role runs `DELETE FROM webhook_events`
- **THEN** it fails with SQLSTATE `42501`

#### Scenario: Create a table
- **WHEN** the runtime role runs `CREATE TABLE`
- **THEN** it fails with SQLSTATE `42501`

### Requirement: Role timeouts end an idle lock holder
The runtime role SHALL carry `idle_in_transaction_session_timeout` and `lock_timeout` below the worker's timeout, set again on every deploy and setup, with the idle timeout below the lock timeout, so a frozen holder is ended before a waiting worker's lock wait expires and the worker commits.

#### Scenario: Idle lock holder
- **WHEN** a runtime-role session locks an email's row and goes idle in its transaction
- **THEN** the session is terminated, and a worker message for that email commits one row of everything

#### Scenario: Settings stored on the role
- **WHEN** setup or the deploy command has run
- **THEN** the role's configuration holds both settings

### Requirement: A poison message is isolated, and applies once after a redrive
A message that fails on every receive SHALL reach the dead list after `maxReceiveCount` receives while every other message of its batches commits once. Once the fault is fixed and the dead message is redriven, it SHALL commit exactly one `webhook_events` row for its `svix_id`, whether it arrives for the first time or again after a duplicate delivery or a second redrive (ADR-004, ADR-008, AWS-21).

#### Scenario: Poison isolated while the others commit
- **WHEN** five events are delivered and one of them fails on every receive
- **THEN** that message is on the dead list after its fifth receive, and the other four events each have exactly one `webhook_events` row

#### Scenario: Redrive after the fix
- **WHEN** the fault is removed and the dead list is redriven
- **THEN** the redriven event has exactly one `webhook_events` row, and the dead list is empty

#### Scenario: Redriven twice
- **WHEN** the redriven event is delivered again under a new message id
- **THEN** it commits as a duplicate, and its `svix_id` still has exactly one `webhook_events` row
