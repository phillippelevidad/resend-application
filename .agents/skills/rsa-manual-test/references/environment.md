# Environment

What exists to walk, which slice lands each surface, and the traps that fake a verdict. Each slice
that lands or changes how a surface starts (a command, a port, an environment variable name)
updates [Surfaces by slice](#surfaces-by-slice) in the same change.

## Fast path

1. **What exists today** is root [AGENTS.md → Commands](../../../../AGENTS.md#commands), the
   canonical list. Walkable now: `pnpm dev:full` (deps → Docker → compose Postgres →
   `pnpm db:setup` → typecheck → `apps/local`; adopts this repo's server if already up, fails if
   another process holds port `3200`; ends `LEDGER READY` or `LEDGER START FAILED: <reason>`) and
   `pnpm dev:stop`; `pnpm db:up` (compose Postgres on `127.0.0.1:55432`); `pnpm db:setup`
   (`.env.local` with both keys, runtime role, migrations, a minted `operate` `LEDGER_TOKEN`);
   `pnpm --filter @ledger/app-local start` (ingest, worker and read API on `127.0.0.1:3200`,
   bearer tokens enforced); `pnpm -s ledger email|recipient|health|worker resume|token …` (the
   CLI); the `pnpm aws:*` scripts (slice 2, every run Ask-first);
   `pnpm --filter @ledger/app-mcp start` (stdio, no tools yet); `node scripts/secret-scan.mjs`
   (needs Docker; prints `secrets: canary caught 3/3 rules` then
   `secrets: repo clean (<k> commits scanned)`); `node scripts/check-links.mjs [file …]` (README.md
   by default; prints `links: canary caught 2/2` then `links: <file> <n> checked, <k> broken`);
   `pnpm sim` (offline or live, flags in [Surfaces by slice](#surfaces-by-slice)). Never
   `start -- --help`: pnpm 10.11 forwards the literal `--`. `pnpm check` and `pnpm verify` are
   gates, never walked. Every other command lands with its slice and its Commands line.
2. **Setup commands come from the walkthrough's `## Before you start`** until the table below names
   the surface's start command. Never invent one.
3. **Health first, reuse a running stack.** Probe before starting anything (`ledger health` from
   slice 2; before that, the surface's own first read). Adopt what is already up and record it as
   adopted; stop only what this run started.
4. **Long commands** (a stack start, a `pnpm sim` run, a deploy) per
   [root AGENTS.md → Waiting for a long command](../../../../AGENTS.md#waiting-for-a-long-command-on-this-machine):
   `run_in_background` into a log, `Monitor` filtered to stage markers and failure signatures, and
   a check that nothing survived before any restart.
5. **A symptom in [Known issues](#known-issues)** gets that row's fast path at once.

## Surfaces by slice

From each card's `UI surfaces` line in [build-checklist.md](../../../../.ai/build-checklist.md) and
the Walk column of [architecture.md → Build order](../../../../.ai/architecture.md#build-order-vertical-slices).
**Live** marks an Ask-first action ([Permissions](../../../../AGENTS.md#permissions)). Where no doc
names the command yet, the slice's card is the source.

| Surface | Lands in | How it is reached | Live? |
| --- | --- | --- | --- |
| `pnpm check` · `pnpm verify` | 0 | Root scripts. Gates, never walked by this skill ([hard rule 7](../SKILL.md#hard-rules-must)) | No |
| `node scripts/secret-scan.mjs` | 0 | The `secrets` stage, run alone; needs Docker. Canary first, then the full history of every ref | No |
| `node scripts/check-links.mjs [file …]` | 0 | The `links` stage, run alone; README.md unless files are named. Canary first; no network | No |
| `pnpm dev:full` · `pnpm dev:stop` | 0 | Root scripts. `dev:full` brings up compose Postgres, runs `pnpm db:setup` (from slice 1) and starts `apps/local` on `127.0.0.1:3200`, adopting this repo's running server and failing on any other holder of the port, and prints `LEDGER READY` or `LEDGER START FAILED: <reason>`; `dev:stop` stops compose, and the dev server only if it belongs to this repo | No |
| Compose Postgres | 0 | `pnpm db:up` / `pnpm db:down`; `127.0.0.1:55432`, throwaway `ledger` credentials. Tests never use it (Testcontainers) | No |
| `apps/local` process and its flags | 0 | `pnpm --filter @ledger/app-local start` (or `pnpm dev`, watch mode); `--port` (default `3200`, clear of the other local stacks on this machine), `--host` (default `127.0.0.1`, loopback only: a non-loopback host exits `1`). What it serves from slice 1: the slice 1 row below | No |
| `ledger` CLI program · MCP server, no tools | 0 | `pnpm --filter @ledger/app-cli start --help` (loads no `.env.local`; the walkable CLI is the slice 1 row) · `pnpm --filter @ledger/app-mcp start` (stdio; an unknown flag exits non-zero) | No |
| CI run on a pushed commit | 0 | GitHub Actions on the pushed `HEAD`; read its conclusion. Never push a scratch commit to provoke one | No |
| `pnpm sim` printing a projection | 0 | `pnpm sim --seed <uint32> --namespace <[a-z0-9-]{1,32}> --duplicates <0..1> --shuffle`, every flag optional, no `--` before them; root script, no live process. Line 1 `sim seed=<seed> namespace=<namespace>` (chosen when not given), line 2 `history emails=<m> events=<n> duplicates=<d> shuffled=<true\|false>`, then the projection JSON, masks only. A bad flag prints `sim: <flag> <reason>` on stderr and exits `2`. `pnpm -s sim` drops pnpm's script banner from stdout | No |
| `pnpm db:setup` | 1 | Root script (`pnpm --filter @ledger/app-local run setup`; `setup` alone is a pnpm built-in); needs compose Postgres up (`pnpm db:up`), and `pnpm dev:full` runs it. Writes each of `DATABASE_URL`, `LEDGER_ADDRESS_HASH_KEY`, `LEDGER_TOKEN_TAG_KEY` (slice 2), `LEDGER_SIMULATOR_SECRET`, `LEDGER_URL` to `.env.local` only when unset or empty, before touching the database, one `db:setup: wrote <NAME> to .env.local` line each (names, never values), ensures the runtime role and its two timeouts, applies pending migrations, then (slice 2) mints an `operate` `LEDGER_TOKEN` (the bootstrap token, else one named `local-setup`) only when the current one is empty, `local-loopback-no-auth`, tag-invalid or not active, printing `db:setup: wrote LEDGER_TOKEN to .env.local`; ends `db:setup: ready` (exit `0`) or `db:setup: failed: <reason>` (exit `1`). A rerun prints only `db:setup: ready`. Over slice 1's `.env.local` the first run prints `wrote LEDGER_TOKEN_TAG_KEY` and `wrote LEDGER_TOKEN` | No |
| `apps/local`: ingest `POST /webhooks/resend`, worker, read API | 1 | `pnpm db:setup`, then `pnpm --filter @ledger/app-local start` (or `pnpm dev:full`, which does both). Needs `DATABASE_URL`, `LEDGER_ADDRESS_HASH_KEY`, `LEDGER_TOKEN_TAG_KEY` (slice 2) and at least one of `LEDGER_WEBHOOK_SECRETS` (comma-separated `whsec_` values, one per `resend webhooks listen` session) and `LEDGER_SIMULATOR_SECRET`; a missing or invalid one exits `1` with a line naming it. Every stdout line is the shared logger's JSON; ready at `message` `local server listening`. Any path but `POST /webhooks/resend` reaches the read API, which from slice 2 enforces bearer tokens as deployed (no token → `401 unauthorized`; a valid token on an unmatched path → `404 route_not_found`; [Conventions → Auth](../../../../.ai/api-contract.md#conventions)). `--host` stays loopback-only: `refusing to start: --host must be 127.0.0.1, ::1 or localhost` | No |
| `ledger email <email_id>` · `ledger recipient <address>` | 1 | `pnpm -s ledger email <email_id> [--json]` · `pnpm -s ledger recipient <address> [--json]`: the root script loads `.env.local` for `LEDGER_URL` and `LEDGER_TOKEN` (both required, a shell value winning; no `--token` flag, [pp-cli](../../pp-cli/SKILL.md)); from slice 2 `LEDGER_TOKEN` must be an active token (`pnpm db:setup` mints the local one). No `bin` until slice 8. Exit `0` success, `1` a registry error, `2` a usage error or a missing / invalid variable | No |
| `pnpm sim --duplicates 0.2 --shuffle` | 1 | Against `apps/local`: live iff `LEDGER_URL` is set and non-empty (the shell wins over `.env.local`), so after `pnpm db:setup` a bare `pnpm sim` is live. Also needs `LEDGER_SIMULATOR_SECRET`, `DATABASE_URL`, `LEDGER_ADDRESS_HASH_KEY` (missing → `sim: <NAME> is required when LEDGER_URL is set`, exit `2`). Prints the offline header and projection, then `sent requests=<k> accepted=<a>`, settles up to 30 s, prints the invariant 1 and 2 result lines and `invariant 3 not checked (slice 6)`, `invariant 4 not checked (slice 3)`; exit `0` iff both pass and `a = k`. Nothing listening exits `1` after the first request | No |
| `resend webhooks listen` | 1 | Resend CLI: `--url` your own public tunnel, `--forward-to` local ingest ([RS-33](../../../../.ai/resend.md#facts)) | **Yes**, per session |
| Deploy command · teardown command | 2 | `pnpm aws:deploy [--issue-operate-token <name>] [--budget-drill]` · `pnpm aws:teardown [--discard-queued]` ([pp-infra → scripts](../../pp-infra/references/scripts.md#root-packagejson-scripts)). Deploy reads `LEDGER_DEPLOY_DATABASE_URL`, `LEDGER_DEPLOY_DATABASE_POOLED_URL`, `LEDGER_ALERT_EMAIL` (required), `LEDGER_ADDRESS_HASH_KEY` and `LEDGER_TOKEN_TAG_KEY` (64 lowercase hex; run `pnpm db:setup` once to generate them), and optionally `LEDGER_DEPLOY_WEBHOOK_SECRETS`, `LEDGER_KILL_SWITCH` (`on` \| `off`), `LEDGER_BUDGET_USD`; a missing or malformed one refuses, naming it. It prints the first `operate` token once (only when inserted), the API URL, the ingest URL (`<ApiUrl>/webhooks/resend`) and `KillSwitchArmed`; a re-run prints no token. Teardown destroys the app stack, then guardrails, lists leftovers and prints the two steps outside AWS | **Yes** (AWS) |
| `POST /webhooks/resend` (deployed) | 2 | The ingest URL the deploy prints, behind the owner's Resend webhook; the verify-stage send to `delivered@resend.dev` | **Yes** (the send) |
| `ledger health` · `ledger worker resume` | 2 | `pnpm -s ledger health [--json]` · `pnpm -s ledger worker resume [--json]`. Local from slice 2 (not 2B): health reports the in-process queue's counts and `worker      enabled`, resume always `worker      enabled (already enabled)`. Deployed: the deployed `LEDGER_URL` and `LEDGER_TOKEN` in the shell (see the traps); resume needs `operate` | No |
| `ledger token create\|list\|revoke\|current` | 2 | `pnpm -s ledger token create --name <name> --scope <read\|operate> [--json]` (plaintext once on stdout, notice on stderr) · `pnpm -s ledger token list [--json]` · `pnpm -s ledger token revoke <token_id> [--json]` · `pnpm -s ledger token current [--json]`. Create, list and revoke need an `operate` token; `current` takes any. Locally against the token `pnpm db:setup` minted | No |
| Trip drill and re-arm scripts | 2 | `pnpm aws:trip-drill` (refuses unless `KillSwitchArmed` is `true` and the stack is not tripped; trips, probes, restores) · `pnpm aws:rearm` (restores from a trip, warns on budget spend, prints `then: ledger reconcile → slice 4`) | **Yes** (AWS) |
| Deployed database check | 2 | `pnpm aws:db-check --email-id <id> [--idle-minutes <n>]` (`--idle-minutes` at least 6): reads `ledger/database` and prints the role timeouts (PG-U06), the lock serialization (PG-U02) and, with the flag, the post-suspend outcome (PG-U04). Writes nothing | **Yes** (AWS, Neon) |
| `pnpm sim --burst 10000/10s` · `--chaos db-outage` · poison run | 3 | The owner's deployment, simulator flag set ([ADR-016](../../../../.ai/architecture.md#adr-016--the-simulator-reaches-aws-only-through-an-opt-in-simulator-secret)) | **Yes** (AWS) |
| `ledger dlq inspect` · `ledger dlq redrive` | 3 | Deployed; local mode from 2B | No |
| Alarm email | 3 | SNS email to the owner's inbox; only the owner can observe it | Owner-observed |
| `ledger gaps --since 24h` · `ledger reconcile --dry-run` · `ledger reconcile` · hourly cron run | 4 | Deployed; a real `ledger reconcile` replays events on the owner's webhook (RS-16) | **Yes** (replay; `--dry-run` reads only) |
| `docker compose up` · `pnpm sim` (local mode) | 2B | Local only; `pnpm db:setup` already mints the local `operate` token (slice 2) | No |
| MCP tools · `ledger explain <email_id>` | 5 | An MCP client over stdio; operate tools need an `operate` token and `--enable-operate` ([Conventions](../../../../.ai/api-contract.md#conventions)) | No (operate tools: replay per above) |
| `pnpm sim --chaos worker-crash:0.05` · app callback receiver · alert email | 6 | AWS; the alert email goes to the owner's Resend account address | **Yes** (AWS, alert sends) |
| README quick start · retention job run · `ledger email <email_id>` after redaction | 7 | The kept deploy | **Yes** (redeploy) |
| `npx <cli-package> email <email_id>` · `npm view <sdk-package> versions` | 8 | npm; the install reads the deployed stack | Publish only (reads: no) |
| `pnpm sim --burst 10000/10s` · the Cost Explorer line | 9 | The owner's deployment; Cost Explorer read by the owner | **Yes** (AWS) |
| The learning log's links | 10 | The CI link check | No |

## Truth ranking

[run-record.md → Evidence and redaction](run-record.md#evidence-and-redaction) owns it.

## Traps

Each one produces a convincing wrong verdict.

- **Ingest `200` is not stored.** It means verified and enqueued; read the ledger back
  ([ADR-001](../../../../.ai/architecture.md#adr-001--verify-then-enqueue),
  [Ingest boundary](../../../../.ai/api-contract.md#ingest-boundary)).
- **A duplicate's "nothing changed"** needs proof the duplicate reached ingest: the simulator's
  counts or a log line under its `svix_id`. Otherwise it is `inconclusive`.
- **A stale `svix-timestamp` is a `401`** that looks like a bad signature: a hand-signed request
  must be signed within 5 minutes (RS-02, [simulator.md](../../pp-testing/references/simulator.md#signing)).
- **Masks, not addresses.** The CLI echoes an input address only as the API's mask
  ([pp-cli](../../pp-cli/SKILL.md)); assert the mask, and grep the output for the raw address.
- **Assert on `--json`.** Human output layouts are each slice's, not a contract.
- **`pnpm -s` for `--json`.** Without `-s`, pnpm prints its script banner on stdout before the CLI's
  output, so `pnpm ledger … --json` is not one JSON document. Always `pnpm -s ledger …`.
- **The local `LEDGER_TOKEN` is a real token from slice 2.** `pnpm db:setup` mints an `operate`
  token into `.env.local`; local mode enforces it as deployed. Never print `.env.local` or paste the
  token into a transcript; read names only (`grep -o '^[A-Z_]*=' .env.local`). A `401` locally
  means the token is stale (slice 1's `local-loopback-no-auth`, or a recreated database): rerun
  `pnpm db:setup`, which replaces it, rather than editing the file.
- **Deployed walks load `.env.deployed.local` into the shell.** The owner keeps the kept stack's
  `LEDGER_URL` and bootstrap `LEDGER_TOKEN` there (git-ignored by `.env*`, carried into worktrees by
  `.worktreeinclude`, owner's decision 2026-10-18); nothing loads it automatically, and the shell
  wins over `.env.local`. Bash: `set -a; . ./.env.deployed.local; set +a`. An agent (K1 rejects
  `.`): `Get-Content .env.deployed.local | Where-Object { $_ -match '^[A-Z_]+=' } | ForEach-Object
  { $k,$v = $_ -split '=',2; Set-Item "env:$k" $v }` in the same PowerShell command as the CLI call.
  Never print the file. Without it, `export LEDGER_URL=<api url>`, then `read -rs LEDGER_TOKEN &&
  export LEDGER_TOKEN`. `unset LEDGER_URL LEDGER_TOKEN` before walking local mode again, or the
  local walk silently hits the deployed stack. Never write `LEDGER_TOKEN` into `.env.local`:
  `pnpm db:setup` replaces any token not active in the local database.
- **`pnpm sim` is live once `.env.local` exists.** `pnpm db:setup` writes `LEDGER_URL`, so a bare
  `pnpm sim` posts to `apps/local`. Run `LEDGER_URL= pnpm sim` for an offline run; the shell's
  empty value wins over `.env.local`.
- **Reproduce with the printed seed.** Reuse its run namespace only on a fresh database
  ([simulator.md → Seed and determinism](../../pp-testing/references/simulator.md#seed-and-determinism)).
- **Test sends count against quota** ([RS-32](../../../../.ai/resend.md#facts)), and `resend.dev`
  sends reach only the account owner's address ([RS-34](../../../../.ai/resend.md#facts)), except
  the test addresses ([RS-42](../../../../.ai/resend.md#facts)).
- **`resend webhooks listen` creates a webhook** and needs your own public URL (RS-33). A hard
  kill (no Ctrl+C) leaves the webhook behind, `enabled` ([RS-40](../../../../.ai/resend.md#facts)).
  Forwarded deliveries verify once that session's secret is in `LEDGER_WEBHOOK_SECRETS`
  ([RS-41](../../../../.ai/resend.md#facts)); until then local ingest answers them `401`.
- **Listing webhooks may return signing secrets** (RS-05): never paste the response; record counts.
  `resend webhooks list` and `resend webhooks get <id>` are owner-run, in the owner's own terminal,
  never through an agent transcript; the owner copies the secret into `LEDGER_WEBHOOK_SECRETS` in
  `.env.local` and restarts `apps/local`.
- **`ledger reconcile` waits by default**; `--no-wait` returns at once. A real run replays, which is
  Ask-first ([reconcile.start](../../../../.ai/api-contract.md#reconcilestart)).
- **`ledger token create` prints the plaintext once**, to stdout: redact it, and revoke the token at
  teardown, never the last `operate` one (`last_operate_token`).
- **`api_unavailable` on the kept stack** usually means the kill switch tripped
  ([CBL-17](../../../../.ai/check-before-launch.md#cost--teardown)).
- **Never `pnpm deploy`**: it is a pnpm built-in, not Ledger's deploy command
  ([pp-infra → scripts](../../pp-infra/references/scripts.md#root-packagejson-scripts)).
- **Never pass `--discard-queued`** to teardown without the owner: it destroys queued events
  ([aws.md → Teardown](../../../../.ai/aws.md#teardown)). A teardown refused over a non-empty queue
  or DLQ is the expected verdict, not a failure to route around.
- **The drill trips the stack.** `pnpm aws:trip-drill` trips the kill switch for real (worker
  mapping disabled, every `LedgerApp-*` concurrency `0`, the stage throttle at its stop values) and
  restores at its end; `pnpm aws:deploy --budget-drill` trips it when the drill budget notifies.
  Until `pnpm aws:rearm` runs, ingest answers `429`, the CLI reads `api_unavailable` and
  `pnpm aws:deploy` refuses, so a step walked in that window fails for the trip, not for its own
  behavior. After a re-arm, run `pnpm aws:deploy` without the flag to remove the drill budget.

## Known issues

A new environment problem MUST be added here in the same run and committed with it: the exact error
text, the cause, the fast path, the run that saw it. A listed symptom gets its fast path at once,
never a retry loop.

| K | Symptom (exact error text) | Cause | Fast path | Seen |
| --- | --- | --- | --- | --- |
| K1 | `Refusing to run it — a worktree-isolated session's git operations must target its own worktree. Split it into plain, separate commands` | A worktree-isolated agent session's Bash guard rejects a command whose program or operand is computed at runtime: `export "$(grep '^LEDGER_URL=' .env.local)"` (Path C), a `{{.ServerVersion}}` template in a chained command, a `$VAR` path passed to `node`, `'bad id!'` in a chained line | Run each command alone; read `LEDGER_URL` with a plain `grep '^LEDGER_URL=' .env.local` and inline the loopback URL; pass literal paths, not variables | [slice 1 run, 2026-10-17](../../../../openspec/changes/archive/2026-10-17-slice-1-local-ledger-and-read-path/WALKTHROUGH-RUN.md) |
| K2 | `aws: command not found`; `echo "$AWS_REGION"` prints an empty line | The agent session's shell has no `AWS_PROFILE` or `AWS_REGION` and no AWS CLI on its PATH, though AWS CLI v2 is installed under `C:\Program Files\Amazon\AWSCLIV2\` | Set `AWS_PROFILE=ledger` and `AWS_REGION=us-east-2` in each command; call `& "C:\Program Files\Amazon\AWSCLIV2\aws.exe"` from PowerShell (the Bash guard, K1, rejects a quoted exe path) | [slice 2 run, 2026-10-18](../../../../openspec/changes/slice-2-durable-ingest-on-aws/WALKTHROUGH-RUN.md) |
| K3 | `Warning: SECURITY WARNING: The SSL modes 'prefer', 'require', and 'verify-ca' are treated as aliases for 'verify-full'.` on the stderr of `pnpm aws:deploy` and `pnpm aws:db-check` | The Neon URLs in `.env.local` carry `sslmode=require`; `pg-connection-string` warns. Harmless: no value printed, exit code unchanged | Ignore it when judging an "exactly these lines" step, or set `sslmode=verify-full` in both deploy URLs | [slice 2 run, 2026-10-18](../../../../openspec/changes/slice-2-durable-ingest-on-aws/WALKTHROUGH-RUN.md) |
| K4 | K1's refusal on `export X="$(cat <file>)"` or `X="$(cat <file>)" pnpm …`: a token or deployed URL read from a scratch file | The Bash guard rejects an environment value computed at runtime | From PowerShell: `$env:LEDGER_URL=(Get-Content <file> -Raw).Trim()`, then `pnpm -s ledger …` in the same command; for `.env.deployed.local`, the loader in the Deployed-walks trap above | [slice 2 run, 2026-10-18](../../../../openspec/changes/slice-2-durable-ingest-on-aws/WALKTHROUGH-RUN.md) |
