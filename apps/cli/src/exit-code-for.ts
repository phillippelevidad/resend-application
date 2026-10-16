import { CommanderError } from '@commander-js/extra-typings';
import type { Output } from './create-output.ts';

// Never the exception's text, stack or cause (pp-cli → Never).
const UNEXPECTED_FAILURE_LINE = 'ledger: unexpected failure.\n';

// The CLI's one exit mapping for what parseAsync throws (api-contract → Conventions, Errors):
// help exits 0, a usage error 2, a defect 1. Registry errors never reach it: the SDK returns them.
export function exitCodeFor(err: unknown, output: Output): number {
  if (err instanceof CommanderError) {
    // Commander has already written help or its message.
    return err.exitCode === 0 ? 0 : 2;
  }
  output.err(UNEXPECTED_FAILURE_LINE);
  return 1;
}
