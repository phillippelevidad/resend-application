import type { Env } from '@ledger/shared';
import { createScriptOutput, type ScriptOutput, type ScriptSink } from './script-output.ts';

// `pnpm aws:gap-drill` (slice 4 D32, Ships 9): one real gap on the owner's deployment, then its
// recovery. The order and every refusal live here over injected steps, so they are unit-tested with
// fakes (run-gap-drill.test.ts); gap-drill.ts composes the real ones. No line holds an id, a key, a
// URL or an address. It is the owner's Ask-first run (root AGENTS.md → Permissions): it makes one
// send, and its reconcile replays through Resend.

// A List Events item as the drill reads it.
export type DrillEvent = { readonly id: string; readonly createdAt: Date };

// One `ledger` CLI run as a child process: its exit code and its stdout, parsed as JSON.
export type LedgerRun = { readonly code: number; readonly json: unknown };

export type GapDrillSteps = {
  // Preflight reads, none of which changes anything.
  apiUrlOutput(): Promise<string | undefined>;
  isTripped(): Promise<boolean>;
  queueDepths(): Promise<{ queue: number; dlq: number }>;
  // `health.get`'s last run, through `@ledger/sdk`: `null` before the first one.
  lastRunFinished(): Promise<boolean | null>;
  ingestRouteSettingExists(): Promise<boolean>;
  // The drill's own `resend-client` (`ledger-gap-drill`, RS-21).
  newestEvents(): Promise<readonly DrillEvent[]>;
  sendEmail(idempotencyKey: string): Promise<{ emailId: string } | { rejectedStatus: number }>;
  eventCreatedAt(eventId: string): Promise<Date>;
  // D31's two steps.
  lowerIngestRoute(): Promise<void>;
  restoreIngestRoute(): Promise<'restored' | 'left: tripped'>;
  ledger(args: readonly string[]): Promise<LedgerRun>;
  now(): Date;
  sleep(ms: number): Promise<void>;
};

export type RunGapDrillOptions = {
  env: Env;
  steps: (config: GapDrillConfig) => GapDrillSteps;
  sink: ScriptSink;
};

export type GapDrillConfig = {
  ledgerUrl: string;
  ledgerToken: string;
  resendApiKey: string;
  webhookId: string;
};

const SCRIPT = 'aws:gap-drill';

// RS-39: a send to `delivered@resend.dev` produces two events, `email.sent` then `email.delivered`.
const EXPECTED_EVENTS = 2;
// The UTC minutes the drill may start in: clear of the hourly reconcile at :00, with time to finish.
const FIRST_MINUTE = 2;
const LAST_MINUTE = 40;
const POLL_INTERVAL_MS = 2_000;
const POLL_BOUND_MS = 120_000;
// ADR-007's grace window plus a margin, so the reconcile counts the send's events.
const GRACE_WAIT_MS = 600_000 + 30_000;

class DrillStopped extends Error {
  readonly kind: 'refused' | 'failed';
  readonly reason: string;

  constructor(kind: 'refused' | 'failed', reason: string) {
    super(reason);
    this.name = 'DrillStopped';
    this.kind = kind;
    this.reason = reason;
  }
}

const refuse = (reason: string) => new DrillStopped('refused', reason);
const fail = (reason: string) => new DrillStopped('failed', reason);

// Any other error becomes `failed: <failure>`, so no SDK or CLI text reaches the output.
async function step<T>(failure: string, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof DrillStopped) throw error;
    throw fail(failure);
  }
}

const required = (env: Env, name: string): string => {
  const value = env[name];
  if (value === undefined || value.trim() === '') {
    throw refuse(`${name} is unset`);
  }
  return value.trim();
};

const trimSlash = (url: string): string => url.replace(/\/+$/, '');

const field = (json: unknown, key: string): unknown =>
  typeof json === 'object' && json !== null ? (json as Record<string, unknown>)[key] : undefined;

const num = (json: unknown, key: string): number | undefined => {
  const value = field(json, key);
  return typeof value === 'number' ? value : undefined;
};

export async function runGapDrill({
  env,
  steps: makeSteps,
  sink,
}: RunGapDrillOptions): Promise<0 | 1> {
  const out = createScriptOutput(SCRIPT, sink);
  try {
    const config: GapDrillConfig = {
      ledgerUrl: required(env, 'LEDGER_URL'),
      ledgerToken: required(env, 'LEDGER_TOKEN'),
      resendApiKey: required(env, 'RESEND_API_KEY'),
      webhookId: required(env, 'LEDGER_DEPLOY_RESEND_WEBHOOK_ID'),
    };
    await drill(config, makeSteps(config), out);
    return out.done();
  } catch (error) {
    if (error instanceof DrillStopped) {
      return error.kind === 'refused' ? out.refused(error.reason) : out.failed(error.reason);
    }
    return out.failed('unexpected error');
  }
}

async function drill(
  config: GapDrillConfig,
  steps: GapDrillSteps,
  out: ScriptOutput,
): Promise<void> {
  // Refusals, before any change.
  const apiUrl = await step("reading LedgerApp's ApiUrl output failed", () => steps.apiUrlOutput());
  if (apiUrl === undefined || trimSlash(apiUrl) !== trimSlash(config.ledgerUrl)) {
    throw refuse("LEDGER_URL is not LedgerApp's ApiUrl output");
  }
  if (await step('reading the kill switch state failed', () => steps.isTripped())) {
    throw refuse('the stack is tripped: run pnpm aws:rearm');
  }
  const depths = await step('reading the queue depths failed', () => steps.queueDepths());
  if (depths.queue > 0 || depths.dlq > 0) {
    throw refuse('the queue or the DLQ holds a message; let it drain or redrive it first');
  }
  if ((await step('reading ledger health failed', () => steps.lastRunFinished())) === false) {
    throw refuse('the last reconcile run is unfinished; wait for it (pnpm -s ledger gaps)');
  }
  const minute = steps.now().getUTCMinutes();
  if (minute < FIRST_MINUTE || minute > LAST_MINUTE) {
    throw refuse(
      `the hourly reconcile at :00 would overlap the drill; start between :0${FIRST_MINUTE} and :${LAST_MINUTE} UTC`,
    );
  }
  if (
    await step('reading the ingest route setting failed', () => steps.ingestRouteSettingExists())
  ) {
    throw refuse('an ingest route setting exists: run pnpm aws:rearm');
  }

  // 1. What Resend held before the send.
  const before = new Set(
    (await step('List Events failed', () => steps.newestEvents())).map((event) => event.id),
  );

  // 2–6. The gap: the ingest route stopped, one send, its events visible at Resend, the grace
  // window passed, then the route restored before Resend's next retry (≈ 35 min, RS-09).
  out.line('lowering the ingest route throttle');
  await step('lowering the ingest route throttle failed', () => steps.lowerIngestRoute());
  let restored = false;
  let emailId: string;
  let newEvents: readonly DrillEvent[];
  try {
    const key = `ledger-gap-drill-${steps.now().toISOString().replace(/[-:.]/g, '')}`;
    const sent = await step('the send failed', () => steps.sendEmail(key));
    if ('rejectedStatus' in sent) {
      throw fail(
        sent.rejectedStatus === 409
          ? 'internal_error: the send was refused as an idempotency conflict'
          : 'resend_auth_failed: the send was refused',
      );
    }
    emailId = sent.emailId;
    out.line('sent one email');

    let seen: readonly DrillEvent[] = [];
    for (let waited = 0; seen.length < EXPECTED_EVENTS; waited += POLL_INTERVAL_MS) {
      if (waited >= POLL_BOUND_MS) throw fail("the send's events never appeared in List Events");
      await steps.sleep(POLL_INTERVAL_MS);
      const page = await step('List Events failed', () => steps.newestEvents());
      seen = page.filter((event) => !before.has(event.id));
    }
    newEvents = seen;
    const newest = Math.max(...newEvents.map((event) => event.createdAt.getTime()));
    out.line(`events visible after ${Math.max(0, steps.now().getTime() - newest)} ms`);

    const waitMs = newest + GRACE_WAIT_MS - steps.now().getTime();
    if (waitMs > 0) {
      out.line(`waiting ${Math.ceil(waitMs / 1000)} s for the grace window`);
      await steps.sleep(waitMs);
    }

    const restore = await step('restoring the ingest route failed', () =>
      steps.restoreIngestRoute(),
    );
    restored = true;
    if (restore === 'left: tripped') {
      throw fail(
        'the stack tripped during the drill; the ingest route setting is left for pnpm aws:rearm',
      );
    }
    out.line('ingest route restored');
  } finally {
    if (!restored) {
      const restore = await steps.restoreIngestRoute().catch(() => undefined);
      out.line(
        restore === 'restored'
          ? 'ingest route restored'
          : 'ingest route left as it is: run pnpm aws:rearm',
      );
    }
  }

  // 7. The recovery, through the CLI as the operator runs it.
  const expected = newEvents.length;
  const dry = await step('ledger reconcile --dry-run failed', () =>
    steps.ledger(['reconcile', '--dry-run', '--json']),
  );
  const dryMissing = num(dry.json, 'missing');
  out.line(`dry run: missing ${dryMissing ?? '?'}`);
  if (dry.code !== 0 || dryMissing !== expected)
    throw fail(`the dry run did not find ${expected} missing`);

  const real = await step('ledger reconcile failed', () => steps.ledger(['reconcile', '--json']));
  const [missing, replayed, failed] = ['missing', 'replayed', 'failed'].map((key) =>
    num(real.json, key),
  );
  out.line(
    `reconcile: missing ${missing ?? '?'} replayed ${replayed ?? '?'} failed ${failed ?? '?'}`,
  );
  if (real.code !== 0 || missing !== expected || replayed !== expected || failed !== 0) {
    throw fail('the reconcile did not replay every missing event');
  }

  let stored = 0;
  let timeline: unknown;
  for (let waited = 0; stored < expected; waited += POLL_INTERVAL_MS) {
    if (waited >= POLL_BOUND_MS) throw fail('the replayed events were never stored');
    await steps.sleep(POLL_INTERVAL_MS);
    const email = await steps.ledger(['email', emailId, '--json']);
    stored = email.code === 0 ? (num(email.json, 'event_count') ?? 0) : 0;
    timeline = field(email.json, 'timeline');
  }
  out.line(`stored ${stored} of ${expected}`);

  const after = await step('the final ledger reconcile --dry-run failed', () =>
    steps.ledger(['reconcile', '--dry-run', '--json']),
  );
  const afterMissing = num(after.json, 'missing');
  out.line(`dry run: missing ${afterMissing ?? '?'}`);
  if (after.code !== 0 || afterMissing !== 0)
    throw fail('the final dry run still found missing events');

  const gaps = await step('ledger gaps failed', () =>
    steps.ledger(['gaps', '--since', '1h', '--json']),
  );
  const runs = field(gaps.json, 'data');
  const newestMissing = Array.isArray(runs) ? num(runs[0], 'missing') : undefined;
  out.line(`gaps: newest run missing ${newestMissing ?? '?'}`);
  if (gaps.code !== 0 || newestMissing !== 0) throw fail('ledger gaps does not show 0 missing');

  // 8. RS-U10: whether a replay keeps the event's created_at.
  const items = Array.isArray(timeline) ? timeline : [];
  let unchanged = items.length === expected;
  for (const item of items) {
    const svixId = field(item, 'svix_id');
    const storedAt = field(item, 'event_created_at');
    if (typeof svixId !== 'string' || typeof storedAt !== 'string') {
      unchanged = false;
      continue;
    }
    const atResend = await step('Retrieve Event failed', () => steps.eventCreatedAt(svixId));
    if (atResend.getTime() !== new Date(storedAt).getTime()) unchanged = false;
  }
  out.line(`created_at unchanged by the replay: ${unchanged ? 'yes' : 'no'}`);
}
