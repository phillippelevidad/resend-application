import { type Command, InvalidArgumentError } from '@commander-js/extra-typings';
import type { DlqMessageList } from '@ledger/sdk';
import { printable } from '../create-output.ts';
import type { CliDeps } from '../create-program.ts';
import { runOperation } from '../run-operation.ts';

// design.md → Surfaces (`dlq.listMessages`): the stderr notice after the human layout when the DLQ
// holds anything; under `--json`, `depth` itself says it.
export const DLQ_LOGS_NOTICE =
  'why each failed is in the worker logs under its svix_id (runbook: LedgerApp-dlq-depth)';

// Converts to the SDK's integer only; the 1 to 10 range is the API's `validation_failed` (D10,
// pp-cli → Case-by-case). A non-integer is a usage error: exit 2, no request.
function parseInteger(value: string): number {
  if (!/^-?\d+$/.test(value) || !Number.isSafeInteger(Number(value))) {
    throw new InvalidArgumentError('it must be an integer.');
  }
  return Number(value);
}

// `dlq.listMessages` → `ledger dlq inspect [--limit <1-10>] [--json]` (api-contract →
// dlq.listMessages), under the `dlq` group. A `read` token is enough.
export function dlqListMessagesCli(parent: Command, deps: CliDeps): void {
  parent
    .command('inspect')
    .description('show a sample of dead messages and the DLQ depth, ids and counts only')
    .option(
      '--limit <1-10>',
      'how many dead messages to show (the API defaults to 10)',
      parseInteger,
    )
    .option('--json', 'print the result or the error object as JSON')
    .action(async (options) => {
      await runOperation(
        deps,
        options,
        (client) =>
          client.dlq.listMessages(options.limit === undefined ? {} : { limit: options.limit }),
        renderDlqMessageList,
        (list) => (list.depth > 0 ? DLQ_LOGS_NOTICE : null),
      );
    });
}

const LABEL_WIDTH = 12;
const COLUMN_GAP = '  ';

function summary(list: DlqMessageList): string {
  if (list.depth === 0) return 'empty';
  const shown = list.data.length;
  return list.has_more
    ? `${printable(list.depth)} message(s), showing ${shown} of ${printable(list.depth)}`
    : `${printable(list.depth)} message(s), showing ${shown}`;
}

// design.md → Surfaces (`dlq.listMessages`): the `dlq` line, then one row per item, every value
// through printable (`null` → `—`). Each column is as wide as its widest cell; the last is not
// padded, so no line ends in spaces.
export function renderDlqMessageList(list: DlqMessageList): string {
  const rows = list.data.map((item) => [
    printable(item.svix_id),
    printable(item.type),
    `email ${printable(item.email_id)}`,
    `created ${printable(item.event_created_at)}`,
    `enqueued ${printable(item.enqueued_at)}`,
    `receives ${printable(item.receive_count)}`,
  ]);
  const widths = rows.reduce<number[]>(
    (max, row) => row.map((cell, index) => Math.max(max[index] ?? 0, cell.length)),
    [],
  );
  return [
    `${'dlq'.padEnd(LABEL_WIDTH)}${summary(list)}`,
    ...rows.map((row) =>
      row
        .map((cell, index) => (index < row.length - 1 ? cell.padEnd(widths[index] ?? 0) : cell))
        .join(COLUMN_GAP),
    ),
  ].join('\n');
}
