# webhook-ingest Specification

## Purpose

Accepts Resend webhook deliveries at the ingest endpoint (api-contract.md → Ingest boundary): verifies each one against the
configured signing-secret set before it can reach the queue, and answers with a fixed body so
Resend's stored responses never hold a payload, PII or a secret.

## Requirements

### Requirement: Verify before enqueue
Ingest SHALL verify the `svix-signature` and `svix-timestamp` over the raw request body before anything is enqueued (RS-01, RS-02). A request that lacks any of `svix-id`, `svix-timestamp` or `svix-signature`, matches no configured secret, or carries a timestamp more than 5 minutes off SHALL get `401` and SHALL NOT reach the queue.

#### Scenario: Forged signature
- **WHEN** a request is signed with a secret that is not configured
- **THEN** ingest answers `401` and the queue holds nothing

#### Scenario: Stale timestamp
- **WHEN** a request is correctly signed with a configured secret but its `svix-timestamp` is 6 minutes old (RS-02)
- **THEN** ingest answers `401` and the queue holds nothing

#### Scenario: Missing header
- **WHEN** a request omits any one of the three `svix-*` headers
- **THEN** ingest answers `401` and the queue holds nothing

#### Scenario: Body changed after signing
- **WHEN** one byte of a correctly signed body is changed before the request is sent (RS-01)
- **THEN** ingest answers `401` and the queue holds nothing

#### Scenario: Signed body that is not JSON
- **WHEN** a body that is not JSON is correctly signed with a configured secret
- **THEN** ingest answers `401` and the queue holds nothing

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

### Requirement: Secret set, first match wins
Ingest SHALL try each configured Resend signing secret in configured order, then the simulator secret, and accept on the first match. A delivery signed by the previous secret, the new secret, or both during a rotation SHALL verify (RS-04).

#### Scenario: Old secret during rotation
- **WHEN** both the old and new secrets are configured and a request is signed by the old one only
- **THEN** ingest answers `200`

#### Scenario: New secret during rotation
- **WHEN** both secrets are configured and a request is signed by the new one only
- **THEN** ingest answers `200`

#### Scenario: Both signatures in one header
- **WHEN** the `svix-signature` header carries two `v1,` signatures, one per configured secret (RS-03, RS-04)
- **THEN** ingest answers `200`

### Requirement: Event source stamped from the matching secret
The queued envelope SHALL carry `source` `live` when a Resend secret matched and `simulated` when the simulator secret matched. Ingest SHALL verify against the simulator secret only when one is configured, and only after the Resend set (ADR-016). With none configured, a request signed only with a simulator secret SHALL answer `401` and enqueue nothing.

#### Scenario: Simulator delivery
- **WHEN** a request verifies only against the simulator secret
- **THEN** its envelope carries `source: simulated`

#### Scenario: Resend delivery
- **WHEN** a request verifies against a configured Resend secret
- **THEN** its envelope carries `source: live`

#### Scenario: No simulator secret configured
- **WHEN** ingest has no simulator secret configured and a request arrives signed with a simulator secret (RS-02's `whsec_` form)
- **THEN** ingest answers `401` with body `unauthorized` and the queue holds nothing

### Requirement: The queued envelope
Each enqueued envelope SHALL hold the `svix_id`, the receive time from the clock as an ISO 8601 date-time with offset, the `source`, the raw body unchanged, and the `svix-timestamp` header. It SHALL NOT hold the `svix-signature`.

#### Scenario: Envelope contents
- **WHEN** a verified request is enqueued
- **THEN** the envelope's raw body equals the request body byte for byte, and no field holds the signature

### Requirement: Fixed response bodies
Every ingest response SHALL be `text/plain; charset=utf-8` with exactly `ok` (`200`), `unauthorized` (`401`) or `unavailable` (`503`), because Resend stores the response body (RS-12). Ingest is not an operation, so the error shape does not apply.

#### Scenario: Body never echoes the request
- **WHEN** any request is answered
- **THEN** the body is one of the three fixed strings and holds no part of the payload, a header or a secret

### Requirement: A rejected request leaves no attacker-controlled trace
A rejected request SHALL be logged as one constant line, `ingest.request_rejected`, with no fields. The `svix-id` of an unverified request SHALL NOT be logged.

#### Scenario: Forged request logged
- **WHEN** a forged request is rejected
- **THEN** exactly one `ingest.request_rejected` line is written, and it holds no `svix_id` and no header value

### Requirement: Accepted deliveries are counted
Each accepted delivery SHALL emit the metric `ingest.accepted` with its `svix_id` and the payload's `type` when it is a string.

#### Scenario: Accepted delivery
- **WHEN** a request verifies and is enqueued
- **THEN** one `ingest.accepted` metric line is written with that `svix_id`

#### Scenario: Verified payload that is not an object
- **WHEN** a correctly signed body is JSON but not an object, such as `null` or `[]`
- **THEN** ingest enqueues it and answers `200`, and the `ingest.accepted` line carries no `type`

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
When the signing-secret set cannot be read, fails to parse as a list of `whsec_` secrets, or holds no secret at all, or a configured simulator secret cannot be read or is not one `whsec_` secret, ingest SHALL answer `503` with the fixed body `unavailable`, enqueue nothing, never answer `401`, and log `ingest.secrets_unavailable` with the error's name only. Resend then retries the delivery (RS-09, RS-10).

#### Scenario: Secret read fails
- **WHEN** the secret read rejects
- **THEN** ingest answers `503` with body `unavailable` and the queue holds nothing

#### Scenario: Empty secret set
- **WHEN** the stored set is an empty list and no simulator secret is configured
- **THEN** ingest answers `503`, not `401`

#### Scenario: Simulator secret unreadable
- **WHEN** a simulator secret is configured and its read rejects or its value is not a `whsec_` secret
- **THEN** ingest answers `503` with body `unavailable` to every request, a Resend-signed one included, and the queue holds nothing

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
