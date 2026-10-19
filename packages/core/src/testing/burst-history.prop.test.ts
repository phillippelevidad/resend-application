import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { LedgerEvent } from '../ledger-event.ts';
import { normalizeAddress } from '../normalize-address.ts';
import { burstHistory } from './burst-history.ts';
import { testLocalParts } from './email-history.ts';
import { testAddressSequences } from './test-address-sequences.ts';

// D25 step 5: the burst's history, over `--burst`'s whole range of events.
const seeds = fc.integer({ min: 0, max: 2 ** 32 - 1 });
const namespaces = fc.stringMatching(/^[a-z0-9-]{1,32}$/);
const counts = fc.integer({ min: 1, max: 10_000 });

const allEvents = (history: ReturnType<typeof burstHistory>) =>
  history.emails.flatMap(({ events }) => events);

const keysOf = (event: LedgerEvent): readonly string[] => event.recipientKeys ?? [];

const toOf = (event: LedgerEvent): unknown => (event.payload as { data: { to: unknown } }).data.to;

describe('burstHistory', () => {
  it('holds exactly the requested number of events, with every svix_id unique', () => {
    fc.assert(
      fc.property(seeds, namespaces, counts, (seed, namespace, events) => {
        const generated = allEvents(burstHistory({ seed, namespace, events }));
        expect(generated).toHaveLength(events);
        expect(new Set(generated.map(({ svixId }) => svixId)).size).toBe(events);
      }),
      { numRuns: 50 },
    );
  });

  // Thousands of emails per run: each property collects the emails that break it, plain checks, and
  // asserts once, so a failure still names the offending email ids.
  it('gives every email one recipient, a namespaced test address no other email of the burst has', () => {
    fc.assert(
      fc.property(seeds, namespaces, counts, (seed, namespace, events) => {
        const { emails } = burstHistory({ seed, namespace, events });
        const broken: string[] = [];
        const recipients = new Set<string>();
        emails.forEach(({ emailId, events: emailEvents }, index) => {
          const keys = new Set(emailEvents.flatMap(keysOf));
          const [key = ''] = keys;
          const local = key.slice(0, key.indexOf('+'));
          const carried = emailEvents.every((event) => {
            const to = toOf(event);
            return Array.isArray(to) && to.length === 1 && to[0] === key;
          });
          if (
            keys.size !== 1 ||
            key !== `${local}+${namespace}-b${index}@resend.dev` ||
            !(testLocalParts as readonly string[]).includes(local) ||
            !carried
          ) {
            broken.push(emailId);
          }
          recipients.add(key);
        });
        expect(broken).toEqual([]);
        expect(recipients.size).toBe(emails.length);
      }),
      { numRuns: 50 },
    );
  });

  it('replays each address its observed sequence, the last email a prefix of its own (RS-39)', () => {
    fc.assert(
      fc.property(seeds, namespaces, counts, (seed, namespace, events) => {
        const { emails } = burstHistory({ seed, namespace, events });
        const broken: string[] = [];
        emails.forEach(({ emailId, events: emailEvents }, index) => {
          const [key = ''] = emailEvents[0] === undefined ? [] : keysOf(emailEvents[0]);
          const local = key.slice(0, key.indexOf('+')) as (typeof testLocalParts)[number];
          const expected = (testAddressSequences[local] ?? []).map(({ type }) => type).join(',');
          const replayed = emailEvents.map(({ type }) => type).join(',');
          const last = index === emails.length - 1;
          const replays = last
            ? replayed.length > 0 && `${expected},`.startsWith(`${replayed},`)
            : replayed === expected;
          if (!replays) {
            broken.push(emailId);
          }
        });
        expect(broken).toEqual([]);
      }),
      { numRuns: 50 },
    );
  });

  it('cycles over every test address, starting where the seed says', () => {
    fc.assert(
      fc.property(seeds, namespaces, (seed, namespace) => {
        const { emails } = burstHistory({ seed, namespace, events: 64 });
        const locals = emails.map(({ events }) => {
          const [key = ''] = events[0] === undefined ? [] : keysOf(events[0]);
          return key.slice(0, key.indexOf('+'));
        });
        const start = seed % testLocalParts.length;
        locals.forEach((local, index) => {
          expect(local).toBe(testLocalParts[(start + index) % testLocalParts.length]);
        });
      }),
    );
  });

  it('is the same history for the same seed and namespace, and shares no id or recipient across namespaces', () => {
    fc.assert(
      fc.property(
        seeds,
        fc.uniqueArray(namespaces, { minLength: 2, maxLength: 2 }),
        fc.integer({ min: 1, max: 500 }),
        (seed, [first = 'a', second = 'b'], events) => {
          const history = burstHistory({ seed, namespace: first, events });
          expect(burstHistory({ seed, namespace: first, events })).toEqual(history);

          const other = burstHistory({ seed, namespace: second, events });
          const ids = (h: typeof history) =>
            new Set([
              ...h.emails.map(({ emailId }) => emailId),
              ...allEvents(h).flatMap((event) => [event.svixId, ...keysOf(event)]),
            ]);
          const theirs = ids(other);
          expect([...ids(history)].filter((id) => theirs.has(id))).toEqual([]);
        },
      ),
    );
  });

  it('holds 10,000 events at the ceiling, each recipient key its own normalized address', () => {
    const history = burstHistory({ seed: 42, namespace: 'burst', events: 10_000 });
    const generated = allEvents(history);
    expect(generated).toHaveLength(10_000);
    const mismatched = generated.filter((event) => {
      const to = toOf(event) as string[];
      return keysOf(event).join(',') !== to.map(normalizeAddress).join(',');
    });
    expect(mismatched.map(({ svixId }) => svixId)).toEqual([]);
  });
});
