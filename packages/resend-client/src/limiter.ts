import type { ClockPort } from '@ledger/shared';
import { registryError } from './registry-error.ts';

// What the limiter reads of a response: the HTTP status (null for a network failure), the error
// name Resend sent, and the response headers, lower-cased as the SDK returns them (RS-23).
export type LimitedResponse = {
  readonly status: number | null;
  readonly name: string | undefined;
  readonly headers: Readonly<Record<string, string>> | null;
};

export type LimiterDeps = {
  clock: ClockPort;
  sleep: (ms: number) => Promise<void>;
  // Ledger's share of the team's 10 req/s (RS-19, integrations.md rule 2).
  ratePerSecond: number;
};

// RS-22: a `429` under either name cannot be waited out inside a run.
const QUOTA_NAMES: ReadonlySet<string> = new Set([
  'daily_quota_exceeded',
  'monthly_quota_exceeded',
]);

// A header value in whole or fractional seconds, or undefined when absent or unparseable.
const seconds = (headers: LimitedResponse['headers'], name: string): number | undefined => {
  const raw = headers?.[name];
  if (raw === undefined || raw.trim() === '') return undefined;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : undefined;
};

// Slice 4 D10, ADR-012: one per client, so one per calling function. Rate, headroom, `retry-after`
// and the caller's deadline; time from the clock port and waits through the injected `sleep`, so the
// tests run on a fake clock. Every caller is single-flight (the reconciler by its run claim), so one
// instance never sees two requests at once.
export class Limiter {
  readonly #clock: ClockPort;
  readonly #sleep: (ms: number) => Promise<void>;
  readonly #spacingMs: number;
  #nextStartMs = Number.NEGATIVE_INFINITY;

  constructor({ clock, sleep, ratePerSecond }: LimiterDeps) {
    this.#clock = clock;
    this.#sleep = sleep;
    this.#spacingMs = 1000 / ratePerSecond;
  }

  // Sends through `send` until a response is not a waitable `429`, and returns it. Throws
  // `rate_limited` for a quota `429`, a `429` with no `retry-after`, any wait that would end past
  // `deadline`, before it sleeps, or a start already past `deadline`.
  async run<R extends LimitedResponse>(send: () => Promise<R>, deadline: Date): Promise<R> {
    for (;;) {
      await this.#waitUntil(this.#nextStartMs, deadline);
      const startedMs = this.#clock.now().getTime();
      this.#nextStartMs = startedMs + this.#spacingMs;
      const response = await send();
      this.#applyHeadroom(response);
      if (response.status !== 429) return response;
      const retryAfter = seconds(response.headers, 'retry-after');
      if (QUOTA_NAMES.has(response.name ?? '') || retryAfter === undefined) {
        throw registryError('rate_limited');
      }
      const retryAtMs = this.#clock.now().getTime() + retryAfter * 1000;
      this.#nextStartMs = Math.max(this.#nextStartMs, retryAtMs);
    }
  }

  // Step 2: below half the window's allowance, wait the window out before the next start. Absent or
  // unparseable headers change nothing.
  #applyHeadroom(response: LimitedResponse): void {
    const remaining = seconds(response.headers, 'ratelimit-remaining');
    const limit = seconds(response.headers, 'ratelimit-limit');
    const reset = seconds(response.headers, 'ratelimit-reset');
    if (remaining === undefined || limit === undefined || reset === undefined) return;
    if (remaining < limit / 2) {
      const resumeMs = this.#clock.now().getTime() + reset * 1000;
      this.#nextStartMs = Math.max(this.#nextStartMs, resumeMs);
    }
  }

  // No request starts past the deadline, waited for or not: a caller whose requests outlast the
  // spacing never waits, so the deadline is checked against the start time itself (D2).
  async #waitUntil(atMs: number, deadline: Date): Promise<void> {
    const nowMs = this.#clock.now().getTime();
    if (Math.max(atMs, nowMs) > deadline.getTime()) throw registryError('rate_limited');
    const waitMs = atMs - nowMs;
    if (waitMs <= 0) return;
    await this.#sleep(waitMs);
  }
}
