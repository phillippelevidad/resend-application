# Ingest and worker

The two functions every event passes through. Ingest is
[ADR-001](../../../../.ai/architecture.md#adr-001--verify-then-enqueue) and
[ADR-009](../../../../.ai/architecture.md#adr-009--multi-secret-verification-and-timestamp-tolerance);
the worker is [ADR-004](../../../../.ai/architecture.md#adr-004--immutable-ledger-keyed-on-svix_id-one-transaction-per-message),
[ADR-008](../../../../.ai/architecture.md#adr-008--backpressure-bounded-concurrency-partial-batch-failure-dlq)
and [ADR-015](../../../../.ai/architecture.md#adr-015--the-worker-pauses-its-own-event-source-on-a-database-outage).
The wire behavior of `POST /webhooks/resend` is [api-contract.md → Ingest boundary](../../../../.ai/api-contract.md#ingest-boundary);
it is not an operation, has no OpenAPI entry, and the error registry does not apply to it.

## Ingest, in order

`apps/ingest`'s handler decodes the body to its exact bytes (`isBase64Encoded`, AWS-01) and passes
the bytes and the three `svix-*` headers to the function `packages/ingest` built. That function:

1. **Gets the secret set**, cached per container for at most 5 minutes against the clock port
   (ADR-009), so an added or retired secret takes effect without a redeploy.
2. **Verifies with `webhooks.verify`, one call per secret, first match wins** (RS-02). Resend
   secrets first, then the simulator secret when one is configured; the match sets `source` to
   `live` or `simulated` (ADR-016). Only ingest sets `source`. Never a hand-rolled HMAC compare
   ([integrations.md → Locked rules](../../../../.ai/integrations.md#locked-rules-must), rule 1).
   `webhooks.verify` enforces the 5-minute timestamp window (RS-02).
3. **On no match: `401`**, the `ingest.rejected` metric with `reason` `signature` or `timestamp`,
   and nothing enqueued. How `reason` tells a stale timestamp from a bad signature is the slice 1
   pre-proposal's; comparing `svix-timestamp` with the clock port before `verify` needs no parsing
   of the SDK's thrown error.
4. **Builds the envelope** `{ svixId, receivedAt, source, rawBody, headers subset }` and reads
   `type` for the log line.
5. **Enqueues through the queue port.** A failed enqueue answers `503`, so Resend retries (RS-10).
6. **Answers exactly `200` with the fixed short body** only after the enqueue resolved. The body
   never echoes payload, PII or a secret: Resend stores it (RS-12). Its exact bytes are the slice 1
   pre-proposal's.

- **Ingest never touches the database**, directly or through a package that does (ADR-001). A
  database outage MUST NOT fail a Resend delivery.
- **It imports `resend` for `webhooks.verify` only**; every API call is `resend-client`'s
  ([review grep 6](../../pp-general/references/boundaries.md#review-greps)).
- **Evidence it owes** is the mandatory verify-before-enqueue tier: a forged, stale or unsigned
  request never reaches the queue port, and `200` follows only a successful enqueue
  ([pp-workflow → Test tiers](../../pp-workflow/SKILL.md#test-tiers)).

## Worker, per message

One `RecordEventCommand`-shaped transaction per message ([commands-and-readers.md](commands-and-readers.md)):

1. Parse the envelope (Zod, from `packages/core`).
2. `INSERT … ON CONFLICT (svix_id) DO NOTHING` into `webhook_events`, typed columns extracted once.
   On conflict: commit as a duplicate, emit `worker.duplicates`, done.
3. Unknown or non-email type, or a payload that fails its type's schema: stored raw (typed columns
   null where unreadable), projection skipped, `projection.unknown_event_type` emitted. A verified
   event is **never** dead-lettered for its content (ADR-004, RS-25).
4. Otherwise lock the email row, then the recipient rows in sorted `address_hash` order; load the
   email's full event set after the locks.
5. Recompute with `projectEmail` and `projectRecipient` from `packages/core` (ADR-003) and write the
   results. Projection code reads no `received_at`, no prior projection row and no arrival order
   ([Reliability core](../../../../.ai/architecture.md#reliability-core)).
6. Evaluate the reaction rules and insert each outbox row with its `dedupe_key` (slice 6,
   [reactions-and-recovery.md](reactions-and-recovery.md#outbox)).
7. Commit. After commit, when outbox rows were written, invoke the dispatcher asynchronously
   (ADR-017). A lost invoke only delays delivery to the next sweep.

## Worker, per batch

- **Partial batch failure.** Each message gets its own result; the handler returns
  `batchItemFailures` listing exactly the failed `messageId`s. An empty or null response deletes the
  whole batch (AWS-05), so the list is built from results, never assumed.
- **Never swallow.** A message that failed is reported failed; a `catch` that logs and continues
  turns at-least-once into at-most-once ([catching](../../pp-general/references/errors.md#catching)).
- **Poison isolation** is SQS's: a message failing `maxReceiveCount` times reaches the DLQ (ADR-008).
  Only unexpected code errors get there; the simulator's poison message is an injected fault.
- **Concurrency** is bounded by the ESM `MaximumConcurrency` and the size-1 pool, never by an
  in-process parallel loop ([composition.md](composition.md#the-composition-root)).

## Database outage (ADR-015)

- `packages/db` classifies a connection-class error and raises the shared subclass for it
  ([pp-database](../../pp-database/SKILL.md)). The worker branches on that subclass only.
- **Retry once on a fresh connection** (a Neon suspend can drop one, PG-U04). If that fails too,
  report **every** message in the batch failed and disable the worker's own ESM through the event
  source control port (`Enabled: false`, AWS-18). Messages wait in the queue (AWS-07).
- Any other error follows the per-message path to the DLQ, so poison isolation is unchanged.
- **Resume:** a resume event (hourly cron, or `worker.resumeEventSource` through the API) checks the
  ESM state; only while paused does it probe Postgres and re-enable on success. A healthy stack never
  probes, so no idle database wake ([Cadence](../../../../.ai/integrations.md#cadence-and-the-database)).
- The resume event's shape, and how the worker learns its own ESM UUID (an internal variable CDK
  sets, or a lookup), are the pre-proposal of the slice that ships the pause and resume (slice 2).

## Evidence these paths owe

The tier rules are [pp-workflow → Test tiers](../../pp-workflow/SKILL.md#test-tiers); the harness is
[pp-testing](../../pp-testing/SKILL.md#postgres-harness). Duplicate delivery → one row; crash between
steps → nothing or everything; two emails sharing a recipient → no deadlock, both projected
(slice 1); batch-failure unit test; database stopped → no message in the DLQ (slice 2).
