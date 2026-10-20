# Slice 4 — walkthrough

What one person does to prove this slice works: recovery runs locally (path A, ~5 minutes), the
reconciler deployed on its hourly cron (B), the replay experiment and the read-only Resend checks
(C), one real gap and its recovery on the owner's deployment (D, ~25 minutes, between `:02` and
`:40` UTC), the disabled-webhook experiments (E), and a reviewer's read-only pass (F). B's scheduled
run and D's alarm email need the clock: walk them beside the other paths.

**Read this first.** A step that cannot be completed today ends with `→ slice N`, naming the slice
that carries it. A step without such a note that fails is a finding against this slice.

Every `UI surfaces` entry on the [slice 4 card](../../../.ai/build-checklist.md#4--recovery) is
reached: `ledger gaps --since 24h` (F2); `ledger reconcile --dry-run` (A2, D1); `ledger reconcile`
(A6, D1); `ledger health` (A4, B3, D3); the hourly cron run (B4); `pnpm aws:gap-drill` (D1); the
`LedgerApp-reconcile-gap` email (D4, owner-observed).

Order: A → B → C → D → E → F, then [Teardown](#teardown). B4 waits for the next `:00`; D1 needs a
start minute between `:02` and `:40` UTC, no unfinished run, and B5 reading `"OK"`.

## Before you start

```bash
pnpm install
pnpm dev:full
git status --porcelain --untracked-files=no
grep -o '^[A-Z_]*=' .env.local
grep -o '^[A-Z_]*=' .env.deployed.local
export AWS_PROFILE=ledger AWS_REGION=us-east-2
```

- **Shell:** Bash (Git Bash on Windows), from the repo root. `pnpm dev:full` ends `LEDGER READY`;
  `git status` prints nothing (the deploy refuses a tree with tracked changes); both `grep`s print
  names only, never values.
- **Environment variables (names only).** `.env.local` (written by `pnpm db:setup`): `DATABASE_URL`,
  `LEDGER_ADDRESS_HASH_KEY`, `LEDGER_TOKEN_TAG_KEY`, `LEDGER_SIMULATOR_SECRET`, `LEDGER_URL`,
  `LEDGER_TOKEN`; the owner's deploy inputs `LEDGER_DEPLOY_DATABASE_URL`,
  `LEDGER_DEPLOY_DATABASE_POOLED_URL`, `LEDGER_DEPLOY_WEBHOOK_SECRETS`, `LEDGER_ALERT_EMAIL`,
  `LEDGER_KILL_SWITCH` (`on`), `LEDGER_SIMULATOR` (`on`) and, new in this slice,
  `LEDGER_DEPLOY_RESEND_API_KEY` (the dedicated `full_access` key made for the reconciler) and
  `LEDGER_DEPLOY_RESEND_WEBHOOK_ID` (the production webhook's id). `RESEND_API_KEY` (a key that can
  read the webhook and send; path C and D). `.env.deployed.local` (git-ignored, the owner's):
  `LEDGER_URL` (the deployed `ApiUrl`), `LEDGER_TOKEN` (an `operate` token) and
  `LEDGER_ADDRESS_HASH_KEY` (the deployed hashes' key).
- **Loading the deployed values.** Nothing loads `.env.deployed.local` by itself, and a shell value
  wins over `.env.local`. Bash: `set -a; . ./.env.deployed.local; set +a`. An agent, whose Bash
  guard rejects `.`: load it in the same PowerShell command as the `pnpm` call (rsa-manual-test →
  environment.md, K1, K2). Never print the file. Path A runs with none of it loaded:
  `unset LEDGER_URL LEDGER_TOKEN LEDGER_ADDRESS_HASH_KEY` first.
- **AWS session:** `aws sso login --profile ledger` before B and before D when the session is close
  to expiring: D's drill restores the ingest route in its `finally`, which needs the session.
- **This walk creates:** local reconcile runs (A); the deployed reconciler, its secret, schedule and
  alarm (B2, kept); one test send's two events and their replays (D1); a throwaway API key (C7,
  revoked in the step) and, if E runs, a throwaway webhook (deleted in E7); the `read` token
  `review-walk` (F1). Teardown revokes `review-walk`.
- **Ask-first steps:** B2 (redeploy; its approval covers the reconciler's hourly replays), B5 and C6
  (AWS reads), C4 (one replay), C7 (pre-approved: the RS-U17 key create and revoke), D1 (the gap
  drill: one send, its replays, the ingest route change), D4 (an AWS read), E1–E7 (each).

## Path A — local: runs end not configured, and the CLI surfaces

**Walked as:** Operator. `LEDGER_URL` and `LEDGER_TOKEN` from `.env.local`.

1. **List the recent runs.**

   ```bash
   pnpm -s ledger gaps --json
   ```

   Expect: exit `0`; one JSON document with `"object": "list"` and `"has_more": false`.

2. **Start a local dry run and wait for it.**

   ```bash
   pnpm -s ledger reconcile --dry-run --json
   ```

   Expect: exit `1` after about 3 s; stderr `ledger: reconcile run <run_id> started; follow it with
   ledger gaps.`; stdout `{ "error": { "code": "reconciler_not_configured", … } }`.
   → **Why it matters.** Local mode composes no Resend client (D23): the run is recorded, finished,
   and makes no Resend call.

3. **See the run in the list.**

   ```bash
   pnpm -s ledger gaps
   ```

   Expect: exit `0`; the newest row reads `  <run_id>   manual      dry run   <started_at>   checked 0   missing 0   replayed 0   failed 0   reconciler_not_configured`.

4. **See the run in health.**

   ```bash
   pnpm -s ledger health
   ```

   Expect: exit `0`; the last line reads `reconcile   run <run_id> reconciler_not_configured`.

5. **Pass an out-of-range duration to each command.**

   ```bash
   pnpm -s ledger reconcile --lookback 31d --json; echo "exit $?"
   pnpm -s ledger gaps --since 2x --json; echo "exit $?"
   ```

   Expect: both `exit 1`; the first prints `"code": "validation_failed"` with `"message": "lookback
   must be a duration from 1m to 30d, such as 72h."` and no started notice; the second the same code
   with `"message": "since must be a duration from 1m to 30d, such as 24h."`.

6. **Start a real (not dry) run, then one without waiting.**

   ```bash
   pnpm -s ledger reconcile --json; echo "exit $?"
   pnpm -s ledger reconcile --no-wait --json; echo "exit $?"
   ```

   Expect: the first `exit 1` with `"code": "reconciler_not_configured"`; the second `exit 0`, the
   started run with `"trigger": "manual"` and `"finished_at": null`, and the started notice on stderr.

## Path B — deployed: the reconciler on its hourly cron

**Walked as:** Operator. Deployed values loaded (Before you start).

1. **Deploy with only the key set.**

   ```bash
   LEDGER_DEPLOY_RESEND_WEBHOOK_ID= pnpm aws:deploy
   ```

   Expect: exit `1` before any AWS call; the last line
   `aws:deploy: refused: LEDGER_DEPLOY_RESEND_WEBHOOK_ID must be set to the Resend webhook id, with LEDGER_DEPLOY_RESEND_API_KEY and LEDGER_DEPLOY_WEBHOOK_SECRETS`.

2. **Deploy with both set.**

   ```bash
   pnpm aws:deploy
   ```

   Expect: exit `0`; lines include `aws:deploy: ledger/resend-api-key written`,
   `aws:deploy: KillSwitchArmed true` and the last `aws:deploy: done`; no line holds the key.
   **Ask-first:** a deploy that creates `LedgerApp-reconciler`, `ledger/resend-api-key`,
   `LedgerApp-reconcile-hourly` and `LedgerApp-reconcile-gap`; its approval covers the reconciler's
   automatic hourly replays on the production webhook.

3. **Read health on the deployed stack.**

   ```bash
   pnpm -s ledger health
   ```

   Expect: exit `0`; a line starting `reconcile   ` (`no run yet` before the first `:00`).

4. **After the next `:00`, read the scheduled run.**

   ```bash
   pnpm -s ledger gaps --since 2h --json
   ```

   Expect: exit `0`; a run with `"trigger": "scheduled"`, `"missing": 0` and `"error": null`.

5. **After an hour with a clean run, read the gap alarm's state.**

   ```bash
   aws cloudwatch describe-alarms --alarm-names LedgerApp-reconcile-gap --query "MetricAlarms[0].StateValue"
   ```

   Expect: `"OK"`. Before the first configured run it reads `"ALARM"`, which is expected (runbook →
   LedgerApp-reconcile-gap).
   **Ask-first:** an AWS read.

## Path C — the replay chain and the read-only Resend checks (RS-U01, RS-U02, RS-U03, RS-U17, RS-U20)

**Walked as:** Operator. `RESEND_API_KEY` and `LEDGER_DEPLOY_RESEND_WEBHOOK_ID` in the shell.

1. **List the production webhook's newest events.**

   ```bash
   curl -s "https://api.resend.com/webhooks/$LEDGER_DEPLOY_RESEND_WEBHOOK_ID/events?limit=5" -H "Authorization: Bearer $RESEND_API_KEY"
   ```

   Expect: `"object": "list"` and `data` items each with an `id` (`msg_…`), `type` and `created_at`.

2. **Retrieve one stored event, then read its email through Ledger.**

   ```bash
   curl -s "https://api.resend.com/webhooks/$LEDGER_DEPLOY_RESEND_WEBHOOK_ID/events/<event_id>" -H "Authorization: Bearer $RESEND_API_KEY"
   pnpm -s ledger email <email_id> --json
   ```

   Expect: the event's `payload.data.email_id`; then `ledger email` exits `0` and its `timeline`
   `svix_id`s equal the List Events `id`s of that email: RS-U02 (List Events ids are delivered
   `svix-id`s).

3. **On or after 2026-10-21, page List Events to its oldest event.**

   ```bash
   curl -s "https://api.resend.com/webhooks/$LEDGER_DEPLOY_RESEND_WEBHOOK_ID/events?limit=100&after=<last_id>" -H "Authorization: Bearer $RESEND_API_KEY"
   ```

   Expect: repeated until `"has_more": false`; the oldest `created_at` is at least 72 h before now:
   RS-U03 (reach of at least the 3-day lookback). Before 2026-10-21 the webhook is younger than
   72 h, so the step waits for the date.

4. **Replay that stored event.**

   ```bash
   curl -s -X POST "https://api.resend.com/webhooks/$LEDGER_DEPLOY_RESEND_WEBHOOK_ID/events/<event_id>/replay" -H "Authorization: Bearer $RESEND_API_KEY"
   ```

   Expect: `"object": "webhook_event"` with the event's own `id`.
   **Ask-first:** one replay on the owner's production webhook.

5. **List that event's attempts.**

   ```bash
   curl -s "https://api.resend.com/webhooks/$LEDGER_DEPLOY_RESEND_WEBHOOK_ID/events/<event_id>/attempts" -H "Authorization: Bearer $RESEND_API_KEY"
   ```

   Expect: the newest attempt's `http_status_code` is `200` on an event days older than 5 min:
   RS-U20 (a replay passes the timestamp window).

6. **Read the worker's duplicate line for the replay.**

   ```bash
   aws logs filter-log-events --log-group-name /ledger/LedgerApp-worker --filter-pattern '"worker.duplicates"' --start-time <replay epoch ms>
   pnpm -s ledger email <email_id> --json
   ```

   Expect: one `worker.duplicates` line carrying that event's `svix_id`, and `event_count` unchanged
   from C2: RS-U01 (a replay keeps the original `svix-id`).
   **Ask-first:** an AWS read.

7. **Create a throwaway key, revoke it, and read with it and with a key no account issued.**

   ```bash
   curl -s -X POST https://api.resend.com/api-keys -H "Authorization: Bearer $RESEND_API_KEY" -H 'Content-Type: application/json' -d '{"name":"ledger-rs-u17","permission":"sending_access"}'
   curl -s -X DELETE "https://api.resend.com/api-keys/<key_id>" -H "Authorization: Bearer $RESEND_API_KEY"
   curl -s -o /dev/null -w '%{http_code}\n' "https://api.resend.com/webhooks/$LEDGER_DEPLOY_RESEND_WEBHOOK_ID" -H "Authorization: Bearer <the revoked key>"
   curl -s "https://api.resend.com/webhooks/$LEDGER_DEPLOY_RESEND_WEBHOOK_ID" -H "Authorization: Bearer re_<well-formed, never issued>"
   ```

   Expect: the delete answers `"deleted": true`; both reads answer `400` with `"name":
   "validation_error"` and `"message": "API key is invalid"` (RS-U17, which `resend-client` maps to
   `resend_auth_failed`). Record status and name only, never a key.
   **Ask-first:** pre-approved (proposal → Impact, item 7a): one create and one revoke of
   `ledger-rs-u17`.

## Path D — one real gap and its recovery (J3)

**Walked as:** Operator. Deployed values loaded, plus `RESEND_API_KEY` and
`LEDGER_DEPLOY_RESEND_WEBHOOK_ID`; start between `:02` and `:40` UTC, and only once B5 reads
`"OK"`: an alarm already in `ALARM` (the hour before the reconciler's first run reads as breaching)
makes no transition, so D4 would show no drill email.

1. **Run the gap drill.**

   ```bash
   pnpm aws:gap-drill
   ```

   Expect: exit `0` in about 12 minutes; lines in order `aws:gap-drill: lowering the ingest route
   throttle`, `sent one email`, `events visible after <ms> ms` (RS-U13), `waiting <s> s for the grace
   window`, `ingest route restored`, `dry run: missing 2`, `reconcile: missing 2 replayed 2 failed 0`,
   `stored 2 of 2`, `dry run: missing 0`, `gaps: newest run missing 0`,
   `created_at unchanged by the replay: yes` (RS-U10), and `aws:gap-drill: done`; no line holds an
   id, a key, a URL or an address.
   **Ask-first:** one send to `delivered@resend.dev`, its two replays, and the ingest route throttle
   lowered then restored on the owner's stack.

2. **List the runs the drill made.**

   ```bash
   pnpm -s ledger gaps --since 1h
   ```

   Expect: exit `0`; three manual rows, newest first: `dry run` with `missing 0`, then
   `missing 2   replayed 2   failed 0   ok`, then `dry run` with `missing 2`.

3. **Read health.**

   ```bash
   pnpm -s ledger health
   ```

   Expect: exit `0`; `reconcile   run <run_id> finished <finished_at>, missing 0, replayed 0`.

4. **Watch the gap alarm fire and clear.**

   ```bash
   aws cloudwatch describe-alarm-history --alarm-name LedgerApp-reconcile-gap --history-item-type StateUpdate --max-items 5
   ```

   Expect: within about an hour of D1, a transition to `ALARM` (the drill's runs found `missing 2`),
   and the owner's alert email titled with `LedgerApp-reconcile-gap` (owner-observed); after the
   next clean hour, a transition to `OK` (Ships 11).
   **Ask-first:** an AWS read.

## Path E — a disabled webhook (RS-U04, RS-U05)

**Walked as:** Operator. Each step is held unless the owner approves it; held, RS-U04 and RS-U05
close safe either way (design.md → D39) and the path is skipped.

1. **Create a throwaway webhook on the deployed ingest URL.**

   ```bash
   curl -s -X POST https://api.resend.com/webhooks -H "Authorization: Bearer $RESEND_API_KEY" -H 'Content-Type: application/json' -d '{"endpoint":"<ApiUrl>/webhooks/resend","events":["email.sent","email.delivered"]}'
   ```

   Expect: an `id` and a `signing_secret`, which is never added to the set, so each delivery answers
   `401` and nothing reaches the ledger.
   **Ask-first:** a webhook create.

2. **Send once.**

   ```bash
   curl -s -X POST https://api.resend.com/emails -H "Authorization: Bearer $RESEND_API_KEY" -H 'Content-Type: application/json' -d '{"from":"onboarding@resend.dev","to":["delivered@resend.dev"],"subject":"walk E2","text":"walk"}'
   ```

   Expect: an email `id`; the throwaway webhook's List Attempts show `401`s.
   **Ask-first:** one send.

3. **Disable the throwaway webhook.**

   ```bash
   curl -s -X PATCH "https://api.resend.com/webhooks/<throwaway_id>" -H "Authorization: Bearer $RESEND_API_KEY" -H 'Content-Type: application/json' -d '{"status":"disabled"}'
   ```

   Expect: `"status": "disabled"` on a Retrieve Webhook read after it.
   **Ask-first:** a webhook update.

4. **Replay one of its events while disabled.**

   ```bash
   curl -s -X POST "https://api.resend.com/webhooks/<throwaway_id>/events/<event_id>/replay" -H "Authorization: Bearer $RESEND_API_KEY"
   ```

   Expect: record whether List Attempts gains an attempt (RS-U04: does a replay of a disabled
   webhook deliver).
   **Ask-first:** one replay.

5. **Send again while disabled.**

   ```bash
   curl -s -X POST https://api.resend.com/emails -H "Authorization: Bearer $RESEND_API_KEY" -H 'Content-Type: application/json' -d '{"from":"onboarding@resend.dev","to":["delivered@resend.dev"],"subject":"walk E5","text":"walk"}'
   ```

   Expect: record whether List Events gains events for this send (RS-U05, first half).
   **Ask-first:** one send.

6. **Re-enable it.**

   ```bash
   curl -s -X PATCH "https://api.resend.com/webhooks/<throwaway_id>" -H "Authorization: Bearer $RESEND_API_KEY" -H 'Content-Type: application/json' -d '{"status":"enabled"}'
   ```

   Expect: record whether E5's events are then delivered (RS-U05, second half).
   **Ask-first:** a webhook update.

7. **Delete the throwaway webhook.**

   ```bash
   curl -s -X DELETE "https://api.resend.com/webhooks/<throwaway_id>" -H "Authorization: Bearer $RESEND_API_KEY"
   ```

   Expect: `"deleted": true`; List Webhooks no longer shows it.
   **Ask-first:** a webhook delete.

## Path F — the M1 review, read-only

**Walked as:** Reviewer. Deployed `LEDGER_URL` loaded; `LEDGER_TOKEN` is the `review-walk` token
from F1.

1. **Mint a read token for the review (as the operator).**

   ```bash
   pnpm -s ledger token create --name review-walk --scope read --json
   ```

   Expect: exit `0`; `"scope": "read"`, a `token_id` and the plaintext `token`, shown once. Put it in
   `LEDGER_TOKEN` for F2–F3.

2. **List the last day's runs.**

   ```bash
   pnpm -s ledger gaps --since 24h
   ```

   Expect: exit `0`; the scheduled and drill runs, each row ending `ok` or its `error.code`.

3. **Try to start a run with the read token.**

   ```bash
   pnpm -s ledger reconcile --dry-run --json; echo "exit $?"
   pnpm -s ledger gaps --since 24h --json
   ```

   Expect: `exit 1` with `"code": "forbidden"` and no started notice; the list holds the same runs as
   F2, so no run started.

4. **Check every link the README holds.**

   ```bash
   node scripts/check-links.mjs
   ```

   Expect: exit `0`; `links: README.md <n> checked, 0 broken`.

5. **Desk-check the README's claims.** Open each reliability claim in `README.md` and follow its
   link.

   Expect: every claim links a test, an invariant or a recorded run; reconcile is described as the
   same approach as the Ingester's open PR #13; MCP and reactions sit under the roadmap's MVP stage with no
   behavior claimed.

## Teardown

1. **Revoke the review token (as the operator).**

   ```bash
   pnpm -s ledger token revoke <review-walk token_id> --json
   ```

   Expect: exit `0`; the token object with a `revoked_at`. The deployed stack, the reconciler and its
   key are kept (lens clause 7).

## What this walk cannot reach today

| Not reachable | Carried by |
| --- | --- |
| MCP `list_gaps` and `reconcile` | [slice 5](../../../.ai/build-checklist.md#5--mcp-server-and-contract-hardening) |
| RS-U03 re-measured once the webhook is older than 30 days | [slice 7](../../../.ai/build-checklist.md#7--polish-and-retention) |
| A live reconcile in local mode, replaying into `apps/local` through `resend webhooks listen` | [architecture.md → Deferred](../../../.ai/architecture.md#deferred-yagni) (its tripwire: [slice 2B](../../../.ai/build-checklist.md#2b--local-mode-queue-and-docker-compose)'s `docker compose`) |
