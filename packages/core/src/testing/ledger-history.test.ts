import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { LedgerEvent } from '../ledger-event.ts';
import { type LedgerHistory, ledgerHistory } from './ledger-history.ts';

// A fixed seed, so the sample, and so this test, is the same on every run.
const sample = fc.sample(ledgerHistory({ namespace: 'sample' }), { seed: 20261016, numRuns: 100 });

function wellFormed(event: LedgerEvent): boolean {
  const to = (event.payload as { data?: { to?: unknown } }).data?.to;
  return event.eventCreatedAt !== null && Array.isArray(to);
}

function time(event: LedgerEvent): number {
  return event.eventCreatedAt?.getTime() ?? Number.NaN;
}

function bounceType(event: LedgerEvent): unknown {
  return (event.payload as { data?: { bounce?: { type?: unknown } } }).data?.bounce?.type;
}

// True when one email names one recipient in a sticky event and, no earlier, in a higher-ranked
// non-sticky one (C3).
function hasStickyThenHigher(history: LedgerHistory, sticky: string, follower: string): boolean {
  return history.emails.some(({ events }) =>
    events.some(
      (first) =>
        first.type === sticky &&
        wellFormed(first) &&
        events.some(
          (second) =>
            second.type === follower &&
            wellFormed(second) &&
            (follower !== 'email.bounced' || bounceType(second) === 'Transient') &&
            time(second) >= time(first) &&
            (first.recipientKeys ?? []).some((key) => second.recipientKeys?.includes(key)),
        ),
    ),
  );
}

describe('ledgerHistory', () => {
  it('holds at least 2 emails of at least 2 events each', () => {
    for (const history of sample) {
      expect(history.emails.length).toBeGreaterThanOrEqual(2);
      for (const { events } of history.emails) {
        expect(events.length).toBeGreaterThanOrEqual(2);
      }
    }
  });

  it('holds a recipient named by well-formed events of two different emails', () => {
    const shared = (history: LedgerHistory) => {
      const emailsByKey = new Map<string, Set<string>>();
      for (const { emailId, events } of history.emails) {
        for (const event of events.filter(wellFormed)) {
          for (const key of event.recipientKeys ?? []) {
            emailsByKey.set(key, (emailsByKey.get(key) ?? new Set()).add(emailId));
          }
        }
      }
      return [...emailsByKey.values()].some((emails) => emails.size >= 2);
    };
    expect(sample.some(shared)).toBe(true);
  });

  it('holds a sticky event followed by a higher-ranked non-sticky one on the same email and recipient (suppressed then failed, complained then a Transient bounce)', () => {
    expect(
      sample.some((history) => hasStickyThenHigher(history, 'email.suppressed', 'email.failed')),
    ).toBe(true);
    expect(
      sample.some((history) => hasStickyThenHigher(history, 'email.complained', 'email.bounced')),
    ).toBe(true);
  });

  it('derives every id from the namespace and a counter, unique across the whole history', () => {
    for (const history of sample) {
      const emailIds = history.emails.map(({ emailId }) => emailId);
      expect(emailIds).toEqual(emailIds.map((_, index) => `sample-email-${index}`));
      const svixIds = history.emails.flatMap(({ events }) => events.map((event) => event.svixId));
      expect(new Set(svixIds).size).toBe(svixIds.length);
      for (const id of svixIds) {
        expect(id).toMatch(/^sample-svix-\d+-\d+$/);
      }
    }
  });

  it('uses Resend test addresses only', () => {
    for (const history of sample) {
      for (const { events } of history.emails) {
        for (const key of events.flatMap((event) => event.recipientKeys ?? [])) {
          expect(key).toMatch(/@resend\.dev$/);
        }
      }
    }
  });

  it('is deterministic given the seed', () => {
    const again = fc.sample(ledgerHistory({ namespace: 'sample' }), {
      seed: 20261016,
      numRuns: 100,
    });
    expect(again).toEqual(sample);
  });
});
