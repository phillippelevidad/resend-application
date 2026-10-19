# Spec Delta

## ADDED Requirements

### Requirement: AWS runs guard their target
`--burst`, `--chaos db-outage` and `--poison` SHALL make a run an AWS run. An AWS run without `LEDGER_URL` SHALL exit `2`. Before sending anything it SHALL exit `1` with `sim: <reason>` when `LEDGER_URL` (trailing slash ignored) is not the deployed app stack's API URL, the kill switch is tripped or not armed, the DLQ depth is not 0, or the deployed app stack holds no simulator secret.

#### Scenario: Offline AWS knob
- **WHEN** `LEDGER_URL= pnpm sim --burst 10000/10s` runs
- **THEN** it prints `sim: --burst needs a live run against the deployed stack: load .env.deployed.local` and exits `2`, with no network call

#### Scenario: Wrong target
- **WHEN** an AWS run starts with `LEDGER_URL` pointing at the local process
- **THEN** it prints `sim: LEDGER_URL is not the deployed LedgerApp API; load .env.deployed.local`, exits `1`, and sends nothing

#### Scenario: Tripped stack
- **WHEN** an AWS run starts while the kill switch is tripped
- **THEN** it prints `sim: the stack is tripped; run pnpm aws:rearm first`, exits `1`, and sends nothing

#### Scenario: Unarmed stack
- **WHEN** an AWS run starts while `KillSwitchArmed` is not `true`
- **THEN** it prints `sim: the kill switch is not armed; AWS runs need the owner's armed deployment`, exits `1`, and sends nothing

#### Scenario: DLQ not empty
- **WHEN** an AWS run starts while the DLQ holds 2 messages
- **THEN** it prints `sim: the DLQ holds 2 messages; inspect and redrive them first`, exits `1`, and sends nothing

#### Scenario: Stack deployed without the simulator secret
- **WHEN** an AWS run starts against a stack deployed with `LEDGER_SIMULATOR` off
- **THEN** it prints `sim: the deployed stack has no simulator secret; set LEDGER_SIMULATOR=on and run pnpm aws:deploy`, exits `1`, and neither raises the throttle nor sends anything

### Requirement: Burst history
`--burst <events>/<seconds>s` SHALL generate exactly `events` events (1–10,000) as broadcast-shaped emails with one distinct recipient each, cycling over Resend's test addresses as `+label` forms carrying the run's namespace (RS-32, RS-39), each email replaying its address's observed sequence. The history SHALL be deterministic per seed and namespace.

#### Scenario: Exact count, distinct recipients
- **WHEN** a burst history of 10,000 events is generated for one seed and namespace
- **THEN** it holds exactly 10,000 events, no two emails share a recipient address, and generating it again yields the same history

### Requirement: Burst preflights
Before raising anything, a burst SHALL refuse with exit `1` when the account's Lambda concurrency quota is below 1,000 (AWS-U05), or when the usage-trip metric's sum over its last period plus the burst's events would exceed the usage trip's threshold, reading both from the deployed alarm rather than from a constant.

#### Scenario: Quota too low
- **WHEN** a burst starts on an account whose concurrency quota is 50
- **THEN** it prints `sim: the account's Lambda concurrency quota is 50; the burst needs at least 1000 (AWS-U05): request an increase in Service Quotas`, exits `1`, and sends nothing

#### Scenario: Would trip the stack
- **WHEN** the last 15 minutes hold 6,000 requests and the threshold is 15,000, and a 10,000-event burst starts
- **THEN** it prints `sim: 6000 requests in the last 15 minutes plus the burst would trip LedgerApp-usage-trip; wait and retry`, exits `1`, and sends nothing

### Requirement: The burst throttle restores only its own value
A burst SHALL raise the ingest stage's default-route throttle to rate 1,200 and burst 2,400 before sending, and in `finally` SHALL restore the declared throttle only when the stage still reads the raised value. When it reads anything else, it SHALL send no update and print `throttle left at <rate>/<burst>: changed during the burst (a trip?)`.

#### Scenario: Unchanged during the burst
- **WHEN** a burst ends and the stage still reads rate 1,200 and burst 2,400
- **THEN** the declared throttle is restored and it prints `throttle restored rate=100 burst=200`

#### Scenario: Trip during the burst
- **WHEN** the stage's throttle changes to `0`/`0` while the burst runs
- **THEN** `finally` sends no throttle update and prints `throttle left at 0/0: changed during the burst (a trip?)`

### Requirement: The burst is paced and measured
A burst SHALL send request `i` at `i × seconds/events` after its start, with at most 512 in flight, each signed at send time, with no retry, and SHALL print `sent requests=<k> accepted=<a> duration_s=<d> p50_ms=<x> p99_ms=<y>` from client-observed latencies. It SHALL print the database size before and after with `bytes_per_event` and `bursts_left`, and no projection JSON.

#### Scenario: Burst output
- **WHEN** `pnpm sim --burst 10000/10s` settles against the deployed stack
- **THEN** it prints `projection not printed (--burst)`, the `sent … p99_ms=<y>` line, `settled stored=10000/10000 after <s>s`, the `storage before=<b> after=<a> bytes_per_event=<c> bursts_left=<k>` line, then invariants 1, 2 and 4

#### Scenario: A rejected request
- **WHEN** any burst request answers other than `200` or times out
- **THEN** it is not counted as accepted, and the run exits `1` after reporting

### Requirement: Database-outage knob
`--chaos db-outage` SHALL repoint the deployed database secret's pooled host to `ledger-sim-db-outage.invalid`, recycle the worker and the read API, send the history, wait for the event source to read `paused` (bounded 10 min), then hold until `LedgerApp-queue-age` reads `ALARM` (bounded 45 min) with the DLQ at 0, then restore the secret and recycle both again, also on failure.

#### Scenario: Outage keeps ingest answering
- **WHEN** `pnpm sim --chaos db-outage` runs against the deployed stack
- **THEN** it prints `sent requests=<k> accepted=<k> first_attempt_200=<k>`, `worker paused after <s>s` and `queue-age alarm ALARM after <m>m; dlq depth 0`

#### Scenario: Restore on failure
- **WHEN** a db-outage run fails after repointing the secret
- **THEN** the original secret value is written back and both functions recycled; if that restore fails, it prints `sim: the database secret was not restored; run pnpm aws:deploy, which rewrites it` and exits `1`

#### Scenario: One restore step fails
- **WHEN** the restore's recycle of one function fails
- **THEN** the secret is still written back and the other function still recycled, and it prints `sim: the database secret is restored, but recycling the <function> failed; its containers that read the outage host keep it until recycled` and exits `1`

#### Scenario: Already paused
- **WHEN** `--chaos db-outage` starts while the worker's event source is paused
- **THEN** it exits `1` and sends nothing

#### Scenario: No secret printed
- **WHEN** a db-outage run prints any line
- **THEN** no line holds the database secret's value, a URL or a host other than `.invalid`, and nothing is written to disk

### Requirement: Database outage drains after resume
After the restore, a db-outage run SHALL print `resume: pnpm -s ledger worker resume, or wait for the hourly resume`, wait for the event source to read `enabled` (bounded 65 min), settle, and check invariants 1, 2 and 4 with nothing poisoned (ADR-015).

#### Scenario: Drained with no loss
- **WHEN** the event source is resumed after the outage
- **THEN** it prints `worker enabled after <m>m`, every generated event settles, invariants 1, 2 and 4 pass, and the run exits `0`

### Requirement: Poison knob
`--poison <n>` (1–10) SHALL pick `n` seeded events other than the walk probe's, print `poison count=<n> svix_ids=<…> email_ids=<…>`, make only their inserts fail with a non-connection error through `DATABASE_URL`, send the history, settle the others, wait for the DLQ depth to reach `n` (bounded 40 min), then remove the fault, also on failure.

#### Scenario: Poison isolated
- **WHEN** `pnpm sim --poison 1` runs against the deployed stack
- **THEN** it prints `others stored <k>/<k> exactly once (1 poisoned wait in the DLQ)`, `invariant 1 not checked (1 poisoned events wait in the DLQ)`, `invariant 2 not checked (1 poisoned events wait in the DLQ)` and `invariant 4 pass (dlq holds exactly the 1 poisoned)`

#### Scenario: Fix printed
- **WHEN** the poison run ends
- **THEN** the fault is removed and it prints `poison fixed; next: pnpm -s ledger dlq inspect, then pnpm -s ledger dlq redrive; the depth returns to 0 in pnpm -s ledger health`

#### Scenario: Runtime role cannot add the fault
- **WHEN** `DATABASE_URL` is the runtime role's and `--poison 1` runs
- **THEN** it prints `sim: --poison needs DATABASE_URL to own webhook_events (the owner's pooled URL, not the runtime role's)`, exits `1`, and sends nothing

#### Scenario: A leftover fault
- **WHEN** a crashed poison run left its fault behind and another poison run starts
- **THEN** the leftover is removed before the new fault is added

### Requirement: Invariant 4 checked from the DLQ
Invariant 4 SHALL pass only when the DLQ depth equals the poisoned count, every `svix_id` sampled from the DLQ is poisoned, and every poisoned `svix_id` was sampled. Its lines SHALL hold ids and counts only. A run with nothing poisoned passes only on an empty DLQ.

#### Scenario: A stray dead message
- **WHEN** the DLQ holds a `svix_id` the run did not poison
- **THEN** it prints `invariant 4 fail` naming the depth, the counts and the stray `svix_id`, and the run exits `1`

#### Scenario: A poisoned message missing
- **WHEN** a poisoned `svix_id` is not in the DLQ
- **THEN** invariant 4 fails and the run exits `1`

### Requirement: Through the deployed queue
`pnpm sim --duplicates 0.2 --shuffle` SHALL run unchanged against the deployed stack's `LEDGER_URL`, with no AWS-run guard, and pass invariants 1 and 2 through SQS (ADR-002, ADR-003).

#### Scenario: Shuffled with duplicates on AWS
- **WHEN** `pnpm sim --duplicates 0.2 --shuffle` runs with the deployed `LEDGER_URL`, simulator secret and database URL
- **THEN** it prints `invariant 1 pass …`, `invariant 2 pass …` and `invariant 4 not checked (AWS runs check it: --burst, --chaos or --poison)`, and exits `0`

## MODIFIED Requirements

### Requirement: Bad flags are rejected
An invalid flag value SHALL print a one-line message on stderr and exit 2 without printing a projection. `--burst` SHALL take `<events>/<seconds>s` with 1 ≤ events ≤ 10,000 and 1 ≤ seconds ≤ 600, `--chaos` only `db-outage`, and `--poison` an integer from 1 to 10. `--burst`, `--chaos`, `--poison` and `--duplicates` SHALL exclude one another, naming the pair; `--shuffle` combines with any.

#### Scenario: Ratio out of range
- **WHEN** `pnpm sim --duplicates 2` runs
- **THEN** it prints `sim: --duplicates <reason>` on stderr and exits 2

#### Scenario: Burst over the ceiling
- **WHEN** `pnpm sim --burst 20000/10s` runs
- **THEN** it prints `sim: --burst <reason>` on stderr and exits 2

#### Scenario: Two knobs
- **WHEN** `pnpm sim --poison 1 --duplicates 0.2` runs
- **THEN** it prints a line naming `--poison` and `--duplicates` on stderr and exits 2

#### Scenario: Unknown chaos
- **WHEN** `pnpm sim --chaos network` runs
- **THEN** it prints `sim: --chaos <reason>` on stderr and exits 2

### Requirement: Live run sends every event signed
A live run SHALL send every arranged event, duplicates and shuffle included, to the ingest endpoint at `LEDGER_URL`, signed with the simulator secret and the wall-clock `svix-timestamp`, then print `sent requests=<k> accepted=<a>`, where `a` counts the `200` answers. A run without `--burst` SHALL send one request at a time; a burst paces its requests as the burst requirement states.

#### Scenario: Every event accepted
- **WHEN** `pnpm sim --duplicates 0.2 --shuffle` runs live against a running local process
- **THEN** it prints `sent requests=<k> accepted=<k>`

### Requirement: Live run waits for the ledger to settle
After sending, a live run SHALL poll the ledger until every generated `svix_id` it expects to store is stored, within a bound of 30 seconds plus 100 ms per generated event, every 250 ms, or every 2 s once the bound exceeds 60 s. At the bound it SHALL fail with `sim: not settled after <bound>s (<present>/<generated> stored)` and exit `1`, never waiting forever.

#### Scenario: Settled
- **WHEN** every generated event has been stored
- **THEN** the run proceeds to the invariant checks

#### Scenario: Bound scales with the run
- **WHEN** a run generates 10,000 events
- **THEN** its settle bound is 1,030 seconds and it polls every 2 seconds

#### Scenario: Not settled
- **WHEN** a run of 20 events has stored 19 when its 32-second bound passes
- **THEN** it prints `sim: not settled after 32s (19/20 stored)` and exits `1`

### Requirement: Invariants 1 and 2 checked against the local process
A settled live run SHALL check invariant 1 (every generated `svix_id` stored exactly once) and invariant 2 (every `email_state`, `email_recipients` and `recipient_state` row of the run equals the projection of the ground truth), print `invariant 3 not checked (slice 6)`, and print `invariant 4 not checked (AWS runs check it: --burst, --chaos or --poison)` unless it is an AWS run. It SHALL exit `0` only when every checked invariant passes and every request was accepted.

#### Scenario: Shuffled with duplicates against apps/local
- **WHEN** `pnpm sim --duplicates 0.2 --shuffle` runs live against `apps/local`
- **THEN** it prints `invariant 1 pass stored=<n>/<n>` and `invariant 2 pass emails=<m> recipients=<r>`, then the two `not checked` lines, and exits 0

#### Scenario: Rerun is all duplicates
- **WHEN** the same seed and namespace run live a second time
- **THEN** every event is a duplicate, both invariants pass again, and stdout is identical to the first run's

#### Scenario: A checker that can fail
- **WHEN** the invariant 1 checker is given ground truth holding a `svix_id` the ledger rows lack, or the invariant 2 checker a projection row that differs from the ground truth
- **THEN** it reports `invariant 1 fail missing=<k> svix_ids=<up to 5 ids>` or `invariant 2 fail email_ids=<…>`, and the run's exit status is 1

#### Scenario: Poisoned events are not counted as passed
- **WHEN** a poison run settles with its poisoned events still in the DLQ
- **THEN** invariants 1 and 2 print `not checked (<n> poisoned events wait in the DLQ)`, never `pass`
