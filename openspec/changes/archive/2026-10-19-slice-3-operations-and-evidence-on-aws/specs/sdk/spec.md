# Spec Delta

## ADDED Requirements

### Requirement: DLQ methods
The client SHALL expose `dlq.listMessages({ limit? })` for `dlq.listMessages` and `dlq.startRedrive()` for `dlq.startRedrive`, each returning `{ data, error }` and never throwing for an API error. Neither SHALL retry in this slice.

#### Scenario: Sample returned
- **WHEN** `dlq.listMessages({ limit: 5 })` succeeds
- **THEN** it returns `{ data }` holding the list object with `depth`, `has_more` and the items

#### Scenario: Running redrive is a value
- **WHEN** `dlq.startRedrive()` is called while a redrive task runs
- **THEN** it returns `error.code` `redrive_in_progress` and does not throw

#### Scenario: One request per call
- **WHEN** `dlq.startRedrive()` gets no answer
- **THEN** it returns `error.code` `api_unavailable` after exactly one request

#### Scenario: Contract round trip
- **WHEN** the SDK ↔ API contract suite runs
- **THEN** both DLQ methods' success and error paths (`validation_failed`, `forbidden`, `redrive_in_progress`) pass under the local server and through the Lambda adapter
