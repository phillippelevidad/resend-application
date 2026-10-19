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
const ORIGINAL = JSON.stringify({
  pooledUrl: `postgresql://ledger_runtime:${PASSWORD}@${HOST}:5432/ledger?sslmode=require`,
  addressHashKey: 'a'.repeat(64),
  tokenTagKey: 'b'.repeat(64),
});

const minute = 60_000;

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
  const descriptions: Record<RecycledFunction, string[]> = { worker: [], api: [] };
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
      pooledUrl: `postgresql://ledger_runtime:${PASSWORD}@${OUTAGE_HOST}:5432/ledger?sslmode=require`,
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

    expect(stdout).toEqual([
      'chaos db-outage: database repointed, worker and api recycled',
      'sent requests=24 accepted=24 first_attempt_200=24',
      'worker paused after 40s',
      'queue-age alarm ALARM after 6m; dlq depth 0',
      'chaos db-outage: database restored, worker and api recycled',
      'resume: pnpm -s ledger worker resume, or wait for the hourly resume',
      'worker enabled after 3m',
      'settled stored=20/20 after 4s',
      'invariant 1 pass stored=20/20',
      'invariant 2 pass emails=7 recipients=9',
      'invariant 3 not checked (slice 6)',
      'invariant 4 pass (dlq holds exactly the 0 poisoned)',
    ]);
    expect(stderr).toEqual([]);
    // The fault, then the original back; each function recycled into the outage and out of it.
    expect(secret.writes.map(holdsOutageHost)).toEqual([true, false]);
    expect(secret.value).toBe(ORIGINAL);
    expect(descriptions).toEqual({
      worker: ['ledger-sim db-outage walk', ''],
      api: ['ledger-sim db-outage walk', ''],
    });
    expectNoSecretOrUrl(stdout);
  });

  it('restores the secret and recycles both functions when a step fails after the fault, then exits 1', async () => {
    const { run, stdout, stderr, secret, descriptions } = world();
    // The pre-fault read succeeds; the hold's read, with the fault in place, fails.
    run.queueAgeAlarmState = async () => {
      if (!holdsOutageHost(secret.value)) return 'OK';
      throw Object.assign(new Error(`arn:aws:cloudwatch:… ${HOST}`), {
        name: 'ThrottlingException',
      });
    };

    expect(await dbOutageRun(run)).toBe(1);

    expect(secret.value).toBe(ORIGINAL);
    expect(descriptions.worker).toEqual(['ledger-sim db-outage walk', '']);
    expect(descriptions.api).toEqual(['ledger-sim db-outage walk', '']);
    expect(stderr).toEqual(['sim: the db-outage run failed (ThrottlingException)']);
    expect(stdout).toContain('chaos db-outage: database restored, worker and api recycled');
    expect(stdout).not.toContain('worker enabled after 3m');
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

  it('leaves a secret someone else rewrote during the run, and still recycles both functions', async () => {
    const rewritten = JSON.stringify({ pooledUrl: 'postgresql://u:p@other.example.test/ledger' });
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
    expect(descriptions).toEqual({ worker: [], api: [] });
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
    expect(descriptions).toEqual({ worker: [], api: [] });
  });

  it('proceeds when the queue-age alarm reads INSUFFICIENT_DATA before the run, and holds until it reads ALARM', async () => {
    const { run, stdout, stderr, secret } = world();
    const held = run.queueAgeAlarmState;
    // Before the fault the alarm has no data yet; with the fault in place it ages as the world says.
    run.queueAgeAlarmState = async () =>
      holdsOutageHost(secret.value) ? held() : 'INSUFFICIENT_DATA';

    expect(await dbOutageRun(run)).toBe(0);

    expect(stderr).toEqual([]);
    expect(stdout).toContain('chaos db-outage: database repointed, worker and api recycled');
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
