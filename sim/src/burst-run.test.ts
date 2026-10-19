import type { DeclaredThrottle, ThrottleRestore } from '@ledger/aws';
import { describe, expect, it } from 'vitest';
import type { AwsRunTarget } from './aws-run-guard.ts';
import { BURST_MIN_ACCOUNT_CONCURRENCY, type BurstRunDeps, burstRun } from './burst-run.ts';
import type { PacedRequest } from './paced-sender.ts';

// D25 over injected fakes: the order of the steps and lines, each preflight's refusal, the
// conditional restore in `finally` (also when the send fails), and lines that never carry a URL or
// secret. The fake stage keeps one throttle value, so each test asserts what the stage ends at.

// Placeholders shaped like the outputs; a test fails if any of them reaches an output line.
const target: AwsRunTarget = {
  app: {
    ApiUrl: 'https://api.example.test/',
    QueueUrl: 'https://sqs.example.test/queue',
    DlqUrl: 'https://sqs.example.test/dlq',
    SimulatorSecretArn: 'simulator-secret-placeholder',
    ThrottleRateLimit: '100',
    ThrottleBurstLimit: '200',
  },
  guardrails: { KillSwitchArmed: 'true' },
  dlqUrl: 'https://sqs.example.test/dlq',
  queueUrl: 'https://sqs.example.test/queue',
};

type Harness = {
  deps: BurstRunDeps;
  steps: string[];
  outLines: string[];
  errLines: string[];
  stage: DeclaredThrottle;
  sent: PacedRequest[];
};

type Overrides = Partial<BurstRunDeps> & {
  // Runs while the requests are "in flight", e.g. a trip changing the stage.
  duringSend?: (stage: DeclaredThrottle) => void;
  rejectSvixIds?: ReadonlySet<string>;
};

function harness(overrides: Overrides = {}): Harness {
  const steps: string[] = [];
  const outLines: string[] = [];
  const errLines: string[] = [];
  const stage: DeclaredThrottle = { rateLimit: 100, burstLimit: 200 };
  const sent: PacedRequest[] = [];
  let storage = 50_000_000;
  const { duringSend, rejectSvixIds = new Set<string>(), ...depOverrides } = overrides;
  const deps: BurstRunDeps = {
    guard: async () => {
      steps.push('guard');
      return { status: 'clear', target };
    },
    readConcurrencyQuota: async () => {
      steps.push('quota');
      return 1000;
    },
    readUsageTrip: async () => {
      steps.push('usage');
      return { recent: 120, threshold: 15_000, periodSeconds: 900 };
    },
    raiseThrottle: async () => {
      steps.push('raise');
      stage.rateLimit = 1200;
      stage.burstLimit = 2400;
      return { rateLimit: 1200, burstLimit: 2400 };
    },
    restoreThrottle: async (raised, declared): Promise<ThrottleRestore> => {
      steps.push('restore');
      if (stage.rateLimit !== raised.rateLimit || stage.burstLimit !== raised.burstLimit) {
        return { status: 'left', throttle: { ...stage } };
      }
      stage.rateLimit = declared.rateLimit;
      stage.burstLimit = declared.burstLimit;
      return { status: 'restored', throttle: { ...declared } };
    },
    storageBytes: async () => {
      steps.push('storage');
      const bytes = storage;
      storage += 20_000_000;
      return bytes;
    },
    send: async (requests) => {
      steps.push('send');
      sent.push(...requests);
      duringSend?.(stage);
      const acceptedIds = requests
        .map(({ svixId }) => svixId)
        .filter((svixId) => !rejectSvixIds.has(svixId));
      return {
        requests: requests.length,
        accepted: acceptedIds.length,
        acceptedIds,
        durationMs: 10_400,
        p50Ms: 61,
        p99Ms: 412,
      };
    },
    settle: async (ids, generatedEvents) => {
      steps.push(`settle ${ids.length}/${generatedEvents}`);
      return {
        expected: ids.length,
        present: ids.length,
        settled: true,
        bound: { boundMs: 30_000 + 100 * generatedEvents, intervalMs: 250 },
        elapsedMs: 4_200,
      };
    },
    invariant1: async (history) => {
      steps.push('invariant 1');
      const count = history.emails.flatMap(({ events }) => events).length;
      return { pass: true, line: `invariant 1 pass stored=${count}/${count}` };
    },
    invariant2: async (history) => {
      steps.push('invariant 2');
      return { pass: true, line: `invariant 2 pass emails=${history.emails.length} recipients=1` };
    },
    invariant4: async (_target, poisoned) => {
      steps.push(`invariant 4 poisoned=${poisoned.size}`);
      return { pass: true, line: 'invariant 4 pass (dlq holds exactly the 0 poisoned)' };
    },
    out: (line) => outLines.push(line),
    err: (line) => errLines.push(line),
    ...depOverrides,
  };
  return { deps, steps, outLines, errLines, stage, sent };
}

const input = {
  seed: 7,
  namespace: 'burst-test',
  burst: { events: 40, seconds: 4 },
  shuffle: false,
};

describe('the burst run (D25)', () => {
  it("runs D25's steps in order and prints Surfaces' burst lines in order", async () => {
    const h = harness();

    const exit = await burstRun(input, h.deps);

    expect(exit).toBe(0);
    expect(h.steps).toEqual([
      'guard',
      'quota',
      'usage',
      'raise',
      'storage',
      'send',
      'restore',
      'settle 40/40',
      'storage',
      'invariant 1',
      'invariant 2',
      'invariant 4 poisoned=0',
    ]);
    expect(h.outLines[0]).toMatch(/^history emails=\d+ events=40 duplicates=0 shuffled=false$/);
    expect(h.outLines.slice(1)).toEqual([
      'projection not printed (--burst)',
      'preflight concurrency=1000 recent_requests=120 usage_trip_threshold=15000',
      'throttle raised rate=1200 burst=2400',
      'sent requests=40 accepted=40 duration_s=10.4 p50_ms=61 p99_ms=412',
      'throttle restored rate=100 burst=200',
      'settled stored=40/40 after 4s',
      'storage before=50000000 after=70000000 bytes_per_event=500000 bursts_left=46',
      'invariant 1 pass stored=40/40',
      expect.stringMatching(/^invariant 2 pass /),
      'invariant 3 not checked (slice 6)',
      'invariant 4 pass (dlq holds exactly the 0 poisoned)',
    ]);
    expect(h.errLines).toEqual([]);
    expect(h.stage).toEqual({ rateLimit: 100, burstLimit: 200 });
    // Exactly the burst's events, each once, signed bodies of distinct svix_ids.
    expect(h.sent).toHaveLength(40);
    expect(new Set(h.sent.map(({ svixId }) => svixId)).size).toBe(40);
  });

  it('a guard refusal prints its line, raises nothing and sends nothing', async () => {
    const h = harness({
      guard: async () => ({
        status: 'refused',
        line: 'sim: the stack is tripped; run pnpm aws:rearm first',
      }),
    });

    const exit = await burstRun(input, h.deps);

    expect(exit).toBe(1);
    expect(h.errLines).toEqual(['sim: the stack is tripped; run pnpm aws:rearm first']);
    expect(h.steps).toEqual([]);
    expect(h.sent).toEqual([]);
    expect(h.stage).toEqual({ rateLimit: 100, burstLimit: 200 });
  });

  it(`refuses a concurrency quota below ${BURST_MIN_ACCOUNT_CONCURRENCY}, raising and sending nothing`, async () => {
    const h = harness({ readConcurrencyQuota: async () => 50 });

    const exit = await burstRun(input, h.deps);

    expect(exit).toBe(1);
    expect(h.errLines).toEqual([
      "sim: the account's Lambda concurrency quota is 50; the burst needs at least 1000 (AWS-U05): request an increase in Service Quotas",
    ]);
    expect(h.steps).toEqual(['guard']);
    expect(h.sent).toEqual([]);
    expect(h.stage).toEqual({ rateLimit: 100, burstLimit: 200 });
  });

  it('refuses a burst that would trip the usage alarm, raising and sending nothing', async () => {
    const h = harness({
      readUsageTrip: async () => ({ recent: 6000, threshold: 15_000, periodSeconds: 900 }),
    });

    const exit = await burstRun({ ...input, burst: { events: 10_000, seconds: 10 } }, h.deps);

    expect(exit).toBe(1);
    expect(h.errLines).toEqual([
      'sim: 6000 requests in the last 15 minutes plus the burst would trip LedgerApp-usage-trip; wait and retry',
    ]);
    expect(h.steps).toEqual(['guard', 'quota']);
    expect(h.sent).toEqual([]);
  });

  it('a send that fails still restores the throttle in finally, and the error propagates', async () => {
    const h = harness({
      send: async () => {
        throw new Error('socket exhausted');
      },
    });

    await expect(burstRun(input, h.deps)).rejects.toThrow('socket exhausted');

    expect(h.stage).toEqual({ rateLimit: 100, burstLimit: 200 });
    expect(h.outLines).toContain('throttle restored rate=100 burst=200');
    expect(h.steps).not.toContain('settle 40/40');
  });

  it('leaves a throttle a trip changed during the burst, sending no update', async () => {
    const h = harness({
      duringSend: (stage) => {
        stage.rateLimit = 0;
        stage.burstLimit = 0;
      },
    });

    await burstRun(input, h.deps);

    expect(h.stage).toEqual({ rateLimit: 0, burstLimit: 0 });
    expect(h.outLines).toContain('throttle left at 0/0: changed during the burst (a trip?)');
  });

  it('exits 1 when the restore itself fails, naming the re-arm', async () => {
    const h = harness({
      restoreThrottle: async () => {
        throw new Error('throttled');
      },
    });

    const exit = await burstRun(input, h.deps);

    expect(exit).toBe(1);
    expect(h.errLines).toEqual([
      'sim: the throttle was not restored; run pnpm aws:rearm, which restores it',
    ]);
  });

  it('restores a raise that took effect before its call failed, then propagates the error', async () => {
    const stageRef: { current?: DeclaredThrottle } = {};
    const h = harness({
      raiseThrottle: async () => {
        // The update applied, then the call timed out.
        if (stageRef.current !== undefined) {
          stageRef.current.rateLimit = 1200;
          stageRef.current.burstLimit = 2400;
        }
        throw new Error('socket timeout');
      },
    });
    stageRef.current = h.stage;

    await expect(burstRun(input, h.deps)).rejects.toThrow('socket timeout');

    expect(h.stage).toEqual({ rateLimit: 100, burstLimit: 200 });
    expect(h.outLines).toContain('throttle restored rate=100 burst=200');
    expect(h.steps).not.toContain('send');
  });

  it('a raise that failed before taking effect sends no update and says nothing about the throttle', async () => {
    const h = harness({
      raiseThrottle: async () => {
        throw new Error('access denied');
      },
    });

    await expect(burstRun(input, h.deps)).rejects.toThrow('access denied');

    expect(h.stage).toEqual({ rateLimit: 100, burstLimit: 200 });
    expect(h.outLines.filter((line) => line.startsWith('throttle'))).toEqual([]);
    expect(h.errLines).toEqual([]);
  });

  it('names the re-arm when the restore after a failed raise fails too', async () => {
    const h = harness({
      raiseThrottle: async () => {
        throw new Error('socket timeout');
      },
      restoreThrottle: async () => {
        throw new Error('throttled');
      },
    });

    await expect(burstRun(input, h.deps)).rejects.toThrow('socket timeout');

    expect(h.errLines).toEqual([
      'sim: the throttle was not restored; run pnpm aws:rearm, which restores it',
    ]);
  });

  it('a request not accepted fails the run after reporting, settling over the accepted ones', async () => {
    const h = harness({ rejectSvixIds: new Set(['burst-test-svix-burst-0-0']) });

    const exit = await burstRun(input, h.deps);

    expect(exit).toBe(1);
    expect(h.outLines).toContain(
      'sent requests=40 accepted=39 duration_s=10.4 p50_ms=61 p99_ms=412',
    );
    expect(h.steps).toContain('settle 39/40');
    expect(h.outLines).toContain('throttle restored rate=100 burst=200');
  });

  it('fails the run on a failing invariant 4', async () => {
    const h = harness({
      invariant4: async () => ({
        pass: false,
        line: 'invariant 4 fail depth=1 poisoned=0 collected=1 stray=burst-test-svix-burst-3-1',
      }),
    });

    expect(await burstRun(input, h.deps)).toBe(1);
  });

  it('no output line holds a URL, an output value, the secret or an address', async () => {
    const h = harness({ rejectSvixIds: new Set(['burst-test-svix-burst-1-0']) });

    await burstRun(input, h.deps);

    const lines = [...h.outLines, ...h.errLines];
    expect(lines.length).toBeGreaterThan(5);
    for (const line of lines) {
      expect(line).not.toMatch(/https?:|example\.test|placeholder|whsec_|@|resend\.dev/);
    }
  });
});
