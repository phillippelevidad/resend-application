# Outbox, dispatcher, reconciler and DLQ redrive

The paths that act after an event is stored, or that recover one that never arrived. Every effect
here rides on at-least-once delivery, so each one is idempotent by a key the database enforces
([commands-and-readers.md](commands-and-readers.md#idempotency-the-constraint-decides)).

## Outbox

[ADR-006](../../../../.ai/architecture.md#adr-006--transactional-outbox-for-reactions),
[outbox](../../../../.ai/data-modeling.md#outbox--reactions-awaiting-delivery). Lands in slice 6.

- **Written only in the worker transaction of the event that caused it**, with
  `INSERT … ON CONFLICT (dedupe_key) DO NOTHING`. Never a second transaction, never after commit,
  never an in-process emitter ([rejected patterns](../../pp-general/references/adding-things.md#rejected-patterns)).
- **`dedupe_key` is `<rule>:<svix_id>[:<address_hash>]`**: no raw address, ever.
- **A rule is a pure `packages/core` `.rule.ts`** over the recomputed state. It fires only on a
  predicate that, once true, stays true for every larger event set (a recipient reaching
  `hard_bounced`), so it fires once in any arrival order; never on an intermediate state.
- **It fires on the transition this event causes** (ADR-006: the predicate *becomes* true): false
  on the event set without this event, true with it, both computed by the pure projections under
  the locks, never by comparing with the stored row this transaction overwrites. A predicate
  already true does not fire: `dedupe_key` carries the causing `svix_id`, so the constraint cannot
  stop a second firing from another event.
- **The row is a self-contained snapshot:** `payload` holds ids, `type`, hashes and masks, enough to
  render the effect without re-reading mutable state, and never raw PII or a third-party body. An
  alert's subject and body render from `payload` alone, so every retry sends identical bytes.
- **A projection rebuild writes no outbox rows.**
- **`source = simulated` rows go to the simulator's receiver sink only**, never to Resend or a real
  callback URL (ADR-006).

## Dispatcher

[ADR-017](../../../../.ai/architecture.md#adr-017--the-dispatcher-is-triggered-after-commit-plus-an-hourly-sweep).
Lands in slice 6.

- **Triggered** by the worker's async invoke after commit, plus the shared hourly sweep. No
  sub-hourly schedule touches Postgres.
- **Single-flight:** each batch runs in its own transaction, which first takes
  `pg_try_advisory_xact_lock` on a fixed key. The lock ends with that batch's commit, so every
  batch takes it again, and an invocation or batch that does not get it exits at once.
- **The holder claims up to 10 due rows `FOR UPDATE SKIP LOCKED`**, delivers them, records each
  outcome, commits the batch, and repeats until none is due. This is the one transaction that makes
  an external call ([commands-and-readers.md](commands-and-readers.md#a-command-owns-its-transaction)):
  each delivery has an HTTP timeout well below the Lambda timeout, and a crash re-sends at most one
  batch, which the receivers absorb (sim invariant 3).
- **Alert email** goes through `resend-client` with a `sending_access` key and an `Idempotency-Key`
  derived from `dedupe_key` (RS-24). `409 concurrent_idempotent_requests` is retried;
  `409 invalid_idempotent_request` marks the row `dead` with that name in `last_error`. The retry
  horizon stays under the key's 24 h life; past it the row is `dead`
  ([resend.md → Constraint 8](../../../../.ai/resend.md#constraints-and-sharp-edges)).
- **`last_error` holds a status and an error name**, never a response body.
- **Fail loudly, per row:** a delivery's throw is caught and recorded as that row's outcome in the
  batch transaction (`attempts` up, `next_attempt_at` backed off, `last_error`), never rethrown. A
  rethrow rolls the whole batch back: rows already sent stay `pending`, never count an attempt,
  never reach the cap that marks them `dead`, and re-send on every trigger. This catch translates a
  throw into a recorded outcome ([catching](../../pp-general/references/errors.md#catching));
  nothing returns success for an undelivered row.
- **Before each send:** an alert row past the 24 h horizon, measured from its `created_at` (never
  later than the key's first use), is marked `dead` with no send. When the remaining Lambda time
  (a deadline the handler passes in) cannot fit one delivery's worst case, its HTTP timeout plus
  the limiter's wait, the holder commits the batch so far and stops; the next invoke or sweep takes
  the rest.
- The callback signing scheme, the attempt cap, the time-budget values and the sweep's tick shape
  are the slice 6 pre-proposal's.

## Reconciler

[ADR-007](../../../../.ai/architecture.md#adr-007--recovery-by-id-diff-and-replay-through-ingest),
[reconcile_runs](../../../../.ai/data-modeling.md#reconcile_runs--one-row-per-recovery-run). Lands in
slice 4.

- **A run starts in one transaction** (slice 4, D6), in both triggers: the queue snapshot through
  `QueueAttributesPort` first, outside it; then `pg_advisory_xact_lock` on the fixed reconcile key,
  the check for an unfinished run inside its time budget (a statement issued after the lock), the
  anchor, `reconcileHorizon` with the clock port's `now`, and the insert. A refused start is
  `reconcile_in_progress`. A scheduled start (`startScheduledRun` in `packages/reconciler`) inserts
  claimed; a manual one (`StartReconcileCommand` in `packages/api`, D18) inserts unclaimed, then,
  after the commit, `reconcilerInvoke.invokeAsync({ ledger: 'reconcile-run', run_id })`; a rejected
  hand-off finishes the row `internal_error` in a second statement. Two thin commands, because a
  shared one in `@ledger/reconciler` would pull the `resend` SDK into the read API's bundle. The
  Resend calls run **after** the start's transaction commits, never inside it.
- **The reconciler claims its run before any Resend call:** `UPDATE reconcile_runs SET claimed_at
  = now() WHERE id = $1 AND claimed_at IS NULL AND finished_at IS NULL`; zero rows means a duplicate
  async invoke (AWS-53) or a finished run, which logs `reconcile.duplicate_invoke` and exits
  without work. Runs never overlap only through this claim
  ([ADR-007](../../../../.ai/architecture.md#adr-007--recovery-by-id-diff-and-replay-through-ingest)).
  The invoke retries nothing (`retryAttempts: 0`, [pp-infra](../../pp-infra/SKILL.md)): a lost
  invoke reads abandoned and the next hourly run covers it.
- **Then, in order** (D15, `executeRun`): no client or webhook id → finish
  `reconciler_not_configured` with no call; read the configured webhook's `status` and stop with
  `webhook_disabled` if it is disabled (RS-11); page List Events newest first (RS-14), each item
  filtered against the horizon fixed at start (younger than its end skipped, older than its start
  outside), stopping after a page holding an item older than the start or with `has_more` false;
  diff each page's ids with `presentSvixIds`; replay the missing ones in page order (RS-16), unless
  a dry run. Every Resend call carries the deadline `started_at + budget − 60 s`; reaching it with
  paging unfinished finishes `rate_limited`. A replay re-enters through ingest, so verification and dedupe apply unchanged. Never a
  write path that inserts fetched payloads directly.
- **One failed replay never aborts a run**; it counts in `failed` and logs `reconcile.replay_failed`.
  Only `resend_auth_failed` and `rate_limited` on a replay stop the run with that code.
- **A time budget below the Lambda timeout** (AWS-03). A run that reaches it stops; the next run
  re-diffs from newest (forward-only pagination, RS-14). The budget is one constant, shared by the
  start check and the abandoned derivation below.
- **Its outcome is a registered code in `reconcile_runs.error_code`** (`webhook_disabled`,
  `rate_limited`, `resend_auth_failed`, `resend_unavailable`, `reconciler_not_configured`,
  `internal_error`; `reconcileRunErrorCodes`), never a throw that loses the row. An unexpected throw
  after the claim is finished best-effort `internal_error`, logged `reconcile.internal_error` by
  `error_name`, and rethrown as a constant. A clean run, dry runs included, emits
  `reconcile.missing`, `reconcile.replayed` and `reconcile.failed`; an errored one emits none, the
  silence the gap alarm reads (D19, D24)
  ([one mapping per surface](../../pp-general/references/errors.md#one-mapping-per-surface)).
- **`run_abandoned` is derived, never written.** A run with no `finished_at` past its time budget
  (crashed, or its invoke lost) will not finish; the `reconcile.getRun` and `gaps.list` readers in
  `packages/api` return it as that run's outcome
  ([Error codes](../../../../.ai/api-contract.md#error-codes),
  [reconcile_runs](../../../../.ai/data-modeling.md#reconcile_runs--one-row-per-recovery-run)).
- **Every Resend call goes through `resend-client`** and its limiter ([resend-client.md](resend-client.md)).
- **The hourly tick** (D25) is a second EventBridge schedule, `LedgerApp-reconcile-hourly`, on the
  shared `cron(0 * * * ? *)`, with the worker's resume schedule's retry and age bounds, its input
  `RECONCILE_SCHEDULED_EVENT`. The grace window's age is the source queue's
  `ApproximateAgeOfOldestMessage` through `SqsQueueAttributesAdapter` (AWS-22). The conditional
  parts of ADR-007 (RS-U01, RS-U02, RS-U20) MUST be settled before recovery is called done.
- Evidence: [reconciler.test.ts](../../../../packages/reconciler/src/reconciler.test.ts),
  [reconciler.int.test.ts](../../../../packages/reconciler/src/reconciler.int.test.ts),
  [recovery.int.test.ts](../../../../packages/reconciler/src/recovery.int.test.ts).

## DLQ inspect and redrive

[ADR-008](../../../../.ai/architecture.md#adr-008--backpressure-bounded-concurrency-partial-batch-failure-dlq),
[dlq.startRedrive](../../../../.ai/api-contract.md#dlqstartredrive). Both go through `DlqPort`
(`packages/shared`); on AWS, `SqsDlqAdapter` (`packages/aws/src/sqs-dlq.adapter.ts`, slice 3 D4)
implements it, and its unit test pins every bullet below.

- **Inspect** reads the depth (visible plus in flight, `GetQueueAttributes`), then receives a sample
  of up to 10 with **`VisibilityTimeout: 0`** and a **1-second long poll** (`WaitTimeSeconds: 1`), and
  **never deletes** (AWS-50). Visibility 0 hides no sampled message from a following redrive or
  depth; the long poll queries every server, where a short poll samples a subset and can answer
  nothing from a small DLQ (AWS-59). The depth never comes from the sample's length. The adapter
  returns raw bodies; the reader parses the envelope's `svixId` and `receivedAt` and exactly three
  payload paths, `type`, `created_at` and `data.email_id` (slice 3 D5,
  [read-api.md → Mappers](read-api.md#mappers)).
- **Redrive** is `StartMessageMoveTask` through the DLQ port (AWS-21), and **`ListMessageMoveTasks`
  (`MaxResults: 1`) runs before any start**: a `RUNNING` task answers `redrive_in_progress` with no
  start sent, because SQS allows one active task per queue and names no "task already running"
  error (AWS-60, AWS-U14). Every answer is confirmed by one receive (`MaxNumberOfMessages: 1`,
  visibility 0, the 1-second long poll, AWS-59), whatever the depth reads, because the approximate
  attributes lag (AWS-62): nothing received → `empty` (`200`), no start; a received message →
  `started`, with depth = max(approximate depth, 1) (slice 3 D4). The start names no
  `DestinationArn`, so each message returns to its original source queue. Its own error propagates
  unchanged (`internal_error`), never mapped to `redrive_in_progress`.
- **The `TaskHandle` is dropped**: it embeds the DLQ's ARN and account id (AWS-61), so no output
  carries it; `started` reports the depth instead.
- **Redriven messages get a new `messageId`**; the worker dedupes on `svix_id`, so nothing applies
  twice. Never an automatic redrive after recovery (ADR-015's rejected option).
- Locally, the in-process queue's dead list implements the same port (slice 3 D3); slice 2B moves
  it to the dead rows of `local_queue_messages`.
