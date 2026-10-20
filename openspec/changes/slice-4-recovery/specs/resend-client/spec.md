# resend-client — spec delta

## Purpose

Is the only caller of Resend's API: it spends Ledger's share of the team's shared rate limit at a
bounded pace, maps every response to a registered outcome, and keeps Resend's response bodies, the
API key and signing secrets out of every log, error and output.

## ADDED Requirements

### Requirement: Request starts are spaced at the client's rate
Each client SHALL space the starts of its requests at its rate, 2 requests per second by default, Ledger's share of the 10 req/s team limit (RS-19, ADR-012).

#### Scenario: Ten calls
- **WHEN** ten calls are made back to back on a fake clock at the default rate
- **THEN** each request starts 500 ms after the one before it

### Requirement: The client yields on low headroom
After a response whose `ratelimit-remaining` is below half of its `ratelimit-limit`, the client SHALL wait `ratelimit-reset` seconds before starting the next request. Absent or unparseable headers SHALL mean no wait (RS-19, RS-20).

#### Scenario: Low remaining
- **WHEN** a response carries `ratelimit-remaining: 4`, `ratelimit-limit: 10` and `ratelimit-reset: 1`
- **THEN** the next request starts no sooner than 1 s later

### Requirement: A 429 is waited out
On a `429` with a parseable `retry-after`, the client SHALL wait that many seconds and retry the same call, as often as the call's deadline allows. A `429` named `daily_quota_exceeded` or `monthly_quota_exceeded`, or one with no parseable `retry-after`, SHALL fail with `rate_limited` and no retry (RS-22).

#### Scenario: Retry after
- **WHEN** a call gets a `429` with `retry-after: 3`, then a `200`
- **THEN** it waits 3 s, retries once, and returns the `200`'s result

#### Scenario: Quota exhausted
- **WHEN** a call gets a `429` named `daily_quota_exceeded`
- **THEN** it fails with `rate_limited` after exactly one request

### Requirement: No wait passes the call's deadline
Every call SHALL carry a deadline. A rate, headroom, `retry-after` or backoff wait that would end past it SHALL fail the call with `rate_limited` before sleeping.

#### Scenario: Retry-after past the deadline
- **WHEN** a `429` asks for 30 s and the deadline is 10 s away
- **THEN** the call fails with `rate_limited` at once, without sleeping

### Requirement: Outages and network failures are retried twice
A `5xx`, a network failure or a request that times out after 10 s SHALL be retried twice more, after 1 s and then 2 s inside the deadline, and SHALL then fail with `resend_unavailable`.

#### Scenario: Persistent 5xx
- **WHEN** Resend answers `503` to three attempts
- **THEN** the call fails with `resend_unavailable` after exactly three requests

#### Scenario: Refused connection
- **WHEN** nothing listens at the API's address
- **THEN** the call fails with `resend_unavailable` after three attempts

### Requirement: Responses are mapped by status, then name
Each response SHALL map by status first and Resend's error `name` second: `401` or `403` from a reconcile call and a `400` `validation_error` "API key is invalid" to `resend_auth_failed`; `404` from Retrieve Webhook to `reconciler_not_configured`; any other unhandled response to `internal_error`, logged once as `resend.request_failed` by `error_name` and `error_code` (RS-22).

#### Scenario: Revoked key
- **WHEN** Retrieve Webhook answers `401` named `restricted_api_key`
- **THEN** the call fails with `resend_auth_failed`

#### Scenario: Unhandled response
- **WHEN** a replay answers `422`
- **THEN** the call fails with `internal_error`, and the log line holds `error_name` and no Resend `message`

#### Scenario: Send email refusal
- **WHEN** Send Email answers `403`
- **THEN** the caller receives that status and name, never a mapped reconcile outcome

### Requirement: Nothing secret or Resend-written leaves the client
No Resend response body, API key or signing secret SHALL reach a log line, an error message, a stored row or any surface's output. Retrieve Webhook SHALL return only the webhook's `status`, and Retrieve Event only the payload's `created_at` (RS-13, RS-15).

#### Scenario: Retrieve Webhook drops the secret
- **WHEN** Retrieve Webhook answers with a `signing_secret`
- **THEN** the client's result holds `status` alone

#### Scenario: The SDK prints nothing
- **WHEN** a call gets a `4xx`, a `5xx` or a refused connection against the fake Resend API
- **THEN** nothing is written to the console's error stream

### Requirement: Every request names Ledger and every send is idempotent
Every request SHALL carry the client's `User-Agent` (`ledger-reconciler` or `ledger-gap-drill`), which names Ledger and claims no affiliation (RS-21), and every Send Email SHALL carry an `Idempotency-Key` (RS-24).

#### Scenario: Headers recorded
- **WHEN** a client sends a List Events request and a Send Email request to the fake Resend API
- **THEN** both carry its `User-Agent`, and the send carries an `Idempotency-Key`
