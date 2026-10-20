# webhook-ingest — spec delta

## ADDED Requirements

### Requirement: Rejections are counted by reason
Each `401` SHALL emit one `ingest.rejected` metric with dimension `reason`: `timestamp` when `svix-timestamp` is absent, not an integer or more than 300 s from now in either direction, checked before any signature verification; `signature` for every other rejection. The metric SHALL carry no field, because an unverified request's `svix-id` is attacker-controlled.

#### Scenario: Stale timestamp
- **WHEN** a request arrives with a `svix-timestamp` 6 minutes old
- **THEN** it answers `401`, one `ingest.rejected` is emitted with `reason` `timestamp`, and no signature verification runs

#### Scenario: Missing signature header
- **WHEN** a request arrives with no `svix-signature`
- **THEN** it answers `401` and one `ingest.rejected` is emitted with `reason` `signature`

#### Scenario: Dimension on the deployed metric
- **WHEN** ingest emits `ingest.rejected` through the CloudWatch metric format
- **THEN** the line declares `reason` as its one dimension, and every other metric declares none

## MODIFIED Requirements

### Requirement: The secret set refreshes within 5 minutes
Ingest SHALL reuse a successfully read secret set for at most 5 minutes, then read it again, so an added or retired secret takes effect within 5 minutes with no redeploy (ADR-009, RS-04). A failed refresh SHALL NOT serve the expired set.

#### Scenario: Within the cache window
- **WHEN** two requests arrive 4 minutes apart
- **THEN** the secret set is read once

#### Scenario: After the window
- **WHEN** a request arrives 5 minutes after the last successful read
- **THEN** the set is read again, and a secret added in between verifies

#### Scenario: Retired secret
- **WHEN** the store holds `[old, new]`, a request signed with `old` is accepted, the store then drops `old`, and requests signed with `old` arrive before and after the 5-minute TTL on a fake clock
- **THEN** the one before the TTL is accepted, and the one after answers `401` and emits `ingest.rejected` with `reason` `signature`

#### Scenario: Failed refresh
- **WHEN** the set has expired and the refresh fails
- **THEN** ingest answers `503`, even for a request the expired set would have verified
