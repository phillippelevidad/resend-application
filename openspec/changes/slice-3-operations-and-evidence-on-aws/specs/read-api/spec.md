# Spec Delta

## ADDED Requirements

### Requirement: dlq.listMessages returns a sample and the depth
`dlq.listMessages` (scope `read`) SHALL answer `200` with `object: "list"`, `depth` (dead messages visible plus in flight, never fewer than the items returned, because the approximate count can under-read, AWS-62), `has_more` (`depth` greater than the items returned) and up to `limit` items (1–10, default 10), each `object: "dlq_message"` with `svix_id`, `type`, `email_id`, `event_created_at`, `enqueued_at` and `receive_count`. It SHALL return no cursor, because it is a sample (AWS-50).

#### Scenario: One dead message
- **WHEN** the DLQ holds one message for an `email.delivered` event and `dlq.listMessages` is called
- **THEN** it answers `200` with `depth: 1`, `has_more: false` and one item carrying that event's `svix_id`, `type`, `email_id`, `created_at` as `event_created_at`, its enqueue time as `enqueued_at`, and a `receive_count`

#### Scenario: More dead than the sample
- **WHEN** the DLQ depth is 12 and `limit` is 10
- **THEN** it answers with at most 10 items, `depth: 12` and `has_more: true`

#### Scenario: Empty DLQ
- **WHEN** the DLQ holds nothing
- **THEN** it answers `200` with `depth: 0`, `has_more: false` and no items

#### Scenario: A depth that under-reads the sample
- **WHEN** the approximate depth reads 0 while the receive returns two dead messages
- **THEN** it answers `depth: 2`, `has_more: false` and the two items

### Requirement: Inspecting never removes or hides a dead message
`dlq.listMessages` SHALL never delete a dead message and SHALL leave every sampled message visible at once, so the depth is unchanged by any number of calls and a redrive started right after moves every message. Items repeating one `svix_id` within a response SHALL collapse to one.

#### Scenario: Inspect then redrive
- **WHEN** `dlq.listMessages` is called three times on a DLQ of depth 2, then `dlq.startRedrive` is called
- **THEN** each list answers `depth: 2`, and the redrive answers `202` with `depth: 2`

### Requirement: An unreadable dead message is still listed
A dead message whose body is not a valid ingest envelope SHALL be listed with every field `null` except `receive_count`. One whose envelope is valid but whose payload is not JSON SHALL keep `svix_id` and `enqueued_at` from the envelope and have `type`, `email_id` and `event_created_at` `null`. Neither SHALL make the response fail. A field whose payload value is not a string SHALL be `null`.

#### Scenario: Malformed body
- **WHEN** the DLQ holds a message whose body is not an ingest envelope
- **THEN** its item has `svix_id`, `type`, `email_id`, `event_created_at` and `enqueued_at` all `null`, and a `receive_count`

#### Scenario: Payload not JSON
- **WHEN** the DLQ holds a message whose body is a valid ingest envelope but whose raw payload is not JSON
- **THEN** its item keeps the envelope's `svix_id` and `enqueued_at`, has `type`, `email_id` and `event_created_at` `null`, and a `receive_count`

### Requirement: dlq.listMessages errors
`dlq.listMessages` SHALL answer `400 validation_failed` with the message `limit must be an integer from 1 to 10.` for a `limit` outside 1–10 or not an integer, `401 unauthorized` and `503 database_unavailable` per the token lookup, and `500 internal_error` when reading the queue fails.

#### Scenario: Limit out of range
- **WHEN** `dlq.listMessages` is called with `limit` 0 or 11
- **THEN** it answers `400` with `code` `validation_failed` and the message `limit must be an integer from 1 to 10.`

#### Scenario: Database down
- **WHEN** `dlq.listMessages` is called with a tagged token while Postgres is unreachable
- **THEN** it answers `503` with `code` `database_unavailable`

#### Scenario: Queue read fails
- **WHEN** reading the DLQ fails
- **THEN** it answers `500 internal_error` and logs the error's name only

### Requirement: dlq.startRedrive moves every dead message back
`dlq.startRedrive` (scope `operate`) SHALL start one redrive of every DLQ message to the source queue and answer `202` with `{ object: "dlq_redrive", status: "started", depth }`, the depth at start. An empty DLQ SHALL answer `200` with `status: "empty"` and `depth: 0` and start nothing. The response SHALL carry no task handle, queue ARN or account id (AWS-61).

#### Scenario: Redrive started
- **WHEN** the DLQ holds 3 messages and an `operate` token calls `dlq.startRedrive`
- **THEN** it answers `202` with `status: "started"` and `depth: 3`, and the response holds no task handle

#### Scenario: Nothing to move
- **WHEN** the DLQ is empty
- **THEN** it answers `200` with `status: "empty"` and `depth: 0`, and no redrive task starts

#### Scenario: A lagging depth never answers empty over a dead message
- **WHEN** the approximate depth reads 0 while a receive returns one dead message (AWS-62)
- **THEN** it answers `202` with `status: "started"` and `depth: 1`, and one redrive task starts

### Requirement: One redrive at a time
While a redrive task runs on the DLQ, `dlq.startRedrive` SHALL answer `409 redrive_in_progress` in the error shape with the registry's message and hint, and SHALL start nothing (AWS-21).

#### Scenario: Second redrive while one runs
- **WHEN** `dlq.startRedrive` is called while a redrive task reads `RUNNING`
- **THEN** it answers `409` with `code` `redrive_in_progress`, and no second task is started

### Requirement: dlq.startRedrive errors
`dlq.startRedrive` SHALL answer `403 forbidden` to a `read` token, `401 unauthorized` and `503 database_unavailable` per the token lookup, and `500 internal_error` when the queue call fails for any reason other than a running task.

#### Scenario: Read token
- **WHEN** a `read` token calls `dlq.startRedrive`
- **THEN** it answers `403` with `code` `forbidden`, and no redrive starts

#### Scenario: Start rejected by the queue
- **WHEN** the queue rejects the start for a reason other than a running task
- **THEN** it answers `500 internal_error`, and no second start is attempted

## MODIFIED Requirements

### Requirement: Read responses are masked
`email.get` and `recipient.get` SHALL return masks only. They SHALL NOT return the payload, `to`, a raw address, `from` or subject, a bounce `message` or `diagnosticCode`, the address hash, or the signal columns. An input address SHALL be echoed only as its mask. `dlq.listMessages` SHALL return no address, `from`, subject, tag, bounce text or payload, raw or masked: only the six item fields it names.

#### Scenario: Redaction on email.get
- **WHEN** `email.get` is called for an email to `delivered@resend.dev` with a subject (RS-32)
- **THEN** the response body contains neither the address nor the subject

#### Scenario: Redaction on recipient.get
- **WHEN** `recipient.get` is called with `delivered@resend.dev`
- **THEN** the response body does not contain `delivered@resend.dev`, only its mask

#### Scenario: Redaction on dlq.listMessages
- **WHEN** the DLQ holds a message whose payload names `delivered@resend.dev` in `to` and `from` and carries a subject (RS-32), and `dlq.listMessages` is called
- **THEN** the response body as text contains neither the address nor the subject, and no item holds a key other than `object`, `svix_id`, `type`, `email_id`, `event_created_at`, `enqueued_at` and `receive_count`

### Requirement: OpenAPI document
The read API SHALL publish an OpenAPI 3.1 document, titled `Ledger read API`, version `0.0.0`, describing its ten operations by their operation ids (`email.get`, `recipient.get`, `health.get`, `worker.resumeEventSource`, `token.create`, `token.list`, `token.revoke`, `token.getCurrent`, `dlq.listMessages`, `dlq.startRedrive`) with their request schemas and responses in the error shape, a `bearerAuth` security scheme, and a `401` response on every operation.

#### Scenario: Exported document
- **WHEN** the OpenAPI document is generated
- **THEN** it holds the ten operations, each requiring `bearerAuth` and listing a `401` response, `token.create` documents `201`, and `dlq.startRedrive` documents `202` and `200`
