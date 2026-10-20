import type { Command } from '@commander-js/extra-typings';
import { internalError, type ReconcileRun } from '@ledger/sdk';
import { ConfigError } from '@ledger/shared';
import { printable } from '../create-output.ts';
import type { CliDeps } from '../create-program.ts';
import { printFailure } from '../run-operation.ts';
import { waitForRun } from '../wait-for-run.ts';

// design.md → Surfaces (`reconcile.start`): before any wait, in both modes, so an interrupted wait
// still leaves the run id behind (pp-cli → Waiting).
export const startedNotice = (runId: number): string =>
  `ledger: reconcile run ${runId} started; follow it with ledger gaps.`;

// The backstop's line without `--json`: the constant defect line, as any defect prints it.
class WaitBackstopReached extends Error {}

// `reconcile.start` → `ledger reconcile [--dry-run] [--lookback <duration>] [--no-wait] [--json]`
// (api-contract → reconcile.start). Needs an `operate` token; the API decides, and parses
// `--lookback`. Waits by polling `reconcile.getRun` unless `--no-wait`.
export function reconcileStartCli(parent: Command, deps: CliDeps): void {
  parent
    .command('reconcile')
    .description('start a reconcile run and wait until it finishes')
    .option('--dry-run', 'report the missing count without replaying any event')
    .option('--lookback <duration>', 'how far back to check, from 1m to 30d (default 72h)')
    .option('--no-wait', 'print the started run and return at once')
    .option('--json', 'print the result or the error object as JSON')
    .action(async (options) => {
      try {
        const client = deps.client();
        const started = await client.reconcile.start({
          ...(options.dryRun === true ? { dry_run: true } : {}),
          ...(options.lookback === undefined ? {} : { lookback: options.lookback }),
        });
        if (started.error !== null) {
          printFailure(deps, options, started.error);
          return;
        }
        deps.output.notice(startedNotice(started.data.run_id));
        if (!options.wait) {
          print(deps, options, started.data);
          return;
        }
        const outcome = await waitForRun(client, started.data.run_id, deps.sleep);
        if (outcome.kind === 'backstop') throw new WaitBackstopReached();
        const { data, error } = outcome.result;
        if (error !== null) {
          printFailure(deps, options, error);
          return;
        }
        // A run outcome, `run_abandoned` included, exits `1` in the error shape.
        if (data.error !== null) {
          printFailure(deps, options, data.error);
          return;
        }
        print(deps, options, data);
      } catch (err) {
        // As runOperation: a config error is a usage error, and a defect (the backstop included)
        // prints the constant line without `--json`, the internal_error object with it.
        if (err instanceof ConfigError || !options.json) throw err;
        printFailure(deps, options, internalError);
      }
    });
}

function print(deps: CliDeps, options: { json?: true }, run: ReconcileRun): void {
  if (options.json) deps.output.json(run);
  else deps.output.result(renderRun(run));
}

const LABEL_WIDTH = 11;
const field = (label: string, value: string): string => `${label.padEnd(LABEL_WIDTH)}${value}`;

// design.md → Surfaces (`reconcile.start`): every value passes through printable.
export function renderRun(run: ReconcileRun): string {
  const title = [`run ${printable(run.run_id)}`, printable(run.trigger)];
  if (run.dry_run) title.push('dry run');
  return [
    title.join('   '),
    field('started', printable(run.started_at)),
    field('finished', printable(run.finished_at)),
    field('horizon', `${printable(run.horizon_start)} → ${printable(run.horizon_end)}`),
    `checked ${run.checked}   missing ${run.missing}   replayed ${run.replayed}   failed ${run.failed}`,
  ].join('\n');
}
