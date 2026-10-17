// Ships 5's evidence (slice 1; data-modeling → PII & retention): after the worker commits events to
// two test recipients with a sender and a subject, no text column of any projection row holds
// either normalized address, the raw `from` or the raw subject. Addresses appear only as a keyed
// hash and a mask; `from` and subject only as masks.
import type { IngestEnvelope } from '@ledger/core';
import { createTestDatabase, type TestDatabase } from '@ledger/db/testing';
import { FakeClock, RecordingMetrics } from '@ledger/shared/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RecordEventCommand } from './record-event.command.ts';

let t: TestDatabase;

beforeAll(async () => {
  t = await createTestDatabase();
});

afterAll(async () => {
  await t.drop();
});

const key = new Uint8Array(32).fill(23);
const emailId = 'e_projection_pii';
// RS-34: Resend's test addresses, in a mixed case the worker normalizes.
const recipients = ['Delivered@Resend.dev', 'bounced@resend.dev'];
const normalized = ['delivered@resend.dev', 'bounced@resend.dev'];
const from = 'Acme Billing <billing@resend.dev>';
// The sender's parts, each forbidden alone: a column holding only the address or only the display
// name leaks as much as one holding the whole `from`.
const fromParts = ['billing@resend.dev', 'Acme Billing'];
const subject = 'Your invoice 48213 is ready';

function message(svixId: string, type: string, second: number, to: readonly string[], extra = {}) {
  const envelope: IngestEnvelope = {
    svixId,
    receivedAt: '2026-10-17T12:01:00.000Z',
    source: 'simulated',
    rawBody: JSON.stringify({
      type,
      created_at: new Date(Date.UTC(2026, 9, 17, 12, 0, second)).toISOString(),
      data: { email_id: emailId, to, from, subject, ...extra },
    }),
    headers: { 'svix-timestamp': '1792238460' },
  };
  return JSON.stringify(envelope);
}

// The file's own clone holds only this test's rows, so every row of every projection table is read.
async function rowsOf(table: string): Promise<Record<string, unknown>[]> {
  return (await t.db.execute(`select * from ${table}`)).rows;
}

describe('no raw PII in projection rows (projection-privacy)', () => {
  it('no text column of any projection row holds a normalized address, the raw from or the raw subject', async () => {
    const command = new RecordEventCommand({
      db: t.db,
      clock: new FakeClock('2026-10-17T12:01:00.000Z'),
      metrics: new RecordingMetrics(),
      addressHashKey: key,
    });
    const events = [
      message('msg_pii_sent', 'email.sent', 1, recipients),
      message('msg_pii_delivered', 'email.delivered', 2, [recipients[0] ?? '']),
      message('msg_pii_bounced', 'email.bounced', 3, [recipients[1] ?? ''], {
        bounce: { type: 'Permanent', subType: 'General', message: `Rejected ${normalized[1]}` },
      }),
    ];
    for (const body of events) {
      expect(await command.execute({ body })).toBe('projected');
    }

    const tables = {
      email_state: await rowsOf('email_state'),
      email_recipients: await rowsOf('email_recipients'),
      recipient_state: await rowsOf('recipient_state'),
    };
    // Not vacuous: every table holds the rows, and the masks are written.
    expect(tables.email_state).toHaveLength(1);
    expect(tables.email_recipients).toHaveLength(2);
    expect(tables.recipient_state).toHaveLength(2);
    expect(tables.email_state[0]?.from_masked).toEqual(expect.any(String));
    expect(tables.email_state[0]?.subject_masked).toEqual(expect.any(String));

    const forbidden = [...normalized, from, ...fromParts, subject];
    const leaks = Object.entries(tables).flatMap(([table, rows]) =>
      rows.flatMap((row) =>
        Object.entries(row).flatMap(([column, value]) =>
          typeof value === 'string' &&
          forbidden.some((raw) => value.toLowerCase().includes(raw.toLowerCase()))
            ? [`${table}.${column}`]
            : [],
        ),
      ),
    );
    expect(leaks).toEqual([]);
  });
});
