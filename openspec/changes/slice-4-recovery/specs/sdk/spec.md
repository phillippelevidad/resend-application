# sdk — spec delta

## ADDED Requirements

### Requirement: Gaps and reconcile methods
The client SHALL expose `gaps.list({ since?, limit?, after? })` for `gaps.list`, `reconcile.getRun(runId)` for `reconcile.getRun` and `reconcile.start({ dry_run?, lookback? })` for `reconcile.start`, each returning `{ data, error }` and never throwing for an API error. Neither read SHALL retry in this slice.

#### Scenario: Start returns the run
- **WHEN** `reconcile.start({ dry_run: true })` succeeds
- **THEN** it returns `{ data }` holding the `reconcile_run` object with `dry_run: true`

#### Scenario: An overlapping start is a value
- **WHEN** `reconcile.start()` is called while a run is unfinished inside its budget
- **THEN** it returns `error.code` `reconcile_in_progress` and does not throw

#### Scenario: Abandoned through the contract
- **WHEN** the SDK ↔ API contract suite reads a run past its budget with no `finished_at` through `reconcile.getRun` and `gaps.list`
- **THEN** both return it with `error.code` `run_abandoned`, under the local server and through the Lambda adapter

#### Scenario: Contract round trip
- **WHEN** the SDK ↔ API contract suite runs
- **THEN** the three methods' success and error paths (`validation_failed` per field, `run_not_found`, `forbidden`, `reconcile_in_progress`) pass under the local server and through the Lambda adapter

### Requirement: reconcile.start is never retried
The client SHALL send `reconcile.start` once per call and SHALL NOT retry it, because each accepted call starts a run that spends the shared Resend budget.

#### Scenario: Lost response
- **WHEN** `reconcile.start` gets no answer
- **THEN** it returns `error.code` `api_unavailable` after exactly one request
