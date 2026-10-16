---
name: pp-general
description: Ledger's code-level conventions for every TypeScript file — workspace package names, file naming and role suffixes, imports and tsconfig (Node 24 type stripping, no build step), module boundaries and their lint enforcement, adding an abstraction, dependency, package or cache, the one error class and its single mapping per surface, logging and metrics (Winston JSON, the log allow-list, EMF), PII in code, config and env loading, and checking a library's installed version instead of memory. Load it before writing or reviewing any TypeScript in `packages/`, `apps/`, `infra/`, `sim/` or `scripts/` — "where does this file go", "what do I name this", "add a dependency", "add an env var", "how do I log this", "which error do I throw". Load it alongside pp-workflow and the path's own skill, not instead of them. When it and a linked doc disagree, the doc wins and this file is fixed.
---

# pp-general — patterns and practices, every TypeScript file

The conventions every TypeScript file shares, and the gate that checks them. A rule that lives in
[`.ai/`](../../../.ai/AGENTS.md) or root [AGENTS.md](../../../AGENTS.md) is linked, never restated;
this skill is the canonical home only of the code-level conventions no doc owns.

**Owns:** package names · file naming · imports, tsconfig, type stripping · lint enforcement of the
module boundaries · adding things · the error class and its mapping per surface · the logger and
metrics helper · PII in code · config and env loading · version truth · comments.

**Does not own:** process → [pp-workflow](../pp-workflow/SKILL.md) · handlers, ports, outbox,
reconcile, SDK → [pp-backend](../pp-backend/SKILL.md) · schema, migrations →
[pp-database](../pp-database/SKILL.md) · tests, `sim` → [pp-testing](../pp-testing/SKILL.md) · CDK →
[pp-infra](../pp-infra/SKILL.md) · CLI → [pp-cli](../pp-cli/SKILL.md) · MCP →
[pp-mcp](../pp-mcp/SKILL.md) · the boundaries, the error codes and the log fields themselves (the
docs linked below).

## Precedence

1. A doc beats any skill: when they disagree, the doc wins and the skill is fixed in the same change
   ([root AGENTS.md → Patterns and practices](../../../AGENTS.md#patterns-and-practices)).
2. On its own path, the path's skill beats pp-general (pp-database on `packages/db/**`, pp-infra on
   `infra/**`, pp-cli on `apps/cli/**`, pp-mcp on `apps/mcp/**`, pp-testing on tests and `sim/**`,
   pp-backend on the rest of `packages/**` and `apps/**`).
   Where it is silent, pp-general applies.
3. pp-workflow owns process and no code rule; pp-general owns no process.
4. An accepted ADR is applied, not re-litigated ([decision lens](../../../AGENTS.md#decision-lens--evidence-over-claims-right-sized)).

## References

| Reference | Open when |
| --- | --- |
| [coding-standards.md](references/coding-standards.md) | Naming a file, folder or export; writing a comment |
| [imports-and-tsconfig.md](references/imports-and-tsconfig.md) | Creating a package; writing an import; touching a `package.json` or `tsconfig`; running a `.ts` entry point |
| [boundaries.md](references/boundaries.md) | Deciding which package code belongs in; grepping a diff for a boundary breach |
| [adding-things.md](references/adding-things.md) | Adding an abstraction, interface, dependency, package, cache or deferral |
| [errors.md](references/errors.md) | Throwing, catching or mapping an error; writing a `message` or `hint` |
| [logging-and-pii.md](references/logging-and-pii.md) | Writing a log line or metric; handling an address, subject or payload |
| [config-and-env.md](references/config-and-env.md) | Reading config; adding an environment variable; loading `.env.local` |
| [versions.md](references/versions.md) | Writing against a library's API; pinning a package |

## Check the installed version, not memory

**MUST.** The lockfile is the version truth. Before writing against a library's API, read its
installed version (`pnpm -r list <pkg>`) and the docs or `.d.ts` for that version; never code from
memory. Several surfaces moved recently (`@hono/aws-lambda` left `hono`; the MCP SDK split into v2
packages). The installed source beats memory. A package not yet installed is Ask-first, pinned in
the slice that first needs it ([ADR-019](../../../.ai/architecture.md#adr-019--application-and-surface-stack)).
The surfaces and the docs to read first: [versions.md](references/versions.md).

## Always

- Packages are `@ledger/<folder>` (`apps/*`: `@ledger/app-<folder>`), `"private": true`, and ship
  TypeScript source: `exports` `{ ".": "./src/index.ts" }`, the one public surface and only barrel
  ([imports-and-tsconfig.md](references/imports-and-tsconfig.md#package-names)).
- Every project extends `tsconfig.base.json`; only erasable TypeScript, so Node 24 runs it as is
  ([imports-and-tsconfig.md](references/imports-and-tsconfig.md#node-24-runs-ts-directly)).
- Inside a package, relative imports with `.ts`; across packages, the declared package name only;
  `core` ← `shared` ← the rest ([imports-and-tsconfig.md](references/imports-and-tsconfig.md#imports)).
- Kebab-case files, one role suffix, one primary export mirroring the name, tests beside the code
  ([coding-standards.md](references/coding-standards.md)).
- The [module boundaries](../../../AGENTS.md#module-boundaries) hold: Biome enforces, greps check
  ([boundaries.md](references/boundaries.md)).
- Throw the shared error class with a registered `code`; each surface maps once, at its edge
  ([errors.md](references/errors.md)).
- Log through the one logger, allow-listed fields and constant messages; metrics through the EMF
  helper, fixed set ([logging-and-pii.md](references/logging-and-pii.md)).
- Each composition root parses `process.env` once with Zod; packages get typed config
  ([config-and-env.md](references/config-and-env.md)).
- Step 0 before adding anything: is it already decided? ([adding-things.md](references/adding-things.md))
- Comment the why, citing the ADR, `RS-NN` or `AWS-NN` by id; identifiers from the
  [domain vocabulary](../../../.ai/about.md#domain-vocabulary).

## Case-by-case

The deciding test, not the trade-off. Each is countable from the diff or a named doc.

| Do this | Deciding test |
| --- | --- |
| Extract an abstraction | The third duplicate exists, **or** it is a named ADR seam: a port in `packages/shared` ([ADR-013](../../../.ai/architecture.md#adr-013--pure-core-and-local-mode)) or `resend-client` ([ADR-012](../../../.ai/architecture.md#adr-012--resend-client-is-the-sole-resend-api-caller)). In `infra`, the shared function construct comes at the second function ([adding-things.md](references/adding-things.md#extract-an-abstraction), O-15) |
| Declare an interface | It is a named port. A test double is not a second implementation |
| Add an error subclass | A caller in the same diff branches on it |
| Add a workspace package | The [Projects](../../../AGENTS.md#projects) table lands it in this slice, **or** a second project imports it in this diff |
| Add a `"./testing"` export | A test or `sim` outside the package imports from it in this diff |
| Add a dependency | Not a one-liner, not a second way to do an installed thing, **and** owner-approved ([Permissions](../../../AGENTS.md#permissions)) |
| Add a cache | The same change names its invalidation trigger |
| Add a log field or metric | It is in [Log fields](../../../.ai/data-modeling.md#log-fields) or the [Technology](../../../.ai/architecture.md#technology) set; otherwise that doc changes first |
| Defer something | It names a countable threshold or a named event ([lens clause 2](../../../AGENTS.md#decision-lens--evidence-over-claims-right-sized)) |

## Never

- **A relative import leaving its package, or a deep import (`@ledger/db/src/…`)** → the package
  name ([imports](references/imports-and-tsconfig.md#imports)).
- **An undeclared workspace import** → `"workspace:*"` in that package's `dependencies`
  ([imports](references/imports-and-tsconfig.md#imports)).
- **`@aws-sdk/*` outside `packages/aws`** → a `packages/shared` port, implemented in `packages/aws`
  ([ADR-013](../../../.ai/architecture.md#adr-013--pure-core-and-local-mode)).
- **A Resend API call outside `packages/resend-client`** → call `resend-client`; ingest uses only
  `webhooks.verify` ([ADR-012](../../../.ai/architecture.md#adr-012--resend-client-is-the-sole-resend-api-caller)).
- **`process.env` read outside a composition root** → typed config passed in
  ([config-and-env.md](references/config-and-env.md)).
- **A `Result` or Either type** → throw the error class with a registered `code` ([errors.md](references/errors.md)).
  One named exception: the public SDK returns `{ data, error }` like Resend's SDK (owner, O-10;
  [pp-backend → Surfaces](../pp-backend/SKILL.md#surfaces--sdk-cli-mcp)).
- **A second error envelope** → the [one shape](../../../AGENTS.md#error-shape), mapped at the edge
  ([errors.md](references/errors.md#one-mapping-per-surface)).
- **An error code invented in code** → register it in [Error codes](../../../.ai/api-contract.md#error-codes)
  first (Ask-first).
- **A log field outside the allow-list** → [Log fields](../../../.ai/data-modeling.md#log-fields)
  only; change that doc first.
- **An interpolated log message** → a constant message plus fields ([logger](references/logging-and-pii.md#logger)).
- **An address in a URL, log line, metric dimension, error `message`, exception text or MCP output**
  → hash to look up, mask to display, request body to carry ([PII in code](references/logging-and-pii.md#pii-in-code)).
- **A real recipient address in a fixture or doc** → `delivered@resend.dev`
  ([integrations.md → Locked rules](../../../.ai/integrations.md#locked-rules-must)).
- **An `enum`, runtime `namespace`, parameter property, decorator, `import x =` or tsconfig `paths`**
  → an `as const` union or core Zod enum, a module, an assigned field, a function, the package name
  ([type stripping](references/imports-and-tsconfig.md#node-24-runs-ts-directly)).
- **`tsx`, `ts-node` or `dotenv`** → `node file.ts` with `--env-file-if-exists=.env.local`
  ([config-and-env.md](references/config-and-env.md#local-env-file)).
- **A dependency for a one-liner** → write the line ([adding-things.md](references/adding-things.md#add-a-dependency)).
- **An abstraction before its third duplicate or ADR seam** → the concrete code
  ([adding-things.md](references/adding-things.md#extract-an-abstraction)).
- **A version-specific API written from memory** → the installed version and its docs
  ([above](#check-the-installed-version-not-memory)).
- **`.ai/` prose pasted into a comment** → the id ([comments](references/coding-standards.md#comments)).

## Gate — then read the diff

**Gate.** Until slice 0 lands `pnpm verify`: run the cheap checks for what you touched (lint and the
affected tests) and report their actual result. After it: `pnpm verify` exits 0 with every stage run
([pp-workflow → Definition of done](../pp-workflow/SKILL.md#definition-of-done)).

**Then read the diff** (greps in [boundaries.md](references/boundaries.md#review-greps)): new files
kebab-case with a [listed suffix](references/coding-standards.md#role-suffixes) · no deep
`@ledger/<pkg>/…` import but `/testing`, no relative import leaving its package · every `@ledger/*`
import declared `workspace:*` · `@aws-sdk/` only in `packages/aws` · `from 'resend'` only in
`resend-client` and `ingest` · `process.env` only in a composition root (a `main.ts` or an
`infra/scripts/*.ts`, grep 14) · no `enum `, runtime `namespace`,
`constructor(private|public|readonly`, decorator or `"paths"` · no `Result<` or `Either<`; no
`throw new Error(` in `packages/` or `apps/` · every thrown `code` in [Error codes](../../../.ai/api-contract.md#error-codes) ·
no log message built by template literal or `+` · every log key in
[Log fields](../../../.ai/data-modeling.md#log-fields) · no address outside `@resend.dev` · each new
dependency, public variable and error code approved ([Permissions](../../../AGENTS.md#permissions)) ·
each new variable in its root's Zod schema · comments cite ids, not prose.
