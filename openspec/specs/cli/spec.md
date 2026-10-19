# cli Specification

## Purpose

Gives support engineers and reviewers the `ledger` command line over the SDK: look up an email or a
recipient, read it as an aligned human layout or as `--json`, and get stable exit codes and the one
error shape on failure.

## Requirements

### Requirement: ledger email
`ledger email <email_id> [--json]` SHALL call `email.get` through the SDK. On success it SHALL exit `0` and print the human layout to stdout, or, under `--json`, exactly the operation's `data` as one JSON document.

#### Scenario: Human layout
- **WHEN** `ledger email <id>` runs for a bounced email with two recipients
- **THEN** it exits `0` and stdout shows the `email`, `status`, `from`, `subject`, `events`, `opens`, `clicks` lines, then a `recipients` section and a `timeline` section with aligned columns and ISO 8601 timestamps

#### Scenario: JSON output
- **WHEN** `ledger email <id> --json` runs
- **THEN** it exits `0` and stdout is one JSON document with `"object": "email"`, equal to the API's `200` body

### Requirement: ledger recipient
`ledger recipient <address> [--json]` SHALL call `recipient.get` through the SDK with the address in the request body. Its output SHALL show the address only as the API's `address_masked`.

#### Scenario: Hard-bounced recipient
- **WHEN** `ledger recipient bounced+walk@resend.dev` runs for a recipient whose bounce was `Permanent` (RS-28, RS-32)
- **THEN** it exits `0`, and stdout shows `deliverability   hard_bounced` and the causing email id, and no line holds the raw address

### Requirement: Registry errors exit 1
A registry error from the API SHALL exit `1`. Under `--json`, stdout SHALL hold the `{ "error": … }` object and nothing else. Without it, stderr SHALL hold the `message` line then `hint: <hint>`, and stdout SHALL be empty.

#### Scenario: Unknown email under --json
- **WHEN** `ledger email no-such-email --json` runs
- **THEN** it exits `1` and stdout holds an error object with `code` `email_not_found`

#### Scenario: Unknown recipient in human mode
- **WHEN** `ledger recipient never-seen+walk@resend.dev` runs
- **THEN** it exits `1`, stderr holds the message and a `hint:` line, and stdout is empty

#### Scenario: API unreachable
- **WHEN** nothing answers at `LEDGER_URL`
- **THEN** it exits `1` with `code` `api_unavailable`

### Requirement: Usage and configuration errors exit 2
A missing argument, an unknown option, or a missing or invalid `LEDGER_URL` or `LEDGER_TOKEN` SHALL exit `2` before any request is made. Stderr SHALL name the problem or the variable, never a variable's value.

#### Scenario: Missing argument
- **WHEN** `ledger email` runs with no `email_id`
- **THEN** it exits `2`, stderr holds the missing-argument message, and stdout is empty

#### Scenario: Missing LEDGER_URL
- **WHEN** a command runs with `LEDGER_URL` unset
- **THEN** it exits `2`, stderr names `LEDGER_URL`, and no request is made

### Requirement: Unexpected failures exit 1 with internal_error
An unexpected client-side failure SHALL exit `1`. Under `--json`, stdout SHALL hold an error object with `code` `internal_error`; otherwise stderr SHALL hold `ledger: unexpected failure.`

#### Scenario: Defect under --json
- **WHEN** a command fails with an unexpected error under `--json`
- **THEN** it exits `1` and stdout holds an error object with `code` `internal_error`

### Requirement: Human output never carries a control character
Every value the human layout prints SHALL have each control character (C0, DEL, C1) mapped to `*`, `null` printed as `—`, and empty sections printed as `  —`, so an open string from a payload cannot carry a terminal escape.

#### Scenario: Escape in a bounce type
- **WHEN** a recipient's `bounce_type` holds `\u001b[31m`
- **THEN** the human layout prints `*` in place of the ESC character and stdout holds no `\u001b`

### Requirement: Local start loads .env.local
In this slice the CLI SHALL run from the workspace as `pnpm -s ledger <command>`, loading `LEDGER_URL` and `LEDGER_TOKEN` from `.env.local` when present, with `-s` keeping pnpm's banner off stdout so `--json` stays one document.

#### Scenario: JSON through the root script
- **WHEN** `pnpm -s ledger email <id> --json` runs after `pnpm db:setup`
- **THEN** stdout parses as exactly one JSON document

### Requirement: ledger health
`ledger health [--json]` SHALL call `health.get` and print `queue`, `dlq`, `worker` and `database` lines with aligned columns: counts, `oldest <n>s` or `oldest —`, the event-source state, and `reachable, <used> of <limit>` or `unreachable`. Under `--json` it SHALL print exactly the operation's `data`.

#### Scenario: Healthy human layout
- **WHEN** `ledger health` runs against an empty, healthy pipeline
- **THEN** it exits `0` and prints `queue       0 visible, 0 in flight, oldest —`, `dlq         0 visible, 0 in flight`, `worker      enabled` and a `database    reachable, …` line

#### Scenario: During an outage
- **WHEN** `ledger health` runs while the database is unreachable
- **THEN** it exits `0` and prints `database    unreachable`

#### Scenario: Tripped stack
- **WHEN** the kill switch has stopped the read API
- **THEN** `ledger health` exits `1` with `code` `api_unavailable`

### Requirement: ledger worker resume
`ledger worker resume [--json]` SHALL call `worker.resumeEventSource` and print `worker      <state> (resumed)` or `worker      enabled (already enabled)`.

#### Scenario: Already enabled
- **WHEN** `ledger worker resume` runs while the event source is enabled
- **THEN** it exits `0` and prints `worker      enabled (already enabled)`

#### Scenario: Read token
- **WHEN** it runs with a `read` token
- **THEN** it exits `1` with `code` `forbidden`

### Requirement: ledger token create
`ledger token create --name <name> --scope <read|operate> [--json]` SHALL call `token.create` and print the `token`, `name`, `scope`, `created` and `secret` lines to stdout, plus one stderr notice `ledger: this is the only time the token is shown; store it now.` The plaintext SHALL appear on stdout only, once, never on stderr.

#### Scenario: Plaintext on stdout once
- **WHEN** `ledger token create --name review-walk --scope read` succeeds
- **THEN** stdout holds the plaintext exactly once and stderr holds the notice and no part of the token

#### Scenario: Missing scope
- **WHEN** `--scope` is omitted
- **THEN** it exits `2` and no request is made

### Requirement: ledger token list
`ledger token list [--json]` SHALL request the newest 100 tokens and print one row per token: id, name, scope, `created_at`, and `revoked_at` or `—`. When more exist it SHALL print `ledger: more tokens exist; showing the newest 100.` to stderr.

#### Scenario: More than 100
- **WHEN** the API answers `has_more: true`
- **THEN** it exits `0`, prints 100 rows and the stderr notice

### Requirement: ledger token revoke
`ledger token revoke <token_id> [--json]` SHALL call `token.revoke` and print the token lines plus `revoked     <time>`.

#### Scenario: Last operate token
- **WHEN** the only active `operate` token is revoked
- **THEN** it exits `1` with `code` `last_operate_token`

#### Scenario: Missing id
- **WHEN** no `<token_id>` is given
- **THEN** it exits `2` and no request is made

### Requirement: ledger token current
`ledger token current [--json]` SHALL call `token.getCurrent` and print the `token`, `name`, `scope` and `created` lines.

#### Scenario: Revoked token
- **WHEN** it runs with a revoked token
- **THEN** it exits `1` with `code` `unauthorized`

#### Scenario: JSON output
- **WHEN** `ledger token current --json` runs with a `read` token
- **THEN** stdout is one JSON document with `"object": "token"` and `"scope": "read"`
