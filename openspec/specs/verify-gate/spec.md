# verify-gate Specification

## Purpose

The single merge gate: one command that runs every CI stage in order, runs identically locally and
in CI, and fails loudly when a secret is committed or a README link breaks.

## Requirements

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

### Requirement: CI workflow hardening
The CI workflow SHALL trigger on `push` and `pull_request` (never `pull_request_target`), run with `permissions: contents: read`, pin every third-party action by commit SHA, fetch the full git history, and install with `pnpm install --frozen-lockfile`.

#### Scenario: A pushed commit is gated
- **WHEN** a commit is pushed to any branch
- **THEN** a CI run executes `pnpm verify` against it and its conclusion is `success` only if the gate passed

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

### Requirement: Secret scan output never prints a secret
Every finding the `secrets` stage prints SHALL be redacted, because CI logs are public.

#### Scenario: A finding in CI
- **WHEN** the stage reports a finding in a CI run
- **THEN** the job log shows the rule id, file and commit, and never the matched value

### Requirement: README link check
The `links` stage SHALL check that every relative link and image target in `README.md` resolves, from the file that holds it, to an existing file or directory, and that every `#anchor` matches a heading slug (GitHub's algorithm) or an explicit `id`/`name` in the target. It SHALL skip `http(s):` and `mailto:` targets. Other files MAY be named as arguments.

#### Scenario: Clean README
- **WHEN** every relative link and anchor in `README.md` resolves
- **THEN** the stage prints `links: README.md <n> checked, 0 broken` and exits 0

#### Scenario: Missing anchor
- **WHEN** a checked file links to an existing Markdown file at an anchor no heading produces
- **THEN** it prints `<file>:<line> <target> (missing anchor)` and exits 1

#### Scenario: Missing file
- **WHEN** a checked file links to a relative path that does not exist
- **THEN** it prints `<file>:<line> <target> (missing file)` and exits 1

#### Scenario: External links are not fetched
- **WHEN** a checked file holds an `https://` or `mailto:` link
- **THEN** the link is neither fetched nor counted as broken

### Requirement: The link check proves itself on every run
Before checking any file, the `links` stage SHALL run over a throwaway pair of files holding one valid anchor link, one link to a missing anchor and one link to a missing file, and SHALL fail unless exactly the two broken links are reported, with the right reason each.

#### Scenario: Canary caught
- **WHEN** the canary reports exactly one `missing anchor` and one `missing file`
- **THEN** the stage prints `links: canary caught 2/2` and goes on to the named files

#### Scenario: Canary missed
- **WHEN** the canary reports anything else
- **THEN** the stage prints `links: canary missed <reason>` and exits 1

### Requirement: Contract drift fails the gate
The `drift` stage SHALL regenerate the read API's OpenAPI document and the SDK's generated types into a temporary directory and compare them byte for byte with the committed `packages/sdk/openapi.json` and `packages/sdk/src/openapi-types.ts`, failing when either differs.

#### Scenario: Committed files match
- **WHEN** both committed files equal what the read API generates
- **THEN** the stage prints `drift: openapi.json and openapi-types.ts match packages/api` and exits 0

#### Scenario: A route changed without export
- **WHEN** a read-API route's schema changes and `pnpm openapi:export` was not run
- **THEN** the stage prints `drift: <file> differs from packages/api; run pnpm openapi:export and read the diff (a changed contract is Ask-first)` and exits 1

### Requirement: The drift stage proves itself on every run
Before comparing the committed files, the `drift` stage SHALL compare a copy of the freshly generated `openapi.json` with one byte changed, and SHALL fail unless that copy is reported as drift.

#### Scenario: Canary caught
- **WHEN** the one-byte-changed copy is reported as drift
- **THEN** the stage prints `drift: canary caught 1/1` and goes on to the committed files

#### Scenario: Canary missed
- **WHEN** the comparison reports no drift for the changed copy
- **THEN** the stage exits 1 without comparing the committed files

### Requirement: Migrations apply to a fresh Postgres before integration tests
The `int` stage SHALL start a fresh Postgres, ensure the runtime role, and apply every migration as the owner before any integration test runs; each test SHALL then connect as the runtime role, so a failing migration or a missing grant fails the gate (ADR-018).

#### Scenario: A migration fails
- **WHEN** any migration fails to apply to the fresh Postgres
- **THEN** no integration test runs and the stage exits non-zero

#### Scenario: A missing grant
- **WHEN** a table the tests write lacks a grant to the runtime role
- **THEN** an integration test fails with a permission error and the stage exits non-zero

#### Scenario: Closed sets match their checks
- **WHEN** the integration tests insert every member of each closed-set column's tuple as the runtime role, and one value outside it
- **THEN** every member is accepted and the outsider is refused with SQLSTATE `23514`

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
