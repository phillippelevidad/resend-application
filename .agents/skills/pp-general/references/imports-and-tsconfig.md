# Imports, packages and tsconfig

Imports are the cheapest boundary check in the repo: a wrong one is visible in the diff, and a grep
answers "did anything cross this line?" in a second. pnpm's declared dependencies enforce the
package boundaries for free ([ADR-013](../../../../.ai/architecture.md#adr-013--pure-core-and-local-mode)),
so keep every rule here mechanical.

## Package names

| Project | Name |
| --- | --- |
| `packages/<folder>` | `@ledger/<folder>`: `@ledger/core`, `@ledger/shared`, `@ledger/db`, … |
| `apps/<folder>` | `@ledger/app-<folder>`: `@ledger/app-local`, `@ledger/app-cli`, … |
| `infra` | `@ledger/infra` |
| `sim` | `@ledger/sim` |

Every workspace package is `"private": true` until build-checklist slice 8 picks the published
name. The final name is deferred, so a rename MUST stay one find-and-replace: never spell a package
name any other way (no alias, no re-export under a second name).

## Packages ship TypeScript source

No package has a build step. Every runtime already transforms TypeScript: esbuild (CDK
`NodejsFunction`, the CLI and MCP bins), Vitest, and Node 24's type stripping. A build per package
is cost with no consumer.

```json
{
  "name": "@ledger/core",
  "private": true,
  "type": "module",
  "exports": { ".": "./src/index.ts" }
}
```

- `src/index.ts` is the package's **one public surface and the only barrel**. Anything not exported
  there is internal.
- A second subpath exists only for test helpers: `"./testing": "./src/testing.ts"`, imported by
  `*.test.ts` files and `sim` only. Production code never imports `/testing`.
- `apps/*` export nothing; their entry is `main.ts` or a `.handler.ts`.

## Node 24 runs `.ts` directly

Local entry points (`apps/local`, `sim`, `scripts`) run as `node path/to/main.ts`, with no `tsx` or
`ts-node`. Type stripping is enabled by default since Node v23.6, warning-free since v24.3 and
Stable since v24.12 ([Node docs](https://nodejs.org/docs/latest-v24.x/api/typescript.html)).
Node strips types; it does not transform syntax. So:

- Relative imports carry the `.ts` extension: `import { mask } from './mask.ts'`. "File extensions
  are mandatory in `import` statements" (Node docs).
- **No `enum`, no `namespace` with runtime code, no parameter properties, no `import x =` alias.**
  Node lists them as needing transformation. Use an `as const` union or the core Zod enum, a module,
  a field assigned in the constructor body, an ES import.
- **No decorators:** "they are not transformed and will result in a parser error" (Node docs).
- **No tsconfig `paths`:** "`paths` won't be transformed and therefore produce an error" (Node docs).
  Across packages use the package name; inside one, a relative path.

**[Unverified] — the `node_modules` tripwire.** Node "refuses to handle TypeScript files inside
folders under a `node_modules` path" (Node docs), and pnpm links workspace packages there. Node
resolves symlinks to their real path by default, so it should work. Slice 0 proves it with a smoke
run of an entry point importing `@ledger/core`. If that fails, the fallback is `tsx`, Ask-first.

## tsconfig

One root `tsconfig.base.json`; every project's `tsconfig.json` extends it and adds only `include`.

```json
{
  "compilerOptions": {
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "noImplicitOverride": true,
    "module": "nodenext",
    "moduleResolution": "nodenext",
    "target": "esnext",
    "verbatimModuleSyntax": true,
    "erasableSyntaxOnly": true,
    "allowImportingTsExtensions": true,
    "noEmit": true,
    "isolatedModules": true
  }
}
```

- `erasableSyntaxOnly` makes `tsc` reject what Node cannot strip (enums, parameter properties,
  runtime namespaces), so the type-check catches it before a run does. Node's docs recommend
  TypeScript 5.8 or newer for it.
- `allowImportingTsExtensions` lets `tsc` type-check `.ts` specifiers; it needs `noEmit`. No
  project emits.
- `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes` catch the index and optional-field
  bugs that a projection over arbitrary event sets would otherwise hide.
- No `paths`, no `baseUrl` aliases.
- Type-check is `tsc --noEmit -p <project>` per project, or one `tsc -b` over project references.
  Slice 0 picks by measured time. [Unverified]: whether `tsc -b` accepts `noEmit` on the installed
  TypeScript; read its docs before choosing (see [the version rule](../SKILL.md#check-the-installed-version-not-memory)).

## Imports

| Distance | Form | Example |
| --- | --- | --- |
| Inside a package | Relative, with `.ts`, never leaving the package's `src/` | `import { mask } from '../pii/mask.ts'` |
| Another workspace package | The package name only | `import { projectEmail } from '@ledger/core'` |
| A Node built-in | The `node:` prefix | `import { createHmac } from 'node:crypto'` |
| A type only | `import type` (required by `verbatimModuleSyntax`) | `import type { WebhookEvent } from '@ledger/core'` |

- **Never a deep import** (`@ledger/db/src/…`) and never a relative path that leaves the package.
  Both bypass the public surface.
- **Every cross-package import is declared** in that package's `package.json` `dependencies` as
  `"@ledger/<pkg>": "workspace:*"`. An undeclared one is a boundary breach, even when pnpm's
  hoisting happens to resolve it.
- **No import cycles** between packages.
- **Dependency direction:** `@ledger/core` imports no workspace package. `@ledger/shared` may import
  `@ledger/core` (the error-code enum lives in core,
  [api-contract.md → Error codes](../../../../.ai/api-contract.md#error-codes)). Everything else may
  import `core` and `shared`, within the [module boundaries](boundaries.md). That one-way order is
  what keeps core pure.

## Lint enforcement (Biome)

A ban without enforcement drifts. Slice 0 configures these and proves them with build-checklist
slice 0's deliberate-violation fixture. The rule names below are from Biome's docs; check them
against the installed version before configuring
([version rule](../SKILL.md#check-the-installed-version-not-memory)).

| Ban | Biome rule |
| --- | --- |
| `@aws-sdk/*`, `pg`, `drizzle-orm`, `resend` in `packages/core` and `packages/shared` | [`style/noRestrictedImports`](https://biomejs.dev/linter/rules/no-restricted-imports/), `patterns` (since v2.2.0) |
| `@aws-sdk/*` anywhere but `packages/aws` | same rule |
| `resend` anywhere but `packages/resend-client` and `packages/ingest` (ingest: `webhooks.verify` only, ADR-009) | same rule |
| A deep import `@ledger/*/…` other than `/testing`; a relative path leaving the package | same rule, `patterns` |
| An undeclared package import | [`correctness/noUndeclaredDependencies`](https://biomejs.dev/linter/rules/no-undeclared-dependencies/): checks the closest `package.json` only, which is the per-package check wanted |
| An import cycle | [`suspicious/noImportCycles`](https://biomejs.dev/linter/rules/no-import-cycles/) (since v2.0.0) |
| A relative import without its extension | [`correctness/useImportExtensions`](https://biomejs.dev/linter/rules/use-import-extensions/) (suggests `.ts` for a TS file) |

None of these is in Biome's recommended set, so each is enabled explicitly. [Unverified]: scoping
a restriction to one folder through Biome `overrides`, and a `patterns` glob that matches "a
relative path leaving the package"; slice 0 settles both against the installed Biome. Where Biome
cannot express a ban, the [review greps](boundaries.md#review-greps) carry it.

## Engines

Root `package.json` pins `engines.node` to `>=24.12 <25` (owner, O-05): type stripping is Stable
only from v24.12, and `--env-file-if-exists` non-experimental only from v24.10
([config-and-env.md](config-and-env.md#local-env-file)).
