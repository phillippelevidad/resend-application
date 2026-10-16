import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { LedgerEvent } from './ledger-event.ts';
import { normalizeAddress } from './normalize-address.ts';
import { projectEmail } from './project-email.projection.ts';

type Payload = { type: string; created_at: string; data: Record<string, unknown> };

// D12's Resend fixtures, which all name this email and `delivered@resend.dev`.
const emailId = '56761188-7520-42d8-8898-ff6fc54ce618';

function fixture(slug: string): Payload {
  return JSON.parse(
    readFileSync(new URL(`./fixtures/resend/email-${slug}.json`, import.meta.url), 'utf8'),
  );
}

function stored(
  svixId: string,
  payload: Payload,
  overrides: Partial<LedgerEvent> = {},
): LedgerEvent {
  const to = Array.isArray(payload.data.to) ? (payload.data.to as string[]) : [];
  return {
    svixId,
    type: payload.type,
    eventCreatedAt: new Date(payload.created_at),
    recipientKeys: to.map(normalizeAddress),
    payload,
    ...overrides,
  };
}

function withData(slug: string, data: Record<string, unknown>): Payload {
  const payload = fixture(slug);
  return { ...payload, data: { ...payload.data, ...data } };
}

const base: LedgerEvent[] = [
  stored('svix-sent', fixture('sent')),
  stored('svix-delivered', fixture('delivered')),
  stored('svix-opened', fixture('opened')),
];

// Each would make the email `bounced` if it were projected, so an equal projection proves the skip.
const unprojectable: [name: string, event: LedgerEvent][] = [
  [
    'an unknown type',
    stored('svix-unknown', { ...fixture('bounced'), type: 'email.unknown_new_type' }),
  ],
  ['email.received, an inbound type (RS-30)', stored('svix-received', fixture('received'))],
  [
    'a schema-failing payload of a known type',
    stored('svix-bad-to', withData('bounced', { to: 'delivered@resend.dev' }), {
      recipientKeys: ['delivered@resend.dev'],
    }),
  ],
  ['a payload that is not an object', stored('svix-null', fixture('bounced'), { payload: null })],
  ['a null eventCreatedAt', stored('svix-no-time', fixture('bounced'), { eventCreatedAt: null })],
  [
    'an invalid eventCreatedAt',
    stored('svix-bad-time', fixture('bounced'), { eventCreatedAt: new Date('not a time') }),
  ],
  [
    'another email_id',
    stored('svix-other-email', withData('bounced', { email_id: 'another-email' })),
  ],
  [
    'recipientKeys shorter than data.to',
    stored('svix-short-keys', fixture('bounced'), { recipientKeys: [] }),
  ],
  [
    'recipientKeys longer than data.to',
    stored('svix-long-keys', fixture('bounced'), {
      recipientKeys: ['delivered@resend.dev', 'bounced@resend.dev'],
    }),
  ],
  ['null recipientKeys', stored('svix-null-keys', fixture('bounced'), { recipientKeys: null })],
  [
    'a stored type that differs from the payload type',
    stored('svix-mismatch', fixture('opened'), { type: 'email.bounced' }),
  ],
];

describe('projectEmail on Resend’s documented examples', () => {
  it('leaves status null on opens and clicks alone, and counts them (C9: never inferred from engagement)', () => {
    const state = projectEmail(emailId, [
      stored('svix-opened', fixture('opened')),
      stored('svix-clicked', fixture('clicked')),
    ]);
    expect(state.status).toBeNull();
    expect(state.recipients[0]?.status).toBeNull();
    expect([state.openCount, state.clickCount, state.eventCount]).toEqual([1, 1, 2]);
  });

  it('ranks a complaint above delivery (D1, RS-29)', () => {
    const state = projectEmail(emailId, [
      stored('svix-complained', fixture('complained')),
      stored('svix-delivered', fixture('delivered')),
    ]);
    expect(state.status).toBe('complained');
    expect(state.recipients[0]?.stickySignal).toBe('complained');
    expect(state.recipients[0]?.softSignal).toBe('delivered');
  });
});

describe('projectEmail skips an unprojectable event, never throws (ADR-004, R8)', () => {
  it('projects the same bounce when it is well formed, so each skip below is observable', () => {
    const bounced = projectEmail(emailId, [...base, stored('svix-bounced', fixture('bounced'))]);
    expect(bounced.status).toBe('bounced');
    expect(projectEmail(emailId, base).status).toBe('delivered');
  });

  it.each(unprojectable)('%s leaves the projection equal', (_name, event) => {
    expect(() => projectEmail(emailId, [...base, event])).not.toThrow();
    expect(projectEmail(emailId, [...base, event])).toEqual(projectEmail(emailId, base));
  });

  it('projects an empty state, with null status (C9), from a set holding only unprojectable events', () => {
    const state = projectEmail(
      emailId,
      unprojectable.map(([, event]) => event),
    );
    expect(state).toEqual({
      emailId,
      status: null,
      fromMasked: null,
      subjectMasked: null,
      openCount: 0,
      clickCount: 0,
      firstOpenedAt: null,
      firstClickedAt: null,
      lastEventAt: null,
      eventCount: 0,
      recipients: [],
    });
  });
});
