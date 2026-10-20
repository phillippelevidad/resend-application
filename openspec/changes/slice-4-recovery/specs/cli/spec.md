# cli — spec delta

## ADDED Requirements

### Requirement: ledger gaps
`ledger gaps [--since <duration>] [--json]` SHALL call `gaps.list` with `limit` 100 and the `--since` text as given, and print one aligned row per run: `run_id`, trigger, `dry run` when set, `started_at`, the four counts, and `ok`, `running` or the `error.code` the API sent. An empty list SHALL print `  —`. When `has_more` is set, stderr SHALL hold `ledger: more runs exist; showing the newest 100.`. It SHALL take no paging flag.

#### Scenario: Three runs
- **WHEN** `ledger gaps` runs over a manual dry run, a manual run and a scheduled run, all clean
- **THEN** it exits `0` and prints three rows, newest first, the first holding `dry run` and each ending `ok`

#### Scenario: An errored run
- **WHEN** the newest run finished `reconciler_not_configured`
- **THEN** its row ends `reconciler_not_configured`

#### Scenario: JSON output
- **WHEN** `ledger gaps --json` runs
- **THEN** stdout holds exactly the operation's `data` as one document

#### Scenario: Bad duration
- **WHEN** `ledger gaps --since 2x` runs
- **THEN** it exits `1` with `code` `validation_failed` from the API, naming `since`

### Requirement: ledger reconcile starts a run and waits for it
`ledger reconcile [--dry-run] [--lookback <duration>] [--no-wait] [--json]` SHALL call `reconcile.start` once, write `ledger: reconcile run <run_id> started; follow it with ledger gaps.` to stderr, and, without `--no-wait`, poll `reconcile.getRun` every 3 s until the run has `finished_at` or `error`. A run with `error` SHALL exit `1` with that error in the error shape.

#### Scenario: A finished run
- **WHEN** `ledger reconcile` runs and the run finishes clean with `missing` 2 and `replayed` 2
- **THEN** it exits `0` and prints `run <id>   manual`, its `started`, `finished` and `horizon` lines, and `checked 2   missing 2   replayed 2   failed 0`

#### Scenario: A run that ends on an error
- **WHEN** `ledger reconcile --dry-run --json` runs and the run finishes `reconciler_not_configured`
- **THEN** it exits `1`, stdout holds the error object with that `code`, and the run-id notice is on stderr only

#### Scenario: Abandoned while waiting
- **WHEN** the polled run comes back with `error.code` `run_abandoned` and no `finished_at`
- **THEN** it exits `1` with `run_abandoned`

#### Scenario: Without waiting
- **WHEN** `ledger reconcile --no-wait --json` runs
- **THEN** it exits `0` at once, stdout holding the answered run with `finished_at: null`

#### Scenario: Read token
- **WHEN** it runs with a `read` token
- **THEN** it exits `1` with `code` `forbidden`, and no run starts

### Requirement: The reconcile wait has a backstop
`ledger reconcile` SHALL stop waiting after 20 minutes, above the run budget the API derives `run_abandoned` from, and SHALL then exit `1` with the `internal_error` object under `--json`, or one constant defect line otherwise. The CLI SHALL NOT compute the run's budget itself.

#### Scenario: Backstop reached
- **WHEN** the polled run never shows `finished_at` or `error` for 20 minutes
- **THEN** it exits `1`, and under `--json` stdout holds the `internal_error` object

## MODIFIED Requirements

### Requirement: ledger health
`ledger health [--json]` SHALL call `health.get` and print `queue`, `dlq`, `worker`, `database` and `reconcile` lines with aligned columns: counts, `oldest <n>s` or `oldest —`, the event-source state, `reachable, <used> of <limit>` or `unreachable`, and the last run as `run <id> finished <finished_at>, missing <n>, replayed <n>`, `run <id> running`, `run <id> <error.code>`, `no run yet`, or `—` with the database unreachable. Under `--json` it SHALL print exactly the operation's `data`.

#### Scenario: Healthy human layout
- **WHEN** `ledger health` runs against an empty, healthy pipeline with no reconcile run
- **THEN** it exits `0` and prints `queue       0 visible, 0 in flight, oldest —`, `dlq         0 visible, 0 in flight`, `worker      enabled`, a `database    reachable, …` line and `reconcile   no run yet`

#### Scenario: Last run finished
- **WHEN** the newest run finished clean with `missing` 2 and `replayed` 2
- **THEN** it prints `reconcile   run <id> finished <finished_at>, missing 2, replayed 2`

#### Scenario: Last run errored
- **WHEN** the newest run finished `reconciler_not_configured`
- **THEN** it prints `reconcile   run <id> reconciler_not_configured`

#### Scenario: During an outage
- **WHEN** `ledger health` runs while the database is unreachable
- **THEN** it exits `0` and prints `database    unreachable` and `reconcile   —`

#### Scenario: Tripped stack
- **WHEN** the kill switch has stopped the read API
- **THEN** `ledger health` exits `1` with `code` `api_unavailable`
