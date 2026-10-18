import type { Command } from '@commander-js/extra-typings';
import type { Token } from '@ledger/sdk';
import { printable } from '../create-output.ts';
import type { CliDeps } from '../create-program.ts';
import { renderTokenLines, tokenField } from '../render-token.ts';
import { runOperation } from '../run-operation.ts';

// `token.revoke` → `ledger token revoke <token_id> [--json]` (api-contract → token.revoke), under
// the `token` group. The id is passed through as a string: the API answers validation_failed (D25).
export function tokenRevokeCli(parent: Command, deps: CliDeps): void {
  parent
    .command('revoke')
    .description('revoke a token; its next request is refused')
    .argument('<token_id>', 'the id `ledger token list` shows')
    .option('--json', 'print the result or the error object as JSON')
    .action(async (tokenId, options) => {
      await runOperation(deps, options, (client) => client.tokens.revoke(tokenId), renderRevoked);
    });
}

// The create layout without `secret`, plus `revoked` (design.md → Surfaces, `token.revoke`).
export function renderRevoked(token: Token): string {
  return [...renderTokenLines(token), tokenField('revoked', printable(token.revoked_at))].join(
    '\n',
  );
}
