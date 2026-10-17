import { type Deliverability, deliverabilitySchema } from '@ledger/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { recipientStateRepository } from './recipient-state.repository.ts';
import { createTestDatabase, sqlStateOf, type TestDatabase } from './testing.ts';

let t: TestDatabase;

beforeAll(async () => {
  t = await createTestDatabase();
});

afterAll(async () => {
  await t.drop();
});

// A keyed-hash-shaped key, distinct per member.
function hash(label: string): string {
  return `00000000.${Buffer.from(label).toString('hex').padStart(64, '0')}`;
}

const addressMasked = 'd*******@resend.dev';

describe('recipient_state as the runtime role', () => {
  it.each(deliverabilitySchema.options)(
    'accepts every deliverabilitySchema member: %s',
    async (deliverability) => {
      const addressHash = hash(deliverability);
      await recipientStateRepository.createIfAbsent(t.db, [
        { addressHash, addressMasked, deliverability },
      ]);
      expect((await recipientStateRepository.get(t.db, addressHash))?.deliverability).toBe(
        deliverability,
      );
    },
  );

  it('refuses a deliverability outside deliverabilitySchema with SQLSTATE 23514', async () => {
    const addressHash = hash('outsider');
    const deliverability = 'bounced' as unknown as Deliverability;
    const insert = recipientStateRepository.createIfAbsent(t.db, [
      { addressHash, addressMasked, deliverability },
    ]);
    expect(await sqlStateOf(insert)).toBe('23514');
    expect(await recipientStateRepository.get(t.db, addressHash)).toBeUndefined();
  });

  it('createIfAbsent leaves an existing row unchanged, and update overwrites it', async () => {
    const addressHash = hash('update');
    await recipientStateRepository.createIfAbsent(t.db, [
      { addressHash, addressMasked, deliverability: 'ok' },
    ]);
    const since = new Date('2026-10-17T12:00:00.000Z');
    await recipientStateRepository.update(t.db, addressHash, {
      addressMasked,
      deliverability: 'hard_bounced',
      since,
      causeEmailId: 'email-cause',
    });
    await t.db.transaction((tx) => recipientStateRepository.lockRecipients(tx, [addressHash]));
    await recipientStateRepository.createIfAbsent(t.db, [
      { addressHash, addressMasked, deliverability: 'ok' },
    ]);
    const [row] = await recipientStateRepository.listByAddressHashes(t.db, [addressHash]);
    expect(row?.deliverability).toBe('hard_bounced');
    expect(row?.since).toEqual(since);
  });
});
