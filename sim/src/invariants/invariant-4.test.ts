import type { IngestEnvelope } from '@ledger/core';
import { createLogger, type DlqPort, InProcessQueueAdapter } from '@ledger/shared';
import { FakeClock } from '@ledger/shared/testing';
import { describe, expect, it } from 'vitest';
import { checkInvariant4, invariant4 } from './invariant-4.ts';

// D24 over the in-process adapter's dead list (D3): the same `DlqPort` the sim reads on AWS through
// `SqsDlqAdapter`. Messages reach the dead list the way they do in a run: every receive fails until
// the 5th, then the queue dead-lists them.

const envelope = (svixId: string): IngestEnvelope => ({
  svixId,
  receivedAt: '2026-10-19T12:00:00.000Z',
  source: 'simulated',
  rawBody:
    '{"type":"email.sent","created_at":"2026-10-19T12:00:00.000Z","data":{"to":["delivered@resend.dev"]}}',
  headers: { 'svix-timestamp': '1792411200' },
});

// Delivery runs on promise callbacks only under `FakeClock`, so one macrotask turn finishes it.
const settle = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

// A DLQ holding exactly these svix ids, one dead message each (a repeated id is two messages).
async function deadList(svixIds: readonly string[]): Promise<InProcessQueueAdapter> {
  const clock = new FakeClock();
  const logger = createLogger({ functionName: 'worker', stream: { write: () => {} } });
  const queue = new InProcessQueueAdapter({ clock, logger, sleep: clock.sleep });
  queue.start(async (messages) => ({
    batchItemFailures: messages.map((message) => ({ itemIdentifier: message.messageId })),
  }));
  for (const svixId of svixIds) await queue.enqueue(envelope(svixId));
  await settle();
  for (let receive = 1; receive < 5; receive += 1) {
    clock.advance(1_000);
    await settle();
  }
  return queue;
}

// A `DlqPort` whose depth readings follow `depths` (the last one repeats) while every receive returns
// one message per svix id: SQS's approximate depth (AWS-22) disagreeing with what the receive holds,
// which the in-process dead list never does. Counts its samples.
function scriptedDlq(
  depths: readonly number[],
  svixIds: readonly string[],
): DlqPort & { samples(): number } {
  let taken = 0;
  const messages = svixIds.map((svixId) => ({
    body: JSON.stringify(envelope(svixId)),
    receiveCount: 5,
  }));
  return {
    sample: async () => {
      const depth = depths[Math.min(taken, depths.length - 1)] ?? 0;
      taken += 1;
      return { depth, messages };
    },
    startRedrive: () => Promise.reject(new Error('invariant 4 never redrives')),
    samples: () => taken,
  };
}

describe('invariant 4: the DLQ holds exactly the poisoned events', () => {
  it('passes when the DLQ holds exactly the poisoned svix_ids', async () => {
    const dlq = await deadList(['simpoison_walk_0', 'simpoison_walk_1']);

    const result = await invariant4(dlq, new Set(['simpoison_walk_0', 'simpoison_walk_1']));

    expect(result.pass).toBe(true);
    expect(result.line).toBe('invariant 4 pass (dlq holds exactly the 2 poisoned)');
  });

  it('passes on an empty DLQ when nothing was poisoned', async () => {
    const result = await invariant4(await deadList([]), new Set());

    expect(result.pass).toBe(true);
    expect(result.line).toBe('invariant 4 pass (dlq holds exactly the 0 poisoned)');
  });

  it('fails naming the stray svix_id when the DLQ holds one the run did not poison', async () => {
    const dlq = await deadList(['simpoison_walk_0', 'walk-svix-3-1']);

    const result = await invariant4(dlq, new Set(['simpoison_walk_0']));

    expect(result.pass).toBe(false);
    expect(result.line).toBe('invariant 4 fail depth=2 poisoned=1 collected=2 stray=walk-svix-3-1');
  });

  it('fails when a poisoned svix_id is not in the DLQ', async () => {
    const dlq = await deadList(['simpoison_walk_0']);

    const result = await invariant4(dlq, new Set(['simpoison_walk_0', 'simpoison_walk_1']));

    expect(result.pass).toBe(false);
    expect(result.line).toBe('invariant 4 fail depth=1 poisoned=2 collected=1 stray=');
  });

  // A poisoned event delivered twice is two dead messages under one svix_id: every id matches, the
  // depth does not.
  it('fails on a depth that differs from the poisoned count, even when every id matches', async () => {
    const dlq = await deadList(['simpoison_walk_0', 'simpoison_walk_0']);

    const result = await invariant4(dlq, new Set(['simpoison_walk_0']));

    expect(result.pass).toBe(false);
    expect(result.line).toBe('invariant 4 fail depth=2 poisoned=1 collected=1 stray=');
  });

  // SQS's depth is approximate (AWS-22): a stray id fails the check even when the depth it read
  // matches the poisoned count and every poisoned id was collected.
  it('fails on a stray id alone, when the depth read matches and nothing poisoned is missing', () => {
    const result = checkInvariant4(
      1,
      new Set(['simpoison_walk_0', 'walk-svix-0-0']),
      new Set(['simpoison_walk_0']),
    );

    expect(result.pass).toBe(false);
    expect(result.line).toBe('invariant 4 fail depth=1 poisoned=1 collected=2 stray=walk-svix-0-0');
  });

  it('names at most five stray ids, so a large leak stays one line', () => {
    const stray = Array.from({ length: 7 }, (_, index) => `walk-svix-${index}-0`);

    const result = checkInvariant4(7, new Set(stray), new Set());

    expect(result.line).toBe(
      'invariant 4 fail depth=7 poisoned=0 collected=7 stray=walk-svix-0-0,walk-svix-1-0,walk-svix-2-0,walk-svix-3-0,walk-svix-4-0',
    );
  });

  // Regression, deployed `--poison 1` on 2026-10-19: the first sample's approximate depth read 0
  // (AWS-62) while its receive returned the poisoned message, and the check failed on that one
  // stale reading. The next sample's depth reads 1.
  it('passes when a first depth reading under-reads a message its receive returns', async () => {
    const dlq = scriptedDlq([0, 1], ['simpoison_walk_0']);

    const result = await invariant4(dlq, new Set(['simpoison_walk_0']));

    expect(result.pass).toBe(true);
    expect(result.line).toBe('invariant 4 pass (dlq holds exactly the 1 poisoned)');
    expect(dlq.samples()).toBe(2);
  });

  it('still fails when every depth reading stays below what the receives return', async () => {
    const dlq = scriptedDlq([0], ['simpoison_walk_0']);

    const result = await invariant4(dlq, new Set(['simpoison_walk_0']));

    expect(result.pass).toBe(false);
    expect(result.line).toBe('invariant 4 fail depth=0 poisoned=1 collected=1 stray=');
    expect(dlq.samples()).toBe(10);
  });

  it('never removes a message: the DLQ holds the same depth after the check', async () => {
    const dlq = await deadList(['simpoison_walk_0']);

    await invariant4(dlq, new Set(['simpoison_walk_0']));

    expect((await dlq.sample(10)).depth).toBe(1);
  });
});
