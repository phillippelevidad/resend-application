# API contract

The design contract for every Ledger operation: identity, route, surfaces, scope, errors,
idempotency, and the slices that build it, plus the error-code registry. The OpenAPI document
generated from `apps/api` is authoritative for the wire. This file is authoritative for intent and
coverage. Field shapes live in [data-modeling.md](data-modeling.md); entries link there instead of
listing fields.

**One contract, four surfaces.** Every operation below is a read-API route, and the SDK exposes all
of them. The CLI and the MCP server are built on the SDK and never touch the database
([ADR-011](architecture.md#adr-011--one-contract-many-surfaces),
[module boundaries](../AGENTS.md#module-boundaries)). The webhook inbox is not an operation
([Ingest boundary](#ingest-boundary)).

## Conventions

Stated once here and cited by every entry. Where [idea §5.7](../docs/idea.md#57-interfaces-read-api-sdk-cli-mcp)
differs, this file wins. It differs on four points: path params are written `{param}`; the recipient
lookup moved to a request body; redaction is always on; and the simulator is `pnpm sim`, not a
`ledger` command ([ADR-016](architecture.md#adr-016--the-simulator-reaches-aws-only-through-an-opt-in-simulator-secret)).

- **Public contract (MUST).** Routes, error codes, CLI commands and flags, environment variables and
  MCP tool names are a public contract. Changing or removing one is **Ask-first**
  ([AGENTS.md → Permissions](../AGENTS.md#permissions)). Adding an operation, an optional field or an
  error code is additive, but it is still Ask-first because it extends the contract.
- **Base URL.** The read API is served from the same HTTP API as ingest
  ([ADR-010](architecture.md#adr-010--serverless-on-aws-cdk-an-app-stack-and-a-guardrails-stack)),
  and locally by the dev server running the same code (ADR-011). Paths are unversioned.
- **Auth.** `Authorization: Bearer <token>` on every route except `POST /webhooks/resend`. Tokens
  are opaque random strings stored hashed in
  [`api_tokens`](data-modeling.md#api_tokens--read-api-bearer-tokens). There are two scopes, `read`
  and `operate`, and `operate` implies `read`. A missing, unknown or revoked token gets `401`
  `unauthorized`. A valid token without the scope a route needs gets `403` `forbidden`. The deploy
  command issues the first `operate` token; later tokens come from [`token.create`](#tokencreate).
- **Auth in slice 1.** `api_tokens` lands in slice 2, so in slice 1 the SDK already sends the header
  and the local dev server skips the check. It MUST skip only while bound to a loopback address and
  MUST refuse to start on any other interface without a token store. From slice 2, every mode
  enforces. The request shape never changes, so no client changes between slices.
- **Client configuration.** The SDK takes `baseUrl` and `token`. The CLI and the MCP server read
  `LEDGER_URL` and `LEDGER_TOKEN` from the environment. There is no `--token` flag, so a token never
  lands in shell history.
- **Redaction (MUST).** Every surface returns masks, never raw PII. That covers addresses, subjects,
  display names and bounce diagnostics, and MCP tool output included. The raw payload is never
  returned ([data-modeling.md → PII & retention](data-modeling.md#pii--retention)). An address sent
  as input is hashed server-side for the lookup and echoed back only as its mask. Addresses travel
  only in request bodies, never in a path or query string, because URLs end up in access logs and
  proxies (lens clause 6).
- **Single objects.** Resend's convention is to carry an `object` field naming the resource
  (`email`, `recipient`, `reconcile_run`, …). Ledger does the same.
- **Pagination.** Ledger uses Resend's list envelope `{ object: "list", has_more, data }`
  ([Resend → Pagination](https://resend.com/docs/api-reference/pagination)). `limit` runs from 1 to
  100 and defaults to 20. `after` is the id of the last item seen. Pages run forward only, newest
  first, with no `before`, the way List Events works (RS-14). A bad cursor or an out-of-range
  `limit` is `validation_failed`. Only `gaps.list` and `token.list` paginate. `dlq.listMessages`
  returns the envelope with no cursor, because it is a sample ([AWS-50](aws.md#sqs)).
- **Errors.** The shape is the same everywhere ([AGENTS.md → Error shape](../AGENTS.md#error-shape)),
  and codes come only from [Error codes](#error-codes). Clients MUST treat an unknown `code` as a
  generic failure. The CLI exits `0` on success and `1` on any registry error. With `--json` it
  prints the error object to stdout; without it, it prints `message` and `hint` to stderr. It exits
  `2` on a usage error, which never reaches the API. An MCP tool failure is a tool execution error,
  `isError: true`, with the error object as its text content. It is not a JSON-RPC protocol error
  ([MCP spec → Tools](https://modelcontextprotocol.io/specification/2025-06-18/server/tools)).
- **Idempotency.** Reads are side-effect free, and the SDK retries them, and only them, on network
  errors, `429` and `5xx`, with backoff (slice 5, ADR-011). `recipient.get` is a read sent as a
  `POST`, so the SDK retries it too. Each operate command states its own idempotency. Ledger's API
  takes no `Idempotency-Key` header in v0, because every command is either naturally idempotent or
  refuses to run concurrently.
- **Rate limits.** Ledger's own API sets none in v0: one installation, one team
  ([about.md → Platform scale assumptions](about.md#platform-scale-assumptions)). Only the HTTP API
  throttle applies. It answers with its own `429`, not this error shape (AWS-14), and the kill
  switch lowers it on a trip. `reconcile.start` is the only operation that consumes Resend's shared
  10 req/s team budget. It goes through `packages/resend-client` at 2 req/s, which yields when
  `ratelimit-remaining` runs low (RS-19, RS-20, [ADR-012](architecture.md#adr-012--resend-client-is-the-sole-resend-api-caller)).
- **Long-running commands.** An HTTP API integration times out at 30 s and the limit cannot be
  raised (AWS-02). A command that can outlast it starts asynchronously, answers `202` with a handle,
  and is polled. The CLI waits by default and takes `--no-wait`.
- **MCP least privilege (MUST).** The MCP server runs over stdio with one static credential. At
  startup it reads its own scope through [`token.getCurrent`](#tokengetcurrent). Operate tools are
  registered only when the token carries `operate` **and** the server was started with
  `--enable-operate`. Otherwise they are absent from `tools/list`, not merely refused. Registration
  is decided at startup, so no runtime toggling is needed. Read tools carry `readOnlyHint: true`.
  Operate tools carry `readOnlyHint: false`, `destructiveHint: false` and `idempotentHint: true`.
  Annotations are hints that clients treat as untrusted, so scope enforcement stays in the read
  API. Tool output never contains secrets or raw PII.
- **Versioning.** Paths are unversioned in v0. Clients MUST ignore unknown response fields. A
  breaking change is Ask-first and recorded here. The SDK and CLI follow semver once published
  (slice 8).

## Error codes

The canonical registry, and the only place error codes are listed.
[AGENTS.md → Error shape](../AGENTS.md#error-shape) keeps the shape and points here. A Zod enum in
`packages/core` mirrors this table. The enum lands with the first error in slice 1, and the test
that fails when the two drift lands in slice 5 (ADR-011). `docs` links a Resend page where Resend
behavior is the cause. Otherwise it links the runbook entry `docs/runbook.md#<code>` in this repo,
whose entries are owed by slice 3 and completed in slice 7.

| Code | HTTP | Meaning | Hint | Docs | Raised by |
| --- | --- | --- | --- | --- | --- |
| `unauthorized` | 401 | Bearer token missing, unknown or revoked | Set `LEDGER_TOKEN` to an active token | runbook | apps/api auth middleware |
| `forbidden` | 403 | The token is valid but lacks the scope this operation needs | Use an `operate` token, or ask its owner for one | runbook | apps/api auth middleware |
| `validation_failed` | 400 | Malformed input: bad id, address, duration, cursor or `limit` | `message` names the field | runbook | apps/api request validation (Zod) |
| `email_not_found` | 404 | No event recorded for this email id | Events may still be queued, or missed: run `ledger gaps` | runbook | `email.get`, `email.explainDelivery` |
| `recipient_not_found` | 404 | No event has ever named this address | Check the address. If it was emailed recently, run `ledger gaps` | runbook | `recipient.get` |
| `run_not_found` | 404 | No reconcile run with this id | List runs with `ledger gaps` | runbook | `reconcile.getRun` |
| `token_not_found` | 404 | No token with this id | List tokens with `ledger token list` | runbook | `token.revoke` |
| `reconcile_in_progress` | 409 | Another reconcile run is unfinished and still inside its time budget; runs never overlap (ADR-007) | Wait for it: `ledger gaps` | runbook | `reconcile.start` |
| `redrive_in_progress` | 409 | A DLQ redrive task is already running; SQS allows one per queue (AWS-21) | Wait for the DLQ depth in `ledger health` to fall | [Redrive](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-configure-dead-letter-queue-redrive.html) | `dlq.startRedrive` |
| `last_operate_token` | 409 | Revoking this token would leave no active `operate` token | Create another `operate` token first | runbook | `token.revoke` |
| `webhook_disabled` | — (run outcome) | The Resend webhook is disabled, so replays will not be delivered (RS-11, ADR-007) | Re-enable it in the Resend dashboard, then run `ledger reconcile` | [Retries and replays](https://resend.com/docs/webhooks/retries-and-replays) | apps/reconciler → `reconcile_runs.error_code` |
| `rate_limited` | — (run outcome) | Resend's shared rate limit left no room inside the run's time budget, so the run stopped before its horizon (RS-19) | The next run continues. Check what else is spending the team's budget | [Rate limit](https://resend.com/docs/api-reference/rate-limit) | apps/reconciler via packages/resend-client |
| `resend_auth_failed` | — (run outcome) | Resend rejected the reconciler's API key: missing, restricted or suspended (RS-22) | The reconciler needs a `full_access` key in its secret | [Errors](https://resend.com/docs/api-reference/errors) | apps/reconciler via packages/resend-client |
| `resend_unavailable` | — (run outcome) | Resend's API answered `5xx` past the client's retries (RS-22) | The next scheduled run retries | [Errors](https://resend.com/docs/api-reference/errors) | apps/reconciler via packages/resend-client |
| `database_unavailable` | 503 | Postgres is unreachable | The queue holds events meanwhile (ADR-015); retry, then `ledger worker resume` | runbook | packages/db through any database-reading operation; `worker.resumeEventSource` probe |
| `internal_error` | 500 | An unexpected server failure. `message` carries no internals | Retry; if it persists, read the API logs by request id | runbook | apps/api error handler |

A **run outcome** code is never an HTTP status of its own. It is stored in
[`reconcile_runs.error_code`](data-modeling.md#reconcile_runs--one-row-per-recovery-run) and comes
back as the run's `error` object, in the same shape, through `reconcile.getRun` and `gaps.list`.
`ledger reconcile` exits `1` with it.

## Operation template

```text
#### {ns.verbName}

- **Operation:** `{ns.verbName}` → `{VERB} /{path}/{param}` _(design intent; OpenAPI authoritative)_
- **Surfaces:** SDK `ledger.{ns}.{verb}` · CLI `ledger {command} [--json]` · MCP `{tool_name}` | none
- **Kind:** read `[resource | view-shaped]` · or **command**
- **Scope:** `read` | `operate` · **Public contract:** yes (Ask-first)
- **In / Out:** by reference to data-modeling.md sections. No field lists
- **Errors:** codes from the registry (`unauthorized` and `internal_error` apply everywhere and are not repeated)
- **Idempotency / rate limit:** what retries are safe; whether it consumes the Resend budget
- **Slices:** {ID} — {Title}
```

`ledger` in a Surfaces line is the SDK client instance. Every CLI command takes `--json`.

## Read operations

#### email.get

- **Operation:** `email.get` → `GET /emails/{email_id}` _(design intent; OpenAPI authoritative)_
- **Surfaces:** SDK `ledger.emails.get` · CLI `ledger email <email_id>` · MCP `get_email_status`
- **Kind:** read `[view-shaped]`: the projected state, every recipient's outcome, and the event timeline
- **Scope:** `read` · **Public contract:** yes (Ask-first)
- **In / Out:** email id → [email_state](data-modeling.md#email_state--current-state-per-email) + its [email_recipients](data-modeling.md#email_recipients--outcome-per-email-and-recipient) rows + a timeline from [webhook_events](data-modeling.md#webhook_events--the-immutable-ledger). Each timeline item gives `svix_id`, type, `event_created_at` and the bounce type and sub-type. Raw bounce diagnostics and the payload are never returned (they can hold the address)
- **Errors:** `validation_failed`, `email_not_found`, `database_unavailable`
- **Idempotency / rate limit:** idempotent, and the SDK retries it. No Resend call
- **Slices:** 1 — Local ledger and read path; 5 — MCP server and contract hardening

#### email.explainDelivery

- **Operation:** `email.explainDelivery` → `GET /emails/{email_id}/explanation` _(design intent; OpenAPI authoritative)_
- **Surfaces:** SDK `ledger.emails.explainDelivery` · CLI `ledger explain <email_id>` · MCP `explain_delivery`
- **Kind:** read `[view-shaped]`. A pure `packages/core` function over the same data as `email.get` and each recipient's [recipient_state](data-modeling.md#recipient_state--deliverability-per-address) produces a verdict from a closed set, a plain-language summary, the `svix_id`s it rests on, and next steps phrased as `ledger` commands. It is deterministic, with no LLM call (J6). One home, so the CLI, SDK and MCP cannot diverge
- **Scope:** `read` · **Public contract:** yes (Ask-first; the verdict set is part of it)
- **In / Out:** email id → explanation (masked, like `email.get`)
- **Errors:** `validation_failed`, `email_not_found`, `database_unavailable`
- **Idempotency / rate limit:** idempotent, and the SDK retries it. No Resend call
- **Slices:** 5 — MCP server and contract hardening

#### recipient.get

- **Operation:** `recipient.get` → `POST /recipients/lookup` _(design intent; OpenAPI authoritative)_
- **Surfaces:** SDK `ledger.recipients.get` · CLI `ledger recipient <address>` · MCP `get_recipient_status`
- **Kind:** read `[resource]`: deliverability and the email that caused it. It is sent as `POST` only so the address stays in the body ([Conventions → Redaction](#conventions))
- **Scope:** `read` · **Public contract:** yes (Ask-first)
- **In / Out:** address in the body. It is normalized and hashed server-side ([PII & retention](data-modeling.md#pii--retention)) and comes back as [recipient_state](data-modeling.md#recipient_state--deliverability-per-address)
- **Errors:** `validation_failed`, `recipient_not_found` (rather than `200 ok`, so an address never seen does not read as deliverable), `database_unavailable`
- **Idempotency / rate limit:** idempotent, and the SDK retries it. No Resend call
- **Slices:** 1 — Local ledger and read path; 5 — MCP server and contract hardening

#### health.get

- **Operation:** `health.get` → `GET /health` _(design intent; OpenAPI authoritative)_
- **Surfaces:** SDK `ledger.health.get` · CLI `ledger health` · MCP none
- **Kind:** read `[view-shaped]`. It reports queue depth and oldest-message age, DLQ depth (AWS-22), whether the worker's event source is enabled or paused (AWS-18, [ADR-015](architecture.md#adr-015--the-worker-pauses-its-own-event-source-on-a-database-outage)), database reachability, and the last reconcile run once one exists. In local mode the counts come from [local_queue_messages](data-modeling.md#local_queue_messages--the-local-mode-queue)
- **Scope:** `read` · **Public contract:** yes (Ask-first)
- **In / Out:** none → health summary. It has no table of its own: the queue and event-source fields come from SQS and Lambda, and only the last-run field reads [reconcile_runs](data-modeling.md#reconcile_runs--one-row-per-recovery-run)
- **Errors:** none of its own. It MUST answer during a database outage, reporting the database as unreachable rather than failing, because an outage is when the operator needs it
- **Idempotency / rate limit:** idempotent. No Resend call. One SQS attribute read and one Lambda read per call, inside the free tier (AWS-24)
- **Slices:** 2 — Durable ingest on AWS; 4 — Recovery; 2B — Local-mode queue and docker compose

#### gaps.list

- **Operation:** `gaps.list` → `GET /gaps` _(design intent; OpenAPI authoritative)_
- **Surfaces:** SDK `ledger.gaps.list` · CLI `ledger gaps [--since <duration>]` (default `24h`) · MCP `list_gaps`
- **Kind:** read `[view-shaped]`: reconcile runs in the window, newest first, each with its checked, missing, replayed and failed counts and its outcome `error`
- **Scope:** `read` · **Public contract:** yes (Ask-first)
- **In / Out:** `since`, `limit`, `after` → a list of [reconcile_runs](data-modeling.md#reconcile_runs--one-row-per-recovery-run)
- **Errors:** `validation_failed`, `database_unavailable`
- **Idempotency / rate limit:** idempotent, and the SDK retries it. No Resend call: it reads recorded runs only
- **Slices:** 4 — Recovery; 5 — MCP server and contract hardening

#### reconcile.getRun

- **Operation:** `reconcile.getRun` → `GET /reconcile/runs/{run_id}` _(design intent; OpenAPI authoritative)_
- **Surfaces:** SDK `ledger.reconcile.getRun` · CLI used by `ledger reconcile` to wait · MCP none (`list_gaps` covers agents)
- **Kind:** read `[resource]`: one run, running or finished, with its outcome `error`
- **Scope:** `read` · **Public contract:** yes (Ask-first)
- **In / Out:** run id → one [reconcile_runs](data-modeling.md#reconcile_runs--one-row-per-recovery-run) row
- **Errors:** `validation_failed`, `run_not_found`, `database_unavailable`
- **Idempotency / rate limit:** idempotent, and the SDK retries it. No Resend call
- **Slices:** 4 — Recovery

#### dlq.listMessages

- **Operation:** `dlq.listMessages` → `GET /dlq/messages` _(design intent; OpenAPI authoritative)_
- **Surfaces:** SDK `ledger.dlq.listMessages` · CLI `ledger dlq inspect [--limit <1-10>]` · MCP `inspect_dlq`
- **Kind:** read `[view-shaped]`. A **sample** of up to 10 dead messages plus the total depth. SQS has no complete listing (AWS-50). Each item gives `svix_id`, type, `email_id`, `event_created_at`, enqueue time and receive count. No address or subject, raw or masked, and no payload. Why a message failed is in the worker's logs under its `svix_id` (runbook)
- **Scope:** `read` · **Public contract:** yes (Ask-first)
- **In / Out:** `limit` (1–10) → the list envelope (`has_more` when the depth exceeds the sample). It parses only the [ingest envelope](architecture.md#adr-001--verify-then-enqueue) ids and type. In local mode it reads dead rows of [local_queue_messages](data-modeling.md#local_queue_messages--the-local-mode-queue)
- **Errors:** `validation_failed`
- **Idempotency / rate limit:** safe to repeat. It receives with a short visibility timeout and never deletes. Each receive adds to the count it reports, which is harmless on a DLQ with no redrive policy of its own (AWS-50). No Resend call
- **Slices:** 3 — Operations and evidence on AWS; 2B — Local-mode queue and docker compose; 5 — MCP server and contract hardening

#### token.getCurrent

- **Operation:** `token.getCurrent` → `GET /tokens/current` _(design intent; OpenAPI authoritative)_
- **Surfaces:** SDK `ledger.tokens.getCurrent` · CLI `ledger token current` · MCP none (the MCP server calls it at startup to decide which tools to register)
- **Kind:** read `[resource]`: the calling token's id, name and scope
- **Scope:** `read` · **Public contract:** yes (Ask-first)
- **In / Out:** none → the caller's [api_tokens](data-modeling.md#api_tokens--read-api-bearer-tokens) row, never its hash
- **Errors:** `database_unavailable`
- **Idempotency / rate limit:** idempotent. No Resend call
- **Slices:** 2 — Durable ingest on AWS; 5 — MCP server and contract hardening

#### token.list

- **Operation:** `token.list` → `GET /tokens` _(design intent; OpenAPI authoritative)_
- **Surfaces:** SDK `ledger.tokens.list` · CLI `ledger token list` · MCP none (agents never manage credentials)
- **Kind:** read `[resource]`: active and revoked tokens
- **Scope:** `operate` · **Public contract:** yes (Ask-first)
- **In / Out:** `limit`, `after` → a list of [api_tokens](data-modeling.md#api_tokens--read-api-bearer-tokens) rows, never a hash or a token
- **Errors:** `forbidden`, `validation_failed`, `database_unavailable`
- **Idempotency / rate limit:** idempotent. No Resend call
- **Slices:** 2 — Durable ingest on AWS

## Operate operations

#### reconcile.start

- **Operation:** `reconcile.start` → `POST /reconcile` _(design intent; OpenAPI authoritative)_
- **Surfaces:** SDK `ledger.reconcile.start` · CLI `ledger reconcile [--dry-run] [--lookback <duration>] [--no-wait]` · MCP `reconcile`, with `dry_run` (registered only under [MCP least privilege](#conventions))
- **Kind:** **command**. It starts one manual run of [ADR-007](architecture.md#adr-007--recovery-by-id-diff-and-replay-through-ingest) asynchronously and answers `202` with the run. `dry_run` reports missing ids without replaying any. The CLI then polls `reconcile.getRun` until the run finishes, and exits `1` with the run's `error` if it stopped on one
- **Scope:** `operate` · **Public contract:** yes (Ask-first)
- **In / Out:** `dry_run` and `lookback` (default 72 h per ADR-007, at most 30 days, the span Resend keeps email data, RS-31) → a [reconcile_runs](data-modeling.md#reconcile_runs--one-row-per-recovery-run) row with `trigger = manual`
- **Errors:** `forbidden`, `validation_failed`, `reconcile_in_progress`, `database_unavailable`. The run itself can end in `webhook_disabled`, `rate_limited`, `resend_auth_failed` or `resend_unavailable`
- **Idempotency / rate limit:** repeating is safe in effect, because replays re-enter through ingest and dedupe on `svix_id`. That holds only if a replay keeps the original `svix-id` ([RS-U01](resend.md#unverified)), which slice 4 MUST settle. Runs never overlap (`reconcile_in_progress`). **It consumes the shared Resend team budget** (List Events, Retrieve Webhook, Replay Event) through `packages/resend-client` at 2 req/s (RS-19, RS-20, ADR-012). It runs asynchronously because the HTTP API's 30 s timeout is shorter than a run (AWS-02, AWS-03)
- **Slices:** 4 — Recovery; 5 — MCP server and contract hardening

#### dlq.startRedrive

- **Operation:** `dlq.startRedrive` → `POST /dlq/redrive` _(design intent; OpenAPI authoritative)_
- **Surfaces:** SDK `ledger.dlq.startRedrive` · CLI `ledger dlq redrive` · MCP `redrive_dlq` (registered only under [MCP least privilege](#conventions))
- **Kind:** **command**. It moves every DLQ message back to the source queue with `StartMessageMoveTask` (AWS-21) and answers `202` with the depth at start. An empty DLQ answers `200` and starts no task. Progress shows as the DLQ depth falling in `health.get`. In local mode it clears `dead_at` and resets `receive_count` on dead rows of [local_queue_messages](data-modeling.md#local_queue_messages--the-local-mode-queue)
- **Scope:** `operate` · **Public contract:** yes (Ask-first)
- **In / Out:** none → the task handle and the starting depth
- **Errors:** `forbidden`, `redrive_in_progress`
- **Idempotency / rate limit:** safe to repeat. A second call while a task runs is refused (one active task per queue, AWS-21). Redriven messages get a new SQS `messageId`, and the worker dedupes on `svix_id`, so no event is applied twice (AWS-21, [ADR-004](architecture.md#adr-004--immutable-ledger-keyed-on-svix_id-one-transaction-per-message)). A poison message that is not yet fixed returns to the DLQ after `maxReceiveCount` (ADR-008). No Resend call
- **Slices:** 3 — Operations and evidence on AWS; 2B — Local-mode queue and docker compose; 5 — MCP server and contract hardening

#### worker.resumeEventSource

- **Operation:** `worker.resumeEventSource` → `POST /worker/resume` _(design intent; OpenAPI authoritative)_
- **Surfaces:** SDK `ledger.worker.resumeEventSource` · CLI `ledger worker resume` · MCP none
- **Kind:** **command**: the on-demand form of the hourly resume in [ADR-015](architecture.md#adr-015--the-worker-pauses-its-own-event-source-on-a-database-outage). It invokes the worker with the resume event. If the event source is paused, the worker probes Postgres and re-enables it when the probe succeeds. The command answers with the resulting state (`enabled`, or already enabled). While the kill switch is tripped the read API itself is stopped, so only the scripted re-arm can resume ([aws.md → Budget alarms](aws.md#budget-alarms))
- **Scope:** `operate` · **Public contract:** yes (Ask-first)
- **In / Out:** none → the event-source state, the same field `health.get` reports
- **Errors:** `forbidden`, `database_unavailable` (the probe failed, so the source stays paused)
- **Idempotency / rate limit:** idempotent. On an enabled source it is a no-op and opens no database connection. In local mode it is a no-op that reports the state. No Resend call
- **Slices:** 2 — Durable ingest on AWS

#### token.create

- **Operation:** `token.create` → `POST /tokens` _(design intent; OpenAPI authoritative)_
- **Surfaces:** SDK `ledger.tokens.create` · CLI `ledger token create --name <name> --scope <read|operate>` · MCP none (an agent never mints credentials)
- **Kind:** **command**. It creates a token and returns its plaintext **once**. Only the hash is stored
- **Scope:** `operate` · **Public contract:** yes (Ask-first)
- **In / Out:** name and scope → the new [api_tokens](data-modeling.md#api_tokens--read-api-bearer-tokens) row plus the token
- **Errors:** `forbidden`, `validation_failed`, `database_unavailable`
- **Idempotency / rate limit:** **not** idempotent: each call mints a new token, and the SDK never retries it. A lost response leaves an unused token, which `token.list` shows and `token.revoke` removes. No Resend call
- **Slices:** 2 — Durable ingest on AWS

#### token.revoke

- **Operation:** `token.revoke` → `POST /tokens/{token_id}/revoke` _(design intent; OpenAPI authoritative)_
- **Surfaces:** SDK `ledger.tokens.revoke` · CLI `ledger token revoke <token_id>` · MCP none
- **Kind:** **command**. It sets `revoked_at`, and the row stays as an audit record. The next request with that token gets `401`, with no redeploy
- **Scope:** `operate` · **Public contract:** yes (Ask-first)
- **In / Out:** token id → the revoked [api_tokens](data-modeling.md#api_tokens--read-api-bearer-tokens) row
- **Errors:** `forbidden`, `validation_failed`, `token_not_found`, `last_operate_token` (so the installation is never locked out into hand-written SQL), `database_unavailable`
- **Idempotency / rate limit:** idempotent: revoking a revoked token returns it unchanged. No Resend call
- **Slices:** 2 — Durable ingest on AWS

## Ingest boundary

`POST /webhooks/resend` is **not an operation**: it has no SDK, CLI or MCP surface, and the error
registry does not apply to it. It is the inbox that Resend calls through Svix. It verifies the
signature and timestamp on the raw body against the configured secret set, enqueues, and returns
exactly `200` with a fixed short body. It returns `401` on a bad signature and `503` when the
enqueue fails, so Resend retries. The body never echoes the payload, PII or secrets, because
Resend stores responses ([ADR-001](architecture.md#adr-001--verify-then-enqueue),
[ADR-009](architecture.md#adr-009--multi-secret-verification-and-timestamp-tolerance), RS-10,
RS-12). The `401` does not stop Resend's retries
([resend.md → Constraint 4](resend.md#constraints-and-sharp-edges)).

## Coverage

Every [idea §4](../docs/idea.md#4-users-and-jobs-to-be-done) job, every
[journey](features.md#journeys) and every
[5-minute-demo](../docs/idea.md#the-5-minute-demo-this-builds-toward) step maps to an operation,
to a simulator run, or to a stated "not an operation".

| Need | Source | Operation |
| --- | --- | --- |
| App developer: is this address still deliverable? | idea §4 | `recipient.get` through the SDK or HTTP. The app callback is a producer contract (slice 6), not an operation |
| Support: what happened to this email? | idea §4, J2 | `email.get`, then `recipient.get` |
| Operator: did we lose anything? Recover it | idea §4, J3 | `gaps.list` → `reconcile.start` (`dry_run`, then for real) → `reconcile.getRun` → `gaps.list` |
| Operator: is the pipeline healthy? | J1 verify, J7 | `health.get` |
| Operator: poison message | J4 | `dlq.listMessages` → fix deployed → `dlq.startRedrive` → `health.get` |
| Operator: database came back before the hourly resume | ADR-015 | `worker.resumeEventSource` |
| Operator: issue or retire a token | [architecture.md → Open decisions](architecture.md#open-decisions) | `token.create`, `token.list`, `token.revoke` |
| Agent: explain why delivery failed | idea §4, J6 | `email.get` + `email.explainDelivery` over MCP. The MCP server picks its tools with `token.getCurrent` |
| Secret rotation | J5 | Not an operation: runbook plus the `ingest.rejected{reason}` metric (ADR-009) |
| First deploy, connect webhook, tear down | J1, [lifecycle](features.md#adopter-lifecycle) | Not operations: the deploy and teardown commands; the deploy command issues the first `operate` token |
| Demo 1–3: burst, database outage, drain, invariants | demo | `pnpm sim` runs (ADR-016), not operations; `health.get` shows queue depth and the paused event source |
| Demo 4: gap shown, then closed | demo | `gaps.list` → `reconcile.start` → `gaps.list` |
| Demo 5: agent answers via MCP | demo | MCP `get_email_status` and `explain_delivery` |
