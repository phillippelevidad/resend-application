# reconciler — spec delta

## Purpose

Finds every event Resend produced for the configured webhook that never reached the ledger, by
diffing List Events ids against stored `svix_id`s, and replays each one through ingest, hourly and
on demand, so an outage longer than Resend's retry schedule loses nothing and duplicates nothing.

## ADDED Requirements

### Requirement: Runs never overlap
A run SHALL start in one transaction that takes the reconcile start lock, refuses with `reconcile_in_progress` when an unfinished run is still inside its 14-minute time budget, and inserts the run's row with its trigger (`scheduled` or `manual`). Both triggers SHALL start a run the same way, and every run SHALL write exactly one `reconcile_runs` row.

#### Scenario: Two concurrent starts
- **WHEN** two starts race against real Postgres with no unfinished run
- **THEN** exactly one row is inserted, and the other start is refused with `reconcile_in_progress`

#### Scenario: An unfinished run past its budget
- **WHEN** a start runs while the only unfinished row started more than 14 minutes ago
- **THEN** the start is accepted and inserts a new row

#### Scenario: A duplicate scheduled tick
- **WHEN** a second scheduled start arrives while the first scheduled run is unfinished
- **THEN** it is refused, logs `reconcile.start_refused`, and makes no Resend call

### Requirement: A run is claimed before any Resend call
A manual run SHALL be claimed (`claimed_at` set) only while it is unclaimed and unfinished, before its first Resend call, and an invoke whose claim changes no row SHALL exit with no Resend call. A scheduled run SHALL be inserted already claimed by the invoke that runs it.

#### Scenario: Second invoke of a claimed run
- **WHEN** the reconciler is invoked twice for the same manual run
- **THEN** the second invoke logs `reconcile.duplicate_invoke` and the fake Resend API records no request from it

#### Scenario: Invoke of a finished run
- **WHEN** the reconciler is invoked for a run that already has `finished_at`
- **THEN** the claim changes no row and no Resend request is made

### Requirement: The webhook's status is read first
Every configured run SHALL retrieve the configured webhook before any List Events or replay call, and SHALL finish with `webhook_disabled` and no further Resend call when its `status` is `disabled` (RS-11, RS-13).

#### Scenario: Disabled webhook
- **WHEN** a run starts and Retrieve Webhook answers `status: disabled`
- **THEN** the run finishes with `error_code` `webhook_disabled`, and the fake Resend API records no List Events and no replay request

#### Scenario: Unknown webhook id
- **WHEN** Retrieve Webhook answers `404` for the configured id
- **THEN** the run finishes with `reconciler_not_configured`

### Requirement: A run without Resend configuration makes no call
A run with no Resend API key or no webhook id SHALL finish with `reconciler_not_configured` and make no Resend request.

#### Scenario: Not configured
- **WHEN** a run starts with no key or no webhook id configured
- **THEN** it finishes with `error_code` `reconciler_not_configured`, and zero requests reach the fake Resend API

### Requirement: Events inside the grace window are not missing
A run SHALL NOT count or replay an event whose `created_at` is later than its `horizon_end`, which is the run's start time minus the longer of 10 minutes and the source queue's oldest-message age, fixed when the run starts (ADR-007, AWS-22).

#### Scenario: Queued backlog
- **WHEN** the source queue's oldest message is 30 minutes old and List Events holds an unstored event created 20 minutes ago
- **THEN** the run neither counts that event missing nor replays it

#### Scenario: A fresh event
- **WHEN** the queue is empty and an unstored event was created 5 minutes before the run started
- **THEN** it is not counted missing and not replayed

### Requirement: The lookback reaches back to the last clean run
A run SHALL check events back to `horizon_start`: its lookback (72 h by default) extended to the `horizon_end` of the newest finished run with no `error_code` and `missing` 0 when that is older, and never past 30 days (RS-31). An explicit lookback SHALL be extended the same way. Both horizons SHALL be stored when the run starts.

#### Scenario: A 5-day gap since the last good run
- **WHEN** the newest clean run finished 5 days ago and List Events holds unstored events 3 to 5 days old
- **THEN** a run with no lookback given replays every one of them

#### Scenario: A recovery run does not anchor
- **WHEN** the newest finished run had `missing` 2 and no `error_code`, and an older clean run exists
- **THEN** the next run's `horizon_start` comes from the older clean run

#### Scenario: Thirty-day cap
- **WHEN** the newest clean run is 40 days old
- **THEN** the run's `horizon_start` is 30 days before its start

### Requirement: Replays re-enter through ingest only
A run SHALL recover a missing event only by asking Resend to replay it (RS-16), so the delivery is verified and deduplicated on `svix_id` like any other (ADR-004). No path SHALL write a payload fetched from Resend into `webhook_events`.

#### Scenario: Replay of an already stored event
- **WHEN** a replayed delivery carries a `svix_id` the ledger already holds
- **THEN** `webhook_events` still holds one row for it and the projections are unchanged

#### Scenario: A recovered event older than what is stored
- **WHEN** an email's `email.delivered` is stored, its `email.sent` was missed, and the run replays `email.sent`
- **THEN** the email's projection equals the one its full event set yields (status `delivered`), as if both had arrived in order

### Requirement: An outage past the retry schedule is fully recovered
After an outage longer than Resend's ≈ 27.6 h retry schedule (RS-09), a run that finishes with no `error_code` SHALL leave every event List Events holds for its window stored exactly once. A gap too large for one run's budget SHALL end that run `rate_limited` and be finished by the following runs.

#### Scenario: Outage past the retry schedule
- **WHEN** List Events holds N events in the window, N − k of them are stored, and each replay is delivered through real ingest and the worker
- **THEN** after one run every id is stored exactly once, the run records `missing` k and `replayed` k, and a second run records `missing` 0

#### Scenario: A re-delivered event after recovery
- **WHEN** a recovered event is delivered once more
- **THEN** `webhook_events` still holds exactly one row for its `svix_id`

### Requirement: One failed replay never aborts a run
A replay that fails with any outcome but `resend_auth_failed` or `rate_limited` SHALL count in `failed`, log `reconcile.replay_failed` with the run's id, the `svix_id` and the code, and the run SHALL go on to the next missing event.

#### Scenario: One replay refused
- **WHEN** Resend answers `422` to the replay of one missing event among three
- **THEN** the run finishes with `failed` 1, `replayed` 2 and no `error_code`

### Requirement: A run finishes with a registered outcome
A run SHALL finish with no `error_code` or one of `webhook_disabled`, `rate_limited`, `resend_auth_failed`, `resend_unavailable`, `reconciler_not_configured` and `internal_error`. Reaching its deadline before its horizon SHALL finish it `rate_limited`. `run_abandoned` SHALL be derived on read and never stored.

#### Scenario: Deadline before the horizon
- **WHEN** a run's paging is unfinished when its deadline arrives
- **THEN** it finishes `rate_limited`, and no later run takes its `horizon_end` as an anchor

#### Scenario: A 429 storm
- **WHEN** Resend answers five `429`s with `retry-after: 1`, then `200`s (RS-19, RS-22)
- **THEN** the run waits each one out and finishes with no `error_code`

#### Scenario: The database refuses a derived outcome
- **WHEN** a row is written with `error_code` `run_abandoned`
- **THEN** Postgres rejects it with `23514`

#### Scenario: An unexpected failure after the claim
- **WHEN** the run throws an unexpected error after it is claimed
- **THEN** it is finished `internal_error` when the database allows, and otherwise reads `run_abandoned` once its budget passes

### Requirement: A dry run replays nothing
A dry run SHALL make every read a real run makes, record the same `checked` and `missing` counts, and make no replay request.

#### Scenario: Dry run against a gap
- **WHEN** a dry run and a real run check the same window holding two unstored events
- **THEN** both record `missing` 2, and the fake Resend API records zero replay requests from the dry run

### Requirement: Runs start hourly and on demand
A run SHALL start on the hourly schedule and on each manual start. Neither invoke SHALL be retried, and an invoke not delivered within 60 seconds SHALL be dropped, so a span when the reconciler could not run is covered by the next run's horizon rather than by queued invokes (AWS-10, AWS-53).

#### Scenario: Ticks during a trip
- **WHEN** the kill switch holds the reconciler at concurrency 0 for three hours and is then re-armed
- **THEN** no queued tick runs after the re-arm, and the next scheduled run's horizon reaches back to the last clean run

### Requirement: A clean run reports its counts
A run that finishes with no `error_code` SHALL emit `reconcile.missing`, `reconcile.replayed` and `reconcile.failed`, each valued at its count with no dimension, dry runs included. A run that finishes with an `error_code` SHALL emit none of them.

#### Scenario: Errored run is silent
- **WHEN** a run finishes `webhook_disabled`
- **THEN** no `reconcile.*` metric line is written

#### Scenario: Clean run with a gap
- **WHEN** a run finishes clean with `missing` 2
- **THEN** one `reconcile.missing` line with value 2 is written

### Requirement: The gap alarm fires on missing events or no clean run
`LedgerApp-reconcile-gap` SHALL fire when a run in the most recently completed UTC hour found missing events, and when no run finished cleanly in that hour, emailing the owner through the alert topic with its runbook link.

#### Scenario: A gap found
- **WHEN** a clean run in an hour records `missing` 2
- **THEN** the alarm enters `ALARM` at the evaluation after that hour

#### Scenario: A silent reconciler
- **WHEN** no run finishes cleanly in an hour, because runs errored or the stack was tripped
- **THEN** that hour has no datapoint, which the alarm reads as breaching
