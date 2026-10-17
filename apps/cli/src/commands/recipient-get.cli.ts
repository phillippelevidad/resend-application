import type { Command } from '@commander-js/extra-typings';
import type { Recipient } from '@ledger/sdk';
import { printable } from '../create-output.ts';
import type { CliDeps } from '../create-program.ts';
import { runOperation } from '../run-operation.ts';

// `recipient.get` → `ledger recipient <address> [--json]` (api-contract → recipient.get). The
// address goes to the SDK, which sends it in the body; output echoes only the API's mask. No
// argParser: commander would quote a rejected address in its message (pp-cli → Case-by-case).
export function recipientGetCli(parent: Command, deps: CliDeps): void {
  parent
    .command('recipient')
    .description("show an address's deliverability and the email that caused it")
    .argument('<address>', 'the email address to look up')
    .option('--json', 'print the result or the error object as JSON')
    .action(async (address, options) => {
      await runOperation(
        deps,
        options,
        (client) => client.recipients.get(address),
        renderRecipient,
      );
    });
}

const LABEL_WIDTH = 17;

const field = (label: string, value: string): string => `${label.padEnd(LABEL_WIDTH)}${value}`;

// D34 and design.md → Surfaces: every value passes through printable; masks only.
export function renderRecipient(recipient: Recipient): string {
  return [
    field('recipient', printable(recipient.address_masked)),
    field('deliverability', printable(recipient.deliverability)),
    field('since', printable(recipient.since)),
    field('caused by', printable(recipient.cause_email_id)),
  ].join('\n');
}
