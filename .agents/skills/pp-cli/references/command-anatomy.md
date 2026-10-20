# Command anatomy

How `apps/cli` is put together. The sketches are the convention's shape, not an API: check the
installed `commander`, `@commander-js/extra-typings` and the SDK's real signatures first
([version rule](../../pp-general/SKILL.md#check-the-installed-version-not-memory)). File names
follow [pp-general → Role suffixes](../../pp-general/references/coding-standards.md#role-suffixes).

```text
apps/cli/src/
  main.ts                 composition root: env, SDK client, program, exit mapping
  cli.config.ts           Zod schema for LEDGER_URL and LEDGER_TOKEN
  create-program.ts       builds the configured root and registers every command
  create-output.ts        the one writer of stdout and stderr
  run-operation.ts        unwraps { data, error } and sets the exit code
  wait-for-run.ts         the poll loop and its interval constant (slice 4)
  commands/<noun>-<verb>.cli.ts
```

## The composition root

`main.ts` holds the only `process.env` read, and `create-program.ts` takes everything as
arguments, so a test builds the same program over a fake SDK and in-memory streams
([cli-tests.md](cli-tests.md)).

```ts
// apps/cli/src/main.ts
import { CommanderError } from '@commander-js/extra-typings';
import { createLedgerClient } from '@ledger/sdk';
import { loadConfig } from '@ledger/shared';
import { cliConfig } from './cli.config.ts';
import { createOutput } from './create-output.ts';
import { createProgram } from './create-program.ts';

const output = createOutput({ stdout: process.stdout, stderr: process.stderr });
// Built on first use, in the action, so `ledger --help` needs no LEDGER_URL.
const client = () => createLedgerClient(loadConfig(cliConfig, process.env));
const setExitCode = (code: number) => {
  process.exitCode = code;
};
const program = createProgram({ client, output, setExitCode });

try {
  await program.parseAsync(process.argv);
} catch (err) {
  setExitCode(exitCodeFor(err, output));
}
```

`setExitCode` is the only exit path: tests pass a recorder instead, so no test reads or resets the
global `process.exitCode`.

`createLedgerClient` stands for the SDK's factory (its name is pp-backend's and slice 1's). The
exit mapping is the CLI's one error mapper
([one mapping per surface](../../pp-general/references/errors.md#one-mapping-per-surface)):

| Caught | Exit | Output |
| --- | --- | --- |
| `CommanderError` with `exitCode` `0` (`--help`) | `0` | Commander already wrote it |
| Any other `CommanderError` | `2` | Commander already wrote its message to stderr |
| The config loader's error (a missing or invalid variable) | `2` | Its message: the variable's name, never its value ([config](../../pp-general/references/config-and-env.md#parse-once-at-the-composition-root)) |
| Anything else | `1` | Under `--json`, the `internal_error` object on stdout (O-12, [Error codes](../../../../.ai/api-contract.md#error-codes)); otherwise one constant stderr line. Never the exception's text, stack or `cause` |

Registry errors never reach this mapper: `run-operation.ts` handles them, because the SDK returns
them instead of throwing (owner, O-10).

**Why `exitOverride()`:** commander exits `1` on a usage error by default (`error()` defaults
`exitCode` to `1`; [source](https://github.com/tj/commander.js/blob/master/lib/command.js)), and
the contract wants `2`. With `exitOverride()`, commander throws a `CommanderError` carrying
`exitCode` and `code` instead of calling `process.exit()`; help exits `0`
([README](https://github.com/tj/commander.js), "Override exit and output handling").

```ts
// apps/cli/src/create-program.ts
import { Command } from '@commander-js/extra-typings';

export function createProgram(deps: CliDeps): Command {
  const program = new Command('ledger')
    .exitOverride()
    .configureOutput({ writeOut: deps.output.out, writeErr: deps.output.err });
  // Subcommands made with .command() copy exitOverride and configureOutput from here;
  // addCommand() copies nothing, so it is never used.
  emailGetCli(program, deps);
  const token = program.command('token');
  tokenCreateCli(token, deps);
  return program;
}
```

`.command()` calls `copyInheritedSettings`, which copies the exit callback, the output
configuration and the help settings; `addCommand()` does not ([source](https://github.com/tj/commander.js/blob/master/lib/command.js)).
Configure the root first: the copy happens when the subcommand is created. A group (`token`,
`dlq`, `worker`) is a plain `.command()` with no action.

## A command

```ts
// apps/cli/src/commands/email-get.cli.ts
import type { Command } from '@commander-js/extra-typings';
import { runOperation } from '../run-operation.ts';

export function emailGetCli(parent: Command, deps: CliDeps): void {
  parent
    .command('email')
    .argument('<email_id>')
    .option('--json', 'print the result or the error object as JSON')
    .action(async (emailId, options) => {
      await runOperation(deps, options, (client) => client.emails.get({ email_id: emailId }), renderEmail);
    });
}
```

- **One chain per command**: extra-typings infers `emailId` and `options` only from the chain
  ([README](https://github.com/commander-js/extra-typings)). How a typed `parent` is passed in is
  checked against the installed types.
- **Arguments are passed through as strings.** An `argParser` only converts to the SDK's type (an
  integer `--limit`) and throws `InvalidArgumentError` on failure, which is exit `2`. Ranges and
  formats stay with the API.
- **The description** says what the command shows. It names no behavior Ledger does not implement.
- `renderEmail` is the human layout (the slice 1 pre-proposal's). It reads the masked `data` only.

## Unwrapping

```ts
// apps/cli/src/run-operation.ts
import { internalError } from '@ledger/sdk';

export async function runOperation<T>(deps, options: { json?: true }, call: (client: LedgerClient) => Promise<SdkResult<T>>, render: (data: T) => string) {
  // Outside the try: a config error propagates to main.ts's mapper (exit 2), never internal_error.
  const client = deps.client();
  try {
    const { data, error } = await call(client);
    if (error) return fail(deps, options, error);
    if (options.json) deps.output.json(data);
    else deps.output.result(render(data));
  } catch {
    // A defect: never the exception's text, stack or cause (O-12).
    fail(deps, options, internalError);
  }
}

function fail(deps, options: { json?: true }, error: SdkError) {
  if (options.json) deps.output.json({ error });
  else deps.output.failure(error.message, error.hint);
  deps.setExitCode(1);
}
```

`internalError` is the registry's `internal_error` object the SDK exports beside `api_unavailable`
([pp-backend → sdk.md](../../pp-backend/references/sdk.md)), so the CLI writes no `code` literal.

The SDK's `error` is the inner object `{ code, message, hint, docs }`
([pp-backend → sdk.md](../../pp-backend/references/sdk.md)); it is wrapped once, here, into the
[error shape](../../../../AGENTS.md#error-shape). Success leaves the exit code at `0`; nothing
calls `process.exit()`.

## The output writer

`create-output.ts` is the only file that writes to stdout or stderr. It exposes `out` and `err`
(raw, for commander), `json(value)` (`JSON.stringify` plus a newline, to stdout, never styled),
`result(text)` (stdout), `failure(message, hint)` (stderr) and `notice(text)` (stderr).

- Colour goes through `styleText(format, text, { stream })` with the stream being written, so the
  TTY check and `NO_COLOR` are Node's ([util.styleText](https://nodejs.org/docs/latest-v24.x/api/util.html#utilstyletextformat-text-options);
  `stream` defaults to `process.stdout`, so a stderr line MUST pass `process.stderr`).
- In tests the streams are in-memory writers, which are not TTYs, so output is uncoloured.

## Waiting

- **`--no-wait`** prints the `202` result and exits `0`. A finished run with an `error` exits `1`
  with it in the error shape.
- **Ends on finished or abandoned.** A run with no `finished_at` past its time budget is abandoned,
  never running ([reconcile_runs](../../../../.ai/data-modeling.md#reconcile_runs--one-row-per-recovery-run)).
  The API derives that on read and returns the run with its `error` set to
  [`run_abandoned`](../../../../.ai/api-contract.md#error-codes), a run outcome: exit `1` with it in
  the error shape, like any run outcome. The CLI never learns or computes the budget.
- **Ctrl-C stops the wait, not the run.** So before waiting, both modes print the run id to stderr
  through `notice` and point at `ledger gaps` (stdout stays one document under `--json`), so a
  script whose wait is interrupted or ends on a poll's error still holds the run id; no signal
  handler is needed.

```ts
// apps/cli/src/wait-for-run.ts (slice 4, D46)
// Each poll costs one HTTP API request, one Lambda invocation and one Postgres read, and counts
// against the HTTP API throttle (AWS-14): at 3 s, a full 14-minute run is 280 polls.
export const RUN_POLL_INTERVAL_MS = 3_000;
export const RUN_WAIT_BACKSTOP_MS = 1_200_000; // 20 minutes, above the 14-minute budget
```

`waitForRun(client, runId, sleep)` sleeps one interval before each poll and counts polls to the
backstop, so no clock is read. `sleep` is `CliDeps.sleep`: `node:timers/promises` in `main.ts`, a
no-op in tests.

- `ledger reconcile` declares `--no-wait` alone, so `options.wait` defaults to `true` and the flag
  sets it `false` ([README](https://github.com/tj/commander.js), "Other option types, negatable
  boolean"; commander 15 keeps that default for a lone `--no-*` option,
  [CHANGELOG](https://github.com/tj/commander.js/blob/master/CHANGELOG.md) 15.0.0).
- The loop calls `reconcile.getRun` until `finished_at` is set or the run carries an `error` (an
  abandoned run has `run_abandoned` and no `finished_at`), so it tests the field, never a `code`
  literal, for the run's outcome. A run outcome ends the wait with exit `1`. Each poll unwraps
  through `runOperation`'s rules, with one exception: a poll's own `api_unavailable`,
  `database_unavailable` or `internal_error` (the read retry of
  [api-contract.md → Conventions](../../../../.ai/api-contract.md#conventions), Idempotency:
  network, `429`, `5xx`) is retried on the next tick (a stderr notice without `--json`); the
  `MAX_CONSECUTIVE_POLL_FAILURES`th (5th) in a row ends the wait with exit `1` and that error, and a
  successful poll resets the count. Any other `getRun` error ends it with exit `1` at once. When the
  SDK retries reads (slice 5), revisit whether this CLI retry stays, since the two would stack.
- **The wait's own bound is a backstop**, `RUN_WAIT_BACKSTOP_MS` (20 minutes, above the run's
  14-minute budget): it fires only if the API's derivation does not, and exits `1` with
  `internal_error` under `--json`, the constant defect line `ledger: unexpected failure.` without.
- **The notice** is `ledger: reconcile run <run_id> started; follow it with ledger gaps.`, on
  stderr in both modes, so under `--json` `ledger reconcile` is the one command whose success
  writes to stderr.
- Progress lines, if any, go to stderr through `notice`. Under `--json`, stdout gets only the final
  run, or the run's `error` in the error shape.
- `sleep` is injected in tests, so a wait test runs without real time
  ([cli-tests.md](cli-tests.md#waiting)).
