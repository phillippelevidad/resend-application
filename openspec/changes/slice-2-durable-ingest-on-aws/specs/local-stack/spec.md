# Spec Delta

## ADDED Requirements

### Requirement: Local mode enforces bearer tokens
The local process SHALL enforce bearer tokens exactly as the deployed read API does (api-contract.md → Conventions): the same tag check, scopes and error codes. The ingest endpoint stays signature-verified and takes no token.

#### Scenario: No token locally
- **WHEN** a request without a token reaches the local process's root path
- **THEN** it answers `401` with `code` `unauthorized`

#### Scenario: Local health without a database
- **WHEN** `GET /health` is called with a tag-valid token while `DATABASE_URL` points at nothing
- **THEN** it answers `200` with `database.reachable: false`

#### Scenario: Local resume
- **WHEN** `ledger worker resume` runs against the local process
- **THEN** it prints `worker      enabled (already enabled)`

### Requirement: The local process binds loopback only
The local process SHALL refuse to start on any host other than `127.0.0.1`, `::1` or `localhost`, with the line `refusing to start: --host must be 127.0.0.1, ::1 or localhost`, and serve nothing.

#### Scenario: Non-loopback host
- **WHEN** the local server is started with `--host 0.0.0.0`
- **THEN** it exits `1` with that line and serves nothing

### Requirement: Local health reads the in-process queue
Locally, `health.get` SHALL report the in-process queue's own counts: messages waiting as visible, messages delivering as in flight, the oldest waiting message's age, the dead list as the DLQ's visible count, and the event source as `enabled`.

#### Scenario: A dead-listed message
- **WHEN** one message has been dead-listed by the in-process queue
- **THEN** local `health.get` reports `dlq.visible` `1`

## MODIFIED Requirements

### Requirement: Setup writes missing local configuration once
`pnpm db:setup` SHALL ensure `.env.local` holds `DATABASE_URL`, `LEDGER_ADDRESS_HASH_KEY` and `LEDGER_TOKEN_TAG_KEY` (each 32 random bytes as 64 lowercase hex characters), `LEDGER_SIMULATOR_SECRET` (`whsec_` plus base64 of 32 random bytes), `LEDGER_URL` and `LEDGER_TOKEN`, writing each only when unset or empty and never overwriting a value or another line, except `LEDGER_TOKEN` as the next requirement allows.

#### Scenario: First run
- **WHEN** `pnpm db:setup` runs with no `.env.local`
- **THEN** it creates the file with all six names set, and prints `db:setup: wrote <NAME> to .env.local` once per name

#### Scenario: Second run
- **WHEN** `pnpm db:setup` runs again
- **THEN** no value in `.env.local` changes and no `wrote` line is printed

#### Scenario: Existing unrelated line
- **WHEN** `.env.local` already holds `RESEND_API_KEY` and a set `LEDGER_ADDRESS_HASH_KEY`
- **THEN** both lines are preserved unchanged

#### Scenario: Keys written before the database is touched
- **WHEN** `pnpm db:setup` runs on a machine with no local Postgres
- **THEN** both keys are written, and it then ends `db:setup: failed: <reason>`

### Requirement: Local process boot assertion
The local process SHALL refuse to start unless `DATABASE_URL` is set, `LEDGER_ADDRESS_HASH_KEY` and `LEDGER_TOKEN_TAG_KEY` are each 64 lowercase hex characters, every `LEDGER_WEBHOOK_SECRETS` entry and `LEDGER_SIMULATOR_SECRET` match `whsec_` plus base64, and at least one secret is set. A failure SHALL exit `1` naming the variable, never its value.

#### Scenario: Missing address-hash key
- **WHEN** the local process starts with `LEDGER_ADDRESS_HASH_KEY` unset
- **THEN** it exits `1` with a line naming `LEDGER_ADDRESS_HASH_KEY`

#### Scenario: Missing token-tag key
- **WHEN** the local process starts with `LEDGER_TOKEN_TAG_KEY` unset
- **THEN** it exits `1` with a line naming `LEDGER_TOKEN_TAG_KEY`

#### Scenario: No signing secret at all
- **WHEN** both `LEDGER_WEBHOOK_SECRETS` and `LEDGER_SIMULATOR_SECRET` are unset
- **THEN** it exits `1`, because an empty secret set would answer `401` to every delivery

### Requirement: One loopback process serves ingest and the read API
The local process SHALL route the ingest endpoint (api-contract.md → Ingest boundary) to ingest and every other request to the read API, on one loopback port, and SHALL run the worker against the local queue in the same process.

#### Scenario: Unsigned webhook
- **WHEN** an unsigned request reaches the ingest endpoint of the local process
- **THEN** it answers `401` with body `unauthorized`

#### Scenario: Other paths reach the read API
- **WHEN** a request with a valid token for the root path, which no operation serves, reaches the local process
- **THEN** it answers `404` with `code` `route_not_found` in the error shape

#### Scenario: Signed event lands in the ledger
- **WHEN** a correctly signed event is posted to the local process
- **THEN** it answers `200`, and the event is then readable through `email.get` with a valid token

### Requirement: Setup prepares the database
After writing configuration, `pnpm db:setup` SHALL ensure the runtime role and its two timeouts, apply pending migrations as the owner, then write a working `LEDGER_TOKEN` when the current one is empty, the placeholder `local-loopback-no-auth`, fails the tag check under the file's tag key, or matches no active token. It SHALL end `db:setup: ready` and exit `0`, or `db:setup: failed: <constant reason>` and exit `1`. A rerun SHALL change nothing.

#### Scenario: Fresh database
- **WHEN** `pnpm db:setup` runs against an empty compose Postgres
- **THEN** the runtime role exists with both timeouts, the ledger tables and `api_tokens` exist, a bootstrap `operate` token is in `.env.local` as `LEDGER_TOKEN`, and it prints `db:setup: ready`

#### Scenario: Slice 1 placeholder
- **WHEN** `.env.local` holds `LEDGER_TOKEN=local-loopback-no-auth`
- **THEN** setup replaces it with a working `operate` token and prints `db:setup: wrote LEDGER_TOKEN to .env.local`, never the value

#### Scenario: Bootstrap already taken
- **WHEN** the database already holds a bootstrap token and `LEDGER_TOKEN` matches no active token
- **THEN** setup inserts an `operate` token named `local-setup` and writes it

#### Scenario: Working token kept
- **WHEN** `LEDGER_TOKEN` is an active token under the file's tag key
- **THEN** setup leaves it unchanged

#### Scenario: Postgres not running
- **WHEN** `pnpm db:setup` runs with compose Postgres stopped
- **THEN** it prints `db:setup: failed: <reason>` without any URL or password and exits `1`

### Requirement: dev:full runs setup
`pnpm dev:full` SHALL run `pnpm db:setup` after Postgres is healthy and before the server starts, so a fresh clone reaches `LEDGER READY` with no hand-made key, token or SQL.

#### Scenario: Fresh clone
- **WHEN** `pnpm dev:full` runs in a clone with no `.env.local`
- **THEN** it prints `LEDGER READY`, `.env.local` holds the six variables, and `pnpm -s ledger token current` answers with an `operate` token
