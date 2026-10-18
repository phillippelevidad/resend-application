# Slice 2 — walkthrough

What one person does to prove this slice works. Unlike the ~15-minute walks, this one spans two
deploys, a teardown and redeploy, an alarm drill of a few minutes and a budget drill that waits
hours on AWS Budgets ([design.md → Walkthrough plan](design.md#walkthrough-plan)).

**Read this first.** A step that cannot be completed today ends with `→ slice N`, naming the slice
that carries it. A step without such a note that fails is a finding against this slice.

Every `UI surfaces` entry on the
[slice 2 card](../../../.ai/build-checklist.md#2--durable-ingest-on-aws) is reached: the deploy
command (B3, B4, B5, G4, G6, T3, C3); the teardown command (T1); `POST /webhooks/resend` deployed
(C4, and G1's unsigned requests); `ledger email <email_id>` (C5, D1, F3); `ledger recipient <address>`
(D2); `ledger health` (A3, G2, G5, C6, E3); `ledger worker resume` (A4, E4, F4);
`ledger token create|list|revoke|current` (A2, A5, A7, B4, T3, F1–F5); the trip drill and re-arm
scripts (G1, G5).

Order: A → B → G → T → C → D → E → F. Teardown (path T) runs before the webhook exists, so the
redeploy's new ingest URL needs no webhook update. Path T's steps are `T1`–`T3`; the walk's own
[Teardown](#teardown) steps are cited `W1`, `W2`.

## Before you start

```bash
pnpm install
docker info --format '{{.ServerVersion}}'
pnpm dev:full
grep -o '^[A-Z_]*=' .env.local
git status --porcelain --untracked-files=no
echo "$AWS_REGION"
```

- **Shell:** Bash (Git Bash on Windows), from the repo root. Run `pnpm dev:full` in its own
  terminal and leave it running: it ends `LEDGER READY in <n>s`, then
  `  api       http://127.0.0.1:3200` and `  postgres  localhost:55432 (compose service "postgres")`.
  If the `api` line ends ` (already running; adopted)` and that server was started before this
  slice's code, run `pnpm dev:stop`, then `pnpm dev:full` again, so `apps/local` reads
  `LEDGER_TOKEN_TAG_KEY`. The `grep` prints names only, never values; `git status` prints nothing
  (the deploy command refuses a tree with tracked changes); the region reads `us-east-2`.
- **Environment variables (names only):** `DATABASE_URL`, `LEDGER_ADDRESS_HASH_KEY`,
  `LEDGER_TOKEN_TAG_KEY`, `LEDGER_SIMULATOR_SECRET`, `LEDGER_URL`, `LEDGER_TOKEN` (written to
  `.env.local` by `pnpm db:setup`, which `pnpm dev:full` runs). The owner adds, in `.env.local`:
  `LEDGER_DEPLOY_DATABASE_URL`, `LEDGER_DEPLOY_DATABASE_POOLED_URL` (the Neon project's direct and
  pooled URLs), `LEDGER_ALERT_EMAIL`, `LEDGER_KILL_SWITCH` set to `on`, optionally
  `LEDGER_BUDGET_USD` (default `50`), `RESEND_API_KEY` (C1, C4), and in C2
  `LEDGER_DEPLOY_WEBHOOK_SECRETS`. `AWS_PROFILE` and `AWS_REGION` are exported in the shell, where
  both the `aws` CLI and the `pnpm aws:*` scripts read them. Every `pnpm aws:*` script, `pnpm -s ledger`
  and `pnpm sim` load `.env.local` themselves; a shell value wins over it.
- **Deployed values go through the shell, never a file or the transcript:**
  `export LEDGER_URL=<api url>`, then `read -rs LEDGER_TOKEN && export LEDGER_TOKEN` and paste the
  token, so it never lands in history. The same `read -rs` takes the walk's other tokens
  (`WALK_READ_TOKEN`, `REVIEW_TOKEN`). A run file records every token, URL, account id and webhook
  id as `<redacted:kind>`.
- **This walk creates:** locally, the `walk-read` token (revoked in A7) and, on a first setup over
  slice 1's `.env.local`, the local `operate` token; on AWS, both stacks (kept), the drill budget
  (removed in G6), the two SNS email subscriptions (confirmed in B4 and again in T3); in Neon, the
  bootstrap `operate` token (B4, kept: the owner stores it), `walk-operate` (T3) and `review-walk`
  (F1), both revoked in F5; on Resend, the production webhook (C1, kept); one test email's ledger
  rows (C4). The stacks and the webhook stay up (deploy and keep); ledger rows are never deleted.
- **Ask-first steps:** B1 (read the Lambda quota), B3, B4, B5 (deploys), G1 (trips the stack),
  G2 and G3 (inside the drill), G4 (deploys the drill budget, then the budget trips the stack), G5
  (re-arm), G6 (deploy), T1 (teardown), T3 (two deploys), C1 (creates the Resend webhook), C2
  (places its signing secret), C3 (deploy), C4 (one live send), E5 (reads the deployed database).
  Every `pnpm aws:*` run is Ask-first. Paths A, D and F make no AWS change and no live Resend write.

## Path A — local auth, health and tokens: tokens enforced, health and resume answer, scopes hold

**Walked as:** [Operator](../../../.ai/about.md#target-personas)

1. **Rerun the local setup.**

   ```bash
   unset LEDGER_URL LEDGER_TOKEN
   pnpm db:setup; echo "exit=$?"
   ```

   Expect: stdout ends `db:setup: ready`, then `exit=0`, with no `wrote` line: the current
   `LEDGER_TOKEN` is tag-valid and active, so setup keeps it. The first setup over slice 1's
   `.env.local` (the one `pnpm dev:full` ran above; read its terminal) printed, in order,
   `db:setup: wrote LEDGER_TOKEN_TAG_KEY to .env.local`, `db:setup: wrote LEDGER_TOKEN to .env.local`
   and `db:setup: ready`: slice 1's `local-loopback-no-auth` placeholder was replaced by a minted
   `operate` token. With compose Postgres stopped, setup instead ends on stderr
   `db:setup: failed: Postgres is unreachable at DATABASE_URL; start it with pnpm db:up`, exit `1`.
   → **Why it matters.** Local mode enforces tokens as deployed, and setup repairs the token
   itself (D41).

2. **Ask who the local token is.**

   ```bash
   pnpm -s ledger token current --json; echo "exit=$?"
   ```

   Expect: one JSON document, then `exit=0`:

   ```json
   {
     "object": "token",
     "token_id": <token_id>,
     "name": "bootstrap",
     "scope": "operate",
     "created_at": "<created_at>",
     "revoked_at": null
   }
   ```

   `name` reads `local-setup` instead when the local database already held a bootstrap row. No
   hash and no plaintext appear. Keep `<token_id>` for A7.

3. **Read the pipeline's health, as JSON and as a human.**

   ```bash
   pnpm -s ledger health --json; echo "exit=$?"
   pnpm -s ledger health; echo "exit=$?"
   ```

   Expect: first

   ```json
   {
     "object": "health",
     "queue": {
       "visible": 0,
       "in_flight": 0,
       "oldest_age_seconds": null
     },
     "dlq": {
       "visible": 0,
       "in_flight": 0
     },
     "event_source": {
       "state": "enabled"
     },
     "database": {
       "reachable": true,
       "storage_bytes": <bytes>,
       "storage_limit_bytes": 1000000000
     }
   }
   ```

   then `exit=0`; then exactly

   ```text
   queue       0 visible, 0 in flight, oldest —
   dlq         0 visible, 0 in flight
   worker      enabled
   database    reachable, <size> of 1.0 GB
   exit=0
   ```

   `<size>` is `<bytes>` in decimal units with one decimal (`9.4 MB` for `9437184`). Locally the
   queue is the in-process one and the event source is static `enabled` (D40).

4. **Ask the worker to resume.**

   ```bash
   pnpm -s ledger worker resume; echo "exit=$?"
   ```

   Expect: exactly `worker      enabled (already enabled)`, then `exit=0`. Locally it always
   answers this (D40); a paused source is reached only deployed.

5. **Create a `read` token named `walk-read`.**

   ```bash
   pnpm -s ledger token create --name walk-read --scope read; echo "exit=$?"
   ```

   Expect: stdout exactly

   ```text
   token       <walk_read_id>
   name        walk-read
   scope       read
   created     <created_at>
   secret      ldg_<…>
   exit=0
   ```

   and stderr exactly `ledger: this is the only time the token is shown; store it now.` The
   `secret` line is the plaintext's one appearance; keep it in the shell only:
   `read -rs WALK_READ_TOKEN && export WALK_READ_TOKEN`, paste it, Enter. Keep `<walk_read_id>`.
   Without `--name` the command instead exits `2` with stderr
   `error: required option '--name <name>' not specified` and calls nothing.

6. **Call an `operate` route over HTTP with the `read` token, then with no token.**

   ```bash
   export LEDGER_URL=http://127.0.0.1:3200
   curl -s -w '\n%{http_code}\n' "$LEDGER_URL/tokens" -H "authorization: Bearer $WALK_READ_TOKEN"
   curl -s -w '\n%{http_code}\n' "$LEDGER_URL/tokens"
   ```

   Expect: first exactly

   ```text
   {"error":{"code":"forbidden","message":"The token is valid but lacks the scope this operation needs.","hint":"Use an `operate` token, or ask its owner for one.","docs":"https://github.com/phillippelevidad/resend-application/blob/main/docs/runbook.md#forbidden"}}
   403
   ```

   then exactly

   ```text
   {"error":{"code":"unauthorized","message":"Bearer token missing, malformed, bad-tag, unknown or revoked.","hint":"Set `LEDGER_TOKEN` to an active token.","docs":"https://github.com/phillippelevidad/resend-application/blob/main/docs/runbook.md#unauthorized"}}
   401
   ```

   The `docs` links answer `404` until the runbook lands → [slice 3](../../../.ai/build-checklist.md#3--operations-and-evidence-on-aws).

7. **List the tokens, revoke `walk-read`, then try to revoke the only `operate` token.**

   ```bash
   unset LEDGER_URL
   pnpm -s ledger token list; echo "exit=$?"
   pnpm -s ledger token revoke <walk_read_id>; echo "exit=$?"
   pnpm -s ledger token revoke <token_id> --json; echo "exit=$?"
   ```

   Expect: the list prints one row per token, newest first, then `exit=0`, each row
   `  <id>   <name>   <scope>   <created_at>   —` (columns space-padded to their widest cell, the
   scope column at least as wide as `operate`; the last column is `revoked_at`, or `—` while
   active). Run the third command only when the list shows exactly one active `operate` row, A2's
   `<token_id>`; with more, revoking it would succeed, so skip it and record why. The revoke prints
   exactly

   ```text
   token       <walk_read_id>
   name        walk-read
   scope       read
   created     <created_at>
   revoked     <revoked_at>
   exit=0
   ```

   and the last command prints exactly, then `exit=1`:

   ```json
   {
     "error": {
       "code": "last_operate_token",
       "message": "Revoking this token would leave no active `operate` token.",
       "hint": "Create another `operate` token first.",
       "docs": "https://github.com/phillippelevidad/resend-application/blob/main/docs/runbook.md#last_operate_token"
     }
   }
   ```

   `pnpm -s ledger token current` still answers with A2's token afterwards.
   → **Why it matters.** An installation can never lock its operator out (Ships 5).

## Path B — deploy: the deploy command, its refusals, the first token printed once

**Walked as:** [Operator](../../../.ai/about.md#target-personas)

1. **Read the account's Lambda concurrency quota.**

   ```bash
   aws lambda get-account-settings --query 'AccountLimit.ConcurrentExecutions'
   ```

   Expect: one integer, the account's concurrent-execution quota. Record that number only, never
   the account id; it settles AWS-U05 ([aws.md](../../../.ai/aws.md#unverified)).
   **Ask-first:** an AWS call against the owner's account before the first deploy (card `Ops`).

2. **Synthesize both stacks and scan the result for secrets.**

   ```bash
   pnpm synth; echo "exit=$?"
   grep -rlE 'whsec_|re_[A-Za-z0-9]{8}|postgres(ql)?://|ldg_[0-9a-f]{20}' --exclude-dir='asset.*' infra/cdk.out/; echo "grep exit=$?"
   ```

   Expect: one `Bundling asset LedgerGuardrails/KillSwitch/Function/Code/Stage...` line and one
   per app function (`LedgerApp/Ingest`, `LedgerApp/Worker`, `LedgerApp/Api`), then
   `Successfully synthesized to <repo>/infra/cdk.out` and
   `Supply a stack id (LedgerGuardrails, LedgerApp) to display its template.`, `exit=0`, with no
   AWS credentials used. The `grep` prints no file and `grep exit=1`: no CBL-01 hit
   ([check-before-launch.md](../../../.ai/check-before-launch.md#public-repo-hygiene)).

3. **Deploy with a fresh address-hash key against a database that holds hashes.**

   ```bash
   LEDGER_ADDRESS_HASH_KEY="$(node -e "process.stdout.write(require('node:crypto').randomBytes(32).toString('hex'))")" pnpm aws:deploy; echo "exit=$?"
   ```

   Expect, on a database that has ingested an event: stdout `aws:deploy: synthesizing both stacks`
   and `aws:deploy: migrating the database` (preceded, with no app stack, by
   `aws:deploy: no app stack is deployed; the contract-step check is skipped`), then stderr exactly
   `aws:deploy: refused: LEDGER_ADDRESS_HASH_KEY's key_id differs from the stored address hashes' key_id; deploy with the key they were made under`
   and `exit=1`, before any `deploying` line, so no stack or secret changed. On a fresh Neon
   project no hash exists yet and the deploy would not refuse: skip the step here, record `n/a`,
   and walk it after C6, once the verify send's hashes exist.
   **Ask-first:** a `pnpm aws:deploy` run (it reads the stacks and migrates the database before it
   refuses).

4. **Deploy both stacks, confirm the alert subscriptions, and point the shell at the deploy.**

   ```bash
   pnpm aws:deploy; echo "exit=$?"
   export LEDGER_URL=<api url>
   read -rs LEDGER_TOKEN && export LEDGER_TOKEN
   pnpm -s ledger token current --json; echo "exit=$?"
   ```

   Expect: the deploy prints exactly these lines (CDK's own output goes to a temp log, never the
   terminal), then `exit=0`:

   ```text
   aws:deploy: no app stack is deployed; the contract-step check is skipped
   aws:deploy: synthesizing both stacks
   aws:deploy: migrating the database
   aws:deploy: deploying LedgerGuardrails
   aws:deploy: deploying LedgerApp
   aws:deploy: ledger/database written
   aws:deploy: LEDGER_DEPLOY_WEBHOOK_SECRETS is unset; ledger/webhook-signing-secrets keeps its stored value
   aws:deploy: bootstrap operate token (shown once; store it now): ldg_<…>
   aws:deploy: api url <api url>
   aws:deploy: ingest url <api url>/webhooks/resend
   aws:deploy: KillSwitchArmed true
   aws:deploy: done
   ```

   Guardrails deploys before the app, and the guardrails stack deploying in us-east-2 is the first
   half of AWS-U01. The owner stores the bootstrap token (it is printed once), pastes it at the
   `read -rs` prompt, and uses `<api url>` for `LEDGER_URL`. Two `AWS Notification - Subscription
   Confirmation` emails reach `LEDGER_ALERT_EMAIL`, one per topic; the owner confirms both
   ([CBL-03](../../../.ai/check-before-launch.md#public-repo-hygiene)). `token current` prints
   `"name": "bootstrap"` and `"scope": "operate"`, `exit=0`. A failure instead ends on stderr
   `aws:deploy: refused: <reason>` or `aws:deploy: failed: <reason>`, exit `1`, the reason naming a
   variable or a step, never a value (a missing input reads, for example,
   `aws:deploy: refused: LEDGER_DEPLOY_DATABASE_URL must be set to the database's direct postgres:// URL, owner credentials`).
   **Ask-first:** the first deploy: creates both stacks and every AWS resource in them.

5. **Deploy again with no change.**

   ```bash
   pnpm aws:deploy; echo "exit=$?"
   ```

   Expect: exactly, then `exit=0`:

   ```text
   aws:deploy: synthesizing both stacks
   aws:deploy: migrating the database
   aws:deploy: deploying LedgerGuardrails
   aws:deploy: deploying LedgerApp
   aws:deploy: ledger/database unchanged
   aws:deploy: LEDGER_DEPLOY_WEBHOOK_SECRETS is unset; ledger/webhook-signing-secrets keeps its stored value
   aws:deploy: api url <api url>
   aws:deploy: ingest url <api url>/webhooks/resend
   aws:deploy: KillSwitchArmed true
   aws:deploy: done
   ```

   No token line: the bootstrap row exists, so nothing is inserted or printed (Ships 5).
   **Ask-first:** a `pnpm aws:deploy` run.

## Path G — trip drill and re-arm: alarm → kill switch → stopped stack → restored

**Walked as:** [Operator](../../../.ai/about.md#target-personas)

1. **Run the alarm drill.**

   ```bash
   pnpm aws:trip-drill; echo "exit=$?"
   ```

   Expect: exactly these lines, the seconds the run's own, then `exit=0`:

   ```text
   aws:trip-drill: step 1: usage-trip alarm forced to ALARM
   aws:trip-drill: step 2: tripped after <s>s (mapping paused, every function at 0, throttle at the stop values)
   aws:trip-drill: step 3: unsigned ingest requests answered 429 429 429 429 429
   aws:trip-drill: step 4: the kill switch's Errors alarm reached ALARM after <s>s
   aws:trip-drill: step 5: restored after <s>s
   aws:trip-drill: summary: trip <s>s; ingest 429 429 429 429 429; Errors alarm <s>s; restore <s>s
   aws:trip-drill: then: ledger reconcile → slice 4
   aws:trip-drill: done
   ```

   Step 2 reaching the stop throttle proves the kill switch's stage update was accepted (AWS-U11);
   step 3's five `429`s settle AWS-U02's status half (any other code adds
   `aws:trip-drill: warning: not every request was throttled; AWS-U02 expects 429`). The billing
   half is read later in Cost Explorer (owner). The inbox receives a `Ledger kill switch tripped`
   email whose body is the report (`"action": "trip"`). With `KillSwitchArmed false` the drill
   instead refuses:
   `aws:trip-drill: refused: the kill switch is not armed (KillSwitchArmed false); deploy with LEDGER_KILL_SWITCH=on first`.
   **Ask-first:** trips the deployed stack for real; ingest answers `429` until step 5.

2. **Read health while the stack is tripped.**

   ```bash
   pnpm -s ledger health --json; echo "exit=$?"
   ```

   Expect, run in a second terminal with B4's deployed values, after G1 prints `step 2` and
   before it prints `step 5` (step 4 waits a minute or more for its alarm): exactly, then `exit=1`:

   ```json
   {
     "error": {
       "code": "api_unavailable",
       "message": "The Ledger API did not answer with a Ledger response.",
       "hint": "Check `LEDGER_URL`. The kill switch may be tripped: check the budget alerts, then run the re-arm script.",
       "docs": "https://github.com/phillippelevidad/resend-application/blob/main/docs/runbook.md#api_unavailable"
     }
   }
   ```

   The throttled HTTP API answers with no Ledger body, which the SDK reads as `api_unavailable`
   (CBL-17).
   **Ask-first:** inside G1's trip window, which G1's approval opens.

3. **Reconcile what the trip window held back → [slice 4](../../../.ai/build-checklist.md#4--recovery).**

   ```bash
   pnpm -s ledger reconcile; echo "exit=$?"
   ```

   Expect today: stderr `error: unknown command 'reconcile'`, `exit=2`. The drill sent only
   unsigned requests, so this walk loses nothing; after a real trip the re-arm prints the same
   `then: ledger reconcile → slice 4`.
   **Ask-first:** a real `ledger reconcile` replays events on the owner's webhook (RS-16).

4. **Deploy the drill budget and wait for it to trip the stack.**

   ```bash
   pnpm aws:deploy --budget-drill; echo "exit=$?"
   ```

   Expect: the lines of B5, then `exit=0`. Then, on AWS Budgets' clock (a refresh takes hours,
   AWS-34), an AWS Budgets notification naming `LedgerGuardrails-drill` reaches
   `LEDGER_ALERT_EMAIL`, followed by a `Ledger kill switch tripped` email. That settles AWS-U01.
   While tripped, G2's command answers `api_unavailable` again and `pnpm aws:deploy` refuses with
   `aws:deploy: refused: the kill switch has tripped the stack (the worker's reserved concurrency reads 0); run pnpm aws:rearm first`.
   The walk waits here: G5 runs once both emails have arrived, and path T only after G6.
   **Ask-first:** deploys the drill budget, which then trips the whole stack.

5. **Re-arm after the budget trip.**

   ```bash
   pnpm aws:rearm; echo "exit=$?"
   pnpm -s ledger health; echo "exit=$?"
   ```

   Expect: the re-arm prints, then `exit=0`:

   ```text
   aws:rearm: restored: <changed items, among them concurrency:LedgerApp-ingest, concurrency:LedgerApp-worker, concurrency:LedgerApp-api, event_source, default_throttle>
   aws:rearm: event source <enabled or changing>
   aws:rearm: 3 function(s) without reserved concurrency; throttle rate 100, burst 200
   aws:rearm: month-to-date actual spend <amount> of <limit> USD
   aws:rearm: then: ledger reconcile → slice 4
   aws:rearm: done
   ```

   When the actual spend is at or above the limit it also prints
   `aws:rearm: warning: actual spend is at or above the budget, which does not trip again this month (AWS-34); until next month only the usage trip remains re-armable`.
   Health then prints its four lines with `worker      enabled` (or `changing` for a few seconds)
   and `exit=0`.
   **Ask-first:** changes the deployed stack's concurrency, mapping and throttle.

6. **Deploy without the flag, and check the drill budget is gone.**

   ```bash
   pnpm aws:deploy; echo "exit=$?"
   aws budgets describe-budgets --account-id "$(aws sts get-caller-identity --query Account --output text)" --query 'Budgets[].BudgetName' --output text
   ```

   Expect: the lines of B5 and `exit=0`; then exactly `LedgerGuardrails-monthly`, with no
   `LedgerGuardrails-drill`. The account id is used inside the command only, never printed.
   **Ask-first:** a `pnpm aws:deploy` run (removes the drill budget).

## Path T — teardown: refuses nothing queued, destroys in order, leaves nothing billable

**Walked as:** [Operator](../../../.ai/about.md#target-personas)

1. **Tear both stacks down.**

   ```bash
   pnpm aws:teardown; echo "exit=$?"
   ```

   Expect: exactly, then `exit=0`:

   ```text
   aws:teardown: queue 0 visible, 0 in flight; dlq 0 visible, 0 in flight
   aws:teardown: destroying LedgerApp
   aws:teardown: destroying LedgerGuardrails
   aws:teardown: <n> secret(s) pending deletion, not billed (AWS-11)
   aws:teardown: outside AWS: delete the Resend webhook that points at the ingest URL (dashboard, or DELETE /webhooks/{id})
   aws:teardown: outside AWS, optional: delete the Neon project (recoverable for 7 days)
   aws:teardown: done
   ```

   No `leftover` line: the post-destroy listing found nothing billable (Ships 9). No webhook exists
   yet, and the Neon project MUST stay: T3 proves the bootstrap row survives. Had the queue or the
   DLQ held a message, it would instead refuse on stderr with
   `aws:teardown: refused: the source queue or the DLQ holds messages that are not in webhook_events yet; let the worker drain them, or pass --discard-queued to lose them`.
   Never pass `--discard-queued` in this walk.
   **Ask-first:** destroys both stacks.

2. **List the two secrets the app stack held.**

   ```bash
   aws secretsmanager list-secrets --include-planned-deletion --filters Key=description,Values=ledger/ --query 'SecretList[].[Description,DeletedDate]' --output text
   ```

   Expect: either two lines, each a `ledger/database: …` or `ledger/webhook-signing-secrets: …`
   description followed by a deletion date (a recovery window, matching T1's `2 secret(s)`), or
   nothing (deleted at once, T1's `0 secret(s)`). Record which: it settles AWS-U06 in
   [aws.md](../../../.ai/aws.md#unverified). Either way nothing is billed (AWS-11).

3. **Redeploy, then issue one more `operate` token.**

   ```bash
   pnpm aws:deploy; echo "exit=$?"
   pnpm aws:deploy --issue-operate-token walk-operate; echo "exit=$?"
   export LEDGER_URL=<new api url>
   pnpm -s ledger token current --json; echo "exit=$?"
   ```

   Expect: the first deploy prints the lines of B4 without the `bootstrap operate token` line
   (`no app stack is deployed; the contract-step check is skipped` and `ledger/database written`
   included), `exit=0`: the bootstrap row survived in Neon. The second prints the lines of B5 plus
   `aws:deploy: operate token walk-operate (shown once; store it now): ldg_<…>`, `exit=0`. The API
   URL is new; `token current`, still with B4's bootstrap token, prints `"name": "bootstrap"`,
   `exit=0`. The teardown deleted both SNS subscriptions with their topics: confirm the two new
   confirmation emails (CBL-03).
   **Ask-first:** two `pnpm aws:deploy` runs (recreate both stacks).

## Path C — connect the webhook and verify: a real Resend event lands in the deployed ledger

**Walked as:** [Application developer](../../../.ai/about.md#target-personas)

1. **Create the production webhook for the ingest URL (owner-run).**

   ```bash
   export "$(grep '^RESEND_API_KEY=' .env.local)"
   curl -s -X POST 'https://api.resend.com/webhooks' -H "Authorization: Bearer $RESEND_API_KEY" \
     -H 'Content-Type: application/json' \
     -d '{"endpoint":"<new api url>/webhooks/resend","events":["email.scheduled","email.sent","email.delivered","email.delivery_delayed","email.bounced","email.failed","email.suppressed","email.complained","email.opened","email.clicked"]}'
   ```

   Expect: a JSON body carrying the webhook's `id` and `signing_secret`
   ([RS-13](../../../.ai/resend.md#facts)), seen only in the owner's terminal and never pasted
   into a transcript or run file (RS-05). The dashboard's webhook form does the same. The owner
   keeps the webhook id outside the repo (CBL-10).
   **Ask-first:** creates a webhook on the owner's Resend account.

2. **Put the signing secret in `LEDGER_DEPLOY_WEBHOOK_SECRETS` (owner-run).**

   ```bash
   grep -o '^LEDGER_DEPLOY_WEBHOOK_SECRETS=' .env.local
   ```

   Expect: after the owner adds `LEDGER_DEPLOY_WEBHOOK_SECRETS=<signing_secret>` to `.env.local`
   in an editor, the `grep` prints exactly `LEDGER_DEPLOY_WEBHOOK_SECRETS=`, the name only.
   **Ask-first:** owner-run, because it handles the signing secret.

3. **Deploy, writing the secret to Secrets Manager.**

   ```bash
   pnpm aws:deploy; echo "exit=$?"
   ```

   Expect: the lines of B5 with `aws:deploy: ledger/webhook-signing-secrets written` in place of
   the `LEDGER_DEPLOY_WEBHOOK_SECRETS is unset` line, then `exit=0`. The secret's value passes
   through no CDK template or Lambda variable (CBL-01). A malformed entry instead refuses with
   `aws:deploy: refused: LEDGER_DEPLOY_WEBHOOK_SECRETS must be comma-separated whsec_ signing secrets`.
   **Ask-first:** a `pnpm aws:deploy` run (writes the secret).

4. **Send one test email.**

   ```bash
   export "$(grep '^RESEND_API_KEY=' .env.local)"
   curl -s -w '\n%{http_code}\n' -X POST 'https://api.resend.com/emails' \
     -H "Authorization: Bearer $RESEND_API_KEY" -H 'Content-Type: application/json' \
     -d '{"from":"onboarding@resend.dev","to":["delivered@resend.dev"],"subject":"Ledger verify send","html":"<p>walk</p>"}'
   ```

   Expect: a JSON body carrying the new email's `id`, then `200`
   ([Send Email](https://resend.com/docs/api-reference/emails/send-email); test addresses are exempt
   from the own-address rule, [RS-42](../../../.ai/resend.md#facts)). Keep the id as `<email_id>`.
   **Ask-first:** one live send from the owner's Resend account (counts against quota, RS-32).

5. **Read the email back from the deployed ledger.**

   ```bash
   pnpm -s ledger email <email_id> --json; echo "exit=$?"
   ```

   Expect, once Resend has delivered both events (rerun for up to a minute; until then it exits
   `1` with `"code": "email_not_found"`): `exit=0` and

   ```json
   {
     "object": "email",
     "email_id": "<email_id>",
     "status": "delivered",
     "from_masked": "onb*******@r*****.d**",
     "subject_masked": "Le**** ve**** s***",
     "open_count": 0,
     "click_count": 0,
     "first_opened_at": null,
     "first_clicked_at": null,
     "last_event_at": "<delivered_at>",
     "event_count": 2,
     "recipients": [
       {
         "address_masked": "del******@r*****.d**",
         "status": "delivered",
         "status_at": "<delivered_at>",
         "bounce_type": null,
         "bounce_sub_type": null
       }
     ],
     "timeline": [
   ```

   followed by two entries, `"type": "email.sent"` then `"type": "email.delivered"`, each with its
   `"svix_id": "msg_<…>"` ([RS-39](../../../.ai/resend.md#facts)).
   → **Why it matters.** Ships 12, the card's verify stage: a real Resend event through deployed
   ingest, SQS and the worker into Neon.

6. **Check the queue and DLQ drained, then read how ingest saw the body.**

   ```bash
   pnpm -s ledger health; echo "exit=$?"
   aws logs filter-log-events --log-group-name /ledger/LedgerApp-ingest --filter-pattern '"ingest.request_decoded"' --query 'events[].message' --output text
   ```

   Expect: exactly

   ```text
   queue       0 visible, 0 in flight, oldest —
   dlq         0 visible, 0 in flight
   worker      enabled
   database    reachable, <size> of 1.0 GB
   exit=0
   ```

   then one message per delivery holding `"message":"ingest.request_decoded"` and
   `"body_base64_count":<0 or 1>`, with no field outside the
   [log fields](../../../.ai/data-modeling.md#log-fields) (no svix id, no body). `1` means API
   Gateway base64-encodes Resend's body, `0` that it passes it plain: record it, which settles
   AWS-U04 in [aws.md](../../../.ai/aws.md#unverified).

## Path D — support lookup, deployed: the verify send through `ledger email` and `ledger recipient`

**Walked as:** [Support / on-call engineer](../../../.ai/about.md#target-personas)
([J2](../../../.ai/features.md#j2--support-lookup))

1. **Read the verify send in the human layout.**

   ```bash
   pnpm -s ledger email <email_id>; echo "exit=$?"
   ```

   Expect: stdout

   ```text
   email       <email_id>
   status      delivered
   from        onb*******@r*****.d**
   subject     Le**** ve**** s***
   events      2, last <delivered_at>
   opens       0
   clicks      0

   recipients
     del******@r*****.d**   delivered   <delivered_at>

   timeline
     <sent_at>        email.sent        msg_<…>
     <delivered_at>   email.delivered   msg_<…>
   exit=0
   ```

   Columns are space-padded to their widest cell plus three spaces. Both real timestamps are 24
   characters wide, so each is followed by exactly three spaces.

2. **Look up the recipient by address.**

   ```bash
   pnpm -s ledger recipient delivered@resend.dev; echo "exit=$?"
   pnpm -s ledger recipient delivered@resend.dev | grep -c 'resend\.dev'
   ```

   Expect: exactly

   ```text
   recipient        del******@r*****.d**
   deliverability   ok
   since            <delivered_at>
   caused by        <email_id>
   exit=0
   ```

   and the `grep` prints `0`: the typed address is echoed only as the API's mask.

## Path E — operate the deployed pipeline: auth at the edge, health, resume, the database checks

**Walked as:** [Operator](../../../.ai/about.md#target-personas)

1. **Call health with no token.**

   ```bash
   curl -s -w '\n%{http_code}\n' "$LEDGER_URL/health"
   ```

   Expect: exactly

   ```text
   {"error":{"code":"unauthorized","message":"Bearer token missing, malformed, bad-tag, unknown or revoked.","hint":"Set `LEDGER_TOKEN` to an active token.","docs":"https://github.com/phillippelevidad/resend-application/blob/main/docs/runbook.md#unauthorized"}}
   401
   ```

2. **Call health with a well-formed token whose tag is wrong.**

   ```bash
   BAD_TAG_TOKEN="ldg_$(printf '%064d' 0)_$(printf '%064d' 0)"
   curl -s -w '\n%{http_code}\n' "$LEDGER_URL/health" -H "authorization: Bearer $BAD_TAG_TOKEN"
   ```

   Expect: the same body as E1, then `401`. The tag check runs before any database connection
   (D18), so a forged token costs no Neon connection.

3. **Read health as JSON.**

   ```bash
   pnpm -s ledger health --json; echo "exit=$?"
   ```

   Expect: A3's document with `"state": "enabled"`, `"reachable": true`, a numeric
   `"storage_bytes"` and `"storage_limit_bytes": 1000000000`, queue and DLQ at `0`, then `exit=0`.
   The counts now come from SQS and the state from the worker's event source mapping.

4. **Ask the worker to resume.**

   ```bash
   pnpm -s ledger worker resume; echo "exit=$?"
   ```

   Expect: exactly `worker      enabled (already enabled)`, then `exit=0`. A paused source would
   read `worker      changing (resumed)`; a failed probe exits `1` with stderr
   `The database is unreachable or at its storage limit, so the event source stays paused.` and its
   hint. Pausing it needs a deployed database outage → [slice 3](../../../.ai/build-checklist.md#3--operations-and-evidence-on-aws).

5. **Check the role timeouts, the lock serialization and the idle reconnect on Neon.**

   ```bash
   pnpm aws:db-check --email-id <email_id> --idle-minutes 6; echo "exit=$?"
   ```

   Expect: after about seven minutes, exactly, then `exit=0`:

   ```text
   aws:db-check: PG-U06 idle_in_transaction_session_timeout 5s (expected 5s)
   aws:db-check: PG-U06 lock_timeout 10s (expected 10s)
   aws:db-check: PG-U06 honored through the pooled URL
   aws:db-check: PG-U02 the second transaction waited <ms> ms for the first's lock (held 2000 ms): serialized
   aws:db-check: PG-U04 idling 6 minutes
   aws:db-check: PG-U04 the pool answered after 6 minutes idle
   aws:db-check: done
   ```

   `<ms>` is at least `1500`. PG-U04 may instead read
   `aws:db-check: PG-U04 the query after 6 minutes idle failed: <error_name> (connection-class: yes)`,
   which is safe (a connection error is retryable, D15): record the line. A value other than
   `honored` or `serialized` is recorded as observed and settles PG-U06 or PG-U02 negatively in
   [integrations.md](../../../.ai/integrations.md#unverified). It writes nothing.
   **Ask-first:** reads the deployed database secret and connects to Neon through the pooled URL.

## Path F — reviewer access: a `read` token can look, cannot operate, and dies on revoke

**Walked as:** [Reviewer](../../../.ai/about.md#target-personas), the Operator issuing and revoking

1. **As the Operator, issue the reviewer a `read` token.**

   ```bash
   pnpm -s ledger token create --name review-walk --scope read; echo "exit=$?"
   ```

   Expect: A5's layout with `name        review-walk` and `scope       read`, `exit=0`, and the
   stderr notice `ledger: this is the only time the token is shown; store it now.` Keep the
   `secret` with `read -rs REVIEW_TOKEN && export REVIEW_TOKEN`, and `<review_id>` from the
   `token` line ([CBL-20](../../../.ai/check-before-launch.md#public-repo-hygiene)).

2. **As the reviewer, ask who the token is.**

   ```bash
   LEDGER_TOKEN="$REVIEW_TOKEN" pnpm -s ledger token current; echo "exit=$?"
   ```

   Expect: exactly

   ```text
   token       <review_id>
   name        review-walk
   scope       read
   created     <created_at>
   exit=0
   ```

3. **As the reviewer, read the verify send.**

   ```bash
   LEDGER_TOKEN="$REVIEW_TOKEN" pnpm -s ledger email <email_id> --json; echo "exit=$?"
   ```

   Expect: C5's document, `"status": "delivered"`, then `exit=0`: `read` is enough for every read
   operation.

4. **As the reviewer, try two `operate` operations.**

   ```bash
   LEDGER_TOKEN="$REVIEW_TOKEN" pnpm -s ledger token list --json; echo "exit=$?"
   LEDGER_TOKEN="$REVIEW_TOKEN" pnpm -s ledger worker resume; echo "exit=$?"
   ```

   Expect: first exactly, then `exit=1`:

   ```json
   {
     "error": {
       "code": "forbidden",
       "message": "The token is valid but lacks the scope this operation needs.",
       "hint": "Use an `operate` token, or ask its owner for one.",
       "docs": "https://github.com/phillippelevidad/resend-application/blob/main/docs/runbook.md#forbidden"
     }
   }
   ```

   then stdout holds only `exit=1` and stderr is exactly

   ```text
   The token is valid but lacks the scope this operation needs.
   hint: Use an `operate` token, or ask its owner for one.
   ```

5. **As the Operator, revoke `review-walk` and `walk-operate`, then retry the revoked token.**

   ```bash
   pnpm -s ledger token list; echo "exit=$?"
   pnpm -s ledger token revoke <review_id>; echo "exit=$?"
   pnpm -s ledger token revoke <walk_operate_id>; echo "exit=$?"
   LEDGER_TOKEN="$REVIEW_TOKEN" pnpm -s ledger token current --json; echo "exit=$?"
   ```

   Expect: the list shows `bootstrap`, `walk-operate` and `review-walk` rows as in A7 (read
   `<walk_operate_id>` from it), `exit=0`; each revoke prints A7's revoke layout with its own name
   and scope and a `revoked` time, `exit=0`; the last command prints exactly, then `exit=1`:

   ```json
   {
     "error": {
       "code": "unauthorized",
       "message": "Bearer token missing, malformed, bad-tag, unknown or revoked.",
       "hint": "Set `LEDGER_TOKEN` to an active token.",
       "docs": "https://github.com/phillippelevidad/resend-application/blob/main/docs/runbook.md#unauthorized"
     }
   }
   ```

   → **Why it matters.** A reviewer's token stops working the moment it is revoked (CBL-20).

## Teardown

The stacks, the bootstrap token and the production webhook stay up (deploy and keep, lens clause 7);
F5 revoked the deployed walk tokens and A7 the local one.

1. **Confirm no walk token is still active on the deploy.**

   ```bash
   pnpm -s ledger token list --json; echo "exit=$?"
   ```

   Expect: `exit=0`; the `data` entries named `review-walk` and `walk-operate` carry a non-null
   `"revoked_at"`, and the only active one is `"name": "bootstrap"`.

2. **Point the shell back at local mode and stop the local stack.**

   ```bash
   unset LEDGER_URL LEDGER_TOKEN WALK_READ_TOKEN REVIEW_TOKEN BAD_TAG_TOKEN RESEND_API_KEY
   pnpm dev:stop; echo "exit=$?"
   ```

   Expect: stdout includes `dev:stop: compose services stopped (the database volume is kept).`, a
   `dev:stop: stopped pid <pid> and its children (<reason>)` line for this repo's dev server, then
   `dev:stop: port 3200 is free.` and `exit=0`. With the shell values gone, the next local walk reads
   `.env.local` again instead of silently hitting the deploy.

## What this walk cannot reach today

| Not reachable | Carried by |
| --- | --- |
| `ledger reconcile` after a re-arm or a trip (G3); `ledger gaps`, named in the not-found hints | [slice 4](../../../.ai/build-checklist.md#4--recovery) |
| DLQ inspect and redrive; alarms with runbook entries, and the runbook the error `docs` links point at; the burst and `--chaos db-outage` on AWS | [slice 3](../../../.ai/build-checklist.md#3--operations-and-evidence-on-aws) |
| A durable local queue; local DLQ operations | [slice 2B](../../../.ai/build-checklist.md#2b--local-mode-queue-and-docker-compose) |
| MCP tools, so the AI agent persona walks no path | [slice 5](../../../.ai/build-checklist.md#5--mcp-server-and-contract-hardening) |
| A deployed database outage, and with it a paused event source and `ledger worker resume` answering `resumed` (Neon cannot be stopped from the walk) | The Testcontainers outage test ([design.md → Evidence map](design.md#evidence-map)); slice 3's `--chaos db-outage` |
