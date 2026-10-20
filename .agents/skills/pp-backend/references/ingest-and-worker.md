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

`apps/ingest`'s handler decodes the body to its exact bytes (`isBase64Encoded`, AWS-01), logs
`ingest.request_decoded` with `body_base64_count` and no other request data, and passes the bytes
and the three `svix-*` headers to the function `packages/ingest` built. Anything thrown is caught
at the edge, logged by `error_name`, and rethrown as a constant `internal_error` with no `cause`.
Every Lambda root parses its config and builds its clients at module scope, but reads its secrets
on the first invocation through one memoized promise per container, reused by every warm
invocation, so importing the bundle needs no AWS access (slice 2 D32's bundle smoke check). The one
exception is the reconciler's Resend key, read on every invocation and the client rebuilt when it
changed ([resend-client.md](resend-client.md#what-it-is), `apps/reconciler/src/compose-reconciler.ts`).
Ingest's root builds `createIngest` at module scope and makes no AWS call there; its memoized read
is step 1's cache, filled on the first request. That function:

1. **Gets the secret set** through `SecretReaderPort` by the ids its root passes: the Resend set
   by `signingSecretsId` (`SIGNING_SECRETS_ARN` on AWS), parsed with Zod as a JSON array of
   `whsec_` strings, then, after it, the simulator secret by `simulatorSecretId`
   (`SIMULATOR_SECRET_ARN`, set only on a stack deployed with the simulator on, ADR-016), parsed as
   one bare `whsec_` string (`signing-secrets.schema.ts`, slice 3 D13). Locally both come from one
   `StaticSecretReaderAdapter` holding a record of id → value over the parsed
   `LEDGER_WEBHOOK_SECRETS` and `LEDGER_SIMULATOR_SECRET`. No `simulatorSecretId` means no
   simulator secret, so a simulator-signed request answers `401`; a failed or unparseable read of
   either id fails the whole read. The result is cached per container for
   `SECRET_SET_TTL_MS` (5 minutes) against the clock port (ADR-009), so an added or retired secret
   takes effect without a redeploy; concurrent requests share one pending read. A failed read
   (the simulator secret's included), a value that fails the parse, or a set with no secret at all (no Resend secret and no simulator
   secret) answers `503` with the fixed body `unavailable`, logs `ingest.secrets_unavailable` with
   `error_name` only, enqueues nothing and emits no metric. Resend retries a `503` (RS-10); a `401`
   on an infra fault would read as a wrong secret and can auto-disable the webhook (RS-11), and the
   `503` is what proves RS-U07 safe either way. A failed refresh clears the cache and never serves
   a set past its 5 minutes ([create-ingest.test.ts](../../../../packages/ingest/src/create-ingest.test.ts)).
2. **Verifies with `webhooks.verify`, one call per secret, first match wins** (RS-02). Resend
   secrets first, then the simulator secret when one is configured; the match sets `source` to
   `live` or `simulated` (ADR-016). Only ingest sets `source`. Never a hand-rolled HMAC compare
   ([integrations.md → Locked rules](../../../../.ai/integrations.md#locked-rules-must), rule 1).
   `webhooks.verify` enforces the 5-minute timestamp window (RS-02).
3. **On no match: `401`**, one `ingest.rejected` metric with `reason` `signature` or `timestamp` as
   its one dimension and no field, and nothing enqueued (slice 4, D33). `timestamp`: `svix-timestamp`
   absent, not an integer as `parseInt` reads it, or more than 300 s from the clock port's now
   either way (`webhooks.verify`'s window, Constraint 12), checked before any `verify` call, so no
   thrown SDK error is parsed. `signature`: every other rejection (a missing `svix-id` or
   `svix-signature`, no secret matching).
4. **Builds the envelope** `{ svixId, receivedAt, source, rawBody, headers subset }` and reads
   `type` for the log line.
5. **Enqueues through the queue port.** A failed enqueue answers `503`, so Resend retries (RS-10).
6. **Answers exactly `200` with the fixed short body** only after the enqueue resolved. The body
   never echoes payload, PII or a secret: Resend stores it (RS-12). The exact bytes, all
   `text/plain; charset=utf-8`: `200` → `ok`, `401` → `unauthorized`, `503` → `unavailable`,
   exported from `packages/ingest/src/ingest-bodies.ts` (`INGEST_BODY_*`, `INGEST_CONTENT_TYPE`) so
   every runtime adapter writes the same ones.

- **Ingest never touches the database**, directly or through a package that does (ADR-001). A
  database outage MUST NOT fail a Resend delivery.
- **It imports `resend` for `webhooks.verify` only**; every API call is `resend-client`'s
  ([review grep 6](../../pp-general/references/boundaries.md#review-greps)).
- **Evidence it owes** is the mandatory verify-before-enqueue tier: a forged, stale or unsigned
  request never reaches the queue port, and `200` follows only a successful enqueue
  ([pp-workflow → Test tiers](../../pp-workflow/SKILL.md#test-tiers)).

## Worker, per message

One `RecordEventCommand`-shaped transaction per message ([commands-and-readers.md](commands-and-readers.md)):

1. Parse the envelope (Zod, from `packages/core`). Replace each `\u0000` and lone surrogate in the
   parsed payload with U+FFFD (the pure `packages/core` sanitizer) and count the event as sanitized (`worker.payload_sanitized`, ADR-004)
   when any was replaced; the sanitized event follows the ordinary path below
   ([pp-database → unstorable characters](../../pp-database/references/schema-and-repositories.md#unstorable-characters)).
2. `INSERT … ON CONFLICT (svix_id) DO NOTHING` into `webhook_events`, typed columns extracted once.
   On conflict: commit as a duplicate, emit `worker.duplicates`, done.
3. Unknown or non-email type, or a payload that fails its type's schema: stored raw (typed columns
   null where unreadable), projection skipped, `projection.unknown_event_type` emitted. A verified
   event is **never** dead-lettered for its content (ADR-004, RS-25), a payload `jsonb` cannot
   store included: step 1 sanitized it, and it is stored raw here only if it still fails its schema.
4. Otherwise lock the email row, then the recipient rows in sorted `address_hash` order; load the
   email's full event set after the locks.
5. Recompute with `projectEmail` and `projectRecipient` from `packages/core` (ADR-003) and write the
   results. Projection code reads no `received_at`, no prior projection row and no arrival order
   ([Reliability core](../../../../.ai/architecture.md#reliability-core)).
6. Evaluate the reaction rules and insert each outbox row with its `dedupe_key` (slice 6,
   [reactions-and-recovery.md](reactions-and-recovery.md#outbox)).
7. Commit. When any message of the batch wrote outbox rows, the worker invokes the dispatcher
   asynchronously at most once per batch, after its last commit (ADR-017; nothing else bounds the
   fan-out, AWS-53). A lost invoke only delays delivery to the next sweep, so an invoke failure is
   logged and never marks a committed message failed (AWS-05: that redelivers it).

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

- `packages/db` classifies a connection-class error, or Neon's storage-limit error (PG-U07), and
  raises the shared subclass for it ([classifier](../../pp-database/references/schema-and-repositories.md#connection-error-classification)).
  The worker branches on that subclass only, so a full database pauses like an unreachable one.
- A Lambda frozen or killed mid-transaction holds its locks until the runtime role's server-side
  timeouts end it ([pp-database → grants](../../pp-database/references/migrations-and-grants.md#grants)).
- **Retry once on a fresh connection** (a Neon suspend can drop one, PG-U04). If that fails too,
  report **every** message in the batch failed and disable the worker's own ESM through the event
  source control port (`Enabled: false`, AWS-18). Messages wait in the queue (AWS-07).
- Any other error follows the per-message path to the DLQ, so poison isolation is unchanged.
- **Resume:** a resume event (hourly cron, or `worker.resumeEventSource` through the API) checks the
  ESM state; only while paused does it probe Postgres and re-enable on success. A healthy stack never
  probes, so no idle database wake ([Cadence](../../../../.ai/integrations.md#cadence-and-the-database)).
  The probe also reads storage used and fails while it is at the storage budget's limit: a
  read-only probe succeeds on a full database, which would re-enable, fail and re-pause hourly,
  spending receives until the queue drained ([ADR-015](../../../../.ai/architecture.md#adr-015--the-worker-pauses-its-own-event-source-on-a-database-outage)).
- **The fresh connection is built, not assumed.** `RecordEventCommand` runs its transaction through
  `packages/db`'s `runTransaction`, which discards a connection that failed connection-class instead
  of handing it back to the size-1 pool, so the retry connects anew and never waits on a hung socket
  (slice 2, D15).
- **The resume event** is `{ "ledger": "resume-event-source" }`, Zod-parsed by `apps/worker`'s
  handler beside the SQS batch; it answers `ResumeResult`, `{ outcome: 'resumed' |
  'already_enabled' | 'probe_failed'; state }`. The hourly schedule sends it asynchronously, the
  read API's `worker.resumeEventSource` synchronously through the function invoke port (slice 2,
  D16, D17).
- **The worker finds its own ESM by its own name**, read from the reserved `AWS_LAMBDA_FUNCTION_NAME`
  (AWS-56): `LambdaEventSourceControlAdapter` lists the function's mappings once per container,
  requires exactly one and caches its UUID. A function cannot carry its own mapping's UUID as a
  variable, because that reference would be a CloudFormation cycle (slice 2, D16, C5).

## Evidence these paths owe

The tier rules are [pp-workflow → Test tiers](../../pp-workflow/SKILL.md#test-tiers); the harness is
[pp-testing](../../pp-testing/SKILL.md#postgres-harness). Duplicate delivery → one row; crash between
steps → nothing or everything; two emails sharing a recipient → no deadlock, both projected
(slice 1); batch-failure unit test ([create-worker-handler.test.ts](../../../../apps/worker/src/create-worker-handler.test.ts));
database stopped → no message in the DLQ ([database-outage.int.test.ts](../../../../packages/worker/src/database-outage.int.test.ts));
the resume probe ([resume.int.test.ts](../../../../packages/worker/src/resume.int.test.ts)) (slice 2).
