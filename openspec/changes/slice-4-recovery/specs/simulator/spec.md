# simulator — spec delta

## MODIFIED Requirements

### Requirement: Database-outage knob
`--chaos db-outage` SHALL repoint the deployed database secret's pooled host to `ledger-sim-db-outage.invalid`, recycle the worker, the read API and the reconciler (each reads the secret once per container), send the history, wait for the event source to read `paused` (bounded 10 min), then hold until `LedgerApp-queue-age` reads `ALARM` (bounded 45 min) with the DLQ at 0, then restore the secret and recycle all three again, also on failure.

#### Scenario: Outage keeps ingest answering
- **WHEN** `pnpm sim --chaos db-outage` runs against the deployed stack
- **THEN** it prints `chaos db-outage: database repointed, worker, api and reconciler recycled`, `sent requests=<k> accepted=<k> first_attempt_200=<k>`, `worker paused after <s>s` and `queue-age alarm ALARM after <m>m; dlq depth 0`

#### Scenario: Restore on failure
- **WHEN** a db-outage run fails after repointing the secret
- **THEN** the original secret value is written back and all three functions recycled, printing `chaos db-outage: database restored, worker, api and reconciler recycled`; if that restore fails, it prints `sim: the database secret was not restored; run pnpm aws:deploy, which rewrites it` and exits `1`

#### Scenario: One restore step fails
- **WHEN** the restore's recycle of one or more functions fails
- **THEN** the secret is still written back and every other function still recycled, and it prints `sim: the database secret is restored, but recycling the <functions> failed; its containers that read the outage host keep it until recycled` and exits `1`

#### Scenario: A reconciler started during the outage
- **WHEN** the hourly reconcile tick, or a manual `ledger reconcile`, starts a reconciler container while the secret points at the outage host
- **THEN** the restore recycles the reconciler, so its next run reads the restored secret instead of keeping a pool on the outage host

#### Scenario: Already paused
- **WHEN** `--chaos db-outage` starts while the worker's event source is paused
- **THEN** it exits `1` and sends nothing

#### Scenario: Alarm already firing
- **WHEN** `--chaos db-outage` starts while `LedgerApp-queue-age` reads `ALARM`
- **THEN** it exits `1` before any write or recycle, and sends nothing

#### Scenario: A crashed run's fault is still in place
- **WHEN** `--chaos db-outage` starts while the database secret already points at `ledger-sim-db-outage.invalid`
- **THEN** it exits `1` naming `pnpm aws:deploy`, before any write, and sends nothing

#### Scenario: No secret printed
- **WHEN** a db-outage run prints any line
- **THEN** no line holds the database secret's value, a URL or a host other than `.invalid`, and nothing is written to disk
