import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { LedgerEvent } from '../ledger-event.ts';
import { projectEmail } from '../project-email.projection.ts';
import { projectRecipient } from '../project-recipient.projection.ts';
import { controlCharacters, testLocalParts } from './email-history.ts';
import { type LedgerHistory, ledgerHistory } from './ledger-history.ts';

// A fixed seed, so the sample, and so this test, is the same on every run.
const sample = fc.sample(ledgerHistory({ namespace: 'sample' }), { seed: 20261016, numRuns: 100 });

// D38: what `pnpm sim` generates, every address labelled and the walk probe appended.
function labelled(namespace: string): LedgerHistory[] {
  return fc.sample(ledgerHistory({ namespace, labelEveryAddress: true }), {
    seed: 20261016,
    numRuns: 100,
  });
}

const walk = labelled('walk');

function keysOf(history: LedgerHistory): Set<string> {
  return new Set(
    history.emails.flatMap(({ events }) => events.flatMap((event) => event.recipientKeys ?? [])),
  );
}

// `<local>+<namespace>-<n>@resend.dev`, the local part a test address, optionally followed by one
// of the generator's control characters (a mask's input, never a key change).
function isLabelled(key: string, namespace: string): boolean {
  const match = /^([a-z]+)(.?)\+([a-z0-9-]+)-(\d)@resend\.dev$/u.exec(key);
  if (match === null) {
    return false;
  }
  const [, local = '', control = '', label = ''] = match;
  return (
    (testLocalParts as readonly string[]).includes(local) &&
    (control === '' || (controlCharacters as readonly string[]).includes(control)) &&
    label === namespace
  );
}

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

  it('keeps bare addresses and adds no probe by default, so core properties exercise both', () => {
    expect(sample.some((history) => [...keysOf(history)].some((key) => !key.includes('+')))).toBe(
      true,
    );
    for (const history of sample) {
      expect(history.emails.some(({ emailId }) => emailId === 'sample-probe')).toBe(false);
    }
  });
});

describe('ledgerHistory with labelEveryAddress (D38)', () => {
  const probeKeys = ['delivered+walk@resend.dev', 'bounced+walk@resend.dev'];

  it('labels every generated address with the namespace and a counter, so no generated address equals a probe address', () => {
    for (const history of walk) {
      for (const { emailId, events } of history.emails) {
        if (emailId === 'walk-probe') {
          continue;
        }
        for (const key of events.flatMap((event) => event.recipientKeys ?? [])) {
          expect(isLabelled(key, 'walk'), key).toBe(true);
          expect(probeKeys).not.toContain(key);
        }
      }
    }
  });

  it('shares no recipient address between two namespaces', () => {
    const other = labelled('other');
    walk.forEach((history, index) => {
      const otherKeys = keysOf(other[index] ?? { emails: [] });
      for (const key of keysOf(history)) {
        expect(otherKeys.has(key)).toBe(false);
      }
    });
  });

  it('appends the walk probe: sent to both, delivered to the first, a Permanent General bounce to the second', () => {
    for (const history of walk) {
      const probe = history.emails.at(-1);
      expect(probe?.emailId).toBe('walk-probe');
      const shape = probe?.events.map((event) => ({
        svixId: event.svixId,
        type: event.type,
        recipientKeys: event.recipientKeys,
        bounce: (event.payload as { data: { bounce?: unknown } }).data.bounce,
      }));
      expect(shape).toEqual([
        {
          svixId: 'walk-svix-probe-0',
          type: 'email.sent',
          recipientKeys: probeKeys,
          bounce: undefined,
        },
        {
          svixId: 'walk-svix-probe-1',
          type: 'email.delivered',
          recipientKeys: [probeKeys[0]],
          bounce: undefined,
        },
        {
          svixId: 'walk-svix-probe-2',
          type: 'email.bounced',
          recipientKeys: [probeKeys[1]],
          bounce: expect.objectContaining({ type: 'Permanent', subType: 'General' }),
        },
      ]);
      expect(history.emails.filter(({ emailId }) => emailId === 'walk-probe')).toHaveLength(1);
    }
  });

  it('projects the probe to bounced, its first recipient ok and its second hard_bounced caused by the probe', () => {
    const probe = walk[0]?.emails.find(({ emailId }) => emailId === 'walk-probe');
    const state = projectEmail('walk-probe', probe?.events ?? []);
    expect(state.status).toBe('bounced');
    const [delivered, bounced] = probeKeys.map((key) => projectRecipient(key, state.recipients));
    expect(delivered?.deliverability).toBe('ok');
    expect(bounced).toMatchObject({ deliverability: 'hard_bounced', causeEmailId: 'walk-probe' });
  });

  it('keeps every id unique across the history, the probe included', () => {
    for (const history of walk) {
      const svixIds = history.emails.flatMap(({ events }) => events.map((event) => event.svixId));
      expect(new Set(svixIds).size).toBe(svixIds.length);
      const emailIds = history.emails.map(({ emailId }) => emailId);
      expect(new Set(emailIds).size).toBe(emailIds.length);
    }
  });
});
