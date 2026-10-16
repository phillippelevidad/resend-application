# Environment

What exists to walk, which slice lands each surface, and the traps that fake a verdict. Each slice
that lands or changes how a surface starts (a command, a port, an environment variable name)
updates [Surfaces by slice](#surfaces-by-slice) in the same change.

## Fast path

1. **What exists today** is root [AGENTS.md → Commands](../../../../AGENTS.md#commands), the
   canonical list. Walkable now: `pnpm dev:full` (deps → Docker → compose Postgres → typecheck →
   `apps/local`; adopts this repo's server if already up, fails if another process holds port
   `3200`; ends `LEDGER READY` or `LEDGER START FAILED: <reason>`) and `pnpm dev:stop`;
   `pnpm --filter @ledger/app-local start` (serves the routeless read API on `127.0.0.1:3200`,
   every path `404` until slice 1); `pnpm db:up` (compose Postgres on
   `127.0.0.1:55432`); `pnpm --filter @ledger/app-cli start --help` (no commands yet; never
   `start -- --help`, pnpm 10.11 forwards the literal `--`); `pnpm --filter @ledger/app-mcp start`
   (stdio, no tools yet); `node scripts/secret-scan.mjs` (needs Docker; prints
   `secrets: canary caught 3/3 rules` then `secrets: repo clean (<k> commits scanned)`).
   `pnpm check` and `pnpm verify` are gates, never walked. Every other
   command lands with its slice and its Commands line.
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
| `node scripts/secret-scan.mjs` | 0 | The `secrets` stage, run alone; needs Docker. Canary first, then the full history of every ref | No || `pnpm dev:full` · `pnpm dev:stop` | 0 | Root scripts. `dev:full` brings up compose Postgres and `apps/local` on `127.0.0.1:3200`, adopting this repo's running server and failing on any other holder of the port, and prints `LEDGER READY` or `LEDGER START FAILED: <reason>`; `dev:stop` stops compose, and the dev server only if it belongs to this repo | No |
| Compose Postgres | 0 | `pnpm db:up` / `pnpm db:down`; `127.0.0.1:55432`, throwaway `ledger` credentials. Tests never use it (Testcontainers) | No |
| `apps/local`, routeless | 0 | `pnpm --filter @ledger/app-local start` (or `pnpm dev`, watch mode); `--port` (default `3200`, clear of the other local stacks on this machine), `--host` (default `127.0.0.1`, loopback only: a non-loopback host exits `1`). Stdout: `{"level":"info","message":"local server listening"}`; every path `404` until slice 1 | No |
| `ledger` CLI, no commands · MCP server, no tools | 0 | `pnpm --filter @ledger/app-cli start --help` (no `bin` until slice 1) · `pnpm --filter @ledger/app-mcp start` (stdio; an unknown flag exits non-zero) | No |
| CI run on a pushed commit | 0 | GitHub Actions on the pushed `HEAD`; read its conclusion. Never push a scratch commit to provoke one | No |
| `pnpm sim` printing a projection | 0 | Root script; no live process | No |
| `apps/local`: ingest `POST /webhooks/resend`, worker, read API | 1 | `pnpm --filter @ledger/app-local start` (slice 0's start command; slice 1 adds the routes and any database flag, in Commands). Auth skipped only on loopback ([Conventions → Auth in slice 1](../../../../.ai/api-contract.md#conventions)) | No |
| `ledger email <email_id>` · `ledger recipient <address>` | 1 | `LEDGER_URL`; `LEDGER_TOKEN` from slice 2 (no `--token` flag, [pp-cli](../../pp-cli/SKILL.md)) | No |
| `pnpm sim --duplicates 0.2 --shuffle` | 1 | Against `apps/local` | No |
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
- **Reproduce with the printed seed.** Reuse its run namespace only on a fresh database
  ([simulator.md → Seed and determinism](../../pp-testing/references/simulator.md#seed-and-determinism)).
- **Test sends count against quota** ([RS-32](../../../../.ai/resend.md#facts)), and `resend.dev`
  sends reach only the account owner's address ([RS-34](../../../../.ai/resend.md#facts)); whether
  test addresses are exempt is [RS-U14](../../../../.ai/resend.md#unverified).
- **`resend webhooks listen` creates a webhook** and needs your own public URL (RS-33). Killed
  without Ctrl+C it may leave the webhook behind ([RS-U18](../../../../.ai/resend.md#unverified)).
  Until [RS-U22](../../../../.ai/resend.md#unverified) is settled, forwarded deliveries may reach
  local ingest only as `401`s.
- **Listing webhooks may return signing secrets** (RS-05): never paste the response; record counts.
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
