# Resend

**Resend** is the email provider whose webhooks Ledger ingests and whose Headless Webhook API
Ledger uses for recovery. This file is the canonical record of every Resend behavior Ledger relies
on. Code, ADRs and tests cite `RS-NN` instead of restating it. Research current as of
**2026-10-15**, from Resend's published docs (pages fetched as `.md`), the `resend` Node SDK
**6.33.0** types, and read-only calls against the owner's account (no ids recorded).

**API:** `https://api.resend.com` · Bearer API key · 10 req/s per team, shared across keys (RS-19)
**Code:** `packages/resend-client` (sole caller, [integrations.md](integrations.md)) · signature
verification in `packages/ingest`
**Env:** `RESEND_API_KEY` (the name the SDK examples and the Resend CLI read, RS-33). Signing
secrets live in Secrets Manager ([features.md → connect webhook](features.md#adopter-lifecycle));
their names are fixed in [integrations.md → Secrets layout](integrations.md#secrets-layout)

**Rules for this file (MUST).** `RS-NN` and `RS-UNN` ids are stable: never renumber, never reuse; a
retired fact keeps its row, struck through, with the reason. Every `[Unverified]` row names the
slice that owes it, which MUST settle it, or prove the design safe under either answer, before that
slice is done (owner, 2026-10-15). Live **write** experiments are Ask-first
([Permissions](../AGENTS.md#permissions)). Svix facts are labelled `[Svix]` and used only where
Resend defers to Svix.

## Verdict

Resend gives Ledger what the design needs: signed at-least-once deliveries with a `svix-id` that
retries keep, a published retry schedule, and an API to list, inspect and replay a webhook's events.
Four gaps shape the design:

- **One shared rate limit.** Recovery competes with the team's own sending (RS-19).
- **Auto-disable.** A failing endpoint is disabled and stops receiving (RS-11).
- **No read-only key.** The key that lists events can also read the signing secret and make
  every write (RS-05, RS-18).
- **Three unverified links in the recovery chain.** Whether a replay keeps the original `svix-id`
  (RS-U01) and carries a fresh `svix-timestamp` (RS-U20), and whether List Events ids are
  `svix-id`s (RS-U02). All three MUST be settled before the recovery slice
  ([slice 4](build-checklist.md#4--recovery)) is done.

## Facts

| Id | Fact | Source | Checked on |
| --- | --- | --- | --- |
| RS-01 | Deliveries carry `svix-id`, `svix-timestamp`, `svix-signature`. Verification MUST use the raw body: "The cryptographic signature is sensitive to even the slightest change." | verify-webhooks-requests | 2026-10-15 |
| RS-02 | SDK `webhooks.verify({ payload, headers: { id, timestamp, signature }, webhookSecret })` is synchronous, returns the parsed payload (`undefined`, unparsed, for an empty body) and throws on failure. In 6.33.0 it wraps `standardwebhooks@1.1.1`: **one secret per call** (`whsec_` prefix), only `v1` signatures checked, timestamps more than 5 min off rejected. The docs map `svix-*` headers to `id`/`timestamp`/`signature`. Re-checked against the pinned install in Constraint 12. | `resend@6.33.0` types and impl; verify-webhooks-requests | 2026-10-17 |
| RS-03 | `[Svix]` Signed content is `id.timestamp.body`, HMAC-SHA256 keyed with the base64 part after `whsec_`; `svix-signature` is "a list of space delimited signatures and their corresponding version identifiers"; Svix libraries reject timestamps "more than five minutes away (past or future)". Resend states no tolerance of its own. | Svix: verifying payloads (manual, why) | 2026-10-15 |
| RS-04 | "For 24 hours after the rotation, payloads are signed with both the new and the previous secret, so either one verifies them. After that, only the new secret does." | api-reference/webhooks/rotate-signing-secret | 2026-10-15 |
| RS-05 | "Calls to create, retrieve, or list webhooks will also return the signing secret in the response body." The List Webhooks example shows no `signing_secret`, while Create and Retrieve do (RS-13). The design assumes list returns it (the safe reading). | verify-webhooks-requests; get-webhook; list-webhooks | 2026-10-15 |
| RS-06 | "Resend webhooks provide **at-least-once** delivery … may be delivered more than once in rare cases." Dedupe: "Store processed `svix-id` values and skip any duplicates." The same paragraph calls `svix-id` "a unique identifier for each event delivery", which is ambiguous for replays (RS-U01). | webhooks/create-webhook (FAQ) | 2026-10-15 |
| RS-07 | "Events are sent as they occur, but **delivery order is not guaranteed** … an `email.opened` event could arrive before the `email.delivered` event for the same email." "If ordering matters for your application, use the `created_at` timestamp in the event payload to sort events after receipt." Which `created_at` is unstated (RS-U10). | webhooks/create-webhook (FAQ) | 2026-10-15 |
| RS-08 | Retries keep the `svix-id`. Resend: "Retries keep the same `svix-id` header, so dedupe on it" (written in the Inbox Events section) and the RS-06 dedupe advice; `[Svix]`: the id "will be the same when the same webhook is being resent (e.g. due to a previous failure)". Manual replays are not named: RS-U01. | event-types; create-webhook; Svix | 2026-10-15 |
| RS-09 | "Immediately / 5 seconds / 5 minutes / 30 minutes / 2 hours / 5 hours / 10 hours / 10 hours", "each period is started following the failure of the preceding attempt". 8 attempts; the last one starts ≈ 27 h 35 min after the first (computed; no page states a total). | webhooks/retries-and-replays | 2026-10-15 |
| RS-10 | "If Resend does not receive a 200 response from a webhook server, we will retry the webhooks." Another page names only 5xx; `[Svix]` treats any non-2xx (3xx included) as failure, 15 s timeout. Edges: RS-U07, RS-U08. | create-webhook (FAQ); how-to-store-webhooks-data; Svix retries | 2026-10-15 |
| RS-11 | "If a webhook endpoint keeps failing to receive events, Resend disables it automatically and sends an email notification to your team." "If an endpoint is removed or disabled, delivery attempts to the endpoint will be disabled as well." Re-enable from the dashboard or `PATCH` `status`. | retries-and-replays; update-webhook | 2026-10-15 |
| RS-12 | List Attempts `GET /webhooks/{webhook_id}/events/{event_id}/attempts`: `id`, `http_status_code`, `response` ("The response body your endpoint returned"), `sent_at`; most recent first; `limit` 1–100, `after`, no `before`. | list-event-attempts | 2026-10-15 |
| RS-13 | Webhook management: `POST /webhooks` (`endpoint`, `events` → `id`, `signing_secret`), `GET /webhooks/{id}` (`status`: `enabled`\|`disabled`, `endpoint`, `events`, `signing_secret`), `GET /webhooks` (`{object: "list", has_more, data}`), `PATCH /webhooks/{id}` (`endpoint`, `events`, `status`), `DELETE /webhooks/{id}`, `POST /webhooks/{id}/signing-secret/rotate`. | api-reference/webhooks/* | 2026-10-15 |
| RS-14 | List Events `GET /webhooks/{webhook_id}/events` is **per webhook**: `limit` 1–100 (default 20), `after` cursor, "The `before` parameter is not supported"; "most recent first"; items `id` (`msg_…`), `type`, `created_at`, `status` ∈ `success`, `failed`, `attempting`, `pending`. | list-events | 2026-10-15 |
| RS-15 | Retrieve Event `GET /webhooks/{webhook_id}/events/{event_id}` adds `payload` ("The event payload that was sent to your endpoint") and `next_attempt_at` ("`null` once the event reaches `success` or `failed`", so those two are terminal). | get-event | 2026-10-15 |
| RS-16 | "Replaying an event queues one additional delivery immediately. It's the same action as the dashboard's Replay button and does not affect the automatic retry schedule." "You can replay both `failed` and `succeeded` webhook messages." Delivered to the webhook's configured endpoint. `POST /webhooks/{webhook_id}/events/{event_id}/replay` returns `{ object: "webhook_event", id }`, `id` being "The event ID" (the path's `msg_` id). | replay-event; retries-and-replays | 2026-10-15 |
| RS-17 | Idempotency keys are supported on Send Email, Send Batch and three inbox endpoints only; no webhook endpoint (replay included) takes one. | dashboard/emails/idempotency-keys | 2026-10-15 |
| RS-18 | Two key permissions only: "`full_access`: Can create, delete, get, and update any resource. `sending_access`: Can only send emails." Other endpoints with a sending key → `401 restricted_api_key`; so the Headless Webhook API needs `full_access`, and no read-only key exists. `domain_id` scopes a `sending_access` key to one domain. Permission changes in the dashboard only; the key value is shown once. Live: the owner's key is `full_access` (`GET /api-keys` → 200). OAuth access tokens have the same two scopes ("`full_access` is required for every other API route"), so no read-only credential exists either way; `invalid_permission` 403 is the scope error. | api-keys/create-api-key; oauth/authorize; errors; live read | 2026-10-15 |
| RS-19 | "The default maximum rate limit is **10 requests per second per team**. This limit applies across all API keys associated with your team." Headers (IETF draft 06): `ratelimit-limit`, `ratelimit-remaining`, `ratelimit-reset` ("seconds until the limits are reset"), `retry-after`. Over the limit → `429 rate_limit_exceeded`. | api-reference/rate-limit; errors | 2026-10-15 |
| RS-20 | Live: responses carry `ratelimit-policy: 10;w=1`, `ratelimit-limit: 10`, `ratelimit-remaining`, `ratelimit-reset: 1`; no `retry-after` on a `200`; `remaining` fell 9 → 8 → 7 across three different endpoints (one budget across endpoints). | live read-only calls, owner's account | 2026-10-15 |
| RS-21 | "All API requests must include a `User-Agent` header. Requests without this header will be rejected with a `403`." The SDK sends one. | api-reference/introduction | 2026-10-15 |
| RS-22 | Error body `{ name, statusCode, message }`. Codes Ledger handles: `missing_api_key` 401, `restricted_api_key` 401/403, `suspended_api_key` 403, `validation_error` 400/401/403, `not_found` 404, `rate_limit_exceeded` 429, `daily_quota_exceeded`/`monthly_quota_exceeded` 429, `application_error` 500, `service_unavailable` 503. The 422 codes (`invalid_parameter`, `missing_required_field`, `missing_required_parameter`, `invalid_attachment`) are request bugs. The SDK's error-name union and this list differ. | api-reference/errors; `resend@6.33.0` types | 2026-10-15 |
| RS-23 | The SDK never throws on HTTP errors and never retries: it returns `{ data, error, headers }`, so `ratelimit-*` and `retry-after` are readable from `headers`. | `resend@6.33.0` impl | 2026-10-15 |
| RS-24 | `Idempotency-Key` header, 1–256 characters, "kept in the system for 24 hours". Same key and body → same response, no second send. Same key, different body → `409 invalid_idempotent_request`; in flight → `409 concurrent_idempotent_requests`. | idempotency-keys; send-email; errors | 2026-10-15 |
| RS-25 | Event types. Email (11): `email.scheduled`, `sent`, `delivered`, `delivery_delayed`, `bounced`, `failed`, `suppressed`, `complained`, `opened`, `clicked`, `received`. Plus `domain.*` (3), `contact.*` (4), `suppression.*` (2), `topic.*` (3), `inbox.*` (14). | webhooks/event-types | 2026-10-15 |
| RS-26 | Every payload is `{ type, created_at, data }`. Top-level `created_at`: "ISO 8601 timestamp when the webhook event was created." `data.created_at`: "when the email was created". | webhooks/emails/* | 2026-10-15 |
| RS-27 | Outbound email events share `data.email_id`, `data.to` ("Array of impacted recipient email addresses"), `from`, `subject`, `message_id`, `broadcast_id`, `template_id`, `tags`. | webhooks/emails/* | 2026-10-15 |
| RS-28 | `email.bounced`: "the recipient's mail server **permanently rejected the email**"; `data.bounce` = `{ type` (e.g. `Permanent`, `Temporary`), `subType` (e.g. `Suppressed`, `MessageRejected`), `message`, `diagnosticCode[] }`, camelCase. Several example values are not in the documented list (RS-35), so both fields are open strings. | event-types; emails/bounced | 2026-10-15 |
| RS-29 | `email.clicked` adds `data.click { ipAddress, link, timestamp, userAgent }`; `email.failed` adds `data.failed.reason`; `email.suppressed` shows `data.suppressed { message, type }` in its example only; `email.opened` adds nothing ("Open rates are not always accurate"). `email.complained`: delivered, then marked as spam. | event-types; emails/clicked, failed, suppressed, opened | 2026-10-15 |
| RS-30 | `email.received` carries metadata only: "Webhooks do not include the email body, headers, or attachments, only their metadata." | emails/received | 2026-10-15 |
| RS-31 | "Resend retains email data for 30 days across all plans (with flexible retention for Enterprise)." "By default webhooks are ephemeral." | how-to-store-webhooks-data | 2026-10-15 |
| RS-32 | Test addresses: `delivered@`, `bounced@` (SMTP 550 5.1.1), `complained@`, `suppressed@resend.dev`; `+label` works except on `suppressed@`; "Test emails count against your account's sending quota." | dashboard/emails/send-test-emails | 2026-10-15 |
| RS-33 | `resend webhooks listen` "registers a temporary webhook, streams matching events … and deletes the webhook when you exit" (a live **write**). `--url` (required, your own public tunnel), `--events` (default all), `--forward-to` ("passes original Svix headers"), `--port` (4318). API key: `--api-key` > `RESEND_API_KEY` > `resend login`. | docs/cli; docs/cli-agents | 2026-10-15 |
| RS-34 | "The `resend.dev` domain is only available for testing purposes and can only send emails to the email address associated with your Resend account." Otherwise `403 validation_error`. | knowledge-base/403-error-resend-dev-domain; errors | 2026-10-15 |
| RS-35 | Three bounce types: "`Permanent` - also known as "hard bounce," where the recipient's mail server rejects the email and will never be delivered"; "`Transient` - also known as "soft bounce," … it may be delivered in the future"; "`Undetermined` - … the bounce message didn't contain enough information for Resend to determine the underlying reason". Subtypes: `Permanent` → `General`, `NoEmail`; `Transient` → `General`, `MailboxFull`, `MessageTooLarge`, `ContentRejected`, `AttachmentRejected`; `Undetermined` → `Undetermined`. RS-28's examples `Temporary`, `Suppressed` and `MessageRejected` are not in this list. | dashboard/emails/email-bounces | 2026-10-15 |
| RS-36 | The dashboard's email events are `bounced`, `canceled`, `clicked`, `complained`, `delivered`, `delivery_delayed`, `failed`, `opened`, `queued`, `scheduled`, `sent`, `suppressed`. Two are not webhook types (RS-25): `canceled` ("The scheduled email was canceled (by user).") and `queued` ("The email created from Broadcasts or Batches is queued for delivery."). `delivery_delayed`: "Resend keeps retrying automatically for up to 14 hours. If the recipient's mail server still hasn't accepted the email by then, it's marked as `bounced`." Each event is defined alone; the page states no precedence between them. | dashboard/emails/manage-emails | 2026-10-16 |
| RS-37 | "An address is added to Suppressions for one of three origins": "`bounce`: the recipient's mail server permanently rejected the email", "`complaint`: the recipient marked your email as spam", "`manual`: you add the recipient's address yourself." The list works "by intentionally skipping sending to any addresses on your list"; "Future emails to addresses on the list will be marked as `suppressed` and won't be delivered until the address is removed." | dashboard/emails/email-suppressions; knowledge-base/why-are-my-emails-landing-on-the-suppression-list | 2026-10-16 |
| RS-38 | Retrieve Email returns one `last_event` per email (example: `"last_event": "delivered"` beside a `to` array): "See all available `last_event` types in the Email Events overview" (RS-36). | api-reference/emails/retrieve-email | 2026-10-16 |
| RS-39 | Live, each test address (RS-32) produced, in `created_at` order: `delivered@` → `email.sent`, `email.delivered`; `bounced@` → `email.sent`, `email.bounced` with `bounce.type` `Permanent` and `subType` `General`; `complained@` → `email.sent`, `email.complained`, `email.delivered`, the complaint's `created_at` ≈ 23 ms before the delivery's; `suppressed@` → `email.suppressed` only, no `email.sent`, its `data` carrying a `suppressed` object. Every event's `data.to` listed exactly one recipient. The ledger projected `complained@` to `complained` (email and recipient) and `suppressed@` to `suppressed`. The test-email page: "The suppressed test email address does not support labeling yet"; the others support `+label`. Replayed as fixtures by `testAddressSequences` ([test-address-sequences.test.ts](../packages/core/src/testing/test-address-sequences.test.ts)). | Ask-first sends from `onboarding@resend.dev`, observed through `resend webhooks listen` (resend-cli 2.26.0); dashboard/emails/send-test-emails | 2026-10-17 |
| RS-40 | A `listen` session ended by a hard kill (no graceful exit, the equivalent of closing its terminal) leaves its temporary webhook behind, `enabled` and pointing at the tunnel: one was counted with `resend webhooks list` afterwards and deleted with `resend webhooks delete` (Ask-first). The CLI's help says it deletes the webhook on exit (Ctrl+C); a graceful exit was not exercised. | Ask-first `listen` session (resend-cli 2.26.0), owner's terminal | 2026-10-17 |
| RS-41 | A `listen` session's forwarded deliveries (`--forward-to`, original Svix headers, RS-33) verify against the temporary webhook's own signing secret, which `resend webhooks get <id>` returns (RS-05, RS-13): with it in `LEDGER_WEBHOOK_SECRETS`, 12 forwarded, 12 accepted by local ingest, 0 rejected, all committed by the worker. | Ask-first `listen` session (resend-cli 2.26.0) against `apps/local` | 2026-10-17 |
| RS-42 | Sends from `onboarding@resend.dev`, with no verified domain, to the `@resend.dev` test addresses were accepted (`200`) and produced events (RS-39): the test addresses are exempt from RS-34's own-address rule. | Ask-first sends (resend-cli 2.26.0 and `POST /emails`), owner's account | 2026-10-17 |
| RS-43 | On a multi-recipient email, each per-recipient event lists only the recipient it concerns in `data.to`. Live, one send from the project's verified sending domain with `to: [delivered@, bounced@]` kept both recipients (Retrieve Email returned both, unlike the `onboarding@resend.dev` sends of RS-U21's history) and produced four events, none naming both recipients: two `email.sent`, one per recipient, sharing one `created_at`; `email.delivered` with `to: [delivered@]`; `email.bounced` with `to: [bounced@]`, `bounce.type` `Permanent`, `subType` `General`. A second, identical send produced the same four. Retrieve Email's `last_event` was `bounced` for both emails. A third send, `to: [delivered@, complained@]`, produced five events, each naming one recipient: two `email.sent`; `email.complained` with `to: [complained@]`; then two `email.delivered`, one per recipient, the `complained@` one ≈ 250 ms after the complaint (RS-39's order). | Ask-first `POST /emails` from the verified domain, observed through `resend webhooks listen` (resend-cli 2.26.0) and the dashboard's webhook event log; `GET /emails/{id}` | 2026-10-17 |
| RS-46 | A deleted key, and a well-formed key no account issued, both answer `GET /webhooks/{id}` with `400`, `name` `validation_error`, `message` "API key is invalid". Live: a throwaway `sending_access` key was created (`201`) and revoked (`DELETE /api-keys/{id}`: `200`, `"deleted": true`), then each key read the production webhook once. No key or id recorded. | Owner-approved Ask-first key create and revoke (slice 4, item 7a), owner's account; [delete-api-key](https://resend.com/docs/api-reference/api-keys/delete-api-key) | 2026-10-20 |

## Mechanisms

### Signing and verification (RS-01–RS-05)

Resend signs every delivery the Svix way (RS-01, RS-03). The SDK's `webhooks.verify` checks one
secret per call and enforces a 5-minute timestamp window (RS-02). During the 24 h after a
rotation, both secrets verify (RS-04). Any `full_access` key can read the secret (RS-05).
**Consequence for Ledger:** ingest verifies the raw body (decoded from API Gateway's payload,
[AWS-01](aws.md#api-gateway-http-api)) against each configured secret in turn and accepts the first match, so a rotation
drops nothing. The 5-minute window is the replay-attack guard. The secret never appears in logs,
the CLI or MCP output.

### Delivery, retries and auto-disable (RS-06–RS-12)

Delivery is at-least-once with no order guarantee (RS-06, RS-07). Retries reuse the `svix-id`
(RS-08). A delivery without a `200` is retried on a fixed 8-attempt schedule spanning ≈ 27.6 h
(RS-09, RS-10). A persistently failing endpoint is auto-disabled, the team is emailed, and delivery
stops until someone re-enables it (RS-11). Each attempt's status code and response body are kept
(RS-12).
**Consequence for Ledger:** ingest returns exactly `200` only after a durable enqueue, so
"success" holds under every reading of RS-10. The ledger dedupes on `svix_id`. State comes from the
projection, never from arrival order ([lens clause 6](../AGENTS.md#decision-lens--evidence-over-claims-right-sized)).
The reconciler reads the webhook's `status` before any replay and stops with `webhook_disabled`.

### Headless Webhook API (RS-13–RS-18)

Events are listed per webhook, newest first, forward-only (`after`, no `before`), at most 100 per
page (RS-14). Retrieve Event adds the payload and the next attempt time (RS-15). A replay adds one
immediate delivery to the configured endpoint without touching the schedule (RS-16), and replay
takes no idempotency key (RS-17). Every one of these endpoints needs a `full_access` key (RS-18).
**Consequence for Ledger:** the reconciler pages from newest to the lookback horizon, compares ids
against `webhook_events` rather than statuses ([idea §5.5](../docs/idea.md#55-reconciler-recovering-missed-events)),
and replays through normal ingest, so verification and dedupe apply unchanged. This chain holds
only if RS-U01, RS-U02 and RS-U20 do.

### Rate limits and errors (RS-19–RS-23)

One budget of 10 req/s per team, across keys (RS-19) and, observed live, across endpoints (RS-20).
Requests without a `User-Agent` are rejected (RS-21). The error list is published, but the SDK's
type doesn't match it (RS-22). The SDK neither retries nor throws (RS-23).
**Consequence for Ledger:** `packages/resend-client` owns one limiter with headroom below 10 req/s.
It reads `ratelimit-remaining` and `ratelimit-reset` from every response and waits `retry-after` on
a `429`. It maps errors by HTTP status first and name second, with a default branch.

### Idempotent sends (RS-17, RS-24)

Sends dedupe on `Idempotency-Key` for 24 h (RS-24). Nothing on the webhook side does (RS-17).
**Consequence for Ledger:** alert-email keys derive from the outbox `dedupe_key`
([idea §5.6](../docs/idea.md#56-reactions-via-a-transactional-outbox)). The dispatcher stops retrying an
alert before the key expires (Constraint 8).

### Event types and payloads (RS-25–RS-30)

The 11 email types and 5 other families are fixed in RS-25. Payloads are `{ type, created_at,
data }` (RS-26). Email events carry `email_id` and `to[]` (RS-27); on a multi-recipient email each
event names only its own recipient, and Resend sends one `email.sent` per recipient (RS-43). Bounces carry `bounce.type` and
`bounce.subType` (RS-28): `Permanent` is the hard bounce, `Transient` the soft one, `Undetermined`
neither (RS-35), and the webhook example also shows `Temporary`.
**Consequence for Ledger:** `packages/core` Zod schemas mirror RS-26–RS-29, with event-specific
objects optional and `bounce.type` / `bounce.subType` typed `z.string()`, never an enum (RS-35).
Unknown and non-email types are stored raw and the projection skips them. A hard bounce is derived
from `bounce.type`, never from the event type alone.

### Retention, test sends and local development (RS-31–RS-34)

Resend keeps email data 30 days (RS-31). Webhook-event reach is not stated (RS-U03). The test
addresses produce delivery scenarios without harming reputation (RS-32), each with its observed
event sequence (RS-39). Sends from `resend.dev` reach only the account owner (RS-34), the test
addresses excepted (RS-42). `resend webhooks listen` creates and deletes a webhook (RS-33), but a
hard kill leaves it behind (RS-40); its forwarded deliveries verify against its own secret (RS-41).
**Consequence for Ledger:** the reconciler's lookback stays inside the verified reach. The verify
stage sends one email to `delivered@resend.dev` ([features.md](features.md#adopter-lifecycle)).
`listen` is a real-traffic loop that writes to the account, so each session is Ask-first. Signed
simulator traffic is the default local loop.

## Constraints and sharp edges

1. **Shared 10 req/s budget** (RS-19, RS-20). *Impact:* reconcile and the dispatcher compete with
   the team's sending. *Resolution:* a client-side limiter per single-flight caller, 2 req/s by
   default ([ADR-012](architecture.md#adr-012--resend-client-is-the-sole-resend-api-caller)), that
   yields when `ratelimit-remaining` runs low. Reconcile runs hourly
   ([integrations.md → Locked rules](integrations.md#locked-rules-must)).
2. **A disabled endpoint stops delivery** (RS-11). Whether it also swallows replays is RS-U04.
   *Impact:* replays may go nowhere. *Resolution:* Retrieve Webhook before replaying, then
   `webhook_disabled` with a re-enable hint. This is safe under either answer.
3. **Retry window, a contradiction in Resend's docs.** how-to-store-webhooks-data says retries run
   "for up to 24 hours". The schedule (RS-09) spans ≈ 27.6 h. *Resolution:* design to the longer
   window. Outage tests run past 27.6 h, and the default lookback (3 days, idea §5.5) exceeds it.
   This is consistent with idea §5.5 ("~28h").
4. **Contradiction with [idea §5.2](../docs/idea.md#52-ingest).** idea says to return `401` on a bad
   signature "so Resend does not retry forever". Resend retries whenever it gets no `200` (RS-10),
   and no page says a `401` stops retries (RS-U07). Retries end on their own after RS-09, and
   repeated failure can auto-disable the endpoint (RS-11). *Resolution:* keep `401`, because it is
   honest and alarmable, and drop the rationale. A misconfigured secret behaves like an outage: fix
   the secret, re-enable the endpoint if disabled, reconcile.
5. **Contradictions with [idea §2.1](../docs/idea.md#21-how-resend-webhooks-behave-verified-facts).**
   idea lists three behaviors as verified that are not:
   - A replay keeps the `svix-id`, and List Events ids equal it. Only community-verified: RS-U01,
     RS-U02.
   - New events appear in List Events after ≈ 8 s. Community: RS-U13.
   - "Disabled endpoints receive nothing, including replays". The docs say delivery attempts stop
     and don't mention replays: RS-U04.

   *Resolution:* idea §2.1 is frozen as an RFC. These rows are canonical, and each names its slice.
6. **`resend webhooks listen` is a write, not a tunnel** (RS-33). idea §2.1 and the CLI 2.0 blog
   ("The CLI handles the tunnel") disagree with the CLI reference: it creates a temporary webhook,
   and `--url` needs your own public tunnel. *Resolution:* trust the reference. Each `listen`
   session is Ask-first. The local default loop is signed simulator traffic. A hard-killed session
   leaves its webhook behind (RS-40), so `resend webhooks list` follows each session.
7. **"Bounced" is not always permanent** (RS-28, RS-35). The event is described as a permanent
   rejection, but Resend documents `Transient` and `Undetermined` bounces too, and the webhook
   example shows `Temporary`. *Resolution:* `projectRecipient` derives hard bounce from
   `bounce.type = Permanent` only (RS-35). Which other values `soft_bouncing` folds is RS-U12.
8. **Idempotency keys expire after 24 h** (RS-24). *Impact:* a dispatcher retry after 24 h could
   send a second alert, a duplicate effect. *Resolution:* the alert-email retry horizon is under
   24 h; past it the entry dead-letters. Owed by [slice 6](build-checklist.md#6--reactions).
9. **A replay can't be made idempotent** (RS-17). A retried replay call queues another delivery.
   *Resolution:* harmless only if RS-U01 holds. Otherwise it blocks recovery.
10. **No read-only key** (RS-05, RS-18). *Impact:* the reconciler's key can read the signing secret
    and make every write: a security exposure. *Resolution:* the key stays in Secrets Manager and
    never appears in logs or the CLI or MCP output. Only the reconciler holds the `full_access`
    key. The dispatcher sends with a `sending_access` key
    ([integrations.md → Secrets layout](integrations.md#secrets-layout)).
11. **Resend stores ingest's response bodies** (RS-12). *Impact:* anything ingest echoes is
    readable through List Attempts and the dashboard. *Resolution:* ingest responds with a fixed
    short body: no payload echo, no PII, no secret.
12. **`verify` takes one secret per call** (RS-02). *Resolution:* ingest loops over the configured
    secret set (Mechanisms → Signing). [Slice 1](build-checklist.md#1--local-ledger-and-read-path), which adds `resend`
    (Ask-first dependency), re-checks RS-02 against the pinned version's types.
    *Re-checked 2026-10-17 against the installed `resend@6.33.0` (`dist/index.mjs`, `dist/index.d.mts`)
    and `standardwebhooks@1.1.1` (`dist/index.js`):*
    - `webhooks.verify` builds `new Webhook(webhookSecret)` per call and passes `headers.id`,
      `.timestamp`, `.signature` as `webhook-id`, `webhook-timestamp`, `webhook-signature`. One
      secret per call holds.
    - The window is `WEBHOOK_TOLERANCE_IN_SECONDS = 5 * 60`, both ways (more than 300 s in the past
      or the future is rejected), read against the wall clock (`Date.now()`), not an injectable
      clock. The header is read with `parseInt`.
    - `svix-signature` is split on spaces; each `v1,<sig>` is compared in constant time and any
      match passes, so one header carrying two signatures verifies under either secret. Other
      versions are skipped.
    - It throws `WebhookVerificationError` for a missing header, an unparseable timestamp, a stale
      or future timestamp and no matching signature; `SyntaxError` from `JSON.parse` for a signed
      body that is not JSON; `Error` for an empty secret. An empty body returns `undefined` before
      any parse, so ingest treats that result as no match
      ([create-ingest.test.ts](../packages/ingest/src/create-ingest.test.ts)).
    - **The constructor (D10):** `new Resend()` with no key reads `RESEND_API_KEY` and throws
      `Missing API key` when that is unset too. Ingest holds no API key, so it passes the placeholder
      `ingest-verifies-only`. A passed key also keeps the constructor from reading `RESEND_API_KEY`.
      The placeholder never reaches a request: ingest makes no API call, and constructing makes
      none.
13. **Forward-only pagination** (RS-14). *Resolution:* each reconcile run pages newest to oldest
    down to the horizon. A run can't resume from the oldest end.
14. **SDK error names differ from the docs** (RS-22). *Resolution:* map by status, then name, with
    a default branch. Never switch exhaustively on the SDK union. `400 validation_error` with the
    message `API key is invalid` is a deleted or invalid key (RS-U17) and maps to
    `resend_auth_failed`. Any other `400` is a request bug and takes the default branch.

## Onboarding reality

The steps a self-hoster takes. "Self-serve" means doable in the dashboard or API without contacting
Resend.

| Step | Self-serve? | Owner's account (2026-10-15) |
| --- | --- | --- |
| Create a Resend account | Yes | Done |
| Create an API key (`full_access` for the webhook API, RS-18; shown once) | Yes, dashboard or `POST /api-keys` | Done: a `full_access` key exists (live read) |
| Verify a sending domain: DNS records; needed to send alerts to anyone but the account owner (RS-34) | Yes, needs DNS access | Done: verified 2026-10-17 (`GET /domains`: `verified`, sending enabled; [about.md → Project domain](about.md#open-questions)); it carried RS-43's send |
| Create the webhook pointing at the ingest URL and subscribe to events; the response returns the signing secret (RS-13) | Yes, dashboard or `POST /webhooks`, so it is scriptable | Done: the production webhook exists, repointed to the kept deploy's ingest URL, since 2026-10-18 (slice 2's walk) |
| Store the signing secret in Secrets Manager | Adopter's step ([features.md → connect webhook](features.md#adopter-lifecycle)) | — |
| Verify with one send to `delivered@resend.dev` (RS-32) | Yes, with no verified domain (RS-42) | Not done as the verify stage (slice 2); test-address sends accepted 2026-10-17 (RS-42) |

## [Unverified]

Each row links the [build-checklist.md](build-checklist.md) card that owes it, and that card's
Ships list names the row and its experiment. "Safe either way" means the slice MAY
close by proving the design correct under both answers. Every Ask-first experiment needs the
owner's approval when it runs.

| Id | Claim | Why unsettled | What would settle it | Owed by |
| --- | --- | --- | --- | --- |
| RS-U01 | A **replay** carries the same `svix-id` as the original delivery | No Resend page says so. RS-08 covers retries; Svix covers "resent due to a previous failure"; community-verified in [ingester#12](https://github.com/resend/resend-webhooks-ingester/issues/12). For: Replay Event is "an additional delivery attempt for a webhook event" and returns the event's own `msg_` id (replay-event). Against, read literally: RS-06's "unique identifier for each event delivery". If false, a replayed event lands under a new id, the original stays "missing", and reconcile replays it forever: duplicate effects | Ask-first: replay one already-stored event on the owner's webhook and compare `svix_id`s | [slice 4](build-checklist.md#4--recovery). MUST be settled, not proved safe either way |
| RS-U02 | The List Events `id` equals the delivered `svix-id` header | Same `msg_` shape; no page states it. The reconcile id diff depends on it | Read-only, after the first real delivery: compare the stored `svix_id` with List Events ids | [slice 4](build-checklist.md#4--recovery). MUST be settled |
| RS-U03 | How far back **List Events** reaches | Only email data retention (30 days, RS-31) is stated. It bounds the longest recoverable outage and kill-switch gaps | Read-only: page the owner's webhook to its oldest event and record it. Repeat once the webhook is older than 30 days | [slice 4](build-checklist.md#4--recovery) confirms reach ≥ the default lookback; re-measured in [slice 7](build-checklist.md#7--polish-and-retention) before M2 closes |
| RS-U04 | A replay to a **disabled** webhook is not delivered (accepted, rejected or dropped?) | RS-11 says delivery attempts stop; replays aren't named. Community: Ingester [PR #13](https://github.com/resend/resend-webhooks-ingester/pull/13) asserts "Resend does not deliver replays to a disabled endpoint", not stated as live-verified | Ask-first: disable a test webhook, replay one event, read the response and List Attempts | [slice 4](build-checklist.md#4--recovery). Safe either way (status checked first) |
| RS-U05 | What happens to events created while a webhook is disabled, and whether re-enabling redelivers them | Not stated | Ask-first: disable, send one test email, re-enable, then List Events and Attempts | [slice 4](build-checklist.md#4--recovery). Safe either way (reconcile after re-enable) |
| RS-U06 | The auto-disable threshold | "Keeps failing" is unquantified. `[Svix]` default: 5 days of failures | Resend docs or support | [slice 4](build-checklist.md#4--recovery). Proved safe either way: every run reads the webhook's `status` before any List Events call and stops with `webhook_disabled` (the disabled-webhook case in [recovery.int.test.ts](../packages/reconciler/src/recovery.int.test.ts)) |
| RS-U07 | Which responses count as failure besides "not 200": other 2xx, and whether any 4xx (`401`, `410`) stops retries | RS-10's three sources disagree | Ask-first: a test webhook pointing at an endpoint that returns `401`; read List Attempts | [slice 2](build-checklist.md#2--durable-ingest-on-aws). Proved safe either way by the exact-`200` contract (Constraint 4): ingest answers `401` only when no configured secret verifies, and every infrastructure fault (an unreadable, unparseable or empty secret set, an expired set that fails to refresh, a failed enqueue) answers `503`, in [create-ingest.test.ts](../packages/ingest/src/create-ingest.test.ts). So a `401` means a wrong secret; whether it stops retries or they run to RS-09's end or RS-11's auto-disable, the path is ADR-001's: fix the secret, re-enable, reconcile. No experiment run |
| RS-U08 | Resend's delivery timeout | Not stated. `[Svix]`: 15 s | Resend docs; or Attempts against a deliberately slow endpoint (Ask-first) | [slice 3](build-checklist.md#3--operations-and-evidence-on-aws). **Closed 2026-10-19** by `pnpm sim --burst 10000/10s` on the deployed stack: 10,000 signed events sent in 16.8 s, client-observed ingest p50 638 ms and p99 4,195 ms, under the 5 s bar (a third of `[Svix]`'s 15 s, RS-10). Client-observed latency includes the owner's round trip, so it bounds what Resend sees from above. The timeout itself stays unstated; a lone cold delivery is [CBL-21](check-before-launch.md) |
| RS-U09 | How both signatures appear in `svix-signature` during the rotation overlap | RS-04 doesn't say. The `[Svix]` format suggests two space-separated `v1` entries. Security-relevant | Ask-first: rotate a test webhook's secret and capture one delivery's headers | [slice 4](build-checklist.md#4--recovery). Proved safe either way: ingest calls `verify` once per configured secret, so the header's layout does not matter; one `svix-signature` header carrying both `v1` signatures verifies, in [create-ingest.test.ts](../packages/ingest/src/create-ingest.test.ts) ("accepts one svix-signature header carrying both v1 signatures") |
| RS-U10 | The top-level `created_at` stays the same across retries and replays, and tracks when the event happened | RS-26 says "when the webhook event was created" and nothing more | Compare stored `created_at` across a replay (same experiment as RS-U01) | [slice 0](build-checklist.md#0--foundations) (the projection uses it at most as a tie-break; safe either way: the tie-heavy RS-U10 test and the permutation and oracle properties in [project-email.projection.prop.test.ts](../packages/core/src/project-email.projection.prop.test.ts) run in both worlds); experiment in [slice 4](build-checklist.md#4--recovery) |
| RS-U11 | `email.bounced` can follow `email.delivered` | Not stated. `email.complained` always does (RS-29) | Resend docs or support | [slice 0](build-checklist.md#0--foundations). Precedence property-tested under both answers: "a bounce outranks delivered in either world (RS-U11)" in [project-email.projection.prop.test.ts](../packages/core/src/project-email.projection.prop.test.ts) |
| RS-U12 | Which `bounce.type` values a live `email.bounced` carries (is the example's `Temporary` live, beside the documented `Transient` and `Undetermined`?), and so which ones `soft_bouncing` folds | RS-28's examples and RS-35's list disagree. `Permanent` as the hard bounce is settled by RS-35 | The `bounced@resend.dev` payload (Ask-first send) | [slice 0](build-checklist.md#0--foundations) (hard bounce only on `Permanent`; both fields `z.string()`; safe either way: "only `Permanent` yields hard_bounced; any other bounce.type yields soft_bouncing (RS-U12)" in [project-recipient.projection.prop.test.ts](../packages/core/src/project-recipient.projection.prop.test.ts)) |
| RS-U13 | New events take ≈ 8 s to appear in List Events | Community only (ingester#12) | Read-only: timestamps of the first real deliveries vs their List Events visibility | [slice 4](build-checklist.md#4--recovery). Safe if the grace window (10 min default) holds |
| ~~RS-U14~~ | ~~`resend.dev` test addresses are exempt from the own-address rule (RS-34)~~ | Every quickstart sends `onboarding@resend.dev` → `delivered@resend.dev`, but no page states the exemption | Ask-first: that one send. It is also the verify-stage send | **Settled 2026-10-17 → [RS-42](#facts)** by slice 1's Ask-first sends. [Slice 2](build-checklist.md#2--durable-ingest-on-aws)'s verify-stage send still runs |
| ~~RS-U15~~ | ~~The webhook event sequence each test address produces~~ | RS-32 describes scenarios, not event types | Ask-first sends observed through `resend webhooks listen` | **Settled 2026-10-17 → [RS-39](#facts)** ([slice 1](build-checklist.md#1--local-ledger-and-read-path); simulator fixtures mirror the observed sequences) |
| RS-U16 | Idempotency keys are scoped per team, not per API key | Not stated | Resend docs or support | [slice 6](build-checklist.md#6--reactions). Safe with one sending key |
| ~~RS-U17~~ | ~~Which status a deleted or invalid key gets on non-sending endpoints. Documented: `400 validation_error`, message "API key is invalid": "Every endpoint except sending returns this for a key that doesn't exist or was deleted" (api-reference/errors)~~ | The introduction's generic table still says `403` "The API key used was invalid" | One Ask-first create and revoke of a throwaway key, then a read with it | **Settled 2026-10-20 → [RS-46](#facts)**: `400 validation_error` "API key is invalid" for a revoked key and for one never issued, as documented, which `resend-client` maps to `resend_auth_failed` ([create-resend-client.test.ts](../packages/resend-client/src/create-resend-client.test.ts); [slice 4](build-checklist.md#4--recovery)) |
| ~~RS-U18~~ | ~~`resend webhooks listen` leaves its temporary webhook behind if killed without Ctrl+C~~ | Not stated | Read-only `GET /webhooks` after an interrupted session | **Settled 2026-10-17 → [RS-40](#facts)**: it does ([slice 1](build-checklist.md#1--local-ledger-and-read-path); the dev guide checks after each session) |
| RS-U19 | `email.suppressed` always carries `data.suppressed` | It appears in the example only | A real `suppressed@resend.dev` payload (Ask-first send) | [slice 0](build-checklist.md#0--foundations) (Zod field optional; safe either way: the page's example parses with and without `data.suppressed`, [email-event.schema.test.ts](../packages/core/src/email-event.schema.test.ts)) |
| RS-U20 | A **replayed** delivery carries a fresh `svix-timestamp`, so it passes the 5-minute window (RS-02, RS-03) | RS-16 says a replay "queues one additional delivery"; no page says it is re-signed at send time. `[Svix]` sends "the timestamp of the attempt" in `svix-timestamp` (how-manual), which suggests a fresh one. If it keeps the original timestamp, ingest rejects every replay older than 5 min and recovery fails ([architecture.md → ADR-007](architecture.md#adr-007--recovery-by-id-diff-and-replay-through-ingest)) | The RS-U01 experiment: the replayed delivery passes verification | [slice 4](build-checklist.md#4--recovery). MUST be settled |
| ~~RS-U21~~ | ~~On a multi-recipient email, a per-recipient event (`bounced`, `complained`, `delivered`) lists only the **impacted** recipients in `data.to`~~ | RS-27 says "Array of impacted recipient email addresses"; no page shows a multi-recipient payload. If the list were complete, no projection could pin a bounce to one recipient, and a healthy co-recipient would read `hard_bounced`. **Observed 2026-10-17, not settled:** from `onboarding@resend.dev` with no verified domain, Resend kept only the first `to` recipient: `to: [delivered@, bounced@]` was stored (`GET /emails/{id}`) and delivered as `to: [delivered@]` only, through the CLI and through `POST /emails` with an explicit JSON array; the reversed order kept only `bounced@`; a `cc: bounced@` was dropped (`cc: null`). No multi-recipient email can be produced in that setup; settling this needs a send from the project's verified sending domain ([about.md → Project domain](about.md#open-questions)) | Ask-first: one send from the verified domain to `delivered@resend.dev` and `bounced@resend.dev` together, observing each event's own `data.to` (through `resend webhooks listen` or the deployed ledger's stored payload) | **Settled 2026-10-17 → [RS-43](#facts)**: positive, by the send from the project's verified sending domain (owed by [slice 2](build-checklist.md#2--durable-ingest-on-aws), settled early). `email_recipients` folds each event's own `to`, so it is exact ([data-modeling.md](data-modeling.md#email_recipients--outcome-per-email-and-recipient)) |
| ~~RS-U22~~ | ~~A `listen` session's forwarded deliveries are signed with the temporary webhook's own secret, and a local verifier can obtain that secret~~ | RS-33: the session "registers a temporary webhook" and `--forward-to` "passes original Svix headers"; each webhook has its own `signing_secret` (RS-13). Neither CLI page says how the session's secret reaches a local verifier. If it can't, real events reach local ingest only as `401`s (stdout streaming still serves RS-U15 and RS-U21) | In the first approved `listen` session: read-only `resend webhooks get <id>` on the temporary webhook (RS-05), load its secret into the local set, and verify one forwarded delivery | **Settled 2026-10-17 → [RS-41](#facts)**: positive ([slice 1](build-checklist.md#1--local-ledger-and-read-path)) |

## Sources

All pages are at `https://resend.com/docs/<path>`, fetched as `.md` on 2026-10-15.

| Source | Supports | Checked on |
| --- | --- | --- |
| [webhooks/verify-webhooks-requests](https://resend.com/docs/webhooks/verify-webhooks-requests) | RS-01, RS-02, RS-05 | 2026-10-15 |
| [webhooks/create-webhook](https://resend.com/docs/webhooks/create-webhook) (FAQ) | RS-06, RS-07, RS-08, RS-10 | 2026-10-15 |
| [webhooks/retries-and-replays](https://resend.com/docs/webhooks/retries-and-replays) | RS-09, RS-11, RS-16 | 2026-10-15 |
| [webhooks/how-to-store-webhooks-data](https://resend.com/docs/webhooks/how-to-store-webhooks-data) | RS-10, RS-31, Constraint 3 | 2026-10-15 |
| [webhooks/event-types](https://resend.com/docs/webhooks/event-types) | RS-08, RS-25, RS-28, RS-29 | 2026-10-15 |
| [webhooks/emails/bounced](https://resend.com/docs/webhooks/emails/bounced) and the other `webhooks/emails/*` pages | RS-26–RS-30 | 2026-10-15 |
| [packages/core/src/fixtures/resend/](../packages/core/src/fixtures/resend/): the 11 `webhooks/emails/<type>` examples, verbatim but for the address substitutions [email-event.schema.test.ts](../packages/core/src/email-event.schema.test.ts) records per file | RS-26–RS-30 (each example parses against them) | 2026-10-16 |
| [dashboard/emails/email-bounces](https://resend.com/docs/dashboard/emails/email-bounces) | RS-35 | 2026-10-15 |
| [dashboard/emails/manage-emails](https://resend.com/docs/dashboard/emails/manage-emails) | RS-36, RS-38 | 2026-10-16 |
| [dashboard/emails/email-suppressions](https://resend.com/docs/dashboard/emails/email-suppressions) | RS-37 | 2026-10-16 |
| [knowledge-base/why-are-my-emails-landing-on-the-suppression-list](https://resend.com/docs/knowledge-base/why-are-my-emails-landing-on-the-suppression-list) | RS-37 | 2026-10-16 |
| [api-reference/emails/retrieve-email](https://resend.com/docs/api-reference/emails/retrieve-email) | RS-38 | 2026-10-16 |
| [api-reference/webhooks/rotate-signing-secret](https://resend.com/docs/api-reference/webhooks/rotate-signing-secret) | RS-04, RS-13 | 2026-10-15 |
| [api-reference/webhooks/list-events](https://resend.com/docs/api-reference/webhooks/list-events) | RS-14 | 2026-10-15 |
| [api-reference/webhooks/get-event](https://resend.com/docs/api-reference/webhooks/get-event) | RS-15 | 2026-10-15 |
| [api-reference/webhooks/replay-event](https://resend.com/docs/api-reference/webhooks/replay-event) | RS-16 | 2026-10-15 |
| [api-reference/webhooks/list-event-attempts](https://resend.com/docs/api-reference/webhooks/list-event-attempts) | RS-12 | 2026-10-15 |
| `api-reference/webhooks/` create, get, list, update, delete | RS-05, RS-11, RS-13 | 2026-10-15 |
| [api-reference/rate-limit](https://resend.com/docs/api-reference/rate-limit) | RS-19 | 2026-10-15 |
| [api-reference/errors](https://resend.com/docs/api-reference/errors) | RS-18, RS-19, RS-22, RS-24, RS-34, RS-U17 | 2026-10-15 |
| [api-reference/introduction](https://resend.com/docs/api-reference/introduction) | RS-21, RS-U17 | 2026-10-15 |
| [api-reference/api-keys/create-api-key](https://resend.com/docs/api-reference/api-keys/create-api-key) | RS-18 | 2026-10-15 |
| [dashboard/emails/idempotency-keys](https://resend.com/docs/dashboard/emails/idempotency-keys) | RS-17, RS-24 | 2026-10-15 |
| [dashboard/emails/send-test-emails](https://resend.com/docs/dashboard/emails/send-test-emails) | RS-32, RS-39 | 2026-10-15, 2026-10-17 |
| [knowledge-base/403-error-resend-dev-domain](https://resend.com/docs/knowledge-base/403-error-resend-dev-domain) | RS-34 | 2026-10-15 |
| [cli](https://resend.com/docs/cli), [cli-agents](https://resend.com/docs/cli-agents); [Resend CLI 2.0 blog](https://resend.com/blog/resend-cli-2) | RS-33, Constraint 6 | 2026-10-15 |
| `resend@6.33.0` (npm; `dist/index.d.mts`, `dist/index.mjs`), `standardwebhooks@1.1.1` | RS-02, RS-22, RS-23 | 2026-10-15 |
| Live read-only calls with the owner's key: `GET /webhooks`, `/api-keys`, `/domains` | RS-18, RS-20, Onboarding reality | 2026-10-15 |
| Owner-approved Ask-first experiments (slice 1): sends from `onboarding@resend.dev` to the four test addresses, `resend webhooks listen` sessions forwarding to `apps/local` (resend-cli 2.26.0), `GET /emails/{id}`; no id recorded | RS-39, RS-40, RS-41, RS-42, RS-U21's observation | 2026-10-17 |
| Owner-approved Ask-first key create and revoke (slice 4, item 7a): `POST /api-keys` (`sending_access`), [delete-api-key](https://resend.com/docs/api-reference/api-keys/delete-api-key) `DELETE /api-keys/{id}`, then `GET /webhooks/{id}` with the revoked key and with a never-issued one; no key or id recorded | RS-46, RS-U17 | 2026-10-20 |
| Owner-approved Ask-first experiment (slice 2's RS-U21, run early): `POST /emails` from the project's verified sending domain to `delivered@resend.dev` with `bounced@resend.dev`, then with `complained@resend.dev`, each pair in one email, a `resend webhooks listen` session through the owner's tunnel (resend-cli 2.26.0), the dashboard's webhook event log, `GET /emails/{id}`, the temporary webhook deleted afterwards; no id recorded | RS-43 | 2026-10-17 |
| `[Svix]` [verifying payloads (manual)](https://docs.svix.com/receiving/verifying-payloads/how-manual), [why](https://docs.svix.com/receiving/verifying-payloads/why), [retries](https://docs.svix.com/retries) | RS-03, RS-08, RS-10, RS-U06, RS-U08 | 2026-10-15 |
| Community: [resend-webhooks-ingester#12](https://github.com/resend/resend-webhooks-ingester/issues/12) | RS-U01, RS-U02, RS-U13 | 2026-10-15 |
| Community: [resend-webhooks-ingester PR #13](https://github.com/resend/resend-webhooks-ingester/pull/13) | RS-U04 | 2026-10-15 |
