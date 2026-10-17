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
   (`.env.local`, runtime role, migrations); `pnpm --filter @ledger/app-local start` (ingest,
   worker and read API on `127.0.0.1:3200`); `pnpm -s ledger email|recipient …` (the CLI);
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
| `pnpm db:setup` | 1 | Root script (`pnpm --filter @ledger/app-local run setup`; `setup` alone is a pnpm built-in); needs compose Postgres up (`pnpm db:up`), and `pnpm dev:full` runs it. Writes each of `DATABASE_URL`, `LEDGER_ADDRESS_HASH_KEY`, `LEDGER_SIMULATOR_SECRET`, `LEDGER_URL`, `LEDGER_TOKEN` to `.env.local` only when unset or empty, one `db:setup: wrote <NAME> to .env.local` line each (names, never values), ensures the runtime role, applies pending migrations, then `db:setup: ready` (exit `0`) or `db:setup: failed: <reason>` (exit `1`). A rerun prints only `db:setup: ready` | No |
| `apps/local`: ingest `POST /webhooks/resend`, worker, read API | 1 | `pnpm db:setup`, then `pnpm --filter @ledger/app-local start` (or `pnpm dev:full`, which does both). Needs `DATABASE_URL`, `LEDGER_ADDRESS_HASH_KEY` and at least one of `LEDGER_WEBHOOK_SECRETS` (comma-separated `whsec_` values, one per `resend webhooks listen` session) and `LEDGER_SIMULATOR_SECRET`; a missing or invalid one exits `1` with a line naming it. Every stdout line is the shared logger's JSON; ready at `message` `local server listening`. Any path but `POST /webhooks/resend` reaches the read API, an unmatched one `404 route_not_found`. Auth skipped only on loopback ([Conventions → Auth in slice 1](../../../../.ai/api-contract.md#conventions)) | No |
| `ledger email <email_id>` · `ledger recipient <address>` | 1 | `pnpm -s ledger email <email_id> [--json]` · `pnpm -s ledger recipient <address> [--json]`: the root script loads `.env.local` for `LEDGER_URL` and `LEDGER_TOKEN` (both required; no `--token` flag, [pp-cli](../../pp-cli/SKILL.md)). No `bin` until slice 8. Exit `0` success, `1` a registry error, `2` a usage error or a missing / invalid variable | No |
| `pnpm sim --duplicates 0.2 --shuffle` | 1 | Against `apps/local`: live iff `LEDGER_URL` is set and non-empty (the shell wins over `.env.local`), so after `pnpm db:setup` a bare `pnpm sim` is live. Also needs `LEDGER_SIMULATOR_SECRET`, `DATABASE_URL`, `LEDGER_ADDRESS_HASH_KEY` (missing → `sim: <NAME> is required when LEDGER_URL is set`, exit `2`). Prints the offline header and projection, then `sent requests=<k> accepted=<a>`, settles up to 30 s, prints the invariant 1 and 2 result lines and `invariant 3 not checked (slice 6)`, `invariant 4 not checked (slice 3)`; exit `0` iff both pass and `a = k`. Nothing listening exits `1` after the first request | No |
| `resend webhooks listen` | 1 | Resend CLI: `--url` your own public tunnel, `--forward-to` local ingest ([RS-33](../../../../.ai/resend.md#facts)) | **Yes**, per session |
| Deploy command · teardown command | 2 | Root scripts, names land in slice 2 ([pp-infra → scripts](../../pp-infra/references/scripts.md#root-packagejson-scripts)) | **Yes** (AWS) |
| `POST /webhooks/resend` (deployed) | 2 | The owner's Resend webhook; the verify-stage send | **Yes** (the send) |
| `ledger health` · `ledger worker resume` | 2 | Deployed read API; `ledger health` in local mode from 2B | No |
| `ledger token create\|list\|revoke\|current` | 2 | An `operate` token for create, list and revoke | No |
| Trip drill and re-arm scripts | 2 | Root scripts, names land in slice 2 | **Yes** (AWS) |
| `pnpm sim --burst 10000/10s` · `--chaos db-outage` · poison run | 3 | The owner's deployment, simulator flag set ([ADR-016](../../../../.ai/architecture.md#adr-016--the-simulator-reaches-aws-only-through-an-opt-in-simulator-secret)) | **Yes** (AWS) |
| `ledger dlq inspect` · `ledger dlq redrive` | 3 | Deployed; local mode from 2B | No |
| Alarm email | 3 | SNS email to the owner's inbox; only the owner can observe it | Owner-observed |
| `ledger gaps --since 24h` · `ledger reconcile --dry-run` · `ledger reconcile` · hourly cron run | 4 | Deployed; a real `ledger reconcile` replays events on the owner's webhook (RS-16) | **Yes** (replay; `--dry-run` reads only) |
| `docker compose up` · `pnpm sim` (local mode) | 2B | Local only; the local setup command issues the first `operate` token | No |
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
- **`LEDGER_TOKEN` is a placeholder in slice 1.** `pnpm db:setup` writes `local-loopback-no-auth`;
  the loopback server skips the check, so any value passes. A `200` proves nothing about auth until
  slice 2 enforces tokens.
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
  ([aws.md → Teardown](../../../../.ai/aws.md#teardown)).

## Known issues

A new environment problem MUST be added here in the same run and committed with it: the exact error
text, the cause, the fast path, the run that saw it. A listed symptom gets its fast path at once,
never a retry loop.

| K | Symptom (exact error text) | Cause | Fast path | Seen |
| --- | --- | --- | --- | --- |
