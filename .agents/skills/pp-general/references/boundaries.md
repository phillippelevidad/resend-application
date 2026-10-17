# Module boundaries

The boundaries are stated once, in [root AGENTS.md → Module boundaries](../../../../AGENTS.md#module-boundaries),
and decided in [ADR-013](../../../../.ai/architecture.md#adr-013--pure-core-and-local-mode) (pure core,
logic in packages, apps as entry points, the kernel in `packages/shared`, `@aws-sdk/*` only in
`packages/aws`), [ADR-012](../../../../.ai/architecture.md#adr-012--resend-client-is-the-sole-resend-api-caller)
(`resend-client` is the sole Resend API caller) and
[ADR-011](../../../../.ai/architecture.md#adr-011--one-contract-many-surfaces) (CLI and MCP on the
SDK only). This file restates none of them. It adds the placement question and the greps that
check a diff.

## Where does this code go?

One question settles most placements: **does it do I/O?**

| The code… | Goes in |
| --- | --- |
| Is pure: event types, projections, masks, normalization, reaction rules, `explainDelivery` | `packages/core` |
| Is a kernel piece with no AWS, Postgres or Resend: a port interface, the logger, the metrics helper, config loading, the error base class, the clock, the token mint and tag check | `packages/shared` |
| Touches Postgres | `packages/db` (pp-database) |
| Calls `@aws-sdk/*` | `packages/aws`, behind a port declared in `packages/shared` |
| Calls Resend's API | `packages/resend-client` |
| Is the logic of one function (ingest, worker, dispatcher, reconciler, the read API) | That function's package, as a factory over ports |
| Adapts a Lambda event, or wires concrete classes | The `apps/<fn>` entry point: a `.handler.ts` plus its `main.ts` composition root |

Every package the [Projects](../../../../AGENTS.md#projects) table lists exists as a scaffold; its
logic lands in the slice the table's **Logic lands** column names. Adding, removing or repurposing
one is a doc duty ([pp-workflow → Definition of done](../../pp-workflow/SKILL.md#definition-of-done)).
Before creating a package, see [adding-things.md](adding-things.md#add-a-workspace-package).

## Review greps

Each boundary is one grep over the tracked tree, run from the repo root. **Expected: no output**,
unless the entry names what is allowed. Lint enforces most of them
([imports-and-tsconfig.md](imports-and-tsconfig.md#lint-enforcement-biome)); the greps catch what
lint does not express, and a reviewer can run them without a build. Each is a read; none changes
the tree. `git grep -P` needs a PCRE-enabled git (Git for Windows ships one).

A ban only a reviewer's memory enforces drifts, and the walk recurs per review (lens clause 1). So
the greps Biome cannot express (8, 9, 14, 15, and any ban slice 0 finds Biome `overrides` cannot
scope) run as one script in a `pnpm verify` stage, proven the way build-checklist slice 0 proves
the lint stage: a deliberate-violation fixture fails it
([imports-and-tsconfig.md](imports-and-tsconfig.md#lint-enforcement-biome)).

1. `core` and `shared` import no AWS, Postgres or Resend (Biome carries the full list,
   [Lint enforcement](imports-and-tsconfig.md#lint-enforcement-biome); this grep is the quick look):
   ```sh
   git grep -nE "from ['\"](@aws|aws-|aws4|amazon-|@smithy/|pg['\"/-]|postgres|drizzle-|@neondatabase/|@vercel/postgres|@electric-sql/pglite|@databases/pg|@testcontainers/postgresql|@supabase/|@?prisma|kysely|knex|slonik|sequelize|typeorm|@mikro-orm/|@?resend|@?react-email)" -- packages/core packages/shared
   ```
2. `core` imports no workspace package:
   ```sh
   git grep -n "@ledger/" -- packages/core/src
   ```
3. `shared` imports only `core`:
   ```sh
   git grep -nP "@ledger/(?!core['\"])" -- packages/shared/src
   ```
4. Only `packages/aws` imports `@aws-sdk/*`:
   ```sh
   git grep -n "@aws-sdk/" -- ':!packages/aws' ':!*.md' ':!pnpm-lock.yaml'
   ```
5. Only `resend-client` and `ingest` import `resend`:
   ```sh
   git grep -nE "from ['\"]resend['\"]" -- ':!packages/resend-client' ':!packages/ingest'
   ```
6. Ingest uses `resend` for `webhooks.verify` only (ADR-009). Allowed: the import and the `verify`
   call:
   ```sh
   git grep -n "resend" -- packages/ingest/src
   ```
7. Only `packages/db` touches Postgres:
   ```sh
   git grep -nE "from ['\"](pg|drizzle-orm[^'\"]*)['\"]" -- ':!packages/db'
   ```
8. Packages import no Lambda event types (ADR-013):
   ```sh
   git grep -n "aws-lambda" -- packages
   ```
9. No package or app imports an app:
   ```sh
   git grep -n "@ledger/app-" -- packages apps
   ```
10. No relative import reaches another project:
    ```sh
    git grep -nE "from ['\"](\.\./)+(packages|apps|infra|sim)/"
    ```
11. No deep import:
    ```sh
    git grep -nP "from ['\"]@ledger/[a-z-]+/(?!testing['\"])"
    ```
12. `/testing` is imported only by tests and `sim`:
    ```sh
    git grep -nE "@ledger/[a-z-]+/testing['\"]" -- ':!*.test.ts' ':!sim'
    ```
13. The CLI and MCP server reach the system only through the SDK:
    ```sh
    git grep -nE "@ledger/(core|db|aws|api|ingest|worker|reconciler|dispatcher|resend-client)" -- apps/cli apps/mcp
    ```
14. `process.env` is read only in a composition root: a `main.ts`, and each
    `infra/scripts/*.ts` ([pp-infra → scripts](../../pp-infra/references/scripts.md)):
    ```sh
    git grep -n "process\.env" -- packages apps sim infra ':!*main.ts' ':!infra/scripts/*.ts'
    ```
15. No address outside Resend's test domain. Package specifiers such as `@ledger/x` do not match:
    ```sh
    git grep -nP "[A-Za-z0-9._%+-]+@(?!resend\.dev\b)[A-Za-z0-9-]+\.[A-Za-z]{2,}" -- packages apps sim infra
    ```

## Undeclared imports

For every `@ledger/<pkg>` a diff imports, that project's `package.json` lists
`"@ledger/<pkg>": "workspace:*"`: under `dependencies`, or `devDependencies` for an import only a
test or `/testing` makes. Check by reading the `package.json` beside the changed file; lint's
`noUndeclaredDependencies` checks the same thing.
