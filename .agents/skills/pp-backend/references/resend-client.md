# `packages/resend-client`

The only code that calls Resend's API
([ADR-012](../../../../.ai/architecture.md#adr-012--resend-client-is-the-sole-resend-api-caller)).
The rules it implements are [integrations.md → Locked rules](../../../../.ai/integrations.md#locked-rules-must)
(rules 1, 2, 4, 6, 7) and [resend.md → Rate limits and errors](../../../../.ai/resend.md#rate-limits-and-errors-rs-19rs-23).
It lands in slice 4 ([build-checklist](../../../../.ai/build-checklist.md#4--recovery)). How it is
faked in tests, and how its own tests stand in for Resend's API, are
[pp-testing](../../pp-testing/SKILL.md)'s.

## What it is

- **A package, not a port.** It exports a client its consumers (the reconciler from slice 4, the
  dispatcher from slice 6) type against directly. It is ADR-012's named seam, so it needs no
  interface in `packages/shared` and no third duplicate
  ([extract an abstraction](../../pp-general/references/adding-things.md#extract-an-abstraction)).
- **One instance per calling function at a time**, composed in that function's `main.ts`
  ([composition.md](composition.md#the-composition-root)), holding that function's key only: the
  reconciler a `full_access` key, the dispatcher a `sending_access` key
  ([Secrets layout](../../../../.ai/integrations.md#secrets-layout)). `main.ts` reads the key through
  the secret port, never at import, so the bundle loads with no AWS access, and passes it to the
  constructor, never through a config schema ([secrets](../../pp-general/references/config-and-env.md#secrets));
  it never appears in a log, an error or an output (rule 7). The reconciler reads it on every
  invocation, one `GetSecretValue` per run (hourly plus manual), and rebuilds the client only when
  the key read differs from the one it holds, the cache's invalidation trigger: `pnpm aws:deploy`
  writes the key after `cdk deploy` and again on a rotation, so a key read once per container would
  never reach a warm one (`apps/reconciler/src/compose-reconciler.test.ts`). A higher-frequency
  caller (slice 6's dispatcher) settles its own refresh, a TTL like ingest's secret set (ADR-009),
  in its slice.
- **Constructed with every option explicit:** `new Resend(key, { baseUrl, userAgent })`, `baseUrl`
  from the function's typed config. Left unset, the SDK reads `process.env.RESEND_BASE_URL`
  (`resend@6.33.0`), an env read outside the composition root that the config schema never sees;
  the fake Resend API is reached the same way ([pp-testing](../../pp-testing/references/fakes-and-doubles.md#the-fake-resend-api)).
  The AWS adapters likewise take their SDK client from `main.ts`, never build one with ambient
  defaults ([composition.md](composition.md#the-composition-root)).
- **Only the operations its callers need**, each a named method, never a generic `request(path)`
  passthrough. `createResendClient({ apiKey, baseUrl, userAgent, clock, sleep, logger, ratePerSecond = 2 })`
  returns `ResendClient`, every method taking `{ deadline }` last (slice 4, D9):
  `retrieveWebhook` (`webhooks.get`, returns `{ status }` only, never the signing secret, RS-13),
  `listWebhookEvents` (`webhooks.events.list`, 100 a page, `after`), `replayWebhookEvent`
  (`webhooks.events.replay`), `retrieveWebhookEventCreatedAt` (`webhooks.events.get`, the payload's
  top-level `created_at` only, RS-15; the gap drill alone) and `sendEmail` (`emails.send`, always an
  `Idempotency-Key`; the gap drill, then slice 6's dispatcher). The pinned `resend@6.33.0` exposes
  each, checked against its `.d.mts`
  ([version rule](../../pp-general/SKILL.md#check-the-installed-version-not-memory)). `userAgent` is
  `ledger-reconciler` or `ledger-gap-drill` (RS-21). Each request carries
  `signal: AbortSignal.timeout(10_000)`.
- **The SDK's console logger is silenced** on the instance (`Reflect.defineProperty(sdk, 'logError', …)`):
  `resend@6.33.0` `console.error`s every error body and path unless `NODE_ENV` is `production`.
  `create-resend-client.test.ts` fails if anything reaches `console.error`, so a version bump that
  renames the method is caught.

## The limiter

Hand-rolled, no dependency ([add a dependency](../../pp-general/references/adding-things.md#add-a-dependency)).
Time comes from the clock port and waiting from an injected sleep, so the limiter unit tests run on
a fake clock.

`Limiter` in `limiter.ts`, one per client (slice 4, D10).

1. **Rate:** at most 2 requests per second per instance by default (configurable), by spacing
   request starts. Every caller is single-flight (the reconciler by non-overlapping runs and its
   run claim, [reactions-and-recovery.md](reactions-and-recovery.md#reconciler); the dispatcher by its lock), so Ledger's total stays at or below 2 × 2 req/s of the team's 10 (RS-19,
   RS-20).
2. **Headroom:** after each response, read `ratelimit-remaining` and `ratelimit-limit` from the
   response headers (the SDK returns them, RS-23). When `remaining` is below half of `limit`, wait
   `ratelimit-reset` seconds before the next request. Absent or unparseable headers: no wait.
3. **`429`:** wait `retry-after`, then retry. Before any wait, compare it with the caller's deadline
   (the run's time budget): a wait that would pass it stops the call with `rate_limited` instead.
   Any wait (spacing, headroom or `retry-after`) that would end past the deadline throws
   `rate_limited` before it sleeps.
   A `429` named `daily_quota_exceeded` or `monthly_quota_exceeded` (RS-22), or one without
   `retry-after`, is never retried: it ends the call with `rate_limited`, whose registry Meaning
   covers both cases ([Error codes](../../../../.ai/api-contract.md#error-codes)).
4. **No limiter shared across functions** through a table or a service: single-flight callers make
   it unnecessary (ADR-012's rejected option).

A read-API route that ever calls Resend adds a caller and MUST restate the 2 × 2 req/s bound
(rule 2). No route does in v0.

## Error mapping

The SDK never throws on an HTTP error and never retries; it returns `{ data, error, headers }`
(RS-23). So **every response is checked**, and `resend-client` turns an `error` into a throw of the
shared error class ([errors.md](../../pp-general/references/errors.md#one-base-class)) with a
registered `code`, mapped **by HTTP status first, then by name, with a default branch**. Never an
exhaustive `switch` on the SDK's error-name union: it differs from the documented list (RS-22,
[resend.md → Constraint 14](../../../../.ai/resend.md#constraints-and-sharp-edges)).

| Response | Outcome |
| --- | --- |
| `2xx` | Return `data` |
| `429` | The limiter's step 3; past the deadline, a quota name or no `retry-after`: `rate_limited` |
| `401`, `403` (any name) on a reconciler call | `resend_auth_failed` |
| `401`, `403` on Send Email | Returned to its caller by status and name (`{ rejected: { status, name } }`): for the dispatcher's `last_error`, a `403 validation_error` there can be the `resend.dev` own-address rule (RS-34) |
| `400` named `validation_error` with the message `API key is invalid` | `resend_auth_failed` (RS-U17, Constraint 14) |
| `5xx`, or `statusCode: null` (a network failure or the 10 s timeout) | Retried twice more, after 1 s then 2 s, each wait inside the deadline, then `resend_unavailable` |
| `404` from Retrieve Webhook | `reconciler_not_configured`: no webhook with the configured id |
| `409` from Send Email | Returned to the dispatcher by name: `concurrent_idempotent_requests` is retried, `invalid_idempotent_request` marks the row dead (RS-24, [reactions-and-recovery.md](reactions-and-recovery.md#dispatcher)) |
| Anything else (another `400`, a `404`, a `422`) | The default branch: a request bug, thrown as `internal_error`, logged once `resend.request_failed` by `error_name` (the SDK's `name`) and `error_code`, never the status or Resend's `message` |

Every thrown error is the shared class with the registry's message (`map-resend-error.ts` decides,
`create-resend-client.ts` throws). A Resend response body never reaches a log, `last_error`, an
error `message`, a `cause` or any output ([Log fields](../../../../.ai/data-modeling.md#log-fields)).
Evidence: [limiter.test.ts](../../../../packages/resend-client/src/limiter.test.ts) and
[create-resend-client.test.ts](../../../../packages/resend-client/src/create-resend-client.test.ts).

## Idempotent writes

Every send carries an `Idempotency-Key` derived from the outbox `dedupe_key` (rule 6, RS-24).
Replays take none (RS-17): their safety rests on the ledger's dedupe on `svix_id` and on RS-U01.

## Never

- **A `resend` API call outside this package** → a method here
  ([review grep 5](../../pp-general/references/boundaries.md#review-greps)); ingest uses only
  `webhooks.verify`.
- **Trusting the SDK to throw** → check `error` on every response.
- **A `switch` over the SDK's error names with no default** → status, then name, then default.
- **A dependency for the limiter** → the four steps above, in code.
- **A second limiter instance in one function, or one shared across functions** → one per calling
  function.
