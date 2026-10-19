import { setTimeout as sleep } from 'node:timers/promises';
import { type LedgerHistory, signWebhook } from '@ledger/core/testing';
import { type Executor, webhookEventsRepository } from '@ledger/db';
import type { ArrangedEvent } from './arrange-events.ts';
import { generatedSvixIds, invariant1 } from './invariants/invariant-1.ts';
import { invariant2 } from './invariants/invariant-2.ts';

// D37: the live half of `pnpm sim`. Send every arranged event signed, wait for the ledger to settle,
// then check invariants 1 and 2 through `packages/db` (ADR-016). Ids and counts only on stdout,
// never an address, a hash, a payload or the URL (simulator.md → Invariant checkers).

export type LiveRunInput = {
  db: Executor;
  ingestUrl: string;
  simulatorSecret: string;
  addressHashKey: Uint8Array;
  // The ground truth: the distinct events.
  history: LedgerHistory;
  // What is sent: the ground truth plus its repeats, in the run's order.
  events: readonly ArrangedEvent[];
  out: (line: string) => void;
  err: (line: string) => void;
};

// A Ledger that accepts the connection but never answers is treated as no Ledger.
const requestTimeoutMs = 10_000;

const notListening =
  'sim: no Ledger answered at LEDGER_URL; start it with pnpm dev:full, or run LEDGER_URL= pnpm sim for an offline run';

type SendResult = { requests: number; accepted: number } | 'not-listening';

// One request at a time, so the order sent is the order arranged. The body is sent byte for byte as
// signed (RS-01), and `svix-timestamp` is the wall clock, because ingest rejects one more than
// 5 minutes off (RS-02): the run's one wall-clock read (simulator.md → Signing).
async function send(input: LiveRunInput): Promise<SendResult> {
  let requests = 0;
  let accepted = 0;
  for (const { event } of input.events) {
    const body = JSON.stringify(event.payload);
    const headers = signWebhook({
      secret: input.simulatorSecret,
      svixId: event.svixId,
      timestamp: Math.floor(Date.now() / 1000),
      body,
    });
    requests += 1;
    let status: number;
    try {
      const response = await fetch(input.ingestUrl, {
        method: 'POST',
        headers: { ...headers, 'content-type': 'application/json' },
        body,
        signal: AbortSignal.timeout(requestTimeoutMs),
      });
      // Drained, so the connection is reused for the next request.
      await response.arrayBuffer();
      status = response.status;
    } catch {
      // D37: nothing answered the first request, so stop before sending more. A later failure is
      // one request not accepted, and the run fails on `a < k`.
      if (requests === 1) {
        return 'not-listening';
      }
      continue;
    }
    if (status === 200) {
      accepted += 1;
    }
  }
  return { requests, accepted };
}

export type SettleBound = { boundMs: number; intervalMs: number };

// D22: the settle bound scales with the run, `30 s + 100 ms × generated events`, polled every
// 250 ms, or every 2 s once the bound passes 60 s, so a 10,000-event burst's 1,030 s wait is about
// 500 `countPresent` calls, not 4,000.
export function settleBound(generatedEvents: number): SettleBound {
  const boundMs = 30_000 + 100 * generatedEvents;
  return { boundMs, intervalMs: boundMs > 60_000 ? 2_000 : 250 };
}

export type SettleResult = {
  // The ids the run waited for, and how many of them were stored at the last poll.
  expected: number;
  present: number;
  settled: boolean;
  bound: SettleBound;
  elapsedMs: number;
};

// Settled when every id waited for is in `webhook_events`. Each message commits its projections in
// the same transaction as its ledger row (ADR-004), so stored means projected. `ids` is every
// generated `svix_id`, or a subset of them: a poison run waits for the non-poisoned ids only (D27),
// while its bound still counts every generated event (D22).
export async function settle(
  db: Executor,
  ids: readonly string[],
  generatedEvents: number = ids.length,
): Promise<SettleResult> {
  const bound = settleBound(generatedEvents);
  const started = performance.now();
  for (;;) {
    const present = await webhookEventsRepository.countPresent(db, ids);
    const elapsedMs = performance.now() - started;
    const settled = present === ids.length;
    if (settled || elapsedMs >= bound.boundMs) {
      return { expected: ids.length, present, settled, bound, elapsedMs };
    }
    await sleep(bound.intervalMs);
  }
}

// D22's failure line, the bound in whole or decimal seconds as `settleBound` gives it.
export function notSettledLine(result: SettleResult): string {
  return `sim: not settled after ${result.bound.boundMs / 1000}s (${result.present}/${result.expected} stored)`;
}

// Exit status: `0` iff every request was accepted and both checked invariants pass, `1` otherwise.
export async function liveRun(input: LiveRunInput): Promise<number> {
  const sent = await send(input);
  if (sent === 'not-listening') {
    input.err(notListening);
    return 1;
  }
  input.out(`sent requests=${sent.requests} accepted=${sent.accepted}`);

  const generated = generatedSvixIds(input.history);
  const settled = await settle(input.db, generated);
  if (!settled.settled) {
    input.err(notSettledLine(settled));
    return 1;
  }

  const first = await invariant1(input.db, input.history);
  const second = await invariant2(input.db, input.history, input.addressHashKey);
  input.out(first.line);
  input.out(second.line);
  // Report honesty: an invariant this run cannot check is named as not checked, never as passed.
  input.out('invariant 3 not checked (slice 6)');
  // D23: this run is not an AWS run, which is the only kind that reads the DLQ.
  input.out('invariant 4 not checked (AWS runs check it: --burst, --chaos or --poison)');
  return first.pass && second.pass && sent.accepted === sent.requests ? 0 : 1;
}
