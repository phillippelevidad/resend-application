# read-api Specification

## Purpose

Serves the projected state of an email and the deliverability of an address over HTTP, described by
an OpenAPI document, returning masks only and answering every failure in the one error shape with a
registered code.

## Requirements

### Requirement: email.get returns the projected email
`email.get` SHALL answer `200` with `object: "email"`, the email's projected status, masked `from` and subject, open and click counts with first times, `last_event_at`, `event_count`, every recipient's outcome, and the timeline of its ledger rows. Every timestamp SHALL be ISO 8601 UTC or `null`.

#### Scenario: A bounced email with two recipients
- **WHEN** an email has `email.sent` to two recipients, `email.delivered` to the first and a `Permanent` / `General` `email.bounced` to the second (RS-28, RS-35)
- **THEN** the response has `status: "bounced"`, two `recipients` with statuses `delivered` and `bounced`, the bounced one carrying `bounce_type` `Permanent` and `bounce_sub_type` `General`, and three `timeline` items

#### Scenario: Timeline order
- **WHEN** an email's events were stored in an order other than their `created_at` order
- **THEN** `timeline` lists them by `event_created_at` (nulls last), then event rank, then `svix_id`, each with `svix_id`, `type`, `event_created_at`, `bounce_type` and `bounce_sub_type`

#### Scenario: Only unprojectable events
- **WHEN** an `email_id` has ledger rows but none was projectable
- **THEN** the response is `200` with `status: null`, zero counts, `recipients: []` and the timeline

### Requirement: email.get errors
`email.get` SHALL answer `401 unauthorized` without a valid token, `404 email_not_found` when no ledger row has the `email_id`, and `400 validation_failed` when the `email_id` is not 1 to 128 characters from `A-Z`, `a-z`, `0-9`, `.`, `_` and `-`.

#### Scenario: Unknown email
- **WHEN** `email.get` is called with `no-such-email`, an id no ledger row holds
- **THEN** the response is `404` with `code` `email_not_found`

#### Scenario: Bad id
- **WHEN** an `email_id` holding a space or `!` is requested
- **THEN** the response is `400` with `code` `validation_failed` and a `message` naming `email_id`

#### Scenario: No token
- **WHEN** `email.get` is called without a token
- **THEN** the response is `401` with `code` `unauthorized`

### Requirement: recipient.get looks up an address sent in the body
`recipient.get` SHALL take `{ "address": "<address>" }` as a JSON body, normalize and hash it server-side, and answer `200` with `object: "recipient"`, `address_masked`, `deliverability`, `since` and `cause_email_id`. The address SHALL never be read from a path or query string.

#### Scenario: A hard-bounced recipient
- **WHEN** an address whose only event was a `Permanent` bounce on email `e1` is looked up (RS-28, RS-35)
- **THEN** the response has `deliverability: "hard_bounced"` and `cause_email_id: "e1"`

#### Scenario: Normalized lookup
- **WHEN** the stored recipient is `delivered@resend.dev` and the lookup sends ` Delivered@Resend.dev `
- **THEN** the same recipient is returned

### Requirement: recipient.get errors
`recipient.get` SHALL answer `401 unauthorized` without a valid token, `404 recipient_not_found` for an address no event has named, and `400 validation_failed` for an address that is not a trimmed 3 to 320 characters with one `@` and a non-empty part on each side, or for a body that is missing, not JSON, or sent without `Content-Type: application/json`.

#### Scenario: Never-seen address
- **WHEN** an address no event has named is looked up
- **THEN** the response is `404` with `code` `recipient_not_found`, never `200`

#### Scenario: Invalid address
- **WHEN** the body's `address` is `no-at-sign`
- **THEN** the response is `400` with `code` `validation_failed` and a `message` naming `address`

#### Scenario: No content type
- **WHEN** the request is sent without a `Content-Type` header
- **THEN** the response is `400` in the error shape with `code` `validation_failed`, never a bare `415`

#### Scenario: No token
- **WHEN** `recipient.get` is called without a token
- **THEN** the response is `401` with `code` `unauthorized`

### Requirement: Read responses are masked
`email.get` and `recipient.get` SHALL return masks only. They SHALL NOT return the payload, `to`, a raw address, `from` or subject, a bounce `message` or `diagnosticCode`, the address hash, or the signal columns. An input address SHALL be echoed only as its mask.

#### Scenario: Redaction on email.get
- **WHEN** `email.get` is called for an email to `delivered@resend.dev` with a subject (RS-32)
- **THEN** the response body contains neither the address nor the subject

#### Scenario: Redaction on recipient.get
- **WHEN** `recipient.get` is called with `delivered@resend.dev`
- **THEN** the response body does not contain `delivered@resend.dev`, only its mask

### Requirement: One error shape with registered codes
Every read-API failure SHALL answer `{ "error": { "code", "message", "hint", "docs" } }` with a code from api-contract.md → Error codes and that code's status. A `message` SHALL carry no id, address, subject, input value or internal detail.

#### Scenario: Database unreachable
- **WHEN** either operation runs while Postgres is unreachable
- **THEN** the response is `503` with `code` `database_unavailable`

#### Scenario: Unexpected failure
- **WHEN** a reader throws an error that is neither a database-connection error nor a registry error
- **THEN** the response is `500` with `code` `internal_error`, the `message` holds no internals, and one `api.internal_error` line logs the request id and the error's name

### Requirement: Unmatched paths answer route_not_found
Any method and path no operation serves SHALL answer `404` with `code` `route_not_found` in the error shape, never a framework's default response.

#### Scenario: Unknown path
- **WHEN** a request reaches a path no operation serves
- **THEN** the response is `404` with `code` `route_not_found`

#### Scenario: Wrong method
- **WHEN** a request uses a method no operation serves on a path that `email.get` serves
- **THEN** the response is `404` with `code` `route_not_found`

### Requirement: OpenAPI document
The read API SHALL publish an OpenAPI 3.1 document, titled `Ledger read API`, version `0.0.0`, describing its eight operations by their operation ids (`email.get`, `recipient.get`, `health.get`, `worker.resumeEventSource`, `token.create`, `token.list`, `token.revoke`, `token.getCurrent`) with their request schemas and responses in the error shape, a `bearerAuth` security scheme, and a `401` response on every operation.

#### Scenario: Exported document
- **WHEN** the OpenAPI document is generated
- **THEN** it holds the eight operations, each requiring `bearerAuth` and listing a `401` response, and `token.create` documents `201`

### Requirement: Bearer token on every route
Every read-API request, unmatched paths included, SHALL carry `Authorization: Bearer <token>`. A missing, malformed or bad-tag token SHALL answer `401 unauthorized` before any database connection opens; an unknown or revoked token SHALL answer `401 unauthorized`; a token without the route's scope SHALL answer `403 forbidden`. Every `401` SHALL use the registry's default message.

#### Scenario: No token
- **WHEN** a request without an `Authorization` header reaches any route
- **THEN** it answers `401` with `code` `unauthorized` and no database connection is attempted

#### Scenario: Bad tag
- **WHEN** a request carries a well-shaped token whose tag does not verify
- **THEN** it answers `401 unauthorized` and no database connection is attempted

#### Scenario: Unknown or revoked token
- **WHEN** a request carries a correctly tagged token that matches no active row
- **THEN** it answers `401 unauthorized` with the same message as the other `401`s

#### Scenario: Read token on an operate route
- **WHEN** a `read` token calls `token.create`, `token.list`, `token.revoke` or `worker.resumeEventSource`
- **THEN** each answers `403` with `code` `forbidden`

#### Scenario: Unmatched path still needs a token
- **WHEN** a request without a token reaches a path no operation serves
- **THEN** it answers `401 unauthorized`, not `404`

### Requirement: Health answers during a database outage
During a database outage, `health.get` with a correctly tagged token SHALL answer `200` reporting the database unreachable, and every other operation SHALL answer `503 database_unavailable`. A `health.get` request SHALL make at most one database attempt.

#### Scenario: Postgres stopped
- **WHEN** Postgres is stopped and `health.get` is called with a tagged token
- **THEN** it answers `200` with `database.reachable: false` and `storage_bytes: null`

#### Scenario: Bad tag during the outage
- **WHEN** Postgres is stopped and `health.get` is called with a bad-tag token
- **THEN** it answers `401 unauthorized`

#### Scenario: Other routes during the outage
- **WHEN** Postgres is stopped and `email.get` is called with a tagged token
- **THEN** it answers `503` with `code` `database_unavailable`

### Requirement: health.get reports the pipeline
`health.get` (`read`) SHALL answer `200` with `object: "health"`, the source queue's visible and in-flight counts and oldest-message age in seconds (`null` when no datapoint exists, AWS-22), the DLQ's visible and in-flight counts, the worker's event-source state (`enabled`, `paused` or `changing`), and the database's reachability, storage used and storage limit in bytes.

#### Scenario: Healthy pipeline
- **WHEN** `health.get` is called with the database up
- **THEN** it answers `200` with every field present and `database.reachable: true`

#### Scenario: AWS read fails
- **WHEN** reading the queue or the event source fails
- **THEN** it answers `500 internal_error` and logs the error's name

### Requirement: worker.resumeEventSource resumes on demand
`worker.resumeEventSource` (`operate`) SHALL send the worker the resume event and answer `200` with `object: "event_source"`, the resulting `state` and `resumed`. A failed probe SHALL answer `503 database_unavailable` with the message "The database is unreachable or at its storage limit, so the event source stays paused." On an enabled source it SHALL open no database connection.

#### Scenario: Already enabled
- **WHEN** it is called while the event source is enabled
- **THEN** it answers `200` with `state: "enabled"` and `resumed: false`

#### Scenario: Probe fails
- **WHEN** it is called while the event source is paused and the probe fails
- **THEN** it answers `503 database_unavailable` with the override message, and the source stays paused

#### Scenario: Worker answer unreadable
- **WHEN** invoking the worker fails or its result does not parse
- **THEN** it answers `500 internal_error`

### Requirement: token.create mints a token
`token.create` (`operate`) SHALL take a JSON body `{ name, scope }`, where `name` is 1 to 64 characters from `A-Z`, `a-z`, `0-9`, `.`, `_`, `-` starting with a letter or digit and `scope` is `read` or `operate`, and SHALL answer `201` with the token object plus `token`, the plaintext, once. It is not idempotent.

#### Scenario: Create a read token
- **WHEN** an `operate` token creates `{ "name": "review-2026-10-20", "scope": "read" }`
- **THEN** it answers `201` with `object: "token"`, a `token_id`, the name, the scope, `created_at`, `revoked_at: null` and a `token` starting `ldg_`

#### Scenario: Bad name
- **WHEN** the name starts with `-`
- **THEN** it answers `400 validation_failed` with a message naming `name`

#### Scenario: Missing body
- **WHEN** the request has no JSON body
- **THEN** it answers `400 validation_failed` with "The request body must be a JSON object with name and scope fields."

### Requirement: token.list lists tokens newest first
`token.list` (`operate`) SHALL answer the list envelope `{ object: "list", has_more, data }` of token objects, active and revoked, newest first by `token_id`, with `limit` 1 to 100 (default 20) and `after` a token id. It SHALL never return a hash or a plaintext token.

#### Scenario: Paging
- **WHEN** three tokens exist and `token.list` is called with `limit=2`
- **THEN** it returns the two newest with `has_more: true`, and `after` set to the second's id returns the oldest with `has_more: false`

#### Scenario: Bad limit
- **WHEN** `limit` is `0`
- **THEN** it answers `400 validation_failed` with a message naming `limit`

### Requirement: token.revoke revokes, never the last operate token
`token.revoke` (`operate`) SHALL set `revoked_at` and answer `200` with the token object. Revoking a revoked token SHALL return it unchanged. Revoking the only active `operate` token SHALL answer `409 last_operate_token`, also under two concurrent revokes. An unknown id SHALL answer `404 token_not_found`.

#### Scenario: Revoke a read token
- **WHEN** an active `read` token is revoked
- **THEN** it answers `200` with `revoked_at` set, and that token's next request answers `401`

#### Scenario: Last operate token
- **WHEN** the only active `operate` token is revoked
- **THEN** it answers `409` with `code` `last_operate_token` and the token stays active

#### Scenario: Two concurrent revokes
- **WHEN** two requests concurrently revoke the last two active `operate` tokens
- **THEN** exactly one succeeds and the other answers `409 last_operate_token`

#### Scenario: Unknown id
- **WHEN** a token id that exists in no row is revoked
- **THEN** it answers `404` with `code` `token_not_found`

#### Scenario: Bad id
- **WHEN** `token_id` is `0` or longer than 15 digits
- **THEN** it answers `400 validation_failed` with a message naming `token_id`

### Requirement: token.getCurrent returns the caller
`token.getCurrent` (`read`) SHALL answer `200` with the calling token's object, never its hash.

#### Scenario: Read token asks who it is
- **WHEN** a `read` token calls `token.getCurrent`
- **THEN** it answers `200` with that token's id, name and `scope: "read"`
