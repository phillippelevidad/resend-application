import { FakeClock } from '@ledger/shared/testing';
import { describe, expect, it } from 'vitest';
import {
  type DbOutageRunInput,
  dbOutageRun,
  holdsOutageHost,
  OUTAGE_HOST,
  type RecycledFunction,
  repointDatabaseSecret,
} from './db-outage-run.ts';
import { settleBound } from './live-run.ts';

// A fake secret only: no real host, password or key. Its parts are what no output line may hold.
const PASSWORD = 'fake-secret-password-7f3a';
const HOST = 'ep-fake-pooler.example.test';
// Joined at run time, so no credentialed Postgres URL literal sits in the source (gitleaks).
const postgresUrl = (rest: string): string => ['postgresql:/', `/${rest}`].join('');
const ORIGINAL = JSON.stringify({
  pooledUrl: postgresUrl(`ledger_runtime:${PASSWORD}@${HOST}:5432/ledger?sslmode=require`),
  addressHashKey: 'a'.repeat(64),
  tokenTagKey: 'b'.repeat(64),
});

const minute = 60_000;

// Every function that reads the database secret once per container, recycled into the outage and
// out of it.
const recycledInAndOut: Record<RecycledFunction, string[]> = {
  worker: ['ledger-sim db-outage walk', ''],
  api: ['ledger-sim db-outage walk', ''],
  reconciler: ['ledger-sim db-outage walk', ''],
};

// What `world()` prints end to end, in the order Surfaces prints.
const completedLines = [
  'chaos db-outage: database repointed, worker, api and reconciler recycled',
  'sent requests=24 accepted=24 first_attempt_200=24',
  'worker paused after 40s',
  'queue-age alarm ALARM after 6m; dlq depth 0',
  'chaos db-outage: database restored, worker, api and reconciler recycled',
  'resume: pnpm -s ledger worker resume, or wait for the hourly resume',
  'worker enabled after 3m',
  'settled stored=20/20 after 4s',
  'invariant 1 pass stored=20/20',
  'invariant 2 pass emails=7 recipients=9',
  'invariant 3 not checked (slice 6)',
  'invariant 4 pass (dlq holds exactly the 0 poisoned)',
];

// An SDK timeout whose text names a host, as a lost route to the region throws it.
const timeoutError = (): Error =>
  Object.assign(new Error(`connect ETIMEDOUT ${HOST}`), { name: 'TimeoutError' });

type World = {
  run: DbOutageRunInput;
  clock: FakeClock;
  stdout: string[];
  stderr: string[];
  // The deployed state the run changes: the stored secret and each function's description.
  secret: { value: string; writes: string[] };
  descriptions: Record<RecycledFunction, string[]>;
  sent: { count: number };
};

type Overrides = Partial<DbOutageRunInput> & {
  // When the worker reads `paused` and `enabled` again, in ms after the send.
  pausesAfterMs?: number;
  // When the queue-age alarm reads `ALARM`, in ms after the send.
  alarmAfterMs?: number;
  // The DLQ depth during the outage.
  dlqHolds?: number;
};

// A deployed stack in miniature: the worker pauses once the secret points at the outage host and the
// history is in the queue, and resumes once the secret is back; the alarm fires on the clock.
function world(options: Overrides = {}): World {
  const { pausesAfterMs: pauseKnob, alarmAfterMs: alarmKnob, dlqHolds, ...overrides } = options;
  const clock = new FakeClock();
  const stdout: string[] = [];
  const stderr: string[] = [];
  const secret = { value: ORIGINAL, writes: [] as string[] };
  const descriptions: Record<RecycledFunction, string[]> = { worker: [], api: [], reconciler: [] };
  const sent = { count: 0 };
  let sentAt: number | undefined;
  let restoredAt: number | undefined;
  const elapsed = () => clock.now().getTime() - (sentAt ?? Number.POSITIVE_INFINITY);
  const pausesAfterMs = pauseKnob ?? 40_000;
  const alarmAfterMs = alarmKnob ?? 6 * minute;

  const run: DbOutageRunInput = {
    namespace: 'walk',
    clock,
    sleep: async (ms) => {
      clock.advance(ms);
    },
    guard: async () => undefined,
    eventSourceState: async () => {
      if (restoredAt !== undefined) {
        return clock.now().getTime() - restoredAt >= 3 * minute ? 'enabled' : 'paused';
      }
      return holdsOutageHost(secret.value) && elapsed() >= pausesAfterMs ? 'paused' : 'enabled';
    },
    readDatabaseSecret: async () => secret.value,
    writeDatabaseSecret: async (value) => {
      secret.value = value;
      secret.writes.push(value);
      if (value === ORIGINAL) restoredAt = clock.now().getTime();
    },
    recycle: async (fn, description) => {
      descriptions[fn].push(description);
    },
    send: async () => {
      sent.count += 1;
      sentAt = clock.now().getTime();
      return { requests: 24, accepted: 24 };
    },
    queueAgeAlarmState: async () => (elapsed() >= alarmAfterMs ? 'ALARM' : 'OK'),
    dlqDepth: async () => dlqHolds ?? 0,
    settle: async () => ({
      expected: 20,
      present: 20,
      settled: true,
      bound: settleBound(20),
      elapsedMs: 4_000,
    }),
    invariant1: async () => ({ pass: true, line: 'invariant 1 pass stored=20/20' }),
    invariant2: async () => ({ pass: true, line: 'invariant 2 pass emails=7 recipients=9' }),
    invariant4: async () => ({
      pass: true,
      line: 'invariant 4 pass (dlq holds exactly the 0 poisoned)',
    }),
    out: (line) => stdout.push(line),
    err: (line) => stderr.push(line),
    ...overrides,
  };
  return { run, clock, stdout, stderr, secret, descriptions, sent };
}

// D28: no line holds the secret, any part of its URL, or a URL at all.
function expectNoSecretOrUrl(lines: readonly string[]): void {
  for (const line of lines) {
    expect(line).not.toContain(PASSWORD);
    expect(line).not.toContain(HOST);
    expect(line).not.toContain(OUTAGE_HOST);
    expect(line).not.toContain('postgres');
    expect(line).not.toContain('://');
    expect(line).not.toContain('a'.repeat(64));
  }
}

describe('repointDatabaseSecret', () => {
  it("replaces only pooledUrl's host with the .invalid one, keeping port, user, password, database, query and every other field", () => {
    const repointed = repointDatabaseSecret(ORIGINAL);
    expect(repointed).toBeDefined();
    const parsed = JSON.parse(repointed ?? '');
    expect(parsed).toEqual({
      pooledUrl: postgresUrl(
        `ledger_runtime:${PASSWORD}@${OUTAGE_HOST}:5432/ledger?sslmode=require`,
      ),
      addressHashKey: 'a'.repeat(64),
      tokenTagKey: 'b'.repeat(64),
    });
    expect(holdsOutageHost(repointed ?? '')).toBe(true);
    expect(holdsOutageHost(ORIGINAL)).toBe(false);
  });

  it('refuses a value that is not a secret holding a Postgres pooledUrl', () => {
    expect(repointDatabaseSecret('not json')).toBeUndefined();
    expect(repointDatabaseSecret(JSON.stringify({ url: 'postgresql://h/d' }))).toBeUndefined();
    expect(repointDatabaseSecret(JSON.stringify({ pooledUrl: 'https://h/d' }))).toBeUndefined();
  });
});

describe('dbOutageRun', () => {
  it('repoints, holds the outage until the queue-age alarm, restores, waits for the resume and checks invariants 1, 2 and 4, in the order Surfaces prints', async () => {
    const { run, stdout, stderr, secret, descriptions } = world();

    expect(await dbOutageRun(run)).toBe(0);

    expect(stdout).toEqual(completedLines);
    expect(stderr).toEqual([]);
    // The fault, then the original back; each function recycled into the outage and out of it.
    expect(secret.writes.map(holdsOutageHost)).toEqual([true, false]);
    expect(secret.value).toBe(ORIGINAL);
    expect(descriptions).toEqual(recycledInAndOut);
    expectNoSecretOrUrl(stdout);
  });

  it('restores the secret and recycles every function when a step fails after the fault, then exits 1', async () => {
    const { run, stdout, stderr, secret, descriptions } = world();
    // The send, with the fault in place, fails outside any bounded wait (a read inside one is "not
    // yet", next tests).
    run.send = async () => {
      throw Object.assign(new Error(`connect ECONNREFUSED ${HOST}`), { name: 'TypeError' });
    };

    expect(await dbOutageRun(run)).toBe(1);

    expect(secret.value).toBe(ORIGINAL);
    expect(descriptions).toEqual(recycledInAndOut);
    expect(stderr).toEqual(['sim: the db-outage run failed (TypeError)']);
    expect(stdout).toContain(
      'chaos db-outage: database restored, worker, api and reconciler recycled',
    );
    expect(stdout).not.toContain('worker enabled after 3m');
    expectNoSecretOrUrl([...stdout, ...stderr]);
  });

  // The walk's lost route to us-east-2 (F2): one AWS read throws inside a bounded wait. Each run must
  // still complete as `world()` does, the secret written back once, after the hold.
  it('keeps the outage when an event-source read throws TimeoutError 10 s into the pause wait, instead of failing the run and restoring the secret early', async () => {
    const { run, stdout, stderr, secret } = world();
    const read = run.eventSourceState;
    let faultReads = 0;
    run.eventSourceState = async () => {
      if (secret.writes.length === 1 && ++faultReads === 2) throw timeoutError();
      return read();
    };

    expect(await dbOutageRun(run)).toBe(0);

    expect(faultReads).toBeGreaterThan(2);
    expect(stdout).toEqual(completedLines);
    expect(stderr).toEqual([]);
    expect(secret.writes.map(holdsOutageHost)).toEqual([true, false]);
  });

  it('keeps the outage when a DLQ depth read and an alarm read each throw TimeoutError in the queue-age wait, instead of failing the run and restoring the secret early', async () => {
    const { run, stdout, stderr, secret } = world();
    const depth = run.dlqDepth;
    const alarm = run.queueAgeAlarmState;
    let depthReads = 0;
    let alarmReads = 0;
    run.dlqDepth = async () => {
      if (++depthReads === 1) throw timeoutError();
      return depth();
    };
    run.queueAgeAlarmState = async () => {
      if (secret.writes.length === 1 && ++alarmReads === 2) throw timeoutError();
      return alarm();
    };

    expect(await dbOutageRun(run)).toBe(0);

    expect(alarmReads).toBeGreaterThan(2);
    expect(stdout).toEqual(completedLines);
    expect(stderr).toEqual([]);
    expect(secret.writes.map(holdsOutageHost)).toEqual([true, false]);
  });

  it('still drains and checks the invariants when an event-source read throws TimeoutError in the enabled wait, instead of failing the run', async () => {
    const { run, stdout, stderr, secret } = world();
    const read = run.eventSourceState;
    let restoredReads = 0;
    run.eventSourceState = async () => {
      if (secret.writes.length === 2 && ++restoredReads === 1) throw timeoutError();
      return read();
    };

    expect(await dbOutageRun(run)).toBe(0);

    expect(restoredReads).toBeGreaterThan(1);
    expect(stdout).toEqual(completedLines);
    expect(stderr).toEqual([]);
    expect(secret.writes.map(holdsOutageHost)).toEqual([true, false]);
  });

  it('keeps the outage for the whole 10 min pause bound when every event-source read throws, then restores and fails naming the error, not AWS-U15', async () => {
    const { run, stdout, stderr, secret, descriptions } = world();
    const read = run.eventSourceState;
    const restoreRecycledAt: number[] = [];
    let sentAt = 0;
    const send = run.send;
    run.send = async () => {
      sentAt = run.clock.now().getTime();
      return send();
    };
    run.eventSourceState = async () => {
      if (secret.writes.length === 1) throw timeoutError();
      return read();
    };
    const recycle = run.recycle;
    run.recycle = async (fn, description) => {
      if (description === '') restoreRecycledAt.push(run.clock.now().getTime());
      await recycle(fn, description);
    };

    expect(await dbOutageRun(run)).toBe(1);

    expect(stderr).toEqual(['sim: the db-outage run failed (TimeoutError)']);
    expect(stdout).toContain(
      'chaos db-outage: database restored, worker, api and reconciler recycled',
    );
    expect(secret.writes.map(holdsOutageHost)).toEqual([true, false]);
    expect(descriptions).toEqual(recycledInAndOut);
    expect((restoreRecycledAt[0] ?? 0) - sentAt).toBeGreaterThanOrEqual(10 * minute);
    expectNoSecretOrUrl([...stdout, ...stderr]);
  });

  it('restores when the worker never pauses within 10 min (AWS-U15), and fails the run', async () => {
    const { run, stdout, stderr, secret, descriptions } = world({
      pausesAfterMs: Number.POSITIVE_INFINITY,
    });

    expect(await dbOutageRun(run)).toBe(1);

    expect(stderr).toEqual(['sim: the worker did not pause within 10m (AWS-U15)']);
    expect(secret.value).toBe(ORIGINAL);
    expect(descriptions.worker.at(-1)).toBe('');
    expect(descriptions.api.at(-1)).toBe('');
    expect(descriptions.reconciler.at(-1)).toBe('');
    expect(stdout.at(-1)).toBe(
      'resume: pnpm -s ledger worker resume, or wait for the hourly resume',
    );
  });

  it('fails the run when a message reaches the DLQ during the outage, and still restores', async () => {
    const { run, stderr, secret } = world({ dlqHolds: 2 });

    expect(await dbOutageRun(run)).toBe(1);

    expect(stderr).toEqual([
      'sim: the DLQ holds 2 messages during the outage; the pause did not hold',
    ]);
    expect(secret.value).toBe(ORIGINAL);
  });

  it('fails at the 45 min bound when the queue-age alarm never fires', async () => {
    const { run, stderr, secret } = world({ alarmAfterMs: Number.POSITIVE_INFINITY });

    expect(await dbOutageRun(run)).toBe(1);

    expect(stderr).toEqual(['sim: LedgerApp-queue-age did not read ALARM within 45m']);
    expect(secret.value).toBe(ORIGINAL);
  });

  it('prints the not-restored line and exits 1 when the restore fails', async () => {
    const { run, stdout, stderr, secret } = world();
    const write = run.writeDatabaseSecret;
    let writes = 0;
    run.writeDatabaseSecret = async (value) => {
      writes += 1;
      if (writes > 1) throw new Error(`write failed for ${value}`);
      await write(value);
    };

    expect(await dbOutageRun(run)).toBe(1);

    expect(holdsOutageHost(secret.value)).toBe(true);
    expect(stderr).toEqual([
      'sim: the database secret was not restored; run pnpm aws:deploy, which rewrites it',
    ]);
    expect(stdout).not.toContain(
      'resume: pnpm -s ledger worker resume, or wait for the hourly resume',
    );
    expectNoSecretOrUrl([...stdout, ...stderr]);
  });

  // Each function reads the secret once per container, so a recycle skipped after another step
  // failed would leave it on the outage host.
  it('still recycles the api and the reconciler when the restore recycle of the worker fails, and names the worker', async () => {
    const { run, stdout, stderr, secret, descriptions } = world();
    const recycle = run.recycle;
    run.recycle = async (fn, description) => {
      if (fn === 'worker' && description === '') throw new Error('ResourceConflictException');
      await recycle(fn, description);
    };

    expect(await dbOutageRun(run)).toBe(1);

    expect(secret.value).toBe(ORIGINAL);
    expect(descriptions.api).toEqual(['ledger-sim db-outage walk', '']);
    expect(descriptions.reconciler).toEqual(['ledger-sim db-outage walk', '']);
    expect(stderr).toEqual([
      'sim: the database secret is restored, but recycling the worker failed; its containers that read the outage host keep it until recycled',
    ]);
    expect(stdout).not.toContain(
      'chaos db-outage: database restored, worker, api and reconciler recycled',
    );
    expectNoSecretOrUrl([...stdout, ...stderr]);
  });

  // Slice 4: the reconciler keeps its pool per container too. One that cold-started on an hourly
  // tick during the outage holds the outage host after the restore unless it is recycled, so every
  // later run fails and `LedgerApp-reconcile-gap` fires.
  it('recycles the reconciler on the restore and names it with the worker when both of their restore recycles fail', async () => {
    const { run, stdout, stderr, secret, descriptions } = world();
    const recycle = run.recycle;
    run.recycle = async (fn, description) => {
      if (fn !== 'api' && description === '') throw new Error('ResourceConflictException');
      await recycle(fn, description);
    };

    expect(await dbOutageRun(run)).toBe(1);

    expect(secret.value).toBe(ORIGINAL);
    expect(descriptions.api).toEqual(['ledger-sim db-outage walk', '']);
    expect(stderr).toEqual([
      'sim: the database secret is restored, but recycling the worker and reconciler failed; its containers that read the outage host keep it until recycled',
    ]);
    expect(stdout).not.toContain(
      'resume: pnpm -s ledger worker resume, or wait for the hourly resume',
    );
  });

  it('attempts every restore recycle when the write back fails', async () => {
    const { run, stderr, descriptions } = world();
    const write = run.writeDatabaseSecret;
    let writes = 0;
    run.writeDatabaseSecret = async (value) => {
      writes += 1;
      if (writes > 1) throw new Error('write failed');
      await write(value);
    };

    expect(await dbOutageRun(run)).toBe(1);

    expect(descriptions).toEqual(recycledInAndOut);
    expect(stderr).toEqual([
      'sim: the database secret was not restored; run pnpm aws:deploy, which rewrites it',
    ]);
  });

  it('leaves a secret someone else rewrote during the run, and still recycles every function', async () => {
    const rewritten = JSON.stringify({ pooledUrl: postgresUrl('u:p@other.example.test/ledger') });
    const { run, secret, descriptions } = world({
      send: async () => {
        // A deploy lands mid-run and rewrites the secret.
        secret.value = rewritten;
        return { requests: 24, accepted: 24 };
      },
      pausesAfterMs: Number.POSITIVE_INFINITY,
    });

    expect(await dbOutageRun(run)).toBe(1);

    expect(secret.value).toBe(rewritten);
    expect(descriptions.worker.at(-1)).toBe('');
    expect(descriptions.api.at(-1)).toBe('');
    expect(descriptions.reconciler.at(-1)).toBe('');
  });

  it('refuses before any write when the event source is already paused, and sends nothing', async () => {
    const { run, stderr, secret, sent, descriptions } = world({
      eventSourceState: async () => 'paused',
    });

    expect(await dbOutageRun(run)).toBe(1);

    expect(stderr).toEqual([
      "sim: the worker's event source reads paused; resume it with pnpm -s ledger worker resume first",
    ]);
    expect(secret.writes).toEqual([]);
    expect(sent.count).toBe(0);
    expect(descriptions).toEqual({ worker: [], api: [], reconciler: [] });
  });

  it('refuses before any write or recycle when the queue-age alarm already reads ALARM, so a stale alarm never passes as the outage', async () => {
    const { run, stdout, stderr, secret, sent, descriptions } = world({
      queueAgeAlarmState: async () => 'ALARM',
    });

    expect(await dbOutageRun(run)).toBe(1);

    expect(stderr).toEqual([
      'sim: LedgerApp-queue-age already reads ALARM; wait for it to return to OK, then rerun',
    ]);
    expect(stdout).toEqual([]);
    expect(secret.writes).toEqual([]);
    expect(sent.count).toBe(0);
    expect(descriptions).toEqual({ worker: [], api: [], reconciler: [] });
  });

  it('proceeds when the queue-age alarm reads INSUFFICIENT_DATA before the run, and holds until it reads ALARM', async () => {
    const { run, stdout, stderr, secret } = world();
    const held = run.queueAgeAlarmState;
    // Before the fault the alarm has no data yet; with the fault in place it ages as the world says.
    run.queueAgeAlarmState = async () =>
      holdsOutageHost(secret.value) ? held() : 'INSUFFICIENT_DATA';

    expect(await dbOutageRun(run)).toBe(0);

    expect(stderr).toEqual([]);
    expect(stdout).toContain(
      'chaos db-outage: database repointed, worker, api and reconciler recycled',
    );
    expect(stdout).toContain('queue-age alarm ALARM after 6m; dlq depth 0');
    expect(secret.writes.map(holdsOutageHost)).toEqual([true, false]);
  });

  it("prints the guard's refusal and changes nothing", async () => {
    const { run, stderr, secret, sent } = world({
      guard: async () => 'sim: the stack is tripped; run pnpm aws:rearm first',
    });

    expect(await dbOutageRun(run)).toBe(1);

    expect(stderr).toEqual(['sim: the stack is tripped; run pnpm aws:rearm first']);
    expect(secret.writes).toEqual([]);
    expect(sent.count).toBe(0);
  });

  it("refuses a secret a crashed run left on the outage host, so the fault is never kept as 'the original'", async () => {
    const { run, stderr, secret, sent } = world();
    secret.value = repointDatabaseSecret(ORIGINAL) ?? '';

    expect(await dbOutageRun(run)).toBe(1);

    expect(stderr).toEqual([
      `sim: the database secret already points at ${OUTAGE_HOST} (a crashed run?); run pnpm aws:deploy, which rewrites it`,
    ]);
    expect(secret.writes).toEqual([]);
    expect(sent.count).toBe(0);
  });

  it('exits 1 when any request was not accepted, though the outage held and nothing was lost', async () => {
    const { run, stdout } = world({ send: async () => ({ requests: 24, accepted: 23 }) });

    expect(await dbOutageRun(run)).toBe(1);

    expect(stdout).toContain('sent requests=24 accepted=23 first_attempt_200=23');
  });

  it('exits 1 when an invariant fails after the drain', async () => {
    const { run } = world({
      invariant1: async () => ({ pass: false, line: 'invariant 1 fail missing=1 svix_ids=x' }),
    });

    expect(await dbOutageRun(run)).toBe(1);
  });
});
