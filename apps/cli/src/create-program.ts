import { Command } from '@commander-js/extra-typings';
import type { LedgerClient } from '@ledger/sdk';
import { emailGetCli } from './commands/email-get.cli.ts';
import { recipientGetCli } from './commands/recipient-get.cli.ts';
import type { Output } from './create-output.ts';

export type CliDeps = {
  // Built on first use, inside an action, so `ledger --help` and a usage error need no LEDGER_URL.
  // It throws ConfigError when LEDGER_URL or LEDGER_TOKEN is missing or invalid (exit 2).
  client: () => LedgerClient;
  output: Output;
  // The only exit path: process.exitCode in main.ts, a recorder in tests (pp-cli).
  setExitCode: (code: number) => void;
};

export function createProgram(deps: CliDeps) {
  // Root settings come before any .command() call, which copies them into each subcommand when it
  // is created; subcommands are made only that way (pp-cli). exitOverride() turns commander's usage
  // exit (1 by default) into a thrown CommanderError that exitCodeFor maps to 2.
  const program = new Command('ledger')
    .description('A reliable email-event ledger for Resend webhooks. Not affiliated with Resend.')
    .exitOverride()
    .configureOutput({ writeOut: deps.output.out, writeErr: deps.output.err });
  // One apps/cli/src/commands/<noun>-<verb>.cli.ts per operation.
  emailGetCli(program, deps);
  recipientGetCli(program, deps);
  return program;
}
