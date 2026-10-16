# Docs verification run 2026-10-15 — decisions log

Procedure: [.ai/commands/verify-docs.md](../../commands/verify-docs.md). Historical record, not
binding: every outcome below lives in the docs it changed.

**Run shape.** Six review passes (consistency, Resend facts, AWS and cost, architecture via the
`architecture-designer` skill, security and PII, contract and plan) produced 131 raw findings. Two
verifiers merged duplicates, tried to disprove each finding against the docs and the cited pages,
and rejected 10 finding parts. 96 items survived: 63 settled (A: low stakes, B: settled by a quoted
ratified sentence or the decision lens) and 33 owner decisions (C).

## Owner decisions (C)

**Outcome (2026-10-15):** the owner accepted the recommended option for all 33. They are applied,
and the amended ADRs carry an `amended 2026-10-15` marker naming the items: ADR-004, 006, 007, 012,
016, 017, 018. The lens rename (V2-19) re-scored the suite at 21/21. Design-doc approval is not a
deploy approval: the new alarms, the runtime role and the gap script's live send stay Ask-first
when a slice builds them.

Each row: the question, the recommended option, and why. Full cards, with the alternatives and the
exact edits each option implies, are in the run's local `stages/verified-v1.md` and
`stages/verified-v2.md`.

### High

| ID | Question | Recommended | Why |
| --- | --- | --- | --- |
| V1-01 | `health.get` MUST answer during a DB outage, but bearer auth reads Postgres. How? | Self-verifying tokens `ldg_<random>_<tag>` (HMAC keyed by a deployer-held key in the existing DB secret). Bad tag → `401` before any connection; during an outage only `health.get` accepts a tagged token, other routes `503 database_unavailable` | A token cache fails on the cold container an operator hits after an alarm. Fails closed; gives gitleaks a matchable prefix. Public contract change |
| V1-02 | After a trip, outage or Neon quota suspension longer than 3 days, the 72 h lookback never sees the oldest failures | Default lookback extends back to the last good run's `horizon_end`, capped at 30 days and List Events reach | Lost events (lens clause 6); removes a manual `--lookback` judgement (self-service test). Amends ADR-007 |
| V1-03 | After an outage, events acknowledged but still queued are counted missing and replayed | Grace window = max(10 min, source queue's oldest-message age); one free `GetQueueAttributes` per run | Burns the shared Resend budget and writes a false loss signal. Amends ADR-007 |
| V1-04 | "One limiter" is per process; N concurrent dispatchers send N × 2 req/s and hold connections outside the worker bound | Single-flight dispatcher: `pg_try_advisory_xact_lock` on a fixed key, losers exit, holder claims ≤ 10 rows `SKIP LOCKED` | Never burn the shared 10 req/s budget, at USD 0. Amends ADR-012, ADR-017 |
| V1-05 | Invariant 3 is measured where at-least-once dispatch makes it false, and nothing crashes the dispatcher mid-send | Count effects at the receivers; add `--chaos dispatcher-crash`; ADR-006 states callbacks are at-least-once with a stable id | Evidence that cannot catch the claim's violation is no evidence |
| V1-06 | Budget data lags ≥ a day; at the burst-capable throttle the overshoot is several times the USD 50 "hard" cap | Usage trip: one CloudWatch alarm on the HTTP API `Count` (15 min) to the trip topic, plus a low steady throttle the burst script raises for its run | Budget-alarm gap (lens clause 6), USD 0 idle, one of the free alarms. New AWS resource |
| V1-07 | ACTUAL budget alerts fire once per month, so a same-month re-arm leaves nothing that can trip | V1-06's usage trip is the re-armable trigger; the re-arm warns when spend ≥ cap | Same free alarm closes it. Depends on V1-06 |
| V1-08 | Simulated events would cause real alert sends through Resend | Reactions caused by `source = simulated` go only to the simulator's receiver sink | Live Resend writes nobody requested are never tolerable |

### Medium

| ID | Question | Recommended | Why |
| --- | --- | --- | --- |
| V1-13 | A failed kill-switch run is discarded after 3 async attempts, silently | Alarm on the kill switch's `Errors` > 0; idempotent steps; forced failure in the trip drill | Budget-alarm gap, USD 0. New alarm |
| V1-22 | "No PII in logs" has no evidence | Slice 1 unit test on a shared logger allow-list (never an error's `message` / `detail`) | PII exposure (clause 6); adds a slice 1 Ships bullet |
| V1-23 | No invariant checks `email_recipients` / `recipient_state` | Invariant 2 covers all three projection tables | Order-dependent state on the most lock-sensitive writes, near-zero cost |
| V1-24 | Redeploys may re-enable an out-of-band disabled ESM and drain the held queue into the DLQ | Kill switch disables the ESM before concurrency 0; deploy refuses while tripped and restores a pause; new AWS-U09 settled by the trip drill | Lost events via DLQ drain, the risk ADR-015 exists to remove |
| V1-25 | Nothing stops a reaction rule firing on an intermediate state some orders skip | Rules fire only on predicates that, once true, stay true; a rebuild writes no outbox rows; permutation property in slice 6 | Order-dependent effects, one sentence in ADR-006 |
| V1-26 | Undefined: a verified event whose payload fails its type's schema | Store raw (typed columns null), skip projections, count; only code errors reach the DLQ | A Resend schema change could otherwise dead-letter, then lose, a whole event type |
| V1-27 | Which recipient states are sticky? | `hard_bounced`, `complained`, `suppressed` sticky; `soft_bouncing` clears on a later `delivered` (deterministic by fold order) | All-monotone keeps recovered addresses suppressed forever. Domain semantics adopters act on |
| V1-28 | No path rebuilds projections after a logic or column change | Temporal Deferred row; tripwire: the first post-slice-1 change that alters projection output or adds a column | Lens clause 2 (countable tripwire) |
| V1-29 | A dead outbox entry is invisible | `health.get` gains outbox pending/dead counts and oldest age (slice 6) plus one alarm | Self-service test. Additive contract change |
| V1-30 | Slice 4 (M1 boundary) rests on RS-U01 with no early signal | Slice 2 MAY run the replay experiment early (Ask-first); slice 4 still owes it | Information two slices earlier for one call |
| V1-31 | No runtime DB role: Lambdas would run as the Neon owner | Deploy command creates a DML-only role; `webhook_events` never grants `DELETE` | Turns the immutability MUST into a tested property, USD 0 |
| V1-32 | Local mode must enforce auth but cannot issue a first token; compose publishes on all interfaces | Local setup command issues it through the deploy command's code path; publish on `127.0.0.1` | Self-service test |
| V1-33 | Slice 2B may start after 2, but needs slice 3's DLQ operations and poison run | 2B depends on 3 | Every finished slice hand-walkable (clause 3). Build-order change |
| V1-34 | The recovery walk and M1 demo need a real gap, made by hand each time | Owner-only gap script (throttle to stop, one Ask-first send, restore, reconcile) | A manual per-demo step MUST be scripted (clause 1) |
| V1-35 | A burst to one address serializes on one recipient lock and measures a shape no broadcast has | Burst spreads recipients over `+label` test addresses; ceiling names "emails per recipient" | A published number a reviewer can trust, zero cost |
| V1-36 | Throttle and kill-switch responses carry no error shape | SDK maps them to a client-side code `api_unavailable` | Makes CBL-17 mechanical. New error code |
| V1-37 | A fresh-DB migration run cannot catch a non-expand/contract migration | `pnpm verify` lint for `DROP` / `RENAME` / `ALTER … TYPE` / `SET NOT NULL` unless marked contract | Evidence that can fail. CI-mirrored gate |
| V2-03 | The reconciler needs the Resend webhook id; no doc says where it comes from | A deploy input (never tracked), passed to the reconciler only | No extra call per run; never reads other webhooks' secrets |

### Low

| ID | Question | Recommended | Why |
| --- | --- | --- | --- |
| V1-51 | Losing the only `operate` token forces SQL | Deploy command flag `--issue-operate-token <name>` | Self-service test, one flag |
| V1-52 | MCP output may quote sender-controlled free text (`failed.reason`, `tags`) | Tool output holds ids, timestamps, closed-set values and masks only; injection fixture in slice 5 | MCP tool-output exposure (clause 6) |
| V1-55 | CI hardening unstated for a public repo that later publishes to npm | State it in slice 0 and slice 8 bullets (`pull_request` only, read-only token, SHA-pinned actions, frozen lockfile, trusted publishing) | Security exposure at no cost. CI change |
| V1-58 | Local simulated events would be stamped `live` | Optional `LEDGER_SIMULATOR_SECRET` in `.env.local`, as on AWS | Keeps `source` true in every mode. New env var |
| V2-07 | `400 validation_error` maps to no run outcome | Match message `API key is invalid` → `resend_auth_failed`; other `400`s → default branch | Honest hint for a revoked key |
| V2-08 | `ingest.rejected{reason}` is defined only in the frozen RFC and emitted by no card | Define the EMF set in architecture.md; slice 4's rotation bullet emits and tests it | The runbook step becomes checkable |
| V2-19 | The lens's *Apply when* line still says "scoping a phase", and case 16's Verdict says "each phase ships" | Rename both to "slice" and re-score the suite | Canonical vocabulary; mechanical check. The suite forbids editing a Verdict without the owner, so the fixer held case 16 back |

## Settled fixes (A and B)

Applied 2026-10-15 by three fixers on disjoint files: 140 edits, all applied or adapted (re-wrapped
or renumbered). One edit is held for V2-19: case 16's Verdict column ("each phase ships"), which the
suite forbids editing without the owner. New fact rows: RS-35, RS-U22, AWS-51, AWS-52 (AWS-53 is
reserved for V1-13).

| ID | Bucket | Fix |
| --- | --- | --- |
| V1-09 | B | Evidence that data-modeling.md, ADR-010 and aws.md assign to a slice is missing from that slice's Ships |
| V1-10 | B | The retention job's field list covers email events only, so PII in stored-raw non-email events and in `tags` is kept forever |
| V1-11 | B | `api_tokens.token_hash` UNIQUE cannot stop a re-run deploy command from minting a second first token |
| V1-12 | B | "Runs never overlap" names no mechanism, and the obvious row-lock form does not work |
| V1-14 | B | The budget includes credits by default, so alerts stay silent while credits absorb a runaway |
| V1-15 | B | An AWS Free-plan account is suspended at 6 months at the latest, which ends a kept deploy |
| V1-16 | B | The guardrails stack must not import from the app stack, or a failed first deploy and an app-only destroy break "never a budget-alarm gap" |
| V1-17 | B | AWS-U05 "safe either way" is false for the burst on a reduced account quota |
| V1-18 | B | Cached secrets give a retired, possibly leaked, signing secret an unbounded verification window |
| V1-19 | B | A `.gitleaks.toml` with custom rules replaces the default ruleset unless it extends it |
| V1-20 | B | AWS-10 puts the reconciler and dispatcher on separate `rate()` schedules, against the one-wake cadence rule |
| V1-21 | B | The address-hash key-rotation deferral says a leaked key "exposes no raw data", contradicting the doc's own anti-pattern |
| V1-38 | A | Recompute correctness depends on the isolation level and on reading inputs after the locks, and the docs say neither |
| V1-39 | B | AWS-03 says a long reconcile run "resumes by cursor", and the recovery-time figure ignores the per-run budget |
| V1-40 | A | "Operational alert" names two disjoint mechanisms, and "threshold alert emails" contradicts per-event reactions |
| V1-41 | B | ADR-001's ingest envelope omits `source`, which only ingest can know |
| V1-42 | B | data-modeling.md states as settled that a replay carries the original `svix-id`, and RS-06 / RS-U01 / RS-U20 omit evidence both ways |
| V1-43 | B | "The queue holds them up to 14 days" and "the DLQ keeps 14 days" both misstate SQS retention |
| V1-44 | A | The idle estimate "under USD 2/month" is beaten by the owner's own measured deployment |
| V1-45 | A | AWS-34 cites only "at least once per day"; AWS also documents an 8–12 h update cadence, billing lag and once-per-period ACTUAL alerts |
| V1-46 | A | Neon Free's 5 GB public-network-transfer quota also suspends the compute, and no doc lists or measures it |
| V1-47 | A | "Claimed inside one transaction" would make a poison row in the local queue retry forever |
| V1-48 | A | An alert's body must be a pure function of its outbox row, or a retry gets `409` and the alert dies |
| V1-49 | A | A simulated event could take a real event's `svix_id` and dedupe the real one away |
| V1-50 | A | "Whoever holds only a database dump cannot confirm a guessed address" is false before redaction |
| V1-53 | A | "Local crypto" invites a hand-rolled signature check |
| V1-54 | A | features.md says the signing secret "never" goes in an env file, while slice 1 puts it in `.env.local` |
| V1-56 | A | The `last_operate_token` guard is a read-then-write race |
| V1-57 | B | "Queue-age alarm fires within the hour" has no evidence; the link check proves only that alarms are documented |
| V2-01 | B | Resend documents bounce types `Permanent` / `Transient` / `Undetermined`; resend.md knew only `Permanent` / `Temporary` |
| V2-02 | B | `resend webhooks listen` forwards deliveries signed with a temporary webhook's secret that the design never obtains |
| V2-04 | B | resend.md named two unverified links in the recovery chain; ADR-007 names three |
| V2-05 | B | diff-review folds by `created_at`, which data-modeling defines as row insertion time |
| V2-06 | B | The README said missed events "are lost and nothing tells you"; Resend notifies on auto-disable and keeps recent events replayable |
| V2-09 | B | The README called the MCP server read-only and the Ingester open-source |
| V2-10 | B | features.md said the deploy is "One stack"; ADR-010 deploys an app stack and a guardrails stack |
| V2-11 | B | Skills said the SDK is hand-written with no generated part; ADR-011 says generated types plus a thin client |
| V2-12 | B | The `webhook_disabled` hint sent the operator to the dashboard, against "recovery … with no dashboard step" |
| V2-13 | B | No M3 card carried the milestone-boundary bullet the lens requires |
| V2-14 | B | Where the `resend` SDK may be imported was stated two ways |
| V2-15 | B | Skill wording drift: "integrator" (a vocabulary Never), a nonexistent "one-launch rule", a wrong example slice |
| V2-16 | B | Root Permissions' public-contract list omitted environment variables and additive changes |
| V2-17 | B | ADR-008 called DLQ inspection an `operate` action; api-contract makes it `read` |
| V2-18 | B | The PG-U03 bullet implied a 30-idle-day measurement, which would hold the M1 boundary for a month |
| V2-20 | A | RS-22 listed `validation_error` at 422; the errors page has no such entry |
| V2-21 | A | data-modeling.md cited RS-30 for `email.received` having no `email_id`; the payload carries `data.email_id` |
| V2-22 | A | `reconcile.start`'s 30-day `lookback` cap cited email-data retention as if it were List Events reach |
| V2-23 | A | RS-07 omitted Resend's own advice to sort on the payload `created_at`, which backs ADR-003 |
| V2-24 | A | Case 13's replay fact and the Replay / Retrieve Event paths were not recorded in resend.md |
| V2-25 | A | RS-05 says List Webhooks returns the signing secret; that endpoint's example shows none |
| V2-26 | A | RS-18 predated Resend's OAuth scopes; the "no read-only key" verdict still holds |
| V2-27 | A | RS-U04 omitted that Ingester PR #13 asserts disabled endpoints get no replays |
| V2-28 | A | The api-contract Coverage row for tokens cited a section that is only about Neon |
| V2-29 | A | Evidence pointers aimed at idea.md instead of the ratified slice or invariant list |
| V2-30 | A | The retry window was tagged `[Unverified]` in features.md and the suite but listed as Resolved in about.md |
| V2-31 | A | "SDK retries for idempotent reads" was attributed to ADR-011, which does not say it |
| V2-32 | A | CBL-03 said slice 3 covers the first SNS email confirmation, but slice 2's guardrails stack already emails through SNS |
| V2-33 | A | data-modeling.md said surrogate ids are never public; the contract exposes `run_id` and `token_id` |
| V2-34 | A | The `email.get` and `recipient.get` Slices lines omitted slice 2, which broke the Slices-grep reverse index |
| V2-35 | A | The operation template's SDK pattern did not match the pluralized namespaces the entries use |
| V2-36 | A | features.md had no capability for local mode (slice 2B) |
| V2-37 | A | The registry said `docs` links `docs/runbook.md#<code>`, a repo-relative path no API consumer can open |
| V2-38 | A | "phase" and bootstrap-step references survived the phase→slice rename (outside the lens) |

## Rejected

| Finding | Why |
| --- | --- |
| P5-01 (bearer strings wake Neon) | Needs a leaked read URL, which stays unpublished; its consequence is an existing risk row, now also covered by V1-02 |
| P5-10 (redrive grants widen the read API) | The read API already holds DB write access; V1-31 is what shrinks the blast radius |
| P5-11 (callback signing secret has no home) | Slice 6 carries it (lens clause 3) |
| P4-11, ceiling line | Reached horizon is already recorded per run; beyond the ceiling (clause 1) |
| P3-04, status check on re-arm | Every run already reads webhook `status` first |
| P4-01, forced dry run while the DLQ is non-empty | One poison message would block recovery (no loss > cost) |
| P4-03, "README example fires in one order only" | True only for a non-monotone state no doc defines; survives as V1-25 |
| P6-03, "no doc names the alert rule" | Slice 6 carries it; survives as V1-08 and V1-40 |
| P6-08, "retry storms" | SDK retries are bounded with backoff; survives as V1-36 |
| P4-23, `msg_sim_` prefix rule | Polish (clause 5); narrowed guard is V1-49 |
