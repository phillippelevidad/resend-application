// The CLI's test harness (pp-cli → cli-tests): the real program, through the same entry and exit
// mapping main.ts uses, over a fake SDK client and in-memory streams (not TTYs, so uncoloured).
import type { LedgerClient } from '@ledger/sdk';
import { type Env, loadConfig } from '@ledger/shared';
import { cliConfig } from '../cli.config.ts';
import { createOutput } from '../create-output.ts';
import { createProgram } from '../create-program.ts';
import { exitCodeFor } from '../exit-code-for.ts';

export const VALID_ENV: Env = {
  LEDGER_URL: 'http://127.0.0.1:3200',
  LEDGER_TOKEN: 'local-loopback-no-auth',
};

export type CliRun = { exitCode: number; stdout: string; stderr: string };

// `sleep` records each wait and returns at once, so a test of `ledger reconcile` runs without real
// time (pp-cli → cli-tests, Waiting).
export async function runCli(
  args: string[],
  client: LedgerClient,
  env: Env = VALID_ENV,
  sleep: (ms: number) => Promise<void> = async () => {},
): Promise<CliRun> {
  let stdout = '';
  let stderr = '';
  const output = createOutput({
    stdout: { write: (chunk: string) => (stdout += chunk) },
    stderr: { write: (chunk: string) => (stderr += chunk) },
  });
  let exitCode = 0;
  const setExitCode = (code: number) => {
    exitCode = code;
  };
  // As main.ts: the config is loaded when an action first asks for the client, then the fake
  // stands in for createLedgerClient.
  const clientFromEnv = () => {
    loadConfig(cliConfig, env);
    return client;
  };
  try {
    await createProgram({ client: clientFromEnv, output, setExitCode, sleep }).parseAsync([
      'node',
      'ledger',
      ...args,
    ]);
  } catch (err) {
    setExitCode(exitCodeFor(err, output));
  }
  return { exitCode, stdout, stderr };
}
