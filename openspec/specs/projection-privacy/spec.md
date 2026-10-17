# projection-privacy Specification

## Purpose

Keeps raw recipient addresses, senders and subjects out of every projection row and every log line,
so the only raw PII Ledger holds is the immutable ledger's payload.

## Requirements

### Requirement: No raw PII in projection rows
No column of any `email_state`, `email_recipients` or `recipient_state` row SHALL hold a raw recipient address, a raw `from` or a raw subject. Addresses SHALL appear only as a keyed address hash and an address mask; `from` and subject only as their masks.

#### Scenario: Two test recipients with a sender and a subject
- **WHEN** events to `delivered@resend.dev` and `bounced@resend.dev`, with a `from` and a subject, are processed (RS-27, RS-32)
- **THEN** no text column of any projection row contains either normalized address, the raw `from` or the raw subject

### Requirement: Recipients are keyed by keyed hash
Every `address_hash` column and every `webhook_events.to_hashes` entry SHALL be the keyed hash of the normalized address under the deployer-held address-hash key, so the same address under the same key always yields the same key, and a different key yields a different one.

#### Scenario: Case and whitespace do not split a recipient
- **WHEN** one event names `Delivered@Resend.dev` and another names ` delivered@resend.dev`
- **THEN** both resolve to one `recipient_state` row

#### Scenario: Unkeyed hash is impossible
- **WHEN** the address-hash key is changed and the same address is hashed again
- **THEN** the hash differs, including its key-id prefix

### Requirement: Logs carry allow-listed fields only
Every log line SHALL be one JSON object holding only `level`, `timestamp`, `function_name`, `cold_start` when set, the keys listed in data-modeling.md → Log fields, and keys ending `_count` or `_ms` with a number value. Under an allowed key, only a string, number or boolean SHALL be kept; anything else SHALL be dropped.

#### Scenario: A payload under a non-allowed key
- **WHEN** a caller logs a message with a payload object under a key that is not allow-listed
- **THEN** the written line holds no such key and no part of the payload

#### Scenario: A nested value under an allowed key
- **WHEN** a caller logs an object as the value of an allow-listed key
- **THEN** the key is dropped from the line

### Requirement: Errors are logged without their text
A logged error SHALL contribute only its name, the first registry `code` and the first SQLSTATE on its cause chain. Its `message`, `detail` and parameters SHALL NOT be logged, because a parse error or a Postgres error can quote the row.

#### Scenario: A CHECK violation quoting a test address
- **WHEN** a worker failure is logged whose cause is a Postgres error with code `23514` and a `detail` quoting `delivered@resend.dev`
- **THEN** the line holds `pg_code` `23514` and `error_name`, and no line contains the address

#### Scenario: A parse failure quoting a subject
- **WHEN** a schema parse failure whose message quotes a subject is logged
- **THEN** no written line contains the subject
