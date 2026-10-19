# Spec Delta

## ADDED Requirements

### Requirement: Local DLQ reads the in-process dead list
Locally, `dlq.listMessages` SHALL sample the in-process queue's dead list, with `depth` its length, and `dlq.startRedrive` SHALL move every dead message back to the waiting list with its receive count reset, answering `started` with the number moved, or `empty`. A local redrive completes at once, so it never answers `redrive_in_progress`. The Postgres-backed queue's dead rows are slice 2B's.

#### Scenario: Empty local DLQ
- **WHEN** `ledger dlq inspect` runs against the local process with nothing dead-listed
- **THEN** it prints `dlq         empty`

#### Scenario: Local redrive of a dead-listed message
- **WHEN** one message has been dead-listed by the in-process queue and `dlq.startRedrive` is called
- **THEN** it answers `202` with `depth: 1`, and local `health.get` then reports `dlq.visible` `0`

#### Scenario: Nothing to move locally
- **WHEN** `ledger dlq redrive` runs against the local process with nothing dead-listed
- **THEN** it prints `redrive     nothing to move: the dlq is empty`
