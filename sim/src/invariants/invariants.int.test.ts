// Simulator invariants 1 and 2 on real Postgres, as the runtime role: the checkers issue SQL through
// `packages/db`, so their pass and fail lines are proven against rows the worker's own transaction
// wrote (pp-testing → Case-by-case), not only against constructed rows (`invariant-<n>.test.ts`).
import type { IngestEnvelope, LedgerEvent } from '@ledger/core';
import { type LedgerHistory, ledgerHistory } from '@ledger/core/testing';
import { createTestDatabase, type TestDatabase } from '@ledger/db/testing';
import { FakeClock, RecordingMetrics } from '@ledger/shared/testing';
import { RecordEventCommand } from '@ledger/worker';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { arrangeEvents } from '../arrange-events.ts';
import { sampleOnce } from '../sample-once.ts';
import { generatedSvixIds, invariant1 } from './invariant-1.ts';
import { expectedLedger, invariant2 } from './invariant-2.ts';

const key = new Uint8Array(32).fill(13);
const clock = new FakeClock('2026-10-17T12:01:00.000Z');
const seed = 42;

let t: TestDatabase;
let record: RecordEventCommand;

beforeAll(async () => {
  t = await createTestDatabase();
  record = new RecordEventCommand({
    database: t.database,
    clock,
    metrics: new RecordingMetrics(),
    addressHashKey: key,
  });
});

afterAll(async () => {
  await t.drop();
});

// Fresh namespace per test: tests in this file share one clone, and every id, `svix_id` and
// `+label` address derives from the namespace, so each test asserts only on its own rows.
let lastNamespace = 0;
function labelledHistory(): LedgerHistory {
  lastNamespace += 1;
  return sampleOnce(
    ledgerHistory({ namespace: `int${lastNamespace}`, labelEveryAddress: true }),
    seed,
  );
}

// One queue message, as ingest enqueues a verified delivery of `JSON.stringify(payload)` (D12).
async function deliver(event: LedgerEvent): Promise<void> {
  const envelope: IngestEnvelope = {
    svixId: event.svixId,
    receivedAt: '2026-10-17T12:00:59.000Z',
    source: 'simulated',
    rawBody: JSON.stringify(event.payload),
    headers: { 'svix-timestamp': '1792238459' },
  };
  await record.execute({ body: JSON.stringify(envelope) });
}

// The run's arrangement: repeats and a shuffle, so the pass case is the live run's worst order.
async function deliverArranged(history: LedgerHistory, skip: ReadonlySet<string> = new Set()) {
  const { events } = arrangeEvents(history, { seed, duplicates: 0.3, shuffle: true });
  for (const { event } of events) {
    if (!skip.has(event.svixId)) {
      await deliver(event);
    }
  }
}

describe('simulator invariants 1 and 2 against the worker-written ledger', () => {
  it('pass with the exact lines when every event of a shuffled, repeated history was recorded', async () => {
    const history = labelledHistory();
    await deliverArranged(history);

    const generated = generatedSvixIds(history).length;
    const expected = expectedLedger(history, key);
    const first = await invariant1(t.db, history);
    const second = await invariant2(t.db, history, key);

    expect(first.line).toBe(`invariant 1 pass stored=${generated}/${generated}`);
    expect(first.pass).toBe(true);
    expect(second.line).toBe(
      `invariant 2 pass emails=${history.emails.length} recipients=${expected.recipients.length}`,
    );
    expect(second.pass).toBe(true);
    // Not vacuous: the history has emails, recipients and the walk probe.
    expect(expected.recipients.length).toBeGreaterThan(0);
    expect(history.emails.some(({ emailId }) => emailId.endsWith('-probe'))).toBe(true);
  });

  it('invariant 1 fails naming the svix_id of an event the ledger never recorded', async () => {
    const history = labelledHistory();
    const [lost] = generatedSvixIds(history);
    if (lost === undefined) {
      throw new Error('the history generated no event');
    }
    await deliverArranged(history, new Set([lost]));

    const result = await invariant1(t.db, history);

    expect(result.pass).toBe(false);
    expect(result.line).toBe(`invariant 1 fail missing=1 svix_ids=${lost}`);
  });

  it('invariant 2 fails naming the email whose rows hold an effect the ground truth lacks', async () => {
    const history = labelledHistory();
    await deliverArranged(history);
    // An event outside the ground truth: a complaint from the probe's delivered recipient, after
    // every generated event. Its rows now differ from the ground truth's projection.
    const probe = history.emails.find(({ emailId }) => emailId.endsWith('-probe'));
    const delivered = probe?.events.find(({ type }) => type === 'email.delivered');
    if (probe === undefined || delivered === undefined) {
      throw new Error('the history holds no walk probe');
    }
    const createdAt = new Date('2026-10-17T13:00:00.000Z');
    const payload = delivered.payload as { data: Record<string, unknown> };
    await deliver({
      ...delivered,
      svixId: `${probe.emailId}-svix-extra`,
      type: 'email.complained',
      eventCreatedAt: createdAt,
      payload: { ...payload, type: 'email.complained', created_at: createdAt.toISOString() },
    });

    const first = await invariant1(t.db, history);
    const second = await invariant2(t.db, history, key);

    // Every generated event is still stored once: only invariant 2 can see the extra effect.
    expect(first.pass).toBe(true);
    expect(second.pass).toBe(false);
    expect(second.line).toBe(`invariant 2 fail email_ids=${probe.emailId}`);
  });
});
