import type { Executor } from '@ledger/db';
import { FakeEventSourceControl, FakeQueueAttributes } from '@ledger/shared/testing';
import { describe, expect, it } from 'vitest';
import { GetHealthReader } from './get-health.reader.ts';

// D19: a request makes at most one database attempt. An unverified caller (the middleware's lookup
// already found the database unreachable) must not make a second, because two stacked attempts
// outlast API Gateway's 30 s (AWS-02).

// A database whose every statement fails with an error the classifier does not match, so an
// attempt would reject the read rather than report `reachable: false`; it counts the attempts.
function countingDatabase(): { db: Executor; attempts: () => number } {
  let attempts = 0;
  const db = {
    execute: () => {
      attempts += 1;
      return Promise.reject(new TypeError('unexpected statement'));
    },
  } as unknown as Executor;
  return { db, attempts: () => attempts };
}

function reader(db: Executor): GetHealthReader {
  return new GetHealthReader({
    db,
    queueAttributes: new FakeQueueAttributes({ visible: 2, oldestAgeSeconds: 7 }),
    eventSource: new FakeEventSourceControl('paused'),
    storageLimitBytes: 1_000,
  });
}

describe('GetHealthReader', () => {
  it('a verified: false caller makes no storageBytes call and reports the database unreachable', async () => {
    const { db, attempts } = countingDatabase();

    const read = await reader(db).execute({ verified: false });

    expect(attempts()).toBe(0);
    expect(read).toEqual({
      queue: { visible: 2, inFlight: 0, oldestAgeSeconds: 7, dlqVisible: 0, dlqInFlight: 0 },
      eventSourceState: 'paused',
      storageBytes: null,
      storageLimitBytes: 1_000,
      lastReconcileRun: null,
    });
  });

  it('a verified caller reads storage: the same database is attempted once, and its failure propagates', async () => {
    const { db, attempts } = countingDatabase();

    await expect(reader(db).execute({ verified: true })).rejects.toThrow(TypeError);
    expect(attempts()).toBe(1);
  });
});
