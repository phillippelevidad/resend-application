# Spec Delta

## ADDED Requirements

### Requirement: Health, worker and token methods
The client SHALL expose `health.get()` for `health.get`, `worker.resumeEventSource()` for `worker.resumeEventSource`, and `tokens.getCurrent()`, `tokens.list({ limit?, after? })`, `tokens.create({ name, scope })` and `tokens.revoke(tokenId)` for the four token operations, each returning `{ data, error }` and never throwing for an API error.

#### Scenario: Create returns the plaintext
- **WHEN** `tokens.create({ name: 'review-walk', scope: 'read' })` succeeds
- **THEN** it returns `{ data }` holding the token object and its `token`

#### Scenario: Forbidden is a value
- **WHEN** a `read` token calls `tokens.list()`
- **THEN** it returns `error.code` `forbidden` and does not throw

#### Scenario: Health during an outage
- **WHEN** `health.get()` is called while Postgres is stopped
- **THEN** it returns `{ data }` with `database.reachable: false`

### Requirement: token.create is never retried
The client SHALL send `tokens.create` once per call and SHALL NOT retry it, because each call mints a new token.

#### Scenario: Lost response
- **WHEN** `tokens.create` gets no answer
- **THEN** it returns `error.code` `api_unavailable` after exactly one request

### Requirement: The contract runs through the Lambda adapter
The SDK ↔ API contract cases SHALL run against the same read-API app both under the local HTTP server and through the Lambda adapter with synthetic API Gateway payload-2.0 events, covering every operation's success and error paths (ADR-019).

#### Scenario: Same cases, two adapters
- **WHEN** the contract suite runs under the local server and through the Lambda adapter
- **THEN** every case passes in both runs, `unauthorized`, `forbidden` and `route_not_found` included
