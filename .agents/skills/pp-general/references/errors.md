# Errors

One shape everywhere ([root AGENTS.md → Error shape](../../../../AGENTS.md#error-shape)), codes only
from the registry ([api-contract.md → Error codes](../../../../.ai/api-contract.md#error-codes)), and
the surface rules in [api-contract.md → Conventions](../../../../.ai/api-contract.md#conventions).
This file owns how code produces that shape: one class, thrown, and mapped once per surface.

## One base class

`packages/shared` holds the one error base class ([ADR-013](../../../../.ai/architecture.md#adr-013--pure-core-and-local-mode)).
It carries a registry `code`, plus `message`, an optional `hint` and optional `docs`.

```ts
// packages/shared/src/errors/ledger.error.ts
import type { ErrorCode } from '@ledger/core';

export type LedgerErrorOptions = { hint?: string; docs?: string; cause?: unknown };

export class LedgerError extends Error {
  readonly code: ErrorCode;
  readonly hint: string | undefined;
  readonly docs: string | undefined;

  constructor(code: ErrorCode, message: string, options: LedgerErrorOptions = {}) {
    super(message, { cause: options.cause });
    this.name = 'LedgerError';
    this.code = code;
    this.hint = options.hint;
    this.docs = options.docs;
  }
}
```

Fields are assigned in the body, never as parameter properties
([imports-and-tsconfig.md](imports-and-tsconfig.md#node-24-runs-ts-directly)).

- **Throw it; never return a `Result` or Either type.** One error channel means one place to look.
  The one named exception is the public SDK, which returns `{ data, error }` like Resend's SDK
  (RS-23; owner, O-10); the CLI and MCP server unwrap it and map once.
- **`ErrorCode` is the core Zod enum** that mirrors the registry. Never invent a code in code:
  register it first, Ask-first ([Conventions](../../../../.ai/api-contract.md#conventions)).
- **HTTP status, default `hint` and `docs` come from the registry**, mirrored beside the enum in
  `packages/core`. A throw site passes `hint` only when it is more specific than the default (for
  `validation_failed`, the field name). `docs` is a Resend page or the runbook URL built from one
  base-URL constant ([Error codes](../../../../.ai/api-contract.md#error-codes)).
- **A subclass exists only when a caller branches on it.** The ADR-015 connection-class error is
  one: the worker branches on it to retry once on a fresh connection, then pause its event source
  ([ADR-015](../../../../.ai/architecture.md#adr-015--the-worker-pauses-its-own-event-source-on-a-database-outage)).
  Otherwise throw the base class with the right code.
- **`cause` carries the original error for the stack, never for output.** A Postgres or Zod error
  can quote a row or an input value, so `cause` is never logged beyond its name and never sent.

## Writing `message` and `hint`

- `message` says **what is wrong**; `hint` says **how to fix it**.
- Never a raw `ZodError`, a Postgres error text, a stack trace or a Resend response body. A
  validation message names the field, never its value.
- No address, subject or token in `message` or `hint`
  ([logging-and-pii.md](logging-and-pii.md#pii-in-code)).
- Never assert a behavior Ledger does not implement. A hint that names a command names one that
  exists in [api-contract.md](../../../../.ai/api-contract.md).

## One mapping per surface

Each surface maps errors **once, at its edge**. Nothing inside a package formats an error for a
surface. Anything that is not a `LedgerError` becomes `internal_error`: logged by error name and
`request_id` ([Log fields](../../../../.ai/data-modeling.md#log-fields)), its message never sent.

| Surface | The one mapper | Output |
| --- | --- | --- |
| Read API (`packages/api`) | The Hono app's `onError`, plus the `@hono/zod-openapi` `defaultHook` for request validation ([ADR-019](../../../../.ai/architecture.md#adr-019--application-and-surface-stack)) | The registry status and `{ "error": { code, message, hint, docs } }` |
| SDK (`packages/sdk`) | Its response handler | The same object. A response without the shape maps to `api_unavailable`; an unknown `code` is a generic failure ([Conventions](../../../../.ai/api-contract.md#conventions)) |
| CLI (`apps/cli`) | Its exit-code mapping | Exit `1` on a registry error: the object on stdout with `--json`, else `message` and `hint` on stderr; exit `2` on a usage error ([pp-cli → Output and exit codes](../../pp-cli/SKILL.md#output-and-exit-codes)) |
| MCP (`apps/mcp`) | Its tool-result mapping | `isError: true` with the error object as text content, never a JSON-RPC protocol error ([pp-mcp → Output](../../pp-mcp/SKILL.md#output)) |
| Reconcile run outcome | The reconciler | The code stored in `reconcile_runs.error_code`, returned as the run's `error` object ([Error codes](../../../../.ai/api-contract.md#error-codes)) |

**One envelope only.** A second error format on any surface, a per-route error shape, or a raw
framework error reaching a client is a defect.

## Catching

- Catch only to translate (a driver error into the right `LedgerError`, with the original as
  `cause`) or to act on a subclass a caller branches on.
- Never swallow. A handler that catches and returns normally hides a failure the queue would
  otherwise redrive ([ADR-008](../../../../.ai/architecture.md#adr-008--backpressure-bounded-concurrency-partial-batch-failure-dlq)).
- `database_unavailable` is raised by `packages/db`, the one place that classifies a connection
  failure ([Error codes](../../../../.ai/api-contract.md#error-codes)).
