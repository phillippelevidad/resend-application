import { eventSourceSchema } from '@ledger/core';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type NewWebhookEvent, webhookEventsRepository } from './index.ts';
import { webhookEvents } from './schema/webhook-events.ts';
import { createTestDatabase, sqlStateOf, type TestDatabase } from './testing.ts';

let t: TestDatabase;

beforeAll(async () => {
  t = await createTestDatabase();
});

afterAll(async () => {
  await t.drop();
});

function eventRow(svixId: string, overrides: Partial<NewWebhookEvent> = {}): NewWebhookEvent {
  return {
    svixId,
    type: 'email.sent',
    eventCreatedAt: new Date('2026-10-17T12:00:00.000Z'),
    receivedAt: new Date('2026-10-17T12:00:01.000Z'),
    emailId: `email-${svixId}`,
    toHashes: [],
    source: 'simulated',
    payload: { type: 'email.sent', data: { to: ['delivered@resend.dev'] } },
    ...overrides,
  };
}

async function rowsFor(svixId: string) {
  return t.db.select().from(webhookEvents).where(eq(webhookEvents.svixId, svixId));
}

describe('webhook_events as the runtime role', () => {
  it.each(eventSourceSchema.options)(
    'accepts every eventSourceSchema member: %s',
    async (source) => {
      const svixId = `msg_source_${source}`;
      expect(await webhookEventsRepository.insertIfAbsent(t.db, eventRow(svixId, { source }))).toBe(
        true,
      );
      expect((await rowsFor(svixId))[0]?.source).toBe(source);
    },
  );

  it('refuses a source outside eventSourceSchema with SQLSTATE 23514', async () => {
    const row = {
      ...eventRow('msg_source_outsider'),
      source: 'replayed',
    } as unknown as NewWebhookEvent;
    expect(await sqlStateOf(webhookEventsRepository.insertIfAbsent(t.db, row))).toBe('23514');
    expect(await rowsFor('msg_source_outsider')).toHaveLength(0);
  });

  it('a duplicate insertIfAbsent on one svix_id returns false and leaves one row (ADR-004)', async () => {
    const first = eventRow('msg_duplicate', { emailId: 'email-first' });
    const second = eventRow('msg_duplicate', { emailId: 'email-second' });
    expect(await webhookEventsRepository.insertIfAbsent(t.db, first)).toBe(true);
    expect(await webhookEventsRepository.insertIfAbsent(t.db, second)).toBe(false);
    const rows = await rowsFor('msg_duplicate');
    expect(rows).toHaveLength(1);
    expect(rows[0]?.emailId).toBe('email-first');
  });

  it('stores a top-level JSON null payload as the jsonb value null, never SQL NULL (D17)', async () => {
    const row = eventRow('msg_null_payload', {
      type: null,
      eventCreatedAt: null,
      emailId: null,
      toHashes: null,
      payload: null,
    });
    expect(await webhookEventsRepository.insertIfAbsent(t.db, row)).toBe(true);
    const [kind] = await t.owner
      .execute<{ kind: string }>(
        "select jsonb_typeof(payload) as kind from webhook_events where svix_id = 'msg_null_payload'",
      )
      .then((result) => result.rows);
    expect(kind?.kind).toBe('null');
  });

  it('the tests connect as ledger_runtime, and it cannot update, delete or truncate the ledger (ADR-004)', async () => {
    const [who] = await t.db
      .execute<{ current_user: string }>('select current_user')
      .then((result) => result.rows);
    expect(who?.current_user).toBe('ledger_runtime');

    await webhookEventsRepository.insertIfAbsent(t.db, eventRow('msg_append_only'));
    // `SELECT, INSERT` only (0001_grant-ledger-tables.sql): a widened grant turns each into a write.
    expect(
      await sqlStateOf(
        t.db
          .update(webhookEvents)
          .set({ type: 'email.delivered' })
          .where(eq(webhookEvents.svixId, 'msg_append_only')),
      ),
    ).toBe('42501');
    expect(
      await sqlStateOf(
        t.db.delete(webhookEvents).where(eq(webhookEvents.svixId, 'msg_append_only')),
      ),
    ).toBe('42501');
    expect(await sqlStateOf(t.db.execute('truncate webhook_events'))).toBe('42501');
    expect((await rowsFor('msg_append_only'))[0]?.type).toBe('email.sent');
  });

  it('countPresent counts only the stored svix_ids', async () => {
    await webhookEventsRepository.insertIfAbsent(t.db, eventRow('msg_count_a'));
    expect(
      await webhookEventsRepository.countPresent(t.db, ['msg_count_a', 'msg_count_missing']),
    ).toBe(1);
    expect(await webhookEventsRepository.countPresent(t.db, [])).toBe(0);
  });
});
