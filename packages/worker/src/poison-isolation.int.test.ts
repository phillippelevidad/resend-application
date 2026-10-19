// Ships 6 (slice 3), the event-ledger delta's three scenarios on real Postgres, as the runtime role:
// the real worker behind the in-process queue (local mode's chain, ADR-013), one of five events
// poisoned with D27's fault. The poison message is dead-listed after its 5th receive while the other
// four commit once each (ADR-008, AWS-05); after the fix and a redrive it commits once; a later copy
// under a new message id is a duplicate (ADR-004, AWS-21). Time moves only through `FakeClock`, and
// each step waits for the batch the queue delivers, never for real time.
import type { IngestEnvelope } from '@ledger/core';
import { STORAGE_LIMIT_BYTES, webhookEventsRepository } from '@ledger/db';
import {
  addPoisonFault,
  createTestDatabase,
  POISON_ID_PREFIX,
  removePoisonFault,
  type TestDatabase,
} from '@ledger/db/testing';
import { type BatchResponse, createLogger, InProcessQueueAdapter } from '@ledger/shared';
import { FakeClock, FakeEventSourceControl, RecordingMetrics } from '@ledger/shared/testing';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createWorker } from './create-worker.ts';

let t: TestDatabase;

beforeAll(async () => {
  t = await createTestDatabase();
});

afterEach(async () => {
  await removePoisonFault(t.owner);
});

afterAll(async () => {
  await t.drop();
});

// Fresh ids per test: tests in this file share one clone and assert only on their own ids.
let lastId = 0;
const fresh = (label: string): string => {
  lastId += 1;
  return `${label}_${lastId}`;
};

function envelope(svixId: string): IngestEnvelope {
  return {
    svixId,
    receivedAt: '2026-10-19T12:00:00.000Z',
    source: 'simulated',
    rawBody: JSON.stringify({
      type: 'email.sent',
      created_at: '2026-10-19T11:59:59.000Z',
      data: {
        email_id: `e_${svixId}`,
        to: ['delivered@resend.dev'],
        subject: 'Order confirmation',
      },
    }),
    headers: { 'svix-timestamp': '1792411199' },
  };
}

type Delivery = { readonly svixId: string; readonly messageId: string };

// Delivery runs on promise callbacks only (no real timer under `FakeClock`), so one macrotask turn
// after a batch returns lets the queue settle it: requeue, dead-list, or acknowledge.
const settle = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

// The chain as `apps/local` wires it: the queue's consumer is `worker.processBatch`, wrapped only to
// record what each batch received and answered, and to let the test wait for it.
function chain() {
  const clock = new FakeClock('2026-10-19T12:00:00.000Z');
  const queueLines: string[] = [];
  const workerLines: string[] = [];
  const queue = new InProcessQueueAdapter({
    clock,
    logger: createLogger({
      functionName: 'worker',
      stream: { write: (line) => queueLines.push(line) },
    }),
    sleep: clock.sleep,
  });
  const metrics = new RecordingMetrics();
  const worker = createWorker({
    database: t.database,
    eventSource: new FakeEventSourceControl(),
    storageLimitBytes: STORAGE_LIMIT_BYTES,
    clock,
    logger: createLogger({
      functionName: 'worker',
      stream: { write: (line) => workerLines.push(line) },
    }),
    metrics,
    addressHashKey: new Uint8Array(32).fill(13),
  });

  const deliveries: Delivery[] = [];
  const responses: BatchResponse[] = [];
  const waiters: { count: number; resolve: () => void }[] = [];
  // Started by the test once its messages wait, so the first batch holds every one of them.
  const start = (): void =>
    queue.start(async (messages) => {
      for (const { messageId, body } of messages) {
        deliveries.push({ svixId: (JSON.parse(body) as IngestEnvelope).svixId, messageId });
      }
      const response = await worker.processBatch(messages);
      responses.push(response);
      for (const waiter of waiters.filter((each) => each.count <= responses.length)) {
        waiter.resolve();
      }
      return response;
    });

  // Resolves once the queue's `count`th batch has returned and been settled.
  async function batches(count: number): Promise<void> {
    if (responses.length < count) {
      await new Promise<void>((resolve) => waiters.push({ count, resolve }));
    }
    await settle();
  }

  const receives = (svixId: string): Delivery[] =>
    deliveries.filter((delivery) => delivery.svixId === svixId);
  const logged = (lines: string[], message: string) =>
    lines
      .map((line) => JSON.parse(line) as Record<string, unknown>)
      .filter((line) => line.message === message);
  const duplicates = (svixId: string) =>
    metrics.recorded.filter(
      (metric) => metric.name === 'worker.duplicates' && metric.fields.svix_id === svixId,
    );
  const rows = (svixId: string): Promise<number> =>
    webhookEventsRepository.countPresent(t.db, [svixId]);

  return {
    batches,
    clock,
    duplicates,
    queue,
    queueLines,
    receives,
    responses,
    rows,
    start,
    workerLines,
    logged,
  };
}

type Chain = ReturnType<typeof chain>;

// Scenario 1's run: the fault on, five events enqueued before the worker starts, so the first batch
// holds all five; then each 1 s redelivery of the one that fails, up to its 5th receive.
async function isolatePoison(): Promise<{ c: Chain; poison: string; others: string[] }> {
  await removePoisonFault(t.owner);
  await addPoisonFault(t.owner);
  const poison = fresh(`${POISON_ID_PREFIX}isolation`);
  const others = [1, 2, 3, 4].map(() => fresh('msg_isolation'));
  const c = chain();
  for (const svixId of [...others.slice(0, 2), poison, ...others.slice(2)]) {
    await c.queue.enqueue(envelope(svixId));
  }

  c.start();
  await c.batches(1);
  expect(c.responses).toHaveLength(1);
  for (const svixId of others) expect(c.receives(svixId)).toHaveLength(1);
  expect(c.receives(poison)).toHaveLength(1);
  expect(c.responses[0]).toEqual({
    batchItemFailures: [{ itemIdentifier: c.receives(poison)[0]?.messageId }],
  });
  for (let receive = 2; receive <= 5; receive += 1) {
    expect(c.queue.deadList()).toEqual([]);
    c.clock.advance(1_000);
    await c.batches(receive);
    expect(c.receives(poison)).toHaveLength(receive);
  }
  return { c, poison, others };
}

describe('a poison message is isolated, and applies once after a redrive (Ships 6)', () => {
  it('one of five failing every receive is dead-listed after its 5th, while the other four commit once each', async () => {
    const { c, poison, others } = await isolatePoison();

    expect(c.queue.deadList()).toEqual([
      expect.objectContaining({ svixId: poison, receiveCount: 5 }),
    ]);
    expect((await c.queue.read()).dlqVisible).toBe(1);
    expect(c.logged(c.queueLines, 'queue.dead_lettered')).toEqual([
      expect.objectContaining({ svix_id: poison, receive_count: 5 }),
    ]);
    // Each receive failed alone, on the fault's SQLSTATE: never a connection-class pause.
    expect(c.logged(c.workerLines, 'worker.message_failed')).toEqual(
      Array.from({ length: 5 }, () => expect.objectContaining({ pg_code: '23514' })),
    );
    expect(c.logged(c.workerLines, 'worker.database_unavailable')).toEqual([]);
    expect(await c.rows(poison)).toBe(0);
    for (const svixId of others) {
      expect(c.receives(svixId)).toHaveLength(1);
      expect(await c.rows(svixId)).toBe(1);
      expect(c.duplicates(svixId)).toEqual([]);
    }
  });

  it('after the fault is removed, the redrive commits the dead message once and empties the dead list', async () => {
    const { c, poison } = await isolatePoison();
    const deadMessageId = c.receives(poison)[0]?.messageId;

    await removePoisonFault(t.owner);
    expect(await c.queue.startRedrive()).toEqual({ status: 'started', depth: 1 });
    await c.batches(6);

    const redriven = c.receives(poison)[5];
    expect(redriven?.messageId).not.toBe(deadMessageId);
    expect(c.responses[5]).toEqual({ batchItemFailures: [] });
    expect(await c.rows(poison)).toBe(1);
    expect(c.duplicates(poison)).toEqual([]);
    expect(c.queue.deadList()).toEqual([]);
    expect((await c.queue.read()).dlqVisible).toBe(0);
  });

  it('the redriven event delivered again under a new message id commits as a duplicate, one row still', async () => {
    const { c, poison } = await isolatePoison();
    await removePoisonFault(t.owner);
    await c.queue.startRedrive();
    await c.batches(6);

    await c.queue.enqueue(envelope(poison));
    await c.batches(7);

    // The dead message's id, the redrive's, and this copy's: three different ids.
    const [dead, redriven, copy] = c
      .receives(poison)
      .slice(4)
      .map((delivery) => delivery.messageId);
    expect(new Set([dead, redriven, copy]).size).toBe(3);
    expect(c.responses[6]).toEqual({ batchItemFailures: [] });
    expect(c.duplicates(poison)).toHaveLength(1);
    expect(await c.rows(poison)).toBe(1);
    expect(c.queue.deadList()).toEqual([]);
  });
});
