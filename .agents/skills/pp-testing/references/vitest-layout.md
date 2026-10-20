# Vitest layout

One Vitest process, three projects, each its own stage of `pnpm verify` (`int` from slice 1). Which tier a claim needs is
[pp-workflow → Test tiers](../../pp-workflow/SKILL.md#test-tiers); the file names are
[pp-general → Role suffixes](../../pp-general/references/coding-standards.md#role-suffixes). This file
owns the config, the names inside a file, the shared suites and the review greps.

## Root config

`vitest.config.ts` at the repo root (a tool-named file, exempt from the suffix rule). Vitest's
`test.projects` runs several project configs "within a single Vitest process"; `vitest.workspace` is
"deprecated since 3.2 and replaced with the `projects` configuration"
([Vitest → Projects](https://vitest.dev/guide/projects)). The root's `globalSetup` is not inherited
by projects (same page); a project's own `globalSetup` runs: under Vitest 5.0.5, `pnpm test:int`
(`--project int`) runs the inline `int` project's setup once, before its files, and its
`project.provide` values reach `inject` in the tests (slice 1), so `int` needs no config file of its
own. Written against vitest.dev as read on 2026-10-16: check the installed version's docs before
writing it ([version rule](../../pp-general/SKILL.md#check-the-installed-version-not-memory)).

```ts
// vitest.config.ts, abridged: the int project's measured timeouts and comments are in the file
import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          include: ['{packages,apps,sim,infra}/**/*.test.ts'],
          exclude: [...configDefaults.exclude, '**/*.int.test.ts', '**/*.e2e.test.ts'],
        },
      },
      {
        test: {
          name: 'int',
          include: ['{packages,apps,sim}/**/*.int.test.ts'],
          globalSetup: ['packages/db/src/testing/postgres-global-setup.ts'],
          testTimeout: 5_000,
          hookTimeout: 10_000,
        },
      },
      {
        test: {
          name: 'e2e',
          include: ['{apps,sim}/**/*.e2e.test.ts'],
        },
      },
    ],
  },
});
```

- **`unit`** holds `*.test.ts` and `*.prop.test.ts` (both match `*.test.ts`) and never needs Docker,
  so it runs first and fails fast. **`int`** is `*.int.test.ts` only, behind the
  [harness](postgres-harness.md): its `globalSetup`
  (`packages/db/src/testing/postgres-global-setup.ts`) and the `int` stage of `pnpm verify` landed
  with the first `*.int.test.ts` in slice 1. **`e2e`** is `*.e2e.test.ts` only:
  it spawns a real local process from its entry point (`node apps/local/src/main.ts`), talks to it
  over `127.0.0.1` and asserts what the process prints, answers and exits with. No Docker. First
  file: `apps/local/src/main.e2e.test.ts`.
- Run one tier: `pnpm test` (`unit`), `pnpm test:int`, `pnpm test:e2e`, or
  `pnpm exec vitest run --project <name>` (`--project` "can be used multiple times", Vitest →
  Projects). `pnpm verify` runs `unit`, `int` and `e2e` as their own stages; the
  scripts are listed in
  [root AGENTS.md → Commands](../../../../AGENTS.md#commands).
- **Every project declares `vitest` as `catalog:`** in its own `devDependencies`, with the version
  once in `pnpm-workspace.yaml` → `catalog`, because Biome's `noUndeclaredDependencies` checks the
  closest `package.json`.
- `int` files run in parallel: each has its own database. Timeouts for `int` are set from a measured
  run, never guessed: the slice 1 numbers are in the `vitest.config.ts` comment beside them.
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
    it('an enqueued envelope is received at least once, its svix_id and raw body byte-identical', async () => { /* … */ });
  });
}
```

- The suite lives in the `testing.ts` surface of the package that declares the port or the
  contract, and is written when the **second** implementation lands, not before
  ([Case-by-case](../SKILL.md#case-by-case)).
- **Slice 2's five**, in `packages/shared/src/testing/<port>-port-contract.ts`, exported through
  `@ledger/shared/testing` (D1). Each takes a name and a `make` that builds a fresh implementation
  per case, plus the controls the shared cases need:

  | Suite | `make` | Shared cases |
  | --- | --- | --- |
  | `queuePortContract` | `() => { port, failSends, accepted }` | `enqueue` resolves on acceptance, the raw body byte-identical; after `failSends()` it rejects and nothing is accepted (R4) |
  | `secretReaderPortContract` | `({ secretId, value }) => port` | `read` answers the value for its id; rejects any other id |
  | `eventSourceControlPortContract` | `() => port` | `getState` answers a member of `eventSourceStates`; `enable` and `disable` resolve |
  | `queueAttributesPortContract` | `() => { port, holdWaiting(count, oldestAgeSeconds) }` | Empty reads all zeros and `oldestAgeSeconds: null`; waiting messages read `visible` with their age |
  | `functionInvokePortContract` | `(fn) => port` | `invoke` resolves with `fn`'s result for the payload; rejects when `fn` fails |

  **Slice 3's sixth** (D3), in the same place:

  | Suite | `make` | Shared cases |
  | --- | --- | --- |
  | `dlqPortContract` | `() => { port, deadLetter(body) }` | Sampling never removes a message (a second sample returns the same bodies and depth); `depth` counts every dead-lettered message whatever `limit` returns; an empty redrive answers `empty` with depth `0`; a redrive answers `started` with the depth and empties the dead store |

  **Slice 4's seventh** (D7), in the same place, run by `InProcessAsyncFunctionInvokeAdapter` and by
  `LambdaAsyncFunctionInvokeAdapter` over the `StubClient`:

  | Suite | `make` | Shared cases |
  | --- | --- | --- |
  | `asyncFunctionInvokePortContract` | `(fn) => port` | The payload reaches `fn` unchanged; `invokeAsync` resolves before `fn` finishes; a `fn` that rejects never rejects the invoke |

  `deadLetter(body)` seeds the dead store the implementation's own way: the in-process queue fails
  the message through every receive, the SQS adapter's stubbed DLQ holds it. Its two
  implementations are `InProcessQueueAdapter` (`in-process-queue.adapter.test.ts`, which adds that a
  redriven message is delivered again from receive count 1 and `read()` reports `dlqVisible` `0`)
  and `SqsDlqAdapter` over its stubbed client ([DLQ redrive](fakes-and-doubles.md#dlq-redrive)).

  The local side runs each in its own test in `packages/shared` (the in-process queue runs three);
  the `packages/aws` side, over its stubbed client ([AWS adapters](fakes-and-doubles.md#aws-adapters)).
- Each implementation's own test file calls it, plus that implementation's specifics.
- The queue suite asserts at-least-once delivery, never exactly-once (AWS-06): exactly-once effects
  are the worker's job, on `svix_id` ([ADR-004](../../../../.ai/architecture.md#adr-004--immutable-ledger-keyed-on-svix_id-one-transaction-per-message)).
  The SQS adapter only enqueues (the ESM receives), so it runs the enqueue cases only; the
  receive-and-settle cases run against the in-process and Postgres-backed queues
  ([pp-backend → Ports](../../pp-backend/references/composition.md#ports)).
- The SDK ↔ API contract suite is `readApiContract(name, make)` in
  [`packages/api/src/testing/read-api-contract.ts`](../../../../packages/api/src/testing/read-api-contract.ts),
  exported through `@ledger/api/testing` (D23): `packages/api` declares the contract, and takes
  `@ledger/sdk` and `@ledger/worker` as `workspace:*` dev dependencies for it. `packages/sdk` never
  depends on server code ([ADR-011](../../../../.ai/architecture.md#adr-011--one-contract-many-surfaces)),
  so the suite does not live there. `make(deps)` serves `createApi(deps)` and answers a `baseUrl`;
  two files run it: `apps/local/src/sdk-contract.int.test.ts` under `@hono/node-server` on
  `127.0.0.1:0`, and `apps/api/src/api-lambda-contract.int.test.ts` through the `@hono/aws-lambda`
  handler, a loopback `node:http` bridge turning each request into a synthetic payload-2.0 event
  (ADR-019). They read real rows, so they are `*.int.test.ts`: a harness clone, rows seeded through
  the worker's `RecordEventCommand`, a real token from `issueTestToken`, every call through
  `createLedgerClient` (both operations' success paths, `unauthorized`, `email_not_found`,
  `recipient_not_found`, `validation_failed`, `route_not_found`; the slice 2 operations join with
  their SDK methods).

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
   Allowed: the `svix-timestamp` the signer reads from the wall clock ([simulator.md](simulator.md#signing)),
   and `sim/src/main.ts` picking a seed or a run namespace when none is given ([seed](simulator.md#seed-and-determinism)).
7. A call assertion, each read by hand for a consequence beside it or an outbound vendor seam:
   ```sh
   git grep -nE "toHaveBeenCalled(With|Times)?\(" -- '*.test.ts'
   ```
8. A real address: pp-general's [address grep](../../pp-general/references/boundaries.md#review-greps) (15).
