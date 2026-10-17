import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { Deliverability } from '../deliverability.schema.ts';
import type { EmailStatus } from '../email-status.schema.ts';
import type { LedgerEvent } from '../ledger-event.ts';
import { projectEmail } from '../project-email.projection.ts';
import { projectRecipient } from '../project-recipient.projection.ts';
import { testLocalParts } from './email-history.ts';
import { ledgerHistory } from './ledger-history.ts';
import { testAddressSequences } from './test-address-sequences.ts';

// D39: what each observed sequence (RS-39) implies once projected. `complained` stays complained
// although `email.delivered` came after it (D1's precedence, sticky deliverability).
const implied: Record<
  (typeof testLocalParts)[number],
  { status: EmailStatus; deliverability: Deliverability }
> = {
  delivered: { status: 'delivered', deliverability: 'ok' },
  bounced: { status: 'bounced', deliverability: 'hard_bounced' },
  complained: { status: 'complained', deliverability: 'complained' },
  suppressed: { status: 'suppressed', deliverability: 'suppressed' },
};

// The history `pnpm sim` generates: every address labelled, the observed emails appended.
const [history] = fc.sample(ledgerHistory({ namespace: 'obs', labelEveryAddress: true }), {
  seed: 20261017,
  numRuns: 1,
});

function observedEmail(local: string) {
  return history?.emails.find(({ emailId }) => emailId === `obs-observed-${local}`);
}

// Every order of a sequence's events: Resend promises no delivery order (RS-07).
function orders(events: readonly LedgerEvent[]): LedgerEvent[][] {
  if (events.length <= 1) {
    return [[...events]];
  }
  return events.flatMap((event, index) =>
    orders(events.filter((_, other) => other !== index)).map((rest) => [event, ...rest]),
  );
}

describe('testAddressSequences', () => {
  it('records the observed sequence of every test address (RS-39)', () => {
    expect(
      testLocalParts.map((local) =>
        testAddressSequences[local].map(({ type, bounce }) => ({ type, bounce })),
      ),
    ).toEqual([
      [
        { type: 'email.sent', bounce: undefined },
        { type: 'email.delivered', bounce: undefined },
      ],
      [
        { type: 'email.sent', bounce: undefined },
        { type: 'email.bounced', bounce: { type: 'Permanent', subType: 'General' } },
      ],
      [
        { type: 'email.sent', bounce: undefined },
        { type: 'email.complained', bounce: undefined },
        { type: 'email.delivered', bounce: undefined },
      ],
      [{ type: 'email.suppressed', bounce: undefined }],
    ]);
  });

  it.each(testLocalParts)(
    'the observed %s sequence, appended to a labelled history, projects to the status and deliverability its observation implies in every delivery order',
    (local) => {
      const email = observedEmail(local);
      expect(email?.events.map(({ type }) => type)).toEqual(
        testAddressSequences[local].map(({ type }) => type),
      );
      const [key] = email?.events[0]?.recipientKeys ?? [];
      expect(key).toBe(`${local}+obs-10@resend.dev`);

      for (const order of orders(email?.events ?? [])) {
        const state = projectEmail(`obs-observed-${local}`, order);
        expect(state.status).toBe(implied[local].status);
        const recipient = projectRecipient(key ?? '', state.recipients);
        expect(recipient).toMatchObject({
          deliverability: implied[local].deliverability,
          causeEmailId: `obs-observed-${local}`,
        });
      }
    },
  );

  it('appends one observed email per test address after the probe, sharing no recipient with any other email', () => {
    const emailIds = history?.emails.map(({ emailId }) => emailId) ?? [];
    expect(emailIds.slice(-5)).toEqual([
      'obs-probe',
      ...testLocalParts.map((local) => `obs-observed-${local}`),
    ]);
    for (const local of testLocalParts) {
      const keys = new Set(observedEmail(local)?.events.flatMap((e) => e.recipientKeys ?? []));
      const elsewhere = (history?.emails ?? [])
        .filter(({ emailId }) => emailId !== `obs-observed-${local}`)
        .flatMap(({ events }) => events.flatMap((event) => event.recipientKeys ?? []));
      expect(elsewhere.filter((key) => keys.has(key))).toEqual([]);
    }
  });
});
