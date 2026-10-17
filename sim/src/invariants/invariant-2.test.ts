import { hashAddress, type LedgerEvent, maskAddress, maskFrom, maskText } from '@ledger/core';
import { type LedgerHistory, ledgerHistory } from '@ledger/core/testing';
import { describe, expect, it } from 'vitest';
import { sampleOnce } from '../sample-once.ts';
import {
  checkInvariant2,
  type ExpectedLedger,
  expectedLedger,
  type StoredLedger,
} from './invariant-2.ts';

const key = new Uint8Array(32).fill(7);
const delivered = 'delivered+walk-0@resend.dev';
const bounced = 'bounced+walk-1@resend.dev';
const deliveredHash = hashAddress(key, delivered);
const bouncedHash = hashAddress(key, bounced);
const at = (second: number) => new Date(Date.UTC(2026, 9, 17, 12, 0, second));

function event(
  emailId: string,
  svixId: string,
  type: string,
  to: string[],
  second: number,
  extra: Record<string, unknown> = {},
): LedgerEvent {
  const createdAt = at(second);
  return {
    svixId,
    type,
    eventCreatedAt: createdAt,
    recipientKeys: to,
    payload: {
      type,
      created_at: createdAt.toISOString(),
      data: { email_id: emailId, to, ...extra },
    },
  };
}

// Three emails: one sent, delivered to one recipient and hard-bounced by the other; one with no
// projectable event (no `email_state` row); one that soft-bounces the first recipient later, so its
// `recipient_state` is decided across emails.
const history: LedgerHistory = {
  emails: [
    {
      emailId: 'walk-email-0',
      events: [
        event('walk-email-0', 'walk-svix-0-0', 'email.sent', [delivered, bounced], 0, {
          from: 'onboarding@resend.dev',
          subject: 'Ledger walk',
        }),
        event('walk-email-0', 'walk-svix-0-1', 'email.delivered', [delivered], 1),
        event('walk-email-0', 'walk-svix-0-2', 'email.bounced', [bounced], 2, {
          bounce: { type: 'Permanent', subType: 'General' },
        }),
      ],
    },
    {
      emailId: 'walk-email-1',
      events: [event('walk-email-1', 'walk-svix-1-0', 'contact.created', [delivered], 0)],
    },
    {
      emailId: 'walk-email-2',
      events: [
        event('walk-email-2', 'walk-svix-2-0', 'email.bounced', [delivered], 3, {
          bounce: { type: 'Transient', subType: 'MailboxFull' },
        }),
      ],
    },
  ],
};

const noSignals = {
  bounceType: null,
  bounceSubType: null,
  stickySignal: null,
  stickySignalAt: null,
  stickySignalSvixId: null,
  softSignal: null,
  softSignalAt: null,
  softSignalSvixId: null,
};

// The rows the worker should hold for `history`, written out by hand from D3–D7, not derived from
// the checker's own projection.
function storedRows(): StoredLedger {
  return {
    emailStates: [
      {
        emailId: 'walk-email-0',
        status: 'bounced',
        fromMasked: maskFrom('onboarding@resend.dev'),
        subjectMasked: maskText('Ledger walk'),
        openCount: 0,
        clickCount: 0,
        firstOpenedAt: null,
        firstClickedAt: null,
        lastEventAt: at(2),
        eventCount: 3,
      },
      {
        emailId: 'walk-email-2',
        status: 'bounced',
        fromMasked: null,
        subjectMasked: null,
        openCount: 0,
        clickCount: 0,
        firstOpenedAt: null,
        firstClickedAt: null,
        lastEventAt: at(3),
        eventCount: 1,
      },
    ],
    emailRecipients: [
      {
        ...noSignals,
        emailId: 'walk-email-0',
        addressHash: deliveredHash,
        addressMasked: maskAddress(delivered),
        status: 'delivered',
        statusAt: at(1),
        softSignal: 'delivered',
        softSignalAt: at(1),
        softSignalSvixId: 'walk-svix-0-1',
      },
      {
        ...noSignals,
        emailId: 'walk-email-0',
        addressHash: bouncedHash,
        addressMasked: maskAddress(bounced),
        status: 'bounced',
        statusAt: at(2),
        bounceType: 'Permanent',
        bounceSubType: 'General',
        stickySignal: 'hard_bounced',
        stickySignalAt: at(2),
        stickySignalSvixId: 'walk-svix-0-2',
      },
      {
        ...noSignals,
        emailId: 'walk-email-2',
        addressHash: deliveredHash,
        addressMasked: maskAddress(delivered),
        status: 'bounced',
        statusAt: at(3),
        bounceType: 'Transient',
        bounceSubType: 'MailboxFull',
        softSignal: 'bounced',
        softSignalAt: at(3),
        softSignalSvixId: 'walk-svix-2-0',
      },
    ],
    recipientStates: [
      {
        addressHash: deliveredHash,
        addressMasked: maskAddress(delivered),
        deliverability: 'soft_bouncing',
        since: at(3),
        causeEmailId: 'walk-email-2',
      },
      {
        addressHash: bouncedHash,
        addressMasked: maskAddress(bounced),
        deliverability: 'hard_bounced',
        since: at(2),
        causeEmailId: 'walk-email-0',
      },
    ],
  };
}

// The rows a correct worker writes for any expected ledger: no `email_state` row for an email with
// no projectable event (D14 step 4).
function rowsOf(expected: ExpectedLedger): StoredLedger {
  return {
    emailStates: expected.emails
      .filter(({ eventCount }) => eventCount > 0)
      .map(({ recipients: _recipients, ...state }) => ({
        ...state,
        lastEventAt: state.lastEventAt ?? new Date(0),
      })),
    emailRecipients: expected.emails.flatMap(({ recipients }) =>
      recipients.map(({ recipientKey, ...row }) => ({ ...row, addressHash: recipientKey })),
    ),
    recipientStates: expected.recipients.map(({ recipientKey, ...state }) => ({
      ...state,
      addressHash: recipientKey,
    })),
  };
}

describe('invariant 2: stored projections equal the projection of the ground truth', () => {
  it('passes when every row equals the ground truth, an email with no projectable event and no email_state row included', () => {
    const result = checkInvariant2(expectedLedger(history, key), storedRows());

    expect(result.pass).toBe(true);
    expect(result.line).toBe('invariant 2 pass emails=3 recipients=2');
  });

  it('passes over a labelled simulator history whose rows a correct worker wrote', () => {
    const sampled = sampleOnce(ledgerHistory({ namespace: 'walk', labelEveryAddress: true }), 42);
    const expected = expectedLedger(sampled, key);

    const result = checkInvariant2(expected, rowsOf(expected));

    expect(result.line).toBe(
      `invariant 2 pass emails=${sampled.emails.length} recipients=${expected.recipients.length}`,
    );
  });

  it('fails naming the email whose email_recipients row differs from the ground truth', () => {
    const stored = storedRows();
    stored.emailRecipients = stored.emailRecipients.map((row) =>
      row.addressHash === bouncedHash ? { ...row, statusAt: at(1) } : row,
    );

    const result = checkInvariant2(expectedLedger(history, key), stored);

    expect(result.pass).toBe(false);
    expect(result.line).toBe('invariant 2 fail email_ids=walk-email-0');
  });

  // An order-dependent fold would keep the delivery it saw last; the latest soft signal is the
  // later bounce on another email (D6), so `ok` is wrong whatever order the events came in.
  it('fails naming every email of the recipient whose recipient_state differs', () => {
    const stored = storedRows();
    stored.recipientStates = stored.recipientStates.map((row) =>
      row.addressHash === deliveredHash
        ? { ...row, deliverability: 'ok', since: at(1), causeEmailId: 'walk-email-0' }
        : row,
    );

    const result = checkInvariant2(expectedLedger(history, key), stored);

    expect(result.pass).toBe(false);
    expect(result.line).toBe('invariant 2 fail email_ids=walk-email-0,walk-email-2');
  });

  it('fails when a projectable email has no email_state row', () => {
    const stored = storedRows();
    stored.emailStates = stored.emailStates.filter(({ emailId }) => emailId !== 'walk-email-2');

    const result = checkInvariant2(expectedLedger(history, key), stored);

    expect(result.pass).toBe(false);
    expect(result.line).toBe('invariant 2 fail email_ids=walk-email-2');
  });

  it('fails when the ledger holds a recipient row the ground truth never named', () => {
    const stored = storedRows();
    const extra = stored.emailRecipients[0];
    stored.emailRecipients = [
      ...stored.emailRecipients,
      ...(extra === undefined ? [] : [{ ...extra, emailId: 'walk-email-1' }]),
    ];

    const result = checkInvariant2(expectedLedger(history, key), stored);

    expect(result.pass).toBe(false);
    expect(result.line).toBe('invariant 2 fail email_ids=walk-email-1');
  });

  it('never prints a keyed hash or an address in its line', () => {
    const stored = storedRows();
    stored.recipientStates = [];

    const { line } = checkInvariant2(expectedLedger(history, key), stored);

    for (const secret of [deliveredHash, bouncedHash, delivered, bounced]) {
      expect(line).not.toContain(secret);
    }
  });
});
