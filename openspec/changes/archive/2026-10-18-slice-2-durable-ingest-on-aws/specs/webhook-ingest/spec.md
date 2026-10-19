# Spec Delta

## ADDED Requirements

### Requirement: Both body encodings verify identically
On AWS, ingest SHALL decode a base64-encoded request body to its exact bytes before verifying, and SHALL verify a plain body unchanged, so one signed request yields the same response in either encoding (RS-01; whether API Gateway encodes Resend's body is AWS-U04).

#### Scenario: Signed request, plain body
- **WHEN** a correctly signed request arrives with `isBase64Encoded` false
- **THEN** ingest answers `200` and enqueues one envelope

#### Scenario: Signed request, base64 body
- **WHEN** the same signed request arrives with its body base64-encoded and `isBase64Encoded` true
- **THEN** ingest answers `200` and the envelope's raw body equals the original bytes

#### Scenario: Forged request in either encoding
- **WHEN** a forged request arrives plain or base64-encoded
- **THEN** ingest answers `401` in both cases and enqueues nothing

#### Scenario: Encoding is logged as a count
- **WHEN** any request is decoded
- **THEN** one `ingest.request_decoded` line carries `body_base64_count` `1` or `0` and no other request data

### Requirement: An unreadable secret set answers 503
When the signing-secret set cannot be read, fails to parse as a list of `whsec_` secrets, or holds no secret at all, ingest SHALL answer `503` with the fixed body `unavailable`, enqueue nothing, never answer `401`, and log `ingest.secrets_unavailable` with the error's name only. Resend then retries the delivery (RS-09, RS-10).

#### Scenario: Secret read fails
- **WHEN** the secret read rejects
- **THEN** ingest answers `503` with body `unavailable` and the queue holds nothing

#### Scenario: Empty secret set
- **WHEN** the stored set is an empty list and no simulator secret is configured
- **THEN** ingest answers `503`, not `401`

### Requirement: The secret set refreshes within 5 minutes
Ingest SHALL reuse a successfully read secret set for at most 5 minutes, then read it again, so an added or retired secret takes effect within 5 minutes with no redeploy (ADR-009, RS-04). A failed refresh SHALL NOT serve the expired set.

#### Scenario: Within the cache window
- **WHEN** two requests arrive 4 minutes apart
- **THEN** the secret set is read once

#### Scenario: After the window
- **WHEN** a request arrives 5 minutes after the last successful read
- **THEN** the set is read again, and a secret added in between verifies

#### Scenario: Failed refresh
- **WHEN** the set has expired and the refresh fails
- **THEN** ingest answers `503`, even for a request the expired set would have verified

## MODIFIED Requirements

### Requirement: Acknowledge only after a successful enqueue
Ingest SHALL answer `200` only after the verified event's enqueue has resolved, which on AWS means SQS accepted the message. When the enqueue fails, it SHALL answer `503`, so Resend retries the delivery (RS-10).

#### Scenario: Verified and enqueued
- **WHEN** a request verifies and the enqueue resolves
- **THEN** ingest answers `200` and the queue holds exactly one envelope for that `svix_id`

#### Scenario: Enqueue fails
- **WHEN** a request verifies and the enqueue rejects
- **THEN** ingest answers `503` and logs `ingest.enqueue_failed` with the `svix_id` and the error's name only

#### Scenario: SQS rejects the send
- **WHEN** a verified request's `SendMessage` to the source queue fails
- **THEN** ingest answers `503` with body `unavailable`, never `200`
