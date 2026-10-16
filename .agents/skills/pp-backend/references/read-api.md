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
   `gaps.list` and `token.list` paginate.

Addresses travel only in request bodies (`recipient.get` is a `POST` for that reason); a path or
query parameter never carries one ([PII in code](../../pp-general/references/logging-and-pii.md#pii-in-code)).
Header keys in a request schema are lowercase.

## Mappers

A route's response is built only by an explicit `.mapper.ts`, which takes the reader's read shape
and returns the wire object. **The mapper is where the masks are applied**, by the `packages/core`
mask functions, so a new column cannot leak by passthrough. Never a row spread into a response,
never the raw payload, never a token hash ([Redaction](../../../../.ai/api-contract.md#conventions)).
`email.explainDelivery` returns ids, timestamps, closed-set values and masks only: no free-text
payload field, even masked.

## Middleware, in this order

| Step | Does | Fails with |
| --- | --- | --- |
| 1. Request id | Sets `requestId` for the logger: Hono's `requestId` middleware with `headerName: ''` (so it neither reads a client header nor sets a response header) and a `generator` the factory receives from its root: `apps/api` reads the Lambda context's `awsRequestId` (`c.env.lambdaContext`), `apps/local` uses `crypto.randomUUID()` | — |
| 2. Token tag check | Parses `Authorization: Bearer ldg_…` and checks the HMAC tag with `packages/shared`'s tag check, **before any database connection opens** | `401 unauthorized` |
| 3. Token lookup | Loads the token row by its hash; a revoked or unknown token fails. `health.get` alone skips it during a database outage and answers on the tag alone | `401 unauthorized`, `503 database_unavailable` |
| 4. Scope | Compares the token's scope with the **entry's Scope**, never its section (`token.list` is a read needing `operate`); `operate` implies `read` | `403 forbidden` |
| 5. The route | Validation, then the handler | `400 validation_failed`, the entry's codes |

- `packages/api` imports no Lambda type: the generator is a dependency of its factory
  ([composition.md](composition.md#the-factory)), so the `aws-lambda` grep stays clean.
- **The request id is a log field, never a response header**: a new header is a public contract
  change (Ask-first). Hono's middleware sets `X-Request-Id` on the response unless `headerName` is
  empty ([source](https://raw.githubusercontent.com/honojs/hono/main/src/middleware/request-id/request-id.ts)).
- **Slice 1** runs with no token store: the local server skips steps 2–4 only while bound to a
  loopback address and MUST refuse to start on any other interface
  ([Conventions → Auth in slice 1](../../../../.ai/api-contract.md#conventions)).

## Errors: one `onError`, one `defaultHook`

- **`defaultHook`** on `new OpenAPIHono({ defaultHook })` turns every request-validation failure into
  `400` with `validation_failed`, `message` naming the field and never its value. A route never
  passes its own hook.
- **`app.onError`** maps a thrown error class to its registry status and the error object; anything
  else becomes `500 internal_error`, logged by `error_name` and `request_id`, its message never sent
  ([one mapping per surface](../../pp-general/references/errors.md#one-mapping-per-surface)).
- **[Unverified]:** whether `@hono/zod-openapi`'s `415` for a missing or unsupported `Content-Type`
  on a JSON-body route reaches `defaultHook` or `onError` or bypasses both. Slice 1's contract tests
  include `recipient.get` without `Content-Type`; a bypass is mapped before slice 1 is done.
- An unmatched path has no registry code today. The slice 1 pre-proposal settles its response;
  adding a code is Ask-first.

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
