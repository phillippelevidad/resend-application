import { Command } from '@commander-js/extra-typings';
import type { Output } from './create-output.ts';

export type CliDeps = {
  output: Output;
};

export function createProgram(deps: CliDeps) {
  // Root settings come before any .command() call, which copies them into each subcommand when it
  // is created; subcommands are made only that way (pp-cli). exitOverride() turns commander's usage
  // exit (1 by default) into a thrown CommanderError that exitCodeFor maps to 2.
  const program = new Command('ledger')
    .description('A reliable email-event ledger for Resend webhooks. Not affiliated with Resend.')
    .exitOverride()
    .configureOutput({ writeOut: deps.output.out, writeErr: deps.output.err });
  // Commands register here, one apps/cli/src/commands/<noun>-<verb>.cli.ts each, from slice 1.
  return program;
}
