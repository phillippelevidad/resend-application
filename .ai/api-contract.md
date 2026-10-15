# API contract

> **TEMPLATE — not ratified.** Bootstrap step 9 in [bootstrap-checklist.md](bootstrap-checklist.md). The preview content below is illustrative, drafted from [docs/idea.md](../docs/idea.md) without research. Nothing here is binding until this banner and the instructions comment are removed.

<!-- AGENT INSTRUCTIONS
Purpose: The design contract for every Ledger operation: identity, route + verb (design intent),
  the surfaces that expose it (SDK method, CLI command, MCP tool), kind, scope, errors,
  idempotency and rate limits, and the slices that build it. Plus the error-code registry. The
  OpenAPI document generated from apps/api is authoritative for the wire; this file is
  authoritative for intent and coverage. It MUST NOT re-type request/response fields: link
  data-modeling.md sections instead.
Consumers: wf-before-propose (greps `Slices:` lines; reads #conventions once per pre-proposal);
  wf-after-propose-check (BLOCKS any change that cites an operation id missing from this file —
  check.mjs section 13 — so this file MUST be final before the first opsx:propose);
  wf-after-apply-check (flags operation-shaped names absent here); apps/api, packages/sdk,
  apps/cli, apps/mcp implementers.
Inputs (read first): root AGENTS.md (Error shape; Permissions: changing a read-API route, an error
  code, a CLI command or flag, or an MCP tool is Ask-first); .ai/AGENTS.md; features.md (journeys,
  lifecycle); architecture.md (ADRs, build order, slice ids); data-modeling.md (entity sections to
  link from In / Out); resend.md (RS-NN facts for anything touching Resend's API or rate limit);
  docs/idea.md §4, §5.7, §6.4, §7 incl. the 5-minute demo.
Research:
  - Resend's own API conventions (https://resend.com/docs/api-reference/introduction, /errors,
    /rate-limit, /pagination if present) so Ledger's errors and pagination feel familiar; cite
    pages, do not copy codes blindly.
  - MCP TypeScript SDK tool-registration semantics (how to omit tools by scope).
Parser contract (the wf-* scripts depend on it; do not restyle):
  - Operation entries are headed `#### ns.verbName`. Ids are lowerCamel namespace + verb; the verb
    MUST be camelCase or one of the gate's VERBS (get, list, start, rotate, ...). Until bootstrap
    step 14 adds redrive / replay / inspect / explain to VERBS, an id whose verb is one of those
    single words is invisible to the gate: prefer camelCase forms or record the gap. (No example id
    is written here on purpose: see the substring rule below.)
  - Bullets, in order: Operation · Surfaces · Kind · Scope · In / Out · Errors ·
    Idempotency / rate limit · Slices (always last; `<ID> — <Title>` exactly as the card heading).
  - Paths use `{param}`, never `:param` (the gate's path regex cannot see `:param`).
  - The gate is a SUBSTRING match on this file. An operation id written anywhere here (even in
    Coverage or prose) satisfies it. So an id MUST NOT appear in this file without its own entry:
    name not-yet-entered operations descriptively until their entry exists.
Required structure (headings MUST exist, in this order): `## Conventions` (anchor cited by skills;
  auth + scopes, pagination, error shape pointer, idempotency, rate limits, versioning, redaction)
  · `## Error codes` (registry table) · `## Operation template` · `## Read operations` ·
  `## Operate operations` · `## Ingest boundary` · `## Coverage`.
Evidence rules: every rate-limit or idempotency statement cites resend.md RS-NN or aws.md AWS-NN
  or a test. Every error code names the component that raises it.
Owner decisions to surface (one batched round; all are Ask-first public contract):
  - Token model: static bearer tokens with read/operate scopes vs. IAM auth (recommend bearer,
    two scopes, per idea §5.7).
  - Pagination style: cursor `after` mirroring Resend vs. offset (recommend cursor).
  - Whether `explain_delivery` is an API operation or MCP-only logic over email.get (recommend an
    SDK-level function, so CLI and MCP share it).
  - The final error-code list.
Done when: banner and this comment removed; every idea §4 job and every 5-minute-demo step maps to
  an operation in Coverage; every operation has a full entry; the error-code registry is complete
  and AGENTS.md#error-shape points here; a Zod enum in packages/core mirrors the registry with a
  test that fails on drift (task owed to the slice that creates packages/core error types).
-->

**Altitude.** Design intent, not a DTO mirror. Field shapes live in [data-modeling.md](data-modeling.md)
and the generated OpenAPI document. One contract, four surfaces: every read-API operation is exposed
by the SDK, and the CLI and MCP server are built on the SDK, never on the database
([AGENTS.md → Module boundaries](../AGENTS.md#module-boundaries)).

## Conventions

Stated once here and cited by every entry.

- **Auth.** Bearer token on every route except `POST /webhooks/resend` (signature-verified, see
  [Ingest boundary](#ingest-boundary)). Two scopes: `read` and `operate`. `operate` implies `read`.
- **Public contract (MUST).** Routes, error codes, CLI commands and flags, and MCP tool names are a
  public contract: changing or removing one is **Ask-first** ([AGENTS.md → Permissions](../AGENTS.md#permissions)).
- **MCP least privilege.** Operate tools MUST NOT be registered unless the token carries `operate`
  and the server is started with operate tools explicitly enabled. Tool output MUST NOT contain
  secrets; address and subject redaction is a server option.
- **Errors.** One shape everywhere ([AGENTS.md → Error shape](../AGENTS.md#error-shape)); codes from
  [Error codes](#error-codes) only. CLI `--json` prints the same object and exits non-zero.
- **Pagination.** Cursor-based (`after`, `limit`) `[Unverified]` — owner decision pending.
- **Idempotency.** Reads are idempotent; the SDK retries reads only. Operate commands state their own
  idempotency in their entry.
- **Rate limits.** Ledger's own API: none in v0 (single team, self-hosted). Operations that call
  Resend consume the shared team budget owned by `packages/resend-client` (cite resend.md RS-NN).
- **Versioning.** Unversioned paths in v0; breaking changes are Ask-first and noted here.

## Error codes

The canonical registry. [AGENTS.md → Error shape](../AGENTS.md#error-shape) keeps the shape and
points here. A Zod enum in `packages/core` MUST mirror this table, with a test that fails when they
drift. _(Preview rows.)_

| Code | HTTP | Meaning | Hint | Docs | Raised by |
| --- | --- | --- | --- | --- | --- |
| `unauthorized` | 401 | Missing or invalid bearer token, or a scope the operation needs is absent | Check `LEDGER_TOKEN` and its scope | `docs/` page TBD | apps/api auth middleware |
| `email_not_found` | 404 | No events recorded for this email id | Events may still be in the queue, or missed: run `ledger gaps` | `docs/` page TBD | email.get |
| `webhook_disabled` | 409 | The Resend webhook is disabled, so replays will not be delivered | Re-enable it in the Resend dashboard, then run `ledger reconcile` | [Retries and replays](https://resend.com/docs/webhooks/retries-and-replays) | reconcile.start, scheduled reconciler |
| `rate_limited` | 429 | Resend's shared rate limit is exhausted for now | Retry after the `retry-after` interval; the run resumes | [Usage limits](https://resend.com/docs/api-reference/rate-limit) | packages/resend-client via reconcile.start |

## Operation template

```text
#### {ns.verbName}

- **Operation:** `{ns.verbName}` → `{VERB} /{path}/{param}` _(design intent; OpenAPI authoritative)_
- **Surfaces:** SDK `ledger.{ns}.{verb}` · CLI `ledger {command} [--json]` · MCP `{tool_name}`
- **Kind:** read `[resource | view-shaped]` · or **command**
- **Scope:** `read` | `operate` · **Public contract:** yes (Ask-first)
- **In / Out:** by reference to data-modeling.md sections. No field lists
- **Errors:** codes from the registry
- **Idempotency / rate limit:** what retries are safe; whether it consumes the Resend budget
- **Slices:** {ID} — {Title}
```

## Read operations

#### email.get

- **Operation:** `email.get` → `GET /emails/{email_id}` _(design intent; OpenAPI authoritative)_
- **Surfaces:** SDK `ledger.emails.get` · CLI `ledger email <id> [--json]` · MCP `get_email_status`
- **Kind:** read `[view-shaped]` — projected state plus the full event timeline
- **Scope:** `read` · **Public contract:** yes (Ask-first)
- **In / Out:** email id → [email_state](data-modeling.md#email_state--current-state-per-email) + timeline from [webhook_events](data-modeling.md#webhook_events--the-immutable-ledger)
- **Errors:** `unauthorized`, `email_not_found`
- **Idempotency / rate limit:** idempotent; SDK MAY retry. No Resend call
- **Slices:** 1 — Local v0

#### recipient.get

- **Operation:** `recipient.get` → `GET /recipients/{address}` _(design intent; OpenAPI authoritative)_
- **Surfaces:** SDK `ledger.recipients.get` · CLI `ledger recipient <address> [--json]` · MCP `get_recipient_status`
- **Kind:** read `[resource]` — deliverability and the email that caused it
- **Scope:** `read` · **Public contract:** yes (Ask-first)
- **In / Out:** address (lowercased server-side) → [recipient_state](data-modeling.md#recipient_state--deliverability-per-address)
- **Errors:** `unauthorized`; unknown address returns `ok`/empty vs. a not-found code — owner decision
- **Idempotency / rate limit:** idempotent. No Resend call
- **Slices:** 1 — Local v0

#### gaps.list

- **Operation:** `gaps.list` → `GET /gaps` _(design intent; OpenAPI authoritative)_
- **Surfaces:** SDK `ledger.gaps.list` · CLI `ledger gaps [--since 24h] [--json]` · MCP `list_gaps`
- **Kind:** read `[view-shaped]` — latest reconcile runs and their missing counts
- **Scope:** `read` · **Public contract:** yes (Ask-first)
- **In / Out:** time window → [reconcile_runs](data-modeling.md#reconcile_runs--one-row-per-recovery-run) summaries
- **Errors:** `unauthorized`
- **Idempotency / rate limit:** idempotent. No Resend call (reads recorded runs only)
- **Slices:** 3 — Recovery

## Operate operations

#### reconcile.start

- **Operation:** `reconcile.start` → `POST /reconcile` _(design intent; OpenAPI authoritative)_
- **Surfaces:** SDK `ledger.reconcile.start` · CLI `ledger reconcile [--dry-run] [--json]` · MCP `reconcile` (registered only with `operate` and explicit enablement; supports `dry_run`)
- **Kind:** **command** — runs one reconcile pass; `dry_run` reports missing ids without replaying
- **Scope:** `operate` · **Public contract:** yes (Ask-first)
- **In / Out:** `dry_run`, lookback override → a [reconcile_runs](data-modeling.md#reconcile_runs--one-row-per-recovery-run) record
- **Errors:** `unauthorized`, `webhook_disabled`, `rate_limited`
- **Idempotency / rate limit:** safe to repeat: replays carry the original `svix-id` and dedupe on ingest `[Unverified]` (cite resend.md RS-NN). **Consumes the shared Resend 10 req/s team budget** (List Events, Retrieve Webhook, Replay Event) through `packages/resend-client`; concurrent runs MUST be serialized
- **Slices:** 3 — Recovery

## Ingest boundary

`POST /webhooks/resend` is **not an SDK operation** and has no CLI or MCP surface. It is the inbox
Resend (via Svix) calls: signature and timestamp verified on the raw body, enqueued, `200`; `401`
on a bad signature; `503` when enqueue fails so Resend retries
([idea §5.2](../docs/idea.md#52-ingest)). Its behavior is specified by the ingest slice and
resend.md, not by the error-code registry (Svix does not read Ledger's error body).

## Coverage

Every [idea §4](../docs/idea.md#4-users-and-jobs-to-be-done) job and every
[5-minute-demo](../docs/idea.md#the-5-minute-demo-this-builds-toward) step MUST map to an
operation, a simulator run, or a stated "not an operation". _(Preview; unentered operations are
named descriptively so the gate's substring match cannot be satisfied by this table.)_

| Need | Source | Operation |
| --- | --- | --- |
| App developer: is this address still deliverable? | idea §4 | `recipient.get`; app callback is a producer contract (reactions slice), not an operation |
| Support: what happened to this email? | idea §4 | `email.get`, `recipient.get` |
| Operator: did we lose anything? recover it | idea §4 | `gaps.list`, `reconcile.start`; health read (entry owed); DLQ inspect and redrive (entries owed) |
| Agent: explain why delivery failed | idea §4 | `email.get` + explanation function (entry or SDK-only decision owed) |
| Demo 1–3: burst, DB outage, drain, invariants | demo | simulator runs, not operations; health read for queue depth (entry owed) |
| Demo 4: gap shown, then closed | demo | `gaps.list` → `reconcile.start` |
| Demo 5: agent answers via MCP | demo | `email.get` via MCP `get_email_status` + explanation tool |
