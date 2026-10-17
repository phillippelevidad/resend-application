import { hashAddress, maskAddress, maskFrom, maskText } from '@ledger/core';
import {
  emailRecipientsRepository,
  emailStateRepository,
  type NewWebhookEvent,
  webhookEventsRepository,
} from '@ledger/db';
import { createTestDatabase, type TestDatabase } from '@ledger/db/testing';
import { createLogger } from '@ledger/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApi } from './create-api.ts';
import type { EmailResponse } from './email-response.schema.ts';
import type { ErrorResponse } from './error-response.schema.ts';

// Mandatory redaction (pp-workflow → Test tiers): `email.get`'s mapper reads `webhook_events`, so
// it is fed a stored payload with a `delivered@resend.dev` recipient and a subject, and the
// response must hold neither. Rows are seeded through the repositories, as the worker writes them.

let t: TestDatabase;
let api: ReturnType<typeof createApi>;

const addressHashKey = new Uint8Array(32).fill(7);
const DELIVERED = 'delivered@resend.dev';
const BOUNCED = 'bounced@resend.dev';
const FROM = 'Acme Receipts <onboarding@resend.dev>';
const SUBJECT = 'Your receipt for order 4471';

beforeAll(async () => {
  t = await createTestDatabase();
  api = createApi({
    db: t.db,
    logger: createLogger({ functionName: 'api', stream: { write: () => {} } }),
    addressHashKey,
    requestId: () => 'req-email-get',
  });
});

afterAll(async () => {
  await t.drop();
});

type SeedEvent = {
  svixId: string;
  type: string;
  createdAt: string | null;
  to: string[];
  bounce?: { type: string; subType: string; message: string; diagnosticCode: string[] };
};

// One stored ledger row as D17 writes it: the full payload, `to_hashes` in `data.to`'s positions.
function ledgerRow(emailId: string, event: SeedEvent): NewWebhookEvent {
  const data: Record<string, unknown> = {
    email_id: emailId,
    to: event.to,
    from: FROM,
    subject: SUBJECT,
  };
  if (event.bounce !== undefined) {
    data.bounce = event.bounce;
  }
  return {
    svixId: event.svixId,
    type: event.type,
    eventCreatedAt: event.createdAt === null ? null : new Date(event.createdAt),
    receivedAt: new Date('2026-10-17T12:01:00.000Z'),
    emailId,
    toHashes: event.to.map((address) => hashAddress(addressHashKey, address)),
    source: 'simulated',
    payload: { type: event.type, created_at: event.createdAt ?? 'not-a-date', data },
  };
}

async function seedLedger(emailId: string, events: SeedEvent[]): Promise<void> {
  for (const event of events) {
    expect(await webhookEventsRepository.insertIfAbsent(t.db, ledgerRow(emailId, event))).toBe(
      true,
    );
  }
}

// The projection rows the worker would commit for a two-recipient email where the first address
// was delivered and the second hard-bounced (RS-28, RS-35).
async function seedBouncedEmail(emailId: string): Promise<void> {
  await seedLedger(emailId, [
    {
      svixId: `msg_${emailId}_sent`,
      type: 'email.sent',
      createdAt: '2026-10-17T12:00:00.000Z',
      to: [DELIVERED, BOUNCED],
    },
    {
      svixId: `msg_${emailId}_delivered`,
      type: 'email.delivered',
      createdAt: '2026-10-17T12:00:01.000Z',
      to: [DELIVERED],
    },
    {
      svixId: `msg_${emailId}_bounced`,
      type: 'email.bounced',
      createdAt: '2026-10-17T12:00:02.000Z',
      to: [BOUNCED],
      bounce: {
        type: 'Permanent',
        subType: 'General',
        message: `The recipient ${BOUNCED} does not exist.`,
        diagnosticCode: [`smtp; 550 5.1.1 <${BOUNCED}>: user unknown`],
      },
    },
  ]);
  const lastEventAt = new Date('2026-10-17T12:00:02.000Z');
  await emailStateRepository.createIfAbsent(t.db, { emailId, lastEventAt });
  await emailStateRepository.update(t.db, emailId, {
    status: 'bounced',
    fromMasked: maskFrom(FROM),
    subjectMasked: maskText(SUBJECT),
    openCount: 0,
    clickCount: 0,
    firstOpenedAt: null,
    firstClickedAt: null,
    lastEventAt,
    eventCount: 3,
  });
  const recipients = [
    {
      address: DELIVERED,
      status: 'delivered' as const,
      statusAt: new Date('2026-10-17T12:00:01.000Z'),
      bounceType: null,
      bounceSubType: null,
    },
    {
      address: BOUNCED,
      status: 'bounced' as const,
      statusAt: lastEventAt,
      bounceType: 'Permanent',
      bounceSubType: 'General',
    },
  ];
  await emailRecipientsRepository.createIfAbsent(
    t.db,
    recipients.map(({ address }) => ({
      emailId,
      addressHash: hashAddress(addressHashKey, address),
      addressMasked: maskAddress(address),
    })),
  );
  for (const { address, status, statusAt, bounceType, bounceSubType } of recipients) {
    await emailRecipientsRepository.update(t.db, emailId, hashAddress(addressHashKey, address), {
      addressMasked: maskAddress(address),
      status,
      statusAt,
      bounceType,
      bounceSubType,
      stickySignal: status === 'bounced' ? 'hard_bounced' : null,
      stickySignalAt: status === 'bounced' ? statusAt : null,
      stickySignalSvixId: status === 'bounced' ? `msg_${emailId}_bounced` : null,
      softSignal: status === 'delivered' ? 'delivered' : null,
      softSignalAt: status === 'delivered' ? statusAt : null,
      softSignalSvixId: status === 'delivered' ? `msg_${emailId}_delivered` : null,
    });
  }
}

// A `200` body or an error body, by status; both typed so each test reads the fields it asserts.
type Answer = { status: number; text: string; body: EmailResponse & ErrorResponse };

async function getEmail(emailId: string): Promise<Answer> {
  const response = await api.request(`/emails/${emailId}`);
  const text = await response.text();
  return { status: response.status, text, body: JSON.parse(text) };
}

describe('email.get', () => {
  it('a bounced two-recipient email answers its status, both recipients and three timeline items', async () => {
    await seedBouncedEmail('email-bounced');

    const { status, body } = await getEmail('email-bounced');

    expect(status).toBe(200);
    expect(body).toMatchObject({
      object: 'email',
      email_id: 'email-bounced',
      status: 'bounced',
      from_masked: maskFrom(FROM),
      subject_masked: maskText(SUBJECT),
      open_count: 0,
      click_count: 0,
      first_opened_at: null,
      first_clicked_at: null,
      last_event_at: '2026-10-17T12:00:02.000Z',
      event_count: 3,
    });
    expect(body.recipients).toHaveLength(2);
    expect(body.recipients).toEqual(
      expect.arrayContaining([
        {
          address_masked: maskAddress(DELIVERED),
          status: 'delivered',
          status_at: '2026-10-17T12:00:01.000Z',
          bounce_type: null,
          bounce_sub_type: null,
        },
        {
          address_masked: maskAddress(BOUNCED),
          status: 'bounced',
          status_at: '2026-10-17T12:00:02.000Z',
          bounce_type: 'Permanent',
          bounce_sub_type: 'General',
        },
      ]),
    );
    expect(body.timeline).toEqual([
      {
        svix_id: 'msg_email-bounced_sent',
        type: 'email.sent',
        event_created_at: '2026-10-17T12:00:00.000Z',
        bounce_type: null,
        bounce_sub_type: null,
      },
      {
        svix_id: 'msg_email-bounced_delivered',
        type: 'email.delivered',
        event_created_at: '2026-10-17T12:00:01.000Z',
        bounce_type: null,
        bounce_sub_type: null,
      },
      {
        svix_id: 'msg_email-bounced_bounced',
        type: 'email.bounced',
        event_created_at: '2026-10-17T12:00:02.000Z',
        bounce_type: 'Permanent',
        bounce_sub_type: 'General',
      },
    ]);
  });

  it('the response holds no raw address, from or subject, and no bounce diagnostics (redaction)', async () => {
    await seedBouncedEmail('email-redaction');

    const { status, text } = await getEmail('email-redaction');

    expect(status).toBe(200);
    for (const raw of [DELIVERED, BOUNCED, 'onboarding@resend.dev', 'Acme Receipts', SUBJECT]) {
      expect(text).not.toContain(raw);
    }
    expect(text).not.toContain('user unknown');
    expect(text).not.toContain('does not exist');
    expect(text).not.toContain(hashAddress(addressHashKey, DELIVERED));
    expect(text).not.toMatch(/"(to|payload|address_hash|sticky_signal|soft_signal)"/);
  });

  it('rows stored out of order come back in fold order: created_at nulls last, then rank, then svix_id', async () => {
    const emailId = 'email-fold-order';
    // Insertion order differs from the fold order, and the svix ids sort against it: the tie at
    // 12:00:00 is broken by rank (sent before delivered), never by svix_id or arrival.
    await seedLedger(emailId, [
      {
        svixId: 'msg_a_unparsable',
        type: 'email.delivered',
        createdAt: null,
        to: [DELIVERED],
      },
      {
        svixId: 'msg_b_opened',
        type: 'email.opened',
        createdAt: '2026-10-17T12:00:05.000Z',
        to: [DELIVERED],
      },
      {
        svixId: 'msg_c_delivered',
        type: 'email.delivered',
        createdAt: '2026-10-17T12:00:00.000Z',
        to: [DELIVERED],
      },
      {
        svixId: 'msg_d_sent',
        type: 'email.sent',
        createdAt: '2026-10-17T12:00:00.000Z',
        to: [DELIVERED],
      },
    ]);

    const { status, body } = await getEmail(emailId);

    expect(status).toBe(200);
    expect(body.timeline.map((item) => item.svix_id)).toEqual([
      'msg_d_sent',
      'msg_c_delivered',
      'msg_b_opened',
      'msg_a_unparsable',
    ]);
    expect(body.timeline[3]?.event_created_at).toBeNull();
  });

  it('an email whose events were all unprojectable answers 200 with status null, zero counts and no recipients', async () => {
    const emailId = 'email-unprojectable';
    await seedLedger(emailId, [
      { svixId: 'msg_unprojectable_1', type: 'email.sent', createdAt: null, to: [DELIVERED] },
    ]);

    const { status, body } = await getEmail(emailId);

    expect(status).toBe(200);
    expect(body).toEqual({
      object: 'email',
      email_id: emailId,
      status: null,
      from_masked: null,
      subject_masked: null,
      open_count: 0,
      click_count: 0,
      first_opened_at: null,
      first_clicked_at: null,
      last_event_at: null,
      event_count: 0,
      recipients: [],
      timeline: [
        {
          svix_id: 'msg_unprojectable_1',
          type: 'email.sent',
          event_created_at: null,
          bounce_type: null,
          bounce_sub_type: null,
        },
      ],
    });
  });

  it('an id no ledger row holds answers 404 email_not_found in the error shape', async () => {
    const { status, body } = await getEmail('no-such-email');

    expect(status).toBe(404);
    expect(body).toEqual({
      error: {
        code: 'email_not_found',
        message: 'No event has been recorded for this email id.',
        hint: 'Events may still be queued, or missed: run `ledger gaps`.',
        docs: 'https://github.com/phillippelevidad/resend-application/blob/main/docs/runbook.md#email_not_found',
      },
    });
  });

  it.each(['bad%20id', 'bad!', 'x'.repeat(129)])(
    'a malformed id (%s) answers 400 validation_failed naming email_id, never its value',
    async (emailId) => {
      const { status, body } = await getEmail(emailId);

      expect(status).toBe(400);
      expect(body.error).toEqual({
        code: 'validation_failed',
        message: "email_id must be 1 to 128 characters from A-Z, a-z, 0-9, '.', '_' and '-'.",
        hint: 'Fix the field the message names, then retry.',
        docs: 'https://github.com/phillippelevidad/resend-application/blob/main/docs/runbook.md#validation_failed',
      });
    },
  );
});
