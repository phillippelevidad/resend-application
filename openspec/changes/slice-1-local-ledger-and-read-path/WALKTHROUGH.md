# Slice 1 — walkthrough

What one person does, in ~15 minutes, to prove this slice works.

**Read this first.** A step that cannot be completed today ends with `→ slice N`, naming the slice
that carries it. A step without such a note that fails is a finding against this slice.

Every `UI surfaces` entry on the
[slice 1 card](../../../.ai/build-checklist.md#1--local-ledger-and-read-path) is reached: the local
`POST /webhooks/resend` (A1, A2, C2, D5); `resend webhooks listen` (D2); `ledger email <email_id>`
(A3, B1, B3, B5, B6, D6); `ledger recipient <address>` (B2, B4, D7);
`pnpm sim --duplicates 0.2 --shuffle` (A1, A2).

## Before you start

```bash
pnpm install
docker info --format '{{.ServerVersion}}'
pnpm dev:full
```

- **Shell:** Bash (Git Bash on Windows), from the repo root. Run `pnpm dev:full` in its own
  terminal and leave it running: it ends `LEDGER READY in <n>s`, then
  `  api       http://127.0.0.1:3200` (with ` (already running; adopted)` when this repo's server was
  already up) and `  postgres  localhost:55432 (compose service "postgres")`. The first run on a
  machine also prints `db:setup: wrote <NAME> to .env.local` once per name it generated, never a
  value. That terminal shows the local process's JSON log lines; some steps below read them there.
- **Do not edit source files during the walk.** `pnpm dev:full` serves `apps/local` under
  `node --watch`, so a source edit restarts it (`Restarting 'src/main.ts --port 3200'` in its
  terminal), and events acknowledged but still in the in-process queue are lost
  ([design.md → Risks / Trade-offs](design.md#risks--trade-offs)). A1 then ends
  `sim: not settled after 30s (<s>/<n> stored)` on stderr with `exit=1`.
- **Environment variables (names only):** `DATABASE_URL`, `LEDGER_ADDRESS_HASH_KEY`,
  `LEDGER_SIMULATOR_SECRET`, `LEDGER_URL`, `LEDGER_TOKEN` (all written to `.env.local` by
  `pnpm dev:full`; `LEDGER_TOKEN` is a placeholder, loopback skips auth); for Path D also
  `RESEND_API_KEY` and `LEDGER_WEBHOOK_SECRETS`, which the owner puts in `.env.local`.
  `pnpm -s ledger` and `pnpm sim` load `.env.local` themselves. Path C's `curl` steps read only
  `LEDGER_URL` into the shell, with `export "$(grep '^LEDGER_URL=' .env.local)"`, which loads that
  one line and no secret.
- **This walk creates:** one sim run namespace's ledger and projection rows (A1, reused by A2);
  the file `${TMPDIR:-/tmp}/ledger-walk-a1.out` (A1); for Path D, a temporary Resend webhook per
  `listen` session, one signing secret in `.env.local`, and four test emails' rows. Teardown
  removes the file and the webhooks. Ledger rows are never deleted (the ledger is immutable); every
  sim id carries the run's namespace, so no later run collides with them.
- **Ask-first steps:** D2 (a `listen` session, which creates a webhook), D3 (owner-run: reads a
  signing secret), D4 (four test sends), D8 (hard-kills the `listen` session), T1 (deletes the
  webhook D8 left behind). Paths A, B and C make no live call.

## Path A — `pnpm sim` → local ingest → worker → `ledger email`: the live run passes invariants 1 and 2

**Walked as:** [Reviewer](../../../.ai/about.md#target-personas)

1. **Run the simulator live, with duplicates and shuffle.**

   ```bash
   pnpm -s sim --duplicates 0.2 --shuffle | tee "${TMPDIR:-/tmp}/ledger-walk-a1.out"; echo "exit=${PIPESTATUS[0]}"
   grep -cE 'resend\.dev|recipientKey' "${TMPDIR:-/tmp}/ledger-walk-a1.out"
   ```

   Expect: stdout opens with

   ```text
   sim seed=<seed> namespace=<namespace>
   history emails=<m> events=<n> duplicates=<d> shuffled=true
   {
     "emails": [
   ```

   then the projection JSON (masks only; the email ids are `<namespace>-email-<i>`,
   `<namespace>-probe` and one `<namespace>-observed-<address>` per test address, replaying
   [RS-39](../../../.ai/resend.md#facts)'s sequences), and it ends exactly

   ```text
   }
   sent requests=<n+d> accepted=<n+d>
   invariant 1 pass stored=<n>/<n>
   invariant 2 pass emails=<m> recipients=<r>
   invariant 3 not checked (slice 6)
   invariant 4 not checked (slice 3)
   exit=0
   ```

   `<seed>` is a uint32 and `<namespace>` 8 hex characters, both chosen by the run; write them
   down for A2 and the rest of the walk. Nothing prints on stderr. The `grep` prints `0`: no
   unmasked address and no recipient key anywhere. In the `pnpm dev:full` terminal, each request
   logs `{"level":"info","timestamp":"<iso>","function_name":"ingest","message":"ingest.accepted","svix_id":"<namespace>-svix-<…>","type":"email.<…>","value_count":1}`.
   → **Why it matters.** Ships 10: signed requests through the real ingest endpoint, one
   transaction per message, and both invariants checked against the database, not assumed.

2. **Rerun with A1's seed and namespace, and compare.**

   ```bash
   pnpm -s sim --seed <seed> --namespace <namespace> --duplicates 0.2 --shuffle | diff "${TMPDIR:-/tmp}/ledger-walk-a1.out" - && echo identical; echo "exit=$?"
   ```

   Expect: no diff lines; stdout `identical` then `exit=0`. Every one of the `<n+d>` requests is
   accepted again and every event is now a duplicate, yet `stored=<n>/<n>` and invariant 2 are
   unchanged. The `pnpm dev:full` terminal shows one
   `{"level":"info","timestamp":"<iso>","function_name":"worker","message":"worker.duplicates","svix_id":"<namespace>-svix-<…>","value_count":1}`
   line per request.
   → **Why it matters.** Duplicates leave one ledger row and no second effect (ADR-004).

3. **Read the walk probe back with the CLI.**

   ```bash
   pnpm -s ledger email <namespace>-probe --json; echo "exit=$?"
   ```

   Expect: one JSON document, then `exit=0`:

   ```json
   {
     "object": "email",
     "email_id": "<namespace>-probe",
     "status": "bounced",
     "from_masked": "onb*******@r*****.d**",
     "subject_masked": "Le**** w*** p****",
     "open_count": 0,
     "click_count": 0,
     "first_opened_at": null,
     "first_clicked_at": null,
     "last_event_at": "2026-10-16T12:00:02.000Z",
     "event_count": 3,
     "recipients": [
       {
         "address_masked": "del***************@r*****.d**",
         "status": "delivered",
         "status_at": "2026-10-16T12:00:01.000Z",
         "bounce_type": null,
         "bounce_sub_type": null
       },
       {
         "address_masked": "bou*************@r*****.d**",
         "status": "bounced",
         "status_at": "2026-10-16T12:00:02.000Z",
         "bounce_type": "Permanent",
         "bounce_sub_type": "General"
       }
     ],
     "timeline": [
       {
         "svix_id": "<namespace>-svix-probe-0",
         "type": "email.sent",
         "event_created_at": "2026-10-16T12:00:00.000Z",
         "bounce_type": null,
         "bounce_sub_type": null
       },
       {
         "svix_id": "<namespace>-svix-probe-1",
         "type": "email.delivered",
         "event_created_at": "2026-10-16T12:00:01.000Z",
         "bounce_type": null,
         "bounce_sub_type": null
       },
       {
         "svix_id": "<namespace>-svix-probe-2",
         "type": "email.bounced",
         "event_created_at": "2026-10-16T12:00:02.000Z",
         "bounce_type": "Permanent",
         "bounce_sub_type": "General"
       }
     ]
   }
   ```

   The two `recipients` come in `address_hash` order, which differs per namespace, so they may be
   swapped. The masks are those of `delivered+<namespace>@resend.dev` and
   `bounced+<namespace>@resend.dev` with an 8-character namespace. The same `"status": "bounced"`
   and `"eventCount": 3` show for `<namespace>-probe` in A1's projection JSON.
   → **Why it matters.** The simulator's ground truth, the ledger and the read path agree, and
   only masks leave the API.

## Path B — J2 support lookup: `ledger email` and `ledger recipient`, human and `--json`, every error shape

**Walked as:** [Support / on-call engineer](../../../.ai/about.md#target-personas)
([J2](../../../.ai/features.md#j2--support-lookup))

1. **Read the probe in the human layout.**

   ```bash
   pnpm -s ledger email <namespace>-probe; echo "exit=$?"
   pnpm -s ledger email <namespace>-probe | grep -c $'\x1b\['
   ```

   Expect: stdout exactly (the two recipient rows may be swapped, as in A3)

   ```text
   email       <namespace>-probe
   status      bounced
   from        onb*******@r*****.d**
   subject     Le**** w*** p****
   events      3, last 2026-10-16T12:00:02.000Z
   opens       0
   clicks      0

   recipients
     del***************@r*****.d**   delivered   2026-10-16T12:00:01.000Z
     bou*************@r*****.d**     bounced     2026-10-16T12:00:02.000Z   Permanent / General

   timeline
     2026-10-16T12:00:00.000Z   email.sent        <namespace>-svix-probe-0
     2026-10-16T12:00:01.000Z   email.delivered   <namespace>-svix-probe-1
     2026-10-16T12:00:02.000Z   email.bounced     <namespace>-svix-probe-2   Permanent / General
   exit=0
   ```

   The `grep` prints `0`: no ANSI escape (`\u001b[`) in the output.

2. **Look up the probe's two recipients by address.**

   ```bash
   pnpm -s ledger recipient bounced+<namespace>@resend.dev; echo "exit=$?"
   pnpm -s ledger recipient bounced+<namespace>@resend.dev | grep -c 'resend\.dev'
   pnpm -s ledger recipient delivered+<namespace>@resend.dev --json; echo "exit=$?"
   ```

   Expect: the first command prints exactly

   ```text
   recipient        bou*************@r*****.d**
   deliverability   hard_bounced
   since            2026-10-16T12:00:02.000Z
   caused by        <namespace>-probe
   exit=0
   ```

   The `grep` prints `0`: the address the engineer typed is echoed only as the API's mask. The
   third command prints, then `exit=0`:

   ```json
   {
     "object": "recipient",
     "address_masked": "del***************@r*****.d**",
     "deliverability": "ok",
     "since": "2026-10-16T12:00:01.000Z",
     "cause_email_id": "<namespace>-probe"
   }
   ```

   → **Why it matters.** A bounce on one recipient does not mark its healthy co-recipient
   (RS-U21's documented reading).

3. **Ask for an email no event has named.**

   ```bash
   pnpm -s ledger email no-such-email --json; echo "exit=$?"
   ```

   Expect: stdout exactly, then `exit=1`:

   ```json
   {
     "error": {
       "code": "email_not_found",
       "message": "No event has been recorded for this email id.",
       "hint": "Events may still be queued, or missed: run `ledger gaps`.",
       "docs": "https://github.com/phillippelevidad/resend-application/blob/main/docs/runbook.md#email_not_found"
     }
   }
   ```

   The hint names `ledger gaps` (slice 4) and the `docs` link answers `404` until the runbook
   lands (slice 3): both are registry text, carried by a named later slice.

4. **Ask for an address no event has named, without `--json`.**

   ```bash
   pnpm -s ledger recipient never-seen+walk@resend.dev; echo "exit=$?"
   ```

   Expect: stdout holds only `exit=1`; stderr is exactly

   ```text
   No event has ever named this address.
   hint: Check the address. If it was emailed recently, run `ledger gaps`.
   ```

   Neither stream echoes the address.

5. **Pass an email id the API rejects.**

   ```bash
   pnpm -s ledger email 'bad id!' --json; echo "exit=$?"
   ```

   Expect: stdout exactly, then `exit=1`:

   ```json
   {
     "error": {
       "code": "validation_failed",
       "message": "email_id must be 1 to 128 characters from A-Z, a-z, 0-9, '.', '_' and '-'.",
       "hint": "Fix the field the message names, then retry.",
       "docs": "https://github.com/phillippelevidad/resend-application/blob/main/docs/runbook.md#validation_failed"
     }
   }
   ```

   The CLI validates nothing itself (D28): this is the API's answer, and the message does not
   quote the input.

6. **Stop Postgres, read the probe, start Postgres, read it again.**

   ```bash
   pnpm -s db:down
   pnpm -s ledger email <namespace>-probe --json; echo "exit=$?"
   pnpm -s db:up
   pnpm -s ledger email <namespace>-probe --json | head -4; echo "exit=${PIPESTATUS[0]}"
   ```

   Expect: compose reports `Container ledger-postgres-1  Stopped`; the first read prints exactly,
   then `exit=1`:

   ```json
   {
     "error": {
       "code": "database_unavailable",
       "message": "The database is unreachable.",
       "hint": "The queue holds events meanwhile (ADR-015); retry, then `ledger worker resume`. `ledger health` shows storage used.",
       "docs": "https://github.com/phillippelevidad/resend-application/blob/main/docs/runbook.md#database_unavailable"
     }
   }
   ```

   The `pnpm dev:full` terminal logs
   `{"level":"error","timestamp":"<iso>","function_name":"api","message":"db.pool_error","error_name":"error","pg_code":"57P01"}`
   and no connection string or error text. After `db:up` reports
   `Container ledger-postgres-1  Healthy`, the second read prints `{`, `  "object": "email",`,
   `  "email_id": "<namespace>-probe",`, `  "status": "bounced",` and `exit=0`, with no restart of
   `apps/local`. The hint's `ledger worker resume` and `ledger health` are slice 2's commands.

7. **Call `ledger email` without its argument.**

   ```bash
   pnpm -s ledger email; echo "exit=$?"
   ```

   Expect: stdout holds only `exit=2`; stderr is exactly
   `error: missing required argument 'email_id'` (commander's usage error; no API call is made).

## Path C — the HTTP surface: recipient lookup, the ingest boundary, an unknown route, the loopback guard

**Walked as:** [Application developer](../../../.ai/about.md#target-personas)

1. **Look up a recipient over HTTP.**

   ```bash
   export "$(grep '^LEDGER_URL=' .env.local)"
   curl -s -w '\n%{http_code}\n' -X POST "$LEDGER_URL/recipients/lookup" \
     -H 'content-type: application/json' -d '{"address":"bounced+<namespace>@resend.dev"}'
   ```

   Expect: exactly

   ```text
   {"object":"recipient","address_masked":"bou*************@r*****.d**","deliverability":"hard_bounced","since":"2026-10-16T12:00:02.000Z","cause_email_id":"<namespace>-probe"}
   200
   ```

   The address travels in the request body, never the path, and comes back only as its mask.

2. **Send ingest a request with a bad signature, then one with no signature.**

   ```bash
   export "$(grep '^LEDGER_URL=' .env.local)"
   curl -s -w '\n%{http_code}\n' -X POST "$LEDGER_URL/webhooks/resend" \
     -H 'content-type: application/json' -H 'svix-id: msg_walk_c2' \
     -H "svix-timestamp: $(date +%s)" -H 'svix-signature: v1,AAAA' -d '{"type":"email.sent"}'
   curl -s -w '\n%{http_code}\n' -X POST "$LEDGER_URL/webhooks/resend" \
     -H 'content-type: application/json' -d '{"type":"email.sent"}'
   ```

   Expect: each prints `unauthorized` then `401` (body `text/plain; charset=utf-8`, no registry
   `code`: ingest is not an operation,
   [Ingest boundary](../../../.ai/api-contract.md#ingest-boundary)). The timestamp is the current
   second, so the first `401` is the signature's, not staleness (RS-02). The `pnpm dev:full`
   terminal logs, per request,
   `{"level":"warn","timestamp":"<iso>","function_name":"ingest","message":"ingest.request_rejected"}`
   and no other field: the unverified `svix-id` is never logged.

3. **Request a path that is no operation.**

   ```bash
   export "$(grep '^LEDGER_URL=' .env.local)"
   curl -s -w '\n%{http_code}\n' "$LEDGER_URL/nope"
   ```

   Expect: exactly

   ```text
   {"error":{"code":"route_not_found","message":"No operation at this method and path.","hint":"Check `LEDGER_URL`, and that the CLI or SDK version matches the API's.","docs":"https://github.com/phillippelevidad/resend-application/blob/main/docs/runbook.md#route_not_found"}}
   404
   ```

4. **Try to start the local process on a non-loopback host.**

   ```bash
   pnpm -s --filter @ledger/app-local start --host 0.0.0.0 --port 3299; echo "exit=$?"
   ```

   Expect: stdout exactly one JSON line from the shared logger, then `exit=1`:

   ```text
   {"level":"error","timestamp":"<iso>","function_name":"local","message":"refusing to start: --host must be 127.0.0.1, ::1 or localhost because local mode skips auth"}
   ```

   Nothing listens on port `3299` afterwards, and the server on `3200` is untouched. (Without
   `-s`, pnpm adds its script banner and an `ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL` line.)
   → **Why it matters.** Auth is skipped only because the bind is loopback
   ([Conventions → Auth in slice 1](../../../.ai/api-contract.md#conventions)).

## Path D — real Resend traffic, locally: `resend webhooks listen` → local ingest → `ledger email`

**Walked as:** [Application developer](../../../.ai/about.md#target-personas)

Owner-run or run with the owner's yes in this conversation. Test addresses only
([RS-32](../../../.ai/resend.md#facts)). Never paste a signing secret, an API key, a webhook id or
the tunnel URL into a run file: write `<redacted:kind>`. The owner's run of 2026-10-17
(resend-cli 2.26.0, sends from `onboarding@resend.dev`, no verified domain) settled RS-U15, RS-U18
and RS-U22 as [RS-39, RS-40 and RS-41](../../../.ai/resend.md#facts), and RS-U14 as RS-42; RS-U21
stays [Unverified](../../../.ai/resend.md#unverified) (D6). The expectations below are that run's.

1. **Start a public tunnel to port 4318 (owner-run, the owner's tunnel tool).**

   ```bash
   tailscale funnel 4318
   ```

   Expect: the tool prints a public HTTPS URL that forwards to `127.0.0.1:4318`, the default port
   of the `listen` session's own server (RS-33); that URL is `<tunnel>` below. Any tunnel tool
   works; Resend's CLI reference uses a Tailscale Funnel URL as its example.

2. **Start a `listen` session that forwards to local ingest.**

   ```bash
   export "$(grep '^RESEND_API_KEY=' .env.local)"
   export "$(grep '^LEDGER_URL=' .env.local)"
   resend webhooks listen --url <tunnel> --forward-to "$LEDGER_URL/webhooks/resend"
   ```

   Expect: the session stays in the foreground and registers a temporary webhook on the owner's
   Resend account (RS-33). The Resend CLI reference shows no sample output, so the run records the
   lines it prints, with the webhook id as `<redacted:webhook-id>`. With its stdout piped, the
   2026-10-17 session printed one JSON line per event, carrying `type`, `payload` and
   `forwarded.status` (the status local ingest returned). Leave it running until D8.
   **Ask-first:** one `listen` session: creates a temporary webhook on the owner's Resend account.

3. **Load the session's signing secret and restart `apps/local` (owner-run).**

   ```bash
   resend webhooks get <temporary webhook id>
   ```

   Expect: a response carrying the webhook's `signing_secret` (RS-05, RS-13); it is seen only in
   the owner's terminal. The owner sets `LEDGER_WEBHOOK_SECRETS=<signing_secret>` in `.env.local`
   (comma-separated after any entry already there), then presses Ctrl+C in the `pnpm dev:full`
   terminal (`dev:full: stopping the dev server (Postgres keeps running)…`) and runs
   `pnpm dev:full` again. Expect it to end `LEDGER READY in <n>s` with
   `  api       http://127.0.0.1:3200`. A malformed entry instead logs
   `{"level":"error","timestamp":"<iso>","function_name":"local","message":"refusing to start: each LEDGER_WEBHOOK_SECRETS entry must be whsec_ followed by base64"}`
   and `dev:full` ends `LEDGER START FAILED: <reason>`. If the session printed no webhook id, the
   owner finds it with `resend webhooks list` in the same terminal (RS-05: its output may carry
   secrets too).
   **Ask-first:** owner-run read of the temporary webhook, because its response carries the
   signing secret (RS-05); no agent runs `resend webhooks get` or `list`.

4. **Send four test emails: one to two recipients, then three single sends.**

   ```bash
   export "$(grep '^RESEND_API_KEY=' .env.local)"
   curl -s -w '\n%{http_code}\n' -X POST 'https://api.resend.com/emails' \
     -H "Authorization: Bearer $RESEND_API_KEY" -H 'Content-Type: application/json' \
     -d '{"from":"onboarding@resend.dev","to":["delivered@resend.dev","bounced@resend.dev"],"subject":"walk D4 two recipients","html":"<p>walk</p>"}'
   curl -s -w '\n%{http_code}\n' -X POST 'https://api.resend.com/emails' \
     -H "Authorization: Bearer $RESEND_API_KEY" -H 'Content-Type: application/json' \
     -d '{"from":"onboarding@resend.dev","to":["bounced@resend.dev"],"subject":"walk D4 bounced","html":"<p>walk</p>"}'
   curl -s -w '\n%{http_code}\n' -X POST 'https://api.resend.com/emails' \
     -H "Authorization: Bearer $RESEND_API_KEY" -H 'Content-Type: application/json' \
     -d '{"from":"onboarding@resend.dev","to":["complained@resend.dev"],"subject":"walk D4 complained","html":"<p>walk</p>"}'
   curl -s -w '\n%{http_code}\n' -X POST 'https://api.resend.com/emails' \
     -H "Authorization: Bearer $RESEND_API_KEY" -H 'Content-Type: application/json' \
     -d '{"from":"onboarding@resend.dev","to":["suppressed@resend.dev"],"subject":"walk D4 suppressed","html":"<p>walk</p>"}'
   ```

   Expect: each prints a JSON body carrying the new email's `id`, then `200`
   ([Send Email](https://resend.com/docs/api-reference/emails/send-email)); test addresses are
   exempt from the own-address rule ([RS-42](../../../.ai/resend.md#facts)). Keep the first id as
   `<two-recipient email id>` and the second as `<bounced email id>`. Without a verified domain
   Resend keeps only the first `to` recipient, so the two-recipient email reaches
   `delivered@resend.dev` alone (RS-U21's observation); the second send is what reaches
   `bounced@resend.dev`.
   **Ask-first:** four live sends from the owner's Resend account (count against quota, RS-32).

5. **Watch the session forward each event to local ingest.**

   ```bash
   # no command: read the D2 terminal and the pnpm dev:full terminal
   ```

   Expect: the `listen` terminal shows each event in no promised order, with `forwarded.status`
   `200` for every one ([RS-41](../../../.ai/resend.md#facts)); the `pnpm dev:full` terminal logs
   `"message":"ingest.accepted"` with `"svix_id":"msg_<…>"` and the event's `"type"` per delivery.
   By `created_at`, each address's events are [RS-39](../../../.ai/resend.md#facts)'s:
   `delivered@` `email.sent`, `email.delivered`; `bounced@` `email.sent`, `email.bounced` with
   `bounce.type` `Permanent` and `subType` `General`; `complained@` `email.sent`,
   `email.complained`, `email.delivered`; `suppressed@` `email.suppressed` only. Every event's
   `data.to` lists one recipient. A `401` with `"message":"ingest.request_rejected"` means the
   session's secret is not in `LEDGER_WEBHOOK_SECRETS` (D3); D6 and D7 then read `email_not_found`
   and `recipient_not_found`.

6. **Read the two-recipient email back.**

   ```bash
   pnpm -s ledger email <two-recipient email id> --json; echo "exit=$?"
   ```

   Expect, without a verified domain: `exit=0`; `"object": "email"`, and `recipients` holds one
   row, `"address_masked": "del******@r*****.d**"` with `"status": "delivered"` (D4: Resend kept
   only the first recipient). That leaves RS-U21 [Unverified](../../../.ai/resend.md#unverified):
   settling it needs this send from the project's verified sending domain
   → [slice 2](../../../.ai/build-checklist.md#2--durable-ingest-on-aws). From a verified domain,
   expect two rows, the second `"address_masked": "bo*****@r*****.d**"` with
   `"status": "bounced"` and `bounce_type` / `bounce_sub_type` (RS-U21 positive); anything else is
   recorded as observed.

7. **Look up the two addresses.**

   ```bash
   pnpm -s ledger recipient delivered@resend.dev; echo "exit=$?"
   pnpm -s ledger recipient bounced@resend.dev; echo "exit=$?"
   ```

   Expect: `recipient        del******@r*****.d**` and `deliverability   ok`, `exit=0`; then
   `recipient        bo*****@r*****.d**` and `deliverability   hard_bounced` with
   `caused by        <bounced email id>` (the bounce's `type` is `Permanent`, RS-39), `exit=0`.
   A database that held these addresses before the walk may show an earlier `since` and another
   cause.

8. **End the `listen` session with a hard kill instead of Ctrl+C.**

   ```bash
   # kill the D2 process without a graceful exit (or close its terminal window)
   ```

   Expect: the session ends at once. Then, owner-run in the owner's own terminal,
   `resend webhooks list`, and report only the number of webhooks whose endpoint is a tunnel URL:
   `1`, `enabled` ([RS-40](../../../.ai/resend.md#facts): a hard kill leaves the webhook behind),
   and T1 deletes it. The plan was a second, short session killed this way; on 2026-10-17 the
   owner approved hard-killing the first instead, so a graceful Ctrl+C exit (which the CLI's help
   says deletes the webhook, RS-33) was not exercised.
   **Ask-first:** ends the session; the list is owner-run because its response may carry signing
   secrets (RS-05).

## Teardown

1. **Delete the webhook D8 left behind.**

   ```bash
   resend webhooks delete <leftover webhook id>
   ```

   Expect: exit `0`; an owner-run `resend webhooks list` then counts `0` tunnel webhooks.
   **Ask-first:** deletes a webhook on the owner's Resend account
   ([Delete Webhook](https://resend.com/docs/api-reference/webhooks/delete-webhook)).

2. **Stop the tunnel.**

   ```bash
   # Ctrl+C in the D1 terminal
   ```

   Expect: the tunnel exits. The session's secret left in `LEDGER_WEBHOOK_SECRETS` now belongs to
   a deleted webhook; the owner may clear it.

3. **Stop the local stack and remove A1's output file.**

   ```bash
   pnpm dev:stop; echo "exit=$?"
   rm -f "${TMPDIR:-/tmp}/ledger-walk-a1.out"
   ```

   Expect: stdout includes `dev:stop: compose services stopped (the database volume is kept).`, a
   `dev:stop: stopped pid <pid> and its children (<reason>)` line for this repo's dev server, then
   `dev:stop: port 3200 is free.` and `exit=0`. The database volume, and with it the walk's rows,
   is kept.

## What this walk cannot reach today

| Not reachable | Carried by |
| --- | --- |
| Bearer-token enforcement, `ledger health`, `ledger worker resume` (named in the `database_unavailable` hint), the deployed ingest, RS-U21's two-recipient send from the verified domain | [slice 2](../../../.ai/build-checklist.md#2--durable-ingest-on-aws) |
| A DLQ and its inspection | [slice 3](../../../.ai/build-checklist.md#3--operations-and-evidence-on-aws), [slice 2B](../../../.ai/build-checklist.md#2b--local-mode-queue-and-docker-compose) |
| The runbook the error `docs` links point at | [slice 3](../../../.ai/build-checklist.md#3--operations-and-evidence-on-aws) |
| `ingest.rejected`, the rotation runbook, the retired-secret test, `ledger gaps` (named in the not-found hints) | [slice 4](../../../.ai/build-checklist.md#4--recovery) |
| MCP tools, `ledger explain` | [slice 5](../../../.ai/build-checklist.md#5--mcp-server-and-contract-hardening) |
| `docker compose up` local mode, and a queue that survives an `apps/local` restart | [slice 2B](../../../.ai/build-checklist.md#2b--local-mode-queue-and-docker-compose) |
