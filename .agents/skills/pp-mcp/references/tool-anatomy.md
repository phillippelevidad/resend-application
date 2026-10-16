# Tool anatomy

How `apps/mcp` is put together. The sketches are the convention's shape, not an API: check the
installed `@modelcontextprotocol/server` v2 and the SDK's real signatures first
([version rule](../../pp-general/SKILL.md#check-the-installed-version-not-memory)). The
`registerTool(name, config, handler)` form, `inputSchema` as a Zod schema, `title`, `annotations`
and `isError` are from the v2 docs
([Tools](https://ts.sdk.modelcontextprotocol.io/v2/servers/tools.html)).

```text
apps/mcp/src/
  main.ts                  composition root: flags, env, SDK client; calls startServer
  start-server.ts          scope read, fail-closed exit, selection, serve
  mcp.config.ts            Zod schema for LEDGER_URL and LEDGER_TOKEN
  create-server.ts         builds the McpServer from a chosen tool list
  to-tool-result.ts        the one mapper from { data, error } to a tool result
  tools/<tool-name>.tool.ts
```

## The composition root

```ts
// apps/mcp/src/main.ts
import { parseArgs } from 'node:util';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { createLedgerClient } from '@ledger/sdk';
import { loadConfig } from '@ledger/shared';
import { mcpConfig } from './mcp.config.ts';
import { startServer } from './start-server.ts';

const { values } = parseArgs({
  options: { 'enable-operate': { type: 'boolean', default: false } },
  strict: true,
  allowPositionals: false,
});
await startServer({
  ledger: createLedgerClient(loadConfig(mcpConfig, process.env)),
  enableOperate: values['enable-operate'],
  serve: serveStdio,
  stderr: process.stderr,
  // process.exitCode, not exit(): a piped stderr write is asynchronous on POSIX
  // (Node → A note on process I/O).
  setExitCode: (code) => { process.exitCode = code; },
});
```

```ts
// apps/mcp/src/start-server.ts
export async function startServer({ ledger, enableOperate, serve, stderr, setExitCode }) {
  const { data, error } = await ledger.tokens.getCurrent();
  if (error) {
    // Fail closed: no known scope, no tool set.
    stderr.write(`${JSON.stringify({ error })}\n`);
    setExitCode(1);
    return;
  }
  const tools = selectTools({ scope: data.scope, enableOperate });
  serve(() => createServer({ ledger, tools }));
}
```

- `parseArgs` with `strict: true` throws on an unknown option or a wrong type (codes
  `ERR_PARSE_ARGS_UNKNOWN_OPTION`, `ERR_PARSE_ARGS_INVALID_OPTION_VALUE`,
  `ERR_PARSE_ARGS_UNEXPECTED_POSITIONAL`; [Node errors](https://nodejs.org/docs/latest-v24.x/api/errors.html)).
  Let it surface on stderr and exit non-zero before serving.
- The scope read is awaited **before** the factory runs, so the factory is synchronous and closes
  over a tool list already decided. Whether `serveStdio`'s factory may be async is not documented;
  nothing depends on it.
- `getCurrent` is a read the SDK retries before `error` comes back; `startServer` adds no retry of
  its own ([SKILL.md → Tool registration](../SKILL.md#tool-registration-and-least-privilege)).
- `createLedgerClient` stands for the SDK's factory (pp-backend, slice 1).
- **The startup sequence is testable without a process.** The scope read, the fail-closed exit,
  the selection and the serve call are `startServer({ ledger, enableOperate, serve, stderr,
  setExitCode })` in `start-server.ts`. `main.ts` passes `serveStdio`, `process.stderr` and an
  exit-code setter, so the failing-`getCurrent` case runs over the fake SDK without a spawned
  process.
- The installed 2.3.1 also ships `new StdioServerTransport()` plus `await server.connect(transport)`
  ([README](https://github.com/modelcontextprotocol/typescript-sdk)); `serveStdio` is the form
  `apps/mcp/src/main.ts` uses, so it stays the only one.
- Shutdown: on stdin EOF the transport closes itself; a `SIGINT` handler calls the handle's
  `close()` ([v2 → stdio](https://ts.sdk.modelcontextprotocol.io/v2/serving/stdio.html)).

## The server factory

```ts
// apps/mcp/src/create-server.ts
import { McpServer } from '@modelcontextprotocol/server';

const READ = { readOnlyHint: true } as const;
const OPERATE = { readOnlyHint: false, destructiveHint: false, idempotentHint: true } as const;

// api-contract → Conventions (MCP least privilege): the only place annotations are chosen.
export const annotationsFor = (scope: 'read' | 'operate') => (scope === 'read' ? READ : OPERATE);

export function selectTools(input: { scope: 'read' | 'operate'; enableOperate: boolean }): LedgerTool[] {
  const operateAllowed = input.scope === 'operate' && input.enableOperate;
  return ALL_TOOLS.filter((tool) => tool.scope === 'read' || operateAllowed);
}

export function createServer(deps: { ledger: LedgerClient; tools: LedgerTool[] }): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });
  for (const tool of deps.tools) tool.register(server, deps.ledger);
  return server;
}
```

- `ALL_TOOLS` lists every `.tool.ts` export. `selectTools` keys on each tool's own `scope`, never
  on a list of names, so a new tool cannot slip past it.
- `SERVER_NAME` and `SERVER_VERSION` are one constant each; the published name waits for slice 8.

## A tool

```ts
// apps/mcp/src/tools/get-email-status.tool.ts
import { z } from 'zod';
import { annotationsFor } from '../create-server.ts';
import { toToolResult } from '../to-tool-result.ts';

export const getEmailStatusTool = {
  name: 'get_email_status',   // api-contract → email.get, Surfaces
  scope: 'read',              // api-contract → email.get, Scope
  register(server: McpServer, ledger: LedgerClient) {
    server.registerTool(
      this.name,
      {
        title: 'Email status',
        description: 'Projected state, per-recipient outcome and event timeline of one email. Addresses and subjects are masked.',
        inputSchema: z.object({ email_id: z.string().describe('The Resend email id') }),
        annotations: annotationsFor(this.scope),
      },
      async ({ email_id }) => toToolResult(() => ledger.emails.get({ email_id })),
    );
  },
} as const;
```

- **Zod** is the repo's one Zod 4, imported as everywhere else; the v2 docs' `zod/v4` subpath is
  the same library ([ADR-019](../../../../.ai/architecture.md#adr-019--application-and-surface-stack):
  the SDK requires `zod ^4.2.0`).
- **Inputs follow the operation's Surfaces line** when it names any (it is then the full set),
  otherwise its In line, named as the wire names them (`email_id`, `address`, `since`, `limit`,
  `after`, `dry_run`). JSON types only: no `.email()`, regex, `.min()` or
  `.max()`; the API answers `validation_failed`.
- **The description is a constant.** It names what the tool returns and that it is masked, and
  carries no instruction to the model and no example address but a Resend test address.
- An `address` argument goes to the SDK method only, which sends it in a request body. It is never
  logged, echoed or placed in a description.

## The result mapper

```ts
// apps/mcp/src/to-tool-result.ts
export async function toToolResult<T>(call: () => Promise<SdkResult<T>>): Promise<CallToolResult> {
  try {
    const { data, error } = await call();
    if (error) return { isError: true, content: [{ type: 'text', text: JSON.stringify({ error }) }] };
    return { content: [{ type: 'text', text: JSON.stringify(data) }] };
  } catch {
    // A defect. The SDK would put a thrown message in the result text, so it is never rethrown.
    return { isError: true, content: [{ type: 'text', text: UNEXPECTED_FAILURE_TEXT }] };
  }
}
```

- The SDK's `error` is the inner `{ code, message, hint, docs }` (owner, O-10;
  [pp-backend → sdk.md](../../pp-backend/references/sdk.md)), wrapped once into the
  [error shape](../../../../AGENTS.md#error-shape). An unknown `code` passes through as received.
- `UNEXPECTED_FAILURE_TEXT` is `JSON.stringify({ error: internalError })`, the registry's
  `internal_error` object exported by the SDK (O-12,
  [Error codes](../../../../.ai/api-contract.md#error-codes)), built once.
- The caught exception is logged by its name only, to stderr
  ([logger](../../pp-general/references/logging-and-pii.md#logger)).
