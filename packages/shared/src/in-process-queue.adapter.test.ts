// D8: the local queue is at-least-once, batches at most 10, redelivers a failed message after 1 s and
// dead-lists it after its 5th receive with one `queue.dead_lettered` line. Time moves only through
// `FakeClock`, so every step is deterministic. As `QueueAttributesPort`, it counts its own lists (D40).
// The shared port contracts run over it here (D1), the `DlqPort` one over its dead list (slice 3, D3).
import type { IngestEnvelope } from '@ledger/core';
import { describe, expect, it } from 'vitest';
import type { ClockPort } from './clock.port.ts';
import { createLogger } from './create-logger.ts';
import { InProcessQueueAdapter } from './in-process-queue.adapter.ts';
import type { BatchResponse, QueueMessage } from './queue.port.ts';
import { dlqPortContract } from './testing/dlq-port-contract.ts';
import { FakeClock } from './testing/fake-clock.ts';
import { queueAttributesPortContract } from './testing/queue-attributes-port-contract.ts';
import { queuePortContract } from './testing/queue-port-contract.ts';

const envelope = (svixId: string): IngestEnvelope => ({
  svixId,
  receivedAt: '2026-10-17T12:00:00.000Z',
  source: 'simulated',
  rawBody: '{"type":"email.sent","created_at":"2026-10-17T12:00:00.000Z","data":{}}',
  headers: { 'svix-timestamp': '1792238400' },
});

// Delivery runs on promise callbacks only (no real timer under `FakeClock`), so one macrotask turn
// lets every pending delivery finish.
const settle = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

// A consumer standing in for the worker: it fails the svix ids `fails` says to, on that receive, and
// records every receive and every commit.
const harness = (fails: (svixId: string, receive: number) => boolean = () => false) => {
  const clock = new FakeClock();
  const lines: string[] = [];
  const logger = createLogger({
    functionName: 'worker',
    stream: { write: (chunk: string) => lines.push(chunk) },
  });
  const queue = new InProcessQueueAdapter({ clock, logger, sleep: clock.sleep });
  const batches: string[][] = [];
  const receives = new Map<string, number>();
  const committed: string[] = [];
  const consumer = async (messages: QueueMessage[]): Promise<BatchResponse> => {
    const batchItemFailures: { itemIdentifier: string }[] = [];
    const svixIds = messages.map((message) => (JSON.parse(message.body) as IngestEnvelope).svixId);
    batches.push(svixIds);
    messages.forEach((message, index) => {
      const svixId = svixIds[index] ?? '';
      const receive = (receives.get(svixId) ?? 0) + 1;
      receives.set(svixId, receive);
      if (fails(svixId, receive)) batchItemFailures.push({ itemIdentifier: message.messageId });
      else committed.push(svixId);
    });
    return { batchItemFailures };
  };
  const deadLettered = () =>
    lines
      .map((line) => JSON.parse(line) as Record<string, unknown>)
      .filter((line) => line.message === 'queue.dead_lettered');
  return { batches, clock, committed, consumer, deadLettered, lines, queue, receives };
};

describe('InProcessQueueAdapter', () => {
  it('delivers every enqueued message at least once, in batches of at most 10', async () => {
    const { batches, committed, consumer, queue } = harness();
    const svixIds = Array.from({ length: 25 }, (_, index) => `msg_${index}`);
    for (const svixId of svixIds.slice(0, 12)) await queue.enqueue(envelope(svixId));

    queue.start(consumer);
    for (const svixId of svixIds.slice(12)) await queue.enqueue(envelope(svixId));
    await settle();

    expect([...new Set(committed)].sort()).toEqual([...svixIds].sort());
    expect(batches.length).toBeGreaterThanOrEqual(3);
    for (const batch of batches) expect(batch.length).toBeLessThanOrEqual(10);
    expect(queue.deadList()).toEqual([]);
  });

  it('carries the envelope as its JSON body, as SQS holds it', async () => {
    const { consumer, queue } = harness();
    const bodies: string[] = [];
    queue.start(async (messages) => {
      bodies.push(...messages.map((message) => message.body));
      return consumer(messages);
    });

    await queue.enqueue(envelope('msg_body'));
    await settle();

    expect(bodies.map((body) => JSON.parse(body))).toEqual([envelope('msg_body')]);
  });

  it('redelivers a message that failed once after 1 s, then commits it', async () => {
    const { clock, committed, consumer, deadLettered, queue, receives } = harness(
      (svixId, receive) => svixId === 'msg_flaky' && receive === 1,
    );
    queue.start(consumer);
    await queue.enqueue(envelope('msg_flaky'));
    await queue.enqueue(envelope('msg_steady'));
    await settle();
    expect(receives.get('msg_flaky')).toBe(1);
    expect(committed).toEqual(['msg_steady']);

    clock.advance(999);
    await settle();
    expect(receives.get('msg_flaky')).toBe(1);

    clock.advance(1);
    await settle();
    expect(receives.get('msg_flaky')).toBe(2);
    expect(receives.get('msg_steady')).toBe(1);
    expect(committed).toEqual(['msg_steady', 'msg_flaky']);
    expect(queue.deadList()).toEqual([]);
    expect(deadLettered()).toEqual([]);
  });

  it('dead-lists a message failing every receive after its 5th, with one line naming it', async () => {
    const { clock, committed, consumer, deadLettered, queue, receives } = harness(
      (svixId) => svixId === 'msg_poison',
    );
    queue.start(consumer);
    await queue.enqueue(envelope('msg_poison'));
    await settle();

    for (let step = 0; step < 10; step += 1) {
      clock.advance(1_000);
      await settle();
    }

    expect(receives.get('msg_poison')).toBe(5);
    expect(committed).toEqual([]);
    const deadList = queue.deadList();
    expect(deadList).toHaveLength(1);
    expect(deadList[0]).toMatchObject({ svixId: 'msg_poison', receiveCount: 5 });
    expect(JSON.parse(deadList[0]?.body ?? 'null')).toEqual(envelope('msg_poison'));
    expect(deadLettered()).toHaveLength(1);
    expect(deadLettered()[0]).toMatchObject({
      level: 'error',
      svix_id: 'msg_poison',
      receive_count: 5,
    });
  });

  it('drops nothing silently when the consumer throws: the batch is redelivered, then dead-listed', async () => {
    const { clock, deadLettered, queue } = harness();
    const received: string[] = [];
    queue.start(async (messages) => {
      received.push(
        ...messages.map((message) => (JSON.parse(message.body) as IngestEnvelope).svixId),
      );
      throw new TypeError('consumer defect');
    });
    await queue.enqueue(envelope('msg_a'));
    await queue.enqueue(envelope('msg_b'));
    await settle();

    for (let step = 0; step < 10; step += 1) {
      clock.advance(1_000);
      await settle();
    }

    expect(received.filter((svixId) => svixId === 'msg_a')).toHaveLength(5);
    expect(received.filter((svixId) => svixId === 'msg_b')).toHaveLength(5);
    expect(
      queue
        .deadList()
        .map((entry) => entry.svixId)
        .sort(),
    ).toEqual(['msg_a', 'msg_b']);
    expect(deadLettered().map((line) => line.svix_id)).toEqual(['msg_a', 'msg_b']);
  });

  it('reads an empty queue as all zeros with no age', async () => {
    const { queue } = harness();

    expect(await queue.read()).toEqual({
      visible: 0,
      inFlight: 0,
      oldestAgeSeconds: null,
      dlqVisible: 0,
      dlqInFlight: 0,
    });
  });

  it('counts a waiting message visible, aged from its enqueue on the clock (D40)', async () => {
    const { clock, queue } = harness();
    await queue.enqueue(envelope('msg_old'));
    clock.advance(30_000);
    await queue.enqueue(envelope('msg_new'));
    clock.advance(1_500);

    expect(await queue.read()).toEqual({
      visible: 2,
      inFlight: 0,
      oldestAgeSeconds: 31,
      dlqVisible: 0,
      dlqInFlight: 0,
    });
  });

  it('counts a batch the consumer holds in flight until it settles (D40)', async () => {
    const { clock, queue } = harness();
    let release: () => void = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    await queue.enqueue(envelope('msg_a'));
    await queue.enqueue(envelope('msg_b'));
    queue.start(async () => {
      await held;
      return { batchItemFailures: [] };
    });
    await settle();
    clock.advance(4_000);

    expect(await queue.read()).toEqual({
      visible: 0,
      inFlight: 2,
      oldestAgeSeconds: 4,
      dlqVisible: 0,
      dlqInFlight: 0,
    });

    release();
    await settle();
    expect(await queue.read()).toEqual({
      visible: 0,
      inFlight: 0,
      oldestAgeSeconds: null,
      dlqVisible: 0,
      dlqInFlight: 0,
    });
  });

  it('counts a dead-listed message in dlqVisible and no longer ages it (D40)', async () => {
    const { clock, consumer, queue } = harness((svixId) => svixId === 'msg_poison');
    queue.start(consumer);
    await queue.enqueue(envelope('msg_poison'));
    await settle();
    for (let step = 0; step < 10; step += 1) {
      clock.advance(1_000);
      await settle();
    }

    expect(queue.deadList()).toHaveLength(1);
    expect(await queue.read()).toEqual({
      visible: 0,
      inFlight: 0,
      oldestAgeSeconds: null,
      dlqVisible: 1,
      dlqInFlight: 0,
    });
  });

  it('a redrive delivers a dead message again from receive count 1, so it takes 5 more receives to dead-list it (D3)', async () => {
    const { clock, consumer, queue, receives } = harness((svixId) => svixId === 'msg_poison');
    queue.start(consumer);
    await queue.enqueue(envelope('msg_poison'));
    await settle();
    for (let step = 0; step < 4; step += 1) {
      clock.advance(1_000);
      await settle();
    }
    expect(queue.deadList()).toHaveLength(1);

    expect(await queue.startRedrive()).toEqual({ status: 'started', depth: 1 });
    await settle();
    expect(receives.get('msg_poison')).toBe(6);

    for (let step = 0; step < 3; step += 1) {
      clock.advance(1_000);
      await settle();
    }
    expect(receives.get('msg_poison')).toBe(9);
    expect(queue.deadList()).toEqual([]);

    clock.advance(1_000);
    await settle();
    expect(receives.get('msg_poison')).toBe(10);
    expect(queue.deadList()).toHaveLength(1);
    expect(queue.deadList()[0]).toMatchObject({ svixId: 'msg_poison', receiveCount: 5 });
  });

  it('a redrive after the fault is fixed commits the message, and read() reports dlqVisible 0 (D3)', async () => {
    let poisoned = true;
    const { clock, committed, consumer, queue } = harness(
      (svixId) => poisoned && svixId === 'msg_poison',
    );
    queue.start(consumer);
    await queue.enqueue(envelope('msg_poison'));
    await settle();
    for (let step = 0; step < 4; step += 1) {
      clock.advance(1_000);
      await settle();
    }
    expect((await queue.read()).dlqVisible).toBe(1);

    poisoned = false;
    expect(await queue.startRedrive()).toEqual({ status: 'started', depth: 1 });
    await settle();

    expect(committed).toEqual(['msg_poison']);
    expect(queue.deadList()).toEqual([]);
    expect(await queue.read()).toEqual({
      visible: 0,
      inFlight: 0,
      oldestAgeSeconds: null,
      dlqVisible: 0,
      dlqInFlight: 0,
    });
  });

  it('delivers a message enqueued while a redelivery waits without waiting for it', async () => {
    const { committed, consumer, queue } = harness((svixId) => svixId === 'msg_waits');
    queue.start(consumer);
    await queue.enqueue(envelope('msg_waits'));
    await settle();

    await queue.enqueue(envelope('msg_new'));
    await settle();

    expect(committed).toEqual(['msg_new']);
  });
});

const silentLogger = () => createLogger({ functionName: 'worker', stream: { write: () => true } });

queuePortContract('InProcessQueueAdapter', () => {
  const fakeClock = new FakeClock();
  let failing = false;
  // The in-process queue has no network send: its one fallible step before a message is stored is
  // the clock read, so a clock that throws stands in for a failed send.
  const clock: ClockPort = {
    now: () => {
      if (failing) throw new RangeError('clock unavailable');
      return fakeClock.now();
    },
  };
  const queue = new InProcessQueueAdapter({
    clock,
    logger: silentLogger(),
    sleep: fakeClock.sleep,
  });
  const bodies: string[] = [];
  queue.start(async (messages) => {
    bodies.push(...messages.map((message) => message.body));
    return { batchItemFailures: [] };
  });
  return {
    port: queue,
    failSends: () => {
      failing = true;
    },
    accepted: async () => {
      await settle();
      return [...bodies];
    },
  };
});

dlqPortContract('InProcessQueueAdapter', () => {
  const clock = new FakeClock();
  const queue = new InProcessQueueAdapter({ clock, logger: silentLogger(), sleep: clock.sleep });
  // A consumer failing every receive, so each message is dead-listed after its 5th.
  queue.start(async (messages) => ({
    batchItemFailures: messages.map((message) => ({ itemIdentifier: message.messageId })),
  }));
  return {
    port: queue,
    deadLetter: async (body) => {
      await queue.enqueue(JSON.parse(body) as IngestEnvelope);
      await settle();
      for (let receive = 1; receive < 5; receive += 1) {
        clock.advance(1_000);
        await settle();
      }
    },
  };
});

queueAttributesPortContract('InProcessQueueAdapter', () => {
  const clock = new FakeClock();
  const queue = new InProcessQueueAdapter({ clock, logger: silentLogger(), sleep: clock.sleep });
  return {
    port: queue,
    // No consumer is started, so every message enqueued stays waiting.
    holdWaiting: async (count, oldestAgeSeconds) => {
      for (let index = 0; index < count; index += 1) {
        await queue.enqueue(envelope(`msg_waiting_${index}`));
      }
      clock.advance(oldestAgeSeconds * 1_000);
    },
  };
});
