# Design — slice 3: Operations and evidence on AWS

## Context

See [proposal.md → Why](proposal.md#why). The pre-proposal
[2026-10-19-slice-3-operations-and-evidence-on-aws.md](../../../.ai/pre-proposals/2026-10-19-slice-3-operations-and-evidence-on-aws.md)
(*PP*) is decision-complete and checked (12 repairs, nothing left for the owner). Each decision
below keeps its PP number (D1–D31) and carries what `opsx:apply` needs to build it. The PP keeps the
authority trail for every decision and the contradictions C1–C11. D32 and D33 are build-level
choices this design adds where the PP left the mechanism open. Neither changes a spec, a contract or
a decision. Two names differ from the PP as fact corrections: the DLQ contract suite follows the
existing `<port>-port-contract.ts` files (`packages/shared/src/testing/queue-port-contract.ts`), and
`burstHistory` takes the run's `seed`, which its determinism needs (D25). Everything the build needs is in this file: [Surfaces](#surfaces) (PP §12),
[Evidence map](#evidence-map) (PP §20) and [Walkthrough plan](#walkthrough-plan) (PP §21).

State on `HEAD` (PP §5, re-checked 2026-10-19; only the PP and its repair have landed since
`8e37a70`):

- **Alarms:** two exist, `LedgerApp-usage-trip` → trip topic (`infra/src/app.stack.ts:247-258`) and
  `LedgerGuardrails-kill-switch-errors` → alert topic (`infra/src/guardrails.stack.ts:170-181`).
  Neither has an `AlarmDescription`. There is no `docs/runbook.md`. `RUNBOOK_BASE_URL` already exists
  in `packages/core/src/error-codes.ts:32`, and its comment says the links 404 until slice 3.
- **DLQ:** no port, adapter, route, SDK method or CLI command. The read API already has `DLQ_URL`
  and `sqs:GetQueueAttributes` on both queues (`infra/src/app.stack.ts:183,190-195`).
  `redrive_in_progress` is registered (`error-codes.ts:105`). `InProcessQueueAdapter` keeps a dead
  list (`packages/shared/src/in-process-queue.adapter.ts:58,106,175`).
- **Simulator secret:** ingest already verifies it after the Resend set and stamps `simulated`
  (`packages/ingest/src/create-ingest.ts:79-92`; test `create-ingest.test.ts:283`). On AWS it is
  wired `undefined` (`apps/ingest/src/main.ts:29-30`). There is no CDK secret, flag or deploy write.
- **Simulator:** four flags (`sim/src/read-sim-flags.ts:12-17`); a live run sends one request at a
  time (`sim/src/live-run.ts:41`), settles within a fixed 30 s at 250 ms (`:25-26`), and prints
  `invariant 4 not checked (slice 3)` (`:112`). Invariant checkers 1 and 2 exist in
  `sim/src/invariants/`. `sim` depends on `@ledger/core`, `@ledger/db` and `@ledger/shared`.
- **AWS steps:** `packages/aws/src/kill-switch.ts` holds `readStage` (`:301`) and `withThrottle`
  (`:337`) as private helpers; `alarmControl` (`alarm-control.ts:15`), `readStackOutputs`
  (`stack-outputs.ts:14`) and `readKillSwitchState` (`kill-switch.ts:241`) exist. The stack-name
  constants live in `infra/scripts/ledger-stacks.ts`.
- **Harness:** `packages/db/src/testing.ts:7` imports `inject` from `vitest` at module load and uses
  it once, in `createTestDatabase` (`:43`).

Binding constraints: ADR-001, ADR-002, ADR-003, ADR-004, ADR-005, ADR-008, ADR-010, ADR-011,
ADR-013, ADR-015, ADR-016 ([Decisions](../../../.ai/architecture.md#decisions)); the module
boundaries in root [AGENTS.md](../../../AGENTS.md#module-boundaries) (only `packages/aws` imports
`@aws-sdk/*`; `sim` never imports `infra`; every database access goes through `packages/db`);
[aws.md → Budget alarms](../../../.ai/aws.md#budget-alarms) item 7 (the burst throttle);
[api-contract.md → Conventions](../../../.ai/api-contract.md#conventions) (redaction, auth during an
outage, long-running commands); the `pp-backend`, `pp-infra`, `pp-testing`, `pp-cli` and
`pp-general` skills.

## Goals / Non-Goals

**Goals:**

- Every alarm reaches the owner's inbox with a working runbook link, and a unit test keeps the links
  resolving.
- An operator inspects and redrives the DLQ from the CLI, with no personal data on any surface and no
  second concurrent redrive.
- Every AWS sim run scripts its own fault, guard and restore, so the owner runs one command per
  bullet and nothing is left changed after a failure.
- Each deployed claim (no loss under burst and outage, poison isolation, order independence through
  SQS) is checked by simulator invariants 1, 2 and 4, not asserted.

**Non-Goals:**

- No published latency, drain or cost numbers (slice 9). The burst records p50/p99 for RS-U08 only.
- No automatic redrive (ADR-015 rejects it), and no failure classification of dead messages.
- No load generator beyond one Node process; no Neon API integration; no new alarm beyond the three.
- No change to the worker, the projections or the ledger transaction. A redrive takes the ordinary
  path, already proven idempotent on `svix_id` by `record-event.command.int.test.ts`.

## Decisions

### Module layout

New or changed files, by project. Names follow pp-general's role suffixes; one route, reader,
command or mapper per file.

| Project | Files |
| --- | --- |
| `packages/shared` | `dlq.port.ts` (new, D1); `in-process-queue.adapter.ts` (also implements `DlqPort`, D3); `testing/dlq-port-contract.ts` (new, D3), exported from `testing.ts`; `function-env.ts` (`ingestSimulatorEnv`, D12); `static-secret-reader.adapter.ts` (a record of id → value, D13); `index.ts` |
| `packages/core` | `testing/burst-history.ts` and `burst-history.prop.test.ts` (new, D25), exported from `@ledger/core/testing` |
| `packages/db` | `testing/poison-fault.ts` and `poison-fault.int.test.ts` (new, D27), re-exported from `testing.ts`; `testing.ts` (lazy `inject`, D32); `classify-database-error.ts` (the PG-U07 comment, D30) |
| `packages/ingest` | `create-ingest.ts` (`simulatorSecretId`, D13); `create-ingest.test.ts` |
| `packages/worker` | `poison-isolation.int.test.ts` (new, §Evidence map) |
| `packages/api` | `list-dlq-messages.route.ts`, `list-dlq-messages.reader.ts`, `dlq-message-response.mapper.ts`, `dlq-message-response.schema.ts`; `start-dlq-redrive.route.ts`, `start-dlq-redrive.command.ts`, `dlq-redrive-response.mapper.ts`, `dlq-redrive-response.schema.ts` (D7); `list-dlq-messages.route.int.test.ts`, `start-dlq-redrive.route.int.test.ts`; `create-api.ts` (`ApiDeps.dlq`, the two routes); `testing/api-test-deps.ts` and `testing/read-api-contract.ts` (the DLQ cases) |
| `packages/sdk` | `create-ledger-client.ts` (`dlq.listMessages`, `dlq.startRedrive`), `testing.ts` (`FakeLedgerClient`); regenerated `openapi.json`, `src/openapi-types.ts` |
| `packages/aws` | `sqs-dlq.adapter.ts` + test (D4); `ledger-stacks.ts` (moved and extended, D2); `http-api-stage.ts` (D33); `burst-throttle.ts` + test (D25); `function-recycle.ts` + test (D27); `account-settings.ts` + test (D25); `request-count.ts` + test (D25); `kill-switch.ts` (imports D33's helpers); `index.ts` |
| `apps/ingest` | `ingest.config.ts` (optional `SIMULATOR_SECRET_ARN`), `main.ts` (passes it as `simulatorSecretId`), `create-ingest-handler.test.ts` |
| `apps/api` | `main.ts` (`SqsDlqAdapter` from `DLQ_URL` and `QUEUE_URL`, D9) |
| `apps/local` | `main.ts` (passes `InProcessQueueAdapter` as `dlq`; the static reader's record, D13); `sdk-contract.int.test.ts` |
| `apps/cli` | `commands/dlq-list-messages.cli.ts` + test, `commands/dlq-start-redrive.cli.ts` + test; `create-program.ts` (the `dlq` group) |
| `infra` | `src/app.stack.ts` (three alarms, descriptions, simulator secret, DLQ IAM, `SimulatorSecretArn`); `src/guardrails.stack.ts` (the kill-switch alarm's description); `src/infra.config.ts` and `src/main.ts` (`ledger:simulator`); `src/function-env.ts`; `src/runbook-links.test.ts` (new, D20); `app.stack.test.ts`, `guardrails.stack.test.ts`; `scripts/ledger-stacks.ts` (re-exports `@ledger/aws`), `scripts/deploy-env.schema.ts`, `scripts/run-deploy.ts`, `scripts/deploy.ts`, `run-deploy.test.ts` |
| `sim` | `read-sim-flags.ts` (+ new `read-sim-flags.test.ts`); `live-run.ts` (settle bound, invariant-4 line); `aws-run-guard.ts`, `burst-run.ts`, `paced-sender.ts`, `db-outage-run.ts`, `poison-run.ts`; `invariants/invariant-4.ts` + test; `main.ts`; `main.e2e.test.ts`; `package.json` (`"@ledger/aws": "workspace:*"`) |
| `docs` | `runbook.md` (new, D19) |

### Kernel

#### D1 — `DlqPort`

`packages/shared/src/dlq.port.ts`:

```ts
export type DlqRawMessage = { readonly body: string; readonly receiveCount: number };
export type DlqSample = { readonly depth: number; readonly messages: readonly DlqRawMessage[] };
export type RedriveStart =
  | { readonly status: 'started'; readonly depth: number }
  | { readonly status: 'empty'; readonly depth: 0 };
export interface DlqPort {
  sample(limit: number): Promise<DlqSample>;   // never deletes, never hides a message
  startRedrive(): Promise<RedriveStart>;       // throws LedgerError('redrive_in_progress')
}
```

`depth` is visible plus in flight, the same sum `health.get` reports
(`QueueSnapshot.dlqVisible + dlqInFlight`). The port returns raw bodies, and parsing is the reader's
job (D5), so no adapter knows the envelope. Rejected: one port per call, and an adapter that parses
payloads.

#### D2 — Stack names move to `@ledger/aws`

`APP_STACK_NAME`, `GUARDRAILS_STACK_NAME`, `appOutputKeys`, `guardrailsOutputKeys`,
`USAGE_TRIP_ALARM_NAME` and `KILL_SWITCH_ERRORS_ALARM_NAME` move to
`packages/aws/src/ledger-stacks.ts`, which adds `QUEUE_AGE_ALARM_NAME`, `DLQ_DEPTH_ALARM_NAME`,
`API_5XX_ALARM_NAME` (D17), `appOutputKeys.simulatorSecretArn` (D12) and
`API_FUNCTION_NAME = \`${APP_STACK_NAME}-api\`` (the read API's physical name as
`infra/src/app.stack.ts:92-97` derives it; no output names it). `infra/scripts/ledger-stacks.ts`
re-exports them and keeps `MONTHLY_BUDGET_NAME`, `PROJECT_TAG` and `LOG_GROUP_PREFIXES`. `infra/src`
imports the alarm names and `APP_STACK_NAME` from `@ledger/aws` (`infra/src/main.ts:23` drops its
own `'LedgerApp'` literal), so the template and the sim cannot disagree. Tests keep their literals:
they pin the name. Why: `sim` needs the names and must not import `infra`.

### Local and in-process

#### D3 — `InProcessQueueAdapter` implements `DlqPort`

`sample(limit)` returns the dead list's first `limit` entries, `depth` = the dead list's length
(nothing is in flight on it). `startRedrive()` moves every dead entry back to the waiting list with
its receive count reset, then answers `started` with the count moved, or `empty`. It is synchronous,
so it never answers `redrive_in_progress`.

The shared contract suite `packages/shared/src/testing/dlq-port-contract.ts`
(`dlqPortContract(name, make)`, the naming of the existing suites) runs against it and against
`SqsDlqAdapter` over its stubbed client. It covers: sampling never removes a message; `depth` counts
what was dead-lettered; an empty redrive answers `empty`; a redrive empties the dead store. `make`
returns the port plus a `deadLetter(body)` seeding hook, which the SQS side implements over its stub.

### AWS adapters (`packages/aws`)

#### D4 — `SqsDlqAdapter`

`sqs-dlq.adapter.ts`, constructed with the SQS client, the DLQ URL and the source queue URL. It reads
each queue's ARN once with `GetQueueAttributes` (`QueueArn`) and caches it per instance.

- `sample(limit)`: one `GetQueueAttributes` (`ApproximateNumberOfMessages`,
  `ApproximateNumberOfMessagesNotVisible`) for `depth`, then one `ReceiveMessage` with
  `MaxNumberOfMessages: limit`, **`VisibilityTimeout: 0`**, **`WaitTimeSeconds: 1`** and
  `MessageSystemAttributeNames: ['ApproximateReceiveCount']`. It never calls `DeleteMessage`.
  Visibility 0 means an inspect never hides a message from a following redrive or from the depth.
  The 1-second long poll queries all servers, where a short poll samples a subset and can return
  nothing from a small queue (AWS-59, AWS-50).
- `startRedrive()`: `ListMessageMoveTasks` (`SourceArn`: the DLQ ARN, `MaxResults: 1`). A `RUNNING`
  result → `throw new LedgerError('redrive_in_progress')`, no start sent (AWS-60). Otherwise read the
  depth; at `0` → `empty`, no start. Above `0`, confirm it with one `ReceiveMessage`
  (`MaxNumberOfMessages: 1`, `VisibilityTimeout: 0`, `WaitTimeSeconds: 1`, as `sample` receives,
  AWS-59; it adds to the receive count, AWS-50): no message → `empty`, no start. The approximate
  attributes lag a just-completed move: measured on the deployed stack (2026-10-19), a second
  redrive 1.5 s after the first found its task `COMPLETED` while the depth still read 1, and started
  a second task that moved nothing. Otherwise `StartMessageMoveTask` with the DLQ ARN as `SourceArn`
  and no `DestinationArn`, which redrives to each message's original source queue → `started` with
  the depth. The `TaskHandle` is dropped: it embeds the source queue ARN and the account id (AWS-61).
  Any SDK error propagates unchanged, so a racing second start's error (AWS-U14) surfaces as
  `internal_error`, never as a second task, which SQS forbids (AWS-21).

Rejected: mapping a `StartMessageMoveTask` error to `redrive_in_progress`. The API Reference names no
"task already running" error, so the check runs first and the start's own error stays an error.

### Read API (`packages/api`)

#### D5 — `ListDlqMessagesReader` and its mapper

`execute({ limit })` → `DlqPort.sample(limit)`, then for each raw message:

1. Parse the body with `ingestEnvelopeSchema` (`@ledger/core`). On failure, every item field except
   `receive_count` is `null`.
2. `svix_id` ← `envelope.svixId`; `enqueued_at` ← `envelope.receivedAt`.
3. `JSON.parse(envelope.rawBody)` in a `try`, then read exactly three paths, each `null` unless it is
   a string: top-level `type`, top-level `created_at` → `event_created_at`, `data.email_id` →
   `email_id`. **No other path is read.** The parsed value is dropped inside the reader and never
   reaches the mapper.
4. `receive_count` ← the adapter's count.
5. Items with the same non-`null` `svix_id` collapse to the first, since a visibility-0 receive can
   return a message twice. `null`-id items are kept.

Wire (`200`):

```json
{ "object": "list", "has_more": false, "depth": 1,
  "data": [ { "object": "dlq_message", "svix_id": "msg_…", "type": "email.delivered",
              "email_id": "…", "event_created_at": "2026-10-19T12:00:00.000Z",
              "enqueued_at": "2026-10-19T12:00:01.000Z", "receive_count": 6 } ] }
```

`has_more` is `depth > data.length`. `depth` sits beside Resend's list envelope, with no cursor
(a sample). It is `max(sample depth, items)`: the approximate attributes can read 0 while the receive
returns the message (AWS-62), and a depth below the items would make the CLI print `empty` above
them (found in `wf-after-apply-check`). An adapter error → `500 internal_error` with the error as `cause`, as
`GetHealthReader` does (`packages/api/src/get-health.reader.ts:44-49`). The reader and the adapter
log nothing new; `internal_error` logs the error's name only.

#### D6 — `limit` validation

Integer 1–10, default 10. Out of range or not an integer → `400 validation_failed` with the message
**`limit must be an integer from 1 to 10.`** `create-api.ts`'s `fieldErrors.limit` ("1 to 100") is
keyed by field, so the DLQ route carries a route-scoped override.

#### D7 — `StartDlqRedriveCommand`

`execute()` → `DlqPort.startRedrive()`. `started` → **`202`**
`{ "object": "dlq_redrive", "status": "started", "depth": 3 }`; `empty` → **`200`**
`{ "object": "dlq_redrive", "status": "empty", "depth": 0 }`; a thrown `redrive_in_progress` → `409`
in the error shape. Scope `operate`. It opens no transaction: it writes nothing to Postgres, like
`ResumeEventSourceCommand`. The `202` and `200` bodies are built by `dlq-redrive-response.mapper.ts`,
as the resume route's are by `event-source-response.mapper.ts` (pp-backend → Gate: "every response
built by a `.mapper.ts`").

#### D8 — Errors

No new code. `redrive_in_progress` uses the registry's message and hint verbatim, and its `docs`
link stays the AWS redrive page. The codes each route raises are in
[Error codes raised](#error-codes-raised).

#### D9 — Composition and IAM

`ApiDeps` gains `dlq: DlqPort`. `apps/api/src/main.ts` builds `SqsDlqAdapter` from `apiEnv.DLQ_URL`
and `apiEnv.QUEUE_URL` (both already set; no new variable), with the client from `@ledger/aws`'s
factory. `apps/local/src/main.ts` passes its `InProcessQueueAdapter` (D3).

IAM on the read API (owner-approved): `sqs:ReceiveMessage`, `sqs:DeleteMessage`,
`sqs:StartMessageMoveTask` and `sqs:ListMessageMoveTasks` on the DLQ, and `sqs:SendMessage` on the
source queue, the documented minimum for a redrive to the source queue (AWS-60).
`sqs:GetQueueAttributes` on both already exists. `DeleteMessage` is in that minimum because SQS
moves messages on the caller's permissions; the API's own code never calls it, which
`sqs-dlq.adapter.test.ts` pins. Both queues are SSE-SQS (AWS-25), so no `kms:*` grant applies.

### SDK and CLI

#### D10 — SDK and CLI

SDK: `ledger.dlq.listMessages({ limit }?)` → `GET /dlq/messages` and `ledger.dlq.startRedrive()` →
`POST /dlq/redrive`, both `{ data, error }`, `REQUEST_TIMEOUT_MS`, no retries (slice 5's).
`FakeLedgerClient` grows both. `pnpm openapi:export` regenerates `packages/sdk/openapi.json` and
`src/openapi-types.ts`; the `drift` stage checks them.

CLI: a `dlq` group on the root in `create-program.ts`. `commands/dlq-list-messages.cli.ts`
(`ledger dlq inspect [--limit <1-10>] [--json]`, `--limit` through an integer `argParser`; the range
is the API's) and `commands/dlq-start-redrive.cli.ts` (`ledger dlq redrive [--json]`, no `--no-wait`).
Layouts in [Surfaces](#surfaces).

### Simulator secret

#### D11 — `LEDGER_SIMULATOR`, a persistent public variable

`on` | `off`, default `off`, parsed by `infra/scripts/deploy-env.schema.ts` next to
`LEDGER_KILL_SWITCH`. It passes CDK context `ledger:simulator` (`true` | `false`, default `false`)
through `infra.config.ts`. With `on`, the deploy asserts `LEDGER_SIMULATOR_SECRET` against the
signing-secret regex (RS-02's `whsec_` form, the one `LEDGER_DEPLOY_WEBHOOK_SECRETS` uses) before
contacting AWS, and refuses naming it. A variable, not a deploy flag: it is the owner's standing
deployment shape, like the kill switch, and a flag forgotten on one redeploy would silently drop the
secret mid-demo.

#### D12 — CDK

With `ledger:simulator=true` only: one `Secret` (`description` beginning
`ledger/simulator-signing-secret`, no physical name, `RemovalPolicy.DESTROY`, no value), `grantRead`
to ingest only, and ingest's environment gains `SIMULATOR_SECRET_ARN` from a second names object,
`ingestSimulatorEnv = { SIMULATOR_SECRET_ARN }`, in `packages/shared/src/function-env.ts` (mirrored in
`infra/src/function-env.ts`). Output `SimulatorSecretArn` only with the flag.

Template tests, synthesized both ways: without the flag, two secrets and no `SIMULATOR_SECRET_ARN`
anywhere in ingest's environment or any policy; with it, three secrets, ingest's keys equal
`ingestEnv ∪ ingestSimulatorEnv`, and only ingest's role reads the third.

#### D13 — Ingest reads it through the port

`IngestDeps.simulatorSecret: string | undefined` becomes `simulatorSecretId: string | undefined`.
`readCandidates` reads it through the same `SecretReaderPort`, under the same 5-minute cache, after
the Resend set. The value is one `whsec_` string, parsed with the signing-secret regex. A failed or
unparseable read fails the whole read, so every request answers `503`, never `401`: an unreadable
secret is an infrastructure fault Resend retries (RS-09, RS-10).

`StaticSecretReaderAdapter` takes a record of id → value (it still rejects an unknown id), so
`apps/local` serves both ids from its parsed config. `apps/ingest/src/ingest.config.ts` makes
`SIMULATOR_SECRET_ARN` optional, and `main.ts` passes it as `simulatorSecretId`, replacing the
`undefined` at `:29-30`.

Tests (`create-ingest.test.ts`): `simulatorSecretId` absent → a simulator-signed request answers
`401`, nothing enqueued (the Ships 3 test); present → stamped `simulated` (the existing test,
rewired); an unreadable simulator secret → `503`, nothing enqueued.

### Infra

#### D14 — Alarm actions reach email through the alert topic

The app stack builds the `LedgerGuardrails-alert` ARN with `formatArn` from
`alertTopicName(props.guardrailsStackName)`, as the usage trip builds the trip topic's
(`infra/src/app.stack.ts:242-246`). Never a cross-stack import. The topic policy already lets
`cloudwatch.amazonaws.com` publish, and the owner's subscription is confirmed (PP §4).

#### D15 — Actions on `ALARM` only

No OK action: one email per incident; the alarm returns to OK on its own.

#### D16 — `TreatMissingData: notBreaching`

On every new alarm: an idle queue stops delivering metrics after six hours (AWS-22).

#### D17 — Three new alarms

Five in total with the usage trip and the kill-switch errors, within AWS-28's ten free.

| Name | Metric | Statistic, period, evaluation | Threshold | Why |
| --- | --- | --- | --- | --- |
| `LedgerApp-queue-age` | SQS `ApproximateAgeOfOldestMessage`, source queue | `Maximum`, 300 s, 1 period | `> 900` s | A paused worker fires it (ADR-015). It fires within ≈ 20 min of a pause, inside the card's hour. A 10k drain past 15 min fires it once, which the runbook names as expected after a burst; the burst's `settled … after <s>s` line measures the drain. Poison messages are excluded from the metric (AWS-22) |
| `LedgerApp-dlq-depth` | SQS `ApproximateNumberOfMessagesVisible`, DLQ | `Maximum`, 300 s, 1 period | `> 0` | AWS-22; J4's trigger |
| `LedgerApp-api-5xx` | HTTP API `5xx` (`metricServerError`) | `Sum`, 300 s, 1 period | `> 0` | A `5xx` to Resend is a failed delivery that Resend retries and that can auto-disable the endpoint (RS-10, RS-11), and it is how a throttled ingest Lambda surfaces. Vended and free (AWS-30). A read-API `503` during an outage fires it too, which the runbook explains |

Constants live in `infra/src/app.stack.ts` beside the usage trip's, each citing its fact. One
`Template` assertion per alarm covers its metric, dimensions, statistic, period, threshold,
comparison, missing data and its one action. The existing "Alarms within the free count" assertion
still holds.

#### D18 — Every alarm carries its runbook link

`AlarmDescription` = `<one line of what fired>. Runbook: ${RUNBOOK_BASE_URL}#<slug>`, on all five
(the two from slice 2 included). The slug is the GitHub anchor of the alarm's runbook heading
(`### LedgerApp-queue-age` → `#ledgerapp-queue-age`). `RUNBOOK_BASE_URL` comes from `@ledger/core`,
which `infra` already imports. No description holds an ARN, account id or address (CBL-01).

#### D19 — `docs/runbook.md`

Tracked, public, tight; no account id, deployed URL, address or secret. It opens with one line
restating "Not affiliated with Resend".

- `## Alarms`: one `###` per alarm, heading text exactly the alarm's name (`LedgerApp-queue-age`,
  `LedgerApp-dlq-depth`, `LedgerApp-api-5xx`, `LedgerApp-usage-trip`,
  `LedgerGuardrails-kill-switch-errors`). Each entry has four labelled lines: **Means**, **First**
  (the first command, e.g. `pnpm -s ledger health`), **Then** (the decision steps, naming the
  `ledger` or `pnpm aws:*` command) and **Related** (the ADR or `AWS-NN`).
- `## Error codes`: one `###` per code whose registry `docs` is the runbook: `unauthorized`,
  `forbidden`, `validation_failed`, `email_not_found`, `recipient_not_found`, `run_not_found`,
  `token_not_found`, `route_not_found`, `reconcile_in_progress`, `last_operate_token`,
  `run_abandoned`, `database_unavailable`, `internal_error`, `api_unavailable`. The same four lines;
  slice 4's codes say slice 4 lands their operation. Slice 7 completes the runbook.

The `RUNBOOK_BASE_URL` comment at `packages/core/src/error-codes.ts:31-33` drops "these links 404
until then".

#### D20 — The alarm-to-runbook link check

`infra/src/runbook-links.test.ts`, unit tier, so `pnpm check` and the `unit` stage run it, with no CI
change. It synthesizes both stacks (kill switch on, simulator on) and reads `docs/runbook.md`
headings into GitHub slugs (lowercase, spaces → `-`, punctuation other than `-` and `_` dropped). It
asserts:

1. every `AWS::CloudWatch::Alarm` in both templates has an `AlarmDescription` containing
   `Runbook: ${RUNBOOK_BASE_URL}#<slug>`, and that slug is a heading;
2. every `errorRegistry` entry whose `docs` starts with `RUNBOOK_BASE_URL` points at a heading;
3. a canary: a fabricated alarm description with an unknown slug is rejected by the same checker
   function, so a checker that passes everything fails.

It also runs `node scripts/check-links.mjs docs/runbook.md` through
`spawnSync(process.execPath, …)` and expects exit `0`.

### Deploy command

#### D21 — The simulator secret write

`run-deploy.ts` writes the simulator value after `cdk deploy`, next to the signing secrets, with
`writeSecretIfChanged` and the `SimulatorSecretArn` output, only when `LEDGER_SIMULATOR=on`. CDK gets
`-c ledger:simulator=true|false`. After `KillSwitchArmed` it prints `aws:deploy: simulator on` or
`aws:deploy: simulator off`, never the value. Tests (`run-deploy.test.ts`, fake steps): `on` without
`LEDGER_SIMULATOR_SECRET` refuses before any AWS call, naming the variable; `on` passes
`ledger:simulator=true` and writes the secret; `off` passes `false` and writes none; no output line
holds the fake secret value. A secret value reaches Secrets Manager from the deploy script, never
through CDK (CBL-01).

### Simulator

#### D22 — The settle bound scales with the run

`30 s + 100 ms × generated events`: 30 s for today's histories, 1,030 s (≈ 17 min) for 10,000
events. It polls every 250 ms, or every 2 s once the bound exceeds 60 s (each poll is one
`countPresent` over the run's ids). At the bound it fails with
`sim: not settled after <bound>s (<present>/<generated> stored)` and exit `1`. A poison run settles
over the non-poisoned ids only (D27).

#### D23 — AWS runs and their guard

`--burst`, `--chaos db-outage` and `--poison` make a run an **AWS run**. Without `LEDGER_URL` it exits
`2` with `sim: <flag> needs a live run against the deployed stack: load .env.deployed.local`. It reads
the `LedgerApp` and `LedgerGuardrails` outputs through `@ledger/aws` (D2), then refuses with exit `1`,
before sending anything:

- `LEDGER_URL` (trailing slash ignored) is not `ApiUrl` →
  `sim: LEDGER_URL is not the deployed LedgerApp API; load .env.deployed.local`;
- tripped (`readKillSwitchState`) → `sim: the stack is tripped; run pnpm aws:rearm first`;
- `KillSwitchArmed` not `true` →
  `sim: the kill switch is not armed; AWS runs need the owner's armed deployment`;
- DLQ depth not 0 → `sim: the DLQ holds <n> messages; inspect and redrive them first`;
- the `LedgerApp` outputs hold no `SimulatorSecretArn` →
  `sim: the deployed stack has no simulator secret; set LEDGER_SIMULATOR=on and run pnpm aws:deploy`.
  Without it ingest answers every simulator-signed request `401` (D13), so a burst would raise the
  throttle and spend 10,000 requests to fail. The output is already read for `ApiUrl`, so the check
  costs nothing (lens clause 1: the run scripts its own preconditions). Kept, owner-ruled 2026-10-19.

The three knobs exclude each other and `--duplicates`; a combination exits `2` naming the pair.
`--shuffle` combines with any. The plain `--duplicates 0.2 --shuffle` run is unchanged, works against
any `LEDGER_URL`, deployed included (Ships 7), and prints
`invariant 4 not checked (AWS runs check it: --burst, --chaos or --poison)`.

`sim/src/aws-run-guard.ts` holds the guard over injected readers, so its unit test needs no AWS.

#### D24 — Invariant 4

`sim/src/invariants/invariant-4.ts` exports `invariant4(dlq: DlqPort, poisoned: ReadonlySet<string>)`.
It calls `dlq.sample(10)` up to 10 times, collecting distinct `svix_id`s from the parsed envelopes,
until the collected count equals the latest sample's `depth`; each sample re-reads the depth, which
is approximate and can under-read a message the receive already returns (AWS-59, AWS-62). Pass iff `depth === poisoned.size`, every collected id is in `poisoned`,
and every poisoned id was collected. Lines: `invariant 4 pass (dlq holds exactly the <n> poisoned)`,
or `invariant 4 fail depth=<d> poisoned=<p> collected=<c> stray=<up to 5 svix_ids>` (ids and counts
only). The sim builds an `SqsDlqAdapter` from the stack's `DlqUrl` and `QueueUrl`.
`invariant-4.test.ts` covers it over the in-process adapter (D3).

#### D25 — `--burst <events>/<seconds>s`

Parses `^(\d+)\/(\d+)s$`, `1 ≤ events ≤ 10000`, `1 ≤ seconds ≤ 600`; anything else exits `2`. Order:

1. D23's guard.
2. **Quota preflight (AWS-U05's burst half):** `account-settings.ts` reads
   `lambda:GetAccountSettings` → `AccountLimit.ConcurrentExecutions`. Below
   `BURST_MIN_ACCOUNT_CONCURRENCY = 1000`, refuse with
   `sim: the account's Lambda concurrency quota is <q>; the burst needs at least 1000 (AWS-U05): request an increase in Service Quotas`.
   Why 1,000: the default regional quota (AWS-16); 1,000 rps × up to 1 s per cold ingest invocation,
   plus `MaximumConcurrency` 5 and the read API, needs headroom on that order.
3. **Usage-trip headroom:** `request-count.ts` reads one `DescribeAlarms` of `USAGE_TRIP_ALARM_NAME`
   for its `Namespace`, `MetricName`, `Dimensions`, `Period` and `Threshold` (so the sim never
   derives the HTTP API's id or copies a constant), then `GetMetricStatistics` of that metric, `Sum`
   over the last `Period` seconds. That sum plus `events` must not exceed `Threshold`; otherwise
   refuse with
   `sim: <n> requests in the last 15 minutes plus the burst would trip LedgerApp-usage-trip; wait and retry`.
   Any one-`Period` window holding the burst holds at most the last `Period` seconds of earlier
   traffic, so the bound is conservative.
4. **Raise the throttle** to `BURST_THROTTLE = { rateLimit: 1200, burstLimit: 2400 }` with
   `burst-throttle.ts`'s `raiseDefaultThrottle`, which records the value it set. `finally` calls
   `restoreDefaultThrottleIf(raised, declared)`: it restores the declared throttle
   (`ThrottleRateLimit` and `ThrottleBurstLimit` outputs) **only if** the stage still reads the
   raised value; otherwise it sends no update and prints
   `throttle left at <rate>/<burst>: changed during the burst (a trip?)`. Why 1,200/2,400: 1.2× the
   mean rate, and two seconds of tokens, so a best-effort throttle (AWS-14) does not reject a paced
   burst.
5. **Generate:** `burstHistory({ seed, namespace, events })` in `@ledger/core/testing`:
   broadcast-shaped emails, **one distinct recipient each**, cycling over the RS-39 test addresses as
   `<local>+<namespace>-b<i>@resend.dev`, each email carrying its address's observed sequence
   (`testAddressSequences`). The last email takes a prefix of its sequence so the total is exactly
   `events`. Seeded and deterministic.
6. **Storage before:** `databaseRepository.storageBytes` (`pg_database_size`).
7. **Send paced** (`paced-sender.ts`): request `i` is due at `t0 + i × seconds/events`, at most 512
   in flight, each signed at send time (RS-02's tolerance window), no retry. It records each
   request's client-observed latency (send to response body read). A non-`200` or a timeout is not
   accepted, and the run then exits `1` after reporting.
8. `finally` restores the throttle (step 4).
9. Settle (D22), storage after, invariants 1, 2 and 4 (nothing poisoned).
   `bytes_per_event = (after − before) / events`, and
   `bursts_left = ⌊(STORAGE_LIMIT_BYTES − after) / (after − before)⌋`.

The burst prints `projection not printed (--burst)` in place of the projection JSON.

#### D26 — RS-U08 and the p99

RS-U08 closes when the burst's client-observed p99 is under **5 s**, a third of Svix's 15 s timeout
(RS-10). Client-observed latency includes the owner's round trip, so it is an upper bound on what
Resend sees. The row records p50 and p99, the command and the date. Published numbers are slice 9's.
CBL-21's lone cold delivery stays separate.

#### D27 — The two faults

**`--chaos db-outage`** (`db-outage-run.ts`) repoints the database without touching Neon:

1. D23's guard, plus a refusal when the worker's event source is already paused.
2. Read `ledger/database` (`DatabaseSecretArn`) through `SecretsManagerSecretReaderAdapter`. Write
   the same JSON with `pooledUrl`'s host replaced by **`ledger-sim-db-outage.invalid`** through
   `secret-writer`. `.invalid` never resolves (RFC 2606), so every connect fails `ENOTFOUND` under a
   pg origin, which the classifier counts as connection-class
   (`packages/db/src/classify-database-error.ts:24-36,69`). Port, user and database are unchanged.
   The value is held in memory only, never printed or written to disk.
3. **Recycle** the worker (`WorkerFunctionName`) and the read API (`API_FUNCTION_NAME`) with
   `function-recycle.ts`: `UpdateFunctionConfiguration` with `Description`
   `ledger-sim db-outage <namespace>`, then wait for `LastUpdateStatus: Successful`. The template
   sets no description, so this is cosmetic drift. Whether this sends later invocations to new
   environments is AWS-U15.
4. Send the history; print `sent requests=<k> accepted=<k> first_attempt_200=<k>`. Ships 5 requires
   all `200`, because ingest never touches the database (ADR-001).
5. Wait, bounded 10 min, for the event source to read `paused`; print `worker paused after <s>s`.
6. Hold, bounded 45 min, until `LedgerApp-queue-age` reads `ALARM` (`alarmControl.readState`),
   checking DLQ depth 0 during the hold; print `queue-age alarm ALARM after <m>m; dlq depth 0`.
7. `finally`, also on failure: write the original value back if the secret still holds the
   `.invalid` host, then recycle both functions with `Description` `""`; print
   `chaos db-outage: database restored, worker and api recycled`. Each of the three steps is
   attempted whatever the others did, because both functions read the secret once per container. If
   the write back fails, print
   `sim: the database secret was not restored; run pnpm aws:deploy, which rewrites it` and exit `1`;
   if only a recycle fails, print
   `sim: the database secret is restored, but recycling the <worker|api> failed; its containers that read the outage host keep it until recycled`
   and exit `1` (a deploy that finds the secret unchanged recycles nothing).
8. Print `resume: pnpm -s ledger worker resume, or wait for the hourly resume`. Wait, bounded 65 min,
   for `enabled` (the hourly cron needs no human); print `worker enabled after <m>m`; settle (D22);
   invariants 1, 2 and 4 (DLQ 0).

Rejected: disabling Neon's endpoint through its API (a new owner credential and integration, and its
error is undocumented, so it may not classify); `NOLOGIN`, a password change or `CONNECTION LIMIT 0`
on the runtime role (`28000`, `28P01`, `53300` are not connection-class, so messages would drain to
the DLQ, the failure the run exists to rule out).

**`--poison <n>`** (1–10, so the poisoned set fits one inspect sample; `poison-run.ts`) is a real
unexpected error that enters through ingest:

1. D23's guard.
2. Pick `n` events, seeded (`deriveSeed`), never from the walk probe email, and give each a marked
   id, `POISON_ID_PREFIX` (`simpoison_`) + `<namespace>_<k>`, in the generated history before
   anything is sent, so the ground truth, the send and invariant 4 all carry the marked id. Print
   `poison count=<n> svix_ids=<…> email_ids=<…>`.
3. **Add the fault** through `DATABASE_URL` with `@ledger/db/testing`'s `removePoisonFault`
   (`ALTER TABLE webhook_events DROP CONSTRAINT IF EXISTS ledger_sim_poison`, so a leftover goes
   first) then `addPoisonFault(db)`:
   `ALTER TABLE webhook_events ADD CONSTRAINT ledger_sim_poison CHECK (NOT starts_with(svix_id, 'simpoison_')) NOT VALID`.
   Both statements are constants: no runtime value reaches the SQL, which pp-database → Never
   requires ("`sql.raw` with a runtime value → the `sql` template"), and DDL cannot bind a parameter.
   Only the sim mints a `simpoison_` id: Resend's ids are `msg_…`, and the sim's others are
   `<namespace>-svix-…`, whose namespace (`[a-z0-9-]`) holds no `_`. Rejected: the PP's
   `CHECK (svix_id NOT IN (<ids>))` with a per-run constraint name, which inlines escaped runtime
   values into DDL and would need an exception to that rule (owner-ruled 2026-10-19: keep the
   marker). A poisoned insert fails `23514`, not
   connection-class, so it follows ADR-008 per message while the others commit. A `42501` →
   `sim: --poison needs DATABASE_URL to own webhook_events (the owner's pooled URL, not the runtime role's)`,
   exit `1`, nothing sent.
4. Send; settle every non-poisoned id (D22); then wait, bounded 40 min, for the DLQ depth to reach
   `n`. SQS moves a message once its receive count exceeds `maxReceiveCount` (AWS-09), so the move
   comes on the sixth receive, after five 360 s visibility timeouts (AWS-08): ≈ 30 min.
5. Report `others stored <k>/<k> exactly once (<n> poisoned wait in the DLQ)` (it fails the run like
   an invariant when short), then `invariant 1 not checked (<n> poisoned events wait in the DLQ)`,
   `invariant 2 not checked (<n> poisoned events wait in the DLQ)`, and invariant 4. Invariants 1
   and 2 are over every generated event, and the poisoned ones are not stored yet; a pass over a
   subset would be one the run did not earn. The poisoned event's commit after the redrive is the
   walk's `ledger email` step (P4).
6. **The fix:** `removePoisonFault` (`finally` also runs it on any failure), then print
   `poison fixed; next: pnpm -s ledger dlq inspect, then pnpm -s ledger dlq redrive; the depth returns to 0 in pnpm -s ledger health`.

The operator then walks J4 by hand. Rejected: a fault seam in the worker (fake evidence), and an SQS
send of a malformed envelope (ADR-016 rejects bypassing ingest, and it could never be fixed).

#### D28 — Exit codes and output

Unchanged: `0` iff every request sent was accepted and every checked invariant passed (the poison
run's `others stored` line counts as one); `1` otherwise or on a refusal; `2` on a flag or
configuration error. Every line is ids, counts, durations, and throttle or quota numbers only, never
an address, URL, ARN, secret or payload.

### `[Unverified]` rows and facts

#### D29 — AWS-U05

The row records the quota read in slice 2's walk (50), then the burst half: the preflight's reading
after the owner's increase, with the date. "Safe for the deploy" stands.

#### D30 — PG-U07 (owner-ruled 2026-10-19)

Settled from Neon's published source: `neon_extend` and `neon_zeroextend` raise
`ereport(ERROR, (errcode(ERRCODE_DISK_FULL), errmsg("could not extend file because project size limit (%d MB) has been exceeded", …)))`
([pagestore_smgr.c](https://github.com/neondatabase/neon/blob/main/pgxn/neon/pagestore_smgr.c), read
2026-10-19). `ERRCODE_DISK_FULL` is SQLSTATE `53100`, an ordinary `ErrorResponse` that `pg` surfaces
as a statement error carrying `code`. The classifier already lists it
(`classify-database-error.ts:19-22`) and its unit test pins it. The row moves to settled, citing the
source and the test; the classifier's comment is updated. The burst's storage reading (D25 steps 6
and 9) is "that measurement". The card's wording widens per the owner's ruling.

#### D31 — New facts and rows

Written into aws.md, each with its page and the date 2026-10-19:

- **AWS-59**: long polling queries all servers; a short poll samples a subset (D4).
- **AWS-60**: the redrive's minimum IAM permissions; `ListMessageMoveTasks` returns the most recent
  ≤ 10 tasks with `Status` (`RUNNING` and the terminal values) and a `TaskHandle` on a running task.
- **AWS-61**: a `TaskHandle` embeds the source queue ARN, account id included.
- **AWS-U14**: the error a racing second `StartMessageMoveTask` raises. Proved safe either way by
  `sqs-dlq.adapter.test.ts`: a `RUNNING` task refuses before any start, and a scripted start error
  propagates unchanged as `internal_error`, never as a second task, which SQS forbids (AWS-21).
- **AWS-U15**: a configuration update sends later invocations to new execution environments. Settled
  by the P3 run's `worker paused after <s>s` line. If it does not recycle, the run fails at D27 step
  5's bound and restores, and no event is lost.

### Build-level choices (not in the PP)

#### D32 — `@ledger/db/testing` loads under plain `node`

`sim` imports `addPoisonFault` and `removePoisonFault` from `@ledger/db/testing` (pp-general →
boundaries rule 12 allows `/testing` imports in `sim`). `testing.ts` imports `inject` from `vitest` at
module load, and `pnpm sim` is plain `node`, so that import would make every `pnpm sim` fail. The
fix: `createTestDatabase` loads it with `const { inject } = await import('vitest')`, the only use;
every other import in `testing.ts` (`pg`, `drizzle-orm`, `@testcontainers/postgresql`, installed in
the workspace) loads under `node`. The fault helpers live in `packages/db/src/testing/poison-fault.ts`
and are re-exported from `testing.ts`. `sim/src/main.e2e.test.ts` spawns `node` on `main.ts`, so a
load-time Vitest import fails every e2e case: that is the regression test.

Rejected: a second package entry (`@ledger/db/testing/poison-fault`), which widens the package's
surface for one caller, and moving the helpers into `@ledger/db`'s main entry, which would ship a
fault injector in the runtime package.

#### D33 — The stage helpers are shared

`readStage` and `withThrottle` move from `kill-switch.ts` into `packages/aws/src/http-api-stage.ts`
(internal to the package, not exported from `index.ts`). `kill-switch.ts` and `burst-throttle.ts`
both import them, so the burst reads and writes the stage exactly as the kill switch does. Behaviour
of the kill switch is unchanged; `kill-switch.test.ts` passing untouched is the check.

### Evidence map

Every reliability claim this slice makes, and the test that proves it (PP §20). `pnpm verify` runs
every unit, property and integration row, the `drift` stage, `synth` and the README link stage. It
cannot see the deployed stack (the five runs, the alarm emails, the quota, AWS-U14/U15 observations,
RS-U08's number), which the walk records.

| Claim | Test (tier) | Fails if removed |
| --- | --- | --- |
| Inspect never removes or hides; one redrive at a time; empty starts nothing (Ships 2) | `packages/aws/src/sqs-dlq.adapter.test.ts` (unit, stubbed client): `ReceiveMessage` with `VisibilityTimeout: 0`, `WaitTimeSeconds: 1`, `MaxNumberOfMessages: limit`, never `DeleteMessage`; `RUNNING` → `redrive_in_progress`, no start sent; depth 0 → `empty`, no start; otherwise `StartMessageMoveTask` with the DLQ's `SourceArn` and no `DestinationArn`; no `TaskHandle` in the result; a scripted start error propagates unchanged and no second start is sent (AWS-U14). Status and error names cited from the API Reference. Plus `dlqPortContract` run here and by `in-process-queue.adapter.test.ts` | The visibility; the `RUNNING` check; the empty check |
| Redaction; unreadable message listed; `limit` (Ships 2) | `packages/api/src/list-dlq-messages.route.int.test.ts` (int): a dead message whose raw body names `delivered@resend.dev` in `to` and `from` and carries a subject → the response text holds neither, and no item holds another key; a malformed body → `null` fields with a `receive_count`; `limit` 0 and 11 → `400` with D6's message; `has_more` and `depth`; a duplicate `svix_id` collapses | The path restriction; the `null` fallback |
| Scope; status mapping (Ships 2) | `packages/api/src/start-dlq-redrive.route.int.test.ts` (int, real auth middleware): `401`, `403` with `read`, `202 started`, `200 empty`, `409 redrive_in_progress` in the error shape | The scope check; the mapping |
| A redriven event applies once (Ships 6) | Existing `packages/worker/src/record-event.command.int.test.ts` (a copy under a new `messageId` leaves one row). New `packages/worker/src/poison-isolation.int.test.ts` (int, real Postgres, in-process queue, `addPoisonFault` with one event's `svix_id` marked `simpoison_`): after `maxReceiveCount` receives that message is dead-listed while every other committed; after `removePoisonFault` and the in-process redrive it commits once | Per-message failure; the fault helpers |
| SDK ↔ API agree (Ships 2) | `apps/local/src/sdk-contract.int.test.ts` and `apps/api/src/api-lambda-contract.int.test.ts` (int): `readApiContract` grows both DLQ methods' success and error cases | Contract drift |
| SDK | `packages/sdk` method tests (unit): paths, verbs, `{ data, error }`, one request on a closed port | — |
| CLI output (Ships 2) | `apps/cli/src/commands/dlq-list-messages.cli.test.ts`, `dlq-start-redrive.cli.test.ts` (unit, `FakeLedgerClient`): `--json` documents, [Surfaces](#surfaces)' lines, the stderr notice only in human mode with depth > 0, `409` and `403` → exit `1` with the error, `--limit abc` → exit `2` with no SDK call | The output contract |
| Simulator secret, ingest half (Ships 3) | `packages/ingest/src/create-ingest.test.ts` (unit): absent id → simulator-signed `401`, nothing enqueued; present → `simulated`; unreadable → `503`, nothing enqueued. `apps/ingest/src/create-ingest-handler.test.ts` with the optional config key | The flag's ingest half |
| Simulator secret, CDK half (Ships 3) | `infra/src/app.stack.test.ts` (unit), synthesized both ways (D12) | The CDK half |
| Simulator secret, deploy half (Ships 3) | `infra/scripts/run-deploy.test.ts` (unit, D21) | The deploy half |
| Alarms and runbook (Ships 1) | `infra/src/app.stack.test.ts` (one assertion per alarm, D17), `guardrails.stack.test.ts` (the kill-switch alarm's description), `infra/src/runbook-links.test.ts` (D20, with its canary) | An alarm; a description; a heading |
| Throttle restored only if unchanged (Ships 4) | `packages/aws/src/burst-throttle.test.ts` (unit, stubbed stage): the raise records its value; `finally` restores when unchanged; **the stage's throttle changes to `0/0` mid-run → no update sent** | The conditional restore |
| AWS-run guard, flags | `sim/src/read-sim-flags.test.ts` (unit): the three flags, ranges, exclusivity; `sim/src/aws-run-guard.test.ts` (unit, injected readers): each refusal; `sim/src/main.e2e.test.ts`: an AWS knob offline → exit `2`, no network, and every existing case still passes under plain `node` (D32) | — |
| Burst history | `packages/core/src/testing/burst-history.prop.test.ts` (property): exact count, distinct recipients, determinism per seed and namespace | — |
| Invariant 4 | `sim/src/invariants/invariant-4.test.ts` (unit, in-process adapter): pass; a stray id; a missing poisoned id; a depth mismatch | — |
| Poison fault | `packages/db/src/testing/poison-fault.int.test.ts` (int): only the listed ids fail `23514`; `NOT VALID` leaves existing rows; removal restores inserts; a second add after a crash drops the leftover first; an id that merely contains `simpoison_` past its start still inserts | The prefix match |
| Settle bound | `sim/src/live-run.ts`'s bound as an exported pure function, unit-tested: 20 events → 32 s at 250 ms; 10,000 → 1,030 s at 2 s | — |
| PG-U07 | Existing `packages/db/src/classify-database-error.test.ts` pins `53100` (D30) | — |
| Deployed behaviour (Ships 4–7) | Simulator invariants 1, 2 and 4 in the recorded runs (walk P2–P6) | — |

`int` timeouts are set from measured runs.

## Data model

Not touched: no table, column, index, grant or migration. `--poison` adds a **transient**
`NOT VALID` CHECK (`ledger_sim_poison`) to `webhook_events` on the owner's database for
the length of a run and drops it in `finally`. It is a test fault: never a migration, never in the
Drizzle schema, matching only `svix_id`s that start `simpoison_`, which only a poison run mints
(D27), and dropped by the next poison run if a crash left it.

### State machines

- **Projections:** unchanged (ADR-003). A redriven event takes the ordinary path: the insert on
  `svix_id`, then the recompute under the email and recipient locks (ADR-004). A poisoned event that
  commits after the fix changes its email's projection exactly as a late arrival would.
- **Worker event source** (AWS-18): `enabled → paused` on a connection-class failure after the
  fresh-connection retry (ADR-015); `paused → enabled` on a resume whose probe succeeds (the hourly
  cron or `ledger worker resume`). D27's db-outage walks this loop on AWS.
- **A DLQ message:** source queue → (failed receive × `maxReceiveCount`) → DLQ → (redrive: a new
  message, new `messageId` and enqueue time, AWS-21) → source queue → a commit, or back to the DLQ if
  still failing.
- **A redrive task:** none → `RUNNING` → `COMPLETED` (or another terminal status, AWS-60). `RUNNING`
  makes `dlq.startRedrive` answer `409`.

## Surfaces

### `dlq.listMessages` — `GET /dlq/messages` → `ledger.dlq.listMessages()` → `ledger dlq inspect [--limit <1-10>] [--json]`

- **Actor and scope:** operator, support or reviewer, with any active token (`read` suffices).
- **`--json`:** the SDK's `data`, D5's wire object, one document on stdout.
- **Human (stdout)**, every value through `printable`, timestamps as returned (ISO-8601 UTC):

  ```text
  dlq         2 message(s), showing 2
  msg_…  email.delivered  email <email_id>  created 2026-10-19T12:00:00.000Z  enqueued 2026-10-19T12:00:01.000Z  receives 6
  msg_…  —                email —           created —                         enqueued —                         receives 7
  ```

  The first line reads `dlq         <depth> message(s), showing <n>` (`showing <n> of <depth>` when
  `has_more`), or `dlq         empty`. A `null` field prints through `printable(null)` (`—`). When the
  depth is above 0 and not `--json`, stderr gets one line:
  `why each failed is in the worker logs under its svix_id (runbook: LedgerApp-dlq-depth)`.
- **Masks:** none needed. No address, subject, display name, `from`, tag or payload field is ever in
  the response (D5); the route-level redaction test proves it.

### `dlq.startRedrive` — `POST /dlq/redrive` → `ledger.dlq.startRedrive()` → `ledger dlq redrive [--json]`

- **Actor and scope:** operator, `operate` only.
- **`--json`:** `{ "object": "dlq_redrive", "status": "started", "depth": 3 }` or
  `{ …, "status": "empty", "depth": 0 }`.
- **Human (stdout):**
  `redrive     started: 3 message(s) moving back to the queue; watch the dlq depth with ledger health`,
  or `redrive     nothing to move: the dlq is empty`.
- It returns at once, with nothing to poll.

### Error codes raised

In the [error shape](../../../AGENTS.md#error-shape):

| Code | HTTP | Route | `message` | `hint` |
| --- | --- | --- | --- | --- |
| `unauthorized` | 401 | both | `Bearer token missing, malformed, bad-tag, unknown or revoked.` | ``Set `LEDGER_TOKEN` to an active token.`` |
| `forbidden` | 403 | redrive | `The token is valid but lacks the scope this operation needs.` | ``Use an `operate` token, or ask its owner for one.`` |
| `validation_failed` | 400 | inspect | `limit must be an integer from 1 to 10.` (D6) | `Fix the field the message names, then retry.` |
| `redrive_in_progress` | 409 | redrive | `A DLQ redrive task is already running; SQS allows one per queue.` | ``Wait for the DLQ depth in `ledger health` to fall.`` |
| `database_unavailable` | 503 | both (the token lookup) | `The database is unreachable.` | ``The queue holds events meanwhile (ADR-015); retry, then `ledger worker resume`. `ledger health` shows storage used.`` |
| `internal_error` | 500 | both | `An unexpected error occurred.` | `Retry; if it persists, read the API logs by request id.` |
| `api_unavailable` | — (SDK) | both | `The Ledger API did not answer with a Ledger response.` | ``Check `LEDGER_URL`. The kill switch may be tripped: check the budget alerts, then run the re-arm script.`` |

`docs` per the registry: the runbook for all but `redrive_in_progress` (the AWS redrive page). The
CLI exits `0`, `1` or `2` per pp-cli → Output and exit codes; a non-integer `--limit` is a usage
error, exit `2`, and never reaches the API.

### `pnpm sim` (not an operation)

The lines an AWS run prints, in order, each with ids, counts, durations and numbers only:

- **Burst:** `sim seed=… namespace=…` · `history emails=… events=10000 duplicates=0 shuffled=…` ·
  `projection not printed (--burst)` ·
  `preflight concurrency=<q> recent_requests=<r> usage_trip_threshold=<t>` ·
  `throttle raised rate=1200 burst=2400` ·
  `sent requests=10000 accepted=10000 duration_s=<d> p50_ms=<x> p99_ms=<y>` ·
  `throttle restored rate=100 burst=200` · `settled stored=10000/10000 after <s>s` ·
  `storage before=<b> after=<a> bytes_per_event=<c> bursts_left=<k>` · invariants 1, 2 ·
  `invariant 3 not checked (slice 6)` · invariant 4.
- **db-outage:** `chaos db-outage: database repointed, worker and api recycled` ·
  `sent requests=<k> accepted=<k> first_attempt_200=<k>` · `worker paused after <s>s` ·
  `queue-age alarm ALARM after <m>m; dlq depth 0` ·
  `chaos db-outage: database restored, worker and api recycled` ·
  `resume: pnpm -s ledger worker resume, or wait for the hourly resume` ·
  `worker enabled after <m>m` · `settled …` · invariants 1, 2, 4.
- **Poison:** `poison count=<n> svix_ids=<…> email_ids=<…>` · `sent requests=<k> accepted=<k>` ·
  `others stored <k>/<k> exactly once (<n> poisoned wait in the DLQ)` ·
  `invariant 1 not checked (…)` · `invariant 2 not checked (…)` ·
  `invariant 4 pass (dlq holds exactly the <n> poisoned)` · `poison fixed; next: …`.

Refusals print `sim: <reason>` on stderr.

### Alarm email (not an operation)

SNS's CloudWatch alarm email to the owner's subscribed address: its subject names the alarm, and its
body carries the `AlarmDescription` with the runbook link (D18). Only the owner observes it.

### Environment

| Name | Kind | Reader | Form |
| --- | --- | --- | --- |
| `LEDGER_SIMULATOR` | public, new | `pnpm aws:deploy` | `on` \| `off`, default `off`; `on` only in the owner's deployment |
| `LEDGER_SIMULATOR_SECRET` | public, existing; new reader | `pnpm aws:deploy` (with `on`), `pnpm sim`, `apps/local` | `whsec_` + base64 |
| `SIMULATOR_SECRET_ARN` | internal, new | ingest | ARN; only with the flag (`ingestSimulatorEnv`) |
| `ledger:simulator` | CDK context, new | `infra` | `true` \| `false`, default `false` |

`.env.example` gains `LEDGER_SIMULATOR=` with the comment
`# pnpm aws:deploy: on only in the owner's deployment (adds the simulator secret); default off.`

### PII

- A dead message's raw body holds `data.to`, `from`, `subject`, tags and bounce text. None reaches
  any surface: the reader reads three paths and drops the parse (D5). The redaction test is
  mandatory for `dlq.listMessages`, which reads a queue envelope (pp-workflow → Test tiers).
- Logs: nothing new; an adapter error logs its name only.
- Sim output: ids, counts and timings only (D28). Burst recipients are `+label` forms of Resend test
  addresses, never printed, stored as keyed hashes and masks only.
- Secrets: the db-outage run holds `ledger/database` in memory only (D27). The simulator secret
  travels `.env.local` → deploy → Secrets Manager, never CDK.
- Alarm descriptions and the runbook hold no ARN, account id, deployed URL or address.

## Walkthrough plan

[Walkthrough format](../../../.agents/skills/rsa-manual-test/references/walkthrough-format.md). Setup
is non-destructive, every AWS step is `**Ask-first:**`, and there are no live Resend writes.
Personas: **operator** (alarms, DLQ, health, resume), **application developer** (J7's burst; order
independence), **reviewer** (a `read` token against the kept deploy). Support and the AI agent do not
reach this slice (MCP DLQ tools are slice 5's).

- **P0 — Setup (owner).** `LEDGER_SIMULATOR=on` in `.env.local`; `DATABASE_URL` (the deployed
  pooled URL with owner credentials) in `.env.deployed.local`. **Ask-first:** `pnpm aws:deploy` →
  the usual lines plus `aws:deploy: simulator on`, exit `0`. **Ask-first:**
  `aws cloudwatch describe-alarms --alarm-name-prefix Ledger --query "MetricAlarms[].AlarmName"` →
  the five names.
- **P1 — Operator: alarms and the runbook.** **Ask-first:**
  `aws cloudwatch describe-alarms --alarm-names LedgerApp-dlq-depth --query "MetricAlarms[0].AlarmDescription"`
  → ends `Runbook: https://github.com/…/docs/runbook.md#ledgerapp-dlq-depth`; open it and land on the
  entry. `pnpm check` shows `runbook-links.test.ts` passing.
- **P2 — Application developer (J7): the burst.** Load `.env.deployed.local`. **Ask-first:**
  `pnpm sim --burst 10000/10s`. Before the quota increase: `sim: the account's Lambda concurrency
  quota is 50; …`, exit `1`, nothing sent (blocked until the owner's increase). After it: the burst
  lines and exit `0`; record p50/p99, bytes per event, bursts left and the drain time.
  `pnpm -s ledger health` → queue 0, dlq 0. No usage-trip email. A queue-age email only if the drain
  passed 15 min; record it.
- **P3 — Operator: database outage.** **Ask-first:** `pnpm sim --chaos db-outage`. While it holds:
  `pnpm -s ledger health` → `worker      paused`, `database    unreachable`, dlq 0. The owner records
  the `ALARM: "LedgerApp-queue-age"` email time. After `database restored`:
  `pnpm -s ledger worker resume` → `worker      enabled`. The run ends with invariants 1, 2 and 4
  passing, exit `0`. `worker paused after <s>s` settles AWS-U15.
- **P4 — Operator: poison and redrive (J4).** **Ask-first:** `pnpm sim --poison 1` (≈ 30 min) →
  `others stored <k>/<k> exactly once (1 poisoned wait in the DLQ)`,
  `invariant 4 pass (dlq holds exactly the 1 poisoned)`, `poison fixed; next: …`, exit `0`. The owner
  records the `ALARM: "LedgerApp-dlq-depth"` email. Then `pnpm -s ledger dlq inspect` →
  `dlq         1 message(s), showing 1` and the printed `svix_id`, no address or subject anywhere;
  `--json` → one document. `pnpm -s ledger dlq redrive` → `redrive     started: 1 message(s) …`. An
  immediate second `pnpm -s ledger dlq redrive --json` → the `redrive_in_progress` error object, exit
  `1`, or `status: empty` if the task already finished (either is correct; record which).
  `pnpm -s ledger health` → `dlq         0 visible, 0 in flight`.
  `pnpm -s ledger email <poisoned email_id>` → the timeline holds the poisoned `svix_id`.
- **P5 — Reviewer: read token.** With an `operate` token:
  `pnpm -s ledger token create --name review-dlq --scope read` → the plaintext once. With it:
  `pnpm -s ledger dlq inspect --json` → exit `0`; `pnpm -s ledger dlq redrive` →
  `The token is valid but lacks the scope this operation needs.` and its hint on stderr, exit `1`.
  Revoke it with the `operate` token.
- **P6 — Application developer: order independence through SQS.** **Ask-first:**
  `pnpm sim --duplicates 0.2 --shuffle` with `.env.deployed.local` loaded → invariants 1 and 2 pass,
  `invariant 4 not checked (…)`, exit `0`.
- **P7 — Operator: local mode.** `pnpm dev:full`, then `pnpm -s ledger dlq inspect` →
  `dlq         empty`; `pnpm -s ledger dlq redrive` →
  `redrive     nothing to move: the dlq is empty`. The Postgres-backed queue's DLQ → slice 2B.
- **P8 — Adopter default (no AWS step).** `pnpm synth` with no context → the app template holds two
  secrets and no `SIMULATOR_SECRET_ARN` (read from `cdk.out`). The deployed `401` half is proven by
  D13's unit test.

## Risks / Trade-offs

- **[The quota increase is slow or partial]** → Ships 4 waits. Request it first; the preflight
  refuses cleanly, and every other bullet proceeds at quota 50.
- **[One Windows Node process cannot pace 1,000 rps]** → `duration_s` is printed. If it is far over
  10, measure before touching the design; the ceiling, not a load farm, is the requirement.
- **[A configuration update does not recycle environments (AWS-U15)]** → D27 step 5's 10-minute bound
  fails the run and `finally` restores; then change the recycle step (e.g. a code-hash-neutral
  update).
- **[A crashed db-outage run leaves the secret repointed]** → the kept stack fails every database
  read until the `finally` restore, or `pnpm aws:deploy` rewrites it (printed). The queue holds
  meanwhile (ADR-015).
- **[A crashed poison run leaves the constraint]** → only that run's ids fail; the next poison run
  drops leftovers; live `svix_id`s never match.
- **[A burst trips the usage trip]** → D25 step 3's preflight; otherwise `pnpm aws:rearm`.
- **[A burst dies without its `finally` and the throttle stays at 1,200 rps]** → the usage trip
  still fires within ≤ 20 min: ≤ 1.44M requests ≈ USD 4.3, below item 7's USD 6.5 worst case.
- **[The 5xx alarm is noisy during demos (an outage's `503`s)]** → the runbook entry explains it;
  tuning waits for a measured case.
- **[Neon storage grows tens of MB per burst]** → printed per run as `bursts_left` and recorded in
  integrations.md → Cadence.
- **[Slice 2's unrecorded results confuse the doc state]** → this slice updates only AWS-U05; slice
  2's task 13.8 carries the rest.
- **[A visibility-0 receive returns one message twice]** → the reader collapses items by `svix_id`
  (D5).
- **[Lazy `inject` hides a harness misuse]** → `createTestDatabase` still throws Vitest's own error
  when called outside the runner; only the load-time import moves (D32).

## Migration Plan

1. Build and merge the code; `pnpm verify` green. No migration.
2. Owner ops (PP §25): request the Lambda concurrency increase to ≥ 1,000 in us-east-2; set
   `LEDGER_SIMULATOR=on` in `.env.local`; add `DATABASE_URL` to `.env.deployed.local`.
3. **Ask-first:** `pnpm aws:deploy` adds the three alarms, the descriptions, the DLQ IAM and the
   simulator secret. The existing alert subscription receives the new alarms; no new confirmation.
4. Apply runs group 12 unattended (owner-ruled 2026-10-19: pre-approved, guarded by the AWS session's
   remaining time before each long run); then walk P0–P8.

Rollback: a redeploy of the previous commit removes the alarms, the IAM and the secret (`DESTROY`).
`LEDGER_SIMULATOR=off` and a redeploy removes only the simulator secret. Nothing to roll back in the
database.

## Open Questions

None that change the specs, the approach or the tasks. AWS-U14 and AWS-U15 are safe either way
(D31), and RS-U08 and AWS-U05's burst half are settled by the walk's recorded numbers.
