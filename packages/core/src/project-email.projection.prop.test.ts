import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { type EmailEvent, emailEventSchema } from './email-event.schema.ts';
import type { LedgerEvent } from './ledger-event.ts';
import { maskAddress } from './mask-address.ts';
import { maskFrom } from './mask-from.ts';
import { maskText } from './mask-text.ts';
import { normalizeAddress } from './normalize-address.ts';
import {
  type EmailRecipientState,
  type EmailState,
  projectEmail,
} from './project-email.projection.ts';
import { type EmailHistory, emailHistory } from './testing/email-history.ts';

// ---------------------------------------------------------------------------------------------
// The oracle (ADR-003 property 4). Deliberately naive and independent of the projection: no sort,
// no fold. Each field is selected directly from the deduplicated event set, precedence first, with
// its own copy of the D1 order written out here.
// ---------------------------------------------------------------------------------------------

const typeOrder = [
  'email.scheduled',
  'email.sent',
  'email.delivery_delayed',
  'email.delivered',
  'email.opened',
  'email.clicked',
  'email.complained',
  'email.suppressed',
  'email.failed',
  'email.bounced',
];

const statusOrder = [
  'scheduled',
  'sent',
  'delivery_delayed',
  'delivered',
  'complained',
  'suppressed',
  'failed',
  'bounced',
] as const;

const stickyOrder = ['complained', 'suppressed', 'hard_bounced'] as const;

type OracleEvent = { row: LedgerEvent; time: number; parsed: EmailEvent; keys: readonly string[] };

function statusOf(event: OracleEvent): (typeof statusOrder)[number] | undefined {
  return statusOrder.find((status) => `email.${status}` === event.parsed.type);
}

function isPermanent(event: OracleEvent): boolean {
  return event.parsed.type === 'email.bounced' && event.parsed.data.bounce?.type === 'Permanent';
}

function stickyOf(event: OracleEvent): (typeof stickyOrder)[number] | undefined {
  if (event.parsed.type === 'email.complained') return 'complained';
  if (event.parsed.type === 'email.suppressed') return 'suppressed';
  return isPermanent(event) ? 'hard_bounced' : undefined;
}

function isSoft(event: OracleEvent): boolean {
  return (
    event.parsed.type === 'email.delivered' ||
    (event.parsed.type === 'email.bounced' && !isPermanent(event))
  );
}

function before(a: OracleEvent, b: OracleEvent): boolean {
  if (a.time !== b.time) return a.time < b.time;
  const ra = typeOrder.indexOf(a.parsed.type);
  const rb = typeOrder.indexOf(b.parsed.type);
  if (ra !== rb) return ra < rb;
  return a.row.svixId < b.row.svixId;
}

function earliest(events: OracleEvent[]): OracleEvent | undefined {
  return events.reduce<OracleEvent | undefined>(
    (best, event) => (best === undefined || before(event, best) ? event : best),
    undefined,
  );
}

function latest(events: OracleEvent[]): OracleEvent | undefined {
  return events.reduce<OracleEvent | undefined>(
    (best, event) => (best === undefined || before(best, event) ? event : best),
    undefined,
  );
}

// Precedence first: the highest status present, `Permanent` preferred among bounces, then the
// earliest of those.
function decidingEvent(events: OracleEvent[]): OracleEvent | undefined {
  const outcomes = events.filter((event) => statusOf(event) !== undefined);
  const top = Math.max(
    -1,
    ...outcomes.map((event) => statusOrder.indexOf(statusOf(event) ?? 'sent')),
  );
  const highest = outcomes.filter(
    (event) => statusOrder.indexOf(statusOf(event) ?? 'sent') === top,
  );
  const permanent = highest.filter(isPermanent);
  return earliest(permanent.length > 0 ? permanent : highest);
}

function projectable(emailId: string, events: readonly LedgerEvent[]): OracleEvent[] {
  const result: OracleEvent[] = [];
  for (const row of events) {
    if (result.some((seen) => seen.row.svixId === row.svixId)) continue;
    const parsed = emailEventSchema.safeParse(row.payload);
    if (
      row.eventCreatedAt === null ||
      !parsed.success ||
      parsed.data.type !== row.type ||
      parsed.data.data.email_id !== emailId ||
      row.recipientKeys === null ||
      row.recipientKeys.length !== parsed.data.data.to.length
    ) {
      continue;
    }
    result.push({
      row,
      time: row.eventCreatedAt.getTime(),
      parsed: parsed.data,
      keys: row.recipientKeys,
    });
  }
  return result;
}

function oracleRecipient(emailId: string, key: string, all: OracleEvent[]): EmailRecipientState {
  const named = all.filter((event) => event.keys.includes(key));
  const first = earliest(named);
  const address = first?.parsed.data.to[first.keys.indexOf(key)] ?? '';
  const deciding = decidingEvent(named);
  const bounce =
    deciding?.parsed.type === 'email.bounced' ? deciding.parsed.data.bounce : undefined;
  const stickyEvents = named.filter((event) => stickyOf(event) !== undefined);
  const topSticky = Math.max(
    -1,
    ...stickyEvents.map((event) => stickyOrder.indexOf(stickyOf(event) ?? 'complained')),
  );
  const sticky = earliest(
    stickyEvents.filter(
      (event) => stickyOrder.indexOf(stickyOf(event) ?? 'complained') === topSticky,
    ),
  );
  const soft = latest(named.filter(isSoft));
  return {
    emailId,
    recipientKey: key,
    addressMasked: maskAddress(normalizeAddress(address)),
    status: deciding === undefined ? null : (statusOf(deciding) ?? null),
    statusAt: deciding === undefined ? null : new Date(deciding.time),
    bounceType: bounce?.type ?? null,
    bounceSubType: bounce?.subType ?? null,
    stickySignal: sticky === undefined ? null : (stickyOf(sticky) ?? null),
    stickySignalAt: sticky === undefined ? null : new Date(sticky.time),
    stickySignalSvixId: sticky?.row.svixId ?? null,
    softSignal:
      soft === undefined ? null : soft.parsed.type === 'email.delivered' ? 'delivered' : 'bounced',
    softSignalAt: soft === undefined ? null : new Date(soft.time),
    softSignalSvixId: soft?.row.svixId ?? null,
  };
}

function oracle(emailId: string, events: readonly LedgerEvent[]): EmailState {
  const all = projectable(emailId, events);
  const deciding = decidingEvent(all);
  const from = earliest(all.filter((event) => typeof event.parsed.data.from === 'string'));
  const subject = earliest(all.filter((event) => typeof event.parsed.data.subject === 'string'));
  const opens = all.filter((event) => event.parsed.type === 'email.opened');
  const clicks = all.filter((event) => event.parsed.type === 'email.clicked');
  const firstOpen = earliest(opens);
  const firstClick = earliest(clicks);
  const last = latest(all);
  const keys = [...new Set(all.flatMap((event) => event.keys))].sort((a, b) =>
    a < b ? -1 : a > b ? 1 : 0,
  );
  return {
    emailId,
    status: deciding === undefined ? null : (statusOf(deciding) ?? null),
    fromMasked: typeof from?.parsed.data.from === 'string' ? maskFrom(from.parsed.data.from) : null,
    subjectMasked:
      typeof subject?.parsed.data.subject === 'string'
        ? maskText(subject.parsed.data.subject)
        : null,
    openCount: opens.length,
    clickCount: clicks.length,
    firstOpenedAt: firstOpen === undefined ? null : new Date(firstOpen.time),
    firstClickedAt: firstClick === undefined ? null : new Date(firstClick.time),
    lastEventAt: last === undefined ? null : new Date(last.time),
    eventCount: all.length,
    recipients: keys.map((key) => oracleRecipient(emailId, key, all)),
  };
}

// ---------------------------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------------------------

const instant = (offset: number) =>
  new Date(Date.parse('2026-10-16T12:00:00.000Z') + offset * 1000);

function statusPrecedence(status: EmailRecipientState['status']): number {
  return status === null ? -1 : statusOrder.indexOf(status);
}

function stickyPrecedence(signal: EmailRecipientState['stickySignal']): number {
  return signal === null ? -1 : stickyOrder.indexOf(signal);
}

// Every address the history's well-formed events name, one spelling per recipient key.
function addressesOf(history: EmailHistory): string[] {
  const byKey = new Map<string, string>();
  for (const event of history.events) {
    const to = (event.payload as { data?: { to?: unknown } }).data?.to;
    if (Array.isArray(to)) {
      for (const address of to) {
        if (typeof address === 'string' && !byKey.has(normalizeAddress(address))) {
          byKey.set(normalizeAddress(address), address);
        }
      }
    }
  }
  return [...byKey.values()];
}

function makeEvent(
  emailId: string,
  svixId: string,
  type: string,
  to: readonly string[],
  createdAt: Date,
  data: Record<string, unknown> = {},
): LedgerEvent {
  return {
    svixId,
    type,
    eventCreatedAt: createdAt,
    recipientKeys: to.map(normalizeAddress),
    payload: {
      type,
      created_at: createdAt.toISOString(),
      data: { email_id: emailId, to, ...data },
    },
  };
}

const bounceObject = fc.oneof(
  fc.constant({}),
  fc.record({
    bounce: fc.record({
      type: fc.oneof(
        fc.constantFrom('Permanent', 'Transient', 'Temporary', 'Undetermined'),
        fc.string({ maxLength: 8 }),
      ),
      subType: fc.constantFrom('General', 'Suppressed', 'MailboxFull'),
    }),
  }),
);

function permutation<T>(items: readonly T[]): fc.Arbitrary<T[]> {
  return fc.shuffledSubarray([...items], { minLength: items.length, maxLength: items.length });
}

const historyAndPermutation = emailHistory().chain((history) =>
  permutation(history.events).map((shuffled) => ({ history, shuffled })),
);

// ---------------------------------------------------------------------------------------------
// Properties
// ---------------------------------------------------------------------------------------------

describe('projectEmail', () => {
  it('is permutation invariant: any arrival order of one event set gives an equal projection (ADR-003 property 1)', () => {
    fc.assert(
      fc.property(historyAndPermutation, ({ history, shuffled }) => {
        expect(projectEmail(history.emailId, shuffled)).toEqual(
          projectEmail(history.emailId, history.events),
        );
      }),
    );
  });

  it('is idempotent under repeats: redelivered events change no field, counts included (ADR-003 property 2)', () => {
    // A redelivery is a distinct object with the same `svixId`, so the repeats are clones: a dedupe
    // by object identity instead of by `svixId` fails here.
    const withRepeats = emailHistory().chain((history) =>
      fc
        .subarray(history.events)
        .map((repeats) => repeats.map((event) => structuredClone(event)))
        .chain((repeats) => permutation([...history.events, ...repeats, ...repeats]))
        .map((repeated) => ({ history, repeated })),
    );
    fc.assert(
      fc.property(withRepeats, ({ history, repeated }) => {
        expect(projectEmail(history.emailId, repeated)).toEqual(
          projectEmail(history.emailId, history.events),
        );
      }),
    );
  });

  it('is precedence monotone: adding events never lowers a status or a sticky signal (ADR-003 property 3)', () => {
    const subsetAndSet = emailHistory().chain((history) =>
      fc.subarray(history.events).map((subset) => ({ history, subset })),
    );
    fc.assert(
      fc.property(subsetAndSet, ({ history, subset }) => {
        const smaller = projectEmail(history.emailId, subset);
        const larger = projectEmail(history.emailId, history.events);
        expect(statusPrecedence(larger.status)).toBeGreaterThanOrEqual(
          statusPrecedence(smaller.status),
        );
        for (const row of smaller.recipients) {
          const grown = larger.recipients.find((other) => other.recipientKey === row.recipientKey);
          expect(grown).toBeDefined();
          expect(statusPrecedence(grown?.status ?? null)).toBeGreaterThanOrEqual(
            statusPrecedence(row.status),
          );
          expect(stickyPrecedence(grown?.stickySignal ?? null)).toBeGreaterThanOrEqual(
            stickyPrecedence(row.stickySignal),
          );
        }
      }),
    );
  });

  it('agrees with a precedence-first oracle on every generated history, in any order (ADR-003 property 4)', () => {
    fc.assert(
      fc.property(historyAndPermutation, ({ history, shuffled }) => {
        expect(projectEmail(history.emailId, shuffled)).toEqual(oracle(history.emailId, shuffled));
      }),
    );
  });

  it('a bounce outranks delivered in either world (RS-U11)', () => {
    // Both RS-U11 worlds: the bounce's created_at before, equal to or after the delivery's, and
    // either arrival order.
    const lateOrEarlyBounce = emailHistory().chain((history) =>
      fc
        .record({
          address: fc.constantFrom(...addressesOf(history), 'bounced@resend.dev'),
          deliveredAt: fc.nat(3),
          bouncedAt: fc.nat(3),
          bounce: bounceObject,
          bounceFirst: fc.boolean(),
        })
        .map(({ address, deliveredAt, bouncedAt, bounce, bounceFirst }) => {
          const delivered = makeEvent(
            history.emailId,
            'u11-delivered',
            'email.delivered',
            [address],
            instant(deliveredAt),
          );
          const bounced = makeEvent(
            history.emailId,
            'u11-bounced',
            'email.bounced',
            [address],
            instant(bouncedAt),
            bounce,
          );
          const pair = bounceFirst ? [bounced, delivered] : [delivered, bounced];
          return { history, address, events: [...history.events, ...pair] };
        }),
    );
    fc.assert(
      fc.property(lateOrEarlyBounce, ({ history, address, events }) => {
        const state = projectEmail(history.emailId, events);
        expect(state.status).toBe('bounced');
        const row = state.recipients.find((r) => r.recipientKey === normalizeAddress(address));
        expect(row?.status).toBe('bounced');
      }),
    );
  });

  it('a tie-heavy history, every event on one of two created_at instants with same-type ties, projects the same in any order and agrees with the oracle (RS-U10)', () => {
    const tied = emailHistory({ instants: 2 }).chain((history) =>
      permutation(history.events).map((shuffled) => ({ history, shuffled })),
    );
    fc.assert(
      fc.property(tied, ({ history, shuffled }) => {
        const projected = projectEmail(history.emailId, shuffled);
        expect(projected).toEqual(projectEmail(history.emailId, history.events));
        expect(projected).toEqual(oracle(history.emailId, shuffled));
      }),
    );
  });

  it('a bounce naming one of two recipients leaves the other recipient’s outcome unchanged (RS-27)', () => {
    const twoRecipients = emailHistory({ minRecipients: 2 }).chain((history) => {
      const addresses = addressesOf(history);
      return fc
        .record({
          target: fc.constantFrom(...addresses, 'bounced@resend.dev'),
          at: fc.nat(3),
          bounce: bounceObject,
        })
        .chain(({ target, at, bounce }) =>
          permutation([
            ...history.events,
            makeEvent(
              history.emailId,
              'two-recipient-bounce',
              'email.bounced',
              [target],
              instant(at),
              bounce,
            ),
          ]).map((withBounce) => ({ history, target, withBounce })),
        );
    });
    fc.assert(
      fc.property(twoRecipients, ({ history, target, withBounce }) => {
        const targetKey = normalizeAddress(target);
        const others = (state: EmailState) =>
          state.recipients.filter((row) => row.recipientKey !== targetKey);
        const beforeBounce = projectEmail(history.emailId, history.events);
        // Every projectable event can name the same recipient, which leaves no other one to check.
        fc.pre(others(beforeBounce).length > 0);
        const afterBounce = projectEmail(history.emailId, withBounce);
        expect(others(afterBounce)).toEqual(others(beforeBounce));
        expect(afterBounce.recipients.find((row) => row.recipientKey === targetKey)?.status).toBe(
          'bounced',
        );
      }),
    );
  });
});
