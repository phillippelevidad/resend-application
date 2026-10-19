import type { Command } from '@commander-js/extra-typings';
import type { CreatedToken, Token } from '@ledger/sdk';
import { printable } from '../create-output.ts';
import type { CliDeps } from '../create-program.ts';
import { renderTokenLines, tokenField } from '../render-token.ts';
import { runOperation } from '../run-operation.ts';

// design.md → Surfaces (`token.create`): the one stderr notice after the human layout.
export const TOKEN_SHOWN_ONCE_NOTICE =
  'ledger: this is the only time the token is shown; store it now.';

// `token.create` → `ledger token create --name <name> --scope <read|operate> [--json]`
// (api-contract → token.create), under the `token` group. Both options are required strings with no
// argParser: the API checks the name and the scope (D25). The plaintext goes to stdout only, once.
export function tokenCreateCli(parent: Command, deps: CliDeps): void {
  parent
    .command('create')
    .description('mint a token; its plaintext is shown this once')
    .requiredOption('--name <name>', 'a label for the token')
    .requiredOption('--scope <read|operate>', 'the scope the token grants')
    .option('--json', 'print the result or the error object as JSON')
    .action(async (options) => {
      await runOperation(
        deps,
        options,
        // Unchecked here: a scope outside the two is the API's validation_failed (pp-cli → Never).
        (client) =>
          client.tokens.create({ name: options.name, scope: options.scope as Token['scope'] }),
        renderCreatedToken,
        () => TOKEN_SHOWN_ONCE_NOTICE,
      );
    });
}

export function renderCreatedToken(created: CreatedToken): string {
  return [...renderTokenLines(created), tokenField('secret', printable(created.token))].join('\n');
}
