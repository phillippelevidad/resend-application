# local-stack — spec delta

## ADDED Requirements

### Requirement: Local reconcile runs end not configured
Locally, `reconcile.start` SHALL insert a manual run and hand it to the in-process reconciler, which SHALL finish it `reconciler_not_configured` with no Resend call, because a local process has no webhook of its own to replay to. `gaps.list` and `health.get` SHALL read local runs. No local variable SHALL configure a live reconcile.

#### Scenario: A local dry run
- **WHEN** `ledger reconcile --dry-run --json` runs against the local process
- **THEN** it exits `1` with `code` `reconciler_not_configured`, and no request leaves the process for Resend

#### Scenario: Local runs are listed
- **WHEN** `ledger gaps` runs after that run
- **THEN** its row ends `reconciler_not_configured`, and `ledger health` prints `reconcile   run <id> reconciler_not_configured`
