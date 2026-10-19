# Spec Delta

## Purpose

Gives every alarm and every runbook-linked error code one public runbook entry an operator can act
on, and keeps those links from rotting with a check that fails on a missing entry.

## ADDED Requirements

### Requirement: Every alarm has a runbook entry
`docs/runbook.md` SHALL hold one entry under `## Alarms` per CloudWatch alarm the stacks deploy, whose heading text is exactly the alarm's name. Each entry SHALL give four labelled lines: **Means**, **First** (the first command to run), **Then** (the decision steps, naming the `ledger` or `pnpm aws:*` command) and **Related** (the ADR or `AWS-NN` fact).

#### Scenario: The five alarms
- **WHEN** the runbook is read
- **THEN** it holds entries headed `LedgerApp-queue-age`, `LedgerApp-dlq-depth`, `LedgerApp-api-5xx`, `LedgerApp-usage-trip` and `LedgerGuardrails-kill-switch-errors`, each with the four labelled lines

### Requirement: Every runbook-linked error code has a runbook entry
`docs/runbook.md` SHALL hold one entry under `## Error codes` per registered error code whose `docs` link points at the runbook, headed with the code, with the same four labelled lines. An entry for a code whose operation lands in a later slice SHALL name that slice.

#### Scenario: A code from a later slice
- **WHEN** the `reconcile_in_progress` entry is read
- **THEN** it names slice 4 as the slice that lands its operation

### Requirement: The runbook is public and holds nothing private
The runbook SHALL open by stating that Ledger is not affiliated with Resend, and SHALL hold no account id, ARN, deployed URL, recipient address or secret.

#### Scenario: Secret scan over the runbook
- **WHEN** the repository's secret scan runs over the committed runbook
- **THEN** it reports nothing

### Requirement: The alarm-to-runbook link check
A unit test SHALL synthesize both stacks with the kill switch and the simulator flag on and fail unless every alarm's description contains `Runbook: <runbook base URL>#<slug>` whose slug is a runbook heading's GitHub anchor, and every registry `docs` link into the runbook resolves to a heading. It SHALL run in `pnpm check` with no CI change.

#### Scenario: A missing alarm entry
- **WHEN** an alarm's runbook heading is removed from `docs/runbook.md`
- **THEN** the link check fails naming that alarm

#### Scenario: A missing error-code entry
- **WHEN** a runbook-linked error code has no heading
- **THEN** the link check fails naming that code

#### Scenario: The checker cannot pass everything
- **WHEN** the checker is given a fabricated alarm description whose slug matches no heading
- **THEN** it rejects it

#### Scenario: Links inside the runbook
- **WHEN** the link check runs
- **THEN** the repository's relative-link checker over `docs/runbook.md` exits `0`
