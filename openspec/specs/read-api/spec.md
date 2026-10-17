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
`email.get` SHALL answer `404 email_not_found` when no ledger row has the `email_id`, and `400 validation_failed` when the `email_id` is not 1 to 128 characters from `A-Z`, `a-z`, `0-9`, `.`, `_` and `-`.

#### Scenario: Unknown email
- **WHEN** `email.get` is called with `no-such-email`, an id no ledger row holds
- **THEN** the response is `404` with `code` `email_not_found`

#### Scenario: Bad id
- **WHEN** an `email_id` holding a space or `!` is requested
- **THEN** the response is `400` with `code` `validation_failed` and a `message` naming `email_id`

### Requirement: recipient.get looks up an address sent in the body
`recipient.get` SHALL take `{ "address": "<address>" }` as a JSON body, normalize and hash it server-side, and answer `200` with `object: "recipient"`, `address_masked`, `deliverability`, `since` and `cause_email_id`. The address SHALL never be read from a path or query string.

#### Scenario: A hard-bounced recipient
- **WHEN** an address whose only event was a `Permanent` bounce on email `e1` is looked up (RS-28, RS-35)
- **THEN** the response has `deliverability: "hard_bounced"` and `cause_email_id: "e1"`

#### Scenario: Normalized lookup
- **WHEN** the stored recipient is `delivered@resend.dev` and the lookup sends ` Delivered@Resend.dev `
- **THEN** the same recipient is returned

### Requirement: recipient.get errors
`recipient.get` SHALL answer `404 recipient_not_found` for an address no event has named, and `400 validation_failed` for an address that is not a trimmed 3 to 320 characters with one `@` and a non-empty part on each side, or for a body that is missing, not JSON, or sent without `Content-Type: application/json`.

#### Scenario: Never-seen address
- **WHEN** an address no event has named is looked up
- **THEN** the response is `404` with `code` `recipient_not_found`, never `200`

#### Scenario: Invalid address
- **WHEN** the body's `address` is `no-at-sign`
- **THEN** the response is `400` with `code` `validation_failed` and a `message` naming `address`

#### Scenario: No content type
- **WHEN** the request is sent without a `Content-Type` header
- **THEN** the response is `400` in the error shape with `code` `validation_failed`, never a bare `415`

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
The read API SHALL publish an OpenAPI 3.1 document, titled `Ledger read API`, version `0.0.0`, describing both operations by their operation ids with their request schemas and their `200`, `400`, `404`, `500` and `503` responses in the error shape.

#### Scenario: Exported document
- **WHEN** the OpenAPI document is generated
- **THEN** it holds the `email.get` and `recipient.get` operations and their five response codes each

### Requirement: Auth skipped only on loopback
In this slice the local server SHALL skip the bearer-token check, and SHALL do so only while bound to a loopback address. It SHALL refuse to start on any other host.

#### Scenario: Non-loopback host
- **WHEN** the local server is started with `--host 0.0.0.0`
- **THEN** it exits `1` with a line naming the loopback requirement and serves nothing

#### Scenario: Any bearer token accepted on loopback
- **WHEN** a read request with any `Authorization: Bearer` value reaches the loopback server
- **THEN** it is served without a token check
