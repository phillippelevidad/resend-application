# Proposal — slice 4: Recovery

## Why

Slice 4 is the next spine card and closes M1 ([build-checklist → 4](../../../.ai/build-checklist.md#4--recovery)).
Slice 3 made the deployed stack operable, but the No-loss invariant still has a hole that only
recovery fills: an event Resend gave up on after its ≈ 27.6 h retry schedule (RS-09) never reaches
`webhook_events`. Its evidence still reads "Pending — 'down past the retry schedule' fake-API
integration test (slice 4)" ([Reliability core](../../../.ai/architecture.md#reliability-core)), and
the **Evidence** lines of [ADR-007](../../../.ai/architecture.md#adr-007--recovery-by-id-diff-and-replay-through-ingest),
[ADR-009](../../../.ai/architecture.md#adr-009--multi-secret-verification-and-timestamp-tolerance) and
[ADR-012](../../../.ai/architecture.md#adr-012--resend-client-is-the-sole-resend-api-caller) are
pending on this slice. RS-U01, RS-U02 and RS-U20 MUST be settled here, because the id-diff design
rests on them ([Open questions owed by slice](../../../.ai/architecture.md#open-questions-owed-by-slice)).
The build cost is moderate: the scaffolds exist, `resend@6.33.0` is already locked, every AWS client
is installed in `packages/aws`, the registry holds every run outcome but one, and the slice adds one
table.

The decision-complete brief is the checked pre-proposal
[2026-10-19-slice-4-recovery.md](../../../.ai/pre-proposals/2026-10-19-slice-4-recovery.md) (cited
below as *PP*; checked 2026-10-19: 31 repaired, 2 for the owner, both ruled). Every decision it
settles (D1–D41, C1–C22) is carried forward unchanged.

## What Changes

The card's `Ships` list, verbatim. Each bullet's state on `HEAD` is PP §5's (re-checked 2026-10-19:
only the PP and its two repairs have landed since `5fe2a51`; no code changed).

1. `packages/resend-client` with one 2 req/s limiter that yields on low `ratelimit-remaining` and waits `retry-after` on `429`, every response checked and mapped by status then name; evidence: limiter unit tests.
2. Reconciler on the hourly cron and on demand writes one `reconcile_runs` row per run, claims it before any Resend call (`claimed_at`, invoke `MaximumRetryAttempts: 0`) and never overlaps; evidence: an integration test where two concurrent starts yield one run and one `reconcile_in_progress`, one where a second invoke of a claimed run makes no Resend call, and a fake-API integration test where an outage past the retry schedule ends 100 % recovered with 0 duplicates, and a 5-day gap since the last good run is recovered with no `--lookback`.
3. A disabled webhook stops the run with `webhook_disabled`, and a `429` storm with `retry-after` still completes; evidence: fake-API integration tests.
4. `ledger gaps [--since]` and `ledger reconcile [--dry-run] [--lookback] [--no-wait]`, polling until the run is finished or `run_abandoned`, with the last run in `ledger health`; evidence: SDK ↔ API contract tests (a run with no `finished_at` past its time budget reads `run_abandoned`) and CLI `--json` output tests.
5. Rotation runbook entry, and ingest emitting the `ingest.rejected{reason}` metric the runbook watches; evidence: unit test with a fake clock where a secret removed from the store gets `401` once the 5-minute cache TTL passes and emits `ingest.rejected` with `reason=signature`.
6. RS-U01 and RS-U20 settled by one Ask-first replay of a stored event on the owner's webhook; RS-U02 settled read-only by comparing stored `svix_id`s with List Events ids.
7. RS-U03 reach of at least the 3-day lookback, RS-U13 visibility lag and RS-U17 revoked-key status closed by read-only checks; PG-U03 proved safe either way (Free never bills; a quota suspension or a full store pauses the worker while the queue holds events, ADR-015), its row citing that, with the 30-idle-day usage reading added beside aws.md → Cost shape when it exists; RS-U06 proved safe by the status read every run.
8. RS-U04 and RS-U05 closed by the Ask-first disabled-webhook experiments, RS-U09 by an Ask-first secret rotation on a test webhook, RS-U10 by the RS-U01 replay, or each proved safe either way, its row citing the result.
9. A gap script for the owner's deployment produces one real gap: it lowers the ingest route throttle to its stop value, makes one Ask-first send to `delivered@resend.dev`, restores the throttle after the grace window and before Resend's next scheduled retry (RS-09), then runs `ledger reconcile --dry-run` (1 missing), `ledger reconcile` and `ledger gaps` (0 missing); evidence: the recorded run.
10. M1 boundary: the README states only claims whose evidence landed in slices 0–4, with 0 unlinked claims and the CI link check green.

**Owner rulings on the card (2026-10-19), applied by task 1.1** before anything is built, because a
new or reworded bullet is a scope change that starts at the card
([How to work this checklist](../../../.ai/build-checklist.md#how-to-work-this-checklist)):

- **Ships 11 added** (PP D24, C6): "An alarm `LedgerApp-reconcile-gap` on `reconcile.missing` fires when a run finds missing events or no run finishes cleanly in an hour, with its runbook entry; evidence: a CDK assertion test, the alarm-to-runbook link check, and the alarm email from the recorded gap-script run."
- **Ships 7's RS-U17 clause** (PP D38): the opening becomes "RS-U03 reach of at least the 3-day lookback and RS-U13 visibility lag closed by read-only checks, and RS-U17 revoked-key status closed by one Ask-first create and revoke of a throwaway key and a read with it". It tightens RS-U17's evidence and leaves RS-U03 and RS-U13 read-only. The owner's ruling clears the [rule gate](../../../AGENTS.md#never-loosen-a-rule-to-fit-what-was-built).
- **Ships 9's two counts, corrected as facts** (PP C3, C4): "(1 missing)" becomes "(the send's events missing, RS-39)", because `delivered@` produces two events and List Events lists events. "`ledger reconcile` and `ledger gaps` (0 missing)" becomes "`ledger reconcile`, a final `ledger reconcile --dry-run` and `ledger gaps` (0 missing)", because `gaps.list` reads recorded runs only and the real run records `missing` 2. Neither loosens the bullet.

Task 1.1 edits the card and the quotes above in one step.

How each bullet lands, in one line (detail in [design.md](design.md)):

- **1:** `createResendClient` over the pinned SDK: five named methods, a hand-rolled limiter
  (rate, headroom, `retry-after`, deadline), bounded `5xx` retries, status-then-name mapping, the
  SDK's console logger silenced, and a `node:http` fake Resend API (PP D9–D13).
- **2:** the `reconcile_runs` table and repository, a start under one advisory lock in both
  triggers, a guarded claim, the run in ADR-007's order with the anchored horizon, `apps/reconciler`
  on an hourly schedule and an async invoke capped at 0 retries and 60 s of age (PP D2–D7,
  D14–D22, D25).
- **3:** the run reads the webhook's status before any List Events call; the limiter waits out
  `retry-after` inside the run's deadline (PP D10, D15).
- **4:** `GET /gaps`, `GET /reconcile/runs/{run_id}`, `POST /reconcile` (`202`), and
  `last_reconcile_run` on `health.get`; three SDK methods; `ledger gaps`, `ledger reconcile` with its
  wait and backstop, and a `reconcile` line in `ledger health` (PP D27, D28, §12).
- **5:** `ingest.rejected` with a typed `reason` dimension (`signature` | `timestamp`), the
  retired-secret test, and the runbook's rotation procedure in the corrected order (PP D8, D33–D35,
  C5).
- **6–8:** E1 (one replay, five reads), the read-only RS-U03 and RS-U13 readings, the RS-U17
  revoked-key read, E3 on a throwaway webhook or held for safe-either-way, and RS-U06, RS-U09,
  RS-U10 and PG-U03 closed as PP D40 states (PP D37–D41).
- **9:** `pnpm aws:gap-drill`, over a new ingest-route throttle step that refuses an existing route
  setting and restores only an untripped stack (PP D31, D32).
- **10:** the README rewritten at the M1 boundary, each reliability claim linked to its evidence
  (PP D36).
- **11:** `LedgerApp-reconcile-gap` on a wall clock evaluation window, so an hour with no clean run
  reads breaching (PP D24, C21).

No **BREAKING** change. `MetricsPort.count` gains an optional fourth parameter, and `health.get`
gains a field. Both are additive.

**Out of scope** (PP §3): the card's Deferred tail ("RS-U03 re-measured before M2 closes (slice 7).
MCP `list_gaps` and `reconcile` (slice 5).") plus, each with its carrier in PP §3: a live reconciler
in local mode (a new Deferred row; local runs end `reconciler_not_configured`); SDK retries for the
new reads (slice 5); a secret-rotation experiment (RS-U09 proved safe either way); `--lookback`
beyond 30 days (categorical, RS-31); a stored run `status` (superseding ADR only); automatic DLQ
redrive after a replay (superseding ADR only); the dispatcher, outbox and alert emails (slice 6);
scripted webhook creation (existing tripwire); Retrieve Event's payload anywhere but the gap drill's
`created_at` check.

## Capabilities

### New Capabilities

- `reconciler`: recovery runs: the start lock and overlap refusal, the claim, the webhook status
  read, the grace window and the anchored horizon, replay through ingest only, the registered run
  outcomes with `run_abandoned` derived on read, dry runs, the hourly schedule and async invoke
  bounds, and the gap alarm (PP §14 rules 1–10 and 14, Ships 11).
- `resend-client`: the sole Resend API caller: the limiter, status-then-name mapping with its
  default branch, bounded `5xx` retries, the required headers, and no response body, key or signing
  secret in any output (PP §14 rules 11 and 12).

### Modified Capabilities

Mapped in PP §23. Eight more requirements change as fact corrections that follow from the PP's
decisions: the OpenAPI document's operation count (thirteen, D27); the secret and alarm counts in
"Cost-brake properties", "The simulator secret exists only with the flag" and "Every alarm
describes itself" (D24, D21); "exactly one schedule" in "The hourly resume schedule" (D25); the
`ResendApiKeySecretArn` output in "The app stack's outputs" (D26); the re-arm's `then:` line (D30);
and the runbook's "a code from a later slice" scenario, whose operation this slice lands (D35).

- `read-api`: ADDED `gaps.list`, `reconcile.getRun`, `reconcile.start` and their errors; MODIFIED
  "health.get reports the pipeline" (the last run), "Health answers during a database outage" (one
  attempt, the last run nulled) and "OpenAPI document" (thirteen operations).
- `sdk`: ADDED the gaps and reconcile methods, `reconcile.start` never retried.
- `cli`: ADDED `ledger gaps` and `ledger reconcile` with its wait and backstop; MODIFIED "ledger
  health" (the `reconcile` line).
- `webhook-ingest`: ADDED "Rejections are counted by reason"; MODIFIED "The secret set refreshes
  within 5 minutes" (the retired-secret scenario).
- `aws-stacks`: ADDED the reconciler function, its schedule, its invoke config, its IAM and the gap
  alarm; MODIFIED "Cost-brake properties", "Each function's environment is exactly its names",
  "Secrets least privilege", "The hourly resume schedule", "The app stack's outputs", "Operational
  alarms email through the alert topic", "Every alarm describes itself and links its runbook entry"
  and "The simulator secret exists only with the flag".
- `deploy-and-teardown`: MODIFIED "Deploy inputs are asserted first" (PP D29's refusals),
  "Teardown order and the post-destroy listing" (the revoke line) and "Scripted re-arm" (the real
  command); ADDED "Deploy writes the reconciler's key" and "The gap drill".
- `operations-runbook`: MODIFIED "Every alarm has a runbook entry" (six) and "Every runbook-linked
  error code has a runbook entry" (the new code; slice 4's operations now real); ADDED "The rotation
  procedure".
- `local-stack`: ADDED "Local reconcile runs end not configured".

## Impact

- **Code:** `packages/core` (run constants, `parseDuration`, `reconcileHorizon`, `runOutcome`,
  events, `reconciler_not_configured`, closed sets), `packages/shared` (async invoke port, in-process
  adapter, contract suite, fake; `MetricsPort` dimension; `reason` log field; `reconcilerEnv`),
  `packages/db` (`reconcile_runs` schema, two migrations, repository, `presentSvixIds`),
  `packages/resend-client` (logic lands), `packages/reconciler` (logic lands), `packages/ingest`,
  `packages/api`, `packages/sdk`, `packages/aws` (Lambda async invoke adapter, ingest-route
  throttle, stack names), `apps/reconciler` (logic lands), `apps/api`, `apps/local`, `apps/cli`,
  `infra` (stack, tests, deploy, teardown, re-arm, trip drill, gap drill), `docs/runbook.md`,
  `README.md`, `.env.example`.
- **Public contract:** three operations that api-contract.md already names, with PP D27's wire
  shapes, plus `last_reconcile_run` on `health.get`; three SDK methods; two CLI commands and a
  health line; one registry code; two public variables; one root script.
- **Schema:** one new table, `reconcile_runs`, pure expand, with its grant migration. No frozen
  migration is touched.
- **AWS:** `LedgerApp-reconciler` and its log group, `ledger/resend-api-key` (USD 0.40/month,
  AWS-11), `LedgerApp-reconcile-hourly`, one `EventInvokeConfig`, `LedgerApp-reconcile-gap` (6 of
  AWS-28's 10 free), IAM, and one output. No always-on resource.
- **Resend:** the reconciler's hourly reads and replays on the production webhook once a deploy
  configures it; E1, the gap drill and E3 are owner-approved writes at walk time.
- **Docs** (PP §22): the build-checklist card, api-contract.md, architecture.md (ADR-007 amended,
  ADR-009, ADR-012, Reliability core, Risks, Technology, Deferred, Open questions owed by slice),
  data-modeling.md, resend.md (RS-44, RS-45, eleven `[Unverified]` rows), aws.md (AWS-63, AWS-64,
  AWS-28, Cost shape, Teardown), integrations.md, about.md, features.md, check-before-launch.md,
  root AGENTS.md, `.env.example`, and fact updates in pp-backend, pp-cli, pp-infra, pp-testing,
  pp-general and rsa-manual-test `environment.md`, plus `WALKTHROUGH.md` in this folder. The only
  card rewording that tightens a rule is Ships 7's RS-U17 clause, which the owner ruled.

**Ask-first items** ([root AGENTS.md → Permissions](../../../AGENTS.md#permissions)), from the owner's
itemized round of 2026-10-19 (PP §7, approvals table):

| Item | Exact scope approved | Status | PP §7 row |
| --- | --- | --- | --- |
| Dependency | `resend` at exactly `6.33.0` (already locked through `packages/ingest`) in `packages/resend-client/package.json`. The workspace links (`@ledger/resend-client` in `packages/reconciler` and `infra`; `@ledger/reconciler` in `apps/reconciler` and `apps/local`; `@ledger/sdk` in `infra`) are boundary declarations | approved | 1 |
| Schema / migration | `reconcile_runs` (PP §8): `0004_create-reconcile-runs.sql` (generated) and `0005_grant-reconcile-runs.sql` (custom: `GRANT SELECT, INSERT, UPDATE` to the runtime role) | approved | 2 |
| Public contract | `GET /gaps?since&limit&after`, `GET /reconcile/runs/{run_id}`, `POST /reconcile` (`202`) with PP D27's shapes; `health.get`'s `last_reconcile_run`; SDK `ledger.gaps.list`, `ledger.reconcile.getRun`, `ledger.reconcile.start`; CLI `ledger gaps [--since <duration>] [--json]`, `ledger reconcile [--dry-run] [--lookback <duration>] [--no-wait] [--json]` and the `reconcile` health line; registry row `reconciler_not_configured`; the api-contract edits in PP §22 | approved | 3 |
| Public variables and commands | `LEDGER_DEPLOY_RESEND_API_KEY` and `LEDGER_DEPLOY_RESEND_WEBHOOK_ID`, read by `pnpm aws:deploy`; `pnpm aws:gap-drill`, which reads `LEDGER_URL`, `LEDGER_TOKEN`, `RESEND_API_KEY` and `LEDGER_DEPLOY_RESEND_WEBHOOK_ID` | approved | 4 |
| Template resources | `LedgerApp-reconciler` and `/ledger/LedgerApp-reconciler`; `ledger/resend-api-key`; `LedgerApp-reconcile-hourly`; one `AWS::Lambda::EventInvokeConfig` (`MaximumRetryAttempts: 0`, `MaximumEventAgeInSeconds: 60`); IAM (PP D22); the read API's `lambda:InvokeFunction` on the reconciler; `LedgerApp-reconcile-gap`; output `ResendApiKeySecretArn` | approved | 5 |
| AWS runs | Each `pnpm aws:deploy`, the gap drill, and every read-only `aws` CLI read in the walk | **held**, approved per action at walk time | 6 |
| RS-U17 key | One create and one revoke of the throwaway `sending_access` key `ledger-rs-u17` (PP D38) | approved | 7a |
| Live Resend writes | Creating the reconciler's `full_access` key; E1's one replay; E3's create, two sends, two `PATCH status`, one replay, one delete; the gap drill's send and its reconcile's replays; and, by the redeploy, the reconciler's automatic hourly replays on the production webhook | **held**, approved per action at walk time; the redeploy's approval covers the hourly replays | 7 |

Not needed: no CI change (every new test runs in an existing `pnpm verify` stage). Anything outside
these rows (another variable, flag, route field, resource or dependency) stops for the owner at
apply.
