# MCP server tests

The evidence slice 5 owes for the MCP surface
([slice 5](../../../../.ai/build-checklist.md#5--mcp-server-and-contract-hardening),
[ADR-011](../../../../.ai/architecture.md#adr-011--one-contract-many-surfaces),
[ADR-019](../../../../.ai/architecture.md#adr-019--application-and-surface-stack)): MCP tool tests,
the tool-registration test per scope, and redaction tests over every tool's actual output. "PII
masking in MCP output" is a Mandatory row of [pp-workflow → Test tiers](../../pp-workflow/SKILL.md#test-tiers).
File names and runners are [pp-testing](../../pp-testing/SKILL.md#test-files-and-tiers)'s.

## Harness

- **A real MCP client over the real server factory.** The v2 testing guide drives a server
  in-process through `createMcpHandler(createServer)` and a `Client` with
  `StreamableHTTPClientTransport` whose `fetch` is `handler.fetch`; `InMemoryTransport.createLinkedPair()`
  is its alternative for 2025-era protocol versions
  ([v2 → Testing](https://ts.sdk.modelcontextprotocol.io/v2/testing.html)). `Client` and
  `StreamableHTTPClientTransport` come from `@modelcontextprotocol/client`, a dev dependency:
  **Ask-first**, approved with the tools in slice 5. `createMcpHandler` and `InMemoryTransport` are
  exported by the installed `@modelcontextprotocol/server` 2.3.1 itself. `createMcpHandler` stays in tests; the server ships stdio only.
- **`createServer({ ledger, tools })`** is the same factory `main.ts` serves
  ([tool-anatomy.md](tool-anatomy.md#the-server-factory)), and `selectTools` the same selection.
- **The fake SDK** comes from `@ledger/sdk/testing`, typed against the SDK's client and returning
  `{ data, error }` as the real one does (shared with the CLI tests).
- `[Unverified]`: the client's tool-listing call (`client.listTools()` in v1; the v2 testing page
  shows only `callTool`). Check the installed client.

## Registration test

One test file, four cases, asserting what `tools/list` returns, not what `selectTools` was called
with:

| `token.getCurrent` scope | `--enable-operate` | Listed |
| --- | --- | --- |
| `read` | off | The five read tools |
| `read` | on | The five read tools |
| `operate` | off | The five read tools |
| `operate` | on | The five read tools plus `reconcile` and `redrive_dlq` |

- The read tools are `get_email_status`, `explain_delivery`, `get_recipient_status`, `list_gaps`
  and `inspect_dlq`, per api-contract's Surfaces lines. The test reads the expected names from one
  list that mirrors api-contract, so a tool added without its entry fails it.
- Each listed tool carries exactly the scope's annotations: `readOnlyHint: true` for read;
  `readOnlyHint: false`, `destructiveHint: false`, `idempotentHint: true` for operate.
- Nothing else is listed: no tool for `health.get`, `reconcile.getRun`, `worker.resumeEventSource`
  or any `token.*` operation.
- A failing `token.getCurrent` (the fake returns `unauthorized`) serves nothing: `startServer` sets a
  non-zero exit code, calls no `serve`, and writes the error shape to stderr.

## Tool tests

Per tool, through `callTool`:

- **Success:** `isError` absent or false; the text content parses to exactly the fake's `data`.
- **Registry error:** `isError: true`; the text parses to exactly `{ "error": error }`. One case
  uses an unknown `code` and one `api_unavailable`, both passed through as received.
- **A throwing SDK:** the fake throws an error whose message holds a sentinel string; the result is
  `isError: true` with the constant text, and the sentinel appears nowhere in it.
- **Arguments:** the fake recorded the arguments the contract's In line names, with the address
  passed to `recipients.get` as its argument (the SDK puts it in the body).

## Redaction test

**Constraint:** it runs over each tool's actual output, produced by the real read API from stored
raw payloads. A fake SDK returning pre-masked data proves nothing about masks, so it never counts
as this evidence ([data-modeling.md → PII & retention](../../../../.ai/data-modeling.md#pii--retention)).

- **Fixtures** (slice 5 Ships): events to Resend test addresses only, with a subject and display
  name, a `failed.reason` and `tags` carrying an instruction string, and bounce diagnostics.
- **Assertion**, per tool and per fixture: the output text holds none of the raw addresses, the
  subject, the display name, any tag key or value, the instruction string, the bounce `message` or
  `diagnosticCode`, a payload key, or the `LEDGER_TOKEN` value. Masks may appear.
- **Inputs too:** call `get_recipient_status` with an address and with a malformed one; neither
  output holds the raw input. This also settles the `[Unverified]` on the SDK's own argument
  rejection text ([SKILL.md → Output](../SKILL.md#output)).
- **Tier:** integration against real Postgres (`*.int.test.ts`), on pp-testing's
  [Postgres harness](../../pp-testing/SKILL.md#postgres-harness).
- **Where it lives is the slice 5 pre-proposal's**, inside review grep 13: `apps/mcp` imports only
  the SDK, its tests included ([boundaries](../../pp-general/references/boundaries.md#review-greps)).
  Recommended: spawn the MCP server over stdio with `StdioClientTransport` from
  `@modelcontextprotocol/client/stdio` (v2 → Testing), pointed at `apps/local` running on the test
  database with the fixtures posted through local ingest, so no app imports another.

## Stdout test

The in-process harness never observes stdout, so a logger built without `stderrLevels` passes every
test above ([SKILL.md → Output](../SKILL.md#output)). A unit test builds the logger through the same
function `main.ts` calls, at its most verbose level, writes one line at every level, and finds
`process.stdout.write` never called and every line on stderr.

## Never

- **Asserting on `selectTools`' return instead of `tools/list`** → list through a real client.
- **A redaction test on fake, pre-masked data only** → the real API over stored raw payloads.
- **A fixture with a real address** → Resend's test addresses
  ([integrations.md → Locked rules](../../../../.ai/integrations.md#locked-rules-must)).
- **`createMcpHandler` or an HTTP transport outside a test** → stdio in `main.ts`.
