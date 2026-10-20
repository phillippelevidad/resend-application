# Ledger runbook

Ledger is an independent portfolio project. Not affiliated with Resend.

One entry per CloudWatch alarm the stacks deploy, and one per error code whose `docs` link points
here ([error codes](../.ai/api-contract.md#error-codes)). Each entry gives what it **Means**, the
**First** command to run, the decision steps **Then**, and the **Related** decision or fact. Every
alarm emails the owner once, on `ALARM`, and returns to OK on its own. Commands run from a checkout
with `.env.local` holding `LEDGER_URL` and an active `LEDGER_TOKEN`
([Commands](../AGENTS.md#commands)). Function logs are in CloudWatch under
`/ledger/<function name>` (`/ledger/LedgerApp-ingest`, `/ledger/LedgerApp-worker`,
`/ledger/LedgerApp-api`, `/ledger/LedgerGuardrails-kill-switch`), one JSON object per line, never
an address or a subject.

## Alarms

### LedgerApp-queue-age

- **Means:** the oldest message on the source queue is older than 15 minutes (`Maximum` over
  5 minutes). Events are safe in the queue (13 days of retention); they are not being applied.
  Usually the worker paused its own event source on a database outage. A drain after a long burst
  also fires it once: the 10,000-event burst can take longer than 15 minutes to drain, and the
  burst run's `settled … after <s>s` line measures it, so this email after a burst is expected.
  A message that keeps failing fires it too: it ages the queue while it waits out its five receives
  (≈ 30 minutes) before SQS moves it to the DLQ, and `LedgerApp-dlq-depth` follows (AWS-22).
- **First:** `pnpm -s ledger health`.
- **Then:**
  - `worker paused` and `database unreachable`: restore the database first (its host's status,
    storage). The worker resumes at the next hourly tick, or now with
    `pnpm -s ledger worker resume`, which probes the database before it re-enables anything.
  - `worker paused` and `database reachable`: `pnpm -s ledger worker resume`.
  - `worker enabled` and the queue's `oldest` falling: a drain. Wait; the alarm clears itself.
  - `worker enabled` and the queue not falling: read `/ledger/LedgerApp-worker` for
    `worker.message_failed` and `worker.database_unavailable`. The same `svix_id` failing again and
    again is a poison message: it reaches the DLQ after its fifth receive, then follow
    [LedgerApp-dlq-depth](#ledgerapp-dlq-depth). `worker.database_unavailable`: follow
    [database_unavailable](#database_unavailable).
- **Related:** [ADR-015](../.ai/architecture.md#adr-015--the-worker-pauses-its-own-event-source-on-a-database-outage),
  [ADR-008](../.ai/architecture.md#adr-008--backpressure-bounded-concurrency-partial-batch-failure-dlq),
  AWS-07 and AWS-22 ([aws.md → SQS](../.ai/aws.md#sqs)).

### LedgerApp-dlq-depth

- **Means:** the dead-letter queue holds at least one message: an event failed five receives in a
  row and moved aside (`maxReceiveCount` 5) while every other event kept flowing. A database outage
  never lands here, because the worker pauses instead. A dead message is a bug or a payload the
  worker cannot record; it stays 14 days.
- **First:** `pnpm -s ledger dlq inspect`. It lists up to 10 dead messages by `svix_id`, type,
  `email_id` and receive count, and the DLQ depth. It never removes or hides a message, and shows
  no address or subject.
- **Then:**
  1. For each `svix_id`, read why it failed in the worker logs:
     `aws logs filter-log-events --log-group-name /ledger/LedgerApp-worker --filter-pattern '"<svix_id>"'`.
  2. Fix the cause and deploy the fix (`pnpm aws:deploy`). Redriving before the fix only sends the
     message back to the DLQ after five more receives.
  3. `pnpm -s ledger dlq redrive` (an `operate` token). It moves every dead message back to the
     source queue and returns at once. A second redrive while one runs answers
     [redrive_in_progress](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-configure-dead-letter-queue-redrive.html).
     A redriven event is applied once: the ledger dedupes on `svix_id`, never on the SQS message id.
  4. `pnpm -s ledger health` until the `dlq` line reads `0 visible`, then
     `pnpm -s ledger email <email_id>` to see the event in its timeline.
- **Related:** [ADR-008](../.ai/architecture.md#adr-008--backpressure-bounded-concurrency-partial-batch-failure-dlq),
  [ADR-004](../.ai/architecture.md#adr-004--immutable-ledger-keyed-on-svix_id-one-transaction-per-message),
  AWS-09, AWS-21, AWS-22 and AWS-60 ([aws.md → SQS](../.ai/aws.md#sqs)), journey
  [J4](../.ai/features.md#j4--poison-message--redrive).

### LedgerApp-api-5xx

- **Means:** the HTTP API answered at least one `5xx` in 5 minutes. On the webhook route this is a
  failed delivery: Resend retries it, and an endpoint that keeps failing is disabled automatically.
  A throttled ingest function surfaces this way too. During a database outage the read API answers
  `503` [database_unavailable](#database_unavailable) on every route that reads Postgres, which
  fires this alarm as well while ingest keeps answering `200`.
- **First:** `pnpm -s ledger health`.
- **Then:**
  - `database unreachable`: the `5xx` are the read API's `503`s. Follow
    [LedgerApp-queue-age](#ledgerapp-queue-age); nothing is lost.
  - Otherwise read `/ledger/LedgerApp-ingest` for `ingest.enqueue_failed` (the queue refused the
    send) and `ingest.secrets_unavailable` (the signing secrets could not be read), and
    `/ledger/LedgerApp-api` for `api.internal_error` by its `request_id`.
  - Check in the Resend dashboard that the webhook is still enabled. If Resend disabled it,
    re-enable it there. Slice 4 lands `ledger reconcile`, which recovers what Resend gave up on.
- **Related:** RS-10 and RS-11 ([resend.md → Facts](../.ai/resend.md#facts)),
  [ADR-001](../.ai/architecture.md#adr-001--verify-then-enqueue), AWS-30
  ([aws.md → CloudWatch and SNS](../.ai/aws.md#cloudwatch-and-sns)).

### LedgerApp-usage-trip

- **Means:** the HTTP API served more than 15,000 requests in 15 minutes and published to the trip
  topic. With the kill switch armed, the app stack is now stopped: the worker's event source is
  disabled, every app function's concurrency is `0` and the route throttle is `0`. Webhooks fail
  and Resend retries them; queued events wait in SQS. One burst of 10,000 events stays under the
  threshold by design, so this is a flood or a loop. The kill switch emails what it changed.
- **First:** `pnpm -s ledger health`. While tripped it fails with
  [api_unavailable](#api_unavailable), which confirms the trip.
- **Then:**
  1. Find the source of the traffic before re-arming (the HTTP API's `Count` metric, the ingest
     logs).
  2. `pnpm aws:rearm`. It restores what the app stack declares and warns when the month's spend is
     at the budget, because the budget cannot trip again the same month.
  3. `pnpm -s ledger health`: `worker enabled` and the queue draining.
  4. Slice 4 lands `ledger reconcile`, which recovers the events Resend marked failed meanwhile.
- **Related:** [aws.md → Budget alarms](../.ai/aws.md#budget-alarms) items 4, 6 and 7,
  [ADR-010](../.ai/architecture.md#adr-010--serverless-on-aws-cdk-an-app-stack-and-a-guardrails-stack).

### LedgerGuardrails-kill-switch-errors

- **Means:** the kill-switch function failed at least once in a minute. A budget or usage trip may
  not have stopped the app stack, and the budget does not alert again that month. During
  `pnpm aws:trip-drill` one failure is forced on purpose, so this email then is expected.
- **First:** `pnpm -s ledger health`. `api_unavailable` means the stop took effect; an answer means
  the app stack is still serving.
- **Then:**
  - Read `/ledger/LedgerGuardrails-kill-switch` for the failing step. Every trip step checks the
    current state first, so a retried trip is safe.
  - If the stack is still serving and spend is at the cap, stop it for good with
    `pnpm aws:teardown` (it refuses while either queue holds a message; `--discard-queued`
    discards them). The ledger in Postgres is untouched.
  - If the trip was a drill, `pnpm aws:rearm` restores the stack.
- **Related:** [aws.md → Budget alarms](../.ai/aws.md#budget-alarms) item 4, AWS-34 and AWS-53,
  [ADR-010](../.ai/architecture.md#adr-010--serverless-on-aws-cdk-an-app-stack-and-a-guardrails-stack).

## Error codes

### unauthorized

- **Means:** `401`. The bearer token is missing, malformed, carries a bad tag, is unknown or was
  revoked.
- **First:** `pnpm -s ledger token current`: the same error confirms the token is the problem.
- **Then:** set `LEDGER_TOKEN` in `.env.local` to an active token. Locally, `pnpm db:setup` mints
  one when the current one is not active. On AWS, `pnpm aws:deploy --issue-operate-token <name>`
  prints a new `operate` token once; an `operate` token makes more with
  `pnpm -s ledger token create`.
- **Related:** [api-contract.md → Conventions](../.ai/api-contract.md#conventions) (auth).

### forbidden

- **Means:** `403`. The token is valid but has the `read` scope, and the operation needs `operate`
  (`ledger dlq redrive`, `ledger worker resume`, `ledger token …`).
- **First:** `pnpm -s ledger token current`, which shows the token's scope.
- **Then:** use an `operate` token, or ask its owner to create one with
  `pnpm -s ledger token create --name <name> --scope operate`.
- **Related:** [api-contract.md → Conventions](../.ai/api-contract.md#conventions) (scopes).

### validation_failed

- **Means:** `400`. An input is malformed: an id, an address, a duration, a cursor or a `limit`.
  The message names the field.
- **First:** rerun the command with `--help` to see the accepted form.
- **Then:** fix the field the message names. `ledger dlq inspect --limit` takes 1 to 10.
- **Related:** [ADR-011](../.ai/architecture.md#adr-011--one-contract-many-surfaces).

### email_not_found

- **Means:** `404`. No event has been recorded for this email id.
- **First:** `pnpm -s ledger health`: events may still be queued (`queue` visible) or the worker
  may be paused.
- **Then:** check the id is a Resend email id. If the queue is draining, wait and retry. If the
  queue is empty and the worker enabled, the events were missed: slice 4 lands `ledger gaps` and
  `ledger reconcile` to find and replay them.
- **Related:** [ADR-007](../.ai/architecture.md#adr-007--recovery-by-id-diff-and-replay-through-ingest).

### recipient_not_found

- **Means:** `404`. No recorded event has ever named this address.
- **First:** `pnpm -s ledger health`, as for [email_not_found](#email_not_found).
- **Then:** check the address (it is matched after normalization). If it was emailed recently, the
  events may be queued or missed; slice 4 lands `ledger gaps`.
- **Related:** [ADR-003](../.ai/architecture.md#adr-003--projection-is-a-pure-function-of-the-event-set).

### run_not_found

- **Means:** `404`. No reconcile run has this id. Slice 4 lands this operation.
- **First:** slice 4's `ledger gaps` lists the runs.
- **Then:** use a run id from that list.
- **Related:** [ADR-007](../.ai/architecture.md#adr-007--recovery-by-id-diff-and-replay-through-ingest).

### token_not_found

- **Means:** `404`. No token has this id.
- **First:** `pnpm -s ledger token list`.
- **Then:** revoke by an id from that list (`pnpm -s ledger token revoke <token_id>`).
- **Related:** [api-contract.md → Operate operations](../.ai/api-contract.md#operate-operations).

### route_not_found

- **Means:** `404`. The API has no operation at this method and path: `LEDGER_URL` points at the
  wrong place, or the CLI or SDK is newer or older than the deployed API.
- **First:** `pnpm -s ledger health`.
- **Then:** check `LEDGER_URL` (the API URL `pnpm aws:deploy` prints, or the local server). If it
  is right, deploy the commit the CLI was built from (`pnpm aws:deploy`).
- **Related:** [ADR-011](../.ai/architecture.md#adr-011--one-contract-many-surfaces).

### reconcile_in_progress

- **Means:** `409`. Another reconcile run is unfinished and still inside its time budget; runs
  never overlap. Slice 4 lands this operation.
- **First:** slice 4's `ledger gaps` shows the running run.
- **Then:** wait for it to finish, or for its time budget to pass, then start another.
- **Related:** [ADR-007](../.ai/architecture.md#adr-007--recovery-by-id-diff-and-replay-through-ingest).

### last_operate_token

- **Means:** `409`. Revoking this token would leave no active `operate` token, which would lock
  every operator out.
- **First:** `pnpm -s ledger token list`.
- **Then:** create another `operate` token
  (`pnpm -s ledger token create --name <name> --scope operate`), switch `LEDGER_TOKEN` to it, then
  revoke the old one.
- **Related:** [api-contract.md → Operate operations](../.ai/api-contract.md#operate-operations).

### run_abandoned

- **Means:** a reconcile run's outcome, not an HTTP status: the run has no `finished_at` past its
  time budget (it crashed or its invoke was lost), so it will not finish. Slice 4 lands this
  operation.
- **First:** slice 4's `ledger gaps` shows the run.
- **Then:** run `ledger reconcile` again (slice 4); the next hourly run covers the horizon anyway.
- **Related:** [ADR-007](../.ai/architecture.md#adr-007--recovery-by-id-diff-and-replay-through-ingest).

### reconciler_not_configured

- **Means:** a reconcile run's outcome, not an HTTP status: the reconciler has no Resend API key or
  webhook id, or Resend has no webhook with that id, so the run listed and replayed nothing. Every
  local-mode run ends here, because local mode composes no Resend client.
- **First:** `pnpm -s ledger gaps` shows the run and its `error`.
- **Then:** on a deployed stack, set `LEDGER_DEPLOY_RESEND_API_KEY` (the reconciler's dedicated
  `full_access` key) and `LEDGER_DEPLOY_RESEND_WEBHOOK_ID`, then `pnpm aws:deploy` (Ask-first), and
  `pnpm -s ledger reconcile`. If both are set, check the webhook id against List Webhooks: a
  deleted webhook reads as not configured.
- **Related:** [ADR-007](../.ai/architecture.md#adr-007--recovery-by-id-diff-and-replay-through-ingest),
  [ADR-012](../.ai/architecture.md#adr-012--resend-client-is-the-sole-resend-api-caller).

### database_unavailable

- **Means:** `503`. Postgres is unreachable, or out of storage. Ingest never touches the database,
  so webhooks keep answering `200` and events wait in the queue; the worker pauses its own event
  source instead of failing them toward the DLQ.
- **First:** `pnpm -s ledger health`. It answers during an outage and shows the database line and
  the storage used.
- **Then:**
  - `unreachable`: restore the database (its host's status). Then `pnpm -s ledger worker resume`,
    or wait for the hourly resume.
  - Reachable but storage at its limit: free space or raise the plan, then resume as above.
  - On AWS, `pnpm aws:db-check --email-id <id>` checks the runtime role's timeouts and the pool.
- **Related:** [ADR-015](../.ai/architecture.md#adr-015--the-worker-pauses-its-own-event-source-on-a-database-outage),
  [LedgerApp-queue-age](#ledgerapp-queue-age).

### internal_error

- **Means:** `500`. An unexpected failure in the API, or client-side in the CLI. The message holds
  no internals.
- **First:** retry the command once.
- **Then:** if it persists, read `/ledger/LedgerApp-api` for `api.internal_error` with the
  response's request id (locally, the server's stdout).
- **Related:** [ADR-011](../.ai/architecture.md#adr-011--one-contract-many-surfaces).

### api_unavailable

- **Means:** raised by the SDK, never by the API: the API answered without Ledger's error shape (an
  HTTP API throttle or a stopped function), or did not answer at all.
- **First:** check `LEDGER_URL` in `.env.local`, then `pnpm -s ledger health`.
- **Then:** if the URL is right, the kill switch may have tripped: look for a budget or
  [LedgerApp-usage-trip](#ledgerapp-usage-trip) email, then `pnpm aws:rearm`. Locally, start the
  server with `pnpm dev:full`.
- **Related:** [aws.md → Budget alarms](../.ai/aws.md#budget-alarms) items 4 and 6.
