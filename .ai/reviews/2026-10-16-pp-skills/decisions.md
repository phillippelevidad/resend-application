# pp-* skills build run 2026-10-16: decisions log

A historical record, not binding: every outcome below lives in the docs and skills it changed.

## Owner decisions (2026-10-16)

| ID | Question | Decision | Why |
| --- | --- | --- | --- |
| P-01 | Which stack do the skills prescribe for `apps/api` and the Lambda handlers? | Hono with `@hono/zod-openapi`, run through `@hono/aws-lambda` on Lambda and `@hono/node-server` locally. The other functions are plain typed handlers, each with a hand-wired composition root. Command and reader classes keep the `execute(input)` shape. The surfaces use `commander` 14 with `@commander-js/extra-typings` for the CLI, `@modelcontextprotocol/server` v2 for MCP, and `openapi-typescript` with `openapi-fetch` for the SDK. Lands as ADR-019 | CDK bundles with esbuild, and esbuild does not emit decorator metadata, so NestJS dependency injection needs build workarounds in CDK and in Vitest. NestJS also adds about 1 s of cold-start init, which falls on ingest's webhook timeout. `nestjs-zod` stops at Nest 11, now the legacy line. Resend's handbook names no backend framework, while Resend's CLI uses commander and Resend's MCP server uses SDK v2. The owner's patterns carry over without the container |
| P-02 | How is the skill set split? | 8 skills: `pp-workflow`, `pp-general`, `pp-backend`, `pp-database`, `pp-testing`, `pp-infra`, `pp-cli`, `pp-mcp` | Each skill loads by path. Testing is the project's evidence, so it gets its own skill |
| P-03 | Slice 1 runs ingest, worker and read API in one local process, yet "apps never import apps". How is that resolved? | Handler logic moves into packages: `packages/{ingest,worker,dispatcher,reconciler,api}` export factories over ports. Each `apps/*` becomes a thin runtime entry point: Lambda event adaptation plus its composition root. `apps/local` composes the same factories for local mode. `packages/shared` holds the kernel: logger, config, error base, clock, ports, token mint. Amends ADR-013 | The boundary stays absolute and pnpm's declared dependencies enforce it for free. Each package lands in the slice that first needs it |
| P-04 | How are the phases run? | Phases 0 and 1 run first, then the owner reviews the Phase 1 diff before Phase 2 | Every skill links the Phase 1 decisions |

## Settled in Phase 1 (decided by the docs or the decision lens)

Phase 1 fills these in as it applies them. Each row gives the tension, how it was resolved, and where
the resolution now lives.

| ID | Tension | Resolution | Lives in |
| --- | --- | --- | --- |
