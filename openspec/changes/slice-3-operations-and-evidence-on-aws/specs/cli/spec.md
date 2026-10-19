# Spec Delta

## ADDED Requirements

### Requirement: ledger dlq inspect
`ledger dlq inspect [--limit <1-10>] [--json]` SHALL call `dlq.listMessages` and print a `dlq` line (`<depth> message(s), showing <n>`, `showing <n> of <depth>` when `has_more`, or `empty`), then one line per item with its `svix_id`, type, `email_id`, created and enqueued times and receive count. A depth above 0 SHALL add one stderr notice pointing at the worker logs and the `LedgerApp-dlq-depth` runbook entry.

#### Scenario: One dead message
- **WHEN** `ledger dlq inspect` runs against a DLQ of depth 1
- **THEN** it exits `0`, stdout starts `dlq         1 message(s), showing 1` and holds that item's `svix_id`, and stderr holds `why each failed is in the worker logs under its svix_id (runbook: LedgerApp-dlq-depth)`

#### Scenario: Empty DLQ
- **WHEN** `ledger dlq inspect` runs against an empty DLQ
- **THEN** it exits `0` and prints `dlq         empty`, with nothing on stderr

#### Scenario: Unreadable item
- **WHEN** an item's fields are `null`
- **THEN** each prints as `—` and the line still shows its receive count

#### Scenario: JSON output
- **WHEN** `ledger dlq inspect --json` runs
- **THEN** stdout holds exactly the operation's `data` as one document, and stderr holds no notice

#### Scenario: Non-integer limit
- **WHEN** `ledger dlq inspect --limit abc` runs
- **THEN** it exits `2` and makes no request

#### Scenario: Out-of-range limit
- **WHEN** `ledger dlq inspect --limit 11` runs
- **THEN** it exits `1` with `code` `validation_failed` from the API

### Requirement: ledger dlq redrive
`ledger dlq redrive [--json]` SHALL call `dlq.startRedrive` once and return at once, printing `redrive     started: <depth> message(s) moving back to the queue; watch the dlq depth with ledger health` or `redrive     nothing to move: the dlq is empty`. It SHALL take no wait option.

#### Scenario: Redrive started
- **WHEN** `ledger dlq redrive` runs against a DLQ of depth 1
- **THEN** it exits `0` and prints `redrive     started: 1 message(s) moving back to the queue; watch the dlq depth with ledger health`

#### Scenario: Second redrive while one runs
- **WHEN** `ledger dlq redrive --json` runs while a redrive task runs
- **THEN** it exits `1` and stdout holds an error object with `code` `redrive_in_progress`

#### Scenario: Read token
- **WHEN** it runs with a `read` token
- **THEN** it exits `1`, stderr holds `The token is valid but lacks the scope this operation needs.` and a `hint:` line, and stdout is empty
