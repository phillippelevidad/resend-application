import { Buffer } from 'node:buffer';
import { FakeClock } from '@ledger/shared/testing';
import { describe, expect, it } from 'vitest';
import {
  type FetchLike,
  MAX_IN_FLIGHT,
  type PacedRequest,
  type PacedSendResult,
  percentile,
  sendPaced,
  sentLine,
} from './paced-sender.ts';

// D25 step 7 over a fake `fetch` passed as the sender's dependency and `FakeClock`, so the schedule
// and the cap are driven deterministically, with no network and no real wait.

const ingestUrl = 'http://127.0.0.1:1/webhooks/resend';
// A `whsec_` placeholder in the shape the signer takes; no deployment holds it.
const simulatorSecret = `whsec_${Buffer.from('paced-sender-test-secret').toString('base64')}`;

const requests = (count: number): PacedRequest[] =>
  Array.from({ length: count }, (_, index) => ({
    svixId: `walk-svix-burst-${index}-0`,
    body: `{"type":"email.sent","n":${index}}`,
  }));

const flush = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

// Moves the fake clock in steps, letting the sender run between them, until the send settles.
async function drive<T>(clock: FakeClock, run: Promise<T>, stepMs: number): Promise<T> {
  let done = false;
  void run.finally(() => {
    done = true;
  });
  for (let step = 0; step < 100_000 && !done; step += 1) {
    await flush();
    clock.advance(stepMs);
  }
  return run;
}

const answer = (status: number) => ({
  status,
  arrayBuffer: async () => new ArrayBuffer(0),
});

describe('the paced sender (D25 step 7)', () => {
  it('sends request i at i × seconds/events after the start, each signed at its own send time', async () => {
    const clock = new FakeClock();
    const t0 = clock.now().getTime();
    const sent: { at: number; svixId: string | undefined; timestamp: string | undefined }[] = [];
    const fetch: FetchLike = async (_url, init) => {
      sent.push({
        at: clock.now().getTime() - t0,
        svixId: init.headers['svix-id'],
        timestamp: init.headers['svix-timestamp'],
      });
      return answer(200);
    };

    const result = await drive(
      clock,
      sendPaced(
        { ingestUrl, simulatorSecret, requests: requests(4), seconds: 2 },
        { fetch, clock, sleep: clock.sleep },
      ),
      250,
    );

    expect(sent.map(({ at }) => at)).toEqual([0, 500, 1000, 1500]);
    expect(sent.map(({ svixId }) => svixId)).toEqual(requests(4).map(({ svixId }) => svixId));
    expect(sent.map(({ timestamp }) => Number(timestamp) - Math.floor(t0 / 1000))).toEqual([
      0, 0, 1, 1,
    ]);
    expect(result.accepted).toBe(4);
  });

  it(`never holds more than ${MAX_IN_FLIGHT} requests open, then sends the rest as slots free`, async () => {
    const clock = new FakeClock();
    const held: (() => void)[] = [];
    let open = 0;
    let mostOpen = 0;
    let calls = 0;
    const fetch: FetchLike = (_url, _init) => {
      calls += 1;
      open += 1;
      mostOpen = Math.max(mostOpen, open);
      return new Promise((resolve) => {
        held.push(() => {
          open -= 1;
          resolve(answer(200));
        });
      });
    };
    const total = MAX_IN_FLIGHT + 88;

    const run = sendPaced(
      { ingestUrl, simulatorSecret, requests: requests(total), seconds: 1 },
      { fetch, clock, sleep: clock.sleep },
    );
    // Every request is due within the second; none has answered yet.
    for (let step = 0; step < 20; step += 1) {
      await flush();
      clock.advance(100);
    }
    await flush();

    expect(calls).toBe(MAX_IN_FLIGHT);
    expect(mostOpen).toBe(MAX_IN_FLIGHT);

    // Answer everything, including what the freed slots send next.
    while (calls < total || held.length > 0) {
      for (const release of held.splice(0)) release();
      await flush();
    }
    const result = await run;

    expect(calls).toBe(total);
    expect(mostOpen).toBe(MAX_IN_FLIGHT);
    expect(result.accepted).toBe(total);
  });

  it('does not accept a 503, a thrown fetch or a timeout, and retries none of them', async () => {
    const clock = new FakeClock();
    const calls: (string | undefined)[] = [];
    const fetch: FetchLike = async (_url, init) => {
      const svixId = init.headers['svix-id'];
      calls.push(svixId);
      if (svixId === 'walk-svix-burst-1-0') return answer(503);
      if (svixId === 'walk-svix-burst-2-0') throw new DOMException('timed out', 'TimeoutError');
      return answer(200);
    };

    const result = await drive(
      clock,
      sendPaced(
        { ingestUrl, simulatorSecret, requests: requests(4), seconds: 1 },
        { fetch, clock, sleep: clock.sleep },
      ),
      250,
    );

    expect(calls).toHaveLength(4);
    expect(result.requests).toBe(4);
    expect(result.accepted).toBe(2);
    expect(result.acceptedIds).toEqual(['walk-svix-burst-0-0', 'walk-svix-burst-3-0']);
  });

  it('measures each latency from the send to the body read, on the clock', async () => {
    const clock = new FakeClock();
    // Each answer's body arrives 40 ms after its send.
    const fetch: FetchLike = async () => ({
      status: 200,
      arrayBuffer: async () => {
        clock.advance(40);
        return new ArrayBuffer(0);
      },
    });

    const result = await drive(
      clock,
      sendPaced(
        { ingestUrl, simulatorSecret, requests: requests(2), seconds: 1 },
        { fetch, clock, sleep: clock.sleep },
      ),
      100,
    );

    expect(result.p50Ms).toBe(40);
    expect(result.p99Ms).toBe(40);
  });
});

describe('percentile (nearest rank)', () => {
  it('reads p50 and p99 of a known list', () => {
    const list = Array.from({ length: 100 }, (_, index) => 100 - index);

    expect(percentile(list, 0.5)).toBe(50);
    expect(percentile(list, 0.99)).toBe(99);
    expect(percentile([10, 20, 30, 40, 50, 60, 70, 80, 90, 1000], 0.99)).toBe(1000);
    expect(percentile([7], 0.5)).toBe(7);
  });
});

describe('the sent line', () => {
  it('holds counts, seconds and milliseconds only', () => {
    const result: PacedSendResult = {
      requests: 10_000,
      accepted: 9_999,
      acceptedIds: [],
      durationMs: 10_432,
      p50Ms: 61.4,
      p99Ms: 412.6,
    };

    expect(sentLine(result)).toBe(
      'sent requests=10000 accepted=9999 duration_s=10.4 p50_ms=61 p99_ms=413',
    );
  });
});
