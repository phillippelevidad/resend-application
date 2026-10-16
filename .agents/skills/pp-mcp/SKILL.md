---
name: pp-mcp
description: Ledger's MCP server conventions — `@modelcontextprotocol/server` v2 over stdio, flags through `node:util` `parseArgs`, one tool per `apps/mcp/src/tools/<tool-name>.tool.ts`, the tool set decided once at startup from `token.getCurrent` (operate tools only with an `operate` token and `--enable-operate`), tool names, annotations and the set exactly as api-contract, the SDK's `{ data, error }` unwrapped once into a tool result, masks-only output, failures as `isError: true` with the error object, stdout reserved for JSON-RPC, and the registration and redaction tests. Load it before writing or reviewing anything under `apps/mcp/**` — "add an MCP tool", "register this tool", "why is this tool missing", "what does the tool return", "is this safe to show an agent", "test the MCP server". Load it alongside pp-workflow and pp-general, not instead of them. When it and a linked doc disagree, the doc wins and this file is fixed.
---

# pp-mcp — patterns and practices, the MCP server

An agent reaches Ledger through the same contract as everyone else, with less privilege and with
masks only ([ADR-011](../../../.ai/architecture.md#adr-011--one-contract-many-surfaces),
[J6](../../../.ai/features.md#j6--agent-explanation-via-mcp)). The rules live in
[api-contract.md → Conventions](../../../.ai/api-contract.md#conventions) (MCP least privilege,
Redaction, Errors) and [pp-backend → Surfaces](../pp-backend/SKILL.md#surfaces--sdk-cli-mcp); this
skill carries the mechanics and the gate.

**Owns:** tool files and the startup registration · annotations · unwrapping the SDK result into a
tool result · stdout discipline · the flag parse · the server's tests.

**Does not own:** which tools, inputs and scopes exist → [api-contract.md](../../../.ai/api-contract.md)
· the masks and what an operation returns → the read API ([pp-backend](../pp-backend/SKILL.md)) ·
the error class and `message` / `hint` → [pp-general → errors](../pp-general/references/errors.md) ·
test tiers and the Postgres harness → [pp-testing](../pp-testing/SKILL.md) · a Streamable HTTP
transport → not planned; it needs an ADR.

## Precedence

[pp-general → Precedence](../pp-general/SKILL.md#precedence): on `apps/mcp/**` this skill beats
pp-general; a doc beats both.

| Reference | Open when |
| --- | --- |
| [tool-anatomy.md](references/tool-anatomy.md) | Writing `main.ts`, the server factory, a `.tool.ts` or the result mapper |
| [mcp-tests.md](references/mcp-tests.md) | Writing the registration, tool or redaction tests |

## Stack and layout

- **`@modelcontextprotocol/server` v2 over stdio** ([ADR-019](../../../.ai/architecture.md#adr-019--application-and-surface-stack));
  never the v1 `@modelcontextprotocol/sdk`. `McpServer` comes from `@modelcontextprotocol/server`
  and the stdio entry from `@modelcontextprotocol/server/stdio`. The installed 2.3.1 ships both
  `serveStdio(factory)` (the v2 docs) and `new StdioServerTransport()` plus `server.connect()` (the
  README); `apps/mcp/src/main.ts` uses `serveStdio`, and that is the one form
  ([serving over stdio](https://ts.sdk.modelcontextprotocol.io/v2/serving/stdio.html)).
- **Flags through `node:util` `parseArgs`** ([Node docs](https://nodejs.org/docs/latest-v24.x/api/util.html#utilparseargsconfig)),
  `strict` and no positionals: the one flag is `--enable-operate`. No flag-parsing dependency.
- **`apps/mcp` is `@ledger/app-mcp`.** It imports `@ledger/sdk` and `@ledger/shared` (config loader,
  logger) and no other workspace package ([review grep 13](../pp-general/references/boundaries.md#review-greps)).
- **One tool per file:** `apps/mcp/src/tools/<tool-name>.tool.ts`, the contract's snake_case tool
  name kebab-cased for the file (`get_email_status` → `get-email-status.tool.ts` →
  `getEmailStatusTool`, [role suffixes](../pp-general/references/coding-standards.md#role-suffixes)).
  Its `name` string is the contract's, verbatim.
- **`main.ts`** is the composition root: flags, `LEDGER_URL` and `LEDGER_TOKEN` through the shared
  loader ([config](../pp-general/references/config-and-env.md#parse-once-at-the-composition-root)),
  one SDK client, the scope read, the tool selection, then serving.

## Tool registration and least privilege

Exactly [api-contract.md → Conventions](../../../.ai/api-contract.md#conventions) (MCP least privilege):

1. **At startup, before serving**, call `ledger.tokens.getCurrent()`
   ([token.getCurrent](../../../.ai/api-contract.md#tokengetcurrent)) and unwrap `{ data, error }`
   (owner, O-10; [pp-backend → sdk.md](../pp-backend/references/sdk.md)). It is a read: the SDK
   retries it on a network error, `429` or `5xx` ([Conventions](../../../.ai/api-contract.md#conventions),
   Idempotency), so one transient `503 database_unavailable` does not end the session; the retry
   budget stays short so startup still answers `initialize` promptly. On the `error` left after
   those retries, write the error shape to stderr and exit non-zero, serving nothing: without a known
   scope no tool set is provably least-privilege.
2. **Each tool file declares its `scope`, copied from its operation's Scope line**, never from the
   section it sits in (S-03; [Read operations](../../../.ai/api-contract.md#read-operations)).
3. **Register a `read` tool always; an `operate` tool only when `data.scope === 'operate'` and
   `--enable-operate` was passed.** An unregistered tool is absent from `tools/list`, not refused.
   When `--enable-operate` was passed but the scope is `read`, log one line through the logger (so
   stderr) with a constant message saying the operate tools were not registered, so the owner sees
   why they are missing ([Log fields](../../../.ai/data-modeling.md#log-fields): no token value).
4. **Annotations come from the scope, in one place:** `read` → `readOnlyHint: true`; `operate` →
   `readOnlyHint: false`, `destructiveHint: false`, `idempotentHint: true`. No other hint.
   Annotations are hints clients treat as untrusted; the read API enforces scope (`403 forbidden`).
5. **Decided once.** No tool is enabled, disabled or removed at runtime, and no list-changed
   notification is sent. A token change takes a restart.
6. **The tool set is api-contract's:** the operations whose Surfaces line names an MCP tool, and
   only those. `health.get`, `reconcile.getRun`, `worker.resumeEventSource` and every `token.*`
   operation have none. Adding a tool is Ask-first ([Permissions](../../../AGENTS.md#permissions)).

Evidence: the tool-registration test per scope ([slice 5](../../../.ai/build-checklist.md#5--mcp-server-and-contract-hardening),
[mcp-tests.md](references/mcp-tests.md#registration-test)).

## Output

- **Success:** text content holding `JSON.stringify(data)`, the SDK's `data` as the API returned it.
  Nothing is added, and no input (an address above all) is echoed. `outputSchema` and
  `structuredContent` are not used in v0: they would be a second schema beside the OpenAPI types;
  adopting them is a slice 5 pre-proposal call.
- **Failure:** `isError: true` with `JSON.stringify({ error })` as the text content, never a JSON-RPC
  protocol error ([Conventions → Errors](../../../.ai/api-contract.md#conventions)).
- **Never let a handler throw.** The SDK turns a thrown error's message into the result text
  ([v2 → Errors](https://ts.sdk.modelcontextprotocol.io/v2/servers/errors.html)), so internals would
  reach the model. Every handler returns through the one mapper; an unexpected throw becomes
  `isError: true` with the `internal_error` object (O-12), never the exception's text.
- **`inputSchema` holds JSON types only** (string, boolean, integer, with descriptions). The SDK
  rejects arguments that fail it with its own `isError` text, the one exception to the error shape
  ([Conventions](../../../.ai/api-contract.md#conventions),
  [v2 → Tools](https://ts.sdk.modelcontextprotocol.io/v2/servers/tools.html)); domain checks stay
  with the API, which answers `validation_failed`. `[Unverified]`: whether that SDK text quotes the
  argument; slice 5's redaction test covers it.
- **Masks only.** No secret, token, payload, free-text payload field or raw PII in any output, log
  or description ([PII & retention](../../../.ai/data-modeling.md#pii--retention),
  [email.explainDelivery](../../../.ai/api-contract.md#emailexplaindelivery)).
- **stdout is the JSON-RPC channel.** Logs go to stderr: the shared logger with every level routed
  to stderr (Winston Console `stderrLevels`), never `console.log`
  ([v2 → stdio](https://ts.sdk.modelcontextprotocol.io/v2/serving/stdio.html)). A log line carries
  allow-listed fields only, never a tool argument ([Log fields](../../../.ai/data-modeling.md#log-fields)).
  Evidence: the [stdout test](references/mcp-tests.md#stdout-test).

## Always

- Copy each tool's name, inputs and scope from its api-contract entry; its title and description
  say what it returns and that values are masked, and name no behavior Ledger lacks.
- Reach the system through the SDK client only ([ADR-011](../../../.ai/architecture.md#adr-011--one-contract-many-surfaces)).
- Await `token.getCurrent` and select the tool set before the server is built.
- Build the server in one factory that `main.ts` and the tests share ([anatomy](references/tool-anatomy.md#the-server-factory)).
- Return every result through the one mapper ([anatomy](references/tool-anatomy.md#the-result-mapper)).
- Give each new tool its tool test and a row in the redaction test ([mcp-tests.md](references/mcp-tests.md)).

## Case-by-case

| Do this | Deciding test |
| --- | --- |
| Register an operate tool | `token.getCurrent` returned `operate` **and** `--enable-operate` was passed |
| Add a field to `inputSchema` | The Surfaces line names it, or the In line when the Surfaces line names no input (`dry_run` alone for `reconcile`) |
| Constrain an input beyond its JSON type | Never; the API validates |
| Add a server flag | api-contract names it (today only `--enable-operate`); otherwise Ask-first |

## Never

- **An operate tool on scope alone, on the flag alone, or keyed on its api-contract section** →
  both conditions, scope from the entry's Scope line.
- **A tool for an operation whose Surfaces line says MCP none, or one api-contract does not name** →
  the entry first, Ask-first.
- **Runtime toggling (enable, disable, remove, a list-changed notification, a per-call scope
  check)** → decided once at startup; restart.
- **A registered tool that refuses for scope** → leave it unregistered.
- **Annotations other than the scope-derived set, or treated as enforcement** → the contract's
  hints; the read API enforces.
- **A handler that throws, or a `ProtocolError` for a tool failure** → the one mapper, `isError: true`.
- **A second error format** (plain text, `{ message }` alone) → `{ "error": … }`, the
  [one shape](../../../AGENTS.md#error-shape).
- **Anything on stdout outside the transport** → stderr.
- **Raw PII, a token, a secret, the payload or a tool argument in output, logs or descriptions** →
  masks from the API ([PII in code](../pp-general/references/logging-and-pii.md#pii-in-code)).
- **An import of `@ledger/db`, `@ledger/api` or any server package** → the SDK.
- **Streamable HTTP or an HTTP adapter in the server** → stdio; HTTP needs an ADR.
- **A flag-parsing dependency, `strict: false`, or a flag api-contract lacks** → `parseArgs`, strict.
- **MCP SDK v1** → v2 (ADR-019).
- **Serving with a guessed scope when `token.getCurrent` fails** → exit, fail closed.
- **A redaction test over pre-masked fake data only** → real API output from stored raw payloads
  ([mcp-tests.md](references/mcp-tests.md#redaction-test)).

## Gate — then read the diff

**Gate.** The two tiers of [pp-workflow → Definition of done](../pp-workflow/SKILL.md#definition-of-done):
`pnpm check` before each commit, `pnpm verify` at slice close or in CI.

**Then read the diff** (each yes or no; expected output of each grep: none) · the `name` strings in
`apps/mcp/src/tools/*.tool.ts` are exactly api-contract's MCP tool names, and each `scope` equals
its entry's Scope · no v1 SDK: `git grep -n "@modelcontextprotocol/sdk" -- apps/mcp` · stdout
untouched: `git grep -nE "console\.|process\.stdout" -- apps/mcp/src ':!*.test.ts'` · SDK only:
review grep 13 · no throw in a tool: `git grep -nE "throw |ProtocolError" -- apps/mcp/src/tools` ·
no runtime toggling: `git grep -nE "\.(enable|disable|remove)\(|list_changed|ListChanged" -- apps/mcp/src`
· stdio only: `git grep -nE "createMcpHandler|StreamableHTTP|@modelcontextprotocol/(node|express|hono|fastify)" -- apps/mcp/src ':!*.test.ts'`
· no flag dependency: `git grep -nE "minimist|yargs|commander" -- apps/mcp` · `parseArgs` keeps
`strict` · annotations set only by the scope-derived helper · the registration test covers all four
scope × flag cases · the [stdout test](references/mcp-tests.md#stdout-test) passes · every tool has a tool test and a redaction-test row · every new tool, input or
flag carries its api-contract entry and Ask-first approval.
