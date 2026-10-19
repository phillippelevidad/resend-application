import { signWebhook } from '@ledger/core/testing';
import type { ClockPort } from '@ledger/shared';

// D25 step 7: the burst's sender. Request `i` is due at `t0 + i × seconds/events`, at most
// `MAX_IN_FLIGHT` are open at once, each is signed when it is sent (RS-02's tolerance window), and
// none is retried: a non-`200`, a timeout or a network error is simply not accepted. Each request's
// client-observed latency runs from the send to the response body read, or to its failure.

// What one request carries: the event's `svix_id` and its body, sent byte for byte as signed (RS-01).
export type PacedRequest = { readonly svixId: string; readonly body: string };

// The slice of `fetch` the sender uses, so a test passes a fake as a dependency (pp-testing → Never:
// no `vi.mock` of a global). The global `fetch` fits it.
export type FetchLike = (
  url: string,
  init: {
    method: 'POST';
    headers: Record<string, string>;
    body: string;
    signal: AbortSignal;
  },
) => Promise<{ readonly status: number; arrayBuffer(): Promise<ArrayBuffer> }>;

export type PacedSenderDeps = {
  fetch: FetchLike;
  // The schedule, the latencies and the `svix-timestamp` all read it: the wall clock in a run,
  // `FakeClock` in a test.
  clock: ClockPort;
  sleep: (ms: number) => Promise<void>;
  // A request open this long is aborted and not accepted.
  timeoutMs?: number;
};

export type PacedSendInput = {
  // `$LEDGER_URL/webhooks/resend`, never printed.
  ingestUrl: string;
  simulatorSecret: string;
  requests: readonly PacedRequest[];
  // The span the requests are paced over (`--burst <events>/<seconds>s`).
  seconds: number;
};

export type PacedSendResult = {
  requests: number;
  accepted: number;
  // The `svix_id`s answered `200`, which the run settles over.
  acceptedIds: string[];
  // From the first send to the last response.
  durationMs: number;
  p50Ms: number;
  p99Ms: number;
};

// D25: the most requests open at once. It bounds the sockets a 10,000-event burst holds if ingest
// slows, so a slow stack is measured as latency instead of exhausting the sender.
export const MAX_IN_FLIGHT = 512;

// As the plain live run's: a Ledger that holds a request this long is treated as not answering it.
const defaultTimeoutMs = 10_000;

// Nearest rank: the smallest value with at least `q` of the list at or below it. `NaN` for an empty
// list, which a burst (1 event at least) never sends.
export function percentile(values: readonly number[], q: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.max(Math.ceil(q * sorted.length), 1);
  return sorted[rank - 1] ?? Number.NaN;
}

// Surfaces → `pnpm sim`: counts, seconds and milliseconds only, never the URL (D28).
export function sentLine(result: PacedSendResult): string {
  return `sent requests=${result.requests} accepted=${result.accepted} duration_s=${(result.durationMs / 1000).toFixed(1)} p50_ms=${Math.round(result.p50Ms)} p99_ms=${Math.round(result.p99Ms)}`;
}

export async function sendPaced(
  input: PacedSendInput,
  deps: PacedSenderDeps,
): Promise<PacedSendResult> {
  const { clock } = deps;
  const timeoutMs = deps.timeoutMs ?? defaultTimeoutMs;
  const nowMs = (): number => clock.now().getTime();
  const intervalMs = (input.seconds * 1000) / input.requests.length;
  const latencies: number[] = [];
  const acceptedIds: string[] = [];

  // Never rejects: every failure is a request not accepted, recorded with the time it took.
  const sendOne = async ({ svixId, body }: PacedRequest): Promise<void> => {
    const started = nowMs();
    const headers = signWebhook({
      secret: input.simulatorSecret,
      svixId,
      timestamp: Math.floor(started / 1000),
      body,
    });
    let status: number | undefined;
    try {
      const response = await deps.fetch(input.ingestUrl, {
        method: 'POST',
        headers: { ...headers, 'content-type': 'application/json' },
        body,
        signal: AbortSignal.timeout(timeoutMs),
      });
      // Read to the end: the latency is the whole answer's, and the socket is freed for reuse.
      await response.arrayBuffer();
      status = response.status;
    } catch {
      status = undefined;
    }
    latencies.push(nowMs() - started);
    if (status === 200) acceptedIds.push(svixId);
  };

  let inFlight = 0;
  const freed: (() => void)[] = [];
  const open: Promise<void>[] = [];
  const t0 = nowMs();
  for (const [index, request] of input.requests.entries()) {
    const wait = t0 + index * intervalMs - nowMs();
    if (wait > 0) await deps.sleep(wait);
    // At the cap, the request waits for a slot; the ones after it are then overdue and go at once.
    while (inFlight >= MAX_IN_FLIGHT) {
      await new Promise<void>((resolve) => freed.push(resolve));
    }
    inFlight += 1;
    open.push(
      sendOne(request).finally(() => {
        inFlight -= 1;
        freed.shift()?.();
      }),
    );
  }
  await Promise.all(open);
  return {
    requests: input.requests.length,
    accepted: acceptedIds.length,
    acceptedIds,
    durationMs: nowMs() - t0,
    p50Ms: percentile(latencies, 0.5),
    p99Ms: percentile(latencies, 0.99),
  };
}
