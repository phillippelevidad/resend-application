import type { ClockPort } from '../clock.port.ts';

type Sleeper = { readonly deadline: number; readonly wake: () => void };

// D7: the clock port's test double (pp-testing → fakes). `now()` returns a set instant, `advance(ms)`
// moves it, and a `sleep(ms)` through it resolves once the clock passes its deadline, so a test
// drives time without `vi.useFakeTimers()`.
export class FakeClock implements ClockPort {
  #now: number;
  #sleepers: Sleeper[] = [];

  constructor(start: Date | string = '2026-10-17T12:00:00.000Z') {
    this.#now = new Date(start).getTime();
  }

  now(): Date {
    return new Date(this.#now);
  }

  advance(ms: number): void {
    this.#now += ms;
    const due = this.#sleepers.filter((sleeper) => sleeper.deadline <= this.#now);
    this.#sleepers = this.#sleepers.filter((sleeper) => sleeper.deadline > this.#now);
    for (const sleeper of due) sleeper.wake();
  }

  sleep = (ms: number): Promise<void> => {
    if (ms <= 0) return Promise.resolve();
    return new Promise((resolve) => {
      this.#sleepers.push({ deadline: this.#now + ms, wake: resolve });
    });
  };
}
