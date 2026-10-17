// D8: the local queue is at-least-once, batches at most 10, redelivers a failed message after 1 s and
// dead-lists it after its 5th receive with one `queue.dead_lettered` line. Time moves only through
// `FakeClock`, so every step is deterministic.
import type { IngestEnvelope } from '@ledger/core';
import { describe, expect, it } from 'vitest';
import { createLogger } from './create-logger.ts';
import { InProcessQueueAdapter } from './in-process-queue.adapter.ts';
import type { BatchResponse, QueueMessage } from './queue.port.ts';
import { FakeClock } from './testing/fake-clock.ts';

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
