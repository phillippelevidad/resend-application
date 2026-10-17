import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { type EmailEvent, emailEventSchema } from './email-event.schema.ts';
import type { LedgerEvent } from './ledger-event.ts';
import { maskAddress } from './mask-address.ts';
import { normalizeAddress } from './normalize-address.ts';
import { projectEmail } from './project-email.projection.ts';
import { projectRecipient, type RecipientState } from './project-recipient.projection.ts';
import type { EmailHistory } from './testing/email-history.ts';
import { type LedgerHistory, ledgerHistory } from './testing/ledger-history.ts';

// ---------------------------------------------------------------------------------------------
// The oracle (ADR-003 property 4). Deliberately naive and independent of both projections: it
// never reads an `email_recipients` row or its signal fields. It selects straight from the
// deduplicated events of every email: the strongest sticky event naming the recipient, else its
// latest delivery or soft bounce. Its own copy of the D1 order is written out here.
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

const stickyOrder = ['complained', 'suppressed', 'hard_bounced'] as const;

type OracleEvent = {
  emailId: string;
  svixId: string;
  time: number;
  parsed: EmailEvent;
  keys: readonly string[];
};

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
  return a.svixId < b.svixId;
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

// Every event that passes D3's skip rules, once per `svixId`, across all emails.
function projectable(emails: readonly EmailHistory[]): OracleEvent[] {
  const result: OracleEvent[] = [];
  for (const { emailId, events } of emails) {
    for (const row of events) {
      if (result.some((seen) => seen.svixId === row.svixId)) continue;
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
        emailId,
        svixId: row.svixId,
        time: row.eventCreatedAt.getTime(),
        parsed: parsed.data,
        keys: row.recipientKeys,
      });
    }
  }
  return result;
}

function oracleRecipient(key: string, all: OracleEvent[]): RecipientState {
  const named = all.filter((event) => event.keys.includes(key));
  const firstEmail = [...new Set(named.map((event) => event.emailId))].sort()[0];
  const first = earliest(named.filter((event) => event.emailId === firstEmail));
  const address = first?.parsed.data.to[first.keys.indexOf(key)] ?? '';
  const addressMasked = first === undefined ? '' : maskAddress(normalizeAddress(address));

  const stickyEvents = named.filter((event) => stickyOf(event) !== undefined);
  const top = Math.max(
    -1,
    ...stickyEvents.map((event) => stickyOrder.indexOf(stickyOf(event) ?? 'complained')),
  );
  const sticky = earliest(
    stickyEvents.filter((event) => stickyOrder.indexOf(stickyOf(event) ?? 'complained') === top),
  );
  if (sticky !== undefined) {
    return {
      recipientKey: key,
      addressMasked,
      deliverability: stickyOf(sticky) ?? 'complained',
      since: new Date(sticky.time),
      causeEmailId: sticky.emailId,
    };
  }
  const soft = latest(named.filter(isSoft));
  if (soft !== undefined) {
    return {
      recipientKey: key,
      addressMasked,
      deliverability: soft.parsed.type === 'email.delivered' ? 'ok' : 'soft_bouncing',
      since: new Date(soft.time),
      causeEmailId: soft.emailId,
    };
  }
  return {
    recipientKey: key,
    addressMasked,
    deliverability: 'ok',
    since: null,
    causeEmailId: null,
  };
}

function oracle(emails: readonly EmailHistory[]): RecipientState[] {
  const all = projectable(emails);
  const keys = [...new Set(all.flatMap((event) => event.keys))].sort((a, b) =>
    a < b ? -1 : a > b ? 1 : 0,
  );
  return keys.map((key) => oracleRecipient(key, all));
}

// ---------------------------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------------------------

// The production path: `projectEmail` per email, then `projectRecipient` per key over every row,
// in the order the emails come.
function projectAll(emails: readonly EmailHistory[]): RecipientState[] {
  const rows = emails.flatMap(({ emailId, events }) => projectEmail(emailId, events).recipients);
  const keys = [...new Set(rows.map((row) => row.recipientKey))].sort((a, b) =>
    a < b ? -1 : a > b ? 1 : 0,
  );
  return keys.map((key) => projectRecipient(key, rows));
}

function stickyPrecedence(deliverability: RecipientState['deliverability']): number {
  return stickyOrder.indexOf(deliverability as (typeof stickyOrder)[number]);
}

function permutation<T>(items: readonly T[]): fc.Arbitrary<T[]> {
  return fc.shuffledSubarray([...items], { minLength: items.length, maxLength: items.length });
}

// Every email's events permuted, and the emails themselves permuted, so rows reach
// `projectRecipient` in another order too.
function shuffled(history: LedgerHistory): fc.Arbitrary<EmailHistory[]> {
  return fc
    .tuple(
      ...history.emails.map(({ emailId, events }) =>
        permutation(events).map((permuted): EmailHistory => ({ emailId, events: permuted })),
      ),
    )
    .chain((emails) => permutation(emails));
}

const historyAndPermutation = ledgerHistory().chain((history) =>
  shuffled(history).map((permuted) => ({ history, permuted })),
);

const instant = (offset: number) =>
  new Date(Date.parse('2026-10-16T12:00:00.000Z') + offset * 1000);

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

// A non-`Permanent` bounce, in every shape D7 folds into `soft_bouncing`.
const softBounce = fc.oneof(
  fc.constantFrom('Transient', 'Temporary', 'Undetermined').map((type) => ({ bounce: { type } })),
  fc
    .string({ maxLength: 12 })
    .filter((type) => type !== 'Permanent')
    .map((type) => ({ bounce: { type } })),
  fc.constantFrom({}, { bounce: null }, { bounce: { type: null } }),
);

// ---------------------------------------------------------------------------------------------
// Properties
// ---------------------------------------------------------------------------------------------

describe('projectRecipient', () => {
  it('is permutation invariant: any arrival order of the events, and any order of the rows, gives equal deliverability (ADR-003 property 1)', () => {
    fc.assert(
      fc.property(historyAndPermutation, ({ history, permuted }) => {
        expect(projectAll(permuted)).toEqual(projectAll(history.emails));
      }),
    );
  });

  it('is idempotent under repeats: redelivered events change no deliverability, time or cause (ADR-003 property 2)', () => {
    const withRepeats = ledgerHistory().chain((history) =>
      fc
        .tuple(
          ...history.emails.map(({ emailId, events }) =>
            fc
              .subarray(events)
              // Redeliveries are distinct objects with the same `svixId`.
              .map((repeats) => repeats.map((event) => structuredClone(event)))
              .chain((repeats) => permutation([...events, ...repeats, ...repeats]))
              .map((repeated): EmailHistory => ({ emailId, events: repeated })),
          ),
        )
        .map((repeated) => ({ history, repeated })),
    );
    fc.assert(
      fc.property(withRepeats, ({ history, repeated }) => {
        expect(projectAll(repeated)).toEqual(projectAll(history.emails));
      }),
    );
  });

  it('is sticky monotone: adding events never makes a sticky deliverability non-sticky or lower (ADR-003 property 3)', () => {
    const subsetAndSet = ledgerHistory().chain((history) =>
      fc
        .tuple(
          ...history.emails.map(({ emailId, events }) =>
            fc.subarray(events).map((subset): EmailHistory => ({ emailId, events: subset })),
          ),
        )
        .map((subset) => ({ history, subset })),
    );
    fc.assert(
      fc.property(subsetAndSet, ({ history, subset }) => {
        const smaller = projectAll(subset);
        const larger = projectAll(history.emails);
        for (const state of smaller) {
          const grown = larger.find((other) => other.recipientKey === state.recipientKey);
          expect(grown).toBeDefined();
          if (stickyPrecedence(state.deliverability) >= 0) {
            expect(stickyPrecedence(grown?.deliverability ?? 'ok')).toBeGreaterThanOrEqual(
              stickyPrecedence(state.deliverability),
            );
          }
        }
      }),
    );
  });

  it('agrees with an oracle that reads the events directly, on every generated ledger, in any order (ADR-003 property 4)', () => {
    fc.assert(
      fc.property(historyAndPermutation, ({ permuted }) => {
        expect(projectAll(permuted)).toEqual(oracle(permuted));
      }),
    );
  });

  it('soft signals tied on created_at across two emails are ordered by rank, then svix_id, never by row order: a tied soft bounce outranks a tied delivery (ADR-003 tie-break, RS-U10)', () => {
    const address = 'bounced@resend.dev';
    const cases = fc.record({
      types: fc.tuple(
        fc.constantFrom('email.delivered', 'email.bounced'),
        fc.constantFrom('email.delivered', 'email.bounced'),
      ),
      // Either `svix_id` order against either type order, so rank and `svix_id` disagree too.
      svixIds: fc.constantFrom(['tie-a', 'tie-b'], ['tie-b', 'tie-a']),
      emailsReversed: fc.boolean(),
    });
    fc.assert(
      fc.property(cases, ({ types, svixIds, emailsReversed }) => {
        const emails: EmailHistory[] = (['tie-email-0', 'tie-email-1'] as const).map(
          (emailId, index) => ({
            emailId,
            events: [
              makeEvent(
                emailId,
                svixIds[index] ?? '',
                types[index] ?? '',
                [address],
                instant(0),
                types[index] === 'email.bounced' ? { bounce: { type: 'Transient' } } : {},
              ),
            ],
          }),
        );
        if (emailsReversed) emails.reverse();
        const [state] = projectAll(emails);
        expect(state).toEqual(oracle(emails)[0]);
        expect(state?.deliverability).toBe(
          types.includes('email.bounced') ? 'soft_bouncing' : 'ok',
        );
      }),
    );
  });

  it('only `Permanent` yields hard_bounced; any other bounce.type yields soft_bouncing (RS-U12)', () => {
    const bounce = fc.oneof(
      fc.constant({ bounce: { type: 'Permanent', subType: 'General' } }),
      // Near misses: only the exact string is hard (RS-35, D7).
      fc
        .constantFrom('permanent', 'PERMANENT', ' Permanent', 'Permanent ')
        .map((type) => ({ bounce: { type } })),
      softBounce,
    );
    const address = 'bounced@resend.dev';
    fc.assert(
      fc.property(bounce, fc.boolean(), (data, bounceFirst) => {
        const sent = makeEvent('rsu12-email', 'rsu12-sent', 'email.sent', [address], instant(0));
        const bounced = makeEvent(
          'rsu12-email',
          'rsu12-bounced',
          'email.bounced',
          [address],
          instant(1),
          data,
        );
        const events = bounceFirst ? [bounced, sent] : [sent, bounced];
        const [state] = projectAll([{ emailId: 'rsu12-email', events }]);
        const permanent = (data as { bounce?: { type?: unknown } | null }).bounce?.type;
        expect(state?.deliverability).toBe(
          permanent === 'Permanent' ? 'hard_bounced' : 'soft_bouncing',
        );
        expect(state?.since).toEqual(instant(1));
        expect(state?.causeEmailId).toBe('rsu12-email');
      }),
    );
  });

  it('a later delivery of the same email clears soft_bouncing, though that email’s status is bounced', () => {
    const address = 'delivered@resend.dev';
    const cases = fc.record({
      bounce: softBounce,
      bouncedAt: fc.nat(2),
      gap: fc.integer({ min: 1, max: 2 }),
      deliveryFirst: fc.boolean(),
    });
    fc.assert(
      fc.property(cases, ({ bounce, bouncedAt, gap, deliveryFirst }) => {
        const bounced = makeEvent(
          'clear-email',
          'clear-bounced',
          'email.bounced',
          [address],
          instant(bouncedAt),
          bounce,
        );
        const delivered = makeEvent(
          'clear-email',
          'clear-delivered',
          'email.delivered',
          [address],
          instant(bouncedAt + gap),
        );
        const events = deliveryFirst ? [delivered, bounced] : [bounced, delivered];
        expect(projectAll([{ emailId: 'clear-email', events: [bounced] }])[0]?.deliverability).toBe(
          'soft_bouncing',
        );
        const [state] = projectAll([{ emailId: 'clear-email', events }]);
        expect(state).toEqual({
          recipientKey: address,
          addressMasked: maskAddress(address),
          deliverability: 'ok',
          since: instant(bouncedAt + gap),
          causeEmailId: 'clear-email',
        });
        expect(projectEmail('clear-email', events).recipients[0]?.status).toBe('bounced');
      }),
    );
  });

  it('a sticky signal survives a later higher-ranked non-sticky event on the same email (suppressed then failed, complained then a Transient bounce), and a later delivery elsewhere', () => {
    const address = 'complained@resend.dev';
    const cases = fc.record({
      kind: fc.constantFrom('suppressed-then-failed', 'complained-then-transient'),
      stickyAt: fc.nat(2),
      gap: fc.nat(2),
      laterDelivery: fc.boolean(),
      order: fc.nat(5),
    });
    fc.assert(
      fc.property(cases, ({ kind, stickyAt, gap, laterDelivery, order }) => {
        const suppressedPair = kind === 'suppressed-then-failed';
        const sticky = makeEvent(
          'sticky-email',
          'sticky-first',
          suppressedPair ? 'email.suppressed' : 'email.complained',
          [address],
          instant(stickyAt),
        );
        const follower = suppressedPair
          ? makeEvent(
              'sticky-email',
              'sticky-second',
              'email.failed',
              [address],
              instant(stickyAt + gap),
              { failed: { reason: 'reached_daily_quota' } },
            )
          : makeEvent(
              'sticky-email',
              'sticky-second',
              'email.bounced',
              [address],
              instant(stickyAt + gap),
              { bounce: { type: 'Transient', subType: 'MailboxFull' } },
            );
        const pair = order % 2 === 0 ? [sticky, follower] : [follower, sticky];
        const emails: EmailHistory[] = [{ emailId: 'sticky-email', events: pair }];
        if (laterDelivery) {
          emails.push({
            emailId: 'sticky-other-email',
            events: [
              makeEvent(
                'sticky-other-email',
                'sticky-delivered',
                'email.delivered',
                [address],
                instant(stickyAt + gap + 1),
              ),
            ],
          });
        }
        if (order >= 3) emails.reverse();
        const [state] = projectAll(emails);
        expect(state?.deliverability).toBe(suppressedPair ? 'suppressed' : 'complained');
        expect(state?.since).toEqual(instant(stickyAt));
        expect(state?.causeEmailId).toBe('sticky-email');
        // The row's status moved on, which is why deliverability reads the sticky signal (C3).
        expect(projectEmail('sticky-email', pair).recipients[0]?.status).toBe(
          suppressedPair ? 'failed' : 'bounced',
        );
      }),
    );
  });
});
