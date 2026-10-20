# CLI tests

The evidence ADR-011 and ADR-019 name for the CLI: **`--json` output tests per command**, from
slice 1, grown by each slice that adds a command
([ADR-011](../../../../.ai/architecture.md#adr-011--one-contract-many-surfaces),
[slice 1](../../../../.ai/build-checklist.md#1--local-ledger-and-read-path)). They prove the CLI's
own job: the exit code, what lands on stdout and stderr, and that a usage error never calls the
SDK. That the SDK and the API agree is the SDK ↔ API contract tests' job (pp-backend), not these.
Tiers, file names and the runner are [pp-testing](../../pp-testing/SKILL.md#test-files-and-tiers)'s;
which claim needs which tier is [pp-workflow → Test tiers](../../pp-workflow/SKILL.md#test-tiers).

## Harness

- **Unit tier:** `<noun>-<verb>.cli.test.ts` beside the command. No network, no database, no child
  process.
- **The real program over fakes.** Build it with `createProgram({ client, output, setExitCode })`
  ([command-anatomy.md](command-anatomy.md#the-composition-root)), passing:
  - a **fake SDK client** from `@ledger/sdk/testing`, typed against the SDK's client type so it
    cannot drift from it; it returns `{ data, error }` exactly as the real one does and records
    each call;
  - in-memory stdout and stderr writers (not TTYs, so output is uncoloured);
  - a `setExitCode` recorder.
- Run it with `program.parseAsync(['node', 'ledger', ...args])`, the same entry `main.ts` uses, and
  route a thrown `CommanderError` through the same `exitCodeFor`.
- A fake SDK is a test double at the CLI's one seam, not a second implementation
  ([pp-general → Case-by-case](../../pp-general/SKILL.md#case-by-case)).

## What every command's test asserts

Assert the consequence (the exit code and the bytes written), never which internal function ran.

| Case | Fake returns | Exit | stdout | stderr |
| --- | --- | --- | --- | --- |
| Success, `--json` | `{ data }` | `0` | Parses to exactly `data`; one document | Empty |
| Registry error, `--json` | `{ error }` (e.g. `email_not_found`) | `1` | Parses to exactly `{ "error": error }` | Empty |
| Registry error, human | `{ error }` | `1` | Empty | Holds `message` and `hint` |
| Unknown `code` | `{ error: { code: "not_in_registry", … } }` | `1` | Printed as received | — |
| `api_unavailable` | `{ error }` with that code | `1` | As received | — |
| Usage error (missing argument, unknown option) | not called | `2` | Empty | Commander's message; the fake recorded **zero calls** |
| Human success | `{ data }` | `0` | The layout; no `\u001b[` | Empty |

Per command, add what its contract entry makes specific:

- **`ledger recipient <address>`** (slice 1): the address reaches the fake as the method argument
  (the SDK sends it in the body), and no output line holds the raw input address, only the
  fixture's mask. Fixtures use `delivered@resend.dev` and `bounced@resend.dev` only.
- **`ledger token create`** (slice 2): the plaintext token appears once, on stdout, never on stderr.
- **A command with an `argParser`** (`ledger dlq inspect --limit`): a non-integer exits `2` with no
  call; an out-of-range integer reaches the fake, which answers `validation_failed`, and exits `1`.
- **A missing `LEDGER_URL`**: exit `2`, stderr names the variable, and holds no value of any other
  variable.

## Waiting

For `ledger reconcile` (slice 4), with `sleep` injected so no test waits in real time:

- The fake's `reconcile.start` answers a running run, then `reconcile.getRun` answers running, then
  finished: exit `0`, stdout under `--json` holds only the final run, and the fake recorded the
  polls in order.
- A finished run carrying `error`: exit `1`, stdout under `--json` is that error in the error shape.
- `--no-wait`: one `reconcile.start` call, no `getRun` call, exit `0`, stdout is the `202` result.
- An abandoned run: `reconcile.getRun` answers running, then the run with no `finished_at` and its
  `error` set to [`run_abandoned`](../../../../.ai/api-contract.md#error-codes): exit `1`, stdout
  under `--json` is that error in the error shape, and no poll follows it.
- A run that stays running past the backstop (the API's derivation failed): the wait stops after
  `RUN_WAIT_BACKSTOP_MS / RUN_POLL_INTERVAL_MS` polls (400), exits `1` with `internal_error` under
  `--json` and the constant defect line without, and the test asserts
  it stops.
- A transient poll error (`api_unavailable`, `database_unavailable`, `internal_error`) mid-wait,
  then the run finished: exit `0`, stdout under `--json` holds only the final run and stderr only
  the run-id notice; without `--json`, stderr also holds the retry notice.
- A poll error that is not transient (`unauthorized`, `run_not_found`): exit `1` with it, and no poll
  follows it.
- Transient poll errors in a row: the wait stops after `MAX_CONSECUTIVE_POLL_FAILURES` polls and
  exits `1` with the last one; a success between them resets the count.

## Never

- **A CLI test against a live API, a running `apps/local` or a database** → the fake SDK; the real
  chain is the contract tests' and the `WALKTHROUGH.md` walk's.
- **Asserting on a spy of `runOperation` or the writer** → assert exit code and bytes.
- **Reading or setting the global `process.exitCode` in a test** → the `setExitCode` recorder.
- **A fixture with a real address** → Resend's test addresses
  ([integrations.md → Locked rules](../../../../.ai/integrations.md#locked-rules-must)).
