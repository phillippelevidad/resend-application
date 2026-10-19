import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { type NewWebhookEvent, webhookEventsRepository } from '../index.ts';
import { webhookEvents } from '../schema/webhook-events.ts';
import { createTestDatabase, sqlStateOf, type TestDatabase } from '../testing.ts';
import { addPoisonFault, POISON_ID_PREFIX, removePoisonFault } from './poison-fault.ts';

// D27's poison fault on a real `webhook_events`: the DDL runs as the owner, as the sim's poison run
// does, and every insert as the runtime role, as the worker does.
let t: TestDatabase;

beforeAll(async () => {
  t = await createTestDatabase();
});

afterEach(async () => {
  await removePoisonFault(t.owner);
});

afterAll(async () => {
  await t.drop();
});

function eventRow(svixId: string): NewWebhookEvent {
  return {
    svixId,
    type: 'email.sent',
    eventCreatedAt: new Date('2026-10-19T12:00:00.000Z'),
    receivedAt: new Date('2026-10-19T12:00:01.000Z'),
    emailId: `email-${svixId}`,
    toHashes: [],
    source: 'simulated',
    payload: { type: 'email.sent', data: { to: ['delivered@resend.dev'] } },
  };
}

function insert(svixId: string): Promise<boolean> {
  return webhookEventsRepository.insertIfAbsent(t.db, eventRow(svixId));
}

async function stored(svixId: string): Promise<number> {
  const rows = await t.db.select().from(webhookEvents).where(eq(webhookEvents.svixId, svixId));
  return rows.length;
}

// The sim's own call order (D27 step 3): a leftover goes first.
async function applyFault(): Promise<void> {
  await removePoisonFault(t.owner);
  await addPoisonFault(t.owner);
}

describe('the poison fault on webhook_events (D27)', () => {
  it('refuses only an id starting simpoison_ with SQLSTATE 23514, and stores nothing for it', async () => {
    await applyFault();
    const poisoned = `${POISON_ID_PREFIX}ns_1`;
    expect(await sqlStateOf(insert(poisoned))).toBe('23514');
    expect(await stored(poisoned)).toBe(0);
    expect(await insert('ns-svix-starts-1')).toBe(true);
    expect(await stored('ns-svix-starts-1')).toBe(1);
  });

  it('inserts an id holding simpoison_ past its start: the match is a prefix', async () => {
    await applyFault();
    const lookalike = `msg_${POISON_ID_PREFIX}ns_2`;
    expect(await insert(lookalike)).toBe(true);
    expect(await stored(lookalike)).toBe(1);
  });

  it('adds NOT VALID: an existing simpoison_ row stays and the add succeeds', async () => {
    const existing = `${POISON_ID_PREFIX}ns_existing`;
    expect(await insert(existing)).toBe(true);
    await applyFault();
    expect(await stored(existing)).toBe(1);
  });

  it('removal restores inserts of a simpoison_ id', async () => {
    await applyFault();
    const poisoned = `${POISON_ID_PREFIX}ns_3`;
    expect(await sqlStateOf(insert(poisoned))).toBe('23514');
    await removePoisonFault(t.owner);
    expect(await insert(poisoned)).toBe(true);
    expect(await stored(poisoned)).toBe(1);
  });

  it('a second add over an unremoved leftover succeeds, because remove-then-add drops it first', async () => {
    await addPoisonFault(t.owner);
    // The leftover a crashed run leaves: a bare second add collides on the name.
    expect(await sqlStateOf(addPoisonFault(t.owner))).toBe('42710');
    await applyFault();
    expect(await sqlStateOf(insert(`${POISON_ID_PREFIX}ns_4`))).toBe('23514');
  });

  it('refuses the runtime role adding it with SQLSTATE 42501', async () => {
    expect(await sqlStateOf(addPoisonFault(t.db))).toBe('42501');
    expect(await insert(`${POISON_ID_PREFIX}ns_5`)).toBe(true);
  });
});
