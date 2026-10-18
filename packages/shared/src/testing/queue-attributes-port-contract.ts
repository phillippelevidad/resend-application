import { describe, expect, it } from 'vitest';
import type { QueueAttributesPort } from '../queue-attributes.port.ts';

// One implementation under the contract, built fresh, over an empty queue and an empty DLQ.
export type QueueAttributesUnderTest = {
  readonly port: QueueAttributesPort;
  // Leaves `count` messages waiting in the source queue, the oldest `oldestAgeSeconds` old.
  readonly holdWaiting: (count: number, oldestAgeSeconds: number) => Promise<void>;
};

// D1: what every `QueueAttributesPort` shares: the snapshot's shape and the two readings both sides
// can produce. In-flight and DLQ counts come from each side's own test.
export function queueAttributesPortContract(
  name: string,
  make: () => QueueAttributesUnderTest | Promise<QueueAttributesUnderTest>,
): void {
  describe(`QueueAttributesPort contract: ${name}`, () => {
    it('an empty queue reads all zeros and no oldest age', async () => {
      const { port } = await make();

      expect(await port.read()).toEqual({
        visible: 0,
        inFlight: 0,
        oldestAgeSeconds: null,
        dlqVisible: 0,
        dlqInFlight: 0,
      });
    });

    it('waiting messages read as visible, aged in whole seconds from the oldest', async () => {
      const { port, holdWaiting } = await make();
      await holdWaiting(3, 30);

      expect(await port.read()).toEqual({
        visible: 3,
        inFlight: 0,
        oldestAgeSeconds: 30,
        dlqVisible: 0,
        dlqInFlight: 0,
      });
    });
  });
}
