# Resend

> **TEMPLATE — not ratified.** Bootstrap step 4 in [bootstrap-checklist.md](bootstrap-checklist.md). The preview content below is illustrative, drafted from [docs/idea.md](../docs/idea.md) without research. Nothing here is binding until this banner and the instructions comment are removed.

<!-- AGENT INSTRUCTIONS
Purpose: The single canonical record of every Resend behavior Ledger relies on, as stable `RS-NN`
  facts, each with a cited page and the date it was checked. Code, ADRs and tests cite `RS-NN`
  instead of restating Resend behavior.
Consumers: anyone touching `apps/ingest`, `apps/reconciler`, `apps/dispatcher`,
  `packages/resend-client`, `packages/core` event types, the simulator's signed-traffic generator;
  architecture.md ADRs; integrations.md Part 1; about.md → Open questions.
Inputs (read first): root AGENTS.md (decision lens, Permissions); .ai/AGENTS.md; about.md (step 1
  output, esp. #open-questions); docs/idea.md §2.1, §2.2, §5.2, §5.5, §5.6, §6.4, §10.
Research (READ-ONLY):
  - Start at https://resend.com/docs/llms.txt; fetch any page as `.md` (append `.md` to its path).
  - Webhooks: /docs/webhooks/introduction, /docs/webhooks/verify-webhooks-requests,
    /docs/webhooks/retries-and-replays, /docs/webhooks/event-types and every
    /docs/webhooks/emails/<type> page, /docs/webhooks/how-to-store-webhooks-data,
    /docs/webhooks/ingester.
  - Headless Webhook API: every page under /docs/api-reference/webhooks/ (list-events, get-event,
    list-event-attempts, replay-event, rotate signing secret, retrieve/list/create/update webhook).
    Record request params, response fields, pagination, error codes, required API-key permission.
  - /docs/api-reference/rate-limit (limit, headers, scope); /docs/api-reference/errors;
    /docs/dashboard/emails/idempotency-keys (key format, TTL, conflict behavior);
    /docs/api-reference/api-keys (permission levels).
  - `resend` Node SDK: the published package's types for `webhooks.verify` and the webhook methods
    (record the version read). Svix docs only where Resend defers to them (tolerance, multi-secret
    header format `v1,<sig> v1,<sig>`), cited as Svix, not as Resend.
  - Resend CLI: `resend webhooks listen` (blog post "Resend CLI 2.0" and CLI docs).
  - Ingester issue #12 (replay keeps svix-id) is community evidence, not Resend docs: cite it as
    such and keep the claim in [Unverified] unless a Resend page settles it.
  - NO live write calls (replay, rotate secret, create/update webhook, send email). Any live
    experiment that writes is Ask-first; propose it under "What would settle it" instead.
Required structure (headings MUST exist, in this order): fact lines (**API:** / **Code:** /
  **Env:**) · `## Verdict` · `## Facts` (table: Id | Fact | Source | Checked on) · `## Mechanisms`
  (one `###` per capability; each ends with a **Consequence for Ledger:** line) ·
  `## Constraints and sharp edges` (numbered; impact + resolution) · `## Onboarding reality` ·
  `## [Unverified]` (Claim | Why unsettled | What would settle it) · `## Sources`
  (Source | Supports | Checked on).
Evidence rules:
  - Every fact cites a Resend page (or SDK version) + the date checked. Quote verbatim where the
    wording carries the behavior (retry schedule, auto-disable, replay semantics, rate limit).
  - `RS-NN` ids are stable: never renumber, never reuse. A retired fact keeps its row, struck
    through, with the reason.
  - Unsettled → an [Unverified] row here AND an entry in about.md#open-questions. Never guess.
  - No account ids, webhook ids, endpoint URLs, API keys or real recipient addresses. Use
    Resend's test addresses (`delivered@resend.dev`, `bounced@resend.dev`, …).
Owner decisions to surface (one batched round, each with a recommended pick):
  - Whether to run a live, Ask-first experiment to settle any [Unverified] row the docs don't
    (e.g. replay svix-id, rotation overlap), and on which account.
  - API-key permission level Ledger requires (read-only vs full access) if replay needs full.
Done when: every [Preview] row is replaced by a cited fact or moved to [Unverified]; every
  behavior idea §2.1 and §6.4 depend on has an RS-NN; contradictions with idea.md are listed under
  Constraints with a resolution; this banner and comment are removed.
-->

**Resend**, the email provider whose webhooks Ledger ingests and whose Headless Webhook API Ledger
uses for recovery. The account is the **owner's** (one team, one webhook endpoint). Research
current as of **`<date>`**, from Resend's published docs and the `resend` Node SDK `<version>`.

**API:** `https://api.resend.com` · Bearer API key · 10 req/s per team `[Preview]`
**Code:** `packages/resend-client` (sole caller, [integrations.md](integrations.md)) · signature
verification in `apps/ingest`
**Env:** `RESEND_API_KEY`, `RESEND_WEBHOOK_SECRETS` (list, for rotation) `[Preview — names TBD]`

## Verdict

`[Preview]` Resend gives Ledger everything the design needs: signed deliveries with a stable id,
a published retry schedule, and a programmatic way to list and replay events. The two gaps that
shape the design are the **shared** rate limit (recovery competes with the team's sending) and
the **auto-disable** of failing endpoints (replays to a disabled endpoint go nowhere).

## Facts

| Id | Fact | Source | Checked on |
| --- | --- | --- | --- |
| RS-01 | `[Preview]` Deliveries are signed via Svix: `svix-id`, `svix-timestamp`, `svix-signature`. Verification MUST use the raw body. | verify-webhooks-requests | — |
| RS-02 | `[Preview]` Retry schedule after a failure: immediately, 5s, 5m, 30m, 2h, 5h, 10h, 10h (≈ 27.6h). | retries-and-replays | — |
| RS-03 | `[Preview]` Endpoints that keep failing are auto-disabled; a disabled endpoint receives nothing, replays included. | retries-and-replays | — |
| RS-04 | `[Preview]` List Events: `id`, `type`, `created_at`, `status`; newest first; cursor `after`; max 100/page. | list-events | — |
| RS-05 | `[Preview]` Replay Event adds one delivery and does not change the retry schedule; succeeded and failed events are both replayable. | replay-event | — |
| RS-06 | `[Preview]` 10 req/s per team, shared across keys; IETF `ratelimit-*` and `retry-after` headers. | rate-limit | — |
| RS-07 | `[Preview]` Send accepts an idempotency key; a retried send with the same key does not send twice. | idempotency-keys | — |
| RS-08 | `[Preview]` Email event types: `email.scheduled`, `sent`, `delivered`, `delivery_delayed`, `bounced`, `failed`, `suppressed`, `complained`, `opened`, `clicked`, `received`; plus contact, domain, topic, suppression, inbox. | event-types | — |
| RS-09 | `[Preview]` Bounce payloads carry `bounce.type` and `bounce.subType`. | emails/bounced | — |
| RS-10 | `[Preview]` Email data is retained 30 days (more on Enterprise). | how-to-store-webhooks-data | — |
| RS-11 | `[Preview]` The SDK exposes `webhooks.verify` over the Svix scheme. | `resend` SDK types | — |
| RS-12 | `[Preview]` `resend webhooks listen` tunnels live webhooks to localhost. | Resend CLI 2.0 | — |

## Mechanisms

### Signing and verification (RS-01, RS-11)

`[Preview]` Shapes to record: header names, signature format (`v1,<base64>`; space-separated when
several secrets sign), timestamp tolerance, the exact SDK signature of `webhooks.verify`.
**Consequence for Ledger:** ingest verifies against a list of secrets before enqueueing; the raw
body survives API Gateway untouched ([aws.md](aws.md)). Responses per idea §5.2.

### Delivery, retries and auto-disable (RS-02, RS-03)

`[Preview]` Record: what counts as failure (status codes, timeout), the delivery timeout, the
disable threshold, whether re-enabling resumes pending retries.
**Consequence for Ledger:** ingest returns `200` only after a durable enqueue; the reconciler
checks the endpoint is enabled before replaying and fails with `webhook_disabled`.

### Headless Webhook API (RS-04, RS-05)

`[Preview]` One sub-list per endpoint: List Events, Retrieve Event, List Attempts, Replay Event,
Rotate Signing Secret, Retrieve Webhook. For each: params, response fields, pagination, required
key permission, error codes.
**Consequence for Ledger:** the reconciler compares ids, not statuses (idea §5.5), and replays
through normal ingest, so dedup applies unchanged.

### Rate limits (RS-06)

`[Preview]` Record the header names and semantics verbatim, and whether the limit is per team or
per key. **Consequence for Ledger:** `packages/resend-client` owns one token bucket with headroom
below the limit; backs off on `retry-after`.

### Idempotent sends (RS-07)

`[Preview]` Record key format, length limit, retention window, behavior on same key + different
body. **Consequence for Ledger:** alert keys derive from the outbox `dedupe_key`.

### Event types and payloads (RS-08, RS-09)

`[Preview]` One row per email event type: payload fields Ledger reads (`email_id`, `created_at`,
`to`, `bounce.*`). **Consequence for Ledger:** `packages/core` event schemas (Zod) mirror these;
unknown types are stored raw.

### Retention and local development (RS-10, RS-12)

`[Preview]` **Consequence for Ledger:** retention bounds the reconciler's lookback (see
[Unverified]); `resend webhooks listen` is the phase-1 real-traffic loop.

## Constraints and sharp edges

1. `[Preview]` **Shared 10 req/s budget.** A reconcile run can starve the team's sending.
   Resolution: client-side limiter with headroom; reconcile cadence is an open question.
2. `[Preview]` **Disabled endpoint swallows replays.** Resolution: Retrieve Webhook before any
   replay; alarm and stop.
3. `[Preview]` **Retry window (~27.6h) is shorter than plausible outages.** Resolution: SQS
   retention buffers DB outages; the reconciler covers ingest outages.
4. `[Preview]` **New events take ~8s to appear in List Events.** Resolution: grace window.

## Onboarding reality

`[Preview]` Steps a self-hoster takes, each marked self-serve or manual: create account → verify a
sending domain (needed for alert emails) → create an API key with the right permission → create
the webhook endpoint (dashboard or API) and copy its signing secret → subscribe to email events.
Note which steps the owner's account has already done, without ids.

## [Unverified]

| Claim | Why unsettled | What would settle it |
| --- | --- | --- |
| A replay carries the **same `svix-id`** as the original, equal to the List Events `id` | Community-verified (Ingester #12), not stated in Resend docs | A Resend page; or an Ask-first live replay comparing ids |
| After Rotate Signing Secret, both secrets sign for an **overlap** period | Svix supports it; Resend's page does not say | Resend docs; or an Ask-first rotation on a test endpoint |
| How far back **List Events** reaches | Data retention (RS-10) is stated for emails, not for webhook events | Resend docs; or paging a long-lived account to its oldest event |
| `created_at` is assigned when the **event occurred**, not when it was generated | Not stated; affects projection tie-breaking | Resend docs; or comparing `created_at` across a bounce's timeline |

## Sources

| Source | Supports | Checked on |
| --- | --- | --- |
| `[Preview]` https://resend.com/docs/webhooks/verify-webhooks-requests | RS-01 | — |
| `[Preview]` https://resend.com/docs/webhooks/retries-and-replays | RS-02, RS-03 | — |
| `[Preview]` https://resend.com/docs/api-reference/webhooks/list-events | RS-04 | — |
| `[Preview]` https://resend.com/docs/api-reference/rate-limit | RS-06 | — |
| `[Preview]` https://github.com/resend/resend-webhooks-ingester/issues/12 | Replay svix-id (community) | — |
