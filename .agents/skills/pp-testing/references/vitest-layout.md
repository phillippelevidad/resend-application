# Vitest layout

One Vitest process, two projects, one per stage of `pnpm verify`. Which tier a claim needs is
[pp-workflow → Test tiers](../../pp-workflow/SKILL.md#test-tiers); the file names are
[pp-general → Role suffixes](../../pp-general/references/coding-standards.md#role-suffixes). This file
owns the config, the names inside a file, the shared suites and the review greps.

## Root config

`vitest.config.ts` at the repo root (a tool-named file, exempt from the suffix rule). Vitest's
`test.projects` runs several project configs "within a single Vitest process"; `vitest.workspace` is
"deprecated since 3.2 and replaced with the `projects` configuration"
([Vitest → Projects](https://vitest.dev/guide/projects)). A project's own `globalSetup` is honored;
the root's is not inherited by projects (same page). Written against vitest.dev as read on
2026-10-16: check the installed version's docs before writing it
([version rule](../../pp-general/SKILL.md#check-the-installed-version-not-memory)).

```ts
// vitest.config.ts — shape, not a final file; slice 0 writes it, slice 1 adds `int`
import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          include: ['{packages,apps,sim,infra}/**/*.test.ts'],
          exclude: [...configDefaults.exclude, '**/*.int.test.ts'],
        },
      },
      {
        test: {
          name: 'int',
          include: ['{packages,apps,sim}/**/*.int.test.ts'],
          globalSetup: ['packages/db/src/testing/postgres-global-setup.ts'],
        },
      },
    ],
  },
});
```

- **`unit`** holds `*.test.ts` and `*.prop.test.ts` (both match `*.test.ts`) and never needs Docker,
  so it runs first and fails fast. **`int`** is `*.int.test.ts` only, behind the
  [harness](postgres-harness.md).
- Run one tier: `pnpm exec vitest run --project unit` or `--project int` (`--project` "can be used
  multiple times", Vitest → Projects). `pnpm verify` runs each as its own stage; the stage names and
  the root `package.json` scripts are slice 0's, each listed in
  [root AGENTS.md → Commands](../../../../AGENTS.md#commands) when it lands.
- `int` files run in parallel: each has its own database. Timeouts for `int` are set from a measured
  run in slice 1, never guessed.
- A per-package `vitest.config.ts` appears only when a package needs a setting the root cannot give
  it, and the same change says why.
- Coverage is never a gate ([Test tiers](../../pp-workflow/SKILL.md#test-tiers)).

## Test names

- `describe` names the subject (`'projectEmail'`, `'POST /webhooks/resend'`); `it` names the
  behavior and its consequence:
  `it('a duplicate delivery leaves one webhook_events row and no second outbox row')`, never
  `it('works')` or `it('handles duplicates')`.
- A regression test names the bug it locks down
  ([Test tiers](../../pp-workflow/SKILL.md#test-tiers)):
  `it('regression: a bounce naming one recipient left the other recipient bounced')`.
- One behavior per `it`. A test asserting five unrelated things fails with one unhelpful name.
- No `.only` and no `.skip` in a commit. A `todo` is a tracked gap only when a Ships bullet or an
  [Open questions](../../../../.ai/about.md#open-questions) entry names it.

## Shared contract suites

When one port has two implementations, the behavior they share is one suite, run once per
implementation. The docs already require it: "the same contract tests run against both modes"
(slice 2B), and the same app object passes the same contract tests under `@hono/node-server` and
through the Lambda adapter ([ADR-019](../../../../.ai/architecture.md#adr-019--application-and-surface-stack)).

```ts
// packages/shared/src/testing/queue-port-contract.ts — exported through @ledger/shared/testing
export function queuePortContract(name: string, make: () => Promise<QueuePortUnderTest>): void {
  describe(`QueuePort contract: ${name}`, () => {
    it('an enqueued envelope is received once with its svix_id intact', async () => { /* … */ });
  });
}
```

- The suite lives in the `testing.ts` surface of the package that declares the port or the
  contract, and is written when the **second** implementation lands, not before
  ([Case-by-case](../SKILL.md#case-by-case)).
- Each implementation's own test file calls it, plus that implementation's specifics.
- Where the SDK ↔ API contract tests live is the slice 1 pre-proposal's. Constraint:
  `packages/sdk` never depends on server code ([ADR-011](../../../../.ai/architecture.md#adr-011--one-contract-many-surfaces)),
  so they do not live in `packages/sdk`. They read real rows, so they are `*.int.test.ts`.

## Review greps

Run from the repo root. Expected: no output, unless the entry names what is allowed.

1. A test file with another naming scheme:
   ```sh
   git ls-files | grep -E '\.(spec|integration)\.[jt]sx?$|/__tests__/|(^|/)test/'
   ```
2. A module mock:
   ```sh
   git grep -n "vi\.mock(" -- '*.test.ts'
   ```
3. Cleanup between tests:
   ```sh
   git grep -niE "\btruncate\b" -- '*.test.ts' 'packages/db/src/testing'
   ```
4. A focused or skipped test:
   ```sh
   git grep -nE "\b(it|test|describe)\.(only|skip)\(" -- '*.test.ts'
   ```
5. Testcontainers outside the harness. Allowed: `packages/db/src/testing/` and `packages/db/package.json`:
   ```sh
   git grep -n "testcontainers" -- ':!packages/db/src/testing' ':!packages/db/package.json' ':!pnpm-lock.yaml' ':!*.md'
   ```
6. Unseeded randomness or wall-clock time in generated data:
   ```sh
   git grep -nE "Math\.random|Date\.now\(|randomUUID\(" -- sim packages/core/src/testing
   ```
   Allowed: the `svix-timestamp` the signer reads from the wall clock ([simulator.md](simulator.md#signing)).
7. A call assertion, each read by hand for a consequence beside it or an outbound vendor seam:
   ```sh
   git grep -nE "toHaveBeenCalled(With|Times)?\(" -- '*.test.ts'
   ```
8. A real address: pp-general's [address grep](../../pp-general/references/boundaries.md#review-greps) (15).
