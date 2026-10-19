import type { ClockPort } from '@ledger/shared';

// The time an AWS run's bounded waits read and sleep through (D27). `main.ts` passes the system clock
// and `node:timers/promises`; a test passes a `FakeClock` and a sleep that advances it, so no test
// waits real minutes.
export type RunTime = {
  readonly clock: ClockPort;
  readonly sleep: (ms: number) => Promise<void>;
};

export type WaitBound = { readonly boundMs: number; readonly intervalMs: number };

// Polls `check` until it holds, every `intervalMs`, for at most `boundMs` (pp-testing → Never: poll
// the observable condition with a bound, never wait forever). Resolves the milliseconds it took, or
// `undefined` when the bound ran out first. The condition is read once more at the bound, so a state
// reached during the last sleep still counts.
export async function waitUntil(
  time: RunTime,
  bound: WaitBound,
  check: () => Promise<boolean>,
): Promise<number | undefined> {
  const started = time.clock.now().getTime();
  for (;;) {
    if (await check()) {
      return time.clock.now().getTime() - started;
    }
    const remaining = started + bound.boundMs - time.clock.now().getTime();
    if (remaining <= 0) {
      return undefined;
    }
    await time.sleep(Math.min(bound.intervalMs, remaining));
  }
}

// Whole seconds and whole minutes for the run's lines (D28: durations only).
export const wholeSeconds = (ms: number): number => Math.round(ms / 1000);
export const wholeMinutes = (ms: number): number => Math.round(ms / 60_000);
