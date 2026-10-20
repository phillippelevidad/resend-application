// Slice 4 D10, ADR-012: the limiter on a fake clock, its sleep advancing the clock, so no test waits
// in real time (D47). Header names and the `429` names follow RS-19, RS-22 and RS-23.
import { LedgerError } from '@ledger/shared';
import { FakeClock } from '@ledger/shared/testing';
import { describe, expect, it } from 'vitest';
import { type LimitedResponse, Limiter } from './limiter.ts';

const START = '2026-10-21T13:00:00.000Z';

function setup(ratePerSecond = 2) {
  const clock = new FakeClock(START);
  const sleeps: number[] = [];
  const sleep = async (ms: number): Promise<void> => {
    sleeps.push(ms);
    clock.advance(ms);
  };
  const limiter = new Limiter({ clock, sleep, ratePerSecond });
  const starts: number[] = [];
  const elapsed = (): number => clock.now().getTime() - new Date(START).getTime();
  // A send that records its start, offset from START in ms, and answers the next scripted response.
  const sender = (responses: LimitedResponse[]) => {
    let index = 0;
    return async (): Promise<LimitedResponse> => {
      starts.push(elapsed());
      const response = responses[Math.min(index, responses.length - 1)];
      index += 1;
      if (response === undefined) throw new TypeError('no scripted response');
      return response;
    };
  };
  return { clock, limiter, sleeps, starts, sender };
}

const ok: LimitedResponse = { status: 200, name: undefined, headers: {} };
const farDeadline = new Date(new Date(START).getTime() + 3_600_000);

const codeOf = async (call: Promise<unknown>): Promise<string | undefined> => {
  try {
    await call;
    return undefined;
  } catch (error) {
    return error instanceof LedgerError ? error.code : 'not a LedgerError';
  }
};

describe('Limiter', () => {
  it('spaces 10 request starts 500 ms apart at 2 req/s', async () => {
    const { limiter, starts, sender } = setup();
    const send = sender([ok]);
    for (let i = 0; i < 10; i += 1) {
      await limiter.run(send, farDeadline);
    }
    expect(starts).toEqual([0, 500, 1000, 1500, 2000, 2500, 3000, 3500, 4000, 4500]);
  });

  it('yields ratelimit-reset seconds when ratelimit-remaining falls below half the limit', async () => {
    const { limiter, starts, sender } = setup();
    const send = sender([
      {
        status: 200,
        name: undefined,
        headers: { 'ratelimit-remaining': '4', 'ratelimit-limit': '10', 'ratelimit-reset': '1' },
      },
      ok,
    ]);
    await limiter.run(send, farDeadline);
    await limiter.run(send, farDeadline);
    expect(starts).toEqual([0, 1000]);
  });

  it('does not yield while remaining is at or above half the limit', async () => {
    const { limiter, starts, sender } = setup();
    const send = sender([
      {
        status: 200,
        name: undefined,
        headers: { 'ratelimit-remaining': '9', 'ratelimit-limit': '10', 'ratelimit-reset': '1' },
      },
      ok,
    ]);
    await limiter.run(send, farDeadline);
    await limiter.run(send, farDeadline);
    expect(starts).toEqual([0, 500]);
  });

  it('ignores absent or unparseable rate-limit headers', async () => {
    const { limiter, starts, sender } = setup();
    const send = sender([
      {
        status: 200,
        name: undefined,
        headers: { 'ratelimit-remaining': 'x', 'ratelimit-limit': '10', 'ratelimit-reset': '1' },
      },
      { status: 200, name: undefined, headers: null },
      ok,
    ]);
    await limiter.run(send, farDeadline);
    await limiter.run(send, farDeadline);
    await limiter.run(send, farDeadline);
    expect(starts).toEqual([0, 500, 1000]);
  });

  it('waits retry-after on a 429, then retries the same call and returns its success', async () => {
    const { limiter, starts, sender } = setup();
    const send = sender([
      { status: 429, name: 'rate_limit_exceeded', headers: { 'retry-after': '3' } },
      ok,
    ]);
    const response = await limiter.run(send, farDeadline);
    expect(response.status).toBe(200);
    expect(starts).toEqual([0, 3000]);
  });

  it.each([
    ['daily_quota_exceeded', { 'retry-after': '1' }],
    ['monthly_quota_exceeded', { 'retry-after': '1' }],
    ['rate_limit_exceeded', {}],
    ['rate_limit_exceeded', { 'retry-after': 'soon' }],
  ])('throws rate_limited after one request on a %s 429 with %j', async (name, headers) => {
    const { limiter, starts, sleeps, sender } = setup();
    const send = sender([{ status: 429, name, headers }, ok]);
    expect(await codeOf(limiter.run(send, farDeadline))).toBe('rate_limited');
    expect(starts).toEqual([0]);
    expect(sleeps).toEqual([]);
  });

  it('throws rate_limited without sleeping when a retry-after wait would pass the deadline', async () => {
    const { limiter, starts, sleeps, sender } = setup();
    const deadline = new Date(new Date(START).getTime() + 2_000);
    const send = sender([
      { status: 429, name: 'rate_limit_exceeded', headers: { 'retry-after': '3' } },
      ok,
    ]);
    expect(await codeOf(limiter.run(send, deadline))).toBe('rate_limited');
    expect(starts).toEqual([0]);
    expect(sleeps).toEqual([]);
  });

  it('throws rate_limited without sleeping when the spacing wait would pass the deadline', async () => {
    const { clock, limiter, sleeps, sender } = setup();
    const send = sender([ok]);
    await limiter.run(send, farDeadline);
    const deadline = new Date(clock.now().getTime() + 100);
    expect(await codeOf(limiter.run(send, deadline))).toBe('rate_limited');
    expect(sleeps).toEqual([]);
  });

  it('returns a non-429 error response for its caller to map', async () => {
    const { limiter, sender } = setup();
    const send = sender([{ status: 503, name: 'internal_server_error', headers: {} }]);
    const response = await limiter.run(send, farDeadline);
    expect(response.status).toBe(503);
  });
});
