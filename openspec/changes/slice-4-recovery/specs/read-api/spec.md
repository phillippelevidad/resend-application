# read-api — spec delta

## ADDED Requirements

### Requirement: A reconcile run has one wire shape
Every route that returns a run SHALL return it as `object: "reconcile_run"` with `run_id`, `trigger`, `dry_run`, `started_at`, `finished_at`, `horizon_start`, `horizon_end`, `checked`, `missing`, `replayed`, `failed` and `error`: `null`, the stored outcome's registry error object, or `run_abandoned` when `finished_at` is null past the 14-minute budget. `claimed_at` and `updated_at` SHALL stay internal.

#### Scenario: A finished run
- **WHEN** a run finished with no `error_code` is read
- **THEN** its object carries every listed key, `error: null`, and no `claimed_at` or `updated_at`

#### Scenario: An abandoned run
- **WHEN** a run has no `finished_at` and started 14 minutes and 1 ms before the read
- **THEN** its `error.code` is `run_abandoned` and its `finished_at` is `null`

#### Scenario: A run inside its budget
- **WHEN** a run has no `finished_at` and started 14 minutes before the read, to the millisecond
- **THEN** its `error` is `null`

### Requirement: gaps.list lists recent runs
`gaps.list` (scope `read`) SHALL answer `200` with `object: "list"`, `has_more` and up to `limit` runs (1–100, default 20) whose `started_at` falls within `since` (a duration from `1m` to `30d`, default `24h`), newest first by `run_id`, paged with `after` (a run id). It SHALL make no Resend call.

#### Scenario: Runs in the window
- **WHEN** three runs started in the last hour and one 2 days ago, and `gaps.list` is called with `since` `24h`
- **THEN** it answers the three, newest first, with `has_more: false`

#### Scenario: Next page
- **WHEN** `gaps.list` is called with `limit` 2 over three runs, then with `after` set to the second run's id
- **THEN** the first page has `has_more: true`, and the second holds the third run alone

#### Scenario: An abandoned run in the list
- **WHEN** the window holds a run past its budget with no `finished_at`
- **THEN** its item's `error.code` is `run_abandoned`

### Requirement: gaps.list errors
`gaps.list` SHALL answer `400 validation_failed` with `since must be a duration from 1m to 30d, such as 24h.`, `limit must be an integer from 1 to 100.` or `after must be a run id, a positive integer.` for a bad field, and `401 unauthorized` and `503 database_unavailable` per the token lookup.

#### Scenario: Bad duration
- **WHEN** `gaps.list` is called with `since` `2x` or `31d`
- **THEN** it answers `400` with `code` `validation_failed` and the `since` message

#### Scenario: Database down
- **WHEN** `gaps.list` is called with a tagged token while Postgres is unreachable
- **THEN** it answers `503` with `code` `database_unavailable`

### Requirement: reconcile.getRun returns one run
`reconcile.getRun` (scope `read`) SHALL answer `200` with the run whose id is `run_id`, and SHALL make no Resend call.

#### Scenario: A running run
- **WHEN** `reconcile.getRun` is called for a run started 1 minute ago with no `finished_at`
- **THEN** it answers `200` with `finished_at: null` and `error: null`

### Requirement: reconcile.getRun errors
`reconcile.getRun` SHALL answer `400 validation_failed` with `run_id must be a positive integer.` for a non-integer or non-positive id, `404 run_not_found` for an id no row holds, and `401 unauthorized` and `503 database_unavailable` per the token lookup.

#### Scenario: Unknown run
- **WHEN** `reconcile.getRun` is called for an id no row holds
- **THEN** it answers `404` with `code` `run_not_found` and the registry's message and hint

#### Scenario: Bad id
- **WHEN** `reconcile.getRun` is called with `run_id` `abc` or `0`
- **THEN** it answers `400` with `code` `validation_failed` and the `run_id` message

### Requirement: reconcile.start starts one manual run
`reconcile.start` (scope `operate`) SHALL take a JSON object body with optional `dry_run` (boolean, default `false`) and `lookback` (a duration from `1m` to `30d`, default `72h`), insert one manual run, hand it to the reconciler asynchronously, and answer `202` with the inserted run before the run does any work.

#### Scenario: Start accepted
- **WHEN** an `operate` token calls `reconcile.start` with `{}` and no run is unfinished
- **THEN** it answers `202` with `trigger: "manual"`, `dry_run: false` and `finished_at: null`, and the reconciler is invoked once with that run's id

#### Scenario: A dry run
- **WHEN** it is called with `{ "dry_run": true, "lookback": "6h" }`
- **THEN** the answered run has `dry_run: true`

### Requirement: A failed hand-off finishes the run
When handing the run to the reconciler fails, `reconcile.start` SHALL finish the inserted row `internal_error` and answer `500 internal_error`, so the row neither blocks the next start for its budget nor runs late.

#### Scenario: Invoke rejected
- **WHEN** the asynchronous invoke rejects after the row is inserted
- **THEN** it answers `500 internal_error`, the row reads `error.code` `internal_error` with a `finished_at`, and the next start is accepted

### Requirement: reconcile.start errors
`reconcile.start` SHALL answer `403 forbidden` to a `read` token before any validation or start, `409 reconcile_in_progress` while a run is unfinished inside its budget, `400 validation_failed` for a body that is not a JSON object or a field of the wrong type, and `401 unauthorized` and `503 database_unavailable` per the token lookup.

#### Scenario: Read token
- **WHEN** a `read` token calls `reconcile.start`
- **THEN** it answers `403` with `code` `forbidden`, and no row is inserted

#### Scenario: A run already unfinished
- **WHEN** `reconcile.start` is called while another run is unfinished inside its budget
- **THEN** it answers `409` with `code` `reconcile_in_progress`, and no row is inserted

#### Scenario: Bad lookback
- **WHEN** it is called with `lookback` `31d`
- **THEN** it answers `400` with `code` `validation_failed` and `lookback must be a duration from 1m to 30d, such as 72h.`

#### Scenario: Body not an object
- **WHEN** it is called with the body `[]` or `"x"`
- **THEN** it answers `400` with `code` `validation_failed` and `The request body must be a JSON object with optional dry_run and lookback fields.`

## MODIFIED Requirements

### Requirement: OpenAPI document
The read API SHALL publish an OpenAPI 3.1 document, titled `Ledger read API`, version `0.0.0`, describing its thirteen operations by their operation ids (`email.get`, `recipient.get`, `health.get`, `worker.resumeEventSource`, `token.create`, `token.list`, `token.revoke`, `token.getCurrent`, `dlq.listMessages`, `dlq.startRedrive`, `gaps.list`, `reconcile.getRun`, `reconcile.start`) with their request schemas and responses in the error shape, a `bearerAuth` security scheme, and a `401` response on every operation.

#### Scenario: Exported document
- **WHEN** the OpenAPI document is generated
- **THEN** it holds the thirteen operations, each requiring `bearerAuth` and listing a `401` response, `token.create` documents `201`, `dlq.startRedrive` documents `202` and `200`, and `reconcile.start` documents `202`

### Requirement: Health answers during a database outage
During a database outage, `health.get` with a correctly tagged token SHALL answer `200` reporting the database unreachable and `last_reconcile_run` `null`, and every other operation SHALL answer `503 database_unavailable`. A `health.get` request SHALL make at most one database attempt, which reads the storage used and the last run together.

#### Scenario: Postgres stopped
- **WHEN** Postgres is stopped and `health.get` is called with a tagged token
- **THEN** it answers `200` with `database.reachable: false`, `storage_bytes: null` and `last_reconcile_run: null`

#### Scenario: Bad tag during the outage
- **WHEN** Postgres is stopped and `health.get` is called with a bad-tag token
- **THEN** it answers `401 unauthorized`

#### Scenario: Other routes during the outage
- **WHEN** Postgres is stopped and `email.get` is called with a tagged token
- **THEN** it answers `503` with `code` `database_unavailable`

### Requirement: health.get reports the pipeline
`health.get` (`read`) SHALL answer `200` with `object: "health"`, the source queue's visible and in-flight counts and oldest-message age in seconds (`null` when no datapoint exists, AWS-22), the DLQ's visible and in-flight counts, the worker's event-source state (`enabled`, `paused` or `changing`), the database's reachability, storage used and storage limit in bytes, and `last_reconcile_run`: the newest run in the reconcile run shape, or `null` when no run exists.

#### Scenario: Healthy pipeline
- **WHEN** `health.get` is called with the database up
- **THEN** it answers `200` with every field present and `database.reachable: true`

#### Scenario: No run yet
- **WHEN** `health.get` is called with the database up and no reconcile run recorded
- **THEN** `last_reconcile_run` is `null`

#### Scenario: The newest run
- **WHEN** two runs exist and `health.get` is called
- **THEN** `last_reconcile_run` is the one with the higher `run_id`, `run_abandoned` derived as on `reconcile.getRun`

#### Scenario: AWS read fails
- **WHEN** reading the queue or the event source fails
- **THEN** it answers `500 internal_error` and logs the error's name
