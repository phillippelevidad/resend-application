import type { Command } from '@commander-js/extra-typings';
import type { ReconcileRun, ReconcileRunList } from '@ledger/sdk';
import { printable } from '../create-output.ts';
import type { CliDeps } from '../create-program.ts';
import { runOperation } from '../run-operation.ts';

// The contract's page maximum: `ledger gaps` names no paging flag, so it asks for the most one page
// holds.
const PAGE_LIMIT = 100;

// design.md → Surfaces (`gaps.list`): the stderr notice after the human rows when `has_more`.
export const MORE_RUNS_NOTICE = `ledger: more runs exist; showing the newest ${PAGE_LIMIT}.`;

// `gaps.list` → `ledger gaps [--since <duration>] [--json]` (api-contract → gaps.list). A `read`
// token is enough; `--since` goes to the API as given, which parses it.
export function gapsListCli(parent: Command, deps: CliDeps): void {
  parent
    .command('gaps')
    .description('list recent reconcile runs, newest first, with their counts and outcome')
    .option('--since <duration>', 'how far back to list, from 1m to 30d (default 24h)')
    .option('--json', 'print the result or the error object as JSON')
    .action(async (options) => {
      await runOperation(
        deps,
        options,
        (client) =>
          client.gaps.list({
            limit: PAGE_LIMIT,
            ...(options.since === undefined ? {} : { since: options.since }),
          }),
        renderGaps,
        (list) => (list.has_more ? MORE_RUNS_NOTICE : null),
      );
    });
}

// `ok`, `running`, or the run's `error.code` as sent.
export function runState(run: ReconcileRun): string {
  if (run.error !== null) return printable(run.error.code);
  return run.finished_at === null ? 'running' : 'ok';
}

const COLUMN_GAP = '   ';
const EMPTY_LIST = '  —';
// The trigger column as wide as `scheduled` and the dry-run column as `dry run`, so every page
// lines up the same way.
const MIN_WIDTHS = [0, 'scheduled'.length, 'dry run'.length];

// One row per run: id, trigger, `dry run` or blank, started_at, the four counts, the outcome. Each
// column is as wide as its widest cell; the last is not padded, so no line ends in spaces.
export function renderGaps(list: ReconcileRunList): string {
  if (list.data.length === 0) return EMPTY_LIST;
  const rows = list.data.map((run) => [
    printable(run.run_id),
    printable(run.trigger),
    run.dry_run ? 'dry run' : '',
    printable(run.started_at),
    `checked ${run.checked}`,
    `missing ${run.missing}`,
    `replayed ${run.replayed}`,
    `failed ${run.failed}`,
    runState(run),
  ]);
  const widths = rows[0]?.map((_cell, index) => MIN_WIDTHS[index] ?? 0) ?? [];
  for (const row of rows) {
    row.forEach((cell, index) => {
      widths[index] = Math.max(widths[index] ?? 0, cell.length);
    });
  }
  return rows
    .map(
      (row) =>
        `  ${row.map((cell, index) => (index < row.length - 1 ? cell.padEnd(widths[index] ?? 0) : cell)).join(COLUMN_GAP)}`,
    )
    .join('\n');
}
