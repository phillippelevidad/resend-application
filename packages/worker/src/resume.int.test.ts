// Slice 2, R8 (ADR-015, D16): the resume event leaves an enabled source alone without opening a
// database connection, and re-enables a paused one only after the probe connects and reads storage
// below `STORAGE_PROBE_THRESHOLD` of the limit: a read succeeds on a full database too.

import type { EventSourceState } from '@ledger/core';
import { createDatabase, type Database, STORAGE_LIMIT_BYTES } from '@ledger/db';
import { createTestDatabase, type TestDatabase } from '@ledger/db/testing';
import type { Logger } from '@ledger/shared';
import { FakeClock, FakeEventSourceControl, RecordingMetrics } from '@ledger/shared/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createWorker, type Worker } from './create-worker.ts';

const silentLogger: Logger = { info: () => {}, warn: () => {}, error: () => {} };

let t: TestDatabase;
// A pool whose every connect is refused: nothing listens on port 1.
let unreachable: Database;

beforeAll(async () => {
  t = await createTestDatabase();
  unreachable = createDatabase({
    url: 'postgres://ledger_runtime:unused@127.0.0.1:1/ledger',
    max: 1,
    logger: silentLogger,
  });
});

afterAll(async () => {
  await unreachable.pool.end();
  await t.drop();
});

function workerOver(
  database: Database,
  state: EventSourceState,
  storageLimitBytes = STORAGE_LIMIT_BYTES,
): { resume: Worker['resume']; eventSource: FakeEventSourceControl } {
  const eventSource = new FakeEventSourceControl(state);
  const worker = createWorker({
    database,
    eventSource,
    storageLimitBytes,
    clock: new FakeClock('2026-10-17T12:01:00.000Z'),
    logger: silentLogger,
    metrics: new RecordingMetrics(),
    addressHashKey: new Uint8Array(32).fill(9),
  });
  return { resume: () => worker.resume(), eventSource };
}

describe('worker.resume (ADR-015)', () => {
  it('an enabled source answers already_enabled and opens no database connection', async () => {
    const { resume, eventSource } = workerOver(unreachable, 'enabled');

    expect(await resume()).toEqual({ outcome: 'already_enabled', state: 'enabled' });
    expect(eventSource.state).toBe('enabled');
    expect(unreachable.pool.totalCount).toBe(0);
  });

  it('a paused source with the database up and storage below the threshold is re-enabled', async () => {
    const { resume, eventSource } = workerOver(t.database, 'paused');

    expect(await resume()).toEqual({ outcome: 'resumed', state: 'enabled' });
    expect(eventSource.state).toBe('enabled');
  });

  it('a paused source stays paused while storage is at the limit (limit injected at 1 byte)', async () => {
    const { resume, eventSource } = workerOver(t.database, 'paused', 1);

    expect(await resume()).toEqual({ outcome: 'probe_failed', state: 'paused' });
    expect(eventSource.state).toBe('paused');
  });

  it('a paused source stays paused while the database is unreachable', async () => {
    const { resume, eventSource } = workerOver(unreachable, 'paused');

    expect(await resume()).toEqual({ outcome: 'probe_failed', state: 'paused' });
    expect(eventSource.state).toBe('paused');
  }, 15_000);
});
