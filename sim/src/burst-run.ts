import { setTimeout as sleep } from 'node:timers/promises';
import {
  APP_STACK_NAME,
  appOutputKeys,
  BURST_THROTTLE,
  type createCloudWatchClient,
  type DeclaredThrottle,
  type RequestCount,
  raiseDefaultThrottle,
  readAccountSettings,
  readRequestCount,
  restoreDefaultThrottleIf,
  type ThrottleRestore,
  USAGE_TRIP_ALARM_NAME,
} from '@ledger/aws';
import { burstHistory, type LedgerHistory } from '@ledger/core/testing';
import { databaseRepository, type Executor, STORAGE_LIMIT_BYTES } from '@ledger/db';
import { arrangeEvents } from './arrange-events.ts';
import {
  type AwsRunClients,
  type AwsRunGuardResult,
  type AwsRunTarget,
  awsRunGuardReaders,
  deployedDlq,
  guardAwsRun,
} from './aws-run-guard.ts';
import { invariant1 } from './invariants/invariant-1.ts';
import { invariant2 } from './invariants/invariant-2.ts';
import { invariant4 } from './invariants/invariant-4.ts';
import { notSettledLine, type SettleResult, settle } from './live-run.ts';
import { type PacedRequest, type PacedSendResult, sendPaced, sentLine } from './paced-sender.ts';
import type { BurstFlag } from './read-sim-flags.ts';

// D25: `pnpm sim --burst <events>/<seconds>s` against the owner's deployment. Every step that reads
// or changes AWS or Postgres is injected, so the order, the refusals and the `finally` restore are
// unit-tested over fakes; `burstRunDeps` composes the real ones for `main.ts`. Lines hold ids,
// counts, durations and throttle or quota numbers only, never a URL, ARN, secret or address (D28).

// D25 step 2: the default regional quota (AWS-16). A 1,000 rps burst at up to 1 s per cold ingest
// invocation, plus the worker's `MaximumConcurrency` and the read API, needs headroom on that order.
export const BURST_MIN_ACCOUNT_CONCURRENCY = 1000;

// What every invariant checker returns, as far as the run reads it.
export type InvariantCheck = { readonly pass: boolean; readonly line: string };

export type BurstRunDeps = {
  guard: () => Promise<AwsRunGuardResult>;
  // `AccountLimit.ConcurrentExecutions` (AWS-U05's burst half).
  readConcurrencyQuota: () => Promise<number>;
  // The usage trip's metric over its last period, and its threshold.
  readUsageTrip: () => Promise<RequestCount>;
  raiseThrottle: () => Promise<DeclaredThrottle>;
  restoreThrottle: (
    raised: DeclaredThrottle,
    declared: DeclaredThrottle,
  ) => Promise<ThrottleRestore>;
  storageBytes: () => Promise<number>;
  send: (requests: readonly PacedRequest[], seconds: number) => Promise<PacedSendResult>;
  settle: (ids: readonly string[], generatedEvents: number) => Promise<SettleResult>;
  invariant1: (history: LedgerHistory) => Promise<InvariantCheck>;
  invariant2: (history: LedgerHistory) => Promise<InvariantCheck>;
  invariant4: (target: AwsRunTarget, poisoned: ReadonlySet<string>) => Promise<InvariantCheck>;
  out: (line: string) => void;
  err: (line: string) => void;
};

export type BurstRunInput = {
  seed: number;
  namespace: string;
  burst: BurstFlag;
  shuffle: boolean;
};

// The declared `$default` throttle the restore puts back: the stack's own outputs (slice 2, D27).
function declaredThrottleOf(target: AwsRunTarget): DeclaredThrottle | undefined {
  const rateLimit = Number(target.app[appOutputKeys.throttleRateLimit]);
  const burstLimit = Number(target.app[appOutputKeys.throttleBurstLimit]);
  return Number.isFinite(rateLimit) && Number.isFinite(burstLimit)
    ? { rateLimit, burstLimit }
    : undefined;
}

// D25 steps 4 and 8: the `finally`. It never throws, so it never hides the error a failed send or
// raise is propagating; `false` when the throttle may still be raised. After a failed raise, a stage
// that does not read the raised value means the raise never took effect, so nothing is said.
async function restoreThrottle(
  deps: BurstRunDeps,
  raised: DeclaredThrottle,
  declared: DeclaredThrottle,
  raiseFailed = false,
): Promise<boolean> {
  try {
    const restore = await deps.restoreThrottle(raised, declared);
    if (restore.status === 'restored') {
      deps.out(
        `throttle restored rate=${restore.throttle.rateLimit} burst=${restore.throttle.burstLimit}`,
      );
    } else if (!raiseFailed) {
      deps.out(
        `throttle left at ${restore.throttle.rateLimit ?? 'none'}/${restore.throttle.burstLimit ?? 'none'}: changed during the burst (a trip?)`,
      );
    }
    return true;
  } catch {
    // `pnpm aws:rearm` restores the declared throttle whatever the stage reads (slice 2, D35).
    deps.err('sim: the throttle was not restored; run pnpm aws:rearm, which restores it');
    return false;
  }
}

// D25 step 9: what the burst cost in storage, and how many more fit under the plan's limit.
function storageLine(before: number, after: number, events: number): string {
  const growth = after - before;
  const burstsLeft =
    growth > 0 ? String(Math.floor((STORAGE_LIMIT_BYTES - after) / growth)) : 'n/a';
  return `storage before=${before} after=${after} bytes_per_event=${Math.round(growth / events)} bursts_left=${burstsLeft}`;
}

// D25's order. The history is generated right after the guard (step 5 moved up: it is pure and
// seeded, so where it runs changes nothing on AWS) so its line prints where Surfaces puts it, before
// the preflight line. Exit `0` iff every request was accepted, the ledger settled, invariants 1, 2
// and 4 passed and the throttle was restored or left as a trip set it; `1` otherwise and on a
// refusal. An unexpected error propagates after the `finally`, and `main.ts` exits `1` on it.
export async function burstRun(input: BurstRunInput, deps: BurstRunDeps): Promise<number> {
  const { out, err } = deps;
  const { events, seconds } = input.burst;

  // 1. D23's guard.
  const guard = await deps.guard();
  if (guard.status === 'refused') {
    err(guard.line);
    return 1;
  }
  const declared = declaredThrottleOf(guard.target);
  if (declared === undefined) {
    err('sim: the deployed LedgerApp stack has no throttle outputs; run pnpm aws:deploy');
    return 1;
  }

  // 5. Generate: broadcast-shaped, one distinct recipient per email, exactly `events` events.
  const history = burstHistory({ seed: input.seed, namespace: input.namespace, events });
  const arranged = arrangeEvents(history, {
    seed: input.seed,
    duplicates: 0,
    shuffle: input.shuffle,
  });
  out(
    `history emails=${history.emails.length} events=${arranged.generated} duplicates=${arranged.repeats} shuffled=${input.shuffle}`,
  );
  out('projection not printed (--burst)');

  // 2. Quota preflight.
  const quota = await deps.readConcurrencyQuota();
  if (quota < BURST_MIN_ACCOUNT_CONCURRENCY) {
    err(
      `sim: the account's Lambda concurrency quota is ${quota}; the burst needs at least ${BURST_MIN_ACCOUNT_CONCURRENCY} (AWS-U05): request an increase in Service Quotas`,
    );
    return 1;
  }
  // 3. Usage-trip headroom, from the deployed alarm itself.
  const usage = await deps.readUsageTrip();
  if (usage.recent + events > usage.threshold) {
    err(
      `sim: ${usage.recent} requests in the last ${Math.round(usage.periodSeconds / 60)} minutes plus the burst would trip ${USAGE_TRIP_ALARM_NAME}; wait and retry`,
    );
    return 1;
  }
  out(
    `preflight concurrency=${quota} recent_requests=${usage.recent} usage_trip_threshold=${usage.threshold}`,
  );

  // 4. Raise the throttle; 8. `finally` restores it only if it still reads the raised value. A raise
  // whose call failed may still have taken effect (an update applied, then a timeout), so that path
  // restores too, against the value the raise sets, before the error propagates.
  let raised: DeclaredThrottle;
  try {
    raised = await deps.raiseThrottle();
  } catch (error) {
    await restoreThrottle(deps, BURST_THROTTLE, declared, true);
    throw error;
  }
  out(`throttle raised rate=${raised.rateLimit} burst=${raised.burstLimit}`);
  let before: number;
  let sent: PacedSendResult;
  let restored: boolean;
  try {
    // 6. Storage before; 7. send paced.
    before = await deps.storageBytes();
    sent = await deps.send(
      arranged.events.map(({ event }) => ({
        svixId: event.svixId,
        body: JSON.stringify(event.payload),
      })),
      seconds,
    );
    out(sentLine(sent));
  } finally {
    restored = await restoreThrottle(deps, raised, declared);
  }

  // 9. Settle over what ingest accepted (a request not accepted is never stored, and invariant 1
  // names it), with the bound of every generated event (D22); storage after; the invariants.
  const settled = await deps.settle(sent.acceptedIds, arranged.generated);
  if (!settled.settled) {
    err(notSettledLine(settled));
    return 1;
  }
  out(
    `settled stored=${settled.present}/${settled.expected} after ${Math.round(settled.elapsedMs / 1000)}s`,
  );
  const after = await deps.storageBytes();
  out(storageLine(before, after, arranged.generated));

  const first = await deps.invariant1(history);
  const second = await deps.invariant2(history);
  out(first.line);
  out(second.line);
  // Report honesty: an invariant this run cannot check is named as not checked, never as passed.
  out('invariant 3 not checked (slice 6)');
  // Nothing is poisoned in a burst: invariant 4 passes only on an empty DLQ (D24).
  const fourth = await deps.invariant4(guard.target, new Set());
  out(fourth.line);

  const pass =
    sent.accepted === sent.requests && first.pass && second.pass && fourth.pass && restored;
  return pass ? 0 : 1;
}

// What `main.ts` hands `burstRunDeps`: the clients it built once with `@ledger/aws`'s factories,
// the run's one database connection, and the live config it read from `process.env`.
export type BurstRunWiring = {
  clients: AwsRunClients & { readonly cloudWatch: ReturnType<typeof createCloudWatchClient> };
  db: Executor;
  // `LEDGER_URL` as given, which the guard compares with `ApiUrl`.
  ledgerUrl: string;
  ingestUrl: string;
  simulatorSecret: string;
  addressHashKey: Uint8Array;
  out: (line: string) => void;
  err: (line: string) => void;
};

// The burst's real steps. The paced sender reads the wall clock: the `svix-timestamp` must be within
// RS-02's tolerance, and the latencies are the client's own.
export function burstRunDeps(wiring: BurstRunWiring): BurstRunDeps {
  const { clients, db } = wiring;
  const stage = { appStackName: APP_STACK_NAME };
  return {
    guard: () => guardAwsRun(wiring.ledgerUrl, awsRunGuardReaders(clients)),
    readConcurrencyQuota: async () =>
      (await readAccountSettings(clients.lambda)).concurrentExecutions,
    readUsageTrip: () => readRequestCount(clients.cloudWatch, USAGE_TRIP_ALARM_NAME),
    raiseThrottle: () => raiseDefaultThrottle(clients.apiGateway, stage),
    restoreThrottle: (raised, declared) =>
      restoreDefaultThrottleIf(clients.apiGateway, stage, raised, declared),
    storageBytes: () => databaseRepository.storageBytes(db),
    send: (requests, seconds) =>
      sendPaced(
        {
          ingestUrl: wiring.ingestUrl,
          simulatorSecret: wiring.simulatorSecret,
          requests,
          seconds,
        },
        { fetch, clock: { now: () => new Date() }, sleep: (ms) => sleep(ms) },
      ),
    settle: (ids, generatedEvents) => settle(db, ids, generatedEvents),
    invariant1: (history) => invariant1(db, history),
    invariant2: (history) => invariant2(db, history, wiring.addressHashKey),
    invariant4: (target, poisoned) => invariant4(deployedDlq(clients.sqs, target), poisoned),
    out: wiring.out,
    err: wiring.err,
  };
}
