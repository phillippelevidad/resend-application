# The SDK (`packages/sdk`)

The public TypeScript client for the read API, and the only way the CLI and the MCP server reach the
system ([ADR-011](../../../../.ai/architecture.md#adr-011--one-contract-many-surfaces),
[ADR-019](../../../../.ai/architecture.md#adr-019--application-and-surface-stack)). It is generated
types plus a thin hand-written client. Its wire rules are
[api-contract.md → Conventions](../../../../.ai/api-contract.md#conventions); this file is how the
code meets them.

## Build path

1. `packages/api` generates OpenAPI 3.1 from its routes ([read-api.md](read-api.md#the-openapi-document)).
2. `pnpm openapi:export`, a root script, writes it to **`packages/sdk/openapi.json`**, committed.
3. `openapi-typescript` generates the SDK's type file from that JSON, also **committed**. Its path is
   the slice 1 pre-proposal's.
4. A `pnpm verify` stage regenerates both and fails when either differs from the committed copy
   (ADR-011; evidence: the stage fails on a stale fixture, slice 1).

Both generated files are outputs: never edited by hand, regenerated from the source
([Permissions](../../../../AGENTS.md#permissions)). **`packages/sdk` never depends on server code**:
no import of `@ledger/api`, `db`, `aws`, `ingest`, `worker`, `reconciler`, `dispatcher` or
`resend-client`. The committed JSON is the bridge, so the boundary holds with no build step.

## The client

- **Over `openapi-fetch`**: `createClient<paths>({ baseUrl })` from the generated `paths` type
  ([docs](https://openapi-ts.dev/openapi-fetch/)). Each call returns `data` for a `2xx`, `error` for
  a `4xx` or `5xx`, and the raw `response`.
- **It takes `baseUrl` and `token`**, nothing else required. It reads no environment variable: the
  CLI and the MCP server read `LEDGER_URL` and `LEDGER_TOKEN` and pass them in. There is no other
  way to hand it a token.
- **It sends `Authorization: Bearer <token>` on every request**, from slice 1, when the local server
  still skips the check, so no client changes between slices
  ([Conventions → Auth in slice 1](../../../../.ai/api-contract.md#conventions)).
- **One method per operation, named by its Surfaces line:** `ledger.emails.get`,
  `ledger.recipients.get`, `ledger.reconcile.start`, `ledger.tokens.create` (plural for collections,
  otherwise the namespace as written; [Operation template](../../../../.ai/api-contract.md#operation-template)).
  Never a generic `request(path)` on the public surface.
- **An address is passed as a method argument and sent in the body**, never placed in a path or
  query (`recipients.get` posts to `/recipients/lookup`).

## Return style: `{ data, error }` (owner, O-10)

The SDK returns `{ data, error }`, like Resend's own SDK (RS-23), and **never throws for an API
error**. This is the one named exception to pp-general's "no `Result` type"
([pp-general → Never](../../pp-general/SKILL.md#never),
[errors.md](../../pp-general/references/errors.md#one-base-class)): the SDK is a public
surface that sits close to Resend's. Everything inside the server still throws.

- **`error` is the error object**, `{ code, message, hint, docs }`, exactly as the API sent it.
- **A response without the error shape** (the HTTP API's own `429` or `5xx`, as after a kill-switch
  trip, AWS-14) becomes the client-side `api_unavailable`, with its registry `message` and `hint`.
- **An unknown `code` passes through unchanged**; consumers treat it as a generic failure. Unknown
  response fields are ignored, never rejected (Conventions → Versioning).
- **A network failure** (`fetch` throws; `openapi-fetch` surfaces it through its `onError`
  middleware, [API](https://openapi-ts.dev/openapi-fetch/api)) is caught and returned as `error` with the
  client-side `api_unavailable`, never thrown ([Error codes](../../../../.ai/api-contract.md#error-codes)).
- **It exports the client-side error objects** `api_unavailable` and `internal_error`, with their
  registry `message`, `hint` and `docs`, so the CLI and the MCP server write no `code` literal for
  an unexpected client-side failure (O-12).
- **The CLI and the MCP server unwrap it and map once**: exit code and output for the CLI
  ([pp-cli](../../pp-cli/SKILL.md#output-and-exit-codes)), a tool result with `isError: true` for MCP
  ([pp-mcp](../../pp-mcp/SKILL.md)).

## Retries (slice 5)

- **Reads only**, every operation whose entry says "the SDK retries it", `recipient.get` included
  although it is a `POST`. So the flag is per operation, never inferred from the HTTP method.
- **On network errors, `429` and `5xx`**, with backoff; never on another `4xx`.
- **Never a command.** `token.create` mints a new token per call and is never retried; the other
  commands state their own idempotency and the SDK retries none of them.
- The count and the backoff curve are the slice 5 pre-proposal's. Evidence: SDK unit tests
  (slice 5); the SDK ↔ API contract tests from slice 1 grow per slice.

## Never

- **Hand-editing `openapi.json` or the generated types** → change `packages/api`, then
  `pnpm openapi:export` and regenerate.
- **An SDK import of server code** → the committed OpenAPI document and its generated types.
- **A `throw` for an API error** → return `{ data, error }`.
- **A `token` option read from the environment, or a token in a URL** → the `token` argument, sent
  as the bearer header.
- **A retry on a command** → reads only.
