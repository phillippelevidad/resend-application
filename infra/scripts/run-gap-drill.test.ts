// Slice 4 D32, Ships 9: the gap drill's order over fake steps (unit, no AWS, no Resend, no real
// time). Each refusal changes nothing; every path past the lower restores the ingest route, unless
// the stack tripped meanwhile; a wrong count fails; no line holds the key, a URL or an address.
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
  depths: { queue: number; dlq: number };
  lastRunFinished: boolean | null;
  routeSetting: boolean;
  events: DrillEvent[];
  sendRejected: number | undefined;
  // What the real reconcile replays and the dry runs find, in order.
  dryMissing: number[];
  replayed: number;
  stored: boolean;
  createdAtShift: number;
};

const start = Date.parse('2026-10-21T13:05:00.000Z');

function newWorld(overrides: Partial<World> = {}): World {
  return {
    calls: [],
    now: start,
    apiUrl: `${LEDGER_URL}/`,
    tripped: false,
    trippedMidDrill: false,
    depths: { queue: 0, dlq: 0 },
    lastRunFinished: true,
    routeSetting: false,
    events: [{ id: 'msg_old', createdAt: new Date(start - 3_600_000) }],
    sendRejected: undefined,
    dryMissing: [2, 0],
    replayed: 2,
    stored: true,
    createdAtShift: 0,
    ...overrides,
  };
}

function stepsFor(world: World): GapDrillSteps {
  const call = (name: string) => world.calls.push(name);
  let dryRuns = 0;
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
    newestEvents: async () => [...world.events],
    async sendEmail() {
      call('sendEmail');
      if (world.sendRejected !== undefined) return { rejectedStatus: world.sendRejected };
      world.events.unshift(
        { id: 'msg_new_delivered', createdAt: new Date(world.now + 1_000) },
        { id: 'msg_new_sent', createdAt: new Date(world.now + 500) },
      );
      return { emailId: EMAIL_ID };
    },
    eventCreatedAt: async (eventId) =>
      new Date(
        (world.events.find((event) => event.id === eventId)?.createdAt.getTime() ?? 0) +
          world.createdAtShift,
      ),
    async lowerIngestRoute() {
      call('lower');
      world.routeSetting = true;
      if (world.trippedMidDrill) world.tripped = true;
    },
    async restoreIngestRoute() {
      call('restore');
      if (world.tripped) return 'left: tripped';
      world.routeSetting = false;
      return 'restored';
    },
    async ledger(args) {
      call(`ledger ${args.join(' ')}`);
      if (args[0] === 'reconcile' && args.includes('--dry-run')) {
        const missing = world.dryMissing[dryRuns] ?? 0;
        dryRuns += 1;
        return run(runJson(missing, 0));
      }
      if (args[0] === 'reconcile') return run(runJson(2, world.replayed));
      if (args[0] === 'email') {
        return run({
          event_count: world.stored ? 2 : 0,
          timeline: world.events
            .filter((event) => event.id.startsWith('msg_new'))
            .map((event) => ({
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
      'aws:gap-drill: sent one email\n',
      expect.stringMatching(/^aws:gap-drill: events visible after \d+ ms\n$/),
      expect.stringMatching(/^aws:gap-drill: waiting \d+ s for the grace window\n$/),
      'aws:gap-drill: ingest route restored\n',
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
