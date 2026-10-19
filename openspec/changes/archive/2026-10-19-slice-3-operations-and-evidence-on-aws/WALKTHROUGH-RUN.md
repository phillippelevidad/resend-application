# Slice 3 — walkthrough run

- **Run:** 2026-10-19 19:05 UTC · walkthrough mode · change `slice-3-operations-and-evidence-on-aws`
- **HEAD:** `64fb99b` (clean) · **Environment:** deployed (kept stack, us-east-2) + local
- **Started by this run:** `pnpm dev:full` (apps/local, compose Postgres) · **Adopted:** none
- **Time box:** 4 h (owner, this conversation) · **Wall clock used:** 95 min (19:05–20:40 UTC)
- **Re-walk:** 2026-10-19 21:10–21:46 UTC at `b3c57c5` (clean), deployed, after the fixes for F1 (`4ba66f0`), F3 (`d9f90ff`) and F2 (`b3c57c5`): A2, then E1 and E3–E7 (owner's yes in this conversation). The other rows stand from the first run.

**Verdict:** walked — every path reached its outcome; the re-walk's A2 and E4 pass, so the first run's two failures are fixed.

| pass | doc-drift | fail | inconclusive | blocked | held | n/a-today | skipped | not-run |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 40 | 0 | 0 | 0 | 0 | 0 | 1 | 0 | 0 |

| Step | Status | Observed | Finding |
| --- | --- | --- | --- |
| S1–S5 | pass | install ok; Docker `28.0.4`; `git status` empty; names only from both env files | |
| A1 | pass | `sts exit=0`; `LEDGER_SIMULATOR=on` | |
| A2 | pass | re-walk, as the step now reads (only `.env.deployed.local`'s `LEDGER_ADDRESS_HASH_KEY` in the shell): the 12 expected lines, simulator `unchanged`, `KillSwitchArmed true`, `simulator on`, `done`, exit 0 (21:10–21:12 UTC; first try at 21:08 failed on an expired SSO login, K6). First run, as then written (`.env.local` only): `synthesizing`, `migrating`, then `aws:deploy: refused: LEDGER_ADDRESS_HASH_KEY's key_id differs from the stored address hashes' key_id; …`, exit 1, nothing deployed. Retried once with `LEDGER_ADDRESS_HASH_KEY` from `.env.deployed.local` in the shell: the 12 expected lines (simulator `unchanged`), `KillSwitchArmed true`, `simulator on`, `done`, exit 0; printed api url = `.env.deployed.local`'s `LEDGER_URL` | F1 |
| A3 | pass | exactly the five alarm names | |
| B1 | pass | the description verbatim, runbook `#ledgerapp-dlq-depth` | |
| B2 | pass | five lines, each description as expected, `. Runbook: …#<name lowercase>`; no ARN, account id or address | |
| B3 | pass | five `### Ledger…` headings at lines 17, 42, 67, 87, 106 | |
| C1 | pass | `1000` | |
| C2 | pass | seed `2604380573` ns `19c73e81`; `preflight concurrency=1000 recent_requests=2 usage_trip_threshold=15000`; `throttle raised rate=1200 burst=2400`; `sent requests=10000 accepted=10000 duration_s=16.5 p50_ms=617 p99_ms=4179`; `throttle restored rate=100 burst=200`; `settled stored=10000/10000 after 83s`; `storage before=33890304 after=46252032 bytes_per_event=1236 bursts_left=77`; invariants 1, 2, 4 pass, 3 not checked; exit 0 (19:14–19:28 UTC) | |
| C3 | pass | the four lines exactly, `database    reachable, 46.2 MB of 1.0 GB`, exit 0 | |
| C4 | pass | `LedgerApp-queue-age OK`, `LedgerApp-usage-trip OK` | |
| D1 | pass | `LedgerApp-queue-age` `OK`; C3's four lines, `worker      enabled`, exit 0 (read as C3/C4, 19:28 UTC, just before D2) | |
| D2 | pass | seed `2276865197` ns `68e2e615`; `history emails=7 events=18`; `chaos db-outage: database repointed, …`; `sent requests=18 accepted=18 first_attempt_200=18` (19:29 UTC); `worker paused after 10s`; `queue-age alarm ALARM after 20m; dlq depth 0`; `… database restored, …`; `resume: …`; `worker enabled after 1m`; `settled stored=18/18 after 1s`; invariants 1, 2, 4 pass, 3 not checked; exit 0; no raw address | |
| D3 | pass | 19:29:21 UTC, after `worker paused after 10s`: `queue 0 visible, 18 in flight, oldest 0s`; `dlq 0 visible, 0 in flight`; `worker paused`; `database unreachable`; exit 0 | |
| D4 | pass | 19:48:55 UTC, right after `resume:`: `worker      changing (resumed)`, exit 0; D2 then printed `worker enabled after 1m` (manual resume, not the hourly one) | |
| D5 | pass | alarm history `2026-10-19T19:48:34Z Alarm updated from OK to ALARM`, 19 min after D2's send; the owner received the email: `CloudWatch Alarm "LedgerApp-queue-age" in the US East (Ohio) region has entered the ALARM state, because "Threshold Crossed: 1 datapoint [964.0 (19/10/26 19:42:00)] was greater than the threshold (900.0)." at "Monday 19 October, 2026 19:48:34 UTC"` (owner, this conversation) | |
| D6 | pass | first read (≈19:49:15) `queue 18 visible, 0 in flight, oldest 1094s` with 18/18 already stored, SQS approximate-count lag (AWS-62); next read 19:49:43 the four lines exactly, exit 0 | |
| E1 | pass | re-walk ns `79efe3a7`: `poison count=1 svix_ids=simpoison_79efe3a7_0 email_ids=79efe3a7-email-0`; `sent requests=30 accepted=30` (21:13 UTC); `others stored 29/29 exactly once (1 poisoned wait in the DLQ)`; `invariant 4 pass (dlq holds exactly the 1 poisoned)`; exit 0 (21:45:17 UTC); its own queue-age email reached the owner (ALARM 21:30:34 UTC, 922 s), as E2 predicts. First run: first attempt aborted by K5 (`sim: the poison run failed (TimeoutError)`, exit 1; F2), its event later committed once, queue and DLQ 0. Retry, seed ns `ccc7de44`: `poison count=1 svix_ids=simpoison_ccc7de44_0 email_ids=ccc7de44-observed-bounced`; `sent requests=35 accepted=35` (20:06 UTC); `others stored 34/34 exactly once (1 poisoned wait in the DLQ)`; invariants 1, 2 not checked; `invariant 4 pass (dlq holds exactly the 1 poisoned)`; `poison fixed; …`; exit 0 (20:36 UTC) | F2 |
| E2 | pass | alarm history `2026-10-19T20:39:12Z Alarm updated from OK to ALARM`, ≈ 3 min after the move to the DLQ (period 300 s, `Maximum`); the owner received the email: `CloudWatch Alarm "LedgerApp-dlq-depth" in the US East (Ohio) region has entered the ALARM state, because "Threshold Crossed: 1 datapoint [1.0 (19/10/26 20:33:00)] was greater than the threshold (0.0)." at "Monday 19 October, 2026 20:39:12 UTC"` (owner, this conversation; the body's description is B1's, read from the alarm, not quoted by the owner). The retry's own `LedgerApp-queue-age` email also arrived (ALARM 20:25:34 UTC, datapoint 993 s), as E2 predicts; not counted for Ships 5 | |
| E3 | pass | re-walk 21:45:17–22 UTC, right after E1: `dlq         1 message(s), showing 1` + the `simpoison_79efe3a7_0  email.bounced …  receives 16` line, stderr exactly the worker-logs notice, exit 0; JSON `depth: 1`, the seven keys, exit 0. First run: human: `dlq         1 message(s), showing 1` + the item line (`email.sent`, `receives 26`), exit 0, stderr exactly the worker-logs notice; JSON with exactly the seven keys, `depth: 1`, exit 0; `grep -c resend.dev` `0`; `--limit 11` → `validation_failed` with the exact message, hint and docs, exit 1. The second inspect showed the same item, `receive_count` 36: each sample receive adds to the count, as `dlq.listMessages` documents | |
| E4 | pass | re-walk 21:45:22 UTC, 1 s after E3 read `depth: 1`: exactly `redrive     started: 1 message(s) moving back to the queue; watch the dlq depth with ledger health`, exit 0. First run (before `d9f90ff`): `redrive     nothing to move: the dlq is empty`, exit 0, over the listed message | F3 |
| E5 | pass | re-walk 21:45:23 UTC: `{"object":"dlq_redrive","status":"empty","depth":0}`, exit 0, the documented alternative (the one-message task had finished). First run: right after E4: `{"object":"dlq_redrive","status":"started","depth":1}`, exit 0 (it did E4's job); repeated at 20:37:42 while that task could still run: `{"object":"dlq_redrive","status":"empty","depth":0}`, exit 0, the documented alternative. `redrive_in_progress` not observed: a one-message task ends within seconds | |
| E6 | pass | re-walk 21:45:38 UTC: the four lines exactly, exit 0 (waited 2 s). First run: 20:37:54 `dlq 1 visible`; 20:38:15 the four lines exactly, exit 0 (waited 23 s) | |
| E7 | pass | re-walk: `ledger email 79efe3a7-email-0 --json` exit 0, exactly one timeline entry `simpoison_79efe3a7_0`, no raw address. First run: `ledger email ccc7de44-observed-bounced --json` exit 0; exactly one timeline entry `simpoison_ccc7de44_0`; no raw address | |
| F1 | pass | stdout `token 14`, `name review-dlq`, `scope read`, `created …`, `secret ldg_<redacted:token>`, exit 0; stderr exactly the store-it-now notice | |
| F2 | pass | `{"object":"list","has_more":false,"depth":0,"data":[]}`, exit 0, with the `read` token | |
| F3 | pass | stdout empty, exit 1; stderr exactly the scope message and `hint: Use an \`operate\` token, …` | |
| G1 | pass | seed `3746560392` ns `481c5382`; `history emails=8 events=33 duplicates=6 shuffled=true`; `sent requests=39 accepted=39`; `invariant 1 pass stored=33/33`; `invariant 2 pass emails=8 recipients=9`; 3 and 4 not checked as expected; exit 0; no raw address | |
| H1 | pass | `LEDGER READY in 10s`, api `http://127.0.0.1:3200`, started (not adopted) | |
| H2 | pass | `dlq         empty`, empty stderr, exit 0; empty-list JSON, exit 0 | |
| H3 | pass | `redrive     nothing to move: the dlq is empty`, exit 0; `{"object":"dlq_redrive","status":"empty","depth":0}`, exit 0 | |
| H4 | n/a-today (2B) | slice 2B `Status` `[ ]` | |
| H5 | pass | exit 2, stderr exactly `sim: --burst needs a live run …`; `--chaos`, `--poison` the same with their flag | |
| I1 | pass | synth exit 0 with `AWS_PROFILE`/`AWS_REGION` unset; `2` secrets; `0` simulator refs | |
| T1 | pass | revoke `14`: the five lines with `revoked 2026-10-19T20:38:52.109Z`, exit 0; then the revoked token's `token current --json` → exactly the `unauthorized` error, exit 1 | |
| T2 | pass | the four health lines, exit 0; `LEDGER_SIMULATOR=on` | |
| T3 | pass | `compose services stopped (the database volume is kept).`; `stopped pid 53200 and its children (started by dev:full)`; `port 3200 is free.`; exit 0 | |

## Findings

### F1 — A2's deploy refuses as written: `.env.local` does not hold the deployed hashes' key

- **Severity:** major · **Category:** doc-drift · **Status:** fixed in `4ba66f0` (A2 re-walked: pass) · **Step:** A2
- **Expected:** `pnpm aws:deploy` from a shell with only `.env.local` loaded prints the 12 lines and exits 0, per A2.
- **Observed:** `aws:deploy: refused: LEDGER_ADDRESS_HASH_KEY's key_id differs from the stored address hashes' key_id; deploy with the key they were made under`, exit 1, before any `deploying` line.
- **Evidence:** fingerprints (sha256, first 8) of `LEDGER_ADDRESS_HASH_KEY`: worktree and main-checkout `.env.local` `f1db1f10`; `.env.deployed.local` `181014e4`. The same deploy with only that variable taken from `.env.deployed.local` exits 0.
- **Suspected cause:** the walkthrough's own environment notes say `.env.deployed.local` holds "the deployed hashes' key", yet A2 (and D2's restore hint "run `pnpm aws:deploy`") load nothing but `.env.local`. The guard (`infra/scripts/run-deploy.ts:329`) behaves as designed (slice 2 walk B3).
- **Proposed fix:** A2 (and every `pnpm aws:deploy` the walk names) puts `.env.deployed.local`'s `LEDGER_ADDRESS_HASH_KEY` in the shell first, or `.env.local` carries the deployed key; `wf-after-apply-check` decides which.

### F2 — one transient AWS read error aborts the poison run and drops the fault early

- **Severity:** minor · **Category:** bug · **Status:** fixed in `b3c57c5` (unit-tested; also the db-outage run's three waits) · **Step:** E1 (first attempt)
- **Expected:** the DLQ wait polls for up to 40 min (`DLQ_BOUND`), so a read that fails once inside it is retried at the next interval.
- **Observed:** ≈ 9 min in, with the machine's route to us-east-2 down (K5), `sim: the poison run failed (TimeoutError)`, then `poison fixed; …`, exit 1. The constraint was dropped after about 2 of the 6 receives, so the poisoned event commits on its next receive instead of reaching the DLQ: the run's evidence is lost and it must be re-run whole.
- **Evidence:** seed `4280163258` ns `649bfac1`, `simpoison_649bfac1_0`, `sent requests=28 accepted=28` at ≈ 19:50 UTC, failure ≈ 19:59 UTC; at 20:01 `sts.us-east-2` and `sqs.us-east-2` fail TCP 443, `sts.us-east-1` connects.
- **Suspected cause:** `sim/src/poison-run.ts:147-150`: the `waitUntil` check calls `run.dlqDepth()` with no catch, so the throw leaves `poisoned()` and `poisonRun`'s `finally` (`:200-201`) removes the fault. The db-outage run's waits may share the shape (not checked).
- **Proposed fix:** a failed depth read inside the bound counts as "not yet" (logged by error name), and the run fails only when the bound runs out; the fault stays until the DLQ holds the poisoned or the bound ends.

### F3 — `ledger dlq redrive` says "the dlq is empty" over a message `ledger dlq inspect` just listed

- **Severity:** major · **Category:** contract · **Status:** fixed in `d9f90ff`, deployed 21:12 UTC (E3 → E4 re-walked within 1 s: `started`) · **Step:** E4
- **Expected:** `redrive     started: 1 message(s) moving back to the queue; …`, exit 0, per E4 and [dlq.startRedrive](../../../../.ai/api-contract.md#dlqstartredrive) ("An empty DLQ answers `200` and starts no task": the DLQ was not empty).
- **Observed:** `redrive     nothing to move: the dlq is empty`, exit 0, ≈ 20:37 UTC, seconds after E3's inspect answered `depth: 1` with the item; the next redrive answered `started`, `depth: 1`. The message stayed in the DLQ and moved on the next call: no event lost.
- **Evidence:** `simpoison_ccc7de44_0`, moved to the DLQ ≈ 20:36 UTC (E1's `invariant 4 pass`), E3 then E4 within ≈ 60 s.
- **Suspected cause:** `packages/aws/src/sqs-dlq.adapter.ts` `startRedrive`: `if (depth === 0 || (await this.#receive(1)).length === 0) return { status: 'empty', depth: 0 }`. An approximate depth of 0 inside AWS-62's one-minute lag answers `empty` with no confirming receive, while `dlq.listMessages` already guards the same lag (`depth = max(approximate, items)`). Which branch fired is `[Unverified]` (no log of the depth read). VERIFICATION.md lists this as a kept judgement call ("D4 as designed"), not an owner decision; E4's text, the operator's first step after an alarm, hits it.
- **Proposed fix:** when the approximate depth reads 0, confirm with the same one-message receive before answering `empty` (symmetric to the AWS-62 guard), or the owner accepts the behaviour and E4 names the retry.

## Held for the owner

_none: the owner approved every AWS step in this conversation_

## Data created

- Neon ledger rows, kept (never deleted): G1 ns `481c5382` (seed `3746560392`), C2 ns `19c73e81` (seed `2604380573`), D2 ns `68e2e615` (seed `2276865197`), E1 first attempt ns `649bfac1` (seed `4280163258`), E1 retry ns `ccc7de44`, re-walk E1 ns `79efe3a7`.
- Re-walk deploy at `b3c57c5`: no new resource (simulator secret `unchanged`).
- `ledger_sim_poison` constraint: added and dropped by each E1 attempt (`poison fixed`).
- Token `<redacted:token>` id `14` (`review-dlq`, `read`): revoked in T1; its scratch copy deleted.
- AWS: no new resource (the deploy found the simulator secret `unchanged`); throttle, database secret and function descriptions restored by C2's and D2's own runs.
- Local: `pnpm dev:full` started and stopped by this run (T3); compose volume kept.
