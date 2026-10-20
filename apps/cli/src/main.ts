// @ledger/app-cli: the `ledger` CLI, built on the SDK. Composition root (pp-cli): the only
// process.env read. Started from the workspace as `pnpm -s ledger` (D33).
import { setTimeout as sleep } from 'node:timers/promises';
import { createLedgerClient } from '@ledger/sdk';
import { loadConfig } from '@ledger/shared';
import { cliConfig } from './cli.config.ts';
import { createOutput } from './create-output.ts';
import { createProgram } from './create-program.ts';
import { exitCodeFor } from './exit-code-for.ts';

const output = createOutput({ stdout: process.stdout, stderr: process.stderr });
// Built on first use, in the action, so `ledger --help` needs no LEDGER_URL.
const client = () => createLedgerClient(loadConfig(cliConfig, process.env));
// Exit through process.exitCode only (pp-cli): a piped write is asynchronous on POSIX and an
// early exit can drop it.
const setExitCode = (code: number): void => {
  process.exitCode = code;
};
const program = createProgram({ client, output, setExitCode, sleep: (ms) => sleep(ms) });

try {
  await program.parseAsync(process.argv);
} catch (err) {
  setExitCode(exitCodeFor(err, output));
}
