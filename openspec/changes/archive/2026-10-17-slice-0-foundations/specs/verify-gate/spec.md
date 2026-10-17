# Spec Delta

## Purpose

The single merge gate: one command that runs every CI stage in order, runs identically locally and
in CI, and fails loudly when a secret is committed or a README link breaks.

## ADDED Requirements

### Requirement: One gate, identical locally and in CI
`pnpm verify` SHALL run the stages `install, docker, secrets, lint, links, typecheck, unit, synth, e2e` in that order, stopping at the first failure. CI SHALL run exactly `pnpm verify` on every push and pull request, so the stage list has one source.

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
The `secrets` stage SHALL scan every commit on every ref with gitleaks from a version- and digest-pinned image, using `.gitleaks.toml`, which extends the default ruleset and adds rules for Resend API keys (`re_`), `whsec_` signing secrets and Postgres URLs that carry a password. It SHALL work from a git worktree, where `.git` is a file.

#### Scenario: Clean repository
- **WHEN** no commit on any ref carries a match
- **THEN** the stage prints `secrets: repo clean (<k> commits scanned)` and exits 0

#### Scenario: A committed fake Resend key
- **WHEN** any commit on any ref carries a string matching the Resend API key rule
- **THEN** the stage exits 1 and the finding is reported with the secret redacted

#### Scenario: Local throwaway credentials
- **WHEN** a Postgres URL with a password points at `localhost` or `127.0.0.1`
- **THEN** it is not a finding

#### Scenario: Run from a git worktree
- **WHEN** the stage runs in a checkout whose `.git` is a file pointing outside the working tree
- **THEN** it still scans the full history of every ref

### Requirement: The secret scan proves its own rules on every run
Before scanning the repository, the `secrets` stage SHALL run the same image over a throwaway repository holding one fake value per custom rule, built at runtime so no tracked line matches a rule, and SHALL fail unless each custom rule reports a finding.

#### Scenario: Canary caught
- **WHEN** each of `resend-api-key`, `resend-webhook-secret` and `postgres-url` reports a finding on the canary
- **THEN** the stage prints `secrets: canary caught 3/3 rules` and goes on to scan the repository

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
