import { setTimeout as sleepFor } from 'node:timers/promises';
import type { IngestEnvelope } from '@ledger/core';
import type { ClockPort } from './clock.port.ts';
import type { Logger } from './create-logger.ts';
import type { DlqPort, DlqSample, RedriveStart } from './dlq.port.ts';
import type { QueueConsumer, QueueMessage, QueuePort } from './queue.port.ts';
import type { QueueAttributesPort, QueueSnapshot } from './queue-attributes.port.ts';

// ADR-008: the event source mapping's batch size.
const maxBatchSize = 10;
// AWS-09: SQS moves a message to the DLQ once its receive count passes `maxReceiveCount`, default 5.
const maxReceiveCount = 5;
// D8: a failed message becomes visible again after 1 s.
const redeliveryDelayMs = 1_000;

type Stored = {
  readonly messageId: string;
  readonly body: string;
  // D8: recorded at enqueue, because `messageId` is not an allow-listed log key and a body that
  // fails to parse has no readable id.
  readonly svixId: string;
  // D40: the age `read()` reports, kept across redeliveries.
  readonly enqueuedAt: number;
  receiveCount: number;
  visibleAt: number;
};

export type DeadListEntry = {
  readonly messageId: string;
  readonly body: string;
  readonly svixId: string;
  readonly receiveCount: number;
};

export type InProcessQueueDeps = {
  clock: ClockPort;
  logger: Logger;
  // How the queue waits for a redelivery; `FakeClock.sleep` in tests. The signal aborts a wait an
  // enqueue cut short, so no abandoned timer outlives it.
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
};

// An aborted wait settles quietly: the enqueue that aborted it has already woken the pump.
const realSleep = (ms: number, signal: AbortSignal): Promise<void> =>
  sleepFor(ms, undefined, { signal }).catch(() => {});

// D8: slice 1's queue, in memory, in the local process (ADR-013). At-least-once and in no order, as
// SQS standard is (ADR-002): a message is acknowledged only when the consumer leaves it out of
// `batchItemFailures`, redelivered after 1 s otherwise, and moved to the dead list after its 5th
// receive, so none is dropped without reaching a dead store. Slice 2B's Postgres queue makes it
// durable. It is local mode's `QueueAttributesPort` too (D40), and its `DlqPort` over the dead list
// (slice 3, D3).
export class InProcessQueueAdapter implements QueuePort, QueueAttributesPort, DlqPort {
  readonly #clock: ClockPort;
  readonly #logger: Logger;
  readonly #sleep: (ms: number, signal: AbortSignal) => Promise<void>;
  #waiting: Stored[] = [];
  // The batch the consumer holds right now: taken off `#waiting`, not yet settled.
  #delivering: readonly Stored[] = [];
  readonly #deadList: DeadListEntry[] = [];
  #consumer: QueueConsumer | undefined;
  #pumping = false;
  #wake: (() => void) | undefined;
  #lastId = 0;

  constructor({ clock, logger, sleep = realSleep }: InProcessQueueDeps) {
    this.#clock = clock;
    this.#logger = logger;
    this.#sleep = sleep;
  }

  async enqueue(envelope: IngestEnvelope): Promise<void> {
    const now = this.#clock.now().getTime();
    this.#lastId += 1;
    this.#waiting.push({
      messageId: String(this.#lastId),
      body: JSON.stringify(envelope),
      svixId: envelope.svixId,
      enqueuedAt: now,
      receiveCount: 0,
      visibleAt: now,
    });
    this.#kick();
  }

  // D40: `visible` is every waiting message (a redelivery's 1 s delay included), `inFlight` the batch
  // the consumer holds, `dlqVisible` the dead list; nothing is ever in flight on the dead list. The
  // age is the oldest live message's, in whole seconds, as SQS reports it.
  async read(): Promise<QueueSnapshot> {
    const live = [...this.#waiting, ...this.#delivering];
    const oldest = live.length === 0 ? null : Math.min(...live.map((stored) => stored.enqueuedAt));
    return {
      visible: this.#waiting.length,
      inFlight: this.#delivering.length,
      oldestAgeSeconds:
        oldest === null ? null : Math.floor((this.#clock.now().getTime() - oldest) / 1_000),
      dlqVisible: this.#deadList.length,
      dlqInFlight: 0,
    };
  }

  // Starts delivering to the consumer: every waiting message, then each one enqueued later.
  start(consumer: QueueConsumer): void {
    this.#consumer = consumer;
    this.#kick();
  }

  deadList(): readonly DeadListEntry[] {
    return [...this.#deadList];
  }

  // D3: the dead list's first `limit` entries, removing none; nothing is in flight on it, so `depth`
  // is its length.
  async sample(limit: number): Promise<DlqSample> {
    return {
      depth: this.#deadList.length,
      messages: this.#deadList
        .slice(0, limit)
        .map(({ body, receiveCount }) => ({ body, receiveCount })),
    };
  }

  // D3: every dead entry back on the waiting list, its receive count reset, under a new message id as
  // a redrive gives on SQS (AWS-21). It completes at once, so it never answers `redrive_in_progress`.
  async startRedrive(): Promise<RedriveStart> {
    const moved = this.#deadList.splice(0);
    if (moved.length === 0) return { status: 'empty', depth: 0 };
    const now = this.#clock.now().getTime();
    for (const { body, svixId } of moved) {
      this.#lastId += 1;
      this.#waiting.push({
        messageId: String(this.#lastId),
        body,
        svixId,
        enqueuedAt: now,
        receiveCount: 0,
        visibleAt: now,
      });
    }
    this.#kick();
    return { status: 'started', depth: moved.length };
  }

  // Never delivers inside `enqueue`: ingest answers once its enqueue resolved, not after the worker
  // ran (ADR-001).
  #kick(): void {
    this.#wake?.();
    queueMicrotask(() => void this.#pump());
  }

  async #pump(): Promise<void> {
    const consumer = this.#consumer;
    if (consumer === undefined || this.#pumping) return;
    this.#pumping = true;
    try {
      for (;;) {
        const now = this.#clock.now().getTime();
        const batch = this.#takeVisible(now);
        if (batch.length > 0) {
          await this.#deliver(consumer, batch);
          continue;
        }
        if (this.#waiting.length === 0) return;
        const nextVisibleAt = Math.min(...this.#waiting.map((stored) => stored.visibleAt));
        const wait = new AbortController();
        await new Promise<void>((resolve) => {
          this.#wake = resolve;
          void this.#sleep(nextVisibleAt - now, wait.signal).then(resolve);
        });
        this.#wake = undefined;
        // Woken by an enqueue before the timer fired: cancel it rather than leave it pending.
        wait.abort();
      }
    } finally {
      this.#pumping = false;
    }
  }

  #takeVisible(now: number): Stored[] {
    const batch: Stored[] = [];
    const rest: Stored[] = [];
    for (const stored of this.#waiting) {
      (batch.length < maxBatchSize && stored.visibleAt <= now ? batch : rest).push(stored);
    }
    this.#waiting = rest;
    return batch;
  }

  async #deliver(consumer: QueueConsumer, batch: Stored[]): Promise<void> {
    for (const stored of batch) stored.receiveCount += 1;
    const messages: QueueMessage[] = batch.map(({ messageId, body }) => ({ messageId, body }));
    let failed: ReadonlySet<string>;
    this.#delivering = batch;
    try {
      const response = await consumer(messages);
      failed = new Set(response.batchItemFailures.map((failure) => failure.itemIdentifier));
    } catch {
      // As on Lambda, a consumer that throws fails the whole batch: every message is redelivered,
      // then dead-listed with its line, so the failure is never swallowed.
      failed = new Set(batch.map((stored) => stored.messageId));
    } finally {
      this.#delivering = [];
    }
    const now = this.#clock.now().getTime();
    for (const stored of batch) {
      if (!failed.has(stored.messageId)) continue;
      if (stored.receiveCount >= maxReceiveCount) {
        const { messageId, body, svixId, receiveCount } = stored;
        this.#deadList.push({ messageId, body, svixId, receiveCount });
        this.#logger.error('queue.dead_lettered', { svix_id: svixId, receive_count: receiveCount });
      } else {
        stored.visibleAt = now + redeliveryDelayMs;
        this.#waiting.push(stored);
      }
    }
  }
}
