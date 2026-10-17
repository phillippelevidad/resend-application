// Ships 6 (slice 1), D19: an unprojectable event is stored raw, never refused for its content
// (ADR-004; RS-25, RS-26). The worker int test proves the storage, the absent projection rows and
// the metric line.
import { hashAddress, type IngestEnvelope } from '@ledger/core';
import { describe, expect, it } from 'vitest';
import { toLedgerRow } from './to-ledger-row.ts';

const key = new Uint8Array(32).fill(7);

const envelope: IngestEnvelope = {
  svixId: 'msg_to_ledger_row',
  receivedAt: '2026-10-17T12:00:05.000Z',
  source: 'simulated',
  rawBody: '{}',
  headers: { 'svix-timestamp': '1792238405' },
};

const createdAt = '2026-10-17T12:00:00.000Z';

const fromEnvelope = {
  svixId: 'msg_to_ledger_row',
  receivedAt: new Date('2026-10-17T12:00:05.000Z'),
  source: 'simulated',
};

describe('toLedgerRow: unprojectable payloads are stored unchanged (D17, D19)', () => {
  it('an unknown type keeps its type and created_at, nulls email_id and to_hashes', () => {
    const payload = {
      type: 'email.teleported',
      created_at: createdAt,
      data: { email_id: 'e_unknown', to: ['delivered@resend.dev'] },
    };
    const result = toLedgerRow(envelope, payload, key);
    expect(result.projectable).toBe(false);
    expect(result.row).toEqual({
      ...fromEnvelope,
      type: 'email.teleported',
      eventCreatedAt: new Date(createdAt),
      emailId: null,
      toHashes: null,
      payload,
    });
    expect(result.row.payload).toBe(payload);
  });

  it('contact.created is a non-email type: stored with null email_id and to_hashes (RS-25)', () => {
    const payload = {
      type: 'contact.created',
      created_at: createdAt,
      data: { id: 'c_1', email: 'delivered@resend.dev', first_name: 'Test' },
    };
    const result = toLedgerRow(envelope, payload, key);
    expect(result.projectable).toBe(false);
    expect(result.row).toMatchObject({
      type: 'contact.created',
      eventCreatedAt: new Date(createdAt),
      emailId: null,
      toHashes: null,
    });
    expect(result.row.payload).toBe(payload);
  });

  it('email.received names an inbound email, so its email_id stays null (RS-30)', () => {
    const payload = {
      type: 'email.received',
      created_at: createdAt,
      data: { email_id: 'e_inbound', to: ['delivered@resend.dev'], from: 'bounced@resend.dev' },
    };
    const result = toLedgerRow(envelope, payload, key);
    expect(result.projectable).toBe(false);
    expect(result.row).toMatchObject({ type: 'email.received', emailId: null, toHashes: null });
    expect(result.row.payload).toBe(payload);
  });

  it('a known type failing its schema keeps every readable typed column', () => {
    // `email.delivered` without `data.email_id`: `type`, `created_at` and `to` are still readable.
    const payload = {
      type: 'email.delivered',
      created_at: createdAt,
      data: { to: ['delivered@resend.dev'] },
    };
    const result = toLedgerRow(envelope, payload, key);
    expect(result.projectable).toBe(false);
    expect(result.row).toMatchObject({
      type: 'email.delivered',
      eventCreatedAt: new Date(createdAt),
      emailId: null,
      toHashes: [hashAddress(key, 'delivered@resend.dev')],
    });
    expect(result.row.payload).toBe(payload);
  });

  it('a known type with an unreadable created_at nulls event_created_at only', () => {
    const payload = {
      type: 'email.sent',
      created_at: 'yesterday',
      data: { email_id: 'e_bad_time', to: ['delivered@resend.dev'] },
    };
    const result = toLedgerRow(envelope, payload, key);
    expect(result.projectable).toBe(false);
    expect(result.row).toMatchObject({
      type: 'email.sent',
      eventCreatedAt: null,
      emailId: 'e_bad_time',
      toHashes: [hashAddress(key, 'delivered@resend.dev')],
    });
  });

  // Postgres refuses a UTC year outside 1–9999 in `toISOString()`'s form, so a schema-valid
  // `created_at` there would fail the insert on every receive and dead-list the event.
  it.each([
    ['year 0', '0000-01-01T00:00:00Z'],
    ['year 1 with a positive offset', '0001-01-01T00:30:00+01:00'],
    ['year 9999 with a negative offset', '9999-12-31T23:00:00-05:00'],
  ])(
    'a created_at whose UTC year Postgres cannot store (%s) nulls event_created_at',
    (_label, at) => {
      const payload = {
        type: 'email.sent',
        created_at: at,
        data: { email_id: 'e_out_of_range', to: ['delivered@resend.dev'] },
      };
      const result = toLedgerRow(envelope, payload, key);
      expect(result.projectable).toBe(false);
      expect(result.row).toMatchObject({
        type: 'email.sent',
        eventCreatedAt: null,
        emailId: 'e_out_of_range',
      });
    },
  );

  it('a payload with no string type is stored with a null type', () => {
    const payload = { type: 42, created_at: createdAt, data: {} };
    const result = toLedgerRow(envelope, payload, key);
    expect(result.projectable).toBe(false);
    expect(result.row).toMatchObject({ type: null, emailId: null, toHashes: null });
    expect(result.row.payload).toBe(payload);
  });

  it.each([
    ['JSON null', null],
    ['an array', [{ type: 'email.sent' }]],
    ['a string', 'email.sent'],
    ['a number', 7],
    ['a boolean', true],
  ])('%s yields every payload-derived column null, without throwing', (_label, payload) => {
    const result = toLedgerRow(envelope, payload, key);
    expect(result).toEqual({
      row: {
        ...fromEnvelope,
        type: null,
        eventCreatedAt: null,
        emailId: null,
        toHashes: null,
        payload,
      },
      projectable: false,
    });
    expect(result.row.payload).toBe(payload);
  });
});

describe('toLedgerRow: a projectable event (D17)', () => {
  it('a valid two-recipient email.sent keeps to_hashes in data.to order', () => {
    const to = ['bounced@resend.dev', 'Delivered@Resend.dev'];
    const payload = {
      type: 'email.sent',
      created_at: createdAt,
      data: { email_id: 'e_two', to, from: 'Acme <delivered@resend.dev>', subject: 'Hello' },
    };
    const result = toLedgerRow(envelope, payload, key);
    const toHashes = [hashAddress(key, to[0] ?? ''), hashAddress(key, to[1] ?? '')];
    expect(result).toEqual({
      row: {
        ...fromEnvelope,
        type: 'email.sent',
        eventCreatedAt: new Date(createdAt),
        emailId: 'e_two',
        toHashes,
        payload,
      },
      projectable: true,
      emailId: 'e_two',
      eventCreatedAt: new Date(createdAt),
      to,
      toHashes,
    });
    expect(toHashes[0]).not.toBe(toHashes[1]);
    expect(result.row.payload).toBe(payload);
  });
});
