import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { LedgerEvent } from '../ledger-event.ts';
import { normalizeAddress } from '../normalize-address.ts';
import { emailHistory } from './email-history.ts';

// A fixed seed, so the sample, and so this test, is the same on every run.
const sample = fc.sample(emailHistory({ namespace: 'sample' }), { seed: 20261016, numRuns: 200 });

function time(event: LedgerEvent): number {
  return event.eventCreatedAt?.getTime() ?? Number.NaN;
}

function dataOf(event: LedgerEvent): { to?: unknown } {
  const payload = event.payload as { data?: { to?: unknown } };
  return payload.data ?? {};
}

function wellFormed(events: readonly LedgerEvent[], type: string): LedgerEvent[] {
  return events.filter(
    (event) =>
      event.type === type && event.eventCreatedAt !== null && Array.isArray(dataOf(event).to),
  );
}

describe('emailHistory', () => {
  it('holds tied created_at, of different types and of one type, so the rank and svix_id tie-breaks run (RS-U10)', () => {
    const ties = (events: LedgerEvent[], sameType: boolean) =>
      events.some((a, i) =>
        events.some((b, j) => i < j && time(a) === time(b) && (a.type === b.type) === sameType),
      );
    expect(sample.some(({ events }) => ties(events, false))).toBe(true);
    expect(sample.some(({ events }) => ties(events, true))).toBe(true);
  });

  it('holds both RS-U10 worlds: created_at tracking lifecycle order, and created_at unrelated to it', () => {
    const tracks = ({ events }: { events: LedgerEvent[] }) =>
      events.length > 2 &&
      new Set(events.map(time)).size > 1 &&
      events.every((event, i) => i === 0 || time(events[i - 1] as LedgerEvent) <= time(event));
    const unrelated = ({ events }: { events: LedgerEvent[] }) =>
      events.some((event, i) => i > 0 && time(events[i - 1] as LedgerEvent) > time(event));
    expect(sample.some(tracks)).toBe(true);
    expect(sample.some(unrelated)).toBe(true);
  });

  it('holds both RS-U11 worlds: a bounce after a delivery by created_at, and bounces with none after delivery', () => {
    const lateBounce = ({ events }: { events: LedgerEvent[] }) =>
      wellFormed(events, 'email.delivered').some((delivered) =>
        wellFormed(events, 'email.bounced').some((bounced) => time(bounced) > time(delivered)),
      );
    const bounceWithoutLateBounce = (history: { events: LedgerEvent[] }) =>
      wellFormed(history.events, 'email.bounced').length > 0 && !lateBounce(history);
    expect(sample.some(lateBounce)).toBe(true);
    expect(sample.some(bounceWithoutLateBounce)).toBe(true);
  });

  it('keys each recipient by its normalized address and uses Resend test addresses only', () => {
    for (const { events } of sample) {
      for (const event of events) {
        const { to } = dataOf(event);
        if (!Array.isArray(to)) {
          continue;
        }
        expect(event.recipientKeys).toEqual(to.map(normalizeAddress));
        for (const key of event.recipientKeys ?? []) {
          expect(key).toMatch(/@resend\.dev$/);
        }
      }
    }
  });

  it('derives every id from the namespace and a counter, unique per event', () => {
    for (const { emailId, events } of sample) {
      expect(emailId).toBe('sample-email-0');
      const ids = events.map((event) => event.svixId);
      expect(new Set(ids).size).toBe(ids.length);
      for (const id of ids) {
        expect(id).toMatch(/^sample-svix-0-\d+$/);
      }
    }
  });
});
