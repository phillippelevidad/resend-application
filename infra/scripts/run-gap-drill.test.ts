// Slice 4 D32, Ships 9: the gap drill's order over fake steps (unit, no AWS, no Resend, no real
// time). Each refusal changes nothing; every path past the lower restores the ingest route, unless
// the stack tripped meanwhile; a wrong count fails, other mail refused alongside the send does not;
// nothing is sent until the lowered route refuses five probes in a row; any of the send's events
// stored before the reconcile fails; no line holds the key, a URL or an address.
import { RECONCILE_GRACE_MS } from '@ledger/core';
import { describe, expect, it } from 'vitest';
import {
  type DrillEvent,
  type GapDrillSteps,
  type LedgerRun,
  runGapDrill,
} from './run-gap-drill.ts';

// A key of the `re_` form, below the gitleaks rule's 20 characters, and a fake deployment URL.
const RESEND_API_KEY = 're_fakeGapDrill11';
const LEDGER_URL = 'https://api.example.invalid';
const LEDGER_TOKEN = 'ldg_fake_token';
const WEBHOOK_ID = 'wh_fake_ledger';
const EMAIL_ID = 'fake-email-id';

const env = {
  LEDGER_URL,
  LEDGER_TOKEN,
  RESEND_API_KEY,
  LEDGER_DEPLOY_RESEND_WEBHOOK_ID: WEBHOOK_ID,
};

type World = {
  calls: string[];
  now: number;
  apiUrl: string | undefined;
  tripped: boolean;
  trippedMidDrill: boolean;
  // The lower applies the route setting, then its call fails (a lost response).
  lowerFails: boolean;
  depths: { queue: number; dlq: number };
  lastRunFinished: boolean | null;
  routeSetting: boolean;
  // Each is listed once the fake clock reaches its `createdAt`.
  events: DrillEvent[];
  sendRejected: number | undefined;
  // The send's `email.delivered`, this long after the send.
  deliveredAfterMs: number;
  // Other mail on the webhook while the route is lowered: one event per offset after the send.
  otherEventsAfterMs: { type: string; afterMs: number }[];
  // What the dry runs find, in order, the last one repeated; what the real reconcile finds and
  // replays; what `ledger email` counts for the send after the real reconcile, and how many of the
  // send's events it already held before it, `email.delivered` first (the throttle let a delivery
  // through, AWS-14, as measured 2026-10-20).
  dryMissing: number[];
  realMissing: number;
  replayed: number;
  storedCount: number;
  storedBefore: number;
  // What the ingest probes answer, in order, the last one repeated.
  probeStatuses: number[];
  createdAtShift: number;
  restoredAt: number | undefined;
};

const start = Date.parse('2026-10-21T13:05:00.000Z');

function newWorld(overrides: Partial<World> = {}): World {
  return {
    calls: [],
    now: start,
    apiUrl: `${LEDGER_URL}/`,
    tripped: false,
    trippedMidDrill: false,
    lowerFails: false,
    depths: { queue: 0, dlq: 0 },
    lastRunFinished: true,
    routeSetting: false,
    events: [{ id: 'msg_old', type: 'email.delivered', createdAt: new Date(start - 3_600_000) }],
    sendRejected: undefined,
    deliveredAfterMs: 1_000,
    otherEventsAfterMs: [],
    dryMissing: [2, 0],
    realMissing: 2,
    replayed: 2,
    storedCount: 2,
    storedBefore: 0,
    probeStatuses: [429],
    createdAtShift: 0,
    restoredAt: undefined,
    ...overrides,
  };
}

function stepsFor(world: World): GapDrillSteps {
  const call = (name: string) => world.calls.push(name);
  let dryRuns = 0;
  let probes = 0;
  let reconciled = false;
  const run = (json: unknown, code = 0): LedgerRun => ({ code, json });
  const runJson = (missing: number, replayed: number, failed = 0) => ({
    object: 'reconcile_run',
    missing,
    replayed,
    failed,
  });
  return {
    apiUrlOutput: async () => world.apiUrl,
    isTripped: async () => world.tripped,
    queueDepths: async () => world.depths,
    lastRunFinished: async () => world.lastRunFinished,
    ingestRouteSettingExists: async () => world.routeSetting,
    newestEvents: async () =>
      world.events
        .filter((event) => event.createdAt.getTime() <= world.now)
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()),
    async sendEmail() {
      call('sendEmail');
      if (world.sendRejected !== undefined) return { rejectedStatus: world.sendRejected };
      world.events.push(
        {
          id: 'msg_new_delivered',
          type: 'email.delivered',
          createdAt: new Date(world.now + world.deliveredAfterMs),
        },
        { id: 'msg_new_sent', type: 'email.sent', createdAt: new Date(world.now + 500) },
        ...world.otherEventsAfterMs.map(({ type, afterMs }, index) => ({
          id: `msg_other_${index}`,
          type,
          createdAt: new Date(world.now + afterMs),
        })),
      );
      return { emailId: EMAIL_ID };
    },
    async eventCreatedAt(eventId) {
      call(`retrieve ${eventId}`);
      return new Date(
        (world.events.find((event) => event.id === eventId)?.createdAt.getTime() ?? 0) +
          world.createdAtShift,
      );
    },
    async lowerIngestRoute() {
      call('lower');
      world.routeSetting = true;
      if (world.trippedMidDrill) world.tripped = true;
      if (world.lowerFails) throw new Error('the response was lost');
    },
    async probeIngest() {
      call('probe');
      const status = world.probeStatuses[Math.min(probes, world.probeStatuses.length - 1)] ?? 429;
      probes += 1;
      return status;
    },
    async restoreIngestRoute() {
      call('restore');
      if (world.tripped) return 'left: tripped';
      world.routeSetting = false;
      world.restoredAt = world.now;
      return 'restored';
    },
    async ledger(args) {
      call(`ledger ${args.join(' ')}`);
      if (args[0] === 'reconcile' && args.includes('--dry-run')) {
        const missing = world.dryMissing[Math.min(dryRuns, world.dryMissing.length - 1)] ?? 0;
        dryRuns += 1;
        return run(runJson(missing, 0));
      }
      if (args[0] === 'reconcile') {
        reconciled = true;
        return run(runJson(world.realMissing, world.replayed));
      }
      if (args[0] === 'email') {
        const own = world.events.filter((event) => event.id.startsWith('msg_new'));
        const held = reconciled ? own : own.slice(0, world.storedBefore);
        if (held.length === 0) return run({ error: { code: 'email_not_found' } }, 1);
        return run({
          event_count: reconciled ? world.storedCount : held.length,
          timeline: held.map((event) => ({
            svix_id: event.id,
            event_created_at: event.createdAt.toISOString(),
          })),
        });
      }
      return run({ object: 'list', data: [runJson(0, 0)] });
    },
    now: () => new Date(world.now),
    sleep: async (ms) => {
      world.now += ms;
    },
  };
}

async function drill(world: World, environment: Record<string, string> = env) {
  const lines: string[] = [];
  const code = await runGapDrill({
    env: environment,
    steps: () => stepsFor(world),
    sink: (_stream, text) => lines.push(text),
  });
  return { code, lines, last: lines.at(-1) ?? '' };
}

const changes = (world: World) =>
  world.calls.filter(
    (name) => name === 'lower' || name === 'sendEmail' || name.startsWith('ledger'),
  );

describe('runGapDrill', () => {
  it('produces one gap and recovers it, printing D32 lines in order and ending done', async () => {
    const world = newWorld();

    const run = await drill(world);

    expect(run.code).toBe(0);
    expect(run.lines).toEqual([
      'aws:gap-drill: lowering the ingest route throttle\n',
      'aws:gap-drill: ingest route refusing: 429 x5\n',
      'aws:gap-drill: sent one email\n',
      expect.stringMatching(/^aws:gap-drill: events visible after \d+ ms\n$/),
      expect.stringMatching(/^aws:gap-drill: waiting \d+ s for the grace window\n$/),
      'aws:gap-drill: ingest route restored\n',
      'aws:gap-drill: stored before the reconcile: 0\n',
      'aws:gap-drill: dry run: missing 2\n',
      'aws:gap-drill: reconcile: missing 2 replayed 2 failed 0\n',
      'aws:gap-drill: stored 2 of 2\n',
      'aws:gap-drill: dry run: missing 0\n',
      'aws:gap-drill: gaps: newest run missing 0\n',
      'aws:gap-drill: created_at unchanged by the replay: yes\n',
      'aws:gap-drill: done\n',
    ]);
    expect(world.routeSetting).toBe(false);
    // The restore precedes every reconcile.
    expect(world.calls.indexOf('restore')).toBeLessThan(
      world.calls.indexOf('ledger reconcile --dry-run --json'),
    );
  });

  it.each([
    ['LEDGER_URL is unset', newWorld(), { ...env, LEDGER_URL: '' }],
    ['RESEND_API_KEY is unset', newWorld(), { ...env, RESEND_API_KEY: '' }],
    [
      'LEDGER_DEPLOY_RESEND_WEBHOOK_ID is unset',
      newWorld(),
      { ...env, LEDGER_DEPLOY_RESEND_WEBHOOK_ID: '' },
    ],
    [
      "LEDGER_URL is not LedgerApp's ApiUrl output",
      newWorld({ apiUrl: 'https://other.invalid' }),
      env,
    ],
    ['the stack is tripped', newWorld({ tripped: true }), env],
    ['the queue or the DLQ holds a message', newWorld({ depths: { queue: 0, dlq: 1 } }), env],
    ['the last reconcile run is unfinished', newWorld({ lastRunFinished: false }), env],
    [
      'the hourly reconcile at :00 would overlap',
      newWorld({ now: Date.parse('2026-10-21T13:45:00.000Z') }),
      env,
    ],
    [
      'the hourly reconcile at :00 would overlap',
      newWorld({ now: Date.parse('2026-10-21T13:01:00.000Z') }),
      env,
    ],
    ['an ingest route setting exists', newWorld({ routeSetting: true }), env],
  ])('refuses when %s, changing nothing', async (reason, world, environment) => {
    const run = await drill(world, environment);

    expect(run.code).toBe(1);
    expect(run.last).toMatch(
      new RegExp(`^aws:gap-drill: refused: .*${reason.split(' ').slice(0, 3).join(' ')}`),
    );
    expect(changes(world)).toEqual([]);
    expect(world.calls).not.toContain('restore');
  });

  it('restores the ingest route when a step fails after the lower', async () => {
    const world = newWorld({ sendRejected: 403 });

    const run = await drill(world);

    expect(run.code).toBe(1);
    expect(run.last).toBe('aws:gap-drill: failed: resend_auth_failed: the send was refused\n');
    expect(world.calls).toContain('restore');
    expect(world.routeSetting).toBe(false);
  });

  it('restores the ingest route when the lower applied and then failed, and sends nothing', async () => {
    const world = newWorld({ lowerFails: true });

    const run = await drill(world);

    expect(run.code).toBe(1);
    expect(run.lines).toContain('aws:gap-drill: ingest route restored\n');
    expect(run.last).toBe('aws:gap-drill: failed: lowering the ingest route throttle failed\n');
    expect(world.routeSetting).toBe(false);
    expect(world.calls).not.toContain('sendEmail');
  });

  it('leaves the ingest route setting when the stack tripped mid-drill, and fails', async () => {
    const world = newWorld({ trippedMidDrill: true });

    const run = await drill(world);

    expect(run.code).toBe(1);
    expect(run.last).toMatch(/^aws:gap-drill: failed: the stack tripped during the drill/);
    expect(world.routeSetting).toBe(true);
    expect(world.calls.filter((name) => name.startsWith('ledger'))).toEqual([]);
  });

  it('fails on a count mismatch, after restoring the ingest route', async () => {
    const world = newWorld({ dryMissing: [1, 0] });

    const run = await drill(world);

    expect(run.code).toBe(1);
    expect(run.last).toBe('aws:gap-drill: failed: the dry run did not find 2 missing\n');
    expect(world.routeSetting).toBe(false);
  });

  it('fails when the final dry run still finds events missing', async () => {
    const run = await drill(newWorld({ dryMissing: [2, 1] }));

    expect(run.last).toBe('aws:gap-drill: failed: the final dry run still found missing events\n');
  });

  // Other mail on the owner's webhook while the route is lowered is refused too: the runs count it,
  // `ledger email` counts only the send's own events.
  const otherMail = (): Partial<World> => ({
    otherEventsAfterMs: [{ type: 'email.delivered', afterMs: 200 }],
    dryMissing: [3, 0],
    realMissing: 3,
    replayed: 3,
  });

  it('recovers when other mail was refused during the drill, ending done', async () => {
    const world = newWorld(otherMail());

    const run = await drill(world);

    expect(run.code).toBe(0);
    expect(run.lines).toEqual(
      expect.arrayContaining([
        'aws:gap-drill: dry run: missing 3\n',
        'aws:gap-drill: reconcile: missing 3 replayed 3 failed 0\n',
        'aws:gap-drill: stored 2 of 2\n',
        'aws:gap-drill: dry run: missing 0\n',
        'aws:gap-drill: created_at unchanged by the replay: yes\n',
      ]),
    );
    expect(run.last).toBe('aws:gap-drill: done\n');
    expect(world.routeSetting).toBe(false);
  });

  // The throttle is best-effort (AWS-14): a send that was never missing proves no recovery, however
  // the run counts read.
  it.each([1, 2])(
    "fails when %i of the send's events were stored before the reconcile, after restoring",
    async (storedBefore) => {
      const world = newWorld({ ...otherMail(), storedBefore });

      const run = await drill(world);

      expect(run.code).toBe(1);
      expect(run.last).toBe(
        "aws:gap-drill: failed: the send's events were stored before the reconcile\n",
      );
      expect(run.lines).toContain('aws:gap-drill: ingest route restored\n');
      expect(world.routeSetting).toBe(false);
      expect(world.calls.filter((name) => name.startsWith('ledger reconcile'))).toEqual([]);
    },
  );

  // Measured 2026-10-20: a delivery ≈ 3 s after the lower was accepted (AWS-14, AWS-U16), so the
  // send waits until the route refuses five probes in a row.
  it('sends only after the ingest route refuses five probes in a row', async () => {
    const world = newWorld({ probeStatuses: [401, 401, 429, 429, 429, 429, 429] });

    const run = await drill(world);

    expect(run.code).toBe(0);
    expect(run.lines).toContain('aws:gap-drill: ingest route refusing: 429 x5\n');
    const probes = world.calls.slice(0, world.calls.indexOf('sendEmail'));
    expect(probes.filter((name) => name === 'probe')).toHaveLength(7);
  });

  it('restarts the count when a probe gets through between refusals', async () => {
    const world = newWorld({ probeStatuses: [429, 429, 429, 429, 401, 429, 429, 429, 429, 429] });

    const run = await drill(world);

    expect(run.code).toBe(0);
    expect(world.calls.filter((name) => name === 'probe')).toHaveLength(10);
  });

  it('fails without sending and restores when the ingest route never refuses within 60 s', async () => {
    const world = newWorld({ probeStatuses: [401] });

    const run = await drill(world);

    expect(run.code).toBe(1);
    expect(run.last).toBe('aws:gap-drill: failed: the ingest route never refused\n');
    expect(world.calls).not.toContain('sendEmail');
    expect(world.calls).toContain('restore');
    expect(world.routeSetting).toBe(false);
    expect(world.now - start).toBeLessThanOrEqual(60_000);
  });

  it('fails when ledger email answers another error before the reconcile', async () => {
    const world = newWorld();
    const steps = stepsFor(world);
    const ledger = steps.ledger;
    steps.ledger = async (args) =>
      args[0] === 'email'
        ? { code: 1, json: { error: { code: 'api_unavailable' } } }
        : ledger(args);

    const lines: string[] = [];
    const code = await runGapDrill({
      env,
      steps: () => steps,
      sink: (_stream, text) => lines.push(text),
    });

    expect(code).toBe(1);
    expect(lines.at(-1)).toBe('aws:gap-drill: failed: ledger email failed\n');
    expect(world.calls.filter((name) => name.startsWith('ledger reconcile'))).toEqual([]);
  });

  it("fails when the send's own events are not stored, though other mail fills the counts", async () => {
    const world = newWorld({ ...otherMail(), storedCount: 1 });

    const run = await drill(world);

    expect(run.code).toBe(1);
    expect(run.last).toBe('aws:gap-drill: failed: the replayed events were never stored\n');
    expect(world.routeSetting).toBe(false);
  });

  it('fails when the reconcile replays fewer than it found missing', async () => {
    const run = await drill(newWorld({ ...otherMail(), replayed: 2 }));

    expect(run.last).toBe(
      'aws:gap-drill: failed: the reconcile did not replay every missing event\n',
    );
  });

  // The regression: two new ids, the send's `email.sent` and another email's, ended the wait before
  // the send's `email.delivered` was listed, so the route came back while it was inside the grace
  // window and the reconcile after the restore could not count it.
  it("waits for the send's email.delivered when another email's event is listed first", async () => {
    const deliveredAfterMs = 40_000;
    const world = newWorld({
      ...otherMail(),
      otherEventsAfterMs: [{ type: 'email.sent', afterMs: 200 }],
      deliveredAfterMs,
    });

    const run = await drill(world);

    expect(run.code).toBe(0);
    expect(world.restoredAt).toBeGreaterThan(start + deliveredAfterMs + RECONCILE_GRACE_MS);
  });

  it("repeats the final dry run while other mail's replays are still being stored", async () => {
    const world = newWorld({ ...otherMail(), dryMissing: [3, 1, 0] });

    const run = await drill(world);

    expect(run.code).toBe(0);
    expect(run.lines).not.toContain('aws:gap-drill: dry run: missing 1\n');
    expect(run.lines).toContain('aws:gap-drill: dry run: missing 0\n');
  });

  it('reports created_at changed when Resend returns another one', async () => {
    const run = await drill(newWorld({ createdAtShift: 5 }));

    expect(run.lines).toContain('aws:gap-drill: created_at unchanged by the replay: no\n');
  });

  it('prints no key, URL, token, webhook id, email id or address on any path', async () => {
    const runs = [
      await drill(newWorld()),
      await drill(newWorld({ sendRejected: 401 })),
      await drill(newWorld({ apiUrl: 'https://other.invalid' })),
      await drill(newWorld({ trippedMidDrill: true })),
      await drill(newWorld({ dryMissing: [1, 0] })),
      await drill(newWorld(otherMail())),
      await drill(newWorld({ probeStatuses: [401] })),
    ];
    for (const run of runs) {
      for (const line of run.lines) {
        expect(line).toMatch(/^aws:gap-drill: /);
        for (const value of [RESEND_API_KEY, LEDGER_URL, LEDGER_TOKEN, WEBHOOK_ID, EMAIL_ID]) {
          expect(line).not.toContain(value);
        }
        expect(line).not.toMatch(/@|https?:\/\//);
      }
    }
  });
});
