import type { Command } from '@commander-js/extra-typings';
import type { EventSource } from '@ledger/sdk';
import { printable } from '../create-output.ts';
import type { CliDeps } from '../create-program.ts';
import { runOperation } from '../run-operation.ts';

// `worker.resumeEventSource` → `ledger worker resume [--json]` (api-contract →
// worker.resumeEventSource), under the `worker` group. Needs an `operate` token; the API decides.
export function workerResumeEventSourceCli(parent: Command, deps: CliDeps): void {
  parent
    .command('resume')
    .description("probe the database and re-enable the worker's paused event source")
    .option('--json', 'print the result or the error object as JSON')
    .action(async (options) => {
      await runOperation(
        deps,
        options,
        (client) => client.worker.resumeEventSource(),
        renderEventSource,
      );
    });
}

const LABEL_WIDTH = 12;

// design.md → Surfaces (`worker.resumeEventSource`): `resumed` is false only for an event source
// that was already enabled (D16, D20).
export function renderEventSource(eventSource: EventSource): string {
  const outcome = eventSource.resumed ? 'resumed' : 'already enabled';
  return `${'worker'.padEnd(LABEL_WIDTH)}${printable(eventSource.state)} (${outcome})`;
}
