import type { Command } from '@commander-js/extra-typings';
import type { Health } from '@ledger/sdk';
import { printable } from '../create-output.ts';
import type { CliDeps } from '../create-program.ts';
import { runOperation } from '../run-operation.ts';

// `health.get` → `ledger health [--json]` (api-contract → health.get). A `read` token is enough.
export function healthGetCli(parent: Command, deps: CliDeps): void {
  parent
    .command('health')
    .description(
      'show queue and DLQ depth, the worker event source, the database and the last reconcile run',
    )
    .option('--json', 'print the result or the error object as JSON')
    .action(async (options) => {
      await runOperation(deps, options, (client) => client.health.get(), renderHealth);
    });
}

const LABEL_WIDTH = 12;
const BYTE_UNITS = ['B', 'kB', 'MB', 'GB', 'TB'] as const;

const field = (label: string, value: string): string => `${label.padEnd(LABEL_WIDTH)}${value}`;

// Decimal units, one decimal place (9437184 → `9.4 MB`, 1000000000 → `1.0 GB`); bytes as is.
export function formatBytes(bytes: number): string {
  let value = bytes;
  let unit = 0;
  while (unit < BYTE_UNITS.length - 1 && Number(value.toFixed(1)) >= 1000) {
    value /= 1000;
    unit += 1;
  }
  return unit === 0 ? `${bytes} B` : `${value.toFixed(1)} ${BYTE_UNITS[unit]}`;
}

function database(health: Health['database']): string {
  if (!health.reachable) return 'unreachable';
  const used = health.storage_bytes === null ? printable(null) : formatBytes(health.storage_bytes);
  return `reachable, ${used} of ${formatBytes(health.storage_limit_bytes)}`;
}

// Slice 4 design.md → Surfaces (`health.get`): the last run, finished, running or with its
// `error.code`; `no run yet` when the database answered none, `—` while it is unreachable.
function reconcile(health: Health): string {
  const run = health.last_reconcile_run;
  if (run === null) return health.database.reachable ? 'no run yet' : printable(null);
  const id = `run ${printable(run.run_id)}`;
  if (run.error !== null) return `${id} ${printable(run.error.code)}`;
  if (run.finished_at === null) return `${id} running`;
  return `${id} finished ${printable(run.finished_at)}, missing ${run.missing}, replayed ${run.replayed}`;
}

// design.md → Surfaces (`health.get`): every value passes through printable (D34).
export function renderHealth(health: Health): string {
  const oldest = health.queue.oldest_age_seconds;
  return [
    field(
      'queue',
      `${health.queue.visible} visible, ${health.queue.in_flight} in flight, oldest ${oldest === null ? printable(null) : `${oldest}s`}`,
    ),
    field('dlq', `${health.dlq.visible} visible, ${health.dlq.in_flight} in flight`),
    field('worker', printable(health.event_source.state)),
    field('database', database(health.database)),
    field('reconcile', reconcile(health)),
  ].join('\n');
}
