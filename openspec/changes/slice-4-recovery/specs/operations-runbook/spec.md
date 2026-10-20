# operations-runbook — spec delta

## ADDED Requirements

### Requirement: The rotation procedure
`docs/runbook.md` SHALL hold `### Rotate the webhook signing secret` under `## Procedures`, in this order: rotate at Resend, which returns the new secret (RS-13); deploy the set `<old>,<new>`; watch `ingest.rejected` with `reason` `signature` stay flat; within 24 h of the rotation (RS-04) deploy the new secret alone and watch again; and, if the old secret was retired too early, restore it and run `pnpm -s ledger reconcile`.

#### Scenario: The order holds
- **WHEN** the procedure is read
- **THEN** the rotation at Resend comes before adding the new secret, and retiring the old one comes after it with the 24 h bound

#### Scenario: Local mode
- **WHEN** the procedure is read
- **THEN** it names `LEDGER_WEBHOOK_SECRETS` and a restart for local mode

## MODIFIED Requirements

### Requirement: Every alarm has a runbook entry
`docs/runbook.md` SHALL hold one entry under `## Alarms` per CloudWatch alarm the stacks deploy, whose heading text is exactly the alarm's name. Each entry SHALL give four labelled lines: **Means**, **First** (the first command to run), **Then** (the decision steps, naming the `ledger` or `pnpm aws:*` command) and **Related** (the ADR or `AWS-NN` fact).

#### Scenario: The five alarms
- **WHEN** the runbook is read
- **THEN** it holds entries headed `LedgerApp-queue-age`, `LedgerApp-dlq-depth`, `LedgerApp-api-5xx`, `LedgerApp-usage-trip` and `LedgerGuardrails-kill-switch-errors`, each with the four labelled lines

#### Scenario: The reconcile-gap entry
- **WHEN** the `LedgerApp-reconcile-gap` entry is read
- **THEN** it has the four labelled lines, its **First** line is `pnpm -s ledger gaps --since 2h`, and it names the expected firings: before the first configured deploy, after a trip, and during a gap drill

### Requirement: Every runbook-linked error code has a runbook entry
`docs/runbook.md` SHALL hold one entry under `## Error codes` per registered error code whose `docs` link points at the runbook, headed with the code, with the same four labelled lines. An entry for a code whose operation lands in a later slice SHALL name that slice, and an entry whose operation has landed SHALL name its command instead.

#### Scenario: A code from a later slice
- **WHEN** the entry is read for a runbook-linked code whose operation is not built yet
- **THEN** it names the slice that lands that operation

#### Scenario: A code whose operation has landed
- **WHEN** the `reconcile_in_progress`, `run_not_found` and `run_abandoned` entries are read
- **THEN** each names a `pnpm -s ledger` command and none says a later slice lands it

#### Scenario: The new code
- **WHEN** the runbook is read
- **THEN** it holds a `reconciler_not_configured` entry naming `LEDGER_DEPLOY_RESEND_API_KEY`, `LEDGER_DEPLOY_RESEND_WEBHOOK_ID` and `pnpm aws:deploy`
