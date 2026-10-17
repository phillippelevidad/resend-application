# Spec Delta

## Purpose

Accepts Resend webhook deliveries at the ingest endpoint (api-contract.md → Ingest boundary): verifies each one against the
configured signing-secret set before it can reach the queue, and answers with a fixed body so
Resend's stored responses never hold a payload, PII or a secret.

## ADDED Requirements

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
Ingest SHALL answer `200` only after the verified event's enqueue has resolved. When the enqueue fails, it SHALL answer `503`, so Resend retries the delivery.

#### Scenario: Verified and enqueued
- **WHEN** a request verifies and the enqueue resolves
- **THEN** ingest answers `200` and the queue holds exactly one envelope for that `svix_id`

#### Scenario: Enqueue fails
- **WHEN** a request verifies and the enqueue rejects
- **THEN** ingest answers `503` and logs `ingest.enqueue_failed` with the `svix_id` and the error's name only

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
The queued envelope SHALL carry `source` `live` when a Resend secret matched and `simulated` when the simulator secret matched.

#### Scenario: Simulator delivery
- **WHEN** a request verifies only against the simulator secret
- **THEN** its envelope carries `source: simulated`

#### Scenario: Resend delivery
- **WHEN** a request verifies against a configured Resend secret
- **THEN** its envelope carries `source: live`

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
