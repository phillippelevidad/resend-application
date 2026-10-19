import { randomBytes, randomInt } from 'node:crypto';
import {
  createApiGatewayV2Client,
  createCloudFormationClient,
  createCloudWatchClient,
  createLambdaClient,
  createSecretsManagerClient,
  createSqsClient,
} from '@ledger/aws';
import { type LedgerHistory, ledgerHistory } from '@ledger/core/testing';
import { classifyDatabaseError, createDatabase, type Executor } from '@ledger/db';
import { createLogger, errorFields } from '@ledger/shared';
import { type ArrangedEvent, arrangeEvents } from './arrange-events.ts';
import { asStoredEvent } from './as-stored-event.ts';
import {
  type AwsKnob,
  awsKnobOf,
  awsRunGuardReaders,
  guardAwsRun,
  offlineAwsKnobLine,
} from './aws-run-guard.ts';
import { burstRun, burstRunDeps } from './burst-run.ts';
import { runDbOutage } from './db-outage-run.ts';
import { invariant4 } from './invariants/invariant-4.ts';
import { liveRun } from './live-run.ts';
import { type PoisonPick, poisonHistory, runPoison } from './poison-run.ts';
import { projectLedger } from './project-ledger.ts';
import { type BurstFlag, maxSeed, readSimFlags, type SimFlags } from './read-sim-flags.ts';
import { sampleOnce } from './sample-once.ts';
import { readSimConfig, type SimConfig } from './sim.config.ts';

// `pnpm sim` (D16, D37): a seeded history, its duplicates and shuffle, and the projection it folds
// to, printed masks only. Offline that is the whole run. Live (`LEDGER_URL` set and non-empty), the
// arranged events are then sent signed and the ledger is checked against the ground truth.
// `--burst`, `--chaos db-outage` and `--poison` are AWS runs against the owner's deployment (D23,
// D25, D27), each guarded before it sends or changes anything.

const out = (line: string): void => {
  process.stdout.write(`${line}\n`);
};
const err = (line: string): void => {
  process.stderr.write(`${line}\n`);
};

type LiveConfig = Extract<SimConfig, { mode: 'live' }>;

// What the live half runs: a burst generates its own history once its guard clears (D25); every
// other run sends the history sampled and arranged in `main`.
type LiveRunPlan =
  | { kind: 'burst'; seed: number; namespace: string; burst: BurstFlag; shuffle: boolean }
  | {
      kind: 'events';
      knob: Exclude<AwsKnob, '--burst'> | undefined;
      namespace: string;
      history: LedgerHistory;
      events: readonly ArrangedEvent[];
      pick: PoisonPick | undefined;
    };

// The clients an AWS run reads and changes the deployment through, built once with `@ledger/aws`'s
// factories (slice 2, D26). Region and credentials come from the environment (`AWS_PROFILE`,
// `AWS_REGION`), as the `aws:*` scripts' clients do. Constructing one makes no call.
function awsClients() {
  return {
    cloudFormation: createCloudFormationClient(),
    lambda: createLambdaClient(),
    apiGateway: createApiGatewayV2Client(),
    sqs: createSqsClient(),
    cloudWatch: createCloudWatchClient(),
    secretsManager: createSecretsManagerClient(),
  };
}

// The run the plan names, over the run's one database connection.
function runLive(db: Executor, config: LiveConfig, plan: LiveRunPlan): Promise<number> {
  const live = {
    ingestUrl: config.ingestUrl,
    simulatorSecret: config.simulatorSecret,
    out,
    err,
  };
  if (plan.kind === 'burst') {
    return burstRun(
      { seed: plan.seed, namespace: plan.namespace, burst: plan.burst, shuffle: plan.shuffle },
      burstRunDeps({
        ...live,
        clients: awsClients(),
        db,
        ledgerUrl: config.ledgerUrl,
        addressHashKey: config.addressHashKey,
      }),
    );
  }
  if (plan.knob === undefined) {
    return liveRun({
      ...live,
      db,
      addressHashKey: config.addressHashKey,
      history: plan.history,
      events: plan.events,
    });
  }
  const clients = awsClients();
  const guard = () => guardAwsRun(config.ledgerUrl, awsRunGuardReaders(clients));
  if (plan.pick !== undefined) {
    // D27 step 3: `DATABASE_URL` here is the owner's pooled URL, which the fault needs.
    return runPoison({
      ...live,
      guard,
      invariant4,
      clients,
      db,
      pick: plan.pick,
      events: plan.events,
    });
  }
  return runDbOutage({
    ...live,
    namespace: plan.namespace,
    guard,
    invariant4,
    clients,
    db,
    addressHashKey: config.addressHashKey,
    history: plan.history,
    events: plan.events,
  });
}

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
  // D23: an AWS knob without `LEDGER_URL` is a configuration error, before any output or network.
  const knob = awsKnobOf(flags);
  if (knob !== undefined && config.mode === 'offline') {
    err(offlineAwsKnobLine(knob));
    return 2;
  }
  const { duplicates, shuffle } = flags;
  // simulator.md → Seed and determinism: a missing seed or namespace is picked here, the run's only
  // unseeded values, and both print first so any run can be replayed.
  const seed = flags.seed ?? randomInt(0, maxSeed + 1);
  const namespace = flags.namespace ?? randomBytes(4).toString('hex');
  out(`sim seed=${seed} namespace=${namespace}`);

  let plan: LiveRunPlan;
  if (flags.burst !== undefined) {
    // D25: the burst samples nothing and prints no projection here; `burstRun` prints its history
    // line once the guard clears. Only live reaches this (the offline check above).
    plan = { kind: 'burst', seed, namespace, burst: flags.burst, shuffle };
  } else {
    // D38: every address carries the run's label, and the history holds the walk probe, in both
    // modes.
    const sampled = sampleOnce(ledgerHistory({ namespace, labelEveryAddress: true }), seed);
    // D27 step 2: the poisoned ids are marked before anything is arranged, so the ground truth, the
    // send and invariant 4 all carry them.
    const pick =
      flags.poison === undefined
        ? undefined
        : poisonHistory(sampled, { seed, namespace, count: flags.poison });
    const history = pick?.history ?? sampled;
    const arranged = arrangeEvents(history, { seed, duplicates, shuffle });
    // D37: live, recipients are keyed as the ledger keys them, so the printed order follows the
    // keyed hashes. The hashes themselves are never printed (`projectLedger` drops every recipient
    // key).
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
    plan = {
      kind: 'events',
      knob: knob === '--burst' ? undefined : knob,
      namespace,
      history,
      events: arranged.events,
      pick,
    };
  }
  if (config.mode === 'offline') {
    return 0;
  }

  // ADR-005: one connection. Pool errors log to stderr, so stdout stays the run's replayable output.
  const logger = createLogger({ functionName: 'sim', stream: process.stderr });
  const { db, pool } = createDatabase({ url: config.databaseUrl, max: 1, logger });
  try {
    return await runLive(db, config, plan);
  } catch (error) {
    // A constant line: a driver or SDK error's text can quote the URL, an ARN or a row
    // (pp-general → errors).
    if (classifyDatabaseError(error) !== undefined) {
      err(
        knob === undefined
          ? 'sim: Postgres is unreachable at DATABASE_URL; start it with pnpm db:up'
          : 'sim: Postgres is unreachable at DATABASE_URL; load .env.deployed.local',
      );
    } else {
      err(`sim: the ${knob ?? 'live'} run failed (${errorFields(error).error_name})`);
    }
    return 1;
  } finally {
    await pool.end();
  }
}

// `exitCode`, not `process.exit()`, so a large stdout write drains before the process ends.
process.exitCode = await main(process.argv.slice(2));
