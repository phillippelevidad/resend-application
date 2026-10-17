import { randomBytes, randomInt } from 'node:crypto';
import { ledgerHistory } from '@ledger/core/testing';
import { classifyDatabaseError, createDatabase } from '@ledger/db';
import { createLogger, errorFields } from '@ledger/shared';
import { arrangeEvents } from './arrange-events.ts';
import { asStoredEvent } from './as-stored-event.ts';
import { liveRun } from './live-run.ts';
import { projectLedger } from './project-ledger.ts';
import { maxSeed, readSimFlags, type SimFlags } from './read-sim-flags.ts';
import { sampleOnce } from './sample-once.ts';
import { readSimConfig, type SimConfig } from './sim.config.ts';

// `pnpm sim` (D16, D37): a seeded history, its duplicates and shuffle, and the projection it folds
// to, printed masks only. Offline that is the whole run. Live (`LEDGER_URL` set and non-empty), the
// arranged events are then sent signed to the local process and the ledger is checked against the
// ground truth.

const out = (line: string): void => {
  process.stdout.write(`${line}\n`);
};
const err = (line: string): void => {
  process.stderr.write(`${line}\n`);
};

async function main(args: readonly string[]): Promise<number> {
  let flags: SimFlags;
  let config: SimConfig;
  try {
    flags = readSimFlags(args);
    // The composition root's one read of `process.env` (pp-general → config-and-env.md).
    config = readSimConfig(process.env);
  } catch (error) {
    err(`sim: ${error instanceof Error ? error.message : String(error)}`);
    return 2;
  }
  const { duplicates, shuffle } = flags;
  // simulator.md → Seed and determinism: a missing seed or namespace is picked here, the run's only
  // unseeded values, and both print first so any run can be replayed.
  const seed = flags.seed ?? randomInt(0, maxSeed + 1);
  const namespace = flags.namespace ?? randomBytes(4).toString('hex');
  out(`sim seed=${seed} namespace=${namespace}`);

  // D38: every address carries the run's label, and the history holds the walk probe, in both modes.
  const history = sampleOnce(ledgerHistory({ namespace, labelEveryAddress: true }), seed);
  const arranged = arrangeEvents(history, { seed, duplicates, shuffle });
  // D37: live, recipients are keyed as the ledger keys them, so the printed order follows the keyed
  // hashes. The hashes themselves are never printed (`projectLedger` drops every recipient key).
  const printed =
    config.mode === 'live'
      ? arranged.events.map(({ emailId, event }) => ({
          emailId,
          event: asStoredEvent(event, config.addressHashKey),
        }))
      : arranged.events;
  const projection = projectLedger(
    history.emails.map(({ emailId }) => emailId),
    printed,
  );

  out(
    `history emails=${history.emails.length} events=${arranged.generated} duplicates=${arranged.repeats} shuffled=${shuffle}`,
  );
  // `Date` fields print as ISO timestamps through `toJSON`.
  out(JSON.stringify(projection, null, 2));
  if (config.mode === 'offline') {
    return 0;
  }

  // ADR-005: one connection. Pool errors log to stderr, so stdout stays the run's replayable output.
  const logger = createLogger({ functionName: 'sim', stream: process.stderr });
  const { db, pool } = createDatabase({ url: config.databaseUrl, max: 1, logger });
  try {
    return await liveRun({
      db,
      ingestUrl: config.ingestUrl,
      simulatorSecret: config.simulatorSecret,
      addressHashKey: config.addressHashKey,
      history,
      events: arranged.events,
      out,
      err,
    });
  } catch (error) {
    // A constant line: a driver error's text can quote the URL or a row (pp-general → errors).
    if (classifyDatabaseError(error) !== undefined) {
      err('sim: Postgres is unreachable at DATABASE_URL; start it with pnpm db:up');
    } else {
      err(`sim: the live run failed (${errorFields(error).error_name})`);
    }
    return 1;
  } finally {
    await pool.end();
  }
}

// `exitCode`, not `process.exit()`, so a large stdout write drains before the process ends.
process.exitCode = await main(process.argv.slice(2));
