import {
  type EmailStatus,
  emailStatusSchema,
  type SoftSignal,
  type StickySignal,
  softSignalSchema,
  stickySignalSchema,
} from '@ledger/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { emailRecipientsRepository } from './email-recipients.repository.ts';
import type { NewEmailRecipient } from './schema/email-recipients.ts';
import { createTestDatabase, sqlStateOf, type TestDatabase } from './testing.ts';

let t: TestDatabase;

beforeAll(async () => {
  t = await createTestDatabase();
});

afterAll(async () => {
  await t.drop();
});

// A keyed-hash-shaped key; the mask stands in for `maskAddress` output.
function hash(n: number): string {
  return `0000000${n % 10}.${String(n).padStart(64, '0')}`;
}

function recipientRow(
  emailId: string,
  overrides: Partial<NewEmailRecipient> = {},
): NewEmailRecipient {
  return { emailId, addressHash: hash(1), addressMasked: 'd*******@resend.dev', ...overrides };
}

async function stored(emailId: string) {
  return (await emailRecipientsRepository.listByEmail(t.db, emailId))[0];
}

describe('email_recipients as the runtime role', () => {
  it.each(emailStatusSchema.options)(
    'accepts every emailStatusSchema member: %s',
    async (status) => {
      const emailId = `email-status-${status}`;
      await emailRecipientsRepository.createIfAbsent(t.db, [recipientRow(emailId, { status })]);
      expect((await stored(emailId))?.status).toBe(status);
    },
  );

  it.each(stickySignalSchema.options)(
    'accepts every stickySignalSchema member: %s',
    async (stickySignal) => {
      const emailId = `email-sticky-${stickySignal}`;
      await emailRecipientsRepository.createIfAbsent(t.db, [
        recipientRow(emailId, { stickySignal }),
      ]);
      expect((await stored(emailId))?.stickySignal).toBe(stickySignal);
    },
  );

  it.each(softSignalSchema.options)(
    'accepts every softSignalSchema member: %s',
    async (softSignal) => {
      const emailId = `email-soft-${softSignal}`;
      await emailRecipientsRepository.createIfAbsent(t.db, [recipientRow(emailId, { softSignal })]);
      expect((await stored(emailId))?.softSignal).toBe(softSignal);
    },
  );

  it.each([
    ['status', { status: 'opened' as unknown as EmailStatus }],
    ['sticky_signal', { stickySignal: 'bounced' as unknown as StickySignal }],
    ['soft_signal', { softSignal: 'complained' as unknown as SoftSignal }],
  ] as const)('refuses a %s outside its core tuple with SQLSTATE 23514', async (column, value) => {
    const emailId = `email-outsider-${column}`;
    const insert = emailRecipientsRepository.createIfAbsent(t.db, [recipientRow(emailId, value)]);
    expect(await sqlStateOf(insert)).toBe('23514');
    expect(await stored(emailId)).toBeUndefined();
  });

  it('lists an email’s rows in code-unit address_hash order, whatever the insert order', async () => {
    const emailId = 'email-order';
    const hashes = [hash(3), hash(1), hash(2)];
    await emailRecipientsRepository.createIfAbsent(
      t.db,
      hashes.map((addressHash) => recipientRow(emailId, { addressHash })),
    );
    const listed = await emailRecipientsRepository.listByEmail(t.db, emailId);
    expect(listed.map((row) => row.addressHash)).toEqual([hash(1), hash(2), hash(3)]);
    await t.db.transaction((tx) => emailRecipientsRepository.lockRows(tx, emailId, hashes));
    expect(await emailRecipientsRepository.listByAddressHash(t.db, hash(3))).toHaveLength(1);
  });
});
