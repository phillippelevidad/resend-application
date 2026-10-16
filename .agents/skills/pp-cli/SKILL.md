---
name: pp-cli
description: Ledger's `ledger` CLI conventions — `commander` 15 with `@commander-js/extra-typings`, one command per operation in `apps/cli/src/commands/<noun>-<verb>.cli.ts` registered in `main.ts`, the SDK's `{ data, error }` unwrapped once, exit codes `0` / `1` / `2`, `--json` on stdout and `message` + `hint` on stderr, colour only on a TTY through `node:util` `styleText`, `LEDGER_URL` / `LEDGER_TOKEN` with no `--token` flag, waiting on a `202` command with `--no-wait`, and the per-command `--json` output tests against a fake SDK. Load it before writing or reviewing anything under `apps/cli/**` — "add a CLI command", "add a flag", "what does the CLI print", "which exit code", "why is this coloured", "make it wait", "test the CLI". Load it alongside pp-workflow and pp-general, not instead of them. When it and a linked doc disagree, the doc wins and this file is fixed.
---

# pp-cli — patterns and practices, the `ledger` CLI

The CLI presents and orchestrates; the read API decides
([ADR-011](../../../.ai/architecture.md#adr-011--one-contract-many-surfaces)). Its rules live in
[api-contract.md → Conventions](../../../.ai/api-contract.md#conventions) and
[pp-backend → Surfaces](../pp-backend/SKILL.md#surfaces--sdk-cli-mcp); this skill carries the
mechanics and the gate.

**Owns:** command files and their registration · unwrapping the SDK result · the exit-code mapping ·
stdout and stderr discipline, `--json`, colour · waiting on a `202` · the CLI's tests.

**Does not own:** which commands, flags and codes exist → [api-contract.md](../../../.ai/api-contract.md)
· the shared surface rules and the SDK → [pp-backend](../pp-backend/SKILL.md#surfaces--sdk-cli-mcp)
· the error class → [pp-general → errors](../pp-general/references/errors.md) · test tiers →
[pp-testing](../pp-testing/SKILL.md) · human output layouts → the slice 1 pre-proposal, then each
slice for the commands it adds.

## Precedence

[pp-general → Precedence](../pp-general/SKILL.md#precedence): on `apps/cli/**` this skill beats
pp-general; a doc beats both.

| Reference | Open when |
| --- | --- |
| [command-anatomy.md](references/command-anatomy.md) | Writing `main.ts`, a `.cli.ts`, the output writer, the exit mapping or a wait |
| [cli-tests.md](references/cli-tests.md) | Writing or reviewing a command's `--json` output test |

## Stack and layout

- **`commander` 15 with `@commander-js/extra-typings` 15** (owner, O-13;
  [ADR-019](../../../.ai/architecture.md#adr-019--application-and-surface-stack); installed 15.0.0).
  Import `Command` from `@commander-js/extra-typings` (major and minor matching `commander`); types
  build up only through one chain per command ([README](https://github.com/commander-js/extra-typings)).
- **`apps/cli` is `@ledger/app-cli`, `bin` `ledger`.** It imports `@ledger/sdk` and
  `@ledger/shared` (the config loader) and no other workspace package
  ([review grep 13](../pp-general/references/boundaries.md#review-greps)). How the bin starts in the
  workspace and loads `.env.local` is the slice 1 pre-proposal's, under
  [type stripping](../pp-general/references/imports-and-tsconfig.md#node-24-runs-ts-directly) and
  [no `dotenv`](../pp-general/references/config-and-env.md#local-env-file); the npm bundle is
  [slice 8](../../../.ai/build-checklist.md#8--npm-release)'s.
- **One command per operation:** `apps/cli/src/commands/<noun>-<verb>.cli.ts`, the operation id
  kebab-cased (`email.get` → `email-get.cli.ts` → `emailGetCli`; `dlq.listMessages` →
  `dlq-list-messages.cli.ts`). The command, its arguments and flags are copied from the operation's
  **Surfaces** line. `reconcile.getRun` has no command: `ledger reconcile` calls it to wait.
- **`main.ts`** is the composition root: it reads `LEDGER_URL` and `LEDGER_TOKEN` once through the
  shared loader ([config](../pp-general/references/config-and-env.md#parse-once-at-the-composition-root)),
  builds one SDK client, registers every command and maps the exit code.

## Output and exit codes

Exactly [api-contract.md → Conventions](../../../.ai/api-contract.md#conventions) (Errors):

| Outcome | Exit | stdout | stderr |
| --- | --- | --- | --- |
| Success | `0` | The result. `--json`: the SDK's `data`, one JSON document | Nothing |
| A registry error from the SDK (`api_unavailable`, an unknown `code` and a run outcome included) | `1` | `--json`: `{ "error": { code, message, hint, docs } }` | Without `--json`: `message`, then `hint` |
| A usage error: rejected by commander (unknown command or option, missing or excess argument, a value that does not convert to its SDK type) or a missing required variable | `2` | Nothing | Commander's message, or the variable's name |
| `--help` | `0` | Help | Nothing |
| An unexpected throw (a defect) | `1` | `--json`: the `internal_error` object (O-12) | Without `--json`: one constant line |

- **Unwrap once.** `const { data, error } = await ledger.<resource>.<verb>(…)` (the SDK's return
  style, owner, O-10; [pp-backend → sdk.md](../pp-backend/references/sdk.md)). `error` is printed as
  received, wrapped once in `{ "error": … }`; the CLI never re-maps its `code` or rewrites its
  `message` or `hint`. An unknown `code` is a generic failure: exit `1`, printed as is.
- **A usage error never reaches the API** and prints no JSON: the registry has no usage code, and
  a code is never invented ([pp-general → Never](../pp-general/SKILL.md#never)).
- **stdout carries the result only.** Under `--json`: exactly one document, no progress line, no
  colour. Progress and notices go to stderr.
- **Colour** only through `styleText(format, text, { stream })`, `stream` being the one written to.
  It honours `isTTY`, `NO_COLOR`, `NODE_DISABLE_COLORS` and `FORCE_COLOR`
  ([Node docs](https://nodejs.org/docs/latest-v24.x/api/util.html#utilstyletextformat-text-options));
  never `validateStream: false`, never colour under `--json`.
- **Exit through `process.exitCode`, never `process.exit()`:** pipe writes are asynchronous on POSIX
  and an early exit can drop them ([Node → process I/O](https://nodejs.org/docs/latest-v24.x/api/process.html#a-note-on-process-io)).
- **Masks only.** Print what the API returned; an input address is echoed only as the API's mask.
  `ledger token create` prints the plaintext token once, to stdout only.

## Waiting on a `202`

A command waits when its Surfaces line names `--no-wait`: today only `ledger reconcile`
([reconcile.start](../../../.ai/api-contract.md#reconcilestart)), polling `reconcile.getRun` through
one interval constant until the run is finished or abandoned (the API derives
[`run_abandoned`](../../../.ai/api-contract.md#error-codes), a run outcome: exit `1`); the CLI's own
wait bound is only a backstop. Ctrl-C stops the wait, not the run. Rules
and mechanics: [command-anatomy.md → Waiting](references/command-anatomy.md#waiting).

## Always

- Copy each command, argument and flag from its operation's Surfaces line; every command declares
  `--json` in its own chain ([Operation template](../../../.ai/api-contract.md#operation-template)).
- Reach the system through the SDK client only ([ADR-011](../../../.ai/architecture.md#adr-011--one-contract-many-surfaces)).
- Configure the root program (`exitOverride`, `configureOutput`) before any `.command()` call, and
  create every subcommand with `.command()`, which copies those settings ([anatomy](references/command-anatomy.md#the-composition-root)).
- `await program.parseAsync()`: every action is async.
- Write stdout and stderr through the one output writer ([anatomy](references/command-anatomy.md#the-output-writer)).
- Give each `.cli.ts` its `--json` output test ([cli-tests.md](references/cli-tests.md)).
- Walk each command in the slice's `WALKTHROUGH.md`, exact command and output
  ([build-checklist](../../../.ai/build-checklist.md#how-to-work-this-checklist)).

## Case-by-case

| Do this | Deciding test |
| --- | --- |
| Exit `2`, not `1` | Commander or the config loader rejected it, so no SDK call was made |
| Attach an `argParser` | The SDK input type is not a string (`--limit` → integer). Never on an argument that can carry an address: commander quotes a rejected value in its message. Commander 15 also echoes excess arguments; that is the user's own argv on their own stderr, never logged, sent or printed under `--json`, so it is accepted (O-21) |
| Check a value's range or format in the CLI | Never. The API answers `validation_failed` (exit `1`); one home for validation |
| Add a helper module in `apps/cli/src/` | A third command uses it, or it is one of the single homes: the output writer, the exit mapping, the wait |

## Never

- **A `--token` flag, or a token from anywhere but `LEDGER_TOKEN`** → the environment
  ([Conventions](../../../.ai/api-contract.md#conventions)).
- **A command, argument or flag missing from the Surfaces line** (`--limit` on `ledger gaps`,
  `--version`, `--no-wait` on `ledger dlq redrive`) → the api-contract entry first, Ask-first
  ([Permissions](../../../AGENTS.md#permissions)).
- **An import of `@ledger/db`, `@ledger/api` or any server package** → the SDK
  ([review grep 13](../pp-general/references/boundaries.md#review-greps)).
- **A re-mapped, reworded or invented error code** → print the SDK's `error` as received.
- **A second error format** (text on stdout under `--json`, `{ message }` alone) → the [one shape](../../../AGENTS.md#error-shape).
- **Anything but the result on stdout** → stderr; no logger in the CLI: its output is its interface.
- **`process.exit()`** → `process.exitCode`, written only through the injected `setExitCode`
  ([anatomy](references/command-anatomy.md#the-composition-root)).
- **Hand-written ANSI codes, a colour dependency or `validateStream: false`** → `styleText` with
  its stream ([adding a dependency](../pp-general/references/adding-things.md#add-a-dependency)).
- **An echoed input address, or one in a message** → the API's masked echo
  ([PII in code](../pp-general/references/logging-and-pii.md#pii-in-code)).
- **Domain validation in the CLI** (duration, id format, range) → pass it through; the API decides.
- **`addCommand()`, or a root setting applied after subcommands exist** → `.command()` on the
  configured root; `addCommand()` copies no inherited setting.
- **An unbounded wait, a poll interval inline, or the Lambda's time budget computed in the CLI** →
  the one constant, ending on a finished or abandoned run, with a backstop bound.
- **An exception's text, stack or `cause` printed** → the constant defect line
  ([writing a message](../pp-general/references/errors.md#writing-message-and-hint)).
- **A CLI test against a live API or database** → the fake SDK; the SDK ↔ API chain is the
  contract tests' ([cli-tests.md](references/cli-tests.md)).

## Gate — then read the diff

**Gate.** The two tiers of [pp-workflow → Definition of done](../pp-workflow/SKILL.md#definition-of-done):
`pnpm check` before each commit, `pnpm verify` at slice close or in CI.

**Then read the diff** (each yes or no; expected output of each grep: none) · every new command is
one `apps/cli/src/commands/<noun>-<verb>.cli.ts` named for its operation id, and its command,
arguments and flags match the Surfaces line word for word · every `.cli.ts` declares `--json`:
`git grep -L -E "['\"]--json['\"]" -- 'apps/cli/src/commands/*.cli.ts'` · every `.cli.ts` has a sibling
`.cli.test.ts` with a success, an error and a usage case · no token flag:
`git grep -n -e "--token" -- apps/cli` · SDK only: review grep 13 · no early exit:
`git grep -n "process\.exit(" -- apps/cli` · no raw colour:
`git grep -nE "x1b|u001b|chalk|picocolors|kleur|validateStream: false" -- apps/cli` · no
`addCommand`: `git grep -n "addCommand" -- apps/cli` · stdout and stderr written only by the
output writer: `git grep -nE "console\.|process\.(stdout|stderr)" -- apps/cli/src ':!*main.ts' ':!*create-output.ts' ':!*.test.ts'`
· no code written in the CLI: `git grep -nE "code: ['\"]" -- apps/cli/src ':!*.test.ts'` · waits
poll through the one constant · each new command or flag has its api-contract entry, Ask-first
approval and `WALKTHROUGH.md` step.
