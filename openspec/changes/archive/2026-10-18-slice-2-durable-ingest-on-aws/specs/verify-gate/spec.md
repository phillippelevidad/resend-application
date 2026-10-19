# Spec Delta

## ADDED Requirements

### Requirement: Migration lint fails contract-breaking DDL
The `migrations` stage SHALL check every migration file and fail on a statement holding `DROP`, `RENAME`, `ALTER … TYPE` or `SET NOT NULL` (case-insensitive, `--` comments ignored) unless the file's first line is `-- contract-step: <40-hex SHA>` or `-- contract-step: replace: <name>, <widen|narrow>` (ADR-018).

#### Scenario: Unmarked DROP COLUMN
- **WHEN** a migration holds `ALTER TABLE t DROP COLUMN c;` with no marker
- **THEN** the stage names the file and exits 1

#### Scenario: Marked contract step
- **WHEN** the same statement's file starts with `-- contract-step: <40-hex SHA>`
- **THEN** the stage passes it

#### Scenario: Clean migrations
- **WHEN** every migration is pure expand
- **THEN** the stage prints `migrations: <n> checked, 0 unmarked` and exits 0

### Requirement: The migration lint proves itself on every run
Before checking the repository's migrations, the `migrations` stage SHALL lint an in-memory `ALTER TABLE t DROP COLUMN c;` that must fail and a marked copy that must pass, and SHALL exit 1 unless both behave.

#### Scenario: Canary caught
- **WHEN** the unmarked canary fails and the marked copy passes
- **THEN** the stage prints `migrations: canary caught 1/1` and goes on to the migration files

#### Scenario: Canary missed
- **WHEN** the unmarked canary passes
- **THEN** the stage exits 1 without checking the migration files

## MODIFIED Requirements

### Requirement: One gate, identical locally and in CI
`pnpm verify` SHALL run the stages `install, docker, secrets, lint, migrations, links, typecheck, drift, unit, int, synth, e2e` in that order, stopping at the first failure. CI SHALL run exactly `pnpm verify` on every push and pull request, so the stage list has one source.

#### Scenario: Every stage passes
- **WHEN** `pnpm verify` runs and every stage exits 0
- **THEN** it prints `VERIFY PASSED` and exits 0

#### Scenario: A stage fails
- **WHEN** any stage exits non-zero
- **THEN** no later stage runs, it prints `VERIFY FAILED: <stage>` and exits 1

#### Scenario: A resumed run is not the gate
- **WHEN** `pnpm verify --from <stage>` runs and every remaining stage passes
- **THEN** it ends `VERIFY PARTIAL`, never `VERIFY PASSED`

### Requirement: Secret scan over the full history
The `secrets` stage SHALL scan every commit on every ref with gitleaks from a version- and digest-pinned image, using `.gitleaks.toml`, which extends the default ruleset and adds rules for Resend API keys (`re_`), `whsec_` signing secrets, Postgres URLs that carry a password, and Ledger API tokens (`ldg_`). It SHALL work from a git worktree, where `.git` is a file.

#### Scenario: Clean repository
- **WHEN** no commit on any ref carries a match
- **THEN** the stage prints `secrets: repo clean (<k> commits scanned)` and exits 0

#### Scenario: A committed fake Resend key
- **WHEN** any commit on any ref carries a string matching the Resend API key rule
- **THEN** the stage exits 1 and the finding is reported with the secret redacted

#### Scenario: A committed Ledger token
- **WHEN** any commit on any ref carries a string matching `ldg_[0-9a-f]{64}_[0-9a-f]{64}`
- **THEN** the stage exits 1 and the finding is reported with the token redacted

#### Scenario: Local throwaway credentials
- **WHEN** a Postgres URL with a password points at `localhost` or `127.0.0.1`
- **THEN** it is not a finding

#### Scenario: Run from a git worktree
- **WHEN** the stage runs in a checkout whose `.git` is a file pointing outside the working tree
- **THEN** it still scans the full history of every ref

### Requirement: The secret scan proves its own rules on every run
Before scanning the repository, the `secrets` stage SHALL run the same image over a throwaway repository holding one fake value per custom rule, built at runtime so no tracked line matches a rule, and SHALL fail unless each custom rule reports a finding.

#### Scenario: Canary caught
- **WHEN** each of `resend-api-key`, `resend-webhook-secret`, `postgres-url` and `ledger-api-token` reports a finding on the canary
- **THEN** the stage prints `secrets: canary caught 4/4 rules` and goes on to scan the repository

#### Scenario: Rule rot
- **WHEN** any custom rule reports no finding on the canary
- **THEN** the stage prints `secrets: canary missed rule <id>` and exits 1 without scanning the repository
