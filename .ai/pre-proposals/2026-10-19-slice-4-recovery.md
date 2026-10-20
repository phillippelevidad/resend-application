# Pre-proposal — slice 4: Recovery

| Field | Value |
| --- | --- |
| **Slice** | 4 — [Recovery](../build-checklist.md#4--recovery) |
| Change name | `slice-4-recovery` → `openspec/changes/slice-4-recovery/` (`openspec/changes/` holds only `archive/`: slices 0, 1, 2 and 3) |
| Date | 2026-10-19 |
| Card status | `[ ]` (0 of 10 `Ships` boxes ticked; an 11th bullet is owner-ruled in this run, §2) |
| Depends on | 3 — `[x]`. Slice 2 is still `[!]` (Ships 7's AWS-U01 half) with Ships 9, 11, 12 and 15 unticked; see §4 |
| Track | Spine (0 → 1 → 2 → 3 → **4** → 5 → …); the M1 boundary |
| Touches | `packages/core`, `packages/shared`, `packages/db`, `packages/resend-client` (logic lands), `packages/reconciler` (logic lands), `packages/ingest`, `packages/api`, `packages/sdk`, `packages/aws`, `apps/reconciler` (logic lands), `apps/api`, `apps/local`, `apps/cli`, `infra` (stack and scripts), `docs/runbook.md`, `README.md`, `.env.example`, `.ai/` docs, root `AGENTS.md`, six skills' text |
| Earlier pre-proposal | None for this slice |
| Branch | `worktree-slice-4-reconcile` (at `5fe2a51`, clean) |
| Owner round | 2026-10-19: two decisions (D1 the `reconciler_not_configured` code, D24 the `LedgerApp-reconcile-gap` alarm) and the itemized Ask-first approvals (§7), items 1–5 approved, AWS runs and live Resend writes held per action |
| Checked | 2026-10-19: 31 repaired, 0 for the owner |

## 1. Why now

Slice 4 is the next spine card and closes M1. Slice 3 made the deployed stack operable: alarms
with runbook entries, DLQ inspect and redrive, and measured burst, outage and poison runs. But
the No-loss invariant still has a hole that only recovery fills: an event Resend gave up on after
its ≈ 27.6 h retry schedule (RS-09) never reaches `webhook_events`. Its evidence line still reads
"Pending — 'down past the retry schedule' fake-API integration test (slice 4)"
([Reliability core](../architecture.md#reliability-core)). Three ADRs carry pending evidence that
only this slice can land ([ADR-007](../architecture.md#adr-007--recovery-by-id-diff-and-replay-through-ingest),
[ADR-009](../architecture.md#adr-009--multi-secret-verification-and-timestamp-tolerance),
[ADR-012](../architecture.md#adr-012--resend-client-is-the-sole-resend-api-caller)). Three
`[Unverified]` rows MUST be settled here, RS-U01, RS-U02 and RS-U20, because the id-diff design
rests on them ([Open questions owed by slice](../architecture.md#open-questions-owed-by-slice)).
The build cost is moderate. The scaffolds exist, `resend@6.33.0` is already locked, every AWS
client the slice needs is installed in `packages/aws`, the error registry already holds every run
outcome but one, and the slice adds one table. Slice 5's MCP `list_gaps` and `reconcile` tools are
thin wrappers over the operations this slice ships.

## 2. Scope — the `Ships` list, verbatim

From [build-checklist.md → 4](../build-checklist.md#4--recovery) (the bullets carry no links):

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

**Owner-ruled addition (2026-10-19, D24), added to the card by the change's first task** (a new
bullet is a scope change, so the card is edited before anything is built,
[How to work this checklist](../build-checklist.md#how-to-work-this-checklist)):

11. An alarm `LedgerApp-reconcile-gap` on `reconcile.missing` fires when a run finds missing events or no run finishes cleanly in an hour, with its runbook entry; evidence: a CDK assertion test, the alarm-to-runbook link check, and the alarm email from the recorded gap-script run.

Bullet 9's two counts are corrected as facts in the same first task (C3, C4): "(1 missing)" becomes
"(the send's events missing, RS-39)", and "`ledger gaps` (0 missing)" reads the run of a final
`ledger reconcile --dry-run`. Neither loosens the bullet: each states what the evidence will show.

## 3. Out of scope

The card's `Deferred tail`, verbatim, links rewritten:

> RS-U03 re-measured before M2 closes ([slice 7](../build-checklist.md#7--polish-and-retention)). MCP `list_gaps` and `reconcile` ([slice 5](../build-checklist.md#5--mcp-server-and-contract-hardening)).

The harvest also suggested these, which the card does not carry:

| Not built | Why | Carried by / tripwire |
| --- | --- | --- |
| A live reconciler in local mode | No adopter recovers locally: Resend replays to the webhook's endpoint, which is the deployed ingest URL. A local live reconcile against the production webhook would diff a local database against production and replay every event to production ([§12](#12-surfaces), D23). Local runs end `reconciler_not_configured` | Temporal: a new [Deferred (YAGNI)](../architecture.md#deferred-yagni) row. Tripwire: slice 2B lands `docker compose`, or the first walk that must replay into a local process through a `resend webhooks listen` session |
| SDK retries for the new reads | Every read is retried from slice 5 ([api-contract.md → Conventions](../api-contract.md#conventions), Idempotency) | [Slice 5](../build-checklist.md#5--mcp-server-and-contract-hardening) |
| A secret-rotation experiment (RS-U09) | Proved safe either way, as the card allows (D40): ingest verifies one secret per call, and a header carrying two signatures already verifies under either ([create-ingest.test.ts](../../packages/ingest/src/create-ingest.test.ts)). Capturing the overlap header needs a header-logging receiver no claim depends on | Tripwire: a delivery fails verification during a rotation |
| `--lookback` beyond 30 days | Resend keeps email data 30 days (RS-31). A validation bound in api-contract.md | Categorical below the ceiling ([api-contract.md → reconcile.start](../api-contract.md#reconcilestart)) |
| A run `status` column or wire field | The lifecycle is `claimed_at` and `finished_at`, and `run_abandoned` is derived on read, never stored (ADR-007). A stored status could disagree with both (C7) | Superseding ADR only |
| Automatic DLQ redrive after a replay | A dead-lettered event is replayed once per run until it is redriven or purged; the DLQ alarm shows it (ADR-007, ADR-015's rejected option) | Superseding ADR only |
| The dispatcher, the outbox, alert emails | [Slice 6](../build-checklist.md#6--reactions) | Slice 6 |
| Scripted webhook creation | Existing tripwire ([Deferred](../architecture.md#deferred-yagni)) | A redeploy changes the ingest URL |
| Retrieve Event's payload anywhere but the gap drill's `created_at` check | It holds raw addresses (RS-15, RS-27); only RS-U10's comparison needs it, and only its `created_at` | Never on a read-API surface ([PII & retention](../data-modeling.md#pii--retention)) |

## 4. Prerequisites

| Prerequisite | State | Blocking? |
| --- | --- | --- |
| Slice 3 `[x]` | Done 2026-10-19 | No |
| Slice 2 `[x]` | `[!]` on Ships 7 (AWS-U01's budget half, owner left open 2026-10-18); Ships 9, 11, 12 and 15 unticked although slice 2's [WALKTHROUGH-RUN](../../openspec/changes/archive/2026-10-18-slice-2-durable-ingest-on-aws/WALKTHROUGH-RUN.md) walked most of them | **Risk, not a blocker.** Slice 3 ran on the same deployed shape. Slice 4 MUST NOT tick slice 2 boxes. The gap drill relies on a route throttle of `0` rejecting requests (AWS-U02's status half, read in slice 2's trip drill and unrecorded); if the drill's send is accepted, the drill fails loudly at its dry run (D32), and nothing is lost |
| The production Resend webhook | Exists, repointed to the kept deploy's ingest URL, with one real `delivered@resend.dev` send stored (2026-10-18; slice 2 WALKTHROUGH-RUN, "Data created") | No. It is what E1, RS-U02, RS-U03 and the gap drill read |
| The webhook's oldest event at least 3 days old | The oldest event is from 2026-10-18 | **Blocks RS-U03 only** (Ships 7) until 2026-10-21 (D38). Everything else runs today |
| A dedicated `full_access` Resend key for the reconciler | Not created | Owner op before the redeploy (§25). The Headless Webhook API needs `full_access` (RS-18). A dedicated key can be revoked alone, so the owner's own key never sits in Secrets Manager |
| `LEDGER_DEPLOY_RESEND_API_KEY`, `LEDGER_DEPLOY_RESEND_WEBHOOK_ID` | New public variables (D29), owner-approved | Owner op before the redeploy (§25): in the shell or `.env.deployed.local`, never committed ([CBL-10](../check-before-launch.md#public-repo-hygiene)) |
| The alert topic's email subscription | Confirmed 2026-10-18. The new alarm publishes to the same `LedgerGuardrails-alert` topic (D24), so no new subscription is created | No |
| AWS credentials | SSO profile `ledger`, us-east-2 | `aws sso login` on expiry |
| RS-U01 settled early | Open | **Recommended before `opsx:apply`** (§25): E1 is one replay and three reads (D37). A negative result (a replay lands under a new id) blocks the slice: the card goes `[!]` and ADR-007 needs a superseding design before anything is built on it |
| Open questions the slice depends on | RS-U01, RS-U02, RS-U20 (MUST settle here); RS-U03, RS-U04, RS-U05, RS-U06, RS-U09, RS-U10, RS-U13, RS-U17, PG-U03 (MAY close safe either way) | RS-U01 alone blocks (above) |

## 5. Reality check — per-`Ships`-item verdict

Checked against `5fe2a51` (clean).

| # | Verdict | Evidence | What remains |
| --- | --- | --- | --- |
| 1 | **absent** | `packages/resend-client/src/index.ts:1-2` is `export {}`. Its `package.json` declares no `resend` dependency; only `packages/ingest/package.json:16` does (`"resend": "6.33.0"`). The installed SDK exposes every call the slice needs: `webhooks.get(id)`, `webhooks.events.list({ webhookId, limit, after })`, `events.get`, `events.replay`, `events.attempts.list` (`node_modules/.pnpm/resend@6.33.0/.../index.d.mts:3407-3422, 3503-3514`), with `Response<T> & { headers }` (`:125-132`) and an abort `signal` (`:33-36`). Its `fetchRequest` never throws: a network failure returns `application_error` with `statusCode: null` (`index.mjs:1642-1653`), and its `logError` writes the error body and the path to `console.error` unless `NODE_ENV` is `production` (`index.mjs:1574-1580`; C9) | The client, the limiter, the error mapping and the fake Resend API (D9–D13) |
| 2 | **absent** | `packages/reconciler/src/index.ts` and `apps/reconciler/src/reconciler.handler.ts` are `export {}` stubs. No `reconcile_runs` schema (`packages/db/src/schema/` holds six files, none of them it) and no migration (`packages/db/drizzle/` stops at `0003_grant-api-tokens.sql`). No reconciler function in the app stack (`infra/src/app.stack.ts:120-126` names ingest, worker, api and http only); the one schedule targets the worker's resume (`:288-297`). No async invoke port (`packages/shared/src/function-invoke.port.ts:1-7`: "The asynchronous invoke is slices 4 and 6's"). `webhookEventsRepository.countPresent` exists (`packages/db/src/webhook-events.repository.ts:66`) but answers a count, not which ids | Everything: the table, the repository, the port, the package, the app, the stack wiring and the integration tests (D2–D7, D14–D22) |
| 3 | **absent** | No reconciler. `webhook_disabled` and `rate_limited` are registered and mirrored (`packages/core/src/error-codes.ts:17-18, 117-129`) | The two fake-API integration tests (§20) |
| 4 | **absent** | No route (`packages/api/src/` has no gaps or reconcile file), no SDK method (`packages/sdk/src/create-ledger-client.ts`), no CLI command (`apps/cli/src/commands/`). `health.get` has no last-run field (`packages/api/src/health-response.schema.ts:8-25`). `run_not_found`, `reconcile_in_progress` and `run_abandoned` are registered and have runbook entries that say "Slice 4 lands this operation" (`docs/runbook.md:171, 194, 212`) | Three routes, the health field, three SDK methods, two CLI commands and the health line (D27–D28, §12) |
| 5 | **absent** | `ingest.rejected` is declared in the metric set (`packages/shared/src/metrics.port.ts:8`, "`ingest.rejected`'s `reason` dimension … emitted from slice 4") and never emitted: `packages/ingest/src/create-ingest.ts:124-127` logs `ingest.request_rejected` and counts nothing. `MetricsPort` takes no dimension (`metrics.port.ts:21-24`), and `EmfMetricsAdapter` writes `Dimensions: [[]]` (`emf-metrics.adapter.ts:44`). The 5-minute cache is in place (`create-ingest.ts:21, 108-120`). The runbook has no rotation entry (`docs/runbook.md` headings: Alarms and Error codes only) | The metric with its dimension (D33, D34), the retired-secret test (§20) and the procedure (D35) |
| 6 | **absent** | RS-U01, RS-U02 and RS-U20 are `[Unverified]` ([resend.md](../resend.md#unverified)). The production webhook exists with stored events (§4) | E1 and the RS-U02 read (D37) |
| 7 | **absent** | RS-U03, RS-U13, RS-U17, RS-U06 `[Unverified]`; PG-U03 `[Unverified]` ([integrations.md](../integrations.md#unverified)) | D38, D40, D41 |
| 8 | **absent** | RS-U04, RS-U05, RS-U09, RS-U10 `[Unverified]` | E3 (D39), and RS-U09 and RS-U10 (D40) |
| 9 | **partial** | The burst's throttle mechanics exist and are tested: `readStage`, `withThrottle`, `hasThrottle` (`packages/aws/src/http-api-stage.ts:28-80`), `raiseDefaultThrottle` / `restoreDefaultThrottleIf` (`packages/aws/src/burst-throttle.ts:32-75`). The re-arm deletes every route setting (`packages/aws/src/kill-switch.ts:218-227`) and a trip sets every route-level throttle to the stop value (`:125-149`). No ingest-route throttle, no gap script, no `aws:gap-drill` root script (`package.json` scripts end at `aws:db-check`) | The route throttle steps (D31), the drill (D32) and the recorded run (§21 D) |
| 10 | **partial** | `README.md` exists with the positioning and the no-affiliation line, and the CI link check runs (`scripts/check-links.mjs`, the `links` stage). Its status line is stale: "No ledger behavior is built yet: everything below describes the design" | The M1 rewrite (D36) |
| 11 | **absent** | Five alarms deploy (`infra/src/app.stack.ts:306-379`, `infra/src/guardrails.stack.ts`), none on `reconcile.*` | D24 |

The reconciler is covered by the kill switch with no edit: the trip and the re-arm list functions by
the `LedgerApp-` prefix (`packages/aws/src/kill-switch.ts:268-280`), and the guardrails stack grants
`PutFunctionConcurrency` on `${appStackName}-*` (`infra/src/guardrails.stack.ts:203-228`, C18 of
slice 2). The API's request-id, auth and error middleware need nothing new (`packages/api/src/create-api.ts`).

`openspec/specs/` holds `read-api`, `sdk`, `cli`, `webhook-ingest`, `aws-stacks`,
`deploy-and-teardown`, `operations-runbook` and `local-stack`, so each of those deltas is
`MODIFIED`. There is no `reconciler` or `resend-client` capability, so both are `ADDED` (§23).

## 6. Contradictions and how each resolves

| # | Sources | Resolution |
| --- | --- | --- |
| C1 | [ADR-007](../architecture.md#adr-007--recovery-by-id-diff-and-replay-through-ingest): the lookback is "extended back to the `horizon_end` of the last run that finished without an `error_code`" **vs.** [Reliability core](../architecture.md#reliability-core), No loss. Read literally, a dry run counts (it replays nothing), and so does a run whose replays failed or whose replayed deliveries never landed. Each would advance the anchor past events still missing, and the next run's 3-day window would never revisit them | **The anchor is the newest finished run with no `error_code` and `missing = 0`**, dry or not (D4). A run that found nothing missing has verified its whole window; any other has not. The tie-break decides (correctness first, [decision lens](../../AGENTS.md#decision-lens--evidence-over-claims-right-sized)). ADR-007 is amended to say so (§22). The rule is stricter, not looser, and one cost follows: after a recovery run, the next run re-pages the gap once with no replays, then anchors |
| C2 | ADR-007: "a run that reaches its [time budget] stops; the next run re-diffs from newest", with no outcome named **vs.** C1's anchor: a run that stopped early with no `error_code` and `missing = 0` so far would anchor a window it never finished checking | **A run that reaches its deadline before its horizon ends `rate_limited`** (D17). The registry's own Meaning covers it: "Resend's shared rate limit left no room inside the run's time budget … so the run stopped before its horizon" ([Error codes](../api-contract.md#error-codes)). The 2 req/s limiter is Ledger's share of that limit, and integrations.md's arithmetic ("≈ 85 min … spread over ≈ 6 hourly runs because each run stops at its time budget", [rule 2](../integrations.md#locked-rules-must)) is this case |
| C3 | Card Ships 9: "`ledger reconcile --dry-run` (1 missing)" **vs.** [RS-39](../resend.md#facts): `delivered@` produces `email.sent` then `email.delivered`, two events, and List Events lists events, not emails (RS-14) | **The drill expects the send's events missing (2)** (D32). The card's count is corrected as a fact in the first task (§2, §22), loosening nothing |
| C4 | Card Ships 9: "`ledger gaps` (0 missing)" **vs.** [gaps.list](../api-contract.md#gapslist): "No Resend call: it reads recorded runs only". The real run records `missing = 2, replayed = 2` | **The drill ends with a second `ledger reconcile --dry-run`** once both replays are stored, and its `ledger gaps` reads that run's `missing = 0` (D32). The card names the final dry run (§22) |
| C5 | [ADR-009](../architecture.md#adr-009--multi-secret-verification-and-timestamp-tolerance): "the adopter adds the new secret, rotates, retires the old one inside 24 h", and [J5](../features.md#j5--secret-rotation): "add the new secret to the configured set → rotate at Resend" **vs.** [RS-13](../resend.md#facts): `POST /webhooks/{id}/signing-secret/rotate` is what returns the new secret, and [RS-04](../resend.md#facts): both sign for 24 h after the rotation | **Rotate first, then add the new secret, then retire the old one inside 24 h** (D35). Both orders are safe only because of RS-04, and only this one is possible. This is a fact correction to ADR-009 and J5 (§22) |
| C6 | [architecture.md → Risks](../architecture.md#risks--mitigations): "The reconciler reads `status` every run and alarms with `webhook_disabled`", and [data-modeling.md → `outbox`](../data-modeling.md#outbox--reactions-awaiting-delivery): "Operational alerts: reconcile gaps, DLQ depth and queue age go through CloudWatch → SNS (slice 3)" **vs.** the card, which ships no alarm, and slice 3, which had no reconciler to alarm on | **Owner-ruled 2026-10-19: one alarm, `LedgerApp-reconcile-gap`** (D24), added to the card as Ships 11 (§2). Both docs are corrected to name it (§22) |
| C7 | [Base fields](../data-modeling.md#base-fields--the-checklist-for-every-new-model): "`status` — **MUST** where the row has a lifecycle" **vs.** the [`reconcile_runs`](../data-modeling.md#reconcile_runs--one-row-per-recovery-run) entry, which carries its lifecycle as `claimed_at` and `finished_at` and derives `run_abandoned` on read, "never written to the row" | **The table's own entry governs** (D5): it is the more specific ratified statement. A stored status could hold only `running` or `finished` (abandoned is never written), so it would duplicate `finished_at` and could disagree with it. The base-fields row gains one line naming this exception (§22) |
| C8 | [Base fields](../data-modeling.md#base-fields--the-checklist-for-every-new-model): `created_at` / `received_at` MUST, and `updated_at` MUST on mutable rows **vs.** the entry's field table: `started_at`, no `updated_at`, on a row that is claimed once and finished once | **`started_at` is this table's row-time field** (`DEFAULT now()`, the budget's origin), as `received_at` is `webhook_events`'s, and **`updated_at` is added** (D5). The entry is corrected under the split rule (the schema owns columns, [How to use](../data-modeling.md#how-to-use)) |
| C9 | [pp-backend → resend-client.md](../../.agents/skills/pp-backend/references/resend-client.md#error-mapping): "A Resend response body never reaches a log" **vs.** `resend@6.33.0`'s `logError`, which `console.error`s the parsed error body and the request path on every non-`2xx` and every network failure unless `NODE_ENV` is `production` (`index.mjs:1574-1580`, called from `fetchRequest` at `:1590-1653`) | **`resend-client` silences the SDK's logger on its own instance** and a unit test proves nothing reaches the console (D9). Rejected: setting `NODE_ENV=production` on every root, which local mode and the scripts would each have to remember. The library behavior is recorded under [about.md → Open questions](../about.md#open-questions), Resolved (§22) |
| C10 | ADR-007's run outcomes and the [registry](../api-contract.md#error-codes) **vs.** a reconciler with no webhook id or key. The first deploy prints the ingest URL that the webhook is then created from, so the id arrives on a later deploy ([features.md → connect webhook](../features.md#adopter-lifecycle)). Local mode has neither, and the owner's `.env.local` holds `RESEND_API_KEY` (for the Resend CLI) with no webhook id | **Owner-ruled 2026-10-19: a new run-outcome code, `reconciler_not_configured`** (D1), which also covers a webhook id Resend answers `404` for. Rejected: reusing `resend_auth_failed`, whose message would be false whenever a key is set but the id is not |
| C11 | ADR-007's claim: `UPDATE reconcile_runs SET claimed_at = now() WHERE id = $1 AND claimed_at IS NULL` **vs.** D18's failed-invoke path, which finishes an unclaimed row as `internal_error`. A late duplicate of that invoke would then claim and run a finished row | **The claim also requires `finished_at IS NULL`** (D16), a tightening. ADR-007 and the `reconcile_runs` entry carry it (§22) |
| C12 | [pp-backend → resend-client.md → Error mapping](../../.agents/skills/pp-backend/references/resend-client.md#error-mapping): the default branch is "logged by `error_name` and the status" **vs.** [Log fields](../data-modeling.md#log-fields), which allow no status key | **Logged by `error_name` (the SDK's `name`, a closed set) and `error_code`** (D12). The status stays out of the line. The skill text is corrected as a fact (§22): it drops a field, so it loosens no privacy rule |
| C13 | [resend.md → Onboarding reality](../resend.md#onboarding-reality): "Not done: no webhook exists (live read)" (2026-10-15) **vs.** slice 2's walk, which created and kept the production webhook (2026-10-18) | **The docs lag the walk.** The row is updated with the date (§22), a fact correction |
| C14 | [`reconcile_runs`](../data-modeling.md#reconcile_runs--one-row-per-recovery-run): "`horizon_start`, `horizon_end` | The lookback horizon and the grace boundary actually checked" **vs.** a run that stops at its deadline before reaching `horizon_start` (C2) | **The columns hold the window the run set out to check**, fixed at start (D6), and `error_code` says when it stopped early. The wording is corrected (§22) |
| C15 | [AWS-10](../aws.md#eventbridge-scheduler)'s consequence: "the next tick supersedes a missed one" **vs.** [AWS-53](../aws.md#lambda): throttled async events are retried "for up to 6 hours by default". While the kill switch holds the reconciler at concurrency `0`, every hourly invoke queues, and after the re-arm up to six run back to back | **The reconciler's async invoke config sets `maxEventAge` to its 60 s minimum beside `retryAttempts: 0`** (D20). `aws-cdk-lib` 2.273.0's `EventInvokeConfigOptions` documents "Minimum: 60 seconds, Maximum: 6 hours" for `maxEventAge` and 0–2 for `retryAttempts` (`node_modules/.pnpm/aws-cdk-lib@2.273.0_constructs@10.8.1/node_modules/aws-cdk-lib/aws-lambda/lib/event-invoke-config.d.ts:23-40`). This becomes AWS-63 (§22). pp-infra's cost-brake wiring row grows the second property (§22) |
| C16 | [integrations.md → Locked rules](../integrations.md#locked-rules-must) rule 2: "Ledger's total stays ≤ 2 × 2 req/s", with the reconciler and the dispatcher as the callers **vs.** the gap drill, an owner script whose one send and List Events polls go through `resend-client` too ([pp-infra → scripts.md → Gap script](../../.agents/skills/pp-infra/references/scripts.md#gap-script)) | **The drill is a third caller only while it runs**, with its own 2 req/s limiter, and polls every 2 s (≤ 0.5 req/s). While it runs there is no dispatcher (slice 6), so the total stays ≤ 2 × 2 req/s. Rule 2 restates the bound with it (§22), as the rule requires of any new caller |
| C17 | [pp-general → logging-and-pii.md](../../.agents/skills/pp-general/references/logging-and-pii.md): "The only dimension in the set is `ingest.rejected`'s `reason`" **vs.** `LogMetricsAdapter`, which writes a metric through the logger, whose allow-list has no `reason` key, so local mode would drop it | **`reason` joins the Log fields allow-list, typed to its closed set** `signature` \| `timestamp` (D34). It is a closed-set value like `error_code`: no id, no PII. The data-modeling list and pp-general gain it (§22) |
| C18 | [pp-backend → reactions-and-recovery.md → Reconciler](../../.agents/skills/pp-backend/references/reactions-and-recovery.md#reconciler): "A run starts in one transaction: `pg_advisory_xact_lock` …, then the check …, then the insert", plus [commands-and-readers.md](../../.agents/skills/pp-backend/references/commands-and-readers.md#a-command-owns-its-transaction): "No external call inside it" **vs.** the grace window, which needs the queue's oldest age, an AWS read | **The queue snapshot is read before the transaction opens**. Inside the transaction run the lock, the check, the anchor read, the horizon computed by a pure core function, then the insert (D6). The horizons are fixed at start, so both triggers compute them one way |
| C19 | Card Ships 1: "every response checked and mapped by status then name" **vs.** D1's `reconciler_not_configured` for "Resend has no webhook with that id": a `404` otherwise falls to the default branch's `internal_error` | **Only Retrieve Webhook maps `404` to `reconciler_not_configured`**, because its one input is the configured id (D12). Every other `404`, a replay's included, takes the default branch |
| C20 | [reconcile.start](../api-contract.md#reconcilestart) Kind: "`dry_run` reports missing ids without replaying any" **vs.** the same entry's In / Out ("→ a [reconcile_runs](../data-modeling.md#reconcile_runs--one-row-per-recovery-run) row") and that table, whose only loss fields are counts ("`missing > 0` is the loss signal") | **A dry run reports the missing count, not ids** (D27's `ReconcileRun`, owner-approved in §7 item 3). The In / Out and the table are the more specific ratified statements, and no row in [What this project must demonstrate](../about.md#what-this-project-must-demonstrate) needs the ids. The Kind sentence is corrected (§22) |
| C21 | Ships 11 and D24: the alarm fires when "no run finishes cleanly in an hour", read through `TreatMissingData: BREACHING` **vs.** CloudWatch's default sliding window: when some datapoints in the evaluation range are missing but at least **Evaluation Periods** real ones exist, "CloudWatch evaluates the alarm state based on the most recent real data points … the value you set for how to treat missing data is not needed and is ignored" ([alarms-and-missing-data](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/alarms-and-missing-data.html), read 2026-10-19). With one evaluation period, a reconciler that stops emitting would keep evaluating its last clean `0` | **The alarm uses a wall clock evaluation window** (D24): it "retrieve[s] exactly the data points in the aligned window … and do[es] not query additional data points from farther back", and each evaluation "looks at the data for the most recently completed clock hour" ([alarm-evaluation-window](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/alarm-evaluation-window.html), read 2026-10-19; 1-hour periods supported). An hour with no clean run then has no datapoint and reads breaching. `aws-cdk-lib` 2.273.0 exposes it on `CfnAlarm` only (`evaluationWindow`, `node_modules/.pnpm/aws-cdk-lib@2.273.0_constructs@10.8.1/node_modules/aws-cdk-lib/aws-cloudwatch/lib/cloudwatch.generated.d.ts:794`), so the alarm sets it on its `node.defaultChild`. This becomes AWS-64 (§22) |
| C22 | [pp-backend → resend-client.md → What it is](../../.agents/skills/pp-backend/references/resend-client.md#what-it-is): "`main.ts` reads the key through the secret port at module scope" **vs.** the repo's pattern, which reads secrets on the first invocation through one memoized promise so the bundle loads with no AWS access (`apps/worker/src/main.ts:16`, `apps/api/src/main.ts:21`, slice 2 D32) | **The repo governs** (D20): the key is read through the secret port on the first invocation and passed to the constructor, never through config. The skill sentence is corrected as a fact (§22); every rule it states about the key still holds |

None found, having also checked these pairs: the card's UI surfaces ↔ the api-contract Surfaces
lines (`ledger gaps [--since <duration>]` with default `24h`, `ledger reconcile [--dry-run]
[--lookback <duration>] [--no-wait]`; no `--limit` on `ledger gaps`, [pp-cli → Never](../../.agents/skills/pp-cli/SKILL.md#never));
the registry ↔ `packages/core/src/error-codes.ts` (all 19 codes mirrored); the [Secrets layout](../integrations.md#secrets-layout)
↔ the app stack (`ledger/resend-api-key` is planned in M1 and absent today; the reconciler reads it
and `ledger/database`, nothing else); the kill switch ↔ a new `LedgerApp-` function (covered by
prefix, §5); [health.get](../api-contract.md#healthget)'s `Slices:` ↔ the card (both name 4 for the
last run); the [Cadence](../integrations.md#cadence-and-the-database) ↔ two schedules on one
`HOURLY_CRON` (one wake); [ADR-016](../architecture.md#adr-016--the-simulator-reaches-aws-only-through-an-opt-in-simulator-secret)
↔ the diff (simulated events never appear in List Events, so the extra ledger rows they leave
change nothing).

## 7. Decisions

**Ask-first approvals** (owner round, 2026-10-19):

| Item | Exact scope | Status | Used by |
| --- | --- | --- | --- |
| 1. Dependency | `resend` at exactly `6.33.0` (already in `pnpm-lock.yaml` through `packages/ingest`) added to `packages/resend-client/package.json`. Workspace entries (`workspace:*`, not Ask-first): `@ledger/resend-client` in `packages/reconciler` and `infra`; `@ledger/reconciler` in `apps/reconciler` and `apps/local`; `@ledger/sdk` in `infra` | owner-approved 2026-10-19 | Groups 4, 5, 9 |
| 2. Schema / migration | New table `reconcile_runs` (§8): `0004_create-reconcile-runs.sql` (generated) and `0005_grant-reconcile-runs.sql` (custom: `GRANT SELECT, INSERT, UPDATE ON reconcile_runs TO` the runtime role). No frozen migration touched | owner-approved 2026-10-19 | Group 3 |
| 3. Public contract | Routes `gaps.list` → `GET /gaps?since&limit&after`, `reconcile.getRun` → `GET /reconcile/runs/{run_id}`, `reconcile.start` → `POST /reconcile` (`202`), with this document's wire shapes (D27); `health.get` gains `last_reconcile_run`; SDK `ledger.gaps.list({ since?, limit?, after? })`, `ledger.reconcile.getRun(runId)`, `ledger.reconcile.start({ dry_run?, lookback? })`; CLI `ledger gaps [--since <duration>] [--json]` and `ledger reconcile [--dry-run] [--lookback <duration>] [--no-wait] [--json]`, and a `reconcile` line in `ledger health`; registry row `reconciler_not_configured` (D1); the api-contract edits in §22 | owner-approved 2026-10-19 | Groups 1, 8 |
| 4. Public variables and commands | `LEDGER_DEPLOY_RESEND_API_KEY` and `LEDGER_DEPLOY_RESEND_WEBHOOK_ID`, read by `pnpm aws:deploy` (D29); `pnpm aws:gap-drill` (D32), which reads `LEDGER_URL`, `LEDGER_TOKEN`, `RESEND_API_KEY` and `LEDGER_DEPLOY_RESEND_WEBHOOK_ID`, existing names with a new reader | owner-approved 2026-10-19 | Groups 1, 10 |
| 5. Template resources | App stack: Lambda `LedgerApp-reconciler` and its log group `/ledger/LedgerApp-reconciler`; secret `ledger/resend-api-key` (USD 0.40/month, AWS-11; the M1 count integrations.md already plans); schedule `LedgerApp-reconcile-hourly`; one `AWS::Lambda::EventInvokeConfig` (`MaximumRetryAttempts: 0`, `MaximumEventAgeInSeconds: 60`); IAM (D22); the read API's `lambda:InvokeFunction` on the reconciler; alarm `LedgerApp-reconcile-gap` (D24, wall clock evaluation window; 6 of 10 free, AWS-28); output `ResendApiKeySecretArn` | owner-approved 2026-10-19 | Group 9 |
| 6. AWS runs | Each `pnpm aws:deploy`, the gap drill, and every read-only `aws` CLI read in the walk | held — approved per action at walk time | Group 12 |
| 7. Live Resend writes | Creating the reconciler's dedicated `full_access` key (dashboard or `POST /api-keys`, §25); E1's one replay of a stored event (D37); E3's test-webhook experiments: one create, two sends, two `PATCH status`, one replay, one delete (D39); the gap drill's one send and the replays its `ledger reconcile` makes (D32); and, by deploying the reconciler, its **automatic hourly replays** of missing events on the production webhook (ADR-007) | held — approved per action at walk time; the redeploy's approval covers the hourly replays | Group 12 |
| CI change | None: every new test runs in an existing `pnpm verify` stage; `scripts/verify.mjs` is untouched | — | — |

Anything else (another variable, flag, route field, resource or dependency) stops at apply.

### Kernel (`packages/core`)

**D1 — `reconciler_not_configured`, and the stored outcome set** (owner-ruled 2026-10-19, C10).
The registry gains one row, written out:

| Code | HTTP | Meaning | Hint | Docs | Raised by |
| --- | --- | --- | --- | --- | --- |
| `reconciler_not_configured` | — (run outcome) | The reconciler has no Resend API key or webhook id, or Resend has no webhook with that id, so it cannot list or replay events | Reconcile runs on a deployed stack: set `LEDGER_DEPLOY_RESEND_API_KEY` and `LEDGER_DEPLOY_RESEND_WEBHOOK_ID`, then run `pnpm aws:deploy` | runbook | packages/reconciler → `reconcile_runs.error_code` |

`errorCodes` and `errorRegistry` in `packages/core/src/error-codes.ts` gain it (message ending in a
period like the others). A second tuple, `reconcileRunErrorCodes = ['webhook_disabled',
'rate_limited', 'resend_auth_failed', 'resend_unavailable', 'reconciler_not_configured',
'internal_error'] as const`, is the closed set `reconcile_runs.error_code` holds (D5). `internal_error`
is stored when a run stops on an unexpected failure (a Resend request bug, a code defect, or an
invoke that never started it, D18). `run_abandoned` is absent from it by construction: the
database refuses to store it (ADR-007). `internal_error`'s Raised-by cell gains "packages/reconciler
and packages/api → `reconcile_runs.error_code`" (§22).

**D2 — The run's constants**, in `packages/core/src/reconcile-run.ts`, each commented with its
source:

| Constant | Value | Why |
| --- | --- | --- |
| `RECONCILE_RUN_BUDGET_MS` | `840_000` (14 min) | ADR-007's "one constant shared by the start check and the abandoned derivation", below the 900 s Lambda maximum (AWS-03); integrations.md rule 2's 85 min over ≈ 6 runs |
| `RECONCILE_FINISH_RESERVE_MS` | `60_000` | The run stops issuing Resend calls at `started_at + budget − reserve`, so its finish write lands before the budget ends, and the derivation never calls a live run abandoned |
| `RECONCILE_GRACE_MS` | `600_000` (10 min) | ADR-007's grace window; RS-U13 (≈ 8 s, community) |
| `RECONCILE_DEFAULT_LOOKBACK_MS` | `259_200_000` (72 h) | ADR-007, above the ≈ 27.6 h retry schedule (RS-09) |
| `RECONCILE_MAX_LOOKBACK_MS` | `2_592_000_000` (30 d) | RS-31; api-contract's validation bound |

The reconciler Lambda's timeout is `900` s (D20). A crash leaves `finished_at` null, and the run
reads `run_abandoned` once its budget has passed.

Authority: [ADR-007](../architecture.md#adr-007--recovery-by-id-diff-and-replay-through-ingest)
(one budget constant "below the Lambda timeout", the 10-minute grace, the 3-day default and the
30-day cap) and [integrations.md → rule 2](../integrations.md#locked-rules-must) ("≈ 85 min … spread
over ≈ 6 hourly runs", so ≈ 14 min a run). The reserve is the lens's correctness clause
([decision lens](../../AGENTS.md#decision-lens--evidence-over-claims-right-sized), clause 6):
`hasUnfinishedRun` ignores a run past its budget, so a run still calling Resend after it could
overlap the next start, which [rule 3](../integrations.md#locked-rules-must) forbids.

**D3 — Pure functions**, in `packages/core`, unit- and property-tested:

- `parseDuration(text)`: `^[1-9][0-9]{0,4}[mhd]$`, minutes, hours or days, from `1m` to `30d`
  inclusive. Returns milliseconds or `undefined`. `--since` and `--lookback` share it, and the
  API's request schemas use it (D27). The CLI never parses it ([pp-cli → Never](../../.agents/skills/pp-cli/SKILL.md#never)).
- `reconcileHorizon({ now, lookbackMs, anchorHorizonEnd, oldestQueueAgeSeconds })` →
  `{ horizonStart, horizonEnd }`:
  - `horizonEnd = now − max(RECONCILE_GRACE_MS, oldestQueueAgeSeconds × 1000)`, where `null` age
    counts as `0` (ADR-007: "10 minutes, or the source queue's `ApproximateAgeOfOldestMessage` …
    when that is longer");
  - `horizonStart = max(now − RECONCILE_MAX_LOOKBACK_MS, min(now − lookbackMs, anchorHorizonEnd ?? +∞, horizonEnd))`.
    The anchor extends both the default and an explicit `--lookback`, so an explicit short window
    can never break the chain of checked windows (C1). The 30-day floor caps both, and the final
    `min` keeps `horizonStart ≤ horizonEnd`. List Events reach (RS-U03) bounds it from outside:
    paging ends at the oldest event Resend still lists.
- `runOutcome(run, now)` → `{ code } | null`: the stored `error_code`; else `run_abandoned` when
  `finished_at` is null and `now − started_at > RECONCILE_RUN_BUDGET_MS`; else `null`. The API's
  readers call it (ADR-007: derived on read, never written).
- Properties: `reconcileHorizon` never returns `horizonStart > horizonEnd`, never reaches past
  30 days, and with an anchor older than `now − lookback` returns exactly the anchor (the 5-day-gap
  claim, in miniature).

**D4 — The anchor is the newest finished run with no `error_code` and `missing = 0`** (C1).
Dry runs count, because a dry run that found nothing missing has verified its window too. A
recovery run (`missing > 0`) never anchors: the next run re-checks the same span, finds the
replays stored, and anchors then. A persistently missing event (say, one whose replay keeps
failing) pins the anchor. The lookback then grows hour by hour to 30 days, and the gap alarm
stays in `ALARM` (D24). That is loud, bounded by the run's budget, and the right answer under
the tie-break.

Authority: [Reliability core](../architecture.md#reliability-core), No loss, and the
[decision lens](../../AGENTS.md#decision-lens--evidence-over-claims-right-sized) tie-break
(correctness first), C1. ADR-007 is amended to say so (§22).

**D5 — Events and closed sets.** Beside `RESUME_EVENT` (`packages/core/src/event-source-states.ts:13`):
`RECONCILE_SCHEDULED_EVENT = { ledger: 'reconcile-scheduled' } as const`, and the manual invoke
payload `{ ledger: 'reconcile-run', run_id: <positive integer> }`. Each has a Zod schema that
`apps/reconciler`'s handler parses. `reconcileTriggers = ['scheduled', 'manual'] as const` and
`reconcileRunErrorCodes` (D1) mirror the table's `CHECK`s
([Modeling conventions](../data-modeling.md#modeling-conventions-canonical)).

### Database (`packages/db`)

**D6 — The table, its repository and the start.** The columns are §8's. Repository
`reconcile-runs.repository.ts`, executor-first functions, each called in this diff:

| Function | SQL shape | Caller |
| --- | --- | --- |
| `lockReconcileStart(tx: Transaction)` | `SELECT pg_advisory_xact_lock(RECONCILE_START_LOCK_KEY)`, a named `bigint` constant fixed once in `packages/db` ([pp-database → Transactions and locks](../../.agents/skills/pp-database/references/schema-and-repositories.md#transactions-and-locks)) | both start commands |
| `hasUnfinishedRun(tx)` | `EXISTS (… WHERE finished_at IS NULL AND started_at > now() - make_interval(secs => budget))`, issued after the lock | both start commands |
| `anchorHorizonEnd(tx)` | `SELECT horizon_end … WHERE finished_at IS NOT NULL AND error_code IS NULL AND missing = 0 ORDER BY id DESC LIMIT 1` (D4) | both start commands |
| `insert(tx, row)` | `INSERT … RETURNING *` | both start commands |
| `claim(db, runId)` | `UPDATE … SET claimed_at = now(), updated_at = now() WHERE id = $1 AND claimed_at IS NULL AND finished_at IS NULL RETURNING *` (C11) | the reconciler |
| `finish(db, runId, outcome)` | `UPDATE … SET finished_at = now(), updated_at = now(), checked, missing, replayed, failed, error_code WHERE id = $1 AND finished_at IS NULL RETURNING *` | the reconciler; the API's failed-invoke path |
| `get(db, runId)` | by id | `reconcile.getRun` |
| `listSince(db, { since, limit, after })` | `WHERE started_at >= $since [AND id < $after] ORDER BY id DESC LIMIT limit + 1` | `gaps.list` |
| `latest(db)` | `ORDER BY id DESC LIMIT 1` | `health.get` |

`webhookEventsRepository.presentSvixIds(db, svixIds)` returns the set of ids already stored
(`SELECT svix_id … WHERE svix_id = ANY($1)`), a primary-key lookup
([`webhook_events`](../data-modeling.md#webhook_events--the-immutable-ledger) Indexes).

**The start, both triggers** (ADR-007 Start, C18). Read the queue snapshot through
`QueueAttributesPort`, then open one transaction: `lockReconcileStart`, `hasUnfinishedRun` (true →
throw `reconcile_in_progress`), `anchorHorizonEnd`, `reconcileHorizon` (D3) with the clock port's
`now`, `insert`, commit. A manual start inserts `claimed_at = NULL`. A scheduled start inserts
`claimed_at = now()`, because the reconciler that inserts it is the one that runs it, and a
duplicate scheduled invoke is refused by `hasUnfinishedRun`. Two thin commands call these functions,
one per package (D14, D18); "two occurrences are a coincidence"
([pp-general → Extract an abstraction](../../.agents/skills/pp-general/references/adding-things.md#extract-an-abstraction)).
A shared command in `@ledger/reconciler` was rejected, because importing it would pull the `resend`
SDK into the read API's bundle.

### Shared kernel (`packages/shared`)

**D7 — `AsyncFunctionInvokePort`**, the async invoke the [ports table](../../.agents/skills/pp-backend/references/composition.md#ports)
assigns to slices 4 and 6: `invokeAsync(payload: unknown): Promise<void>`, bound to one function,
resolving once the payload is handed over. Two implementations:

- `LambdaAsyncFunctionInvokeAdapter` in `packages/aws`: `InvokeCommand` with
  `InvocationType: 'Event'`. It resolves on `StatusCode` `202`; anything else, or a thrown SDK
  error, rejects (the SDK error unchanged, a non-`202` as a constant `internal_error`).
- `InProcessAsyncFunctionInvokeAdapter` in `packages/shared`: calls the composed function and does
  not await it. A rejection is logged as `invoke.async_failed` with `error_name`, never rethrown.

They share one contract suite, `asyncFunctionInvokePortContract` in `@ledger/shared/testing`:
the payload arrives unchanged, the promise resolves before the function finishes, and a function
that rejects never rejects the invoke. A `FakeAsyncFunctionInvoke` records payloads and can be set
to fail ([pp-testing → Fakes](../../.agents/skills/pp-testing/references/fakes-and-doubles.md#which-double-per-seam)).

**D8 — `MetricsPort` gains a typed dimension** for `ingest.rejected` alone:
`count(name, value, fields?, dimensions?)`, with `dimensions` typed
`MetricDimensions[name]` (`{ 'ingest.rejected': { reason: 'signature' | 'timestamp' } }`). Every
other name takes none, a type error otherwise. `EmfMetricsAdapter` writes `Dimensions: [['reason']]`
and a top-level `reason` for it, and `Dimensions: [[]]` for the rest. `LogMetricsAdapter` writes
`reason` as a log field (D34). Evidence: both adapters' unit tests. Authority: card Ships 5
(`ingest.rejected{reason}`), and [pp-general → Metrics](../../.agents/skills/pp-general/references/logging-and-pii.md#metrics)
with `packages/shared/src/metrics.port.ts:3-5` (the fixed set; `reason` is its one dimension, from
slice 4). Ids stay fields, never dimensions (AWS-12).

### `packages/resend-client`

**D9 — Shape** ([pp-backend → resend-client.md](../../.agents/skills/pp-backend/references/resend-client.md#what-it-is)).
`createResendClient({ apiKey, baseUrl, userAgent, clock, sleep, ratePerSecond = 2 })` returns a
`ResendClient` with exactly these named methods, each taking `{ deadline: Date }` (the limiter
compares every wait with it):

| Method | SDK call (6.33.0) | Returns | Caller |
| --- | --- | --- | --- |
| `retrieveWebhook(webhookId)` | `webhooks.get(id)` | `{ status: 'enabled' \| 'disabled' }` only: the response carries `signing_secret` (RS-05, RS-13), which is dropped before it leaves the method | reconciler |
| `listWebhookEvents(webhookId, { after? })` | `webhooks.events.list({ webhookId, limit: 100, after })` | `{ hasMore, events: { id, type, createdAt }[] }` (RS-14) | reconciler, gap drill |
| `replayWebhookEvent(webhookId, eventId)` | `webhooks.events.replay({ webhookId, eventId })` | `void` (RS-16) | reconciler |
| `retrieveWebhookEventCreatedAt(webhookId, eventId)` | `webhooks.events.get(…)` | `{ createdAt }`, the payload's top-level `created_at` only: the payload holds raw addresses (RS-15) | gap drill (RS-U10) |
| `sendEmail({ from, to, subject, text }, { idempotencyKey })` | `emails.send(payload, { idempotencyKey })` | `{ emailId }` | gap drill; the dispatcher reuses it in slice 6 |

The client is built with every option explicit: `new Resend(apiKey, { baseUrl, userAgent })`. The
Lambda's `baseUrl` is the config constant `https://api.resend.com` (resend.md's API line), and a test
passes the fake's. `userAgent` is `ledger-reconciler` or `ledger-gap-drill` (RS-21 requires one; the
names identify Ledger and claim no affiliation). Each request passes
`signal: AbortSignal.timeout(RESEND_REQUEST_TIMEOUT_MS)` (`10_000`), and the SDK reports a timeout as a
network failure (`statusCode: null`, §5), so a hung socket costs one bounded attempt. The API key is
read through the secret port at the root and passed in, never through config, and it never reaches
a log, an error or an output (rule 7). `sendEmail` always carries an `Idempotency-Key` (rule 6,
RS-24).

**The SDK's console logger is silenced** on the instance the client builds (C9).
`Reflect.defineProperty(sdk, 'logError', { value: () => {} })` shadows the prototype method
(`private` in the `.d.mts`, `:3549`). A unit test proves that a `4xx`, a `5xx` and a refused
connection against the fake API write nothing to `console.error`. The test fails if a version bump
renames the method.

**D10 — The limiter**, hand-rolled, one per instance, over the clock port and an injected sleep
([The limiter](../../.agents/skills/pp-backend/references/resend-client.md#the-limiter)):

1. **Rate:** request starts spaced `1000 / ratePerSecond` ms apart (500 ms at the default).
2. **Headroom:** after every response, when `ratelimit-remaining` < `ratelimit-limit` / 2, wait
   `ratelimit-reset` seconds before the next start. Absent or unparseable headers mean no wait.
3. **`429`:** wait `retry-after` seconds, then retry the same call, as often as the deadline allows.
   A `429` named `daily_quota_exceeded` or `monthly_quota_exceeded` (RS-22), or one without a
   parseable `retry-after`, is never retried: `rate_limited`.
4. **Deadline:** any wait (rate, headroom, `retry-after`, a `5xx` backoff) that would end past the
   call's deadline throws `rate_limited` before it sleeps.

**D11 — `5xx` and network failures** (the slice-owned choice in [Error mapping](../../.agents/skills/pp-backend/references/resend-client.md#error-mapping)):
a `5xx`, or `statusCode: null` (a network failure or the request timeout), is retried twice more
with backoff of 1 s, then 2 s, each inside the deadline (D10 step 4). It then throws
`resend_unavailable`. Three attempts cover a blip without spending a run's budget on an outage.

**D12 — The mapping**, status first, then name, with a default branch:

| Response | Outcome |
| --- | --- |
| `2xx` | the method's return |
| `429` | D10 step 3 |
| `401` or `403`, any name, from a reconciler method | `resend_auth_failed` (RS-22) |
| `401` or `403` from `sendEmail` | Returned by status and name for its caller, as [Error mapping](../../.agents/skills/pp-backend/references/resend-client.md#error-mapping) requires (slice 6's dispatcher records it in `last_error`; a `403 validation_error` there can be RS-34). The drill fails on it (`failed: resend_auth_failed`) |
| `400` named `validation_error` with message `API key is invalid` | `resend_auth_failed` (RS-U17, [Constraint 14](../resend.md#constraints-and-sharp-edges)) |
| `5xx`, or `statusCode: null` | D11, then `resend_unavailable` |
| `404` from `retrieveWebhook` | `reconciler_not_configured` (D1, C19): the configured id names no webhook |
| Anything else (another `400`, any other `404`, a `422`, a `409` outside `sendEmail`) | `internal_error`, the default branch. Logged once as `resend.request_failed` with `error_name` (the SDK's `name`) and `error_code`, never Resend's `message` (C12) |
| `409` from `sendEmail` | Returned by name for its caller (slice 6's dispatcher). The drill sends with a fresh key, so it treats any `409` as `internal_error` |

Each thrown error is `LedgerError(code)` with the registry's default `message`; Resend's body never
becomes a `message`, a `cause` that a surface prints, or a log value.

**D13 — The fake Resend API** ([pp-testing → The fake Resend API](../../.agents/skills/pp-testing/references/fakes-and-doubles.md#the-fake-resend-api)),
exported from `@ledger/resend-client/testing`. It is a `node:http` server on `127.0.0.1:0` that
answers `GET /webhooks/{id}`, `GET /webhooks/{id}/events`, `GET /webhooks/{id}/events/{event_id}`,
`POST /webhooks/{id}/events/{event_id}/replay` and `POST /emails` from a scripted queue (status, the
RS-22 body, `ratelimit-*` and `retry-after` headers). It records method, path, `User-Agent`,
`Idempotency-Key` and body. Its event list is held as data the test sets, and a replay calls a
test-supplied `onReplay(eventId)`, so an integration test can deliver the replayed event through
real ingest. It holds no logic the real API lacks: it never decides what is missing. Fixture
payloads use test addresses only. `@ledger/resend-client/testing` also exports `FakeResendClient`,
typed against `ResendClient`, for the reconciler's own unit tests, never for a limiter claim.

### Reconciler (`packages/reconciler`, `apps/reconciler`)

**D14 — The factory.** `createReconciler({ db, resend, webhookId, queueAttributes, clock, logger,
metrics })` returns `{ runScheduled(), runClaimed(runId) }`, one function per event kind, as the
worker's batch-and-resume factory does ([pp-backend → Case-by-case](../../.agents/skills/pp-backend/SKILL.md#case-by-case)).
`resend` and `webhookId` are `undefined` when not configured (D21, D23). `runScheduled` runs the
start (D6, `trigger = scheduled`) and then the run. A refused start logs `reconcile.start_refused`
and returns. `runClaimed` claims (D16) and then runs.

**D15 — The run**, in ADR-007's order. Each Resend call goes through `resend` with
`deadline = started_at + RECONCILE_RUN_BUDGET_MS − RECONCILE_FINISH_RESERVE_MS`:

1. `resend` or `webhookId` absent → finish `reconciler_not_configured`, no Resend call.
2. `retrieveWebhook` → `disabled` → finish `webhook_disabled` (RS-11, rule 5). Its errors finish
   the run with their code.
3. Page `listWebhookEvents` newest first (RS-14), `after` = the previous page's last id. On each
   page, an item whose `createdAt > horizonEnd` is skipped (the grace window), and an item whose
   `createdAt < horizonStart` is outside the window. Every other item counts in `checked`. After a
   page holding an item older than `horizonStart`, or a page with `hasMore: false`, paging stops.
   Every item on a page is filtered, so an unsorted page cannot hide one.
4. Per page, `presentSvixIds` over the in-window ids; the rest count in `missing`.
5. Not a dry run: replay each missing id in page order. A success counts in `replayed`.
   `resend_auth_failed` or `rate_limited` stops the run with that code. Any other error counts in
   `failed`, logs `reconcile.replay_failed` with `run_id`, `svix_id` and `error_code`, and the run
   continues: "one failed replay never aborts a run" (ADR-007).
6. A List Events error stops the run with its code. Reaching the deadline with paging unfinished
   finishes it `rate_limited` (C2).
7. Finish (D6 `finish`) with the counts and the code, then emit D19's metrics.

A replay re-enters through ingest (RS-16), so verification and the `svix_id` dedupe apply
unchanged. There is no write path that inserts a fetched payload (ADR-007's rejected option). An
unexpected throw anywhere after the claim is caught at the factory edge, finished best-effort as
`internal_error`, logged by `error_name`, and rethrown as a constant, so Lambda's vended `Errors`
counts it ([pp-general → errors](../../.agents/skills/pp-general/references/errors.md)). If the
finish itself fails (the database is down), the row stays unfinished and reads `run_abandoned`.

Authority: ADR-007's order, and [pp-backend → Reconciler](../../.agents/skills/pp-backend/references/reactions-and-recovery.md#reconciler)
("Then, in order: read the configured webhook's `status` … replay the missing ones"; "One failed
replay never aborts a run"; "never a throw that loses the row"). Step 6's deadline stop is C2's.

**D16 — The claim** (ADR-007 Claim, C11): `claim(db, runId)` before any Resend call. Zero rows
means a duplicate invoke, an already-finished row, or no such row: log
`reconcile.duplicate_invoke` with `run_id` and return with no Resend call. Authority:
[`reconcile_runs` → Claim](../data-modeling.md#reconcile_runs--one-row-per-recovery-run) ("zero
rows means a duplicate invoke, which exits without work"), tightened by C11.

**D17 — Outcomes stored**, one per run: `null` (a clean finish), or a code from
`reconcileRunErrorCodes` (D1). A time-budget stop is `rate_limited` (C2). Authority:
[Error codes](../api-contract.md#error-codes), `rate_limited`'s Meaning ("left no room inside the
run's time budget … so the run stopped before its horizon").

**D18 — The manual start** (`packages/api`'s `StartReconcileCommand`): D6's start with
`trigger = manual` and the request's `dry_run` and `lookback` (default 72 h). After the commit it
calls `reconcilerInvoke.invokeAsync({ ledger: 'reconcile-run', run_id })`. If the invoke rejects, a
second statement finishes the row as `internal_error` (so it neither blocks the next start for the
budget nor runs late, C11), and the route answers `500 internal_error`. A start refused inside the
lock answers `409 reconcile_in_progress`. Authority: [reconcile.start](../api-contract.md#reconcilestart)
("starts one manual run … asynchronously and answers `202` with the run"; the HTTP API's 30 s
timeout, AWS-02) and ADR-007 Start.

**D19 — Metrics and logs.** A run that finishes with no `error_code` emits `reconcile.missing`,
`reconcile.replayed` and `reconcile.failed`, one EMF line each, value the count, field `run_id`, no
dimension ([Technology](../architecture.md#technology)). An errored run emits none: the gap alarm
reads that silence (D24). Dry runs emit too. Log lines, constant messages and allow-listed fields
only: `reconcile.run_started` (`run_id`), `reconcile.run_finished` (`run_id`, `checked_count`,
`missing_count`, `replayed_count`, `failed_count`, `error_code` when set),
`reconcile.replay_failed`, `reconcile.duplicate_invoke`, `reconcile.start_refused`,
`reconcile.internal_error` (`error_name`).

**D20 — The function** (`apps/reconciler`): `LedgerFunction` `reconciler`, `LedgerApp-reconciler`,
256 MB (it pages and diffs ids; no payload is held), timeout `900` s (AWS-03), async invoke config
`retryAttempts: 0` and `maxEventAge: Duration.seconds(60)` (C15). No reserved concurrency (AWS-16).
The handler Zod-parses either event (D5), catches at its edge, logs `error_name`, and rethrows a
constant ([pp-backend → ingest-and-worker.md](../../.agents/skills/pp-backend/references/ingest-and-worker.md#ingest-in-order)'s
edge rule). `main.ts` parses config at module scope and reads both secrets on the first invocation
through one memoized promise, so the bundle loads with no AWS access (slice 2 D32, C22).

**D21 — Its configuration.** `reconcilerEnv = { DATABASE_SECRET_ARN, RESEND_API_KEY_SECRET_ARN,
RESEND_WEBHOOK_ID, QUEUE_URL, DLQ_URL }` in `packages/shared/src/function-env.ts`. The webhook id is
a deploy input, set from CDK context `ledger:resendWebhookId`; absent, its value is `unset` (as
`DeployedCommit` is), which `reconciler.config.ts` parses as not configured. `ledger/database` is
parsed by the reconciler's own one-field schema (`pooledUrl`); each app reads only the fields it
needs, and none imports another (ADR-013). `ledger/resend-api-key` holds a bare key. A value not
starting `re_` (the CDK placeholder, before a deploy writes the key) parses as not configured; the
`re_` prefix is Resend's documented key form (RS-02's examples, the gitleaks `re_` rule). The
grace window's age comes from `SqsQueueAttributesAdapter` over both queue URLs, the adapter
`health.get` already uses (C18); it takes the age from CloudWatch, since `GetQueueAttributes`
returns none (`packages/aws/src/sqs-queue-attributes.adapter.ts:21-27`, AWS-22). Authority:
[Secrets layout](../integrations.md#secrets-layout) ("The Resend webhook id is not a secret: it is
a deploy input … passed to `apps/reconciler` only"; `ledger/resend-api-key` read by
`apps/reconciler` only) and [pp-infra → Deploy inputs](../../.agents/skills/pp-infra/references/env-and-inputs.md#deploy-inputs).

**D22 — IAM, least privilege.** Reconciler: `grantRead` on `ledger/resend-api-key` and
`ledger/database` only ([Secrets layout](../integrations.md#secrets-layout)); `sqs:GetQueueAttributes`
on both queues; `cloudwatch:GetMetricStatistics` on `*` (no resource-level permission). Read API:
`lambda:InvokeFunction` on the reconciler's ARN, built with `formatArn` from its physical name
([pp-infra → cdk-app.md](../../.agents/skills/pp-infra/references/cdk-app.md#function-configuration)).
`apiEnv` gains `RECONCILER_FUNCTION_NAME`.

**D23 — Local mode** composes `createReconciler` with `resend: undefined` and `webhookId:
undefined`, over the in-process queue's attributes. Its `InProcessAsyncFunctionInvokeAdapter`
calls `runClaimed`. `reconcile.start` therefore works locally and every local run ends
`reconciler_not_configured`; `ledger gaps` and `ledger health` read the runs. No local variable is
added. A live local reconcile is a [Deferred](../architecture.md#deferred-yagni) row (§3). Authority:
lens clause 3 (the slice is walked on the deployed stack, where recovery lives) and lens clause 6
(a local run against the production webhook would replay every event to production).

### Infra (`infra/`)

**D24 — Alarm `LedgerApp-reconcile-gap`** (owner-ruled 2026-10-19, C6). The metric is `Ledger` /
`reconcile.missing` (no dimension), `Maximum`, period `3600` s, one evaluation period, threshold
`> 0`, `TreatMissingData: BREACHING`, a **wall clock evaluation window** in UTC (C21: set as
`(alarm.node.defaultChild as CfnAlarm).evaluationWindow = { wallClockWindow: {} }`, because the L2
`Alarm` has no such prop in 2.273.0), one `ALARM` action on the alert topic (as slice 3 D14–D16).
Each evaluation reads the most recently completed UTC hour, which holds that hour's scheduled run
(`HOURLY_CRON` is `cron(0 * * * ? *)`, minute 0, `infra/src/app.stack.ts:93`) and any manual run. It fires when a run in that hour found missing
events, and when none finished cleanly in it: a run that errored, a reconciler not configured, a
tripped kill switch. The email therefore lands within about an hour after the hour that holds the
cause. Description: "A reconcile run
found missing events, or none finished cleanly this hour", then the runbook link (`alarmDescription`).
`LedgerApp-reconcile-gap` joins `packages/aws/src/ledger-stacks.ts`. Six standard alarms deploy,
inside the AWS-28 constant's 10 free; the cost-brake test's count reads the constant. Expected
firings: before the first configured deploy, after a trip, and during a gap drill (whose dry run
finds 2). The runbook entry says so (D35).

**D25 — The schedule.** A second `Schedule`, `LedgerApp-reconcile-hourly`, on the same
`HOURLY_CRON`, `TimeWindow.off()`, `retryAttempts: SCHEDULE_RETRY_ATTEMPTS` (0) and
`maxEventAge: SCHEDULE_MAX_EVENT_AGE_SECONDS` (60), targeting the reconciler with
`RECONCILE_SCHEDULED_EVENT`. One Scheduler target per schedule (AWS-10), so this is a second
schedule rather than a second target. Both ticks share one expression and land in one database
wake ([Cadence](../integrations.md#cadence-and-the-database)); pp-infra's physical-names list
gains it (§22).

**D26 — Outputs.** `ResendApiKeySecretArn` (the deploy writes the key there, D29). The app
template otherwise keeps slice 2's outputs. Authority: [Secrets layout](../integrations.md#secrets-layout)
("secrets take no physical name … The deploy script reads secret ARNs from stack outputs").

### Read API (`packages/api`)

**D27 — Routes and the run object.** One `createRoute` per entry
([pp-backend → read-api.md](../../.agents/skills/pp-backend/references/read-api.md#one-route-per-operation)):

| Operation | Request | `2xx` | Scope |
| --- | --- | --- | --- |
| `gaps.list` → `GET /gaps` | query `since` (duration, D3, default `24h`), `limit` (1–100, default 20), `after` (a run id) | `200` `ReconcileRunList`: `{ object: 'list', has_more, data: ReconcileRun[] }`, newest first by `run_id`, runs with `started_at` within `since` | `read` |
| `reconcile.getRun` → `GET /reconcile/runs/{run_id}` | path `run_id`, positive integer | `200` `ReconcileRun` | `read` |
| `reconcile.start` → `POST /reconcile` | JSON body, required (`{}` is valid): `dry_run` (boolean, default `false`), `lookback` (duration, D3, optional) | `202` `ReconcileRun` (running) | `operate` |

`ReconcileRun`, the one wire object (`.openapi('ReconcileRun')`):

```json
{
  "object": "reconcile_run",
  "run_id": 42,
  "trigger": "scheduled",
  "dry_run": false,
  "started_at": "2026-10-21T13:00:02.310Z",
  "finished_at": "2026-10-21T13:00:04.902Z",
  "horizon_start": "2026-10-18T12:50:02.310Z",
  "horizon_end": "2026-10-21T12:50:02.310Z",
  "checked": 3,
  "missing": 0,
  "replayed": 0,
  "failed": 0,
  "error": null
}
```

`error` is `null` or the [error object](../../AGENTS.md#error-shape) of `runOutcome` (D3): the
stored code's registry entry, or the derived `run_abandoned`. `claimed_at` and `updated_at` stay
internal. One mapper, `reconcile-run-response.mapper.ts`, builds it for all three routes and for
`health.get`, with the clock port's `now`. The `202` body is the inserted row through the same
mapper. **`health.get`** gains `last_reconcile_run: ReconcileRun | null`, null when no run exists or
the database is unreachable. It is read in the request's one database attempt (slice 2 D19): the
storage read and `latest` run on the same connection, and a classified error nulls both
([read-api.md → health exception](../../.agents/skills/pp-backend/references/read-api.md#middleware-in-this-order)).
`pnpm openapi:export` regenerates the document and the SDK types in the same change.

**D28 — Readers and commands.** `ListGapsReader` (`listSince`, keyset on `id`; the primary key
serves the page, [pp-database → Keyset pages](../../.agents/skills/pp-database/references/indexes-and-jsonb.md#keyset-pages)),
`GetReconcileRunReader` (`get`; none → `run_not_found`), `StartReconcileCommand` (D18).
`ApiDeps` gains `reconcilerInvoke: AsyncFunctionInvokePort`. `apps/api` wires
`LambdaAsyncFunctionInvokeAdapter` over `RECONCILER_FUNCTION_NAME`, and `apps/local` the in-process
one (D23). `testApiDeps` gains a `FakeAsyncFunctionInvoke`.

### Deploy command and scripts (`infra/scripts`)

**D29 — Two deploy inputs.** `deploy-env.schema.ts` gains `LEDGER_DEPLOY_RESEND_API_KEY` (optional,
must start `re_`) and `LEDGER_DEPLOY_RESEND_WEBHOOK_ID` (optional, non-empty). It refuses before
contacting AWS, naming the first offending variable and never its value, when exactly one of the
two is set, or when `LEDGER_DEPLOY_WEBHOOK_SECRETS` is set without both. A connected webhook with no
reconciler would let a gap go unrecovered; the gap alarm would show it, but the refusal stops it
at the source (lens clause 6). The webhook id goes to CDK as `-c ledger:resendWebhookId=<id>`
([pp-infra → Deploy inputs](../../.agents/skills/pp-infra/references/env-and-inputs.md#deploy-inputs)).
The key is written into the `ResendApiKeySecretArn` secret after `cdk deploy`, beside the database
and simulator writes, and the line reads `ledger/resend-api-key written`. Its value never passes
through CDK ([CBL-01](../check-before-launch.md#deploy-configuration)), and with the key unset, no
write runs. Evidence: `run-deploy.test.ts` cases for each refusal, the write and its absence.

**D30 — Teardown and re-arm text.** `pnpm aws:teardown`'s closing steps outside AWS gain "revoke
the Resend API key you made for the reconciler". Destroying its secret does not revoke the key at
Resend, and a forgotten `full_access` key can read every signing secret (RS-05, RS-18;
[decision lens](../../AGENTS.md#decision-lens--evidence-over-claims-right-sized) clause 6, security
exposure). [aws.md → Teardown](../aws.md#teardown) gains the row (§22). `rearm.ts` and `trip-drill.ts` replace
`then: ledger reconcile → slice 4` with `then: pnpm -s ledger reconcile`.

**D31 — The ingest route throttle** (`packages/aws/src/ingest-route-throttle.ts`), over
`readStage` and `withThrottle` (`http-api-stage.ts`):

- `lowerIngestRouteThrottle(client)` refuses when a route setting already exists for
  `POST /webhooks/resend` (a trip or a crashed drill left one: run `pnpm aws:rearm`). Otherwise it
  writes `RouteSettings["POST /webhooks/resend"]` at the kill switch's stop values (`0` / `0`),
  and a route setting overrides the stage default (AWS-14).
- `restoreIngestRouteThrottle(client, { appStackName })` deletes that route setting
  (`DeleteRouteSettings`), but only when the stack is not tripped (the worker's reserved
  concurrency is not `0`). A trip mid-drill writes the same stop values, so the values alone
  cannot tell whose they are, and the re-arm deletes every route setting
  (`kill-switch.ts:218-227`).
- Unit-tested over the `StubClient` (pp-testing → AWS adapters), with each case named.

Authority: card Ships 9 ([build-checklist.md → 4](../build-checklist.md#4--recovery): "lowers the
ingest route throttle to its stop value … restores the throttle"), with the stop value and the
re-arm's behavior read from `packages/aws/src/kill-switch.ts` (§5).

**D32 — `pnpm aws:gap-drill`** (`infra/scripts/gap-drill.ts`), the card's gap script
([pp-infra → scripts.md → Gap script](../../.agents/skills/pp-infra/references/scripts.md#gap-script)).
Every line is prefixed `aws:gap-drill: `; the last is `done`, `refused: <reason>` or
`failed: <reason>` (exit 1). No line holds an id, a key, a URL or an address.

- **Refuses before any change** when: `LEDGER_URL` is not `LedgerApp`'s `ApiUrl` output; the stack
  is tripped; the queue or the DLQ holds a message; the last run is unfinished (`ledger health`);
  `LEDGER_DEPLOY_RESEND_WEBHOOK_ID` or `RESEND_API_KEY` is unset; the minute is outside `:02`–`:40`
  ("the hourly reconcile at :00 would overlap the drill"), since the drill needs ≈ 14 minutes and a
  scheduled run inside its window would recover the gap first or refuse the drill's start; or D31's
  refusal applies.
- **Steps:**
  1. Read the newest List Events page.
  2. Lower the ingest route throttle (D31), with a `finally` that restores it (D31's guard).
  3. Send one email through `resend-client` from `onboarding@resend.dev` to `delivered@resend.dev`,
     subject `Ledger gap drill`, a one-line text, and `Idempotency-Key` `ledger-gap-drill-<UTC
     timestamp>` (RS-42 exempts the test address).
  4. Poll List Events every 2 s, up to 120 s, until the send's two events appear (ids absent from
     step 1's page). Print `events visible after <ms> ms`, the first-seen time minus the newest
     item's `createdAt` (RS-U13).
  5. Wait until the newest event is older than the grace window plus 30 s, printing the wait.
  6. Restore the throttle, printing `ingest route restored`. Resend's attempts so far ran at
     ≈ 0 s, 5 s and 5 min and were throttled; its next one comes ≈ 35 min after the send (RS-09), so
     this restore always precedes it.
  7. Run `ledger reconcile --dry-run --json`, then `ledger reconcile --json`, waiting for each,
     then poll `ledger email <email_id> --json` every 2 s, up to 120 s, until `event_count` is 2.
     Then run `ledger reconcile --dry-run --json` again, and `ledger gaps --since 1h --json`. Each
     is a child process (`process.execPath` with `apps/cli/src/main.ts`, no shell, the drill's own
     `LEDGER_URL` and `LEDGER_TOKEN`, [pp-infra → scripts.md](../../.agents/skills/pp-infra/references/scripts.md#running-the-cdk-cli)).
     It prints `dry run: missing <n>`, `reconcile: missing <n> replayed <n> failed <n>`, `stored 2 of 2`,
     `dry run: missing 0` and `gaps: newest run missing 0`. Any other count fails the drill.
  8. Compare each stored `event_created_at` (from `ledger email`) with
     `retrieveWebhookEventCreatedAt` and print `created_at unchanged by the replay: yes | no`
     (RS-U10).
- The drill fires the gap alarm (its first dry run finds 2, D24). That is expected, and the walk
  records the email.
- Root script: `"aws:gap-drill": "node --env-file-if-exists=.env.local infra/scripts/gap-drill.ts"`.
  `aws:gap-drill` is no pnpm built-in.
- Evidence: `run-gap-drill.test.ts` (unit, fake steps, as `run-deploy.test.ts` does) for each
  refusal, the `finally` restore, a trip left in place, and a count mismatch failing; then the
  recorded run (Ships 9).

### Ingest (`packages/ingest`)

**D33 — `ingest.rejected{reason}`** ([pp-backend → ingest-and-worker.md](../../.agents/skills/pp-backend/references/ingest-and-worker.md#ingest-in-order)
step 3, which leaves the mechanism to this slice):

- **`timestamp`:** `svix-timestamp` is absent, is not an integer (as `parseInt` reads it), or is more
  than 300 s from the clock port's now in either direction (the SDK's window, [Constraint 12](../resend.md#constraints-and-sharp-edges)).
  It is checked before any `verify` call, so no thrown SDK error is parsed.
- **`signature`:** every other rejection: a missing `svix-id` or `svix-signature`, or no
  configured secret matching.
- Emitted once per `401`: `metrics.count('ingest.rejected', 1, undefined, { reason })`. It carries
  no field, because the `svix-id` of an unverified request is attacker-controlled
  (`create-ingest.ts:122-123`). The `ingest.request_rejected` log line stays as it is.

**D34 — `reason` in the log allow-list** (C17): `LogFields` gains
`reason?: 'signature' | 'timestamp'`, and [Log fields](../data-modeling.md#log-fields) lists it
(§22).

### Runbook, README

**D35 — Runbook** (`docs/runbook.md`):

- A new `## Procedures` section with `### Rotate the webhook signing secret`, in C5's order:
  1. Rotate at Resend: `curl -X POST "https://api.resend.com/webhooks/$WEBHOOK_ID/signing-secret/rotate"
     -H "Authorization: Bearer $RESEND_API_KEY"` (Ask-first), which returns the new secret (RS-13).
  2. Set `LEDGER_DEPLOY_WEBHOOK_SECRETS=<old>,<new>` and run `pnpm aws:deploy`; ingest picks the set
     up within 5 minutes (ADR-009).
  3. Watch `ingest.rejected` stay flat: `aws cloudwatch get-metric-statistics --namespace Ledger
     --metric-name ingest.rejected --dimensions Name=reason,Value=signature --statistics Sum
     --period 300 --start-time <15 min ago> --end-time <now>` returns no datapoint above 0.
  4. Within 24 h of step 1 (RS-04), set `LEDGER_DEPLOY_WEBHOOK_SECRETS=<new>`, redeploy, and watch
     again.
  5. If the old secret was retired too early, deliveries answer `401` and Resend retries them
     (RS-10): restore it, then `pnpm -s ledger reconcile`.

  Local mode: the same with `LEDGER_WEBHOOK_SECRETS` and a restart.
- `### LedgerApp-reconcile-gap` under Alarms. **First:** `pnpm -s ledger gaps --since 2h`. **Then:**
  newest run `missing > 0` with no error: the next hourly run replays them, or run
  `pnpm -s ledger reconcile` now; if they stay missing, check `ledger dlq inspect` (a dead event is
  missing until redriven) and whether the ingest route is throttled (a crashed gap drill:
  `pnpm aws:rearm`). A run carrying an error: follow that code's entry. No run at all: `ledger
  health` (a tripped stack answers `api_unavailable`). Expected after a gap drill and before the
  first configured deploy.
- `### reconciler_not_configured` under Error codes.
- Every "Slice 4 lands" line becomes a real command: the `reconcile_in_progress`, `run_not_found`
  and `run_abandoned` entries ("Slice 4 lands this operation", "slice 4's",
  `docs/runbook.md:173-174, 197-198, 215-217`), and the two alarm-entry steps that say "Slice 4
  lands `ledger reconcile`" (`docs/runbook.md:82, 102`), which become `pnpm -s ledger reconcile`.
- `internal_error`: a run that ended `internal_error` is in `/ledger/LedgerApp-reconciler` under its
  `run_id`.
- The intro's log-group list gains `/ledger/LedgerApp-reconciler`.

Authority: card Ships 5 and 11, [ADR-009](../architecture.md#adr-009--multi-secret-verification-and-timestamp-tolerance)
("slice 4 adds the rotation runbook"), C5's order, and the `operations-runbook` spec's "Every alarm
has a runbook entry" and "Every runbook-linked error code has a runbook entry".

**D36 — README at the M1 boundary** (Ships 10; [features.md → discover](../features.md#adopter-lifecycle);
[about.md → Positioning](../about.md#positioning)):

- The status line says M1 is done and names what is not built yet (MCP, reactions, local
  `docker compose`), with no claim attached to it.
- Each reliability claim in "What Ledger does" links its evidence: duplicates and order
  (properties 1–4, invariants 1 and 2, `record-event.command.int.test.ts`), bursts (slice 3's burst
  run in ADR-008's Evidence), database outages (`--chaos db-outage`, ADR-015), poison isolation
  (invariant 4), and recovery (the fake-API integration tests and the recorded gap drill).
- Reconcile is described as "the same approach as the Ingester's open PR #13", not as new.
- "Reacts" and "an MCP server" move to a "Planned for M2" list that states no behavior.
- One Demo section links the gap drill's recorded run and slice 3's runs. No deployed URL
  ([CBL-20](../check-before-launch.md#public-repo-hygiene)), no id.
- `node scripts/check-links.mjs` reports 0 broken; the reviewer's 0-unlinked-claims check is §21
  path F.

### Experiments and `[Unverified]` rows

**D37 — E1: the replay chain (RS-U01, RS-U20, RS-U02)**, before `opsx:apply` if the owner agrees
(§4, §25), and in any case before the slice is called done. These are read-only calls except one:

1. `GET /webhooks/{id}/events` returns the production webhook's ids.
2. `GET …/events/{event_id}` on one stored event returns its `data.email_id`.
3. `pnpm -s ledger email <email_id> --json` gives the timeline's `svix_id`s. When they equal the
   List Events ids, **RS-U02 is settled**.
4. **Ask-first:** `POST …/events/{event_id}/replay`.
5. `GET …/events/{event_id}/attempts`: the newest attempt answers `http_status_code` `200` on an
   event days older than 5 minutes, so the replay passed the timestamp window. **RS-U20 is
   settled.**
6. `aws logs filter-log-events --log-group-name /ledger/LedgerApp-worker --filter-pattern
   '"worker.duplicates"'` since the replay shows one line carrying that `svix_id`, and
   `ledger email`'s `event_count` is unchanged. The replay kept the id. **RS-U01 is settled.**

The results become RS-44 (List Events ids are delivered `svix-id`s), RS-45 (a replay carries the
original `svix-id` and a fresh, passing `svix-timestamp`). No id is recorded. If step 5 or 6 fails,
the card goes `[!]` with that reason, and ADR-007 needs a superseding design before recovery is
called done ([pp-workflow → Never](../../.agents/skills/pp-workflow/SKILL.md#never)).

**D38 — RS-U03, RS-U13, RS-U17 (read-only), on or after 2026-10-21.** RS-U03: page the production
webhook's List Events to `has_more: false` and record the oldest event's date and its age, which
needs to be at least 72 h (the webhook's oldest event is from 2026-10-18, §4). RS-U13: the gap
drill's `events visible after <ms> ms` (D32 step 4). RS-U17: one `GET /webhooks/{id}` with a
well-formed key no account issued (`re_` plus random characters). It is expected to answer `400`
`validation_error` "API key is invalid" (api-reference/errors: "a key that doesn't exist or was
deleted"), and the row records the observed status and name. That call settles the
never-issued half only. The deleted (revoked) half is closed as safe in both outcomes, as the row's
own Owed-by cell states: Constraint 14 maps the documented answer by message, and any other answer
takes the default branch. Creating and revoking a real key would be two Ask-first writes for the
same documented answer. Authority: card Ships 7 ("closed by read-only checks") and
[resend.md → \[Unverified\]](../resend.md#unverified), the RS-U03, RS-U13 and RS-U17 rows.

**D39 — E3: the disabled-webhook experiments (RS-U04, RS-U05)**, on a throwaway test webhook,
every write Ask-first. The test webhook points at the deployed ingest URL with its secret **not**
added to the set, so each delivery answers `401` and is visible in List Attempts, and nothing
reaches the ledger. The production webhook delivers each send normally.

1. Create the test webhook (all events).
2. Send one email to `delivered@resend.dev`. Its events reach the test webhook.
3. `PATCH` the test webhook to `disabled`.
4. Replay one of its events. Read the response and List Attempts, where a new attempt or none
   settles **RS-U04**.
5. Send a second email. List Events on the test webhook shows whether events are created while it
   is disabled (**RS-U05**, first half).
6. `PATCH` it to `enabled`. List Attempts shows whether those events are then delivered
   (**RS-U05**, second half).
7. Delete the test webhook.

If the owner holds E3, both rows close as safe in both outcomes, which Ships 8 allows. RS-U04:
the status is read before any replay (rule 5). RS-U05: within the No-loss invariant's scope
("every event Resend produced for the webhook"); if Resend creates no event for a disabled
webhook, no replay can recover it, and the runbook's `webhook_disabled` entry says so. Authority:
card Ships 8 and [resend.md → \[Unverified\]](../resend.md#unverified), the RS-U04 and RS-U05 rows,
whose Owed-by cells already name these two safeguards (status checked first; reconcile after
re-enable).

**D40 — RS-U06, RS-U09, RS-U10, PG-U03.**

- **RS-U06** is proved safe by the status read every run, evidenced by the disabled-webhook
  fake-API integration test.
- **RS-U09** is safe in both outcomes (§3). Ingest makes one `verify` per secret, and the "both
  signatures in one header" case passes ([create-ingest.test.ts](../../packages/ingest/src/create-ingest.test.ts)).
- **RS-U10** is settled by the gap drill's `created_at unchanged by the replay` line (D32 step 8),
  and by `event_created_at` falling seconds after the send.
- **PG-U03:** the card closes it as safe in both outcomes (Ships 7). On cost, Neon Free never bills
  ([integrations.md → Decision](../integrations.md#decision--neon)). On availability, a suspended
  compute or a full store pauses the worker while the queue holds events, which
  `database-outage.int.test.ts` and slice 3's `--chaos db-outage` run prove (ADR-015). The 30-day
  usage reading is a named event: 30 days after the reconciler's first configured deploy, it goes
  beside [Cost shape](../aws.md#cost-shape) ([CBL-18](../check-before-launch.md#cost--teardown)).

**D41 — Where each result lands.** Each settled row is struck through with its RS or AWS fact. Each
safe-either-way row cites its test. Every change goes through the
[resend.md](../resend.md#unverified), [aws.md](../aws.md#unverified) and
[integrations.md](../integrations.md#unverified) rules, in the change that records the result.

## 8. Data model

**Ask-first:** owner-approved 2026-10-19 (§7 item 2). The Drizzle schema in `packages/db` owns
columns and types; migrations are expand/contract only, and this one is pure expand
([data-modeling.md → How to use](../data-modeling.md#how-to-use), ADR-018).

**`reconcile_runs`**, an ops record ("Insert, claim once, finish once"), at
`packages/db/src/schema/reconcile-runs.ts`:

| Column | Type | Null | Notes |
| --- | --- | --- | --- |
| `id` | `bigint GENERATED ALWAYS AS IDENTITY` | no, PK | `run_id` on the wire; the page key ([base fields](../data-modeling.md#base-fields--the-checklist-for-every-new-model)) |
| `trigger` | `text` | no | `reconcile_runs_trigger_check`: `scheduled`, `manual` (D5) |
| `dry_run` | `boolean` | no | A dry run replays nothing |
| `started_at` | `timestamptz` `DEFAULT now()` | no | Row time (C8); the time budget's origin; `gaps.list`'s window filter |
| `claimed_at` | `timestamptz` | yes | Set by the claim (manual) or at insert (scheduled), D6, D16 |
| `finished_at` | `timestamptz` | yes | Null while running; null past the budget reads `run_abandoned` |
| `horizon_start` | `timestamptz` | no | The window's oldest edge, fixed at start (C14) |
| `horizon_end` | `timestamptz` | no | The grace boundary, fixed at start |
| `checked`, `missing`, `replayed`, `failed` | `integer` `DEFAULT 0` | no | `reconcile_runs_counts_check`: each `>= 0` |
| `error_code` | `text` | yes | `reconcile_runs_error_code_check`: the six codes of D1; never `run_abandoned` |
| `updated_at` | `timestamptz` `DEFAULT now()` | no | Set with every claim and finish (C8) |

- **Constraints:** the three named checks above, plus `reconcile_runs_horizon_check`
  (`horizon_start <= horizon_end`). No foreign key, no `pgEnum`, no `deleted_at`, no `tenant_id`
  ([Anti-patterns](../data-modeling.md#anti-patterns-must-not)).
- **Indexes:** none beyond the primary key. `gaps.list` and the anchor read page backward on `id`,
  which the primary key serves ([Keyset pages](../../.agents/skills/pp-database/references/indexes-and-jsonb.md#keyset-pages)).
  `hasUnfinishedRun` scans a table that grows by about 24 rows a day (the hourly cadence plus
  manual runs), so an index would cost every write and buy nothing at
  [the ceiling](../about.md#platform-scale-assumptions).
- **The idempotency key** is the start lock plus `hasUnfinishedRun`, not a unique column. A
  duplicate start is refused (`reconcile_in_progress`), and a duplicate invoke changes zero rows at
  the claim ([Idempotency keys](../data-modeling.md#idempotency-keys)'s new row, §22). "No key, no
  table" is met by a lock that decides, not a read-then-write guard
  ([commands-and-readers.md](../../.agents/skills/pp-backend/references/commands-and-readers.md#idempotency-the-constraint-decides)).
- **No `jsonb`, no PII, no secret.**
- **Migrations:** `0004_create-reconcile-runs.sql` (`pnpm db:generate --name create-reconcile-runs`,
  read: one `CREATE TABLE`, named constraints, no `DROP`), then
  `0005_grant-reconcile-runs.sql` (`--custom`): `GRANT SELECT, INSERT, UPDATE ON reconcile_runs TO`
  the runtime role ([pp-database → Grants](../../.agents/skills/pp-database/references/migrations-and-grants.md#grants):
  set-once rows). Pending migrations apply in one transaction, so the table never exists
  ungranted. The identity column's sequence needs no grant (about.md Resolved, slice 2). No
  backfill.
- **`webhook_events`:** no schema change; `presentSvixIds` reads it (D6).

## 9. State machines and transitions

`reconcile_runs` is an ops record, not a projection: no event set folds into it, and it writes no
outbox row.

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

A transition happens only through the repository's guarded `UPDATE`s
(`claimed_at IS NULL AND finished_at IS NULL`; `finished_at IS NULL`), so a duplicate invoke, a
late finish or a second claim changes nothing. No order comes from transport: a run's horizon and
the anchor come from stored rows and the clock, never from arrival order.

## 10. Backend surface

| Operation | Kind | Semantics | In / Out | Scope | Idempotency | Surfaces | New? |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `gaps.list` | read | Runs in the window, newest first, each with its counts and outcome | `since`, `limit`, `after` → list of `ReconcileRun` | `read` | Side-effect free | SDK `ledger.gaps.list`; CLI `ledger gaps`; MCP `list_gaps` (slice 5) | new |
| `reconcile.getRun` | read | One run, `run_abandoned` derived | `run_id` → `ReconcileRun` | `read` | Side-effect free | SDK `ledger.reconcile.getRun`; CLI (the wait); MCP none | new |
| `reconcile.start` | command | Starts one manual run asynchronously | `dry_run`, `lookback` → `202` `ReconcileRun` | `operate` | Refused while a run is unfinished inside its budget; a duplicate invoke exits at its claim; replays dedupe on `svix_id` (RS-U01, D37). Spends the Resend budget through `resend-client` | SDK `ledger.reconcile.start`; CLI `ledger reconcile`; MCP `reconcile` (slice 5) | new |
| `health.get` | read | Gains the last run | → `last_reconcile_run` | `read` | As before | SDK, CLI `ledger health` | existing, extended |

No new operation exists beyond [api-contract.md](../api-contract.md)'s entries. Paths and verbs are
the entries' own.

## 11. Async — outbox, jobs, webhooks

- **Outbox:** not touched; reactions are slice 6's.
- **Scheduled job:** `LedgerApp-reconcile-hourly` (D25) → the reconciler's `runScheduled`.
  Overlap is stopped by the start lock and `hasUnfinishedRun` (D6). A duplicate delivery of one
  tick is refused there. A tick throttled during a trip expires after 60 s (C15).
- **Async invoke:** the read API → the reconciler, at most once in effect (D7, D16, D20).
  `MaximumRetryAttempts: 0`, so a lost invoke reads `run_abandoned` and the next hourly run covers
  the horizon (ADR-007).
- **Inbound webhooks:** a replay arrives as an ordinary delivery through ingest, verified against
  the secret set (RS-16, RS-U20), queued, and deduplicated by the worker on `svix_id` (ADR-004).
- **DLQ:** a dead-lettered event is missing from `webhook_events`, so each run replays it (ADR-007).
  If its fault persists, the replay dead-letters again after `maxReceiveCount`; the DLQ alarm and
  the gap alarm both show it.
- **Retry and backoff ownership:** `resend-client` (D10, D11). No SQS ordering is relied on
  (ADR-002).

## 12. Surfaces

### `gaps.list` — `GET /gaps` → `ledger.gaps.list({ since?, limit?, after? })` → `ledger gaps [--since <duration>] [--json]`

- **Actor and scope:** any `read` token (operator, reviewer).
- **CLI:** passes `--since` through as given (the API validates, D3) and asks `limit: 100`, the
  page maximum; `ledger gaps` names no paging flag (the `token list` precedent, D25 of slice 2).
  When `has_more` is set, stderr carries `ledger: more runs exist; showing the newest 100.`.
- **Human output:** one row per run, columns as wide as their widest cell, the last unpadded. An
  empty list prints `  —`. The outcome column reads `ok`, `running`, or the `error.code` as the API
  sent it; the CLI writes no code literal ([pp-cli → Never](../../.agents/skills/pp-cli/SKILL.md#never)).

  ```text
    43   manual      dry run   2026-10-21T13:25:40.120Z   checked 2   missing 0   replayed 0   failed 0   ok
    42   manual                2026-10-21T13:24:10.554Z   checked 2   missing 2   replayed 2   failed 0   ok
    41   scheduled             2026-10-21T13:00:02.310Z   checked 0   missing 0   replayed 0   failed 0   ok
  ```

- **`--json`:** the `ReconcileRunList` as returned.
- **Errors:** `validation_failed` (`since`, `limit`, `after`), `unauthorized`, `database_unavailable`, `internal_error`.

### `reconcile.start` + `reconcile.getRun` → `ledger reconcile [--dry-run] [--lookback <duration>] [--no-wait] [--json]`

- **Actor and scope:** `operate` only; a `read` token gets `403 forbidden` and nothing starts.
- **Flow ([pp-cli → Waiting](../../.agents/skills/pp-cli/references/command-anatomy.md#waiting)):**
  1. `reconcile.start({ dry_run, lookback })`.
  2. stderr notice: `ledger: reconcile run <run_id> started; follow it with ledger gaps.`
  3. With `--no-wait`: print the `202` run and exit `0`.
  4. Otherwise poll `reconcile.getRun` every `RUN_POLL_INTERVAL_MS = 3_000` until `finished_at` is
     set or `error` is set (an abandoned run has `error` and no `finished_at`). A run with `error`
     exits `1` with that error in the error shape. A `getRun` error exits `1` with it.
  5. The backstop: `RUN_WAIT_BACKSTOP_MS = 1_200_000` (20 min, above the 14-minute budget the API
     derives from; the CLI never computes the budget). Hitting it is a defect (the API's derivation
     did not happen): exit `1` with the `internal_error` object under `--json`, or the constant
     defect line otherwise.
- **Poll cost:** each poll is one HTTP API request, one Lambda invocation and one Postgres read
  ([command-anatomy.md](../../.agents/skills/pp-cli/references/command-anatomy.md#waiting)). At 3 s,
  a full 14-minute run costs 280 polls, inside the throttle and the free tiers.
- **Human output (finished, no error):**

  ```text
  run 42   manual
  started    2026-10-21T13:24:10.554Z
  finished   2026-10-21T13:24:14.008Z
  horizon    2026-10-18T13:14:10.554Z → 2026-10-21T13:14:10.554Z
  checked 2   missing 2   replayed 2   failed 0
  ```

  A dry run's first line reads `run 43   manual   dry run`.
- **`--json`:** the final `ReconcileRun`, or `{ "error": … }`.
- **Errors raised:** `forbidden`, `validation_failed` (`dry_run`, `lookback`), `reconcile_in_progress`,
  `database_unavailable`, `internal_error` (the invoke failed, D18), `unauthorized`; and as run
  outcomes, `webhook_disabled`, `rate_limited`, `resend_auth_failed`, `resend_unavailable`,
  `reconciler_not_configured`, `internal_error`, `run_abandoned`. `api_unavailable` comes from the SDK.

### `health.get` → `ledger health`

`last_reconcile_run` on the wire (D27). The human output gains one line after `database`:
`reconcile   run 42 finished 2026-10-21T13:24:14.008Z, missing 2, replayed 2`, or
`reconcile   run 42 running`, or `reconcile   run 42 <error.code>`, or `reconcile   no run yet`
(database reachable, no run). With the database unreachable it prints `reconcile   —`.

### Error codes raised, in the [error shape](../../AGENTS.md#error-shape)

Every `message`, `hint` and `docs` is the registry's ([Error codes](../api-contract.md#error-codes),
mirrored in `packages/core/src/error-codes.ts`). The new and route-specific ones, written out:

| Code | `message` | `hint` |
| --- | --- | --- |
| `reconciler_not_configured` | The reconciler has no Resend API key or webhook id, or Resend has no webhook with that id, so it cannot list or replay events. | Reconcile runs on a deployed stack: set `LEDGER_DEPLOY_RESEND_API_KEY` and `LEDGER_DEPLOY_RESEND_WEBHOOK_ID`, then run `pnpm aws:deploy`. |
| `validation_failed` (`since`) | since must be a duration from 1m to 30d, such as 24h. | Fix the field the message names, then retry. |
| `validation_failed` (`lookback`) | lookback must be a duration from 1m to 30d, such as 72h. | (registry) |
| `validation_failed` (`dry_run`) | dry_run must be true or false. | (registry) |
| `validation_failed` (the body of `POST /reconcile`: not JSON, not an object, or a field of the wrong type) | The request body must be a JSON object with optional dry_run and lookback fields. | `bodyHint`, as the other body routes. `POST /reconcile` joins `bodyErrors` with fields `dry_run` and `lookback` (`packages/api/src/create-api.ts:87-89`: "Each JSON-body route's body message and the fields its own message names") |
| `validation_failed` (`run_id`) | run_id must be a positive integer. | (registry) |
| `validation_failed` (`after` on `/gaps`) | after must be a run id, a positive integer. | (registry); route-scoped like `dlq.listMessages`'s `limit` (`create-api.ts` `routeFieldErrors`) |
| `validation_failed` (`limit` on `/gaps`) | limit must be an integer from 1 to 100. | (registry) |
| `reconcile_in_progress` | Another reconcile run is unfinished and still inside its time budget; runs never overlap. | Wait for it: `ledger gaps`. |
| `run_not_found` | No reconcile run with this id. | List runs with `ledger gaps`. |
| `run_abandoned` | The run has no `finished_at` past its time budget (it crashed or its invoke was lost), so it will not finish. | Run `ledger reconcile` again; the next hourly run covers the horizon. |
| `webhook_disabled`, `rate_limited`, `resend_auth_failed`, `resend_unavailable`, `internal_error`, `forbidden`, `unauthorized`, `database_unavailable` | the registry's | the registry's |

### `pnpm aws:gap-drill` (not an operation)

D32. Owner-only, Ask-first: it lowers a throttle on the kept stack and sends one email.

### Alarm email (not an operation)

`LedgerApp-reconcile-gap` → `LedgerGuardrails-alert` → the owner (D24).

## 13. Recovery paths — redrive, replay, reconcile

- **Reconcile and replay (this slice):** an event Resend produced for the webhook that never
  reached `webhook_events` is found by the id diff and replayed. The replay comes back through
  ingest, keeping its `svix-id` (RS-U01, D37) and passing the timestamp window (RS-U20). The
  worker's `ON CONFLICT (svix_id) DO NOTHING` makes a replay of a stored event, or one that races a
  late original delivery, a counted duplicate with no second row and no second effect (ADR-004).
- **The anchor** (D4) keeps the checked windows chained across any span when runs could not run (a
  trip, an outage, a quota suspension), so no `--lookback` is needed, up to 30 days and List
  Events reach (RS-U03).
- **DLQ redrive (slice 3)** still covers poison messages. The reconciler replays a dead event each
  run until it is redriven or purged, which is harmless: it dead-letters again on the same fault.
- **The worker pause (ADR-015)** holds queued events; the grace window grows with the queue's age,
  so a paused backlog is not counted missing. A queued event delivered late (its `created_at` older
  than the queue's age) can still be counted and replayed; the replay is a duplicate on `svix_id`.
- **A run's own failure** is covered by the next hourly run: a crash reads `run_abandoned`, and a
  stop at the deadline is `rate_limited` and never anchors.

## 14. Business rules and invariants

These become `spec.md` requirements:

1. The reconciler MUST read the configured webhook's status before any List Events or replay call,
   and MUST stop with `webhook_disabled` when it is disabled.
2. A run MUST NOT count an event younger than its grace window (`max(10 min, the queue's oldest
   age)`) as missing, and MUST NOT replay it.
3. A run MUST check back to the horizon of the newest clean run (finished, no error code, nothing
   missing) when that is older than its lookback, capped at 30 days, with no `--lookback`.
4. Every replay MUST re-enter through ingest; no path writes a fetched payload into
   `webhook_events`.
5. A replayed event that is already stored, delivered twice or out of order MUST leave exactly one
   `webhook_events` row and unchanged projections (dedupe on `svix_id`).
6. After an outage longer than Resend's retry schedule, a run that finishes with no `error_code`
   MUST leave every event List Events holds for its window present exactly once (100 % recovered,
   0 duplicates). A gap too large for one run's budget ends that run `rate_limited` and is finished
   by the next ones ([rule 2](../integrations.md#locked-rules-must): ≈ 6 runs for 10,000 events).
7. Two concurrent starts MUST yield one run and one `reconcile_in_progress`.
8. A second invoke of a claimed run, or any invoke of a finished one, MUST make no Resend call.
9. One failed replay MUST NOT abort a run; it counts in `failed`.
10. A run MUST finish with a registered outcome: none, `webhook_disabled`, `rate_limited` (a `429`
    it cannot wait out, a quota, or its deadline before its horizon), `resend_auth_failed`,
    `resend_unavailable`, `reconciler_not_configured`, or `internal_error`. `run_abandoned` MUST be
    derived on read and MUST never be stored.
11. `resend-client` MUST space request starts at its rate, yield when `ratelimit-remaining` falls
    below half of `ratelimit-limit`, wait `retry-after` on a `429`, and stop before any wait that
    passes its deadline.
12. A Resend response body, the API key and a signing secret MUST NOT reach a log line, an error
    message, a stored row or any surface's output.
13. Ingest MUST emit `ingest.rejected` with `reason` `timestamp` or `signature` on every `401`, and
    MUST stop accepting a removed secret once the 5-minute cache has passed.
14. A dry run MUST replay nothing and MUST report the same missing count a real run would.

## 15. Authorization and idempotency

| Surface | Authentication | Scope | A missing, bad or out-of-scope caller |
| --- | --- | --- | --- |
| `GET /gaps`, `GET /reconcile/runs/{run_id}` | Bearer token, tag then lookup ([read-api.md → Middleware](../../.agents/skills/pp-backend/references/read-api.md#middleware-in-this-order)) | `read` | `401 unauthorized`; `503 database_unavailable` during an outage (only `health.get` is exempt) |
| `POST /reconcile` | Bearer token | `operate` | `401`; a `read` token `403 forbidden` before any validation or start |
| `health.get` | Unchanged | `read` | Unchanged |
| The reconciler's invoke | IAM: only the read API's role and the schedule's role may invoke it (D22) | — | — |
| A replayed delivery | Svix signature over the raw body (ADR-001, ADR-009) | — | `401`, `ingest.rejected` |

- **Idempotency per write:** a start → the lock plus the unfinished check; a claim → `claimed_at IS
  NULL AND finished_at IS NULL`; a finish → `finished_at IS NULL`; a replay → `webhook_events.svix_id`.
- **Integration tests against real Postgres** (mandatory tier, [pp-workflow → Test tiers](../../.agents/skills/pp-workflow/SKILL.md#test-tiers)):
  two concurrent starts → one row and one `reconcile_in_progress`; a second invoke of a claimed run
  → zero fake-API requests; a finished row's claim → zero rows; the replay of a stored event → one
  row; the fake-API recovery suites (§20); and a `read` token on `POST /reconcile` → `403`, no row.

## 16. Cost and the Resend budget

| Added | Idle cost | Note |
| --- | --- | --- |
| Lambda `LedgerApp-reconciler`, arm64, 256 MB | 0 | 730 hourly runs × a few seconds ≈ 550 GB-s/month, inside the 400,000 GB-s free tier (AWS-20) |
| Schedule `LedgerApp-reconcile-hourly` | 0 | ≈ 730 invocations/month of 14M free (AWS-26) |
| Secret `ledger/resend-api-key` | **USD 0.40/month** (AWS-11) | Brings the adopter to the 3 secrets [Cost shape](../aws.md#cost-shape) already plans for M1 (4 in the owner's deployment, with the simulator) |
| Log group `/ledger/LedgerApp-reconciler`, 30 days, `DESTROY` | ≈ 0 | A few lines per run (AWS-29) |
| EMF `reconcile.*`, three metrics emitted hourly | 0 | Within the 10 free custom metrics; `ingest.rejected` splits into two by `reason`, so at most ten distinct metrics exist (AWS-12) |
| Alarm `LedgerApp-reconcile-gap` | 0 | 6 of 10 free (AWS-28) |
| Neon wakes | 0 on Free | The reconciler is the first hourly waker: ≈ 18 CU-h/month against the ≤ 30 CU-h wake budget ([Cadence](../integrations.md#cadence-and-the-database)); PG-U03 measures it |

No always-on resource is added: no reserved or provisioned concurrency, no VPC, no KMS key.

**The Resend budget** (ADR-012, [rule 2](../integrations.md#locked-rules-must)). An idle hourly run
makes one Retrieve Webhook and one List Events page, ≈ 1,460 requests a month, spaced by the
2 req/s limiter. A gap costs one page per 100 events plus one replay per missing event: a 10,000-event
gap is ≈ 85 min of request time over ≈ 6 hourly runs, each stopped by its budget (C2). The limiter
yields on low `ratelimit-remaining`, so the team's own sending keeps priority. The gap drill adds a
second limiter only while it runs (C16).

## 17. PII and retention

- **List Events** items hold `id`, `type`, `created_at` and `status`, no PII (RS-14).
- **Retrieve Webhook** holds the signing secret and the endpoint URL. `resend-client` returns
  `status` alone (D9).
- **Retrieve Event** holds the payload with raw addresses (RS-15). Only the gap drill calls it, and
  `resend-client` returns its `created_at` alone (D9). The drill prints no id.
- **`reconcile_runs`** holds counts, timestamps and closed-set codes, no PII and no secret (§8).
- **Logs:** `run_id`, `svix_id`, `error_code`, `error_name`, counts and `reason`
  ([Log fields](../data-modeling.md#log-fields)). The SDK's own console logger is silenced (D9).
  The API key never appears anywhere but Secrets Manager and the deploy's write.
- **Surfaces:** `ReconcileRun` holds ids, timestamps, counts and the error object; no route returns
  a payload. No route here reads `webhook_events.payload` or a queue envelope, so pp-workflow's
  route-level redaction test does not apply. The run mapper's unit test asserts its keys anyway.
- **Retention:** unchanged (ADR-014, slice 7). The replays add rows to `webhook_events` exactly as
  live deliveries do.
- **Fixtures** use `delivered@resend.dev` and `bounced@resend.dev` only.

## 18. Integrations, env and owner ops

- **Resend:** `packages/resend-client` is the only caller (ADR-012). It uses a dedicated
  `full_access` key in `ledger/resend-api-key`, read by `apps/reconciler` only
  ([Secrets layout](../integrations.md#secrets-layout)). The gap drill uses the owner's own
  `RESEND_API_KEY` from the shell, never a secret.
- **Public variables:** `LEDGER_DEPLOY_RESEND_API_KEY` and `LEDGER_DEPLOY_RESEND_WEBHOOK_ID` (D29,
  approved), each listed in [api-contract.md → Conventions](../api-contract.md#conventions) and as a
  name-only line in `.env.example`:

  ```text
  # Reconciler's full_access Resend key, read by pnpm aws:deploy (slice 4); optional, with the webhook id.
  LEDGER_DEPLOY_RESEND_API_KEY=
  # The Resend webhook id the reconciler lists and replays, read by pnpm aws:deploy and pnpm aws:gap-drill (slice 4).
  LEDGER_DEPLOY_RESEND_WEBHOOK_ID=
  ```

  `RESEND_API_KEY`'s comment gains "and `pnpm aws:gap-drill`".
- **Internal variables:** `reconcilerEnv` (D21) and `apiEnv.RECONCILER_FUNCTION_NAME` (D22), in
  `packages/shared/src/function-env.ts`, never in `.env.example`.
- **Owner ops** (work items, §25): create the dedicated key, set the two variables, approve the
  redeploy, run E1, read RS-U03 on or after 2026-10-21, approve the gap drill and E3, walk the M1
  demo, and revoke the key at teardown. Until the redeploy writes the key and the id, every run ends
  `reconciler_not_configured`, and the gap alarm says so.

## 19. Decision lens, in writing

**The self-service test**, for each stage this slice touches:

| Stage | Who does what by hand | Verdict |
| --- | --- | --- |
| deploy | The two new inputs are optional on a first deploy, which has no webhook yet. The deploy refuses a half-configured reconciler and a connected webhook without one (D29) | Nothing new on the path. A missing input is refused, never silent |
| connect webhook | Creating the webhook, storing its secret and recording its id is already the documented one-time step ([features.md → connect webhook](../features.md#adopter-lifecycle)). It now also covers creating the reconciler's key and setting both variables, then one redeploy | Admitted, one-time per installation. The existing tripwire stands: a redeploy that changes the URL |
| recover | Hourly and automatic. The webhook's status is read every run. A disabled webhook needs a human to re-enable it in Resend, which emails the team when it auto-disables (RS-11). The gap alarm emails the owner when recovery finds gaps or cannot run (D24) | No unbounded silent wait remains. Re-enabling a disabled webhook is Resend's own control and correctly manual |
| rotate secret | The runbook procedure: one Resend call, two `pnpm aws:deploy` runs, bounded by RS-04's 24 h | The documented manual step features.md accepts; its order is corrected (C5) |
| tear down | The secret is destroyed with the stack; the key must be revoked at Resend, now printed (D30) | Discharged by the printed step |
| query | `ledger gaps`, `ledger health` | Nothing owed |

The gap drill and E1–E3 are owner-only demo and evidence operations, off the adopter's path: owner
ops, scripted where they recur (the drill) and Ask-first where they write.

**The cost brake.** The design reuses the two queues' attribute reads, the one hourly cron
expression, the Lambda free tier and a vended alarm metric path, and adds one secret already in the
plan (USD 0.40). Rejected as cheaper but wrong: diffing by delivery status instead of by id (misses
"acknowledged but never stored", ADR-007), and no alarm (owner-ruled against, D24). Rejected as
over-engineering at [the ceiling](../about.md#platform-scale-assumptions): a shared limiter across
functions (single-flight callers make it unnecessary, ADR-012), a progress-per-page write to
`reconcile_runs`, an index on `reconcile_runs`, a live local reconciler, an SQS queue for reconcile
requests, and a status column.

## 20. Test plan

| Requirement (§14) | Tier | Test (would fail if the mechanism were removed) |
| --- | --- | --- |
| 11 | unit (fake clock, injected sleep) | `limiter.test.ts`: 2 req/s spacing over 10 calls; a response with `remaining 4 / limit 10` delays the next start by `ratelimit-reset`; a `429` with `retry-after: 3` waits 3 s, then succeeds; a quota-named `429` and a `retry-after`-less one throw `rate_limited` with no retry; a wait past the deadline throws `rate_limited` without sleeping |
| 11, 12 | unit, against the fake Resend API | `create-resend-client.test.ts`: `baseUrl` and `User-Agent` sent; status-then-name mapping per D12 row; `5xx` retried twice then `resend_unavailable`; a refused connection the same; `retrieveWebhook` returns no `signing_secret`; `sendEmail` carries `Idempotency-Key`; **nothing written to `console.error`** on a `4xx`, a `5xx` and a refused connection (C9) |
| 3 (core) | unit + property | `reconcile-horizon.prop.test.ts` (D3 properties); `run-outcome.test.ts` (abandoned at budget + 1 ms, not at budget; stored code wins); `parse-duration.test.ts` |
| 7, 8 | int (real Postgres) | `start-reconcile.command.int.test.ts`: two concurrent starts → one row, one `reconcile_in_progress`; `reconciler.int.test.ts`: a second `runClaimed` of a claimed run → zero fake-API requests; a finished row's claim → no work; a failed invoke → row finished `internal_error` and the next start accepted |
| 1, 4, 5, 6, 9, 10, 14 | int, real reconciler + real `resend-client` + fake Resend API + real ingest and worker over the in-process queue + Postgres | `recovery.int.test.ts`: **outage past the retry schedule** (N events in List Events, N − k stored, `onReplay` delivering through ingest) → after one run every id stored once, `replayed = k`, a second run `missing 0`, and a re-delivered stored event leaves one row (**100 % recovered, 0 duplicates**); **5-day gap** (an anchor run 5 days old, events 3–5 days old missing) → recovered with no `--lookback`; **disabled webhook** → `webhook_disabled`, no List Events request; **`429` storm** (five `429`s with `retry-after: 1`, then `200`s) → the run completes; **queued backlog** (queue age 30 min, an unstored event 20 min old) → not counted, not replayed; **one failed replay** (`422` for one id) → `failed 1`, the others replayed; **deadline** → `rate_limited`, never an anchor; **dry run** → `missing` equal to a real run's, zero replay requests; **not configured** → `reconciler_not_configured`, zero requests |
| 3 | int | `reconcile-runs.repository.int.test.ts`: every closed-set member inserts and an outside value fails `23514`; `run_abandoned` refused by the `CHECK`; the anchor picks the newest clean `missing = 0` run over a newer dry run with `missing > 0`; inserts, claims and finishes as the runtime role |
| 4 (surfaces) | int: the shared SDK ↔ API contract suite under `@hono/node-server` and the Lambda adapter | `read-api-contract.ts` grows: `reconcile.start` → `202` running run, the fake invoke got `{ ledger: 'reconcile-run', run_id }`; a second start → `reconcile_in_progress`; `reconcile.getRun` of a row past its budget with no `finished_at` → `error.code` `run_abandoned`, and the same through `gaps.list`; `run_not_found`; `validation_failed` for each field; `read` token on `start` → `forbidden`; `health.get` carries `last_reconcile_run`, null with the database stopped (`get-health.route.int.test.ts`) |
| 4 (CLI) | unit, fake SDK | `gaps-list.cli.test.ts`, `reconcile-start.cli.test.ts`: the `cli-tests.md` table plus [Waiting](../../.agents/skills/pp-cli/references/cli-tests.md#waiting)'s five cases (finished, finished with error, `--no-wait`, abandoned, backstop at `RUN_WAIT_BACKSTOP_MS` with `internal_error`); the run-id notice on stderr only; `has_more` notice; `health-get.cli.test.ts` for the four reconcile lines |
| 13 | unit, fake clock | `create-ingest.test.ts`: **retired secret** (the store holds `[old, new]`, `old` accepted; the store drops `old`; before the TTL `old` still accepted; after 5 min `old` → `401` and `ingest.rejected` with `reason: 'signature'`); a 6-minute-stale timestamp → `reason: 'timestamp'` with no `verify` call; a missing `svix-signature` → `signature`. The fake clock starts at wall-clock time minus the TTL, so the SDK's wall-clock window agrees ([Constraint 12](../resend.md#constraints-and-sharp-edges)) |
| 13 | unit | `emf-metrics.adapter.test.ts`: `ingest.rejected` line has `Dimensions: [['reason']]` and `reason`; every other name `[[]]`; `log-metrics.adapter.test.ts` keeps `reason` |
| D7 | unit | `asyncFunctionInvokePortContract` against both implementations; `lambda-async-function-invoke.adapter.test.ts` (`InvocationType: 'Event'`, non-`202` rejects) |
| D20–D24, D25 | unit (`Template`) | `app.stack.test.ts`: the reconciler's arm64/`nodejs24.x`/log group/no VPC (the existing all-function assertions now count it); its environment equals `reconcilerEnv`'s keys; the API's gains `RECONCILER_FUNCTION_NAME`; one `EventInvokeConfig` with `MaximumRetryAttempts: 0` and `MaximumEventAgeInSeconds: 60`; two schedules, both `HOURLY_CRON`, window off, explicit retry policy; secrets count 3 (4 with the simulator), each function's `GetSecretValue` set equal to its Secrets-layout row; the alarm (metric, statistic, period, `BREACHING`, `EvaluationWindow: { WallClockWindow: {} }`, action); alarm count ≤ the AWS-28 constant; `runbook-links.test.ts` finds `LedgerApp-reconcile-gap`; `bundle-smoke.test.ts` loads the reconciler bundle |
| D29–D32 | unit, fake steps | `run-deploy.test.ts` (D29's refusals, the write, no write when unset); `run-teardown.test.ts` (the printed revoke line); `ingest-route-throttle.test.ts` (D31); `run-gap-drill.test.ts` (D32) |
| 6, 5 (live) | the walk | E1 (RS-U01, RS-U20, RS-U02), the gap drill (Ships 9, RS-U10, RS-U13), E3 |

`pnpm verify` covers every row above but the last. It cannot see Resend's real replay semantics
(E1 settles them), List Events' real reach and lag (D38), or the deployed alarm's email (the walk).
`pnpm sim` is unchanged; its invariants keep running in every stage they ran in.

## 21. Walkthrough plan

`openspec/changes/slice-4-recovery/WALKTHROUGH.md`, in [the format](../../.agents/skills/rsa-manual-test/references/walkthrough-format.md).
**Before you start:** `pnpm install`, `pnpm dev:full` (path A), then the deployed values from
`.env.deployed.local` in the shell (paths B–F). The walk creates local runs, deployed runs, one
reviewer token (revoked in T1) and E3's test webhook (deleted in E7). Ask-first steps: B2, C4, D1,
E1–E7.

**Path A — Local: the contract without AWS. Walked as: Operator.**

1. `pnpm -s ledger gaps --json` → exit `0`; `"object": "list"`.
2. `pnpm -s ledger reconcile --dry-run --json` → exit `1`; stderr
   `ledger: reconcile run <n> started; follow it with ledger gaps.`; stdout
   `"code": "reconciler_not_configured"`.
3. `pnpm -s ledger gaps` → the run's row ends `reconciler_not_configured`.
4. `pnpm -s ledger health` → `reconcile   run <n> reconciler_not_configured`.
5. `pnpm -s ledger reconcile --lookback 31d --json` → exit `1`, `"code": "validation_failed"`,
   message naming `lookback`; `pnpm -s ledger gaps --since 2x` → exit `1`, naming `since`.
6. `pnpm -s ledger reconcile --no-wait --json` → exit `0`; a run with `"finished_at": null`.

**Path B — Deployed: configure, deploy, and see the hourly cron run. Walked as: Operator.**

1. Set `LEDGER_DEPLOY_RESEND_API_KEY` (the dedicated key) and `LEDGER_DEPLOY_RESEND_WEBHOOK_ID`.
   `pnpm aws:deploy` with only the key set → `refused: LEDGER_DEPLOY_RESEND_WEBHOOK_ID …`, exit `1`.
2. **Ask-first:** `pnpm aws:deploy` → `ledger/resend-api-key written`, `KillSwitchArmed`, `done`.
3. `pnpm -s ledger health` → a `reconcile` line.
4. After the next `:00`: `pnpm -s ledger gaps --since 2h --json` → a `"trigger": "scheduled"`
   run, `"missing": 0`, `"error": null` (the hourly cron run).
5. `aws cloudwatch describe-alarms --alarm-names LedgerApp-reconcile-gap --query 'MetricAlarms[0].StateValue'`
   → `"OK"` after the first clean hour.

**Path C — The replay chain and the read-only checks (E1, D37–D38). Walked as: Operator.**

1. `curl -s "https://api.resend.com/webhooks/$LEDGER_DEPLOY_RESEND_WEBHOOK_ID/events" -H "Authorization: Bearer $RESEND_API_KEY"`
   → a list; note one event id (never recorded).
2. `curl … /events/<event_id>` → its `data.email_id`; `pnpm -s ledger email <email_id> --json` →
   the timeline's `svix_id`s equal the List Events ids (**RS-U02**).
3. Page List Events to `has_more: false` → the oldest `created_at` is at least 72 h old
   (**RS-U03**; on or after 2026-10-21).
4. **Ask-first:** `curl -X POST … /events/<event_id>/replay` → `{ "object": "webhook_event", … }`.
5. `curl … /events/<event_id>/attempts` → the newest `http_status_code` is `200` (**RS-U20**).
6. `aws logs filter-log-events --log-group-name /ledger/LedgerApp-worker --filter-pattern '"worker.duplicates"' --start-time <ms>`
   → one line with that `svix_id`; `ledger email`'s `event_count` unchanged (**RS-U01**).
7. `curl -s -o /dev/null -w '%{http_code}' "https://api.resend.com/webhooks/$LEDGER_DEPLOY_RESEND_WEBHOOK_ID" -H "Authorization: Bearer re_<random>"`
   → `400`, body `validation_error` / `API key is invalid` (**RS-U17**).

**Path D — One real gap, closed (J3). Walked as: Operator.**

1. **Ask-first:** `pnpm aws:gap-drill` (between `:02` and `:40`) → the D32 lines, among them
   `events visible after <ms> ms` (**RS-U13**), `dry run: missing 2`,
   `reconcile: missing 2 replayed 2 failed 0`, `stored 2 of 2`, `dry run: missing 0`,
   `gaps: newest run missing 0`, `created_at unchanged by the replay: yes` (**RS-U10**), `done`.
2. `pnpm -s ledger gaps --since 1h` → the drill's three runs.
3. `pnpm -s ledger health` → `reconcile   run <n> finished …, missing 0, replayed 0`.
4. The `LedgerApp-reconcile-gap` email reaches the owner within ≈ 1 h and the alarm returns to OK
   after a clean hour (Ships 11).

**Path E — Disabled-webhook experiments (E3, D39). Walked as: Operator.** Each of E1–E7 is
**Ask-first**: create, send, disable, replay, send, enable, delete, each with its `curl` and the
observation that settles RS-U04 or RS-U05. Held → both rows close as safe in both outcomes (D39).

**Path F — The M1 review. Walked as: Reviewer.**

1. `pnpm -s ledger token create --name review-walk --scope read --json` (operate token) → a `read`
   token.
2. With `LEDGER_TOKEN` set to it: `pnpm -s ledger gaps --since 24h` → exit `0`.
3. `pnpm -s ledger reconcile --dry-run --json` → exit `1`, `"code": "forbidden"`; no new run in
   `ledger gaps`.
4. `node scripts/check-links.mjs` → 0 broken links; every reliability claim in `README.md` opens
   its evidence (desk check of D36's list).

**Teardown:** T1 `pnpm -s ledger token revoke <id>` for `review-walk`.

**What this walk cannot reach today:**

| Not reachable | Carried by |
| --- | --- |
| MCP `list_gaps` and `reconcile` | [slice 5](../build-checklist.md#5--mcp-server-and-contract-hardening) |
| RS-U03 re-measured past 30 days | [slice 7](../build-checklist.md#7--polish-and-retention) |
| A live local reconcile | [Deferred](../architecture.md#deferred-yagni) tripwire (§3) |

Personas: Operator (A–E) and Reviewer (F). The support engineer and the application developer
reach no surface this slice adds. The AI agent reaches it in slice 5.

## 22. Docs to update

At apply time, in this order:

**First task (scope, before any build):**

- [build-checklist.md → 4](../build-checklist.md#4--recovery):
  - Add Ships 11 (§2, owner-ruled).
  - Correct Ships 9's two counts (C3, C4).
  - Add `pnpm aws:gap-drill` and the alarm email to UI surfaces.
  - The Ops line gains "create a dedicated `full_access` key; set `LEDGER_DEPLOY_RESEND_API_KEY` and
    `LEDGER_DEPLOY_RESEND_WEBHOOK_ID`; approve the gap drill".
- [api-contract.md](../api-contract.md):
  - The registry row `reconciler_not_configured` (D1), and `internal_error`'s Raised-by cell.
  - The two variables in Conventions → Public environment variables.
  - `reconcile.start` In/Out: the anchor is "the newest finished run with no `error_code` and
    nothing missing", and it extends an explicit `lookback` too (D3, D4).
  - `reconcile.start` Kind: "`dry_run` reports missing ids" becomes "`dry_run` reports the
    missing count" (C20).
  - `reconcile.start` Errors: the outcome list gains `reconciler_not_configured` and
    `internal_error` (D1's stored set).
  - `health.get`'s Kind names `last_reconcile_run`.
- `.env.example` (§18).

**With the code:**

- [architecture.md](../architecture.md):
  - ADR-007, amended with this pre-proposal cited: the anchor (C1), the claim's `finished_at IS
    NULL` (C11), the time-budget stop as `rate_limited` (C2), horizons fixed at start (C14, C18),
    `maxEventAge` (C15), and its Evidence and Conditional settled by D37.
  - ADR-009: the rotation order (C5), and its Evidence (the retired-secret test).
  - ADR-012 Evidence.
  - Reliability core, No-loss evidence.
  - The Risks rows "Webhook auto-disabled" (the alarm and RS-11's email, C6) and "Replays fail
    verification" (settled).
  - Technology's metrics row: `ingest.rejected{reason}` emitted.
  - Deferred: the live-local-reconcile row (§3).
  - Open questions owed by slice: row 4 updated.
- [data-modeling.md](../data-modeling.md):
  - Model index: `reconcile_runs` → `Modeled` `[x]`.
  - The `reconcile_runs` entry: columns, the checks, the start, the claim, the anchor, the horizon
    wording (C14), `_Schema:_` path, evidence.
  - Base fields: one line each for C7 and C8.
  - Idempotency keys: a `reconcile_runs` row (the start lock and the guarded claim).
  - Log fields: `reason` (C17).
  - The `outbox` entry's operational-alerts sentence names `LedgerApp-reconcile-gap` (C6).
  - The `webhook_events` evidence: "Slice 4: replays dedupe on `svix_id` (RS-U01)" with E1.
- [resend.md](../resend.md):
  - RS-44 and RS-45 (D37).
  - The rows RS-U01, RS-U02, RS-U03, RS-U04, RS-U05, RS-U06, RS-U09, RS-U10, RS-U13, RS-U17, RS-U20
    with their results.
  - Verdict's "three unverified links" bullet updated.
  - Onboarding reality's webhook row (C13).
  - Constraint 9 resolved by RS-45.
- [aws.md](../aws.md):
  - AWS-63 (`EventInvokeConfig`: `maxEventAge` 60 s–6 h, `retryAttempts` 0–2, aws-cdk-lib 2.273.0 docs).
  - AWS-64 (CloudWatch alarm evaluation: a sliding window ignores the missing-data treatment while
    enough real datapoints sit in its evaluation range; a wall clock window reads exactly the most
    recently completed aligned period, 1 h supported; `CfnAlarm.evaluationWindow` only in
    aws-cdk-lib 2.273.0), with its two Sources rows, read 2026-10-19 (C21).
  - AWS-28's count "Six deploy, 6 of 10 free".
  - Cost shape: the reconciler lines and the secret count.
  - Teardown's leftovers table: a "Resend API key (reconciler's)" row (D30).
- [integrations.md](../integrations.md):
  - Rule 2: the bound restated with the gap drill (C16).
  - Rule 2's evidence: the limiter tests.
  - PG-U03's row (D40).
  - Cadence: the reconciler is the first hourly waker on the shared expression, with two schedules.
- [about.md](../about.md):
  - Open questions: the RS bullets per their results.
  - A Resolved entry for the `resend` SDK's `logError` (C9).
  - What must demonstrate: the "Idempotency, retries, rate limits" row gets the limiter tests and the
    recovery suite.
  - Success metrics: the recovery row links the fake-API test.
- [features.md](../features.md):
  - recover and rotate secret stances: evidence linked.
  - J3 and J5: evidence, and J5's order (C5).
  - Recovery section: links.
- [check-before-launch.md](../check-before-launch.md):
  - CBL-17's check reads `last_reconcile_run` too.
  - The "Owned elsewhere" slice 4 line, once the README and RS-U01 have landed.
- Root [AGENTS.md](../../AGENTS.md):
  - Projects: the scaffold note says `packages/reconciler`, `packages/resend-client` and
    `apps/reconciler` now hold their logic.
  - Commands: `pnpm aws:gap-drill`, `pnpm -s ledger gaps`, `pnpm -s ledger reconcile`, and the
    deploy's two new variables.
- Skills (fact updates, none loosening a rule):
  - pp-backend: the ports table gets the async invoke row; `resend-client.md` gets D9–D12's settled
    choices, the C12 log fields, and C22's "on the first invocation through one memoized promise"
    in place of "at module scope"; `reactions-and-recovery.md` drops "the slice 4 pre-proposal's"
    and states D6, D15, D18 and D25.
  - pp-cli: `RUN_POLL_INTERVAL_MS = 3_000`, the 20-minute backstop and its output.
  - pp-infra:
    - the env-and-inputs table rows for `reconcilerEnv` and `apiEnv`;
    - deploy inputs `ledger:resendWebhookId`;
    - physical names `LedgerApp-reconciler`, `LedgerApp-reconcile-hourly`, `LedgerApp-reconcile-gap`;
    - the reconciler's invoke-config wiring row with `MaximumEventAgeInSeconds: 60`;
    - scripts.md's gap-script section pointing at D32.
  - pp-testing: the fake Resend API as built, and the retired-secret clock note.
  - pp-general: `reason` in the allow-list and the `MetricsPort` signature.
  - rsa-manual-test `environment.md`: the new variables, commands and log group.
- `docs/runbook.md` (D35) and `README.md` (D36).
- The card's `Status` and `Ships` boxes, at close.

## 23. OpenSpec mapping

- **Change:** `slice-4-recovery`, at `openspec/changes/slice-4-recovery/`, with `WALKTHROUGH.md`
  (§21).
- **Spec deltas:**

| Capability path | Delta | Requirements |
| --- | --- | --- |
| `reconciler` | **ADDED** | Runs start under one lock and never overlap (§14.7); a run is claimed before any Resend call (8); webhook status first (1); grace window (2); anchored lookback (3); replays through ingest only (4); full recovery past the retry schedule (6); a failed replay never aborts (9); registered outcomes, `run_abandoned` derived (10); dry run (14); hourly schedule and the async invoke's retry and age bounds; the gap alarm (Ships 11) |
| `resend-client` | **ADDED** | The limiter (11); status-then-name mapping with the default branch; bounded `5xx` retries; no response body, key or signing secret in any output (12); `User-Agent` and `Idempotency-Key` on every request that needs them |
| `read-api` | **MODIFIED** | Adds `gaps.list`, `reconcile.getRun`, `reconcile.start` and their errors; "health.get reports the pipeline" gains the last run; "Health answers during a database outage" keeps one database attempt with the last run nulled |
| `sdk` | **MODIFIED** | Adds the three methods; `reconcile.start` is never retried |
| `cli` | **MODIFIED** | Adds `ledger gaps`, `ledger reconcile` with its wait and backstop; `ledger health`'s reconcile line |
| `webhook-ingest` | **MODIFIED** | Adds "Rejections are counted by reason" (13); "The secret set refreshes within 5 minutes" gains the retired-secret scenario |
| `aws-stacks` | **MODIFIED** | Adds the reconciler function, its secret, its environment, its invoke config, its schedule, its IAM and the gap alarm; "Each function's environment is exactly its names" and "Secrets least privilege" grow the reconciler; "Operational alarms email through the alert topic" grows the sixth |
| `deploy-and-teardown` | **MODIFIED** | "Deploy inputs are asserted first" gains D29's refusals; adds "Deploy writes the reconciler's key"; "Teardown order and the post-destroy listing" gains the revoke line; adds "The gap drill" (D31, D32) |
| `operations-runbook` | **MODIFIED** | "Every alarm has a runbook entry" and "Every runbook-linked error code has a runbook entry" cover the new alarm and code; adds "The rotation procedure" |
| `local-stack` | **MODIFIED** | Adds "Local reconcile runs end not configured" (D23) |

- **Task groups**, each verifiable alone, in order:
  1. Docs first: the card edits, api-contract and `.env.example` (approved items 3–4).
  2. `packages/core`: constants, `parseDuration`, `reconcileHorizon`, `runOutcome`, events, the code
     and the closed sets, with unit and property tests.
  3. `packages/db`: schema, the two migrations, the repository, `presentSvixIds`, integration tests
     (approved item 2).
  4. `packages/shared`: the async invoke port, the in-process adapter, the contract suite, the fake;
     the `MetricsPort` dimension, both adapters, `reason` in the allow-list.
  5. `packages/resend-client`: the dependency (approved item 1), client, limiter, mapping, console
     silence, the fake API and fake client, tests.
  6. `packages/reconciler`: factory, starts, claim, run, finish; the recovery integration suite.
  7. `packages/ingest`: `ingest.rejected{reason}` and the retired-secret test.
  8. `packages/api` routes, readers, command, mapper and health; the contract suite;
     `pnpm openapi:export`; `packages/sdk`; `apps/cli` commands and tests.
  9. `packages/aws`: the Lambda async adapter and the ingest-route throttle. Then
     `apps/reconciler`, `apps/api` and `apps/local` wiring, and `infra` stack, outputs and template
     tests (approved item 5).
  10. Deploy and teardown changes; `gap-drill.ts` and its root script; tests.
  11. `docs/runbook.md`, `README.md`, every §22 doc and skill update.
  12. `pnpm verify` (the gate). Then the Ask-first walk: B2 deploy, C, D, E (items 6–7, per action).

## 24. Risks

| Risk | Likelihood | Cost | Cheapest early catch |
| --- | --- | --- | --- |
| RS-U01 false: a replay lands under a new `svix-id`, so every gap replays forever and effects duplicate | Low (community-observed; replay returns the event's own id, RS-16) | Recovery design blocked | E1 before `opsx:apply` (D37) |
| RS-U20 false: replays carry the original `svix-timestamp` and fail the 5-minute window | Low (`[Svix]` signs per attempt) | Recovery cannot work | E1 step 5 |
| The gap drill's throttle stays at `0` after a crash | Low | Ingest blocked; Resend retries for ≈ 27.6 h, then the events are only recoverable by reconcile (which the throttle also blocks) | The gap alarm fires at the next hourly run; its runbook entry names `pnpm aws:rearm`; the drill refuses to start over an existing route setting (D31) |
| The SDK's `logError` is renamed on a bump and starts printing | Low | A Resend body in a log | The console-silence unit test (D9) |
| The anchor never advances (a persistently missing event) and each hourly run pages 30 days | Low | Up to 14 min of 2 req/s per hour from the team's budget | The gap alarm stays in `ALARM`; `ledger gaps` shows the same `missing` each hour; the limiter yields on low `remaining` |
| RS-U03: List Events reaches less than 72 h | Low | The default lookback overstates recoverable range | D38's read; the runbook and README state the measured reach |
| A tripped stack queues hourly invokes that run back to back on re-arm | Removed by C15 | — | The invoke-config `Template` assertion |
| A deploy without the new variables on the owner's stack | Medium (the next redeploy) | Refused, by design (D29) | The deploy's refusal names the variable |
| The alarm emails at expected times (first deploy, gap drill, trips) and is ignored | Medium | Alert fatigue | The runbook entry lists the expected firings; one email per incident, no OK action |
| The gap alarm stays `OK` while the reconciler is silent (a sliding window evaluates the last real datapoint) | Removed by C21 | A missed-recovery signal | The `EvaluationWindow` `Template` assertion; walk B5 and D4 |

## 25. Owner ops still open

1. **Create a dedicated `full_access` Resend API key** for the reconciler (dashboard or
   `POST /api-keys`, Ask-first write), and put it and the production webhook id in
   `LEDGER_DEPLOY_RESEND_API_KEY` and `LEDGER_DEPLOY_RESEND_WEBHOOK_ID` (shell or
   `.env.deployed.local`, never committed).
2. **Run E1 before `opsx:apply`** (recommended, D37): one Ask-first replay of a stored event plus
   five reads. It settles RS-U01, RS-U02 and RS-U20 before any code depends on them.
3. **On or after 2026-10-21:** the RS-U03 reach read (D38).
4. **Approve, per action at walk time:** the redeploy (B2), the gap drill (D1), and E3 (E1–E7, or
   hold them for safe-either-way).
5. **Walk the M1 demo** against the kept deploy (paths D and F).
6. **At any future teardown:** revoke the reconciler's key at Resend (D30).
