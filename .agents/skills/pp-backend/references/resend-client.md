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
- **One instance per calling function**, built at module scope in that function's `main.ts`
  ([composition.md](composition.md#the-composition-root)), holding that function's key only: the
  reconciler a `full_access` key, the dispatcher a `sending_access` key
  ([Secrets layout](../../../../.ai/integrations.md#secrets-layout)). The key arrives as config from
  the secret port; it never appears in a log, an error or an output (rule 7).
- **Only the operations its callers need**, each a named method (List Events, Retrieve Webhook,
  Replay Event for slice 4; Send Email for slice 6). Never a generic `request(path)` passthrough.
  Whether the pinned `resend` SDK exposes each Headless Webhook API endpoint is checked in the slice
  4 pre-proposal against the installed version
  ([version rule](../../pp-general/SKILL.md#check-the-installed-version-not-memory)). Where it does
  not, the method uses `fetch` and MUST set a `User-Agent` (RS-21); the SDK sends its own.

## The limiter

Hand-rolled, no dependency ([add a dependency](../../pp-general/references/adding-things.md#add-a-dependency)).
Time comes from the clock port and waiting from an injected sleep, so the limiter unit tests run on
a fake clock.

1. **Rate:** at most 2 requests per second per instance by default (configurable), by spacing
   request starts. Every caller is single-flight (the reconciler by non-overlapping runs, the
   dispatcher by its lock), so Ledger's total stays at or below 2 × 2 req/s of the team's 10 (RS-19,
   RS-20).
2. **Headroom:** after each response, read `ratelimit-remaining` and `ratelimit-limit` from the
   response headers (the SDK returns them, RS-23). When `remaining` is below half of `limit`, wait
   `ratelimit-reset` seconds before the next request.
3. **`429`:** wait `retry-after`, then retry. Before any wait, compare it with the caller's deadline
   (the run's time budget): a wait that would pass it stops the call with `rate_limited` instead.
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
| `429` | The limiter's step 3; past the deadline, `rate_limited` |
| `401`, `403` (any name) | `resend_auth_failed` |
| `400` named `validation_error` with the message `API key is invalid` | `resend_auth_failed` (RS-U17, Constraint 14) |
| `5xx` | Retried a bounded number of times with backoff, then `resend_unavailable` |
| `409` from Send Email | Returned to the dispatcher by name: `concurrent_idempotent_requests` is retried, `invalid_idempotent_request` marks the row dead (RS-24, [reactions-and-recovery.md](reactions-and-recovery.md#dispatcher)) |
| Anything else (another `400`, a `404`, a `422`) | The default branch: a request bug, thrown as `internal_error`, logged by `error_name` and the status, never Resend's `message` |

The retry count and backoff for `5xx`, and whether the default branch's code is `internal_error`,
are the slice 4 pre-proposal's to confirm; the constraints above are fixed. A Resend response body
never reaches a log, `last_error`, an error `message` or any output
([Log fields](../../../../.ai/data-modeling.md#log-fields)).

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
