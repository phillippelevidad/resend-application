import type { IngestEnvelope } from '@ledger/core';
import { describe, expect, it } from 'vitest';
import type { DlqPort } from '../dlq.port.ts';

// One implementation under the contract, built fresh for each case, over an empty dead store.
export type DlqPortUnderTest = {
  readonly port: DlqPort;
  // Leaves a message with this body in the dead store, the way this implementation's transport puts
  // one there (in process: failed through every receive; SQS: held by the stubbed DLQ).
  readonly deadLetter: (body: string) => Promise<void>;
};

// A dead message's body as each transport holds it: the envelope serialized. The address is a Resend
// test address.
const deadBody = (svixId: string): string =>
  JSON.stringify({
    svixId,
    receivedAt: '2026-10-19T12:00:00.000Z',
    source: 'simulated',
    rawBody:
      '{"type":"email.sent","created_at":"2026-10-19T12:00:00.000Z","data":{"to":["delivered@resend.dev"]}}',
    headers: { 'svix-timestamp': '1792411200' },
  } satisfies IngestEnvelope);

const sortedBodies = (messages: readonly { readonly body: string }[]): string[] =>
  messages.map((message) => message.body).sort();

// D3: what every `DlqPort` shares. An inspect never removes or hides a message, `depth` counts the
// dead store, and a redrive empties it. Order is no part of it (ADR-002), and neither is
// `redrive_in_progress`, which only the SQS side can answer (its own test).
export function dlqPortContract(
  name: string,
  make: () => DlqPortUnderTest | Promise<DlqPortUnderTest>,
): void {
  describe(`DlqPort contract: ${name}`, () => {
    it('sampling never removes a message: a second sample returns the same messages and depth', async () => {
      const { port, deadLetter } = await make();
      const bodies = [deadBody('msg_dlq_kept_a'), deadBody('msg_dlq_kept_b')];
      for (const body of bodies) await deadLetter(body);

      const first = await port.sample(10);
      const second = await port.sample(10);

      expect(first.depth).toBe(2);
      expect(sortedBodies(first.messages)).toEqual([...bodies].sort());
      expect(second.depth).toBe(2);
      expect(sortedBodies(second.messages)).toEqual([...bodies].sort());
      for (const message of first.messages) {
        expect(Number.isInteger(message.receiveCount)).toBe(true);
        expect(message.receiveCount).toBeGreaterThanOrEqual(1);
      }
    });

    it('depth counts every dead-lettered message, whatever the limit returns', async () => {
      const { port, deadLetter } = await make();
      const bodies = [deadBody('msg_dlq_a'), deadBody('msg_dlq_b'), deadBody('msg_dlq_c')];
      for (const body of bodies) await deadLetter(body);

      const sample = await port.sample(1);

      expect(sample.depth).toBe(3);
      expect(sample.messages).toHaveLength(1);
      expect(bodies).toContain(sample.messages[0]?.body);
    });

    it('a redrive of an empty dead store answers empty with depth 0', async () => {
      const { port } = await make();

      expect(await port.startRedrive()).toEqual({ status: 'empty', depth: 0 });
      expect(await port.sample(10)).toEqual({ depth: 0, messages: [] });
    });

    it('a redrive answers started with the depth moved, and empties the dead store', async () => {
      const { port, deadLetter } = await make();
      await deadLetter(deadBody('msg_dlq_moved_a'));
      await deadLetter(deadBody('msg_dlq_moved_b'));

      expect(await port.startRedrive()).toEqual({ status: 'started', depth: 2 });

      expect(await port.sample(10)).toEqual({ depth: 0, messages: [] });
    });
  });
}
