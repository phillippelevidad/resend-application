import { randomBytes, randomInt } from 'node:crypto';
import { ledgerHistory } from '@ledger/core/testing';
import { arrangeEvents } from './arrange-events.ts';
import { projectLedger } from './project-ledger.ts';
import { maxSeed, readSimFlags, type SimFlags } from './read-sim-flags.ts';
import { sampleOnce } from './sample-once.ts';

// `pnpm sim`, slice 0 (D16): a seeded history, its duplicates and shuffle, and the projection it
// folds to, printed masks only. No environment variable is read in slice 0, and nothing is sent.

function main(args: readonly string[]): number {
  let flags: SimFlags;
  try {
    flags = readSimFlags(args);
  } catch (error) {
    process.stderr.write(`sim: ${error instanceof Error ? error.message : String(error)}\n`);
    return 2;
  }
  const { duplicates, shuffle } = flags;
  // simulator.md → Seed and determinism: a missing seed or namespace is picked here, the run's only
  // unseeded values, and both print first so any run can be replayed.
  const seed = flags.seed ?? randomInt(0, maxSeed + 1);
  const namespace = flags.namespace ?? randomBytes(4).toString('hex');
  process.stdout.write(`sim seed=${seed} namespace=${namespace}\n`);

  const history = sampleOnce(ledgerHistory({ namespace }), seed);
  const arranged = arrangeEvents(history, { seed, duplicates, shuffle });
  const projection = projectLedger(
    history.emails.map(({ emailId }) => emailId),
    arranged.events,
  );

  process.stdout.write(
    `history emails=${history.emails.length} events=${arranged.generated} duplicates=${arranged.repeats} shuffled=${shuffle}\n`,
  );
  // `Date` fields print as ISO timestamps through `toJSON`.
  process.stdout.write(`${JSON.stringify(projection, null, 2)}\n`);
  return 0;
}

// `exitCode`, not `process.exit()`, so a large stdout write drains before the process ends.
process.exitCode = main(process.argv.slice(2));
