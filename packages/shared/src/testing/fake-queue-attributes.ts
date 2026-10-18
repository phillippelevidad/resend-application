import type { QueueAttributesPort, QueueSnapshot } from '../queue-attributes.port.ts';
import { fakeFailure } from './fake-failure.ts';

// D1: the queue attributes' stateful fake. It answers the snapshot a test set, or fails, so a test
// asserts how the code under test reports it (`health.get`).
export class FakeQueueAttributes implements QueueAttributesPort {
  snapshot: QueueSnapshot;
  failing = false;

  constructor(snapshot: Partial<QueueSnapshot> = {}) {
    this.snapshot = {
      visible: 0,
      inFlight: 0,
      oldestAgeSeconds: null,
      dlqVisible: 0,
      dlqInFlight: 0,
      ...snapshot,
    };
  }

  async read(): Promise<QueueSnapshot> {
    if (this.failing) throw fakeFailure('FakeQueueAttributes.read');
    return { ...this.snapshot };
  }
}
