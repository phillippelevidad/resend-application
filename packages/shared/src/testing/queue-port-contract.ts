import type { IngestEnvelope } from '@ledger/core';
import { describe, expect, it } from 'vitest';
import type { QueuePort } from '../queue.port.ts';

// One implementation under the contract, built fresh for each case.
export type QueuePortUnderTest = {
  readonly port: QueuePort;
  // Makes every later send fail the way this implementation's transport fails (SQS: the client's
  // `send` rejects).
  readonly failSends: () => void;
  // The message bodies the transport accepted so far, as the consumer side would receive them.
  readonly accepted: () => Promise<readonly string[]>;
};

// A raw body with characters outside ASCII and a JSON escape, which must travel byte for byte
// (RS-01). The address is a Resend test address.
const envelope = (svixId: string): IngestEnvelope => ({
  svixId,
  receivedAt: '2026-10-17T12:00:00.000Z',
  source: 'simulated',
  rawBody:
    '{"type":"email.sent","created_at":"2026-10-17T12:00:00.000Z","data":{"to":["delivered@resend.dev"],"subject":"Caf\\u00e9 · Olá 🙂"}}',
  headers: { 'svix-timestamp': '1792238400' },
});

// D1, R4: what every `QueuePort` shares. Ingest answers `200` only after `enqueue` resolved and
// `503` when it rejected (ADR-001), so `enqueue` resolves only on acceptance and never swallows a
// failed send. Delivery itself is at-least-once and in no order (ADR-002), so no case asserts
// exactly-once or order.
export function queuePortContract(
  name: string,
  make: () => QueuePortUnderTest | Promise<QueuePortUnderTest>,
): void {
  describe(`QueuePort contract: ${name}`, () => {
    it('enqueue resolves once the transport accepted the envelope, its raw body byte-identical', async () => {
      const { port, accepted } = await make();
      const sent = envelope('msg_contract_accepted');

      await expect(port.enqueue(sent)).resolves.toBeUndefined();

      const bodies = (await accepted()).map((body) => JSON.parse(body) as IngestEnvelope);
      expect(bodies).toEqual([sent]);
      expect(bodies[0]?.rawBody).toBe(sent.rawBody);
    });

    it('enqueue rejects when the send fails, and the transport holds nothing', async () => {
      const { port, failSends, accepted } = await make();
      failSends();

      await expect(port.enqueue(envelope('msg_contract_failed'))).rejects.toBeInstanceOf(Error);

      expect(await accepted()).toEqual([]);
    });
  });
}
