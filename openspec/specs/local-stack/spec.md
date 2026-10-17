# local-stack Specification

## Purpose

Brings the whole ledger up on a developer machine with no manual step: one setup command writes the
local configuration and migrates Postgres, and one loopback process serves ingest, the worker and
the read API together.

## Requirements

### Requirement: Setup writes missing local configuration once
`pnpm db:setup` SHALL ensure `.env.local` holds `DATABASE_URL`, `LEDGER_ADDRESS_HASH_KEY` (32 random bytes as 64 lowercase hex characters), `LEDGER_SIMULATOR_SECRET` (`whsec_` plus base64 of 32 random bytes), `LEDGER_URL` and `LEDGER_TOKEN`, writing each only when unset or empty and never overwriting a value or another line.

#### Scenario: First run
- **WHEN** `pnpm db:setup` runs with no `.env.local`
- **THEN** it creates the file with all five names set, and prints `db:setup: wrote <NAME> to .env.local` once per name

#### Scenario: Second run
- **WHEN** `pnpm db:setup` runs again
- **THEN** no value in `.env.local` changes and no `wrote` line is printed

#### Scenario: Existing unrelated line
- **WHEN** `.env.local` already holds `RESEND_API_KEY` and a set `LEDGER_ADDRESS_HASH_KEY`
- **THEN** both lines are preserved unchanged

### Requirement: Setup never prints a value
`pnpm db:setup` SHALL print variable names only, never a value, key or secret.

#### Scenario: Output after generating a key
- **WHEN** `pnpm db:setup` generates `LEDGER_ADDRESS_HASH_KEY`
- **THEN** no output line contains the generated value

### Requirement: Setup prepares the database
After writing configuration, `pnpm db:setup` SHALL ensure the runtime role exists, then apply every pending migration as the owner, and end with `db:setup: ready` and exit `0`, or `db:setup: failed: <constant reason>` and exit `1`. Running it again SHALL change nothing.

#### Scenario: Fresh database
- **WHEN** `pnpm db:setup` runs against an empty compose Postgres
- **THEN** the runtime role exists, the four ledger tables exist, and it prints `db:setup: ready`

#### Scenario: Postgres not running
- **WHEN** `pnpm db:setup` runs with compose Postgres stopped
- **THEN** it prints `db:setup: failed: <reason>` without any URL or password and exits `1`

### Requirement: dev:full runs setup
`pnpm dev:full` SHALL run `pnpm db:setup` after Postgres is healthy and before the server starts, so a fresh clone reaches `LEDGER READY` with no hand-made key or SQL.

#### Scenario: Fresh clone
- **WHEN** `pnpm dev:full` runs in a clone with no `.env.local`
- **THEN** it prints `LEDGER READY` and `.env.local` holds the five variables

### Requirement: Local process boot assertion
The local process SHALL refuse to start unless `DATABASE_URL` is set, `LEDGER_ADDRESS_HASH_KEY` is 64 hex characters, every `LEDGER_WEBHOOK_SECRETS` entry and `LEDGER_SIMULATOR_SECRET` match `whsec_` plus base64, and at least one secret is set. A failure SHALL exit `1` naming the variable, never its value.

#### Scenario: Missing address-hash key
- **WHEN** the local process starts with `LEDGER_ADDRESS_HASH_KEY` unset
- **THEN** it exits `1` with a line naming `LEDGER_ADDRESS_HASH_KEY`

#### Scenario: No signing secret at all
- **WHEN** both `LEDGER_WEBHOOK_SECRETS` and `LEDGER_SIMULATOR_SECRET` are unset
- **THEN** it exits `1`, because an empty secret set would answer `401` to every delivery

### Requirement: One loopback process serves ingest and the read API
The local process SHALL route the ingest endpoint (api-contract.md → Ingest boundary) to ingest and every other request to the read API, on one loopback port, and SHALL run the worker against the local queue in the same process.

#### Scenario: Unsigned webhook
- **WHEN** an unsigned request reaches the ingest endpoint of the local process
- **THEN** it answers `401` with body `unauthorized`

#### Scenario: Other paths reach the read API
- **WHEN** a request for the root path, which no operation serves, reaches the local process
- **THEN** it answers `404` with `code` `route_not_found` in the error shape

#### Scenario: Signed event lands in the ledger
- **WHEN** a correctly signed event is posted to the local process
- **THEN** it answers `200`, and the event is then readable through `email.get`

### Requirement: Real Resend deliveries verify locally
A delivery forwarded by `resend webhooks listen --forward-to` with its original Svix headers (RS-33) SHALL verify against the session's signing secret once it is in `LEDGER_WEBHOOK_SECRETS`, and take the ordinary path. Whether a session's secret is obtainable is RS-U22.

#### Scenario: Forwarded delivery
- **WHEN** a `listen` session forwards a delivery and its temporary webhook's secret is in `LEDGER_WEBHOOK_SECRETS`
- **THEN** local ingest answers `200`, or the `401` is recorded as RS-U22's negative answer
