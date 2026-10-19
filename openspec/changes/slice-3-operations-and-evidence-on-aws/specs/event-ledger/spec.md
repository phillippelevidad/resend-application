# Spec Delta

## ADDED Requirements

### Requirement: A poison message is isolated, and applies once after a redrive
A message that fails on every receive SHALL reach the dead list after `maxReceiveCount` receives while every other message of its batches commits once. Once the fault is fixed and the dead message is redriven, it SHALL commit exactly one `webhook_events` row for its `svix_id`, whether it arrives for the first time or again after a duplicate delivery or a second redrive (ADR-004, ADR-008, AWS-21).

#### Scenario: Poison isolated while the others commit
- **WHEN** five events are delivered and one of them fails on every receive
- **THEN** that message is on the dead list after its fifth receive, and the other four events each have exactly one `webhook_events` row

#### Scenario: Redrive after the fix
- **WHEN** the fault is removed and the dead list is redriven
- **THEN** the redriven event has exactly one `webhook_events` row, and the dead list is empty

#### Scenario: Redriven twice
- **WHEN** the redriven event is delivered again under a new message id
- **THEN** it commits as a duplicate, and its `svix_id` still has exactly one `webhook_events` row
