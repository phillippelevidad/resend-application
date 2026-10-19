import type { Command } from '@commander-js/extra-typings';
import type { TokenList } from '@ledger/sdk';
import { printable } from '../create-output.ts';
import type { CliDeps } from '../create-program.ts';
import { runOperation } from '../run-operation.ts';

// The contract's page maximum: `ledger token list` names no paging flag, so it asks for the most
// one page holds (D25).
const PAGE_LIMIT = 100;

// design.md → Surfaces (`token.list`): the stderr notice after the human rows when `has_more`;
// under `--json`, `has_more` itself says it.
export const MORE_TOKENS_NOTICE = `ledger: more tokens exist; showing the newest ${PAGE_LIMIT}.`;

// `token.list` → `ledger token list [--json]` (api-contract → token.list), under the `token` group.
// Needs an `operate` token; the API decides.
export function tokenListCli(parent: Command, deps: CliDeps): void {
  parent
    .command('list')
    .description('list active and revoked tokens, newest first')
    .option('--json', 'print the result or the error object as JSON')
    .action(async (options) => {
      await runOperation(
        deps,
        options,
        (client) => client.tokens.list({ limit: PAGE_LIMIT }),
        renderTokenList,
        (list) => (list.has_more ? MORE_TOKENS_NOTICE : null),
      );
    });
}

const COLUMN_GAP = '   ';
// The scope column is as wide as `operate`, so a page of `read` tokens lines up the same way.
const SCOPE_WIDTH = 'operate'.length;
const EMPTY_LIST = '  —';

// One row per token: id, name, scope, created_at, then revoked_at or `—`. Each column is as wide as
// its widest cell; the last is not padded, so no line ends in spaces.
export function renderTokenList(list: TokenList): string {
  if (list.data.length === 0) return EMPTY_LIST;
  const rows = list.data.map((token) => [
    printable(token.token_id),
    printable(token.name),
    printable(token.scope),
    printable(token.created_at),
    printable(token.revoked_at),
  ]);
  const widths = [0, 0, SCOPE_WIDTH, 0];
  for (const row of rows) {
    for (let index = 0; index < widths.length; index += 1) {
      widths[index] = Math.max(widths[index] ?? 0, row[index]?.length ?? 0);
    }
  }
  return rows
    .map(
      (row) =>
        `  ${row.map((cell, index) => (index < row.length - 1 ? cell.padEnd(widths[index] ?? 0) : cell)).join(COLUMN_GAP)}`,
    )
    .join('\n');
}
