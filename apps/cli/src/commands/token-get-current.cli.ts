import type { Command } from '@commander-js/extra-typings';
import type { Token } from '@ledger/sdk';
import type { CliDeps } from '../create-program.ts';
import { renderTokenLines } from '../render-token.ts';
import { runOperation } from '../run-operation.ts';

// `token.getCurrent` → `ledger token current [--json]` (api-contract → token.getCurrent), under the
// `token` group: the token LEDGER_TOKEN holds. A `read` token is enough.
export function tokenGetCurrentCli(parent: Command, deps: CliDeps): void {
  parent
    .command('current')
    .description("show the calling token's id, name and scope")
    .option('--json', 'print the result or the error object as JSON')
    .action(async (options) => {
      await runOperation(deps, options, (client) => client.tokens.getCurrent(), renderCurrent);
    });
}

export function renderCurrent(token: Token): string {
  return renderTokenLines(token).join('\n');
}
