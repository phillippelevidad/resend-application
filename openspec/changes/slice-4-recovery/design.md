# Design — slice 4: Recovery

## Context

See [proposal.md → Why](proposal.md#why). The pre-proposal
[2026-10-19-slice-4-recovery.md](../../../.ai/pre-proposals/2026-10-19-slice-4-recovery.md) (*PP*) is
decision-complete and checked (31 repairs; the two owner items were ruled on 2026-10-19). Each
decision below keeps its PP number (D1–D41) and carries what `opsx:apply` needs to build it. The PP
keeps the authority trail for every decision and the contradictions C1–C22. D42–D48 are build-level
choices this design adds where the PP left the mechanism open or a fact surfaced at propose time.
None of them changes a spec, a contract or a PP decision.

State on `HEAD` (PP §5, re-checked 2026-10-19: `git diff 5fe2a51 HEAD` touches only the PP):

- **Scaffolds:** `packages/resend-client/src/index.ts`, `packages/reconciler/src/index.ts` and
  `apps/reconciler/src/reconciler.handler.ts` are `export {}` stubs. Neither package declares a
  dependency or a `./testing` export; `apps/reconciler/package.json` has no `dependencies`.
- **Resend SDK:** `resend@6.33.0` is locked through `packages/ingest/package.json:16` only. It
  exposes `webhooks.get`, `webhooks.events.list|get|replay`, `emails.send`, `Response<T> &
  { headers }`, an abort `signal`, never throws (a network failure returns `statusCode: null`), and
  `console.error`s every error body unless `NODE_ENV` is `production` (PP §5, C9).
- **Database:** six schema files, migrations up to `0003_grant-api-tokens.sql`. No
  `reconcile_runs`. `webhookEventsRepository.countPresent` exists
  (`packages/db/src/webhook-events.repository.ts:66`) and answers a count, not ids.
- **Ports:** `FunctionInvokePort` is synchronous only (`packages/shared/src/function-invoke.port.ts`,
  "The asynchronous invoke is slices 4 and 6's"). `MetricsPort.count(name, value, fields?)` takes no
  dimension, and `EmfMetricsAdapter` writes `Dimensions: [[]]` (`emf-metrics.adapter.ts:44`).
  `ingest.rejected` is declared in `metricNames` and never emitted.
- **Ingest:** the 5-minute cache is in place (`packages/ingest/src/create-ingest.ts:21, 108-120`). A
  `401` logs `ingest.request_rejected` and counts nothing (`:124-127`).
- **Read API:** no gaps or reconcile route. `health.get` has no last-run field
  (`packages/api/src/health-response.schema.ts:8-25`). `bodyErrors` and `routeFieldErrors` in
  `create-api.ts:79-89` carry per-route messages.
- **Infra:** `HOURLY_CRON = 'cron(0 * * * ? *)'`, `SCHEDULE_RETRY_ATTEMPTS = 0`,
  `SCHEDULE_MAX_EVENT_AGE_SECONDS = 60` (`infra/src/app.stack.ts:93-95`); one schedule, to the
  worker's resume (`:288-297`); five alarms. The kill switch lists functions by the `LedgerApp-`
  prefix (`packages/aws/src/kill-switch.ts:268-280`), and guardrails grants
  `PutFunctionConcurrency` on `${appStackName}-*`, so a new function needs no kill-switch edit.
- **Runbook:** "Slice 4 lands …" text at `docs/runbook.md:82, 102, 159, 168, 173-174, 197-198,
  215-218`. No `## Procedures` section.
- **Registry:** 19 codes mirrored in `packages/core/src/error-codes.ts`; `run_not_found`,
  `reconcile_in_progress`, `run_abandoned`, `webhook_disabled`, `rate_limited`,
  `resend_auth_failed`, `resend_unavailable` are registered. `reconciler_not_configured` is not.

Binding constraints: ADR-001, ADR-003, ADR-004, ADR-005, ADR-007, ADR-009, ADR-010, ADR-011,
ADR-012, ADR-013, ADR-015, ADR-018, ADR-019 ([Decisions](../../../.ai/architecture.md#decisions)); the
module boundaries in root [AGENTS.md](../../../AGENTS.md#module-boundaries) (only
`packages/resend-client` imports `resend` for API calls; only `packages/aws` imports `@aws-sdk/*`;
every database access goes through `packages/db`; the CLI is built on the SDK);
[integrations.md → Locked rules](../../../.ai/integrations.md#locked-rules-must) and
[Secrets layout](../../../.ai/integrations.md#secrets-layout);
[api-contract.md → Conventions](../../../.ai/api-contract.md#conventions); the `pp-backend`,
`pp-database`, `pp-infra`, `pp-testing`, `pp-cli` and `pp-general` skills.

## Goals / Non-Goals

**Goals:**

- Every event List Events holds for the configured webhook inside a run's window ends up in
  `webhook_events` exactly once, through ingest, with no `--lookback` needed after any span of
  missed runs up to 30 days.
- Recovery spends at most Ledger's 2 req/s share of the team's Resend budget, yields to the team's
  own traffic, and stops inside its time budget.
- A run that cannot recover (disabled webhook, bad key, Resend down, not configured, a crash) is
  visible: a registered outcome on `ledger gaps` and `ledger health`, and an email from
  `LedgerApp-reconcile-gap` within about an hour.
- Each claim is checked: the recovery suite composes the real reconciler, the real `resend-client`,
  a fake Resend API, real ingest and the real worker over real Postgres.

**Non-Goals:**

- No fetched-payload write path (ADR-007's rejected option), no recovery by delivery status, no
  automatic DLQ redrive.
- No live reconcile in local mode (PP §3, D23), no MCP tools (slice 5), no SDK retries (slice 5).
- No progress write per page, no index on `reconcile_runs`, no stored run status, no shared limiter
  across functions (PP §19's rejected list).
- No change to the worker, the projections or the ledger transaction. A replay takes the ordinary
  path, already idempotent on `svix_id` (`record-event.command.int.test.ts`).

## Decisions

### Module layout

New or changed files, by project. Names follow pp-general's role suffixes, and the async port's
files mirror the synchronous `function-invoke` set (D42).

| Project | Files |
| --- | --- |
| `packages/core` | `reconcile-run.ts` (D2 constants, D3 `runOutcome`, D5 events and closed sets), `parse-duration.ts`, `reconcile-horizon.ts` (D3); `error-codes.ts` (D1); `index.ts`; tests `parse-duration.test.ts`, `reconcile-horizon.prop.test.ts`, `run-outcome.test.ts`, `error-codes.test.ts` (extended) |
| `packages/shared` | `async-function-invoke.port.ts`, `in-process-async-function-invoke.adapter.ts` + test (D7); `testing/async-function-invoke-port-contract.ts`, `testing/fake-async-function-invoke.ts` (D7), exported from `testing.ts`; `metrics.port.ts`, `emf-metrics.adapter.ts`, `log-metrics.adapter.ts` + tests (D8); `create-logger.ts` (`reason`, D34); `function-env.ts` (`reconcilerEnv`, `apiEnv.RECONCILER_FUNCTION_NAME`, D21, D22); `index.ts` |
| `packages/db` | `schema/reconcile-runs.ts` (§Data model); `drizzle/0004_create-reconcile-runs.sql`, `drizzle/0005_grant-reconcile-runs.sql` and the `meta/` snapshot; `reconcile-runs.repository.ts` + `reconcile-runs.repository.int.test.ts` (D6); `webhook-events.repository.ts` (`presentSvixIds`) + its int test; `index.ts` |
| `packages/resend-client` | `create-resend-client.ts` + `create-resend-client.test.ts` (D9, D11, D12); `limiter.ts` + `limiter.test.ts` (D10); `map-resend-error.ts` (D12); `testing/fake-resend-api.ts`, `testing/fake-resend-client.ts` (D13); `testing.ts`; `index.ts`; `package.json` (`resend: 6.33.0`, `./testing` export) |
| `packages/reconciler` | `create-reconciler.ts` (D14–D17, D19); `start-run.ts` (the scheduled start, D6); `reconciler.test.ts` (unit, `FakeResendClient`); `reconciler.int.test.ts` (claim, D16); `recovery.int.test.ts` (D43); `index.ts`; `package.json` |
| `packages/ingest` | `create-ingest.ts` (D33); `create-ingest.test.ts` |
| `packages/api` | `list-gaps.route.ts`, `list-gaps.reader.ts`; `get-reconcile-run.route.ts`, `get-reconcile-run.reader.ts`; `start-reconcile.route.ts`, `start-reconcile.command.ts`; `reconcile-run-response.mapper.ts` + test, `reconcile-run-response.schema.ts`, `reconcile-run-list-response.schema.ts`, `run-id.schema.ts`, `duration.schema.ts` (D27, D28); `get-health.reader.ts`, `health-response.mapper.ts`, `health-response.schema.ts` (D27); `create-api.ts` (`ApiDeps.reconcilerInvoke`, the routes, `bodyErrors` and `routeFieldErrors` entries); route int tests `list-gaps.route.int.test.ts`, `get-reconcile-run.route.int.test.ts`, `start-reconcile.route.int.test.ts`, `start-reconcile.command.int.test.ts`; `get-health.route.int.test.ts`; `testing/api-test-deps.ts`, `testing/read-api-contract.ts`; `scripts/export-openapi.ts` (an inert `reconcilerInvoke`, D48) |
| `packages/sdk` | `create-ledger-client.ts` (`gaps.list`, `reconcile.getRun`, `reconcile.start`), `testing.ts` (`FakeLedgerClient`); regenerated `openapi.json`, `src/openapi-types.ts` |
| `packages/aws` | `lambda-async-function-invoke.adapter.ts` + test (D7); `ingest-route-throttle.ts` + test (D31); `ledger-stacks.ts` (`RECONCILER_FUNCTION_NAME`, `RECONCILE_SCHEDULE_NAME`, `RECONCILE_GAP_ALARM_NAME`, `appOutputKeys.resendApiKeySecretArn`); `index.ts` |
| `apps/reconciler` | `reconciler.config.ts`, `database-secret.schema.ts` (one field, D21), `create-reconciler-handler.ts` + test (D20), `reconciler.handler.ts`, `main.ts`; `package.json` |
| `apps/api` | `api.config.ts` (`RECONCILER_FUNCTION_NAME`), `main.ts` (D28) |
| `apps/local` | `main.ts` (D23); `sdk-contract.int.test.ts` (runs the grown contract); `local-reconcile.int.test.ts` (the local reconcile case: the real `main.ts` and CLI over a Testcontainers clone, since the e2e tier has no Postgres) |
| `apps/cli` | `wait-for-run.ts` (D46); `commands/gaps-list.cli.ts` + test, `commands/reconcile-start.cli.ts` + test; `commands/health-get.cli.ts` + test; `create-program.ts` |
| `infra` | `src/app.stack.ts` (function, secret, invoke config, schedule, IAM, alarm, output); `src/function-env.ts`; `src/infra.config.ts` and `src/main.ts` (`ledger:resendWebhookId`); `app.stack.test.ts`, `bundle-smoke.test.ts`, `runbook-links.test.ts`; `scripts/deploy-env.schema.ts`, `scripts/run-deploy.ts`, `scripts/deploy.ts`, `run-deploy.test.ts`; `scripts/run-teardown.ts`, `run-teardown.test.ts`; `scripts/rearm.ts`, `scripts/trip-drill.ts`; `scripts/gap-drill.ts`, `scripts/run-gap-drill.ts`, `run-gap-drill.test.ts` (D32); `package.json` |
| root | `package.json` (`aws:gap-drill`), `.env.example`, `README.md`, `docs/runbook.md` |

**Workspace links** (boundary declarations, not Ask-first; pp-general → boundaries): `packages/resend-client` → `@ledger/core`, `@ledger/shared`; `packages/reconciler` → `@ledger/core`, `@ledger/db`, `@ledger/shared`, `@ledger/resend-client`, and dev `@ledger/ingest`, `@ledger/worker` (D43); `apps/reconciler` → `@ledger/aws`, `@ledger/db`, `@ledger/reconciler`, `@ledger/resend-client`, `@ledger/shared`; `apps/local` → `@ledger/reconciler`; `infra` → `@ledger/resend-client`, `@ledger/sdk`. The only third-party addition is `resend@6.33.0` in `packages/resend-client` (approved item 1); `pnpm-lock.yaml` gains no new package version.

### Kernel (`packages/core`)

#### D1 — `reconciler_not_configured` and the stored outcome set

Registry row (owner-ruled; api-contract.md first, then the mirror):

| Code | HTTP | Meaning | Hint | Docs | Raised by |
| --- | --- | --- | --- | --- | --- |
| `reconciler_not_configured` | — (run outcome) | The reconciler has no Resend API key or webhook id, or Resend has no webhook with that id, so it cannot list or replay events. | Reconcile runs on a deployed stack: set `LEDGER_DEPLOY_RESEND_API_KEY` and `LEDGER_DEPLOY_RESEND_WEBHOOK_ID`, then run `pnpm aws:deploy`. | runbook | packages/reconciler → `reconcile_runs.error_code` |

`errorCodes` and `errorRegistry` gain it with `status: null` and `docs: runbook('reconciler_not_configured')`.
`internal_error`'s Raised-by cell gains "packages/reconciler and packages/api →
`reconcile_runs.error_code`". A second tuple is the column's closed set:

```ts
export const reconcileRunErrorCodes = [
  'webhook_disabled', 'rate_limited', 'resend_auth_failed', 'resend_unavailable',
  'reconciler_not_configured', 'internal_error',
] as const satisfies readonly ErrorCode[];
```

`run_abandoned` is absent by construction: the `CHECK` refuses it (ADR-007).

#### D2 — The run's constants (`reconcile-run.ts`, each commented with its source)

| Constant | Value | Source |
| --- | --- | --- |
| `RECONCILE_RUN_BUDGET_MS` | `840_000` | ADR-007's one budget constant below the 900 s Lambda maximum (AWS-03); integrations.md rule 2's ≈ 85 min over ≈ 6 runs |
| `RECONCILE_FINISH_RESERVE_MS` | `60_000` | Resend calls stop at `started_at + budget − reserve`, so the finish lands inside the budget and no live run reads abandoned |
| `RECONCILE_GRACE_MS` | `600_000` | ADR-007's grace window |
| `RECONCILE_DEFAULT_LOOKBACK_MS` | `259_200_000` | ADR-007, above the ≈ 27.6 h retry schedule (RS-09) |
| `RECONCILE_MAX_LOOKBACK_MS` | `2_592_000_000` | RS-31; api-contract's validation bound |

#### D3 — Pure functions

- `parseDuration(text: string): number | undefined`: `^[1-9][0-9]{0,4}[mhd]$`, the value in ms, and
  `undefined` outside `1m`–`30d` inclusive. `--since` and `--lookback` share it through the API's
  `duration.schema.ts`. The CLI never parses it.
- `reconcileHorizon({ now, lookbackMs, anchorHorizonEnd, oldestQueueAgeSeconds })` →
  `{ horizonStart, horizonEnd }`:
  - `horizonEnd = now − max(RECONCILE_GRACE_MS, (oldestQueueAgeSeconds ?? 0) × 1000)`;
  - `horizonStart = max(now − RECONCILE_MAX_LOOKBACK_MS, min(now − lookbackMs, anchorHorizonEnd ?? +∞, horizonEnd))`.
- `runOutcome(run, now)` → `{ code } | null`: the stored `error_code`; else `run_abandoned` when
  `finished_at` is null and `now − started_at > RECONCILE_RUN_BUDGET_MS`; else `null`.
- Properties (`reconcile-horizon.prop.test.ts`): `horizonStart ≤ horizonEnd`; `horizonStart ≥ now −
  30 d`; an anchor older than `now − lookback` and younger than 30 d is returned exactly.

#### D4 — The anchor

The newest finished run with no `error_code` and `missing = 0`, dry or not. A recovery run never
anchors: the next run re-checks the span, finds the replays stored, and anchors then. A persistently
missing event pins the anchor, the lookback grows toward 30 days, and the gap alarm stays in `ALARM`
(PP C1).

#### D5 — Events and closed sets

Beside `RESUME_EVENT` (`event-source-states.ts:13`): `RECONCILE_SCHEDULED_EVENT = { ledger:
'reconcile-scheduled' } as const` and the manual payload `{ ledger: 'reconcile-run', run_id:
<positive integer> }`, each with a Zod schema; `reconcileTriggers = ['scheduled', 'manual'] as
const`. The schema's `CHECK`s are built from these tuples
([Modeling conventions](../../../.ai/data-modeling.md#modeling-conventions-canonical)).

### Database (`packages/db`)

#### D6 — The repository and the start

Executor-first functions in `reconcile-runs.repository.ts`, each called in this diff:

| Function | SQL shape | Caller |
| --- | --- | --- |
| `lockReconcileStart(tx)` | `SELECT pg_advisory_xact_lock(RECONCILE_START_LOCK_KEY)`, a named `bigint` constant fixed once in `packages/db` | both starts |
| `hasUnfinishedRun(tx)` | `EXISTS (… WHERE finished_at IS NULL AND started_at > now() - make_interval(secs => budget))` | both starts |
| `anchorHorizonEnd(tx)` | `SELECT horizon_end … WHERE finished_at IS NOT NULL AND error_code IS NULL AND missing = 0 ORDER BY id DESC LIMIT 1` | both starts |
| `insert(tx, row)` | `INSERT … RETURNING *` | both starts |
| `claim(db, runId)` | `UPDATE … SET claimed_at = now(), updated_at = now() WHERE id = $1 AND claimed_at IS NULL AND finished_at IS NULL RETURNING *` | reconciler |
| `finish(db, runId, outcome)` | `UPDATE … SET finished_at = now(), updated_at = now(), checked, missing, replayed, failed, error_code WHERE id = $1 AND finished_at IS NULL RETURNING *` | reconciler; the API's failed hand-off |
| `get(db, runId)` | by id | `reconcile.getRun` |
| `listSince(db, { since, limit, after })` | `WHERE started_at >= $since [AND id < $after] ORDER BY id DESC LIMIT limit + 1` | `gaps.list` |
| `latest(db)` | `ORDER BY id DESC LIMIT 1` | `health.get` |

`webhookEventsRepository.presentSvixIds(db, svixIds)` → `Set<string>` (`SELECT svix_id … WHERE
svix_id = ANY($1)`), a primary-key lookup.

**The start, both triggers** (PP C18): read the queue snapshot through `QueueAttributesPort` first;
then one transaction runs `lockReconcileStart`, `hasUnfinishedRun` (true → throw
`LedgerError('reconcile_in_progress')`), `anchorHorizonEnd`, `reconcileHorizon` with the clock port's
`now`, and `insert`. A manual start inserts `claimed_at = NULL`; a scheduled start inserts
`claimed_at = now()`. Two thin commands call these functions, `StartReconcileCommand` in
`packages/api` and `startScheduledRun` in `packages/reconciler`, because a shared command in
`@ledger/reconciler` would pull the `resend` SDK into the read API's bundle (PP D6).

### Shared kernel (`packages/shared`)

#### D7 — `AsyncFunctionInvokePort`

```ts
export interface AsyncFunctionInvokePort {
  invokeAsync(payload: unknown): Promise<void>; // resolves once the payload is handed over
}
```

- `LambdaAsyncFunctionInvokeAdapter` (`packages/aws`): `InvokeCommand` with `InvocationType:
  'Event'`, bound to one function name. It resolves on `StatusCode` `202`. A non-`202` rejects with a
  constant `LedgerError('internal_error')`; a thrown SDK error rejects unchanged.
- `InProcessAsyncFunctionInvokeAdapter` (`packages/shared`): calls the composed function and does
  not await it. A rejection is logged `invoke.async_failed` with `error_name`, never rethrown.
- `asyncFunctionInvokePortContract(name, make)` in `@ledger/shared/testing`: the payload arrives
  unchanged; the promise resolves before the function finishes; a function that rejects never
  rejects the invoke. Both implementations run it (the Lambda one over the `StubClient`).
- `FakeAsyncFunctionInvoke`: records payloads; `failNext()` makes the next invoke reject.

#### D8 — `MetricsPort` gains a typed dimension

```ts
export type MetricDimensions = { 'ingest.rejected': { readonly reason: 'signature' | 'timestamp' } };
count<N extends MetricName>(name: N, value: number, fields?: LogFields,
  ...dimensions: N extends keyof MetricDimensions ? [MetricDimensions[N]] : []): void;
```

`EmfMetricsAdapter` writes `Dimensions: [['reason']]` and a top-level `reason` for
`ingest.rejected`, `[[]]` for every other name. `LogMetricsAdapter` writes `reason` as a log field.
`RecordingMetrics` records it. Ids stay fields, never dimensions (AWS-12).

#### D34 — `reason` in the log allow-list

`LogFields` gains `reason?: 'signature' | 'timestamp'`; [Log fields](../../../.ai/data-modeling.md#log-fields)
lists it (PP C17).

### `packages/resend-client`

#### D9 — Shape

`createResendClient({ apiKey, baseUrl, userAgent, clock, sleep, ratePerSecond = 2 })` →
`ResendClient`, every method taking `{ deadline: Date }` last:

| Method | SDK call | Returns | Caller |
| --- | --- | --- | --- |
| `retrieveWebhook(webhookId, opts)` | `webhooks.get(id)` | `{ status: 'enabled' \| 'disabled' }` only; `signing_secret` dropped (RS-13) | reconciler |
| `listWebhookEvents(webhookId, { after? }, opts)` | `webhooks.events.list({ webhookId, limit: 100, after })` | `{ hasMore, events: { id, type, createdAt: Date }[] }` (RS-14) | reconciler, gap drill |
| `replayWebhookEvent(webhookId, eventId, opts)` | `webhooks.events.replay(…)` | `void` (RS-16) | reconciler |
| `retrieveWebhookEventCreatedAt(webhookId, eventId, opts)` | `webhooks.events.get(…)` | `{ createdAt }`, the payload's top-level `created_at` only (RS-15) | gap drill |
| `sendEmail({ from, to, subject, text }, { idempotencyKey }, opts)` | `emails.send(payload, { idempotencyKey })` | `{ emailId }`, or the status and name of a `401`, `403` or `409` for its caller | gap drill; slice 6's dispatcher |

`new Resend(apiKey, { baseUrl, userAgent })`, every option explicit. The Lambda's `baseUrl` is the
config constant `https://api.resend.com`, and tests pass the fake's. `userAgent` is
`ledger-reconciler` or `ledger-gap-drill` (RS-21). Each request passes `signal:
AbortSignal.timeout(RESEND_REQUEST_TIMEOUT_MS)` (`10_000`). The key comes from the root, read
through the secret port on the first invocation (PP C22), and never reaches a log, an error or an
output. `sendEmail` always carries `Idempotency-Key` (RS-24).

**Console silence** (PP C9): `Reflect.defineProperty(sdk, 'logError', { value: () => {} })` on the
instance. `create-resend-client.test.ts` spies on `console.error` and fails if a `4xx`, a `5xx` or a
refused connection writes anything; it fails too if a version bump renames the method, because
the spy then sees output.

#### D10 — The limiter (`limiter.ts`, one per client, over the clock port and injected `sleep`)

1. **Rate:** request starts spaced `1000 / ratePerSecond` ms apart.
2. **Headroom:** after each response, when `ratelimit-remaining < ratelimit-limit / 2`, wait
   `ratelimit-reset` seconds before the next start. Absent or unparseable headers: no wait.
3. **`429`:** wait `retry-after` seconds and retry the same call, as often as the deadline allows. A
   `429` named `daily_quota_exceeded` or `monthly_quota_exceeded`, or one with no parseable
   `retry-after`, throws `rate_limited` with no retry (RS-22).
4. **Deadline:** any wait that would end past the call's deadline throws `rate_limited` before it
   sleeps.

#### D11 — `5xx` and network failures

A `5xx`, or `statusCode: null` (network failure or the 10 s timeout), is retried twice more after
1 s, then 2 s, each inside the deadline, then throws `resend_unavailable`.

#### D12 — The mapping (`map-resend-error.ts`, status first, then name)

| Response | Outcome |
| --- | --- |
| `2xx` | the method's return |
| `429` | D10 step 3 |
| `401` / `403`, any name, from a reconcile method | `resend_auth_failed` (RS-22) |
| `401` / `403` / `409` from `sendEmail` | returned by status and name to its caller; the drill fails on any (`failed: resend_auth_failed` for `401`/`403`, `internal_error` for `409`) |
| `400` `validation_error`, message `API key is invalid` | `resend_auth_failed` (RS-U17, Constraint 14) |
| `5xx`, `statusCode: null` | D11, then `resend_unavailable` |
| `404` from `retrieveWebhook` | `reconciler_not_configured` (PP C19) |
| anything else | `internal_error`, logged once `resend.request_failed` with `error_name` (the SDK's `name`) and `error_code`, never Resend's `message` (PP C12) |

Each thrown error is `LedgerError(code)` with the registry message. Resend's body never becomes a
`message`, a printed `cause` or a log value.

#### D13 — The fakes (`@ledger/resend-client/testing`)

- **`startFakeResendApi()`** → `{ baseUrl, script(route, responses), events, onReplay, requests,
  close }`: `node:http` on `127.0.0.1:0`, answering `GET /webhooks/{id}`, `GET
  /webhooks/{id}/events`, `GET /webhooks/{id}/events/{event_id}`, `POST
  /webhooks/{id}/events/{event_id}/replay` and `POST /emails`. Scripted responses carry status, the
  RS-22 body and `ratelimit-*` / `retry-after` headers; unscripted List Events pages `events` (data
  the test sets) newest first with `after`; a replay calls `onReplay(eventId)`. It records method,
  path, `User-Agent`, `Idempotency-Key` and body. It never decides what is missing. Fixtures use
  test addresses only.
- **`FakeResendClient`**, typed against `ResendClient`, for the reconciler's unit tests only; never
  for a limiter claim.

### Reconciler (`packages/reconciler`, `apps/reconciler`)

#### D14 — The factory

`createReconciler({ db, resend, webhookId, queueAttributes, clock, logger, metrics })` →
`{ runScheduled(), runClaimed(runId) }`. `resend` and `webhookId` are `undefined` when not
configured. `runScheduled` starts (D6, `scheduled`) then runs; a refused start logs
`reconcile.start_refused` and returns. `runClaimed` claims (D16) then runs.

#### D15 — The run

`deadline = started_at + RECONCILE_RUN_BUDGET_MS − RECONCILE_FINISH_RESERVE_MS` on every Resend call.

1. `resend` or `webhookId` absent → finish `reconciler_not_configured`, no Resend call.
2. `retrieveWebhook` → `disabled` → finish `webhook_disabled` (RS-11). An error finishes with its code.
3. Page `listWebhookEvents` newest first, `after` = the previous page's last id. On each page, an
   item with `createdAt > horizonEnd` is skipped; one with `createdAt < horizonStart` is outside;
   every other counts in `checked`. Paging stops after a page holding an item older than
   `horizonStart`, or one with `hasMore: false`. Every item on a page is filtered, so an unsorted
   page hides nothing.
4. Per page, `presentSvixIds` over the in-window ids; the rest count in `missing`.
5. Not a dry run: replay each missing id in page order; success counts in `replayed`.
   `resend_auth_failed` or `rate_limited` stops the run with that code. Any other error counts in
   `failed`, logs `reconcile.replay_failed` (`run_id`, `svix_id`, `error_code`), and the run goes on.
6. A List Events error stops the run with its code. The deadline reached with paging unfinished
   finishes it `rate_limited` (PP C2).
7. Finish (D6) with the counts and the code, then emit D19's metrics.

An unexpected throw after the claim is caught at the factory edge, finished best-effort
`internal_error`, logged `reconcile.internal_error` by `error_name`, and rethrown as a constant so
Lambda's `Errors` counts it. A failed finish leaves the row unfinished; it reads `run_abandoned`.

#### D16 — The claim

`claim(db, runId)` before any Resend call. Zero rows (a duplicate invoke, a finished row, no row) →
log `reconcile.duplicate_invoke` with `run_id`, return.

#### D17 — Outcomes stored

`null`, or a member of `reconcileRunErrorCodes`. A time-budget stop is `rate_limited`.

#### D18 — The manual start (`StartReconcileCommand`)

D6's start with `trigger = manual`, the body's `dry_run` and `lookback` (default 72 h). After the
commit, `reconcilerInvoke.invokeAsync({ ledger: 'reconcile-run', run_id })`. If it rejects, a second
statement finishes the row `internal_error` and the route answers `500 internal_error`. A start
refused inside the lock answers `409 reconcile_in_progress`.

#### D19 — Metrics and logs

A run with no `error_code` emits `reconcile.missing`, `reconcile.replayed` and `reconcile.failed`
(value the count, field `run_id`, no dimension), dry runs included. An errored run emits none: the
gap alarm reads that silence (D24). Log lines, constant messages, allow-listed fields only:
`reconcile.run_started` (`run_id`), `reconcile.run_finished` (`run_id`, `checked_count`,
`missing_count`, `replayed_count`, `failed_count`, `error_code` when set),
`reconcile.replay_failed`, `reconcile.duplicate_invoke`, `reconcile.start_refused`,
`reconcile.internal_error` (`error_name`). Every key is already allowed
([Log fields](../../../.ai/data-modeling.md#log-fields): `<name>_count` by pattern,
`packages/shared/src/create-logger.ts:46-47`); `run_id` is a string field (`:38`), so the id is
logged as `String(id)`.

#### D20 — The function (`apps/reconciler`)

`LedgerFunction` `reconciler` → `LedgerApp-reconciler`, 256 MB, timeout 900 s, async invoke config
`retryAttempts: 0` and `maxEventAge: Duration.seconds(60)` (PP C15, AWS-63), no reserved
concurrency. `create-reconciler-handler.ts` Zod-parses either event (D5): `reconcile-scheduled` →
`runScheduled()`, `reconcile-run` → `runClaimed(run_id)`, anything else → logged and rejected. It
catches at its edge, logs `error_name`, rethrows a constant. `main.ts` parses config at module scope
and reads both secrets on the first invocation through one memoized promise, so the bundle loads
with no AWS access (`apps/worker/src/main.ts:16` pattern).

#### D21 — Its configuration

```ts
export const reconcilerEnv = {
  DATABASE_SECRET_ARN: 'DATABASE_SECRET_ARN',
  RESEND_API_KEY_SECRET_ARN: 'RESEND_API_KEY_SECRET_ARN',
  RESEND_WEBHOOK_ID: 'RESEND_WEBHOOK_ID',
  QUEUE_URL: 'QUEUE_URL',
  DLQ_URL: 'DLQ_URL',
} as const;
```

The webhook id comes from CDK context `ledger:resendWebhookId`; absent, the value is `unset`, which
`reconciler.config.ts` parses as not configured. `ledger/database` is parsed by the app's own
one-field schema (`pooledUrl`). `ledger/resend-api-key` holds a bare key; a value not starting `re_`
(the CDK placeholder before the deploy writes it) parses as not configured. The grace window's age
comes from `SqsQueueAttributesAdapter` over both queue URLs (CloudWatch, AWS-22).

#### D22 — IAM

Reconciler: `grantRead` on `ledger/resend-api-key` and `ledger/database`; `sqs:GetQueueAttributes`
on both queues; `cloudwatch:GetMetricStatistics` on `*`. Read API: `lambda:InvokeFunction` on the
reconciler's ARN, built with `formatArn` from `RECONCILER_FUNCTION_NAME`; `apiEnv` gains
`RECONCILER_FUNCTION_NAME`.

#### D23 — Local mode

`apps/local` composes `createReconciler` with `resend: undefined`, `webhookId: undefined`, over the
in-process queue's attributes, and an `InProcessAsyncFunctionInvokeAdapter` calling `runClaimed`.
Every local run ends `reconciler_not_configured`. No local variable is added. A live local reconcile
is a new [Deferred](../../../.ai/architecture.md#deferred-yagni) row, tripwire: slice 2B lands
`docker compose`, or the first walk that must replay into a local process through `resend webhooks
listen`.

### Infra (`infra/`)

#### D24 — `LedgerApp-reconcile-gap` (owner-ruled)

`new Alarm` on `Metric({ namespace: 'Ledger', metricName: 'reconcile.missing', statistic:
'Maximum', period: Duration.hours(1) })`, `evaluationPeriods: 1`, `threshold: 0`,
`GreaterThanThreshold`, `TreatMissingData.BREACHING`, then `(alarm.node.defaultChild as
CfnAlarm).evaluationWindow = { wallClockWindow: {} }` (the L2 has no prop in aws-cdk-lib 2.273.0; PP
C21, AWS-64). One `ALARM` action on the constructed alert-topic ARN, no OK action.
`alarmDescription`: `A reconcile run found missing events, or none finished cleanly this hour.
Runbook: <RUNBOOK_BASE_URL>#ledgerapp-reconcile-gap`. Each evaluation reads the most recently
completed UTC hour, which holds that hour's `:00` scheduled run. Expected firings: before the first
configured deploy, after a trip, during a gap drill. Six standard alarms deploy (AWS-28: 10 free).

#### D25 — `LedgerApp-reconcile-hourly`

A second `Schedule` on `HOURLY_CRON`, `TimeWindow.off()`, `retryAttempts:
SCHEDULE_RETRY_ATTEMPTS`, `maxEventAge: Duration.seconds(SCHEDULE_MAX_EVENT_AGE_SECONDS)`, target
the reconciler with `RECONCILE_SCHEDULED_EVENT`. One Scheduler target per schedule (AWS-10); both
ticks land in one database wake.

#### D26 — Outputs

`ResendApiKeySecretArn`, read by the deploy's key write (D29).

### Read API (`packages/api`)

#### D27 — Routes and the run object

| Operation | Request | `2xx` | Scope |
| --- | --- | --- | --- |
| `gaps.list` → `GET /gaps` | query `since` (duration, default `24h`), `limit` (1–100, default 20), `after` (run id) | `200` `{ object: 'list', has_more, data: ReconcileRun[] }` | `read` |
| `reconcile.getRun` → `GET /reconcile/runs/{run_id}` | path `run_id`, positive integer | `200` `ReconcileRun` | `read` |
| `reconcile.start` → `POST /reconcile` | JSON object body (`{}` valid): `dry_run` (boolean, default `false`), `lookback` (duration, optional) | `202` `ReconcileRun` | `operate` |

`ReconcileRun` (`.openapi('ReconcileRun')`), built by one mapper with the clock port's `now` for all
three routes and `health.get`:

```json
{
  "object": "reconcile_run", "run_id": 42, "trigger": "scheduled", "dry_run": false,
  "started_at": "2026-10-21T13:00:02.310Z", "finished_at": "2026-10-21T13:00:04.902Z",
  "horizon_start": "2026-10-18T12:50:02.310Z", "horizon_end": "2026-10-21T12:50:02.310Z",
  "checked": 3, "missing": 0, "replayed": 0, "failed": 0, "error": null
}
```

`error` is `null` or the registry error object of `runOutcome` (D3). `health.get` gains
`last_reconcile_run: ReconcileRun | null`, read in the request's one database attempt with the
storage read; a classified error nulls both. `run_id` is a JSON number (a `bigint` identity at
≈ 24 rows a day stays far below 2^53, pp-database → schema-and-repositories). `pnpm openapi:export`
regenerates the document and SDK types in the same change.

#### D28 — Readers and commands

`ListGapsReader` (`listSince`), `GetReconcileRunReader` (`get`; none → `run_not_found`),
`StartReconcileCommand` (D18). `ApiDeps` gains `reconcilerInvoke: AsyncFunctionInvokePort`.
`apps/api` wires `LambdaAsyncFunctionInvokeAdapter` over `RECONCILER_FUNCTION_NAME`; `apps/local`
the in-process one; `testApiDeps` a `FakeAsyncFunctionInvoke`. `POST /reconcile` joins `bodyErrors`
with fields `dry_run` and `lookback`; `/gaps`' `limit` and `after` messages join `routeFieldErrors`.

### Deploy command and scripts (`infra/scripts`)

#### D29 — Two deploy inputs

`deploy-env.schema.ts` gains `LEDGER_DEPLOY_RESEND_API_KEY` (optional, `^re_`) and
`LEDGER_DEPLOY_RESEND_WEBHOOK_ID` (optional, non-empty). Before contacting AWS it refuses, naming the
first offending variable and never its value, when exactly one is set, or when
`LEDGER_DEPLOY_WEBHOOK_SECRETS` is set without both. The id goes to CDK as `-c
ledger:resendWebhookId=<id>`; the key is written into `ResendApiKeySecretArn` after `cdk deploy`
with the existing `writeSecretIfChanged`, beside the database and simulator writes, printing
`aws:deploy: ledger/resend-api-key written`. With the key unset, no write runs.

#### D30 — Teardown, re-arm and trip-drill text

Teardown's closing steps outside AWS gain "revoke the Resend API key you made for the reconciler"
(a destroyed secret does not revoke the key at Resend, and a `full_access` key can read every
signing secret, RS-05, RS-18). `rearm.ts` and `trip-drill.ts` replace `then: ledger reconcile →
slice 4` with `then: pnpm -s ledger reconcile`.

#### D31 — The ingest route throttle (`packages/aws/src/ingest-route-throttle.ts`)

Over `readStage` and `withThrottle` (`http-api-stage.ts`):

- `lowerIngestRouteThrottle(client)` refuses when a `RouteSettings["POST /webhooks/resend"]` entry
  exists ("an ingest route setting exists: run pnpm aws:rearm"); otherwise writes it at the kill
  switch's stop values (`0` / `0`), which override the stage default (AWS-14).
- `restoreIngestRouteThrottle(client, { appStackName })` deletes that route setting
  (`DeleteRouteSettings`) only when the stack is not tripped (the worker's reserved concurrency is
  not `0`), because a trip writes the same values and the re-arm deletes every route setting
  (`kill-switch.ts:218-227`). It returns `restored` or `left: tripped`.
- `ingest-route-throttle.test.ts` over the `StubClient`, one named case each: refuse on an existing
  setting; lower writes `0/0`; restore deletes; restore on a tripped stack sends no delete.

#### D32 — `pnpm aws:gap-drill`

`gap-drill.ts` composes real steps; `run-gap-drill.ts` holds the order over injected steps (as
`run-deploy.ts` does). Lines prefixed `aws:gap-drill: `; the last is `done`, `refused: <reason>` or
`failed: <reason>` (exit 1). No line holds an id, key, URL or address.

- **Refuses before any change** when `LEDGER_URL` is not `LedgerApp`'s `ApiUrl` output; the stack is
  tripped; the queue or DLQ holds a message; the last run is unfinished (`health.get` through
  `@ledger/sdk`); `LEDGER_DEPLOY_RESEND_WEBHOOK_ID` or `RESEND_API_KEY` is unset; the UTC minute is
  outside `:02`–`:40` ("the hourly reconcile at :00 would overlap the drill"); or D31 refuses.
- **Steps:**
  1. Read the newest List Events page (the drill's own `resend-client`, `ledger-gap-drill`).
  2. Lower the ingest route throttle, with a `finally` that restores it (D31's guard).
  3. `sendEmail` from `onboarding@resend.dev` to `delivered@resend.dev`, subject `Ledger gap drill`,
     a one-line text, `Idempotency-Key` `ledger-gap-drill-<UTC timestamp>` (RS-42).
  4. Poll List Events every 2 s, up to 120 s, until two ids absent from step 1's page appear;
     print `events visible after <ms> ms` (first-seen time minus the newest item's `createdAt`,
     RS-U13).
  5. Wait until the newest event is older than the grace window plus 30 s, printing the wait.
  6. Restore the throttle, printing `ingest route restored`. Resend's next attempt is ≈ 35 min after
     the send (RS-09), so the restore precedes it.
  7. As child processes (`process.execPath` with `apps/cli/src/main.ts`, no shell, the drill's
     `LEDGER_URL` and `LEDGER_TOKEN`): `ledger reconcile --dry-run --json`; `ledger reconcile
     --json`; poll `ledger email <email_id> --json` every 2 s, up to 120 s, until `event_count` is
     2; `ledger reconcile --dry-run --json`; `ledger gaps --since 1h --json`. Print `dry run:
     missing <n>`, `reconcile: missing <n> replayed <n> failed <n>`, `stored 2 of 2`, `dry run:
     missing 0`, `gaps: newest run missing 0`. Any other count fails the drill.
  8. Compare each stored `event_created_at` with `retrieveWebhookEventCreatedAt`; print `created_at
     unchanged by the replay: yes | no` (RS-U10).
- Root script: `"aws:gap-drill": "node --env-file-if-exists=.env.local infra/scripts/gap-drill.ts"`.
- `run-gap-drill.test.ts`: each refusal changes nothing; a failure after the lower restores; a trip
  mid-drill leaves the setting; a count mismatch fails after restoring; no line holds the fake key.

### Ingest (`packages/ingest`)

#### D33 — `ingest.rejected{reason}`

- **`timestamp`:** `svix-timestamp` absent, not an integer (as `parseInt` reads it), or more than
  300 s from the clock port's now either way (Constraint 12). Checked before any `verify` call.
- **`signature`:** every other rejection (missing `svix-id` or `svix-signature`, no secret matching).
- Once per `401`: `metrics.count('ingest.rejected', 1, undefined, { reason })`, no field. The
  `ingest.request_rejected` log line stays as it is.

### Runbook and README

#### D35 — `docs/runbook.md`

- `## Procedures` → `### Rotate the webhook signing secret`, in PP C5's order: (1) rotate at Resend
  (`curl -X POST "https://api.resend.com/webhooks/$WEBHOOK_ID/signing-secret/rotate" -H
  "Authorization: Bearer $RESEND_API_KEY"`, Ask-first), which returns the new secret (RS-13);
  (2) `LEDGER_DEPLOY_WEBHOOK_SECRETS=<old>,<new>` and `pnpm aws:deploy`, live within 5 min
  (ADR-009); (3) `aws cloudwatch get-metric-statistics --namespace Ledger --metric-name
  ingest.rejected --dimensions Name=reason,Value=signature --statistics Sum --period 300
  --start-time <15 min ago> --end-time <now>` shows no datapoint above 0; (4) within 24 h of step 1
  (RS-04), `LEDGER_DEPLOY_WEBHOOK_SECRETS=<new>`, redeploy, watch again; (5) retired too early →
  deliveries answer `401` and Resend retries (RS-10): restore it, then `pnpm -s ledger reconcile`.
  Local mode: `LEDGER_WEBHOOK_SECRETS` and a restart.
- `### LedgerApp-reconcile-gap` under Alarms. **First:** `pnpm -s ledger gaps --since 2h`.
  **Then:** newest run `missing > 0` with no error → the next hourly run replays them, or `pnpm -s
  ledger reconcile` now; still missing → `ledger dlq inspect` (a dead event is missing until
  redriven) and whether the ingest route is throttled (a crashed gap drill: `pnpm aws:rearm`); a run
  with an error: `reconciler_not_configured`, `internal_error` and `run_abandoned` → their entries;
  the four codes whose `docs` point at Resend, inline (D44): `webhook_disabled` → re-enable the
  webhook in the dashboard or with `PATCH /webhooks/{id}`, then `pnpm -s ledger reconcile` (with
  RS-U05's result from D39); `resend_auth_failed` → the reconciler's key in
  `ledger/resend-api-key`, then `pnpm aws:deploy`; `rate_limited` and `resend_unavailable` → the
  next hourly run retries, and `rate_limited` repeating means another caller is spending the team's
  budget; no run → `ledger health` (`api_unavailable` means tripped). Expected after a gap drill,
  after a trip, before the first configured deploy. **Related:** ADR-007, AWS-64.
- `### reconciler_not_configured` under Error codes.
- Every "Slice 4 lands …" line becomes its command (D44): `:82` and `:102` → `pnpm -s ledger
  reconcile`; `:159` and `:168` → `pnpm -s ledger gaps`; `run_not_found`, `reconcile_in_progress`,
  `run_abandoned` (`:173-174, 197-198, 215-218`) → present tense with `pnpm -s ledger gaps` /
  `pnpm -s ledger reconcile`.
- `internal_error`: a run that ended `internal_error` is in `/ledger/LedgerApp-reconciler` under its
  `run_id`. The intro's log-group list gains `/ledger/LedgerApp-reconciler`.

#### D36 — README at the M1 boundary

- The status line says M1 is done and names what is not built yet (MCP, reactions, local `docker
  compose`), with no claim attached.
- Each reliability claim in "What Ledger does" links its evidence: duplicates and order (properties
  1–4, invariants 1 and 2, `record-event.command.int.test.ts`); bursts (slice 3's burst run in
  ADR-008's Evidence); database outages (`--chaos db-outage`, ADR-015); poison isolation (invariant
  4); recovery (`recovery.int.test.ts` and the recorded gap drill).
- Reconcile is "the same approach as the Ingester's open PR #13", not new.
- "Reacts" and "an MCP server" move to a "Planned for M2" list that states no behavior.
- One Demo section links the gap drill's recorded run and slice 3's runs. No deployed URL, no id.
- `node scripts/check-links.mjs` reports 0 broken.

### Experiments and `[Unverified]` rows

#### D37 — E1, the replay chain (RS-U01, RS-U20, RS-U02)

Recommended before `opsx:apply`; in any case before the slice is called done. All reads but step 4:
(1) List Events on the production webhook; (2) Retrieve Event on one stored event → `data.email_id`;
(3) `pnpm -s ledger email <email_id> --json` → the timeline's `svix_id`s equal the List Events ids:
**RS-U02**; (4) **Ask-first** replay of that event; (5) List Attempts → newest `http_status_code`
`200` on an event days older than 5 min: **RS-U20**; (6) `aws logs filter-log-events
--log-group-name /ledger/LedgerApp-worker --filter-pattern '"worker.duplicates"'` since the replay
→ one line with that `svix_id`, and `event_count` unchanged: **RS-U01**. Results become RS-44 (List
Events ids are delivered `svix-id`s) and RS-45 (a replay carries the original `svix-id` and a fresh,
passing `svix-timestamp`). No id is recorded. If step 5 or 6 fails, the card goes `[!]` and ADR-007
needs a superseding design before recovery is called done.

#### D38 — RS-U03, RS-U13 (read-only), RS-U17 (two pre-approved key writes)

RS-U03 on or after 2026-10-21: page List Events to `has_more: false`; the oldest event's age must
be ≥ 72 h. RS-U13: the gap drill's `events visible after <ms> ms`. RS-U17 (owner-ruled): create the
`sending_access` key `ledger-rs-u17`, revoke it (`DELETE /api-keys/{id}` → `"deleted": true`), then
one `GET /webhooks/{id}` with it and one with a well-formed key no account issued; record each
status and name, never a key. Expected: `400` `validation_error` "API key is invalid".

#### D39 — E3, disabled webhook (RS-U04, RS-U05)

On a throwaway webhook pointing at the deployed ingest URL, its secret not in the set (each delivery
answers `401`, visible in List Attempts, nothing reaches the ledger): create; send to
`delivered@resend.dev`; `PATCH` disabled; replay one event (a new attempt or none settles
**RS-U04**); send again (events created while disabled: **RS-U05** first half); `PATCH` enabled
(delivered then: second half); delete. Every write Ask-first. Held → both rows close safe in both
outcomes: the status is read before any replay; a disabled webhook that creates no event is outside
"every event Resend produced", and the runbook says so in the `webhook_disabled` step of
`LedgerApp-reconcile-gap` and in `LedgerApp-api-5xx`'s disabled-webhook step (`docs/runbook.md:81`).
The registry's `webhook_disabled` docs point at Resend, so the runbook has no entry under that code.

#### D40 — RS-U06, RS-U09, RS-U10, PG-U03

RS-U06 safe by the status read every run (the disabled-webhook test). RS-U09 safe both ways (one
`verify` per secret; the two-signature header case in `create-ingest.test.ts`). RS-U10 by the gap
drill's `created_at unchanged` line. PG-U03 safe both ways: Free never bills; a suspension or a full
store pauses the worker while the queue holds events (`database-outage.int.test.ts`, slice 3's
`--chaos db-outage`, ADR-015); the 30-day usage reading is a named event: 30 days after the
reconciler's first configured deploy, it goes beside [Cost shape](../../../.ai/aws.md#cost-shape).

#### D41 — Where each result lands

Each settled row is struck through with its RS or AWS fact; each safe-either-way row cites its test;
every change follows the [resend.md](../../../.ai/resend.md#unverified),
[aws.md](../../../.ai/aws.md#unverified) and [integrations.md](../../../.ai/integrations.md#unverified)
rules, in the change that records the result.

### Build-level choices (not in the PP)

#### D42 — File names

The async invoke files mirror the synchronous set already in the repo (`function-invoke.port.ts`,
`lambda-function-invoke.adapter.ts`, `in-process-function-invoke.adapter.ts`,
`testing/function-invoke-port-contract.ts`, `testing/fake-function-invoke.ts`), each prefixed
`async-` / named `…AsyncFunctionInvoke…`.

#### D43 — Where the recovery suite lives

`packages/reconciler/src/recovery.int.test.ts`, with `@ledger/ingest` and `@ledger/worker` as
`workspace:*` dev dependencies, the precedent `packages/api` set for its contract suite (pp-testing
→ vitest-layout). `onReplay(eventId)` signs the stored fixture with a test secret and calls the
composed ingest; the in-process queue feeds the real worker. The subject is the reconciler; no app
composes it for the test. Its fake clock starts at wall-clock time, because `started_at` (the
deadline's origin, D15) and `hasUnfinishedRun` read Postgres's `now()` (Data model, D6) while the
horizon and the limiter read the clock port: a clock started elsewhere puts the deadline hours away
from the limiter's `now`.

#### D44 — Runbook facts the PP's list missed

`docs/runbook.md:159` (`email_not_found`) and `:168` (`recipient_not_found`) also say "slice 4
lands `ledger gaps`"; PP D35's "every 'Slice 4 lands' line becomes a real command" covers them, and
its list named the other five. And PP D35's "a run carrying an error: follow that code's entry" has
no entry to follow for `webhook_disabled`, `rate_limited`, `resend_auth_failed` and
`resend_unavailable`, whose registry `docs` point at Resend's pages
(`packages/core/src/error-codes.ts:121-141`), so the gap-alarm entry handles those four inline
(D35). Neither loosens a rule.

#### D45 — Spec scenario names kept

OpenSpec 1.14.2 refuses a MODIFIED block that drops a scenario name (`validator.js` "omits
scenario(s)"). The scenarios named for five alarms and for "a code from a later slice" therefore
keep their names, with bodies rewritten to stay true (the five existing alarms named; the
later-slice rule stated generally), and each new fact is its own scenario.

#### D46 — The wait helper

`apps/cli/src/wait-for-run.ts` exports `RUN_POLL_INTERVAL_MS = 3_000` and
`RUN_WAIT_BACKSTOP_MS = 1_200_000`, with `sleep` injected (pp-cli → command-anatomy, Waiting).

#### D47 — `sleep` at the roots

`resend-client` and the gap drill take `sleep: (ms) => Promise<void>`; roots pass `setTimeout` from
`node:timers/promises`, and tests pass a fake that advances the fake clock, so no test waits in real
time.

#### D48 — `reconcilerInvoke` lands with every reader of the types it changes

`pnpm check` typechecks every project in one pass (root AGENTS.md → Commands), so a required
`ApiDeps.reconcilerInvoke` fails to compile in each `createApi` caller that does not pass it:
`apps/api/src/main.ts:61`, `apps/local/src/main.ts:127` and `packages/api/scripts/export-openapi.ts:39`.
A new `apiEnv` key fails the same way in `infra/src/function-env.ts` (`apiEnvironment` returns
`EnvOf<typeof apiEnv>`) and in `app.stack.test.ts:555` (the API's keys equal `apiEnv`'s). The
three callers, `apiEnv.RECONCILER_FUNCTION_NAME` and its value on the API function therefore land
in one task (8.1), and `LambdaAsyncFunctionInvokeAdapter` lands with the port it implements (4.1),
before `apps/api` needs it. `export-openapi.ts` passes an `InProcessAsyncFunctionInvokeAdapter`
over a no-op, as it passes `workerInvoke`. Rejected: an optional `reconcilerInvoke`, which would
compile while leaving `reconcile.start` able to insert a run nothing invokes.

### Evidence map

Each row: the claim, its test, and the mutation that makes it fail (run once, then revert).

| Claim (spec) | Test | Fails if |
| --- | --- | --- |
| Rate spacing, headroom, `retry-after`, quota and deadline (resend-client) | `limiter.test.ts` (fake clock, injected sleep) | the spacing is removed; the headroom check reads `remaining < limit`; a quota `429` is retried |
| Mapping, `5xx` retries, headers, no secret, no console output (resend-client) | `create-resend-client.test.ts` (fake API) | `404` from Retrieve Webhook maps to `internal_error`; `signing_secret` is returned; `logError` is not shadowed |
| Horizon, duration, outcome (reconciler) | `reconcile-horizon.prop.test.ts`, `parse-duration.test.ts`, `run-outcome.test.ts` | the anchor is ignored; the 30-day floor is dropped; `>` becomes `>=` at the budget |
| Closed sets, anchor choice, runtime role (reconciler) | `reconcile-runs.repository.int.test.ts` | the `CHECK` admits `run_abandoned`; the anchor omits `missing = 0` |
| Runs never overlap (reconciler, Ships 2) | `start-reconcile.command.int.test.ts` | the advisory lock is removed (two rows appear) |
| Claim before Resend (reconciler, Ships 2) | `reconciler.int.test.ts` | `claimed_at IS NULL` is dropped from the claim; `finished_at IS NULL` is dropped |
| Recovery past the retry schedule, out-of-order replay, 5-day gap, disabled webhook, `429` storm, backlog, failed replay, deadline, dry run, not configured (reconciler, Ships 2 and 3) | `recovery.int.test.ts` | the anchor is ignored (5-day case); the grace window ignores the queue age (backlog case); the status read is skipped (disabled case) |
| Failed hand-off finishes the row (read-api) | `start-reconcile.route.int.test.ts` | the second statement is removed (the next start answers `409`) |
| Routes, shapes, errors, abandoned derived (read-api, sdk, Ships 4) | `readApiContract` under `@hono/node-server` and the Lambda adapter; route int tests; `get-health.route.int.test.ts` | the mapper stores or skips `runOutcome` |
| CLI output, wait, backstop (cli, Ships 4) | `gaps-list.cli.test.ts`, `reconcile-start.cli.test.ts`, `health-get.cli.test.ts` | the wait tests a code literal instead of `error`; the notice goes to stdout |
| `ingest.rejected{reason}`, retired secret (webhook-ingest, Ships 5) | `create-ingest.test.ts`, `emf-metrics.adapter.test.ts`, `log-metrics.adapter.test.ts` | the TTL check is removed; the timestamp check runs after `verify` |
| Async invoke contract | `asyncFunctionInvokePortContract`, `lambda-async-function-invoke.adapter.test.ts` | the in-process adapter awaits the function |
| Function, schedule, invoke config, IAM, alarm, outputs (aws-stacks, Ships 2 and 11) | `app.stack.test.ts`, `runbook-links.test.ts`, `bundle-smoke.test.ts` | `maxEventAge` is removed; the alarm's evaluation window is removed |
| Deploy refusals and key write, teardown line, throttle, drill (deploy-and-teardown, Ships 9) | `run-deploy.test.ts`, `run-teardown.test.ts`, `ingest-route-throttle.test.ts`, `run-gap-drill.test.ts` | the `finally` restore is removed; the tripped guard is removed |
| Live replay semantics, reach, lag, the alarm email (Ships 6–9, 11) | the walk: E1, D38, the gap drill, E3 | — (`pnpm verify` cannot see Resend's real behavior) |

`pnpm sim` is unchanged; its invariants keep running in every stage they ran in.

## Data model

**`reconcile_runs`** (`packages/db/src/schema/reconcile-runs.ts`), an ops record: insert, claim
once, finish once. Owner-approved (proposal → Ask-first, Schema). Pure expand (ADR-018).

| Column | Type | Null | Notes |
| --- | --- | --- | --- |
| `id` | `bigint GENERATED ALWAYS AS IDENTITY` | no, PK | `run_id` on the wire; the page key |
| `trigger` | `text` | no | `reconcile_runs_trigger_check` from `reconcileTriggers` |
| `dry_run` | `boolean` | no | |
| `started_at` | `timestamptz DEFAULT now()` | no | row time; the budget's origin; `gaps.list`'s filter |
| `claimed_at` | `timestamptz` | yes | set by the claim (manual) or at insert (scheduled) |
| `finished_at` | `timestamptz` | yes | null while running |
| `horizon_start`, `horizon_end` | `timestamptz` | no | the window the run set out to check, fixed at start (PP C14) |
| `checked`, `missing`, `replayed`, `failed` | `integer DEFAULT 0` | no | `reconcile_runs_counts_check`: each `>= 0` |
| `error_code` | `text` | yes | `reconcile_runs_error_code_check` from `reconcileRunErrorCodes` |
| `updated_at` | `timestamptz DEFAULT now()` | no | set by every claim and finish (PP C8) |

Also `reconcile_runs_horizon_check` (`horizon_start <= horizon_end`). No foreign key, no `pgEnum`,
no `deleted_at`, no `tenant_id`, no `jsonb`, no PII, no secret, no index beyond the primary key
(≈ 24 rows a day; `gaps.list` and the anchor page backward on `id`). The idempotency key is the
start lock plus `hasUnfinishedRun`; a duplicate invoke changes zero rows at the claim.

Migrations: `pnpm db:generate --name create-reconcile-runs` → `0004_create-reconcile-runs.sql` (read:
one `CREATE TABLE`, named constraints, no `DROP`); `pnpm db:generate --name grant-reconcile-runs
--custom` → `0005_grant-reconcile-runs.sql`: `GRANT SELECT, INSERT, UPDATE ON reconcile_runs TO
<the runtime role>` (pp-database → Grants, the form `0003` uses). Both apply in one transaction. No
backfill, no `webhook_events` change.

### State machines

```text
                 manual start (API)               scheduled start (reconciler)
                        │                                  │
              inserted, claimed_at NULL          inserted, claimed_at = now()
                        │ claim (D16)                      │
                        ▼                                  ▼
                     claimed ─────────── the run (D15) ─────────► finished
                        │                                  (error_code NULL, or one of D1's six)
  invoke failed (D18) ──┴──► finished, internal_error
  no finished_at past the budget ──► read as run_abandoned (derived, never stored)
```

Transitions happen only through guarded `UPDATE`s, so a duplicate invoke, a late finish or a second
claim changes nothing. No order comes from transport.

## Surfaces

### `gaps.list` → `ledger gaps [--since <duration>] [--json]`

`limit: 100`, `--since` passed as given; `has_more` → stderr `ledger: more runs exist; showing the
newest 100.`. Rows aligned to their widest cell, the last unpadded; empty → `  —`:

```text
  43   manual      dry run   2026-10-21T13:25:40.120Z   checked 2   missing 0   replayed 0   failed 0   ok
  42   manual                2026-10-21T13:24:10.554Z   checked 2   missing 2   replayed 2   failed 0   ok
  41   scheduled             2026-10-21T13:00:02.310Z   checked 0   missing 0   replayed 0   failed 0   ok
```

The outcome column is `ok`, `running`, or `error.code` as sent. `--json`: the list as returned.

### `reconcile.start` + `reconcile.getRun` → `ledger reconcile [--dry-run] [--lookback <duration>] [--no-wait] [--json]`

stderr `ledger: reconcile run <run_id> started; follow it with ledger gaps.`; `--no-wait` prints the
`202` run, exit `0`; otherwise poll every 3 s until `finished_at` or `error`; a run with `error`
exits `1` in the error shape; the 20-minute backstop exits `1` with `internal_error` (under
`--json`) or the constant defect line. Finished, no error:

```text
run 42   manual
started    2026-10-21T13:24:10.554Z
finished   2026-10-21T13:24:14.008Z
horizon    2026-10-18T13:14:10.554Z → 2026-10-21T13:14:10.554Z
checked 2   missing 2   replayed 2   failed 0
```

A dry run's first line: `run 43   manual   dry run`. At 3 s, a full 14-minute run is 280 polls,
inside the throttle and the free tiers.

### `health.get` → `ledger health`

One line after `database`: `reconcile   run 42 finished 2026-10-21T13:24:14.008Z, missing 2,
replayed 2` · `reconcile   run 42 running` · `reconcile   run 42 <error.code>` · `reconcile   no run
yet` · `reconcile   —` (database unreachable).

### Error codes raised

Every `message`, `hint` and `docs` is the registry's. Route-specific `validation_failed` messages:

| Field | `message` |
| --- | --- |
| `since` | `since must be a duration from 1m to 30d, such as 24h.` |
| `lookback` | `lookback must be a duration from 1m to 30d, such as 72h.` |
| `dry_run` | `dry_run must be true or false.` |
| `POST /reconcile` body | `The request body must be a JSON object with optional dry_run and lookback fields.` |
| `run_id` | `run_id must be a positive integer.` |
| `after` on `/gaps` | `after must be a run id, a positive integer.` |
| `limit` on `/gaps` | `limit must be an integer from 1 to 100.` |

Run outcomes reach the CLI as `error`: `webhook_disabled`, `rate_limited`, `resend_auth_failed`,
`resend_unavailable`, `reconciler_not_configured`, `internal_error`, `run_abandoned`.

### Environment

Public (`.env.example`, names only; api-contract.md → Conventions):

```text
# Reconciler's full_access Resend key, read by pnpm aws:deploy (slice 4); optional, with the webhook id.
LEDGER_DEPLOY_RESEND_API_KEY=
# The Resend webhook id the reconciler lists and replays, read by pnpm aws:deploy and pnpm aws:gap-drill (slice 4).
LEDGER_DEPLOY_RESEND_WEBHOOK_ID=
```

`RESEND_API_KEY`'s comment gains "and `pnpm aws:gap-drill`". Internal: `reconcilerEnv` (D21) and
`apiEnv.RECONCILER_FUNCTION_NAME` (D22), never in `.env.example`.

### PII

List Events items hold no PII (RS-14). Retrieve Webhook's secret and endpoint never leave
`resend-client` (D9). Retrieve Event's payload holds raw addresses (RS-15); only the drill calls it
and only `created_at` leaves the client. `reconcile_runs` holds counts, timestamps and closed-set
codes. `ReconcileRun` holds no payload; the mapper's unit test asserts its exact key set. Fixtures use
`delivered@resend.dev` and `bounced@resend.dev` only.

## Walkthrough plan

`WALKTHROUGH.md` in this folder, in the
[walkthrough format](../../../.agents/skills/rsa-manual-test/references/walkthrough-format.md). Before
you start: `pnpm install`, `pnpm dev:full` (path A); the deployed values from `.env.deployed.local`
in the shell (B–F). Ask-first steps: B2, C4, C7, D1, E1–E7.

- **A — Local, Operator:** `ledger gaps --json` (`"object": "list"`); `ledger reconcile --dry-run
  --json` (exit `1`, the run-id notice, `reconciler_not_configured`); `ledger gaps` (the row ends
  that code); `ledger health` (`reconcile   run <n> reconciler_not_configured`); `--lookback 31d`
  and `--since 2x` (exit `1`, `validation_failed` naming the field); `--no-wait --json` (exit `0`,
  `"finished_at": null`).
- **B — Deployed, Operator:** only the key set → `refused: … LEDGER_DEPLOY_RESEND_WEBHOOK_ID`;
  **Ask-first** `pnpm aws:deploy` (`ledger/resend-api-key written`, `KillSwitchArmed`, `done`);
  `ledger health` (a `reconcile` line); after the next `:00`, `ledger gaps --since 2h --json` (a
  `scheduled` run, `missing 0`, `error: null`); `describe-alarms` for `LedgerApp-reconcile-gap` →
  `OK` after a clean hour.
- **C — E1 and the reads, Operator:** C1–C3 List Events, Retrieve Event, `ledger email` (RS-U02),
  the reach (RS-U03, on or after 2026-10-21); **Ask-first** C4 replay; C5 attempts (RS-U20); C6
  `worker.duplicates` (RS-U01); **Ask-first (pre-approved)** C7 the RS-U17 key create, revoke and
  two reads.
- **D — One real gap (J3), Operator:** **Ask-first** `pnpm aws:gap-drill` between `:02` and `:40`
  (D32's lines, RS-U13, RS-U10, `done`); `ledger gaps --since 1h` (three runs); `ledger health`;
  the alarm email within ≈ 1 h, then `OK` after a clean hour (Ships 11).
- **E — E3, Operator:** E1–E7, each **Ask-first**; held → RS-U04 and RS-U05 close safe either way.
- **F — M1 review, Reviewer:** mint a `read` token `review-walk`; `ledger gaps --since 24h` (exit
  `0`); `ledger reconcile --dry-run --json` (exit `1`, `forbidden`, no new run); `node
  scripts/check-links.mjs` (0 broken) and a desk check that each README claim opens its evidence.
- **Teardown:** T1 revoke `review-walk`.
- **Cannot reach today:** MCP `list_gaps` and `reconcile` → slice 5; RS-U03 past 30 days → slice 7; a
  live local reconcile → the Deferred tripwire (D23).

## Risks / Trade-offs

- [RS-U01 false: a replay lands under a new `svix-id`] → E1 before apply (D37); a negative result
  puts the card `[!]` and stops recovery from being called done.
- [RS-U20 false: replays fail the timestamp window] → E1 step 5, same consequence.
- [The drill's throttle stays at `0` after a crash] → the drill refuses to start over an existing
  route setting (D31); the gap alarm fires at the next hour; its runbook entry names `pnpm
  aws:rearm`.
- [A version bump renames the SDK's `logError`] → the console-silence unit test fails (D9).
- [A persistently missing event pins the anchor; each hour pages up to 30 days] → bounded by the
  run's budget and the limiter's headroom yield; the gap alarm stays `ALARM`; `ledger gaps` shows the
  same `missing` each hour.
- [RS-U03: List Events reaches less than 72 h] → D38's read; the runbook and README state the
  measured reach.
- [The owner's next redeploy without the two variables] → refused by design (D29), naming the
  variable.
- [The alarm fires at expected times and is ignored] → the runbook lists the expected firings; one
  email per incident, no OK action.
- [A sliding evaluation window would keep the alarm `OK` while the reconciler is silent] → removed
  by the wall clock window (D24, C21) and its `Template` assertion; walk B5 and D4 confirm it live.
- [Hourly invokes queued during a trip run back to back on re-arm] → removed by `maxEventAge: 60`
  (D20, C15) and its `Template` assertion.

## Migration Plan

1. Merge with the two migrations; `pnpm aws:deploy` applies them before `cdk deploy` (existing
   order). `reconcile_runs` is new and empty; nothing else changes shape.
2. The owner creates the dedicated `full_access` key and sets `LEDGER_DEPLOY_RESEND_API_KEY` and
   `LEDGER_DEPLOY_RESEND_WEBHOOK_ID` (PP §25). Until then every run ends `reconciler_not_configured`
   and the gap alarm says so.
3. **Ask-first:** the redeploy. Its approval covers the reconciler's hourly replays on the
   production webhook.
4. **Rollback:** redeploy the previous commit. The `reconcile_runs` table stays (expand-only; nothing
   reads it), and `ledger/resend-api-key` is destroyed with the stack only at teardown; revoke the
   key at Resend if the reconciler is retired (D30).

## Open Questions

- **RS-U01 / RS-U20 outcome (E1).** Not a design choice but a gate: a negative result stops the slice
  at `[!]` (D37). The owner may run E1 before apply (recommended) or during the walk.
- **RS-U03** cannot be read before 2026-10-21, because the webhook's oldest event is from
  2026-10-18; it waits for the date, and the slice cannot close before it.
- **E3** may be held by the owner; RS-U04 and RS-U05 then close safe either way (D39), with no change
  to code or specs.
