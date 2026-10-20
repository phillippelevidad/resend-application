# Slice 4 review fixes — free-form run

- **Request:** walk the slice 4 review fixes (7b308b5, 125d714, 27f163e, 0cd5b32, cd951d6, 259e78f,
  b21fd08) against the owner's kept AWS deploy: deploy, a waiting dry run, a warm-container key
  rewrite, the gap drill, the db-outage chaos run.
- **Run:** 2026-10-20 20:45–21:40 UTC · free-form mode · branch `worktree-slice-4-reconcile`
- **HEAD:** `b21fd08` (clean) · **Environment:** deployed (kept stack, us-east-2)
- **Started by this run:** none left running · **Adopted:** the kept `LedgerApp` / `LedgerGuardrails`
- **Approval (owner, this session, relayed by the orchestrator):** "When all issues are fixed, walk
  the fixes. AWS deploys, Resend API calls, etc., needed for the tests, are all pre-approved. Skip
  what depends on me; I won't be here."
- **Time box:** 45 min · **Wall clock used:** 55 min (the gap drill's two 11-minute runs)

**Verdict:** walked with findings: the deploy, the waiting CLI path and the per-invocation key read
(0cd5b32) pass live. The gap drill (b21fd08) failed twice on a partial 0/0 throttle leak, and the
pre-check it adds caught the leak both times. With 2c1c4f9 (the drill confirms the lowered route
answers `429` five times in a row before it sends) the drill passed end to end at 22:02 UTC.
db-outage is held.

| pass | doc-drift | fail | inconclusive | blocked | held | n/a-today | skipped | not-run |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 5 | 0 | 1 | 0 | 0 | 1 | 0 | 0 | 0 |

| Step | Status | Observed | Finding |
| --- | --- | --- | --- |
| 1 `pnpm aws:deploy` | pass | exit 0; `ledger/database unchanged`, `ledger/resend-api-key unchanged`, `KillSwitchArmed true`, `simulator on`, `done`. `LedgerApp-reconciler` and `LedgerApp-api` LastModified 20:47:41Z (new code); K3's SSL warning on stderr only | |
| 2 `ledger reconcile --dry-run --json` · `ledger gaps --json` | pass | exit 0, one JSON document: run 13, `finished_at` set, `checked 6 missing 0`, `error null`; stderr `ledger: reconcile run 13 started; …`. gaps: exit 0, runs 1–13, newest first | |
| 3 key rewrite in a warm container (0cd5b32) | pass | (a) run 13 clean. (b) placeholder (no `re_` prefix) put into `ledger/resend-api-key` at 20:48:27. (c) run 14: exit 1, `{"error":{"code":"reconciler_not_configured",…}}`. (d) `pnpm aws:deploy`: exit 0, `ledger/resend-api-key written`, reconciler LastModified unchanged (no recycle). (e) run 15: exit 0, `missing 0`, `error null`. Logs: runs 13, 14 and 15 are all in one log stream (`…0df222b6`) with one `INIT_START`, before run 13, so it was one warm container. Run 14 emitted no `reconcile.*` EMF lines, as `report-run.ts` specifies for an errored run. Secret afterwards equals `LEDGER_DEPLOY_RESEND_API_KEY` (compared in-process, value never printed) | |
| 4 `pnpm aws:gap-drill` (b21fd08) | fail | Two runs (21:03, retried once at 21:15): `lowering the ingest route throttle`, `sent one email`, `events visible after 4219 ms` / `6816 ms`, `waiting 626 s` / `624 s for the grace window`, `ingest route restored`, then `failed: the send's events were stored before the reconcile`, exit 1 | F1 |
| 4b manual recovery (runs 17–19) | pass | dry run 17 `missing 2`; reconcile 18 `missing 2 replayed 2 failed 0`; both drill emails then read `event_count 2` (`email.sent` + `email.delivered`); dry run 19 `missing 0`; `ledger gaps --since 1h` lists 19, 18, 17 as expected | |
| 4c `pnpm aws:gap-drill` (2c1c4f9, confirm before send; run by the orchestrator, 22:02:35–22:13:51 UTC) | pass | exit 0; lines in order: `lowering the ingest route throttle`, `ingest route refusing: 429 x5`, `sent one email`, `events visible after 6843 ms`, `waiting 624 s for the grace window`, `ingest route restored`, `stored before the reconcile: 0`, `dry run: missing 2`, `reconcile: missing 2 replayed 2 failed 0`, `stored 2 of 2`, `dry run: missing 0`, `gaps: newest run missing 0`, `created_at unchanged by the replay: yes`, `aws:gap-drill: done` | F1 fixed |
| 5 `pnpm sim --chaos db-outage` (27f163e) | held | Not started on the orchestrator's instruction: the refreshed SSO token expires 22:37:45 UTC and is not renewed automatically, and a run whose restore outlives it could leave the database secret repointed. Covered by `sim/src/db-outage-run.test.ts` (the reconciler is recycled on repoint and on restore) | |

**Not live-walkable, covered by tests:** 7b308b5 (`packages/resend-client/src/limiter.test.ts`,
`create-resend-client.test.ts`) · 125d714 (`packages/api/src/start-reconcile.*.int.test.ts`) ·
cd951d6 (`packages/reconciler/src/reconciler.int.test.ts`) · 259e78f's retry and its 5-in-a-row
bound (`apps/cli/src/commands/reconcile-start.cli.test.ts`). Steps 2, 3 and 4b only walk 259e78f's
happy path: no poll error occurred live.

## Findings

### F1 — the gap drill cannot finish: the 0/0 ingest route throttle admits one of the send's two events

- **Severity:** major · **Category:** ops · **Status:** confirmed (2/2 runs) · **Step:** 4
- **Expected:** `stored before the reconcile: 0` … `aws:gap-drill: done`, per WALKTHROUGH D1.
- **Observed:** in both runs Resend's `email.sent` was refused (List Events `status=attempting`), and
  `email.delivered`, sent about 0.5 s later, was accepted (`status=success`). The ingest Lambda ran at
  21:03:21 and 21:15:16 (CloudTrail `UpdateStage` for the lower at 21:03:18 and 21:15:13), and the
  worker stored the event about 5 s after the lower's `UpdateStage` (21:03:23 and 21:15:18, per the orchestrator's
  read of the worker logs). `ledger email 01a15b20-31fe-7671-a300-544046ac869e --json` then read
  `event_count 1`, `email.delivered` only (svix `msg_3KyWHYEmeo62m7Q5pMuU71J5aJj`), so the drill's
  new pre-check failed it correctly, and its line is accurate.
- **Evidence:** emails `01a15b20-31fe-7671-a300-544046ac869e` and `01a15b2b-19e4-77f3-808f-b71a58a55e61`;
  ingest log group `/ledger/LedgerApp-ingest`; the earlier drills that day (16:34, 18:02) saw no leak.
- **Suspected cause:** AWS-14 (throttles are "best-effort … targets"), and propagation of the route
  setting across API Gateway nodes. This is live evidence for the open AWS-U02 (a 0 route throttle
  does not reject every request, at least in the first seconds). `infra/scripts/run-gap-drill.ts` sends
  right after the lower returns.
- **Fixed:** 2c1c4f9 confirms the lowered route refuses (`429` ×5 within 60 s) before the send; the
  re-run (step 4c) passed. Recorded in `.ai/aws.md` AWS-14, AWS-U02 and AWS-U16. A rule gate refused
  the alternative, accepting a partial leak, since it would narrow Ships 9 without an owner decision.

### F2 — the pg SSL-mode warning reaches the reconciler's log as a non-JSON `ERROR` line (polish, unconfirmed scope)

- Each cold start logs `ERROR (node:2) Warning: SECURITY WARNING: The SSL modes …` (K3's warning) in
  `/ledger/LedgerApp-reconciler`. No value is printed, and it predates these fixes.

## Held for the owner

- Step 5, `pnpm sim --chaos db-outage`: repoints `ledger/database`, recycles worker, api and
  reconciler, then restores. Run it with an SSO session that outlasts about 2 h.

## AWS end state (read 21:39 UTC)

- `ledger/resend-api-key` equals `LEDGER_DEPLOY_RESEND_API_KEY` (in-process compare).
- The ingest route is restored: `$default` stage has no route settings, default throttle 100 / 200.
- The stack is armed and untripped: `KillSwitchArmed true`, no reserved concurrency on any
  `LedgerApp-*` function, every `Ledger*` alarm `OK` with actions enabled, both stacks `UPDATE_COMPLETE`.
- The worker event source is `Enabled`; queue and DLQ 0 / 0 (`ledger health`, 21:26).

## Data created

- A third send to `delivered@resend.dev` (step 4c), its two events refused and replayed. Kept.
- Two sends to `delivered@resend.dev` (the two drills), their two refused `email.sent` events,
  replayed by run 18 and stored; Resend's own retries of those will dedupe on `svix_id`. Kept.
- Reconcile runs 13–15 and 17–19 (manual). Kept.
- `ledger/resend-api-key` held a placeholder from 20:48:27 to the second deploy, about 20:49:30, now
  restored. No tokens minted, no webhooks created.
