import { describe, expect, it } from 'vitest';
import { ingestEnvelopeSchema } from './ingest-envelope.schema.ts';

const valid = {
  svixId: 'msg_2v3cQ9uYfJ8kL1mN0pR4sT6wX',
  receivedAt: '2026-10-17T12:00:00.000Z',
  source: 'live',
  rawBody: '{"type":"email.sent","created_at":"2026-10-17T12:00:00.000Z","data":{}}',
  headers: { 'svix-timestamp': '1792238400' },
};

describe('ingestEnvelopeSchema', () => {
  it('parses a valid envelope, raw body unchanged, so the worker reads what ingest verified', () => {
    expect(ingestEnvelopeSchema.parse(valid)).toEqual(valid);
  });

  it('accepts a receivedAt with a numeric offset as well as Z', () => {
    expect(
      ingestEnvelopeSchema.safeParse({ ...valid, receivedAt: '2026-10-17T09:00:00-03:00' }).success,
    ).toBe(true);
  });

  it('accepts the simulated source, so simulator deliveries are labeled', () => {
    expect(ingestEnvelopeSchema.safeParse({ ...valid, source: 'simulated' }).success).toBe(true);
  });

  it('rejects a missing svixId, so no event enters the ledger without its dedupe key', () => {
    const { svixId: _svixId, ...withoutId } = valid;
    expect(ingestEnvelopeSchema.safeParse(withoutId).success).toBe(false);
    expect(ingestEnvelopeSchema.safeParse({ ...valid, svixId: '' }).success).toBe(false);
  });

  it('rejects a receivedAt without an offset, so every stored instant is unambiguous', () => {
    expect(
      ingestEnvelopeSchema.safeParse({ ...valid, receivedAt: '2026-10-17T12:00:00' }).success,
    ).toBe(false);
  });

  it('rejects a source outside live and simulated', () => {
    expect(ingestEnvelopeSchema.safeParse({ ...valid, source: 'replayed' }).success).toBe(false);
  });

  it('drops a svix-signature header on parse, so a parsed envelope never carries the signature', () => {
    const parsed = ingestEnvelopeSchema.parse({
      ...valid,
      headers: { ...valid.headers, 'svix-signature': 'v1,c2lnbmF0dXJl' },
    });
    expect(parsed.headers).toEqual({ 'svix-timestamp': '1792238400' });
  });
});
