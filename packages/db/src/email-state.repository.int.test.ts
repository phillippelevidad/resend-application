import { type EmailStatus, emailStatusSchema } from '@ledger/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { emailStateRepository } from './email-state.repository.ts';
import { createTestDatabase, sqlStateOf, type TestDatabase } from './testing.ts';

let t: TestDatabase;

beforeAll(async () => {
  t = await createTestDatabase();
});

afterAll(async () => {
  await t.drop();
});

const lastEventAt = new Date('2026-10-17T12:00:00.000Z');

describe('email_state as the runtime role', () => {
  it.each(emailStatusSchema.options)(
    'accepts every emailStatusSchema member: %s',
    async (status) => {
      const emailId = `email-status-${status}`;
      await emailStateRepository.createIfAbsent(t.db, { emailId, status, lastEventAt });
      expect((await emailStateRepository.get(t.db, emailId))?.status).toBe(status);
    },
  );

  it('accepts a null status: no outcome event yet', async () => {
    await emailStateRepository.createIfAbsent(t.db, { emailId: 'email-status-null', lastEventAt });
    expect((await emailStateRepository.get(t.db, 'email-status-null'))?.status).toBeNull();
  });

  it('refuses a status outside emailStatusSchema with SQLSTATE 23514', async () => {
    const status = 'opened' as unknown as EmailStatus;
    const insert = emailStateRepository.createIfAbsent(t.db, {
      emailId: 'email-status-outsider',
      status,
      lastEventAt,
    });
    expect(await sqlStateOf(insert)).toBe('23514');
    expect(await emailStateRepository.get(t.db, 'email-status-outsider')).toBeUndefined();
  });

  it('createIfAbsent leaves an existing row unchanged, and update overwrites it', async () => {
    const emailId = 'email-update';
    await emailStateRepository.createIfAbsent(t.db, { emailId, lastEventAt });
    await emailStateRepository.update(t.db, emailId, {
      status: 'delivered',
      fromMasked: 'd*******@resend.dev',
      subjectMasked: null,
      openCount: 2,
      clickCount: 1,
      firstOpenedAt: lastEventAt,
      firstClickedAt: lastEventAt,
      lastEventAt,
      eventCount: 4,
    });
    await emailStateRepository.createIfAbsent(t.db, { emailId, lastEventAt, status: 'sent' });
    const row = await emailStateRepository.get(t.db, emailId);
    expect(row?.status).toBe('delivered');
    expect(row?.eventCount).toBe(4);
  });

  it('lockEmail returns the row inside a transaction', async () => {
    await emailStateRepository.createIfAbsent(t.db, { emailId: 'email-lock', lastEventAt });
    const locked = await t.db.transaction((tx) => emailStateRepository.lockEmail(tx, 'email-lock'));
    expect(locked?.emailId).toBe('email-lock');
  });
});
