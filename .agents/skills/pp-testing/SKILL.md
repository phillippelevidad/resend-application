---
name: pp-testing
description: Ledger's test and simulator mechanics — test files and the Vitest project per tier, the Testcontainers Postgres harness (one container per run, a migrated template, a fresh database per test file, tests as the runtime role), fakes at the port only (in-process queue, fake clock, fake Resend client, a local fake Resend API, AWS adapters against the port contract), fast-check arbitraries shared with `sim`, regressions locked from a failing seed, and the simulator's Svix signing, seed and one checker per invariant. Which tier a claim needs is pp-workflow's; this skill says how the test is built. Load it before writing or reviewing any `*.test.ts`, `*.prop.test.ts` or `*.int.test.ts`, the root `vitest.config.ts`, a package's `testing.ts`, or anything under `sim/` — "how do I test this", "where does this test go", "which fake do I use", "write the integration test", "add a property", "a property failed", "add a simulator invariant", "sign a webhook in a test". Load it alongside pp-workflow and pp-general, not instead of them. When it and a linked doc disagree, the doc wins and this file is fixed.
---

# pp-testing — patterns and practices, tests and the simulator

Tests are this project's evidence: every reliability claim points at a test, a property or an
invariant ([decision lens](../../../AGENTS.md#decision-lens--evidence-over-claims-right-sized)).
**Which tier a claim needs is [pp-workflow → Test tiers](../pp-workflow/SKILL.md#test-tiers)**,
linked, never restated. This skill carries how each test is built and the gate that checks it.

**Owns:** test file layout · the Vitest projects · the Postgres harness · fakes and test doubles ·
port contract suites · fast-check arbitraries and regression locking · the simulator's signing,
seed, ground truth and invariant checkers.

**Does not own:** which tier a claim needs → [pp-workflow](../pp-workflow/SKILL.md#test-tiers) ·
the role and tier suffixes → [pp-general](../pp-general/references/coding-standards.md#role-suffixes) ·
schema, grants, migrations → [pp-database](../pp-database/SKILL.md) · port shapes →
[pp-backend](../pp-backend/SKILL.md) · CDK assertion tests' content → [pp-infra](../pp-infra/SKILL.md) ·
CLI `--json` tests → [pp-cli](../pp-cli/SKILL.md) · MCP registration and redaction tests →
[pp-mcp](../pp-mcp/SKILL.md) · the invariants themselves →
[architecture.md → Simulator invariants](../../../.ai/architecture.md#simulator-invariants).

## Precedence

[pp-general → Precedence](../pp-general/SKILL.md#precedence). On test files and `sim/**` this skill
beats pp-general; where it is silent, pp-general applies.

| Reference | Open when |
| --- | --- |
| [vitest-layout.md](references/vitest-layout.md) | Writing `vitest.config.ts`, naming a test, running one tier, sharing a suite across implementations |
| [postgres-harness.md](references/postgres-harness.md) | Writing an `*.int.test.ts`; the global setup; a concurrency, crash or outage test |
| [fakes-and-doubles.md](references/fakes-and-doubles.md) | Choosing a fake; testing `resend-client`, a `packages/aws` adapter or DLQ redrive |
| [properties-and-arbitraries.md](references/properties-and-arbitraries.md) | Writing an arbitrary or a property; a property failed |
| [simulator.md](references/simulator.md) | Anything under `sim/`; signing a webhook; adding an invariant checker |

## Test files and tiers

| File | Tier | Vitest project | Needs |
| --- | --- | --- | --- |
| `<subject>.test.ts` | unit | `unit` | Nothing: no Docker; network only to a fake on `127.0.0.1` |
| `<subject>.prop.test.ts` | property (fast-check) | `unit` | Nothing |
| `<subject>.int.test.ts` | integration, real Postgres | `int` | Docker and the [harness](#postgres-harness) |
| `infra/**/*.test.ts` | CDK assertion | `unit` | Content owned by [pp-infra](../pp-infra/SKILL.md#cost-brake-in-code) |

- **Beside the code**, named for the file it tests plus the tier suffix
  (`project-email.projection.prop.test.ts`); never a `__tests__/` or `test/` folder
  ([pp-general → Role suffixes](../pp-general/references/coding-standards.md#role-suffixes)).
- **One root `vitest.config.ts`, two projects:** `unit` (unit and property together) and `int`, so
  `pnpm verify` runs them as separate stages and `unit` never needs Docker. The stage names are
  slice 0's ([vitest-layout.md](references/vitest-layout.md#root-config)).
- **Name the test after the behavior and its consequence:** the name is what a red CI run shows
  first ([naming](references/vitest-layout.md#test-names)).
- **A Ships bullet's named test is written as the bullet names it** — "a duplicate insert and a
  crash between steps" is two tests ([build-checklist](../../../.ai/build-checklist.md#how-to-work-this-checklist)).

## Postgres harness

Real Postgres, because the integration tier exists for what the database enforces
([postgres-harness.md](references/postgres-harness.md)):

- **One container per test run** (the `int` project's global setup), its image pinned to the
  Neon project's Postgres major, 18 ([the image](references/postgres-harness.md#the-image)).
- **Setup follows S-05:** ensure the runtime role, migrate through the deploy command's code path,
  mark that database a template ([Decision — Neon](../../../.ai/integrations.md#decision--neon), ADR-018).
- **Each test file gets a fresh clone** (`CREATE DATABASE … TEMPLATE …`): files run in parallel,
  never see each other's rows, never truncate.
- **Tests connect as the runtime role**, so a missing grant fails a test; the owner connection
  only injects faults and watches locks.

## Fakes at the port

A fake implements a [named port](../pp-general/references/adding-things.md#add-an-interface), the
client `resend-client` exports, or the SDK client in CLI and MCP tests; everything else runs for
real, the in-process queue included (ADR-013). `resend-client` itself runs against a local fake
Resend API, a `packages/aws` adapter against a stubbed SDK client, and
[DLQ redrive](references/fakes-and-doubles.md#dlq-redrive) through SQS. Which double per seam:
[fakes-and-doubles.md](references/fakes-and-doubles.md).

## Properties and the simulator

Arbitraries live in `@ledger/core/testing`, shared with `sim`; a failing seed becomes a named
regression ([properties-and-arbitraries.md](references/properties-and-arbitraries.md)). `sim/`
signs on `node:crypto`, prints its seed first and runs one checker per invariant number
([simulator.md](references/simulator.md)).

## Always

- Pick the tier from [Test tiers](../pp-workflow/SKILL.md#test-tiers) before writing the test.
- Assert the consequence (the row, the effect, the response, the emitted line), not the call
  ([seam exception](references/fakes-and-doubles.md#assert-the-consequence)).
- Running a handler or command twice gives one row and one effect: a test of an idempotent path
  runs it twice and asserts both.
- Generate ids fresh per test, so tests in one file share a database without depending on order.
- Use Resend test addresses only (`delivered@resend.dev`, `bounced@resend.dev`, `+label` forms)
  ([integrations.md → Locked rules](../../../.ai/integrations.md#locked-rules-must)).

## Case-by-case

| Do this | Deciding test |
| --- | --- |
| Write a `*.int.test.ts` | The code under test issues SQL, **or** the claim is a Mandatory integration row in [Test tiers](../pp-workflow/SKILL.md#test-tiers) |
| Write a `*.prop.test.ts` | The claim quantifies over inputs: "any order", "any event set", "every address" |
| Add a fake | It implements a port in `packages/shared` or the `resend-client` client type, **and** a test in this diff uses it |
| Export a helper through `/testing` | A test or `sim` outside the package imports it in this diff ([pp-general](../pp-general/SKILL.md#case-by-case)) |
| Start a second container | The test stops or breaks the database server itself (an outage test) |
| Write a shared port contract suite | A second implementation of that port exists in the repo |
| Add an invariant checker | Its number exists in [Simulator invariants](../../../.ai/architecture.md#simulator-invariants) first |
| Write a regression test | A bug was found: the test names it; a property's seed and path are pasted in |

## Never

- **A mocked database client, or `vi.mock` of `pg`, `drizzle-orm` or a repository, standing in for
  the integration tier** → the [harness](#postgres-harness) ([Test tiers](../pp-workflow/SKILL.md#test-tiers)).
- **`TRUNCATE` or cleanup between tests, or rows shared across files** → a fresh clone per file,
  fresh ids per test ([harness](references/postgres-harness.md#per-test-file)).
- **A test asserting or writing through the owner connection, or a test database migrated another way (`drizzle-kit push`,
  hand-run SQL)** → the runtime role; the deploy command's migrate path
  ([lifecycle](references/postgres-harness.md#lifecycle-one-run)).
- **Stopping or breaking the shared container** → the outage test's own container
  ([outage tests](references/postgres-harness.md#outage-tests)).
- **`vi.mock` of a module or global (`resend`, `@aws-sdk/*`, `fetch`, `Date`)** → a fake at the
  port, the fake Resend API by `baseUrl`, the clock port ([fakes](references/fakes-and-doubles.md)).
- **An interface or fake added only so a test can run** → test the concrete class with its real
  collaborators ([adding-things.md](../pp-general/references/adding-things.md#add-an-interface)).
- **A test dependency for a few lines (`nock`, `msw`, `aws-sdk-client-mock`, a signing library)** →
  `node:http`, a hand-written stub, `node:crypto` ([add a dependency](../pp-general/references/adding-things.md#add-a-dependency)).
- **`toHaveBeenCalledWith` where a consequence exists, or a test named for the function
  ("projectEmail works")** → assert the row, effect or response; name the behavior and consequence.
- **A failing property silenced (seed removed, `numRuns` lowered, `.skip`)** → lock the seed in a
  regression test, then fix the code ([regressions](references/properties-and-arbitraries.md#locking-a-regression)).
- **`.only` or `.skip` committed** → fix or delete the test; an open question goes to
  [Open questions](../../../.ai/about.md#open-questions).
- **A sleep waiting for time or a lock** → the fake clock; poll the observable condition with a bound.
- **`Math.random`, `Date.now` or `randomUUID` in a generated history** → derive it from the run's
  seed ([determinism](references/simulator.md#seed-and-determinism)).
- **A real address, a `svix_id` captured from a live delivery, or a Resend webhook secret in a
  fixture or sim run** → a `@resend.dev` address, a fresh id, `LEDGER_SIMULATOR_SECRET`
  ([ADR-016](../../../.ai/architecture.md#adr-016--the-simulator-reaches-aws-only-through-an-opt-in-simulator-secret)).
- **One checker covering two invariants, or a sim check reading Postgres outside `packages/db`** →
  one checker per number, through `packages/db` ([simulator.md](references/simulator.md#invariant-checkers)).
- **A coverage threshold as a gate** → the tier policy ([Test tiers](../pp-workflow/SKILL.md#test-tiers)).

## Gate — then read the diff

**Gate.** Until slice 0 lands `pnpm verify`: run the affected project (`pnpm exec vitest run
--project unit`, and `--project int` when the diff touches `packages/db`, an `*.int.test.ts`, or a package or app
that has one) and report
its actual result. After it: `pnpm verify` exits 0 with every stage run
([pp-workflow → Definition of done](../pp-workflow/SKILL.md#definition-of-done)).

**Then read the diff** (greps in [vitest-layout.md](references/vitest-layout.md#review-greps)):
new test files end `.test.ts`, `.prop.test.ts` or `.int.test.ts`, beside their subject · no
`.spec.`, `.integration.`, `__tests__/` or `test/` folder · no `vi.mock(` · no `TRUNCATE` · no
`.only(` or `.skip(` · `testcontainers` imported only by `packages/db`'s harness · no
`Math.random`, `Date.now` or `randomUUID` in generated data (grep 6 names the two allowed
wall-clock reads) · every mandatory-tier surface touched has its
[test](../pp-workflow/SKILL.md#test-tiers) · each `toHaveBeenCalled*` sits at an outbound vendor seam
or beside a consequence assertion · every new invariant checker's number is in
[Simulator invariants](../../../.ai/architecture.md#simulator-invariants) · every property regression
cites its seed and path · every address ends `@resend.dev` · no new test dependency without owner
approval ([Permissions](../../../AGENTS.md#permissions)).
