# Spec Delta

## ADDED Requirements

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

## MODIFIED Requirements

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
