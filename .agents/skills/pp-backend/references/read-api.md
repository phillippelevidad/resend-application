# The read API on Hono

`packages/api` builds one Hono app object; `apps/api` serves it through `@hono/aws-lambda`, and
`apps/local` through `@hono/node-server` ([ADR-019](../../../../.ai/architecture.md#adr-019--application-and-surface-stack),
[ADR-011](../../../../.ai/architecture.md#adr-011--one-contract-many-surfaces)). Every route is an
operation in [api-contract.md](../../../../.ai/api-contract.md), whose
[Conventions](../../../../.ai/api-contract.md#conventions) bind it. Read the installed versions'
docs first ([version rule](../../pp-general/SKILL.md#check-the-installed-version-not-memory)):
`@hono/aws-lambda` replaced the deprecated `hono/aws-lambda`.

## One route per operation

One `<operation>.route.ts` per api-contract entry (`get-email.route.ts` → `getEmailRoute`), holding:

1. **`createRoute`** with the method and path the entry names (`{param}` form), the `operationId`
   it names (`email.get`), the request schemas (params, query, body) and a response schema for every
   status the entry can return, the error shape included. `createRoute` takes `method`, `path`,
   `request` and `responses`, and "everything else gets directly appended to the path definition"
   ([zod-to-openapi README](https://raw.githubusercontent.com/asteasolutions/zod-to-openapi/master/README.md),
   which `@hono/zod-openapi` builds on), so `operationId` passes through to the document.
2. **The handler**, registered with `app.openapi(route, handler)`. It reads the validated input,
   calls **one** command or reader, and returns **one** mapper's output. No query, no rule, no
   branch on domain data.
3. The response's `object` field and, for a list, the `{ object: "list", has_more, data }` envelope
   with `limit` 1–100 (default 20) and `after`, exactly as Conventions → Pagination states. Only
   `gaps.list` and `token.list` paginate. `dlq.listMessages` (`GET /dlq/messages`) is a sample: the
   envelope plus a top-level `depth`, no cursor, `limit` 1–10 (default 10)
   ([list-dlq-messages.route.ts](../../../../packages/api/src/list-dlq-messages.route.ts)).
4. **Two success statuses, one mapper.** A command whose entry names two success statuses declares
   both, and the handler picks the status from the result's closed-set `status`, each body from the
   one mapper: `dlq.startRedrive` (`POST /dlq/redrive`) answers `202` when a redrive starts and
   `200` when the DLQ is empty
   ([start-dlq-redrive.route.ts](../../../../packages/api/src/start-dlq-redrive.route.ts)).
5. **The reconcile routes** (slice 4, D27): `gaps.list` (`GET /gaps`, `since` 1m–30d default
   `24h`, `limit`, `after` a run id), `reconcile.getRun` (`GET /reconcile/runs/{run_id}`, `404
   run_not_found`) and `reconcile.start` (`POST /reconcile`, `operate`, a JSON object body with
   optional `dry_run` and `lookback`, `{}` valid, `202`, `409 reconcile_in_progress`). One mapper,
   `reconcileRunResponseMapper(run, now)`, builds the run on all three and on `health.get`'s
   `last_reconcile_run`, `now` from `ApiDeps.clock`, so `run_abandoned` is derived on read; `claimed_at`
   and `updated_at` never reach the wire. The field messages are `since must be a duration from 1m to
   30d, such as 24h.`, `lookback must be a duration from 1m to 30d, such as 72h.`, `dry_run must be
   true or false.`, `run_id must be a positive integer.`, `after must be a run id, a positive
   integer.` (a `routeFieldErrors` entry for `/gaps`) and the body's `The request body must be a JSON
   object with optional dry_run and lookback fields.`; `POST /reconcile`'s `bodyErrors` entry sets
   `typedFields`, so a field of the wrong type names itself. A registered component that a field
   makes optional takes `z.union([schema, z.null()])`, never `.nullable()`, which would make the
   component itself nullable in the document and the SDK types
   ([health-response.schema.ts](../../../../packages/api/src/health-response.schema.ts)).

Addresses travel only in request bodies (`recipient.get` is a `POST` for that reason); a path or
query parameter never carries one ([PII in code](../../pp-general/references/logging-and-pii.md#pii-in-code)).
Header keys in a request schema are lowercase.

## Mappers

A route's response is built only by an explicit `.mapper.ts`, which takes the reader's read shape
and returns the wire object. **The mapper is where the masks are applied**, by the `packages/core`
mask functions, so a new column cannot leak by passthrough. Never a row spread into a response,
never the raw payload, never a token hash ([Redaction](../../../../.ai/api-contract.md#conventions)).
`email.explainDelivery` returns ids, timestamps, closed-set values and masks only: no free-text
payload field, even masked. `dlq.listMessages` reads a queue envelope, so its reader reads the
envelope's `svixId` and `receivedAt` and exactly three payload paths (`type`, `created_at`,
`data.email_id`, each `null` unless a string), drops the parse, and hands the mapper no payload.
Evidence: [list-dlq-messages.route.int.test.ts](../../../../packages/api/src/list-dlq-messages.route.int.test.ts)'s
redaction case.

## Middleware, in this order

| Step | Does | Fails with |
| --- | --- | --- |
| 1. Request id | Sets `requestId` for the logger: Hono's `requestId` middleware with `headerName: ''` (so it neither reads a client header nor sets a response header) and a `generator` the factory receives from its root: `apps/api` reads the Lambda context's `awsRequestId` (`c.env.lambdaContext`), `apps/local` uses `crypto.randomUUID()` | — |
| 2. Token tag check | Parses `Authorization: Bearer ldg_…` and checks the HMAC tag with `packages/shared`'s tag check, **before any database connection opens** | `401 unauthorized` |
| 3. Token lookup | Loads the token row by its hash; a revoked or unknown token fails. `health.get` alone skips it during a database outage and answers on the tag alone | `401 unauthorized`, `503 database_unavailable` |
| 4. Scope | Compares the token's scope with the **entry's Scope**, never its section (`token.list` is a read needing `operate`); `operate` implies `read` | `403 forbidden` |
| 5. The route | Validation, then the handler | `400 validation_failed`, the entry's codes |

- **Steps 2 and 3 are one app-level middleware**, [`auth.middleware.ts`](../../../../packages/api/src/auth.middleware.ts)'s
  `authMiddleware`, registered with `app.use` after the request id and before every route, so the
  not-found handler sits behind it too: an unmatched path without a token answers `401`, never
  `404`. A failure throws the shared error class with the registry's default `message`, so a `401`
  never tells which check failed, and the app's one `onError` maps it.
- **The health exception** is matched by `health.get`'s own route `method` and `path`, which
  `createApi` passes into the middleware, so the middleware imports no route. Only a classified
  database error on that route continues, with the caller marked `verified: false`; the health
  reader then skips its storage read, so a request makes at most one database attempt (D19,
  AWS-02). Evidence: [get-health.route.int.test.ts](../../../../packages/api/src/get-health.route.int.test.ts),
  Postgres stopped.
- **Step 4 is per route**: each `createRoute` carries `middleware: requireScope('read' | 'operate')`,
  its entry's Scope. Route middleware runs before the route's validators, so a short scope answers
  `403` before any `400`. An unverified caller passes only `read`. Evidence:
  [auth.middleware.int.test.ts](../../../../packages/api/src/auth.middleware.int.test.ts).
- `packages/api` imports no Lambda type: the generator is a dependency of its factory
  ([composition.md](composition.md#the-factory)), so the `aws-lambda` grep stays clean.
- **The request id is a log field, never a response header**: a new header is a public contract
  change (Ask-first). Hono's middleware sets `X-Request-Id` on the response unless `headerName` is
  empty ([source](https://raw.githubusercontent.com/honojs/hono/main/src/middleware/request-id/request-id.ts)).
- **From slice 2 every mode enforces steps 2–4**, local mode included
  ([Conventions → Auth](../../../../.ai/api-contract.md#conventions)); the local server still binds
  loopback only and MUST refuse to start on any other interface until slice 2B decides the
  `docker compose` bind.

## Errors: one `onError`, one `defaultHook`

- **`defaultHook`** on `new OpenAPIHono({ defaultHook })` turns every request-validation failure into
  `400` with `validation_failed`, `message` naming the field and never its value. A route never
  passes its own hook. A field whose rule differs on one route gets a route-scoped message, keyed
  by the matched route's path in `create-api.ts`'s `routeFieldErrors`: `dlq.listMessages` answers
  `limit must be an integer from 1 to 10.` where every other `limit` names 1 to 100.
- **`app.onError`** maps a thrown error class to its registry status and the error object; anything
  else becomes `500 internal_error`, logged by `error_name` and `request_id`, its message never sent
  ([one mapping per surface](../../pp-general/references/errors.md#one-mapping-per-surface)).
- **`415` and malformed JSON bypass `defaultHook` and reach `onError`** (`@hono/zod-openapi` 1.6.3,
  `hono` 4.13.13, checked 2026-10-17): a JSON-body route gets a media-type gate that throws
  `HTTPException(415)` when `Content-Type` is not JSON, or is missing while a body is sent; Hono's
  validator throws `HTTPException(400)` on malformed JSON. Without a mapping, Hono's default handler
  answers either as raw text. `onError` maps both to `400 validation_failed` naming the body. A
  missing `Content-Type` with no body passes the gate and reaches `defaultHook` as `{}`, but only
  when the route sets `request.body.required: true`; otherwise the library skips validation and the
  handler gets `{}`. Evidence: [get-recipient.route.int.test.ts](../../../../packages/api/src/get-recipient.route.int.test.ts)
  (no `Content-Type` with and without a body, `text/plain`, malformed JSON).
- **An unmatched method or path answers `404 route_not_found`** in the error shape, from
  `app.notFound` (Hono answers an unmatched method on a served path the same way); never Hono's
  plain-text default. Evidence: [create-api.test.ts](../../../../packages/api/src/create-api.test.ts).

## The OpenAPI document

`app.getOpenAPI31Document()` (or `app.doc31()`) generates OpenAPI 3.1 from the route schemas. A
root script, `pnpm openapi:export`, writes it to the committed `packages/sdk/openapi.json`
([sdk.md](sdk.md#build-path)). Every `packages/api` change that alters the document re-runs it in
the same change; the `pnpm verify` drift stage fails otherwise (ADR-011). `POST /webhooks/resend` is
not in the document ([Ingest boundary](../../../../.ai/api-contract.md#ingest-boundary)).

## Never

- **A route that is not in api-contract.md** → the entry first, with its Ask-first approval
  ([pp-workflow → Never](../../pp-workflow/SKILL.md#never)).
- **A plain `app.get(…)` beside `app.openapi(…)`** → `createRoute`, so the document stays complete.
- **A database connection before the tag check** → the order above.
- **A row or payload on the wire** → the mapper.
- **A generic `operate` endpoint or a free-form filter** → one named operation per entry.
