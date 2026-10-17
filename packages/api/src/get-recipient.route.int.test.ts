import { hashAddress, maskAddress } from '@ledger/core';
import { recipientStateRepository } from '@ledger/db';
import { createTestDatabase, type TestDatabase } from '@ledger/db/testing';
import { createLogger } from '@ledger/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApi } from './create-api.ts';
import type { ErrorResponse } from './error-response.schema.ts';
import type { RecipientResponse } from './recipient-response.schema.ts';

// Mandatory redaction (pp-workflow → Test tiers): the address goes in the body, is hashed
// server-side, and comes back only as its mask. Rows are seeded through the repository, as the
// worker writes them.

let t: TestDatabase;
let api: ReturnType<typeof createApi>;

const addressHashKey = new Uint8Array(32).fill(9);

beforeAll(async () => {
  t = await createTestDatabase();
  api = createApi({
    db: t.db,
    logger: createLogger({ functionName: 'api', stream: { write: () => {} } }),
    addressHashKey,
    requestId: () => 'req-recipient-get',
  });
});

afterAll(async () => {
  await t.drop();
});

// The `recipient_state` row the worker would commit after one `Permanent` bounce (RS-28, RS-35).
async function seedHardBounced(address: string, causeEmailId: string): Promise<void> {
  await recipientStateRepository.createIfAbsent(t.db, [
    {
      addressHash: hashAddress(addressHashKey, address),
      addressMasked: maskAddress(address),
      deliverability: 'hard_bounced',
      since: new Date('2026-10-17T12:00:02.000Z'),
      causeEmailId,
    },
  ]);
}

type Answer = { status: number; text: string; body: RecipientResponse & ErrorResponse };

async function lookup(init: RequestInit): Promise<Answer> {
  const response = await api.request('/recipients/lookup', { method: 'POST', ...init });
  const text = await response.text();
  return { status: response.status, text, body: JSON.parse(text) };
}

const asJson = (body: unknown): RequestInit => ({
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

const bodyFailure = {
  code: 'validation_failed',
  message: 'The request body must be a JSON object with an address field.',
  hint: 'Send Content-Type: application/json with a JSON body.',
  docs: 'https://github.com/phillippelevidad/resend-application/blob/main/docs/runbook.md#validation_failed',
};

describe('recipient.get', () => {
  it('a hard-bounced address answers its deliverability and cause, the address only as its mask', async () => {
    await seedHardBounced('delivered@resend.dev', 'e1');

    const { status, text, body } = await lookup(asJson({ address: 'delivered@resend.dev' }));

    expect(status).toBe(200);
    expect(body).toEqual({
      object: 'recipient',
      address_masked: maskAddress('delivered@resend.dev'),
      deliverability: 'hard_bounced',
      since: '2026-10-17T12:00:02.000Z',
      cause_email_id: 'e1',
    });
    expect(text).not.toContain('delivered@resend.dev');
    expect(text).not.toContain(hashAddress(addressHashKey, 'delivered@resend.dev'));
  });

  it('the lookup normalizes the address: surrounding spaces and case find the same recipient', async () => {
    await seedHardBounced('delivered+normalized@resend.dev', 'e2');

    const { status, text, body } = await lookup(
      asJson({ address: '  Delivered+Normalized@Resend.dev ' }),
    );

    expect(status).toBe(200);
    expect(body.cause_email_id).toBe('e2');
    expect(body.address_masked).toBe(maskAddress('delivered+normalized@resend.dev'));
    expect(text.toLowerCase()).not.toContain('delivered+normalized@resend.dev');
  });

  it('an address no event has named answers 404 recipient_not_found, never 200', async () => {
    const { status, text, body } = await lookup(asJson({ address: 'bounced+never@resend.dev' }));

    expect(status).toBe(404);
    expect(body.error).toEqual({
      code: 'recipient_not_found',
      message: 'No event has ever named this address.',
      hint: 'Check the address. If it was emailed recently, run `ledger gaps`.',
      docs: 'https://github.com/phillippelevidad/resend-application/blob/main/docs/runbook.md#recipient_not_found',
    });
    expect(text).not.toContain('bounced+never');
  });

  it.each([
    'no-at-sign',
    'two@at@resend.dev',
    '@resend.dev',
    'delivered@',
    '  ',
    `${'d'.repeat(310)}@resend.dev`,
  ])(
    'an invalid address (%s) answers 400 validation_failed naming address, never its value',
    async (address) => {
      const { status, text, body } = await lookup(asJson({ address }));

      expect(status).toBe(400);
      expect(body.error).toEqual({
        code: 'validation_failed',
        message: 'address must be an email address of at most 320 characters.',
        hint: 'Fix the field the message names, then retry.',
        docs: 'https://github.com/phillippelevidad/resend-application/blob/main/docs/runbook.md#validation_failed',
      });
      if (address.trim() !== '') {
        expect(text).not.toContain(address);
      }
    },
  );

  it.each([
    [
      'no Content-Type, a JSON body',
      { body: new TextEncoder().encode('{"address":"delivered@resend.dev"}') },
    ],
    ['no Content-Type, no body', {}],
    [
      'a text/plain body',
      { headers: { 'content-type': 'text/plain' }, body: '{"address":"delivered@resend.dev"}' },
    ],
    ['malformed JSON', { headers: { 'content-type': 'application/json' }, body: '{"address":' }],
    ['a JSON body that is not an object', asJson(['delivered@resend.dev'])],
    ['a JSON object without address', asJson({ email: 'delivered@resend.dev' })],
    ['a non-string address', asJson({ address: 42 })],
  ] satisfies [string, RequestInit][])(
    '%s answers 400 validation_failed naming the body, in the error shape, never a bare 415',
    async (_case, init) => {
      const { status, text, body } = await lookup(init);

      expect(status).toBe(400);
      expect(body).toEqual({ error: bodyFailure });
      expect(text).not.toContain('delivered@resend.dev');
    },
  );
});
