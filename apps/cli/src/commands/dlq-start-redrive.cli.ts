import type { Command } from '@commander-js/extra-typings';
import type { DlqRedrive } from '@ledger/sdk';
import { printable } from '../create-output.ts';
import type { CliDeps } from '../create-program.ts';
import { runOperation } from '../run-operation.ts';

// `dlq.startRedrive` → `ledger dlq redrive [--json]` (api-contract → dlq.startRedrive), under the
// `dlq` group. Needs an `operate` token; the API decides. It returns at once: nothing to poll, so no
// `--no-wait` (D10).
export function dlqStartRedriveCli(parent: Command, deps: CliDeps): void {
  parent
    .command('redrive')
    .description('move every dead message back to the queue')
    .option('--json', 'print the result or the error object as JSON')
    .action(async (options) => {
      await runOperation(deps, options, (client) => client.dlq.startRedrive(), renderDlqRedrive);
    });
}

const LABEL_WIDTH = 12;

// design.md → Surfaces (`dlq.startRedrive`).
export function renderDlqRedrive(redrive: DlqRedrive): string {
  const line =
    redrive.status === 'started'
      ? `started: ${printable(redrive.depth)} message(s) moving back to the queue; watch the dlq depth with ledger health`
      : 'nothing to move: the dlq is empty';
  return `${'redrive'.padEnd(LABEL_WIDTH)}${line}`;
}
