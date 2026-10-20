import { setTimeout as sleepFor } from 'node:timers/promises';
import {
  API_FUNCTION_NAME,
  alarmControl,
  appOutputKeys,
  type createCloudWatchClient,
  type createLambdaClient,
  type createSecretsManagerClient,
  type createSqsClient,
  LambdaEventSourceControlAdapter,
  QUEUE_AGE_ALARM_NAME,
  RECONCILER_FUNCTION_NAME,
  recycleFunction,
  SecretsManagerSecretReaderAdapter,
  writeSecretIfChanged,
} from '@ledger/aws';
import type { EventSourceState } from '@ledger/core';
import type { LedgerHistory } from '@ledger/core/testing';
import type { Executor } from '@ledger/db';
import { type DlqPort, errorFields } from '@ledger/shared';
import type { ArrangedEvent } from './arrange-events.ts';
import {
  type AwsRunGuardResult,
  type AwsRunTarget,
  deployedDlq,
  deployedDlqDepth,
} from './aws-run-guard.ts';
import { generatedSvixIds, invariant1 } from './invariants/invariant-1.ts';
import { invariant2 } from './invariants/invariant-2.ts';
import {
  notListening,
  notSettledLine,
  type SendResult,
  type SettleResult,
  sendSigned,
  settle,
} from './live-run.ts';
import {
  type RunTime,
  type WaitBound,
  waitUntil,
  wholeMinutes,
  wholeSeconds,
} from './wait-until.ts';

// D27 `--chaos db-outage`: repoint the deployed database secret at a host that never resolves,
// recycle the worker, the read API and the reconciler so they read it, send the history, and prove
// ADR-015: ingest still answers `200` (ADR-001), the worker pauses its own event source, and nothing
// reaches the DLQ while the queue ages into its alarm. Then restore, in `finally`, and check after the resume that
// nothing was lost (invariants 1, 2 and 4). Ids, counts and durations only on any line (D28): the
// secret's value lives in memory here and is never printed or written to disk.

// RFC 2606 reserves `.invalid`, so every connect fails `ENOTFOUND` under a pg origin, which the
// classifier counts as connection-class (D27 step 2).
export const OUTAGE_HOST = 'ledger-sim-db-outage.invalid';

// D27 steps 5, 6 and 8: each wait's bound, and how often it reads.
export const PAUSE_BOUND: WaitBound = { boundMs: 10 * 60_000, intervalMs: 10_000 };
export const QUEUE_AGE_BOUND: WaitBound = { boundMs: 45 * 60_000, intervalMs: 30_000 };
export const ENABLED_BOUND: WaitBound = { boundMs: 65 * 60_000, intervalMs: 30_000 };

// Every function that reads `ledger/database` once per container and keeps its pool: the worker
// and the read API (slice 3), the reconciler (slice 4, `apps/reconciler/src/main.ts`).
export const RECYCLED_FUNCTIONS = ['worker', 'api', 'reconciler'] as const;
export type RecycledFunction = (typeof RECYCLED_FUNCTIONS)[number];

export type InvariantOutcome = { readonly pass: boolean; readonly line: string };

// Every step the run takes, injected, so its unit test runs over fakes and a fake clock.
export type DbOutageSteps = RunTime & {
  // D23's guard: the whole stderr line of a refusal, or `undefined` to proceed.
  guard: () => Promise<string | undefined>;
  eventSourceState: () => Promise<EventSourceState>;
  readDatabaseSecret: () => Promise<string>;
  writeDatabaseSecret: (value: string) => Promise<void>;
  recycle: (fn: RecycledFunction, description: string) => Promise<void>;
  send: () => Promise<SendResult>;
  // `LedgerApp-queue-age`'s state, `null` when the alarm is absent.
  queueAgeAlarmState: () => Promise<string | null>;
  // Visible plus in flight; a read that receives nothing, so no dead message's count moves.
  dlqDepth: () => Promise<number>;
  settle: () => Promise<SettleResult>;
  invariant1: () => Promise<InvariantOutcome>;
  invariant2: () => Promise<InvariantOutcome>;
  // Nothing poisoned: passes only on an empty DLQ (D24).
  invariant4: () => Promise<InvariantOutcome>;
  out: (line: string) => void;
  err: (line: string) => void;
};

export type DbOutageRunInput = DbOutageSteps & { namespace: string };

// `a`, `a and b`, `a, b and c`.
const listed = (functions: readonly RecycledFunction[]): string =>
  functions.length < 2
    ? functions.join('')
    : `${functions.slice(0, -1).join(', ')} and ${functions.at(-1)}`;
const repointedLine = `chaos db-outage: database repointed, ${listed(RECYCLED_FUNCTIONS)} recycled`;
const restoredLine = `chaos db-outage: database restored, ${listed(RECYCLED_FUNCTIONS)} recycled`;
const notRestoredLine =
  'sim: the database secret was not restored; run pnpm aws:deploy, which rewrites it';
const notRecycledLine = (functions: readonly RecycledFunction[]): string =>
  `sim: the database secret is restored, but recycling the ${listed(functions)} failed; its containers that read the outage host keep it until recycled`;
const resumeLine = 'resume: pnpm -s ledger worker resume, or wait for the hourly resume';
const alreadyRepointedLine = `sim: the database secret already points at ${OUTAGE_HOST} (a crashed run?); run pnpm aws:deploy, which rewrites it`;
const noPooledUrlLine = 'sim: the database secret holds no Postgres pooledUrl';
const alarmAlreadyLine = `sim: ${QUEUE_AGE_ALARM_NAME} already reads ALARM; wait for it to return to OK, then rerun`;

// A constant line: an SDK or driver error's text can quote an ARN, a URL or a row (pp-general → errors).
const failedLine = (error: unknown): string =>
  `sim: the db-outage run failed (${errorFields(error).error_name})`;

// The secret as the deploy command writes it (`{ pooledUrl, addressHashKey, tokenTagKey }`), with
// its `pooledUrl` parsed, or `undefined` for any other shape.
function parseSecret(value: string): { fields: Record<string, unknown>; url: URL } | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return undefined;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return undefined;
  const fields = parsed as Record<string, unknown>;
  const { pooledUrl } = fields;
  if (
    typeof pooledUrl !== 'string' ||
    !pooledUrl.startsWith('postgres') ||
    !URL.canParse(pooledUrl)
  ) {
    return undefined;
  }
  return { fields, url: new URL(pooledUrl) };
}

// D27 step 2: the same JSON with only `pooledUrl`'s host replaced; port, user, password, database and
// query are unchanged, and every other field is kept as it was. `undefined` when the value is not a
// secret this run can repoint.
export function repointDatabaseSecret(value: string): string | undefined {
  const secret = parseSecret(value);
  if (secret === undefined) return undefined;
  secret.url.hostname = OUTAGE_HOST;
  return JSON.stringify({ ...secret.fields, pooledUrl: secret.url.toString() });
}

// D27 step 7: whether the stored secret still holds this run's fault, so a restore never overwrites a
// value someone else (a deploy) wrote in the meantime.
export function holdsOutageHost(value: string): boolean {
  return parseSecret(value)?.url.hostname === OUTAGE_HOST;
}

// D27 step 7: write the original back if the fault is still there, then recycle every function so
// it reads it. Each step is attempted whatever the others did: the worker, the read API and the
// reconciler read the secret once per container (`apps/worker/src/main.ts`, `apps/api/src/main.ts`,
// `apps/reconciler/src/main.ts`), so a function left unrecycled keeps the outage host even after the
// secret is back (a reconciler that cold-started on an hourly tick during the outage would fail every
// later run, and `LedgerApp-reconcile-gap` would fire), and a deploy that finds the secret unchanged
// recycles nothing.
async function restore(run: DbOutageRunInput, original: string): Promise<boolean> {
  let secretBack = false;
  try {
    if (holdsOutageHost(await run.readDatabaseSecret())) {
      await run.writeDatabaseSecret(original);
    }
    secretBack = true;
  } catch {
    // Reported below, after every recycle was attempted.
  }
  const notRecycled: RecycledFunction[] = [];
  for (const fn of RECYCLED_FUNCTIONS) {
    try {
      await run.recycle(fn, '');
    } catch {
      notRecycled.push(fn);
    }
  }
  if (!secretBack) {
    run.err(notRestoredLine);
    return false;
  }
  if (notRecycled.length > 0) {
    run.err(notRecycledLine(notRecycled));
    return false;
  }
  run.out(restoredLine);
  return true;
}

// D27 steps 4 to 6, with the fault in place. `true` iff every request was accepted, the worker paused
// and the queue aged into its alarm with the DLQ at 0.
async function holdOutage(run: DbOutageRunInput): Promise<boolean> {
  const sent = await run.send();
  if (sent === 'not-listening') {
    run.err(notListening);
    return false;
  }
  // The sim never retries a request, so every `200` it counts came on the first attempt. Ships 5
  // requires all of them: ingest never touches the database (ADR-001).
  run.out(
    `sent requests=${sent.requests} accepted=${sent.accepted} first_attempt_200=${sent.accepted}`,
  );
  const allAccepted = sent.accepted === sent.requests;

  // Both durations count from the end of the send, when the queue holds the history.
  // A read that throws before either bound is "not yet" (`waitUntil`), so a transient AWS error never
  // sends `dbOutageRun` to its restore early.
  const sentAt = run.clock.now().getTime();
  const paused = await waitUntil(run, PAUSE_BOUND, async () => {
    return (await run.eventSourceState()) === 'paused';
  });
  if (paused === undefined) {
    // AWS-U15: a recycle that did not reach new execution environments leaves the worker on the old
    // secret, so it never pauses.
    run.err(`sim: the worker did not pause within ${wholeMinutes(PAUSE_BOUND.boundMs)}m (AWS-U15)`);
    return false;
  }
  run.out(`worker paused after ${wholeSeconds(paused)}s`);

  let depth = 0;
  const held = await waitUntil(run, QUEUE_AGE_BOUND, async () => {
    depth = await run.dlqDepth();
    if (depth > 0) return true;
    return (await run.queueAgeAlarmState()) === 'ALARM';
  });
  if (depth > 0) {
    // ADR-015's failure: a message drained to the DLQ during the outage instead of waiting.
    run.err(`sim: the DLQ holds ${depth} messages during the outage; the pause did not hold`);
    return false;
  }
  if (held === undefined) {
    run.err(
      `sim: ${QUEUE_AGE_ALARM_NAME} did not read ALARM within ${wholeMinutes(QUEUE_AGE_BOUND.boundMs)}m`,
    );
    return false;
  }
  run.out(
    `queue-age alarm ALARM after ${wholeMinutes(run.clock.now().getTime() - sentAt)}m; dlq depth 0`,
  );
  return allAccepted;
}

// D27 step 8: after the restore, wait for the resume (the hourly one needs no human), settle, and
// check that the outage lost nothing.
async function drain(run: DbOutageRunInput): Promise<boolean> {
  // A read that throws before the bound is "not yet" (`waitUntil`): a throw here would skip the drain
  // and its invariants.
  const enabled = await waitUntil(run, ENABLED_BOUND, async () => {
    return (await run.eventSourceState()) === 'enabled';
  });
  if (enabled === undefined) {
    run.err(
      `sim: the worker's event source was not enabled within ${wholeMinutes(ENABLED_BOUND.boundMs)}m; run pnpm -s ledger worker resume`,
    );
    return false;
  }
  run.out(`worker enabled after ${wholeMinutes(enabled)}m`);

  const settled = await run.settle();
  if (!settled.settled) {
    run.err(notSettledLine(settled));
    return false;
  }
  run.out(
    `settled stored=${settled.present}/${settled.expected} after ${wholeSeconds(settled.elapsedMs)}s`,
  );
  const first = await run.invariant1();
  const second = await run.invariant2();
  const fourth = await run.invariant4();
  run.out(first.line);
  run.out(second.line);
  // Report honesty: an invariant this run cannot check is named as not checked, never as passed.
  run.out('invariant 3 not checked (slice 6)');
  run.out(fourth.line);
  return first.pass && second.pass && fourth.pass;
}

// D28: `0` iff every request was accepted, the outage held as ADR-015 says, the restore landed and
// every checked invariant passed; `1` otherwise or on a refusal.
export async function dbOutageRun(run: DbOutageRunInput): Promise<number> {
  try {
    const refusal = await run.guard();
    if (refusal !== undefined) {
      run.err(refusal);
      return 1;
    }
    // D27 step 1: a paused (or changing) event source would make the pause this run proves vacuous.
    const state = await run.eventSourceState();
    if (state !== 'enabled') {
      run.err(
        `sim: the worker's event source reads ${state}; resume it with pnpm -s ledger worker resume first`,
      );
      return 1;
    }
    // D27 step 6 holds until the alarm reads `ALARM`; one that already does would end the hold at 0m
    // without the outage having aged the queue, a false pass. `OK`, `INSUFFICIENT_DATA` and an absent
    // alarm proceed.
    if ((await run.queueAgeAlarmState()) === 'ALARM') {
      run.err(alarmAlreadyLine);
      return 1;
    }
    const original = await run.readDatabaseSecret();
    if (holdsOutageHost(original)) {
      // A crashed run's fault: writing it back as "the original" would keep the stack down.
      run.err(alreadyRepointedLine);
      return 1;
    }
    const repointed = repointDatabaseSecret(original);
    if (repointed === undefined) {
      run.err(noPooledUrlLine);
      return 1;
    }

    let held = false;
    let restored = false;
    try {
      await run.writeDatabaseSecret(repointed);
      for (const fn of RECYCLED_FUNCTIONS) {
        await run.recycle(fn, `ledger-sim db-outage ${run.namespace}`);
      }
      run.out(repointedLine);
      held = await holdOutage(run);
    } catch (error) {
      run.err(failedLine(error));
    } finally {
      restored = await restore(run, original);
    }
    if (!restored) return 1;
    run.out(resumeLine);
    if (!held) return 1;
    return (await drain(run)) ? 0 : 1;
  } catch (error) {
    run.err(failedLine(error));
    return 1;
  }
}

// The clients `main.ts` builds once with `@ledger/aws`'s factories.
export type DbOutageClients = {
  readonly lambda: ReturnType<typeof createLambdaClient>;
  readonly secretsManager: ReturnType<typeof createSecretsManagerClient>;
  readonly cloudWatch: ReturnType<typeof createCloudWatchClient>;
  readonly sqs: ReturnType<typeof createSqsClient>;
};

export type DbOutageRunDeps = {
  namespace: string;
  // D23's guard, bound to `LEDGER_URL` and its real readers (`guardAwsRun`).
  guard: () => Promise<AwsRunGuardResult>;
  // D24's checker (`invariant4` from `invariants/invariant-4.ts`).
  invariant4: (dlq: DlqPort, poisoned: ReadonlySet<string>) => Promise<InvariantOutcome>;
  clients: DbOutageClients;
  db: Executor;
  ingestUrl: string;
  simulatorSecret: string;
  addressHashKey: Uint8Array;
  // The ground truth, and what is sent (the run's arranged events).
  history: LedgerHistory;
  events: readonly ArrangedEvent[];
  out: (line: string) => void;
  err: (line: string) => void;
};

// The outputs this run reads beyond the guard's, each refused by name when the stack lacks it.
const neededOutputs = [appOutputKeys.databaseSecretArn, appOutputKeys.workerFunctionName] as const;

// The real steps. The guard runs first and hands over the stack's outputs, so every AWS step is bound
// to them only once it has cleared.
export function composeDbOutageRun(deps: DbOutageRunDeps): DbOutageRunInput {
  let cleared: AwsRunTarget | undefined;
  let eventSource: LambdaEventSourceControlAdapter | undefined;
  const target = (): AwsRunTarget => {
    if (cleared === undefined) throw new Error('the AWS-run guard has not cleared');
    return cleared;
  };
  const output = (key: (typeof neededOutputs)[number]): string => {
    const value = target().app[key];
    if (value === undefined) throw new Error('a needed stack output is missing');
    return value;
  };
  const functionName = (fn: RecycledFunction): string => {
    if (fn === 'worker') return output(appOutputKeys.workerFunctionName);
    return fn === 'api' ? API_FUNCTION_NAME : RECONCILER_FUNCTION_NAME;
  };
  const secrets = new SecretsManagerSecretReaderAdapter({ client: deps.clients.secretsManager });
  const generated = generatedSvixIds(deps.history);

  return {
    namespace: deps.namespace,
    clock: { now: () => new Date() },
    sleep: (ms) => sleepFor(ms),
    guard: async () => {
      const result = await deps.guard();
      if (result.status === 'refused') return result.line;
      const missing = neededOutputs.find((key) => result.target.app[key] === undefined);
      if (missing !== undefined) {
        return `sim: the deployed LedgerApp stack has no ${missing} output; run pnpm aws:deploy`;
      }
      cleared = result.target;
      return undefined;
    },
    eventSourceState: () => {
      eventSource ??= new LambdaEventSourceControlAdapter({
        client: deps.clients.lambda,
        functionName: output(appOutputKeys.workerFunctionName),
      });
      return eventSource.getState();
    },
    readDatabaseSecret: () => secrets.read(output(appOutputKeys.databaseSecretArn)),
    writeDatabaseSecret: async (value) => {
      await writeSecretIfChanged(
        deps.clients.secretsManager,
        output(appOutputKeys.databaseSecretArn),
        value,
      );
    },
    recycle: (fn, description) =>
      recycleFunction(deps.clients.lambda, functionName(fn), description),
    send: () =>
      sendSigned({
        ingestUrl: deps.ingestUrl,
        simulatorSecret: deps.simulatorSecret,
        events: deps.events,
      }),
    queueAgeAlarmState: () => alarmControl.readState(deps.clients.cloudWatch, QUEUE_AGE_ALARM_NAME),
    dlqDepth: () => deployedDlqDepth(deps.clients, target()),
    settle: () => settle(deps.db, generated),
    invariant1: () => invariant1(deps.db, deps.history),
    invariant2: () => invariant2(deps.db, deps.history, deps.addressHashKey),
    invariant4: () => deps.invariant4(deployedDlq(deps.clients.sqs, target()), new Set()),
    out: deps.out,
    err: deps.err,
  };
}

// What `main.ts` calls for `--chaos db-outage` (task 10.7).
export function runDbOutage(deps: DbOutageRunDeps): Promise<number> {
  return dbOutageRun(composeDbOutageRun(deps));
}
