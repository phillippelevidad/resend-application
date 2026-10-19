# Spec Delta

## ADDED Requirements

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
