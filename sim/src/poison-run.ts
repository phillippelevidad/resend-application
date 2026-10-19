import { setTimeout as sleepFor } from 'node:timers/promises';
import {
  type createCloudWatchClient,
  type createSqsClient,
  SqsQueueAttributesAdapter,
} from '@ledger/aws';
import type { LedgerHistory } from '@ledger/core/testing';
import type { Executor } from '@ledger/db';
import { addPoisonFault, POISON_ID_PREFIX, removePoisonFault } from '@ledger/db/testing';
import { type DlqPort, errorFields } from '@ledger/shared';
import fc from 'fast-check';
import type { ArrangedEvent } from './arrange-events.ts';
import { type AwsRunGuardResult, type AwsRunTarget, deployedDlq } from './aws-run-guard.ts';
import type { InvariantOutcome } from './db-outage-run.ts';
import { deriveSeed } from './derive-seed.ts';
import { generatedSvixIds } from './invariants/invariant-1.ts';
import {
  notListening,
  notSettledLine,
  type SendResult,
  type SettleResult,
  sendSigned,
  settle,
} from './live-run.ts';
import { sampleOnce } from './sample-once.ts';
import { type RunTime, type WaitBound, waitUntil, wholeMinutes } from './wait-until.ts';

// D27 `--poison <n>`: a real unexpected error that enters through ingest. `n` seeded events carry a
// marked `svix_id` from the generated history on, a transient CHECK on `webhook_events` refuses
// exactly those inserts with `23514` (not connection-class, so ADR-008 per message), and the run
// proves the others commit while the poisoned ones reach the DLQ (invariant 4). Ids and counts only
// on any line (D28).

// D27 step 4: SQS moves a message on its sixth receive, after five 360 s visibility timeouts (AWS-08,
// AWS-09), about 30 min; the bound leaves room.
export const DLQ_BOUND: WaitBound = { boundMs: 40 * 60_000, intervalMs: 30_000 };

// The draws after the history take their own seeds (`deriveSeed`); 1 and 2 are the repeats and the
// shuffle (`arrange-events.ts`).
const poisonDraw = 3;

export type PoisonPick = {
  // The history with the poisoned events re-id'd, the ground truth the run sends and checks.
  history: LedgerHistory;
  svixIds: string[];
  emailIds: string[];
};

// D27 step 2: pick `count` events, seeded, never from the walk probe email (a walker looks it up, so
// it must commit), and give each the marked id `simpoison_<namespace>_<k>`, `k` from 0 in history
// order. Applied to the generated history before anything is arranged or sent, so the ground truth,
// the send and invariant 4 all carry the marked id. Every other event is the same object as before.
export function poisonHistory(
  history: LedgerHistory,
  options: { seed: number; namespace: string; count: number },
): PoisonPick {
  const probe = `${options.namespace}-probe`;
  const candidates = history.emails
    .filter(({ emailId }) => emailId !== probe)
    .flatMap(({ events }) => events.map(({ svixId }) => svixId));
  const picked = new Set(
    sampleOnce(
      fc.subarray(candidates, { minLength: options.count, maxLength: options.count }),
      deriveSeed(options.seed, poisonDraw),
    ),
  );
  const svixIds: string[] = [];
  const emailIds: string[] = [];
  const emails = history.emails.map((email) => ({
    emailId: email.emailId,
    events: email.events.map((event) => {
      if (!picked.has(event.svixId)) return event;
      const svixId = `${POISON_ID_PREFIX}${options.namespace}_${svixIds.length}`;
      svixIds.push(svixId);
      if (!emailIds.includes(email.emailId)) emailIds.push(email.emailId);
      return { ...event, svixId };
    }),
  }));
  return { history: { emails }, svixIds, emailIds };
}

// Every step the run takes, injected, so its unit test runs over fakes and a fake clock.
export type PoisonSteps = RunTime & {
  // D23's guard: the whole stderr line of a refusal, or `undefined` to proceed.
  guard: () => Promise<string | undefined>;
  // `@ledger/db/testing`'s two statements, through `DATABASE_URL` (the table's owner).
  removeFault: () => Promise<void>;
  addFault: () => Promise<void>;
  send: () => Promise<SendResult>;
  // D22: settle over `ids` with the bound of `generatedEvents`.
  settle: (ids: readonly string[], generatedEvents: number) => Promise<SettleResult>;
  // Visible plus in flight; a read that receives nothing.
  dlqDepth: () => Promise<number>;
  invariant4: (poisoned: ReadonlySet<string>) => Promise<InvariantOutcome>;
  out: (line: string) => void;
  err: (line: string) => void;
};

export type PoisonRunInput = PoisonSteps & { pick: PoisonPick };

const notOwnerLine =
  "sim: --poison needs DATABASE_URL to own webhook_events (the owner's pooled URL, not the runtime role's)";
const fixedLine =
  'poison fixed; next: pnpm -s ledger dlq inspect, then pnpm -s ledger dlq redrive; the depth returns to 0 in pnpm -s ledger health';
const notFixedLine =
  'sim: the poison fault was not removed; drop the constraint ledger_sim_poison on webhook_events as its owner';

// A constant line: a driver or SDK error's text can quote a URL, an ARN or a row (pp-general → errors).
const failedLine = (error: unknown): string =>
  `sim: the poison run failed (${errorFields(error).error_name})`;

// D27 step 6, also on any failure once the fault may exist.
async function fix(run: PoisonRunInput): Promise<boolean> {
  try {
    await run.removeFault();
    run.out(fixedLine);
    return true;
  } catch {
    run.err(notFixedLine);
    return false;
  }
}

// D27 steps 4 and 5, with the fault in place. `true` iff every request was accepted, every other
// event is stored, the DLQ reached `n` and invariant 4 passed.
async function poisoned(run: PoisonRunInput): Promise<boolean> {
  const n = run.pick.svixIds.length;
  const sent = await run.send();
  if (sent === 'not-listening') {
    run.err(notListening);
    return false;
  }
  run.out(`sent requests=${sent.requests} accepted=${sent.accepted}`);

  const generated = generatedSvixIds(run.pick.history);
  const marked = new Set(run.pick.svixIds);
  const others = generated.filter((svixId) => !marked.has(svixId));
  // D22: the bound still counts every generated event.
  const settled = await run.settle(others, generated.length);
  if (!settled.settled) {
    run.err(notSettledLine(settled));
    return false;
  }

  let depth = 0;
  const reached = await waitUntil(run, DLQ_BOUND, async () => {
    depth = await run.dlqDepth();
    return depth >= n;
  });
  if (reached === undefined) {
    // Reported, then invariant 4 names what the DLQ does hold.
    run.err(
      `sim: the DLQ holds ${depth} of the ${n} poisoned after ${wholeMinutes(DLQ_BOUND.boundMs)}m`,
    );
  }

  // `svix_id` is the primary key (ADR-004), so a stored id is stored exactly once.
  const othersStored = settled.present === settled.expected;
  run.out(
    `others stored ${settled.present}/${settled.expected} exactly once (${n} poisoned wait in the DLQ)`,
  );
  // D27 step 5: invariants 1 and 2 are over every generated event, and the poisoned ones are not
  // stored yet; a pass over a subset would be one the run did not earn.
  run.out(`invariant 1 not checked (${n} poisoned events wait in the DLQ)`);
  run.out(`invariant 2 not checked (${n} poisoned events wait in the DLQ)`);
  const fourth = await run.invariant4(marked);
  run.out(fourth.line);
  return sent.accepted === sent.requests && othersStored && reached !== undefined && fourth.pass;
}

// D28: `0` iff every request was accepted, the others are all stored (it counts as an invariant),
// invariant 4 passed and the fault was removed; `1` otherwise or on a refusal.
export async function poisonRun(run: PoisonRunInput): Promise<number> {
  try {
    const refusal = await run.guard();
    if (refusal !== undefined) {
      run.err(refusal);
      return 1;
    }
    run.out(
      `poison count=${run.pick.svixIds.length} svix_ids=${run.pick.svixIds.join(',')} email_ids=${run.pick.emailIds.join(',')}`,
    );
    // D27 step 3: a leftover from a crashed run goes first. The owner check rides on it: the
    // runtime role cannot alter the table either way.
    try {
      await run.removeFault();
    } catch (error) {
      run.err(errorFields(error).pg_code === '42501' ? notOwnerLine : failedLine(error));
      return 1;
    }

    let ok = false;
    let fixed = false;
    try {
      await run.addFault();
      ok = await poisoned(run);
    } catch (error) {
      run.err(failedLine(error));
    } finally {
      fixed = await fix(run);
    }
    return ok && fixed ? 0 : 1;
  } catch (error) {
    run.err(failedLine(error));
    return 1;
  }
}

// The clients `main.ts` builds once with `@ledger/aws`'s factories.
export type PoisonClients = {
  readonly cloudWatch: ReturnType<typeof createCloudWatchClient>;
  readonly sqs: ReturnType<typeof createSqsClient>;
};

export type PoisonRunDeps = {
  // D23's guard, bound to `LEDGER_URL` and its real readers (`guardAwsRun`).
  guard: () => Promise<AwsRunGuardResult>;
  // D24's checker (`invariant4` from `invariants/invariant-4.ts`).
  invariant4: (dlq: DlqPort, poisoned: ReadonlySet<string>) => Promise<InvariantOutcome>;
  clients: PoisonClients;
  // Through `DATABASE_URL`: the owner's pooled URL, which the fault needs (D27 step 3).
  db: Executor;
  ingestUrl: string;
  simulatorSecret: string;
  // `poisonHistory`'s result, and the events arranged from its history.
  pick: PoisonPick;
  events: readonly ArrangedEvent[];
  out: (line: string) => void;
  err: (line: string) => void;
};

// The real steps. The guard runs first and hands over the queue URLs.
export function composePoisonRun(deps: PoisonRunDeps): PoisonRunInput {
  let cleared: AwsRunTarget | undefined;
  const target = (): AwsRunTarget => {
    if (cleared === undefined) throw new Error('the AWS-run guard has not cleared');
    return cleared;
  };
  return {
    pick: deps.pick,
    clock: { now: () => new Date() },
    sleep: (ms) => sleepFor(ms),
    guard: async () => {
      const result = await deps.guard();
      if (result.status === 'refused') return result.line;
      cleared = result.target;
      return undefined;
    },
    removeFault: () => removePoisonFault(deps.db),
    addFault: () => addPoisonFault(deps.db),
    send: () =>
      sendSigned({
        ingestUrl: deps.ingestUrl,
        simulatorSecret: deps.simulatorSecret,
        events: deps.events,
      }),
    settle: (ids, generatedEvents) => settle(deps.db, ids, generatedEvents),
    dlqDepth: async () => {
      const snapshot = await new SqsQueueAttributesAdapter({
        sqs: deps.clients.sqs,
        cloudWatch: deps.clients.cloudWatch,
        queueUrl: target().queueUrl,
        dlqUrl: target().dlqUrl,
      }).read();
      return snapshot.dlqVisible + snapshot.dlqInFlight;
    },
    invariant4: (marked) => deps.invariant4(deployedDlq(deps.clients.sqs, target()), marked),
    out: deps.out,
    err: deps.err,
  };
}

// What `main.ts` calls for `--poison <n>` (task 10.7), after `poisonHistory` and `arrangeEvents`.
export function runPoison(deps: PoisonRunDeps): Promise<number> {
  return poisonRun(composePoisonRun(deps));
}
