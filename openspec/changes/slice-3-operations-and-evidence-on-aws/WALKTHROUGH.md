# Slice 3 — walkthrough

What one person does to prove this slice works. Unlike the ~15-minute walks, this one runs the
deployed stack through a burst (about 20 minutes), a database outage (up to about 2 hours: the
10 + 45 + 65 minute bounds) and a poison run (up to about 40 minutes), and an alarm email that only
the owner can see ([design.md → Walkthrough plan](design.md#walkthrough-plan)). Each long run is
already one command; run it in its own terminal and walk the other steps beside it.

**Read this first.** A step that cannot be completed today ends with `→ slice N`, naming the slice
that carries it. A step without such a note that fails is a finding against this slice.

Every `UI surfaces` entry on the
[slice 3 card](../../../.ai/build-checklist.md#3--operations-and-evidence-on-aws) is reached:
`pnpm sim --burst 10000/10s` (C2); `pnpm sim --chaos db-outage` (D2); the `pnpm sim` poison run
(E1); `ledger dlq inspect` (E3, F2, H2); `ledger dlq redrive` (E4, E5, F3, H3); `ledger health`
(C3, D1, D3, D6, E6, T2); the alarm email (D5, E2, owner-observed).

Order: A → B → C → D → E → F → G → H → I, then [Teardown](#teardown) (`T1`–`T3`). Every AWS run
refuses while the DLQ holds a message, so E's redrive (E4) comes before any later AWS run.

## Before you start

```bash
pnpm install
docker info --format '{{.ServerVersion}}'
git status --porcelain --untracked-files=no
grep -o '^[A-Z_]*=' .env.local
grep -o '^[A-Z_]*=' .env.deployed.local
export AWS_PROFILE=ledger AWS_REGION=us-east-2
```

- **Shell:** Bash (Git Bash on Windows), from the repo root. Docker answers with its version (path H
  needs it); `git status` prints nothing (the deploy refuses a tree with tracked changes); both
  `grep`s print names only, never values.
- **Environment variables (names only).** `.env.local`: `DATABASE_URL`, `LEDGER_ADDRESS_HASH_KEY`,
  `LEDGER_TOKEN_TAG_KEY`, `LEDGER_SIMULATOR_SECRET`, `LEDGER_URL`, `LEDGER_TOKEN` (written by
  `pnpm db:setup`); the owner's `LEDGER_DEPLOY_DATABASE_URL`, `LEDGER_DEPLOY_DATABASE_POOLED_URL`,
  `LEDGER_ALERT_EMAIL`, `LEDGER_KILL_SWITCH` (`on`) and, new in this slice, `LEDGER_SIMULATOR` set
  to `on` (the owner's deployment only, [ADR-016](../../../.ai/architecture.md#adr-016--the-simulator-reaches-aws-only-through-an-opt-in-simulator-secret)).
  `.env.deployed.local` (git-ignored, the owner's): `LEDGER_URL` (the deployed `ApiUrl`),
  `LEDGER_TOKEN` (the bootstrap `operate` token), `DATABASE_URL` (the Neon pooled URL with owner
  credentials, which `--poison` needs to own `webhook_events`), and `LEDGER_ADDRESS_HASH_KEY` (the
  deployed hashes' key). `LEDGER_SIMULATOR_SECRET` comes from `.env.local`: the value the deploy
  wrote.
- **Loading the deployed values.** Nothing loads `.env.deployed.local` by itself, and a shell value
  wins over `.env.local`. Bash: `set -a; . ./.env.deployed.local; set +a`. An agent, whose Bash
  guard rejects `.` (K1): `Get-Content .env.deployed.local | Where-Object { $_ -match '^[A-Z_]+=' } | ForEach-Object { $k,$v = $_ -split '=',2; Set-Item "env:$k" $v }`
  in the same PowerShell command as the `pnpm` call, with `$env:AWS_PROFILE='ledger'; $env:AWS_REGION='us-east-2'`
  (K2). Never print the file. Every step from C to G and in the Teardown's T1–T2 runs with the
  deployed values loaded in its terminal: C2, D2, E1 and G1 show the load as their first command;
  repeat it in any new terminal (D3, D4). Before any local step,
  `unset LEDGER_URL LEDGER_TOKEN DATABASE_URL LEDGER_ADDRESS_HASH_KEY`: a leftover `DATABASE_URL`
  would point local mode at Neon, and a leftover `LEDGER_ADDRESS_HASH_KEY` would hash local
  addresses with the deployed key.
- **AWS session:** the SSO session must outlast the next run, because each long run restores in its
  `finally` (D2 about 2 hours, E1 about 45 minutes, C2 about 20 minutes). Run
  `aws sso login --profile ledger` before C, D and E when it is close to expiring.
- **Quota prerequisite (owner op).** The burst needs an account Lambda concurrency quota of at
  least 1,000 (AWS-U05). It read `10` before this slice; an increase to 1,000 was requested in
  Service Quotas and granted on 2026-10-19 ([aws.md → AWS-U05](../../../.ai/aws.md#unverified)), so
  the account now reads `1000`. Below 1,000, C2 refuses before it sends anything (C1).
- **This walk creates:** on AWS, the simulator secret (A2, kept: `LEDGER_SIMULATOR` stays `on`),
  the three new alarms (A2, kept), a raised throttle restored in C2's `finally`, the database secret
  repointed and restored in D2's `finally`, a `Description` on the worker and API functions set and
  cleared in D2; in Neon, the ledger rows of each sim run's namespace (C2, D2, E1, G1; kept, never
  deleted), the transient `ledger_sim_poison` constraint (added and dropped by E1), and the
  `review-dlq` `read` token (F1, revoked in T1). Locally, nothing: H's poison run refuses before it
  sends.
- **Ask-first steps:** A1 (AWS session read), A2 (deploy), A3, B1, B2 (alarm reads), C1 (quota
  read), C2 (burst), C4, D1, D5, E2 (alarm reads), D2 (outage run) and D3–D4 inside it, E1 (poison
  run), G1 (sim through the deployed queue), H4 (reads the stack outputs). There is no live Resend
  write in this walk.

## Path A — deploy: the simulator secret and the new alarms in the owner's deployment

**Walked as:** [Operator](../../../.ai/about.md#target-personas)

1. **Check the AWS session and the simulator flag.**

   ```bash
   aws sts get-caller-identity > /dev/null; echo "sts exit=$?"
   grep -o '^LEDGER_SIMULATOR=on$' .env.local
   ```

   Expect: `sts exit=0` (an expired session instead asks for `aws sso login --profile ledger`),
   then exactly `LEDGER_SIMULATOR=on`.
   **Ask-first:** an AWS call against the owner's account.

2. **Deploy with the simulator on.**

   ```bash
   pnpm aws:deploy; echo "exit=$?"
   ```

   Expect: exactly these lines, then `exit=0`:

   ```text
   aws:deploy: synthesizing both stacks
   aws:deploy: migrating the database
   aws:deploy: deploying LedgerGuardrails
   aws:deploy: deploying LedgerApp
   aws:deploy: ledger/database unchanged
   aws:deploy: LEDGER_DEPLOY_WEBHOOK_SECRETS is unset; ledger/webhook-signing-secrets keeps its stored value
   aws:deploy: ledger/simulator-signing-secret written
   aws:deploy: api url <api url>
   aws:deploy: ingest url <api url>/webhooks/resend
   aws:deploy: KillSwitchArmed true
   aws:deploy: simulator on
   aws:deploy: done
   ```

   The simulator line reads `unchanged` instead of `written` when an earlier deploy already wrote the
   same value; with `LEDGER_DEPLOY_WEBHOOK_SECRETS` set, its line reads
   `aws:deploy: ledger/webhook-signing-secrets unchanged`. No token line: the bootstrap row exists.
   The stderr may carry K3's `sslmode` warning. With `LEDGER_SIMULATOR=on` and no simulator secret,
   it instead refuses before contacting AWS with
   `aws:deploy: refused: LEDGER_SIMULATOR_SECRET must be set to one whsec_ signing secret when LEDGER_SIMULATOR is on`,
   exit `1`. The existing alert subscription receives the new alarms; no new confirmation email.
   **Ask-first:** a `pnpm aws:deploy` run (adds the three alarms, the DLQ IAM and the simulator secret).

3. **List the stacks' alarms.**

   ```bash
   aws cloudwatch describe-alarms --alarm-name-prefix Ledger --query "MetricAlarms[].AlarmName" --output json
   ```

   Expect: exactly these five names:

   ```json
   [
       "LedgerApp-api-5xx",
       "LedgerApp-dlq-depth",
       "LedgerApp-queue-age",
       "LedgerApp-usage-trip",
       "LedgerGuardrails-kill-switch-errors"
   ]
   ```

   **Ask-first:** an AWS read.

## Path B — alarms and the runbook: each alarm names its runbook entry

**Walked as:** [Operator](../../../.ai/about.md#target-personas)

1. **Read the DLQ alarm's description.**

   ```bash
   aws cloudwatch describe-alarms --alarm-names LedgerApp-dlq-depth --query "MetricAlarms[0].AlarmDescription" --output text
   ```

   Expect: exactly
   `The dead-letter queue holds at least one message. Runbook: https://github.com/phillippelevidad/resend-application/blob/main/docs/runbook.md#ledgerapp-dlq-depth`.
   This text is the body line of the alarm email (D18).
   **Ask-first:** an AWS read.

2. **Read every alarm's description.**

   ```bash
   aws cloudwatch describe-alarms --alarm-name-prefix Ledger --query "MetricAlarms[].[AlarmName,AlarmDescription]" --output text
   ```

   Expect: five lines, each the alarm name, a tab, then its description ending
   `. Runbook: https://github.com/phillippelevidad/resend-application/blob/main/docs/runbook.md#<the name in lowercase>`:
   `LedgerApp-api-5xx` → `The HTTP API answered at least one 5xx`; `LedgerApp-dlq-depth` → B1's;
   `LedgerApp-queue-age` → `The oldest message on the source queue is older than 15 minutes`;
   `LedgerApp-usage-trip` → `The HTTP API passed its 15-minute request ceiling and published to the trip topic`;
   `LedgerGuardrails-kill-switch-errors` →
   `The kill switch failed: a budget or usage trip may not have stopped the app stack`. No ARN,
   account id or address in any of them.
   **Ask-first:** an AWS read.

3. **Find the entry each link lands on.**

   ```bash
   grep -n '^### Ledger' docs/runbook.md
   ```

   Expect: five headings, exactly `### LedgerApp-queue-age`, `### LedgerApp-dlq-depth`,
   `### LedgerApp-api-5xx`, `### LedgerApp-usage-trip` and `### LedgerGuardrails-kill-switch-errors`,
   each with its line number. GitHub's anchor for each is the name in lowercase, the anchor B2's
   links carry; open B1's link in a browser and it lands on
   [the entry](../../../docs/runbook.md#ledgerapp-dlq-depth). The links resolve on GitHub once this
   branch is on `main`; before that they answer `404`, and the local file is the entry. The
   agreement of every alarm name with a heading is `infra/src/runbook-links.test.ts` (a gate, not
   walked).

## Path C — the burst (J7): 10,000 events in 10 seconds, nothing lost

**Walked as:** [Application developer](../../../.ai/about.md#target-personas)
([J7](../../../.ai/features.md#j7--burst))

1. **Read the account's Lambda concurrency quota.**

   ```bash
   aws lambda get-account-settings --query 'AccountLimit.ConcurrentExecutions'
   ```

   Expect: one integer, `1000` since the increase granted on 2026-10-19. Below `1000`, the owner
   requests the increase in Service Quotas (us-east-2, Lambda, Concurrent executions) and C2 to C4
   wait for the grant (blocked, owner op). Record the number only, never the account id.
   **Ask-first:** an AWS read.

2. **Run the burst against the deployed stack.**

   ```bash
   set -a; . ./.env.deployed.local; set +a
   pnpm sim --burst 10000/10s; echo "exit=$?"
   ```

   Expect, with the quota at `1000` or more: after pnpm's script banner, these lines, then
   `exit=0`:

   ```text
   sim seed=<seed> namespace=<namespace>
   history emails=<m> events=10000 duplicates=0 shuffled=false
   projection not printed (--burst)
   preflight concurrency=<q> recent_requests=<r> usage_trip_threshold=15000
   throttle raised rate=1200 burst=2400
   sent requests=10000 accepted=10000 duration_s=<d> p50_ms=<x> p99_ms=<y>
   throttle restored rate=100 burst=200
   settled stored=10000/10000 after <s>s
   storage before=<b> after=<a> bytes_per_event=<c> bursts_left=<k>
   invariant 1 pass stored=10000/10000
   invariant 2 pass emails=<m> recipients=<m>
   invariant 3 not checked (slice 6)
   invariant 4 pass (dlq holds exactly the 0 poisoned)
   ```

   Record `<d>`, `<x>`, `<y>` (p99 under 5,000 ms closes RS-U08, D26), `<s>` (the drain),
   `<c>` and `<k>`. With the quota below 1,000 it instead prints the first three lines, then on
   stderr exactly
   `sim: the account's Lambda concurrency quota is <q>; the burst needs at least 1000 (AWS-U05): request an increase in Service Quotas`,
   and `exit=1`, before any `throttle` line: no request sent, no throttle changed. Other refusals
   (stderr, exit `1`, before the `throttle raised` line):
   `sim: <n> requests in the last 15 minutes plus the burst would trip LedgerApp-usage-trip; wait and retry`,
   and the guard's (D23), such as `sim: the DLQ holds <n> messages; inspect and redrive them first`.
   A throttle a trip changed mid-burst prints `throttle left at <rate>/<burst>: changed during the burst (a trip?)`
   in place of the restore line.
   **Ask-first:** raises the stage throttle and sends 10,000 requests to the deployed stack
   (card `Ops`: the owner watches the budget during the burst).

3. **Check the queue drained.**

   ```bash
   pnpm -s ledger health; echo "exit=$?"
   ```

   Expect: exactly

   ```text
   queue       0 visible, 0 in flight, oldest —
   dlq         0 visible, 0 in flight
   worker      enabled
   database    reachable, <size> of 1.0 GB
   exit=0
   ```

4. **Read the usage trip and the queue age after the burst.**

   ```bash
   aws cloudwatch describe-alarms --alarm-names LedgerApp-usage-trip LedgerApp-queue-age --query "MetricAlarms[].[AlarmName,StateValue]" --output text
   ```

   Expect: two lines, each a name, a tab, its state: `LedgerApp-queue-age` with `OK` or `ALARM`,
   and `LedgerApp-usage-trip` with exactly `OK`, so no
   usage-trip email and no trip. The queue age reads `ALARM` only when C2's `settled … after <s>s`
   passed 900 s; then the owner records that email too (the runbook calls it expected after a burst).
   **Ask-first:** an AWS read.

## Path D — database outage: ingest keeps answering, the worker pauses, nothing reaches the DLQ

**Walked as:** [Operator](../../../.ai/about.md#target-personas)

1. **Confirm the queue-age alarm and the worker start clean.**

   ```bash
   aws cloudwatch describe-alarms --alarm-names LedgerApp-queue-age --query "MetricAlarms[0].StateValue" --output text
   pnpm -s ledger health; echo "exit=$?"
   ```

   Expect: exactly `OK` (after C, wait until it returns to `OK`: D2 refuses an `ALARM` left by the
   burst, before any fault, with
   `sim: LedgerApp-queue-age already reads ALARM; wait for it to return to OK, then rerun` and
   `exit=1`, nothing changed), then C3's four lines with `worker      enabled`, `exit=0`.
   **Ask-first:** an AWS read.

2. **Run the outage, in its own terminal.**

   ```bash
   set -a; . ./.env.deployed.local; set +a
   pnpm sim --chaos db-outage; echo "exit=$?"
   ```

   Expect: after pnpm's banner, `sim seed=<seed> namespace=<namespace>`,
   `history emails=<m> events=<n> duplicates=0 shuffled=false` and the projection JSON (masks only),
   then these lines over up to about two hours, and `exit=0`:

   ```text
   chaos db-outage: database repointed, worker and api recycled
   sent requests=<n> accepted=<n> first_attempt_200=<n>
   worker paused after <s>s
   queue-age alarm ALARM after <m>m; dlq depth 0
   chaos db-outage: database restored, worker and api recycled
   resume: pnpm -s ledger worker resume, or wait for the hourly resume
   worker enabled after <m>m
   settled stored=<n>/<n> after <s>s
   invariant 1 pass stored=<n>/<n>
   invariant 2 pass emails=<m> recipients=<r>
   invariant 3 not checked (slice 6)
   invariant 4 pass (dlq holds exactly the 0 poisoned)
   ```

   `first_attempt_200` equal to `requests` is Ships 5's ingest half (ADR-001). `worker paused after <s>s`
   settles AWS-U15: the configuration update reached new execution environments. A worker that
   never pauses instead prints `sim: the worker did not pause within 10m (AWS-U15)` on stderr, the
   restore line, and exits `1`. A paused source at the start refuses with
   `sim: the worker's event source reads paused; resume it with pnpm -s ledger worker resume first`.
   If the restore fails it prints `sim: the database secret was not restored; run pnpm aws:deploy, which rewrites it`:
   run `pnpm aws:deploy` (Ask-first) before anything else.
   **Ask-first:** repoints the deployed database secret, recycles the worker and API functions, and
   sends the history to the deployed stack.

3. **Read health while the outage holds.**

   ```bash
   pnpm -s ledger health; echo "exit=$?"
   ```

   Expect, in a second terminal with the deployed values loaded, after D2 prints
   `worker paused after <s>s` and before it prints `queue-age alarm ALARM …`: exactly

   ```text
   queue       <v> visible, <f> in flight, oldest <age>s
   dlq         0 visible, 0 in flight
   worker      paused
   database    unreachable
   exit=0
   ```

   with `<v>` + `<f>` above 0. Health answers on the token's tag alone during an outage (D18 of
   slice 2), so it reports the outage instead of failing. Any other command here (`ledger dlq
   inspect`, `ledger email`) answers `database_unavailable`, exit `1`: avoid them in this window,
   since each `503` also counts toward `LedgerApp-api-5xx`.
   **Ask-first:** inside D2's outage, which D2's approval opens.

4. **Resume the worker after the restore.**

   ```bash
   pnpm -s ledger worker resume; echo "exit=$?"
   ```

   Expect, run once D2 prints `resume: pnpm -s ledger worker resume, or wait for the hourly resume`
   and before `worker enabled after <m>m`: `worker      changing (resumed)` (or
   `worker      enabled (resumed)` once the mapping has settled), then `exit=0`; D2 then prints
   `worker enabled after <m>m` within a minute. If the hourly resume came first it reads
   `worker      enabled (already enabled)`: record which.
   **Ask-first:** re-enables the deployed worker's event source, inside D2's run.

5. **Record the queue-age alarm email (owner).**

   ```bash
   aws cloudwatch describe-alarm-history --alarm-name LedgerApp-queue-age --history-item-type StateUpdate --max-items 3 --query "AlarmHistoryItems[].[Timestamp,HistorySummary]" --output text
   ```

   Expect: a line holding `<timestamp>`, a tab and `Alarm updated from OK to ALARM`, within the hour
   of D2's `sent` line.
   The owner records the arrival time of the email whose subject starts
   `ALARM: "LedgerApp-queue-age"` and whose body carries B2's queue-age description with its runbook
   link; only the owner can observe it (Ships 5 waits for that time). No email arrives for the
   return to `OK` (D15).
   **Ask-first:** an AWS read.

6. **Check the queue drained after the resume.**

   ```bash
   pnpm -s ledger health; echo "exit=$?"
   ```

   Expect: C3's four lines exactly (`queue       0 visible, 0 in flight, oldest —`,
   `dlq         0 visible, 0 in flight`, `worker      enabled`,
   `database    reachable, <size> of 1.0 GB`), `exit=0`.

## Path E — poison and redrive (J4): one bad event waits in the DLQ, then applies once

**Walked as:** [Operator](../../../.ai/about.md#target-personas)
([J4](../../../.ai/features.md#j4--poison-message--redrive))

1. **Run the poison run, in its own terminal.**

   ```bash
   set -a; . ./.env.deployed.local; set +a
   pnpm sim --poison 1; echo "exit=$?"
   ```

   Expect: after pnpm's banner, the seed, history and projection lines, then over about 30 minutes
   (the sixth receive, after five 360 s visibility timeouts), then `exit=0`:

   ```text
   poison count=1 svix_ids=simpoison_<namespace>_0 email_ids=<poisoned email_id>
   sent requests=<n> accepted=<n>
   others stored <n-1>/<n-1> exactly once (1 poisoned wait in the DLQ)
   invariant 1 not checked (1 poisoned events wait in the DLQ)
   invariant 2 not checked (1 poisoned events wait in the DLQ)
   invariant 4 pass (dlq holds exactly the 1 poisoned)
   poison fixed; next: pnpm -s ledger dlq inspect, then pnpm -s ledger dlq redrive; the depth returns to 0 in pnpm -s ledger health
   ```

   Keep `<namespace>` and `<poisoned email_id>`. A `DATABASE_URL` that is the runtime role's instead
   refuses with `sim: --poison needs DATABASE_URL to own webhook_events (the owner's pooled URL, not the runtime role's)`,
   exit `1`, nothing sent. The fault is a constraint on `webhook_events` that only `simpoison_`
   ids fail; `poison fixed` means it is dropped again.
   **Ask-first:** adds and drops a transient constraint on the deployed database, and sends the
   history to the deployed stack.

2. **Record the DLQ alarm email (owner).**

   ```bash
   aws cloudwatch describe-alarm-history --alarm-name LedgerApp-dlq-depth --history-item-type StateUpdate --max-items 3 --query "AlarmHistoryItems[].[Timestamp,HistorySummary]" --output text
   ```

   Expect: a line holding `<timestamp>`, a tab and `Alarm updated from OK to ALARM`, after E1's move
   to the DLQ. The
   owner records the email whose subject starts `ALARM: "LedgerApp-dlq-depth"` and whose body
   carries B1's description; only the owner can observe it. About 15 minutes after E1's send, an
   `ALARM: "LedgerApp-queue-age"` email arrives first: the poisoned message ages the queue while it
   waits out its receives (AWS-22). It is this run's, not D's; do not record it for Ships 5.
   **Ask-first:** an AWS read.

3. **Inspect the DLQ, as a human and as JSON.**

   ```bash
   pnpm -s ledger dlq inspect; echo "exit=$?"
   pnpm -s ledger dlq inspect --json; echo "exit=$?"
   pnpm -s ledger dlq inspect --json | grep -c 'resend\.dev'
   pnpm -s ledger dlq inspect --limit 11 --json; echo "exit=$?"
   ```

   Expect: stdout exactly

   ```text
   dlq         1 message(s), showing 1
   simpoison_<namespace>_0  <type>  email <poisoned email_id>  created <created_at>  enqueued <enqueued_at>  receives <count>
   exit=0
   ```

   and stderr exactly
   `why each failed is in the worker logs under its svix_id (runbook: LedgerApp-dlq-depth)`.
   Then one JSON document, `exit=0`:

   ```json
   {
     "object": "list",
     "has_more": false,
     "depth": 1,
     "data": [
       {
         "object": "dlq_message",
         "svix_id": "simpoison_<namespace>_0",
         "type": "<type>",
         "email_id": "<poisoned email_id>",
         "event_created_at": "<created_at>",
         "enqueued_at": "<enqueued_at>",
         "receive_count": <count>
       }
     ]
   }
   ```

   with exactly those keys and no address, subject or payload; the `grep` prints `0`. The
   `--limit 11` call prints, then `exit=1`:

   ```json
   {
     "error": {
       "code": "validation_failed",
       "message": "limit must be an integer from 1 to 10.",
       "hint": "Fix the field the message names, then retry.",
       "docs": "https://github.com/phillippelevidad/resend-application/blob/main/docs/runbook.md#validation_failed"
     }
   }
   ```

   Inspecting never removes or hides a message: a second inspect shows the same item.

4. **Redrive the DLQ.**

   ```bash
   pnpm -s ledger dlq redrive; echo "exit=$?"
   ```

   Expect: exactly
   `redrive     started: 1 message(s) moving back to the queue; watch the dlq depth with ledger health`,
   then `exit=0`. It returns at once, with nothing to poll.

5. **Ask for a second redrive straight away.**

   ```bash
   pnpm -s ledger dlq redrive --json; echo "exit=$?"
   ```

   Expect, while E4's task runs, exactly, then `exit=1`:

   ```json
   {
     "error": {
       "code": "redrive_in_progress",
       "message": "A DLQ redrive task is already running; SQS allows one per queue.",
       "hint": "Wait for the DLQ depth in `ledger health` to fall.",
       "docs": "https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-configure-dead-letter-queue-redrive.html"
     }
   }
   ```

   If the task already finished, it instead prints
   `{ "object": "dlq_redrive", "status": "empty", "depth": 0 }` (as an indented document), `exit=0`.
   Either is correct; record which. SQS never runs two tasks at once (AWS-21).

6. **Watch the DLQ depth return to 0.**

   ```bash
   pnpm -s ledger health; echo "exit=$?"
   ```

   Expect, rerun for up to a few minutes: C3's four lines exactly, `dlq         0 visible, 0 in flight`
   and `queue       0 visible, 0 in flight, oldest —` among them, `exit=0`. The DLQ alarm returns to
   `OK` on its own.

7. **Read the poisoned email back.**

   ```bash
   pnpm -s ledger email <poisoned email_id> --json; echo "exit=$?"
   ```

   Expect: `exit=0` and a `timeline` entry with `"svix_id": "simpoison_<namespace>_0"`, exactly one:
   the redriven event committed once under its new SQS message id (ADR-004, AWS-21), and its email's
   projection now includes it.
   → **Why it matters.** Ships 6: the poison waits aside while the others commit (invariant 4), and
   a redrive after the fix returns the depth to 0.

## Path F — reviewer access: a `read` token can inspect the DLQ but not redrive it

**Walked as:** [Reviewer](../../../.ai/about.md#target-personas), the Operator issuing the token

1. **As the Operator, issue the reviewer a `read` token.**

   ```bash
   pnpm -s ledger token create --name review-dlq --scope read; echo "exit=$?"
   ```

   Expect: stdout exactly

   ```text
   token       <review_id>
   name        review-dlq
   scope       read
   created     <created_at>
   secret      ldg_<…>
   exit=0
   ```

   and stderr exactly `ledger: this is the only time the token is shown; store it now.` Keep the
   secret in the shell only: `read -rs REVIEW_TOKEN && export REVIEW_TOKEN`, paste, Enter. Keep
   `<review_id>` for T1.

2. **As the reviewer, inspect the DLQ.**

   ```bash
   LEDGER_TOKEN="$REVIEW_TOKEN" pnpm -s ledger dlq inspect --json; echo "exit=$?"
   ```

   Expect: exactly, then `exit=0`:

   ```json
   {
     "object": "list",
     "has_more": false,
     "depth": 0,
     "data": []
   }
   ```

   `read` is enough for `dlq.listMessages`.

3. **As the reviewer, try a redrive.**

   ```bash
   LEDGER_TOKEN="$REVIEW_TOKEN" pnpm -s ledger dlq redrive; echo "exit=$?"
   ```

   Expect: stdout holds only `exit=1`, and stderr is exactly

   ```text
   The token is valid but lacks the scope this operation needs.
   hint: Use an `operate` token, or ask its owner for one.
   ```

## Path G — order independence through SQS: duplicates and shuffle on the deployed queue

**Walked as:** [Application developer](../../../.ai/about.md#target-personas)

1. **Run the duplicates-and-shuffle simulation against the deployed stack.**

   ```bash
   set -a; . ./.env.deployed.local; set +a
   pnpm sim --duplicates 0.2 --shuffle; echo "exit=$?"
   ```

   Expect: after pnpm's banner, `sim seed=<seed> namespace=<namespace>`,
   `history emails=<m> events=<n> duplicates=<d> shuffled=true`, the projection JSON (masks only),
   then exactly these lines and `exit=0`:

   ```text
   sent requests=<n+d> accepted=<n+d>
   invariant 1 pass stored=<n>/<n>
   invariant 2 pass emails=<m> recipients=<r>
   invariant 3 not checked (slice 6)
   invariant 4 not checked (AWS runs check it: --burst, --chaos or --poison)
   ```

   SQS standard delivers in any order and may duplicate (ADR-002); invariant 1 (each event stored
   once) and invariant 2 (state equals the ground truth's projection) hold anyway. Ships 7.
   **Ask-first:** sends the history to the deployed stack.

## Path H — local mode: the in-process DLQ answers the same commands

**Walked as:** [Operator](../../../.ai/about.md#target-personas)

1. **Point the shell back at local mode and start the local stack.**

   ```bash
   unset LEDGER_URL LEDGER_TOKEN DATABASE_URL LEDGER_ADDRESS_HASH_KEY
   pnpm dev:full
   ```

   Expect, in its own terminal left running: it ends `LEDGER READY in <n>s`, then
   `  api       http://127.0.0.1:3200` and `  postgres  localhost:55432 (compose service "postgres")`.
   If the `api` line ends ` (already running; adopted)` and that server predates this slice's code,
   run `pnpm dev:stop`, then `pnpm dev:full` again, or the DLQ routes answer `route_not_found`.

2. **Inspect the local DLQ.**

   ```bash
   pnpm -s ledger dlq inspect; echo "exit=$?"
   pnpm -s ledger dlq inspect --json; echo "exit=$?"
   ```

   Expect: stdout exactly `dlq         empty`, empty stderr, `exit=0`; then F2's empty-list
   document, `exit=0`.

3. **Ask the local redrive to move the empty DLQ.**

   ```bash
   pnpm -s ledger dlq redrive; echo "exit=$?"
   pnpm -s ledger dlq redrive --json; echo "exit=$?"
   ```

   Expect: exactly `redrive     nothing to move: the dlq is empty`, `exit=0`; then

   ```json
   {
     "object": "dlq_redrive",
     "status": "empty",
     "depth": 0
   }
   ```

   and `exit=0`.

4. **Fill the local DLQ with a poison run → [slice 2B](../../../.ai/build-checklist.md#2b--local-mode-queue-and-docker-compose).**

   ```bash
   pnpm sim --poison 1; echo "exit=$?"
   ```

   Expect today: the seed, history and projection lines, then on stderr exactly
   `sim: LEDGER_URL is not the deployed LedgerApp API; load .env.deployed.local` and `exit=1`, before
   any request: AWS runs reach only the owner's deployment (D23). A dead message in local mode, and
   the Postgres-backed queue's DLQ behind these two commands, are slice 2B's.
   **Ask-first:** reads the `LedgerApp` and `LedgerGuardrails` stack outputs with the shell's AWS
   credentials.

5. **Run an AWS knob offline.**

   ```bash
   LEDGER_URL= pnpm -s sim --burst 10000/10s; echo "exit=$?"
   ```

   Expect: stdout holds only `exit=2`, and stderr is exactly
   `sim: --burst needs a live run against the deployed stack: load .env.deployed.local`: no seed
   line and no network call. `--chaos db-outage` and `--poison 1` print the same line with their
   own flag.

## Path I — adopter default: no simulator secret unless the owner asks for one

**Walked as:** [Application developer](../../../.ai/about.md#target-personas), deploying their own copy

1. **Synthesize with no context and read the app template.**

   ```bash
   pnpm synth; echo "exit=$?"
   grep -o '"AWS::SecretsManager::Secret"' infra/cdk.out/LedgerApp.template.json | wc -l
   grep -c 'SIMULATOR_SECRET_ARN\|SimulatorSecretArn' infra/cdk.out/LedgerApp.template.json
   ```

   Expect: `exit=0` with no AWS credentials used; then `2` (the database and webhook-signing
   secrets) and `0`: no simulator secret, no ingest variable naming it, no output. The deployed half,
   a simulator-signed request answered `401` without the secret, is
   `packages/ingest/src/create-ingest.test.ts` (D13). A later `pnpm aws:deploy` re-synthesizes with
   the owner's context, so this leaves the kept stack untouched.

## Teardown

The stacks, the simulator secret (`LEDGER_SIMULATOR` stays `on`: the owner's deployment keeps it,
ADR-016), the new alarms and the bootstrap token stay up (deploy and keep, lens clause 7). Every sim
run restored what it changed in its own `finally`.

1. **Revoke `review-dlq`, then retry it.**

   ```bash
   set -a; . ./.env.deployed.local; set +a
   pnpm -s ledger token revoke <review_id>; echo "exit=$?"
   LEDGER_TOKEN="$REVIEW_TOKEN" pnpm -s ledger token current --json; echo "exit=$?"
   ```

   Expect: exactly

   ```text
   token       <review_id>
   name        review-dlq
   scope       read
   created     <created_at>
   revoked     <revoked_at>
   exit=0
   ```

   then exactly, and `exit=1`:

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

   Read `<review_id>` from `pnpm -s ledger token list` if F1's line was not kept.

2. **Confirm the deploy is idle and the simulator flag stays on.**

   ```bash
   pnpm -s ledger health; echo "exit=$?"
   grep -o '^LEDGER_SIMULATOR=on$' .env.local
   ```

   Expect: C3's four lines exactly, `exit=0`; then `LEDGER_SIMULATOR=on`. No redeploy with `off`.

3. **Clear the shell and stop the local stack.**

   ```bash
   unset LEDGER_URL LEDGER_TOKEN DATABASE_URL LEDGER_ADDRESS_HASH_KEY REVIEW_TOKEN
   pnpm dev:stop; echo "exit=$?"
   ```

   Expect: stdout includes `dev:stop: compose services stopped (the database volume is kept).`, a
   `dev:stop: stopped pid <pid> and its children (<reason>)` line for this repo's dev server, then
   `dev:stop: port 3200 is free.` and `exit=0`. With the shell values gone, the next local walk reads
   `.env.local` again instead of the deploy.

## What this walk cannot reach today

| Not reachable | Carried by |
| --- | --- |
| Local-mode DLQ: a dead message in the Postgres-backed queue, and `ledger dlq inspect` / `redrive` over it (H4) | [slice 2B](../../../.ai/build-checklist.md#2b--local-mode-queue-and-docker-compose) |
| MCP `inspect_dlq` and `redrive_dlq`, so the AI agent persona walks no path | [slice 5](../../../.ai/build-checklist.md#5--mcp-server-and-contract-hardening) |
| Published latency, drain and cost numbers for the burst (C2 records them; slice 9 publishes) | [slice 9](../../../.ai/build-checklist.md#9--real-aws-burst-numbers) |
| `ledger gaps` and `ledger reconcile` after an outage or a trip | [slice 4](../../../.ai/build-checklist.md#4--recovery) |
