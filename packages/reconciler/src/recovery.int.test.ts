// Slice 4 D43, ADR-007, Ships 2 and 3: the recovery suite. It composes the real reconciler, the real
// `resend-client` against the fake Resend API, and real ingest and the real worker over the
// in-process queue on real Postgres, as the runtime role. A replay calls `onReplay`, which signs the
// held event under its List Events id (the original `svix-id`, RS-44) with a fresh timestamp and
// sends it through ingest, as Resend's replay would. The fake API holds events and never decides
// what is missing. The reconciler's clock starts at wall-clock time, because `started_at` and the
// overlap check read Postgres's `now()` (D43). Each test gets its own clone, so no anchor leaks.
import {
  RECONCILE_DEFAULT_LOOKBACK_MS,
  RECONCILE_RUN_BUDGET_MS,
  reconcileHorizon,
} from '@ledger/core';
import { signWebhook } from '@ledger/core/testing';
import {
  emailStateRepository,
  reconcileRunsRepository,
  STORAGE_LIMIT_BYTES,
  webhookEventsRepository,
} from '@ledger/db';
import { createTestDatabase, type TestDatabase } from '@ledger/db/testing';
import { createIngest } from '@ledger/ingest';
import { createResendClient } from '@ledger/resend-client';
import {
  type FakeResendApi,
  type FakeWebhookEvent,
  startFakeResendApi,
} from '@ledger/resend-client/testing';
import {
  type ClockPort,
  InProcessQueueAdapter,
  type Logger,
  StaticEventSourceControlAdapter,
  StaticSecretReaderAdapter,
} from '@ledger/shared';
import { FakeClock, FakeQueueAttributes, RecordingMetrics } from '@ledger/shared/testing';
import { createWorker } from '@ledger/worker';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createReconciler } from './create-reconciler.ts';

const WEBHOOK_ID = 'wh_fake_ledger';
const HOUR_MS = 3_600_000;
const SIGNING_SECRETS_ID = 'test/webhook-signing-secrets';
// A test signing secret built at run time, so no `whsec_` literal sits in the source (gitleaks).
const SECRET = ['whsec', Buffer.from('recovery-suite-signing-key-0001').toString('base64')].join(
  '_',
);

const silent: Logger = { info: () => {}, warn: () => {}, error: () => {} };
const wallClock: ClockPort = { now: () => new Date() };

type Harness = {
  t: TestDatabase;
  api: FakeResendApi;
  queueAttributes: FakeQueueAttributes;
  clock: FakeClock;
  // Sends a held event through ingest, signed under its own id, as a delivery or a replay would.
  deliver: (event: FakeWebhookEvent) => Promise<number>;
  reconciler: (options?: { configured?: boolean }) => ReturnType<typeof createReconciler>;
  // Resolves once every given id is stored, or fails after a real-time deadline.
  storedEventually: (svixIds: readonly string[]) => Promise<void>;
};

let h: Harness;

beforeEach(async () => {
  const t = await createTestDatabase();
  const api = await startFakeResendApi();
  const queueAttributes = new FakeQueueAttributes();
  const clock = new FakeClock(new Date());
  const queue = new InProcessQueueAdapter({ clock: wallClock, logger: silent });
  const ingest = createIngest({
    secretReader: new StaticSecretReaderAdapter({ [SIGNING_SECRETS_ID]: JSON.stringify([SECRET]) }),
    signingSecretsId: SIGNING_SECRETS_ID,
    simulatorSecretId: undefined,
    queue,
    clock: wallClock,
    logger: silent,
    metrics: new RecordingMetrics(),
  });
  const worker = createWorker({
    database: t.database,
    eventSource: new StaticEventSourceControlAdapter(),
    storageLimitBytes: STORAGE_LIMIT_BYTES,
    clock: wallClock,
    logger: silent,
    metrics: new RecordingMetrics(),
    addressHashKey: new Uint8Array(32).fill(9),
  });
  queue.start(worker.processBatch);

  const deliver = async (event: FakeWebhookEvent): Promise<number> => {
    const body = JSON.stringify(event.payload);
    const headers = signWebhook({
      secret: SECRET,
      svixId: event.id,
      timestamp: Math.floor(Date.now() / 1000),
      body,
    });
    const response = await ingest({ rawBody: body, headers });
    return response.status;
  };
  api.onReplay = async (eventId) => {
    const event = api.events.find((e) => e.id === eventId);
    if (event !== undefined) await deliver(event);
  };

  h = {
    t,
    api,
    queueAttributes,
    clock,
    deliver,
    reconciler: ({ configured = true } = {}) =>
      createReconciler({
        db: t.db,
        resend: configured
          ? createResendClient({
              apiKey: 're_fake_key',
              baseUrl: api.baseUrl,
              userAgent: 'ledger-reconciler',
              clock,
              sleep: async (ms) => clock.advance(ms),
              logger: silent,
            })
          : undefined,
        webhookId: configured ? WEBHOOK_ID : undefined,
        queueAttributes,
        clock,
        logger: silent,
        metrics: new RecordingMetrics(),
      }),
    storedEventually: async (svixIds) => {
      const deadline = Date.now() + 10_000;
      while (Date.now() < deadline) {
        if ((await webhookEventsRepository.countPresent(t.db, svixIds)) === svixIds.length) return;
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      throw new TypeError('the replayed events were never all stored');
    },
  };
});

afterEach(async () => {
  await h.api.close();
  await h.t.drop();
});

// An outbound event of an email, created `hoursAgo` before now, its payload naming a test address.
function event(id: string, type: string, emailId: string, hoursAgo: number): FakeWebhookEvent {
  const createdAt = new Date(Date.now() - hoursAgo * HOUR_MS);
  return {
    id,
    type,
    createdAt,
    payload: {
      type,
      created_at: createdAt.toISOString(),
      data: { email_id: emailId, to: ['delivered@resend.dev'], subject: 'Recovery suite' },
    },
  };
}

const rowsOf = async (svixId: string): Promise<number> =>
  webhookEventsRepository.countPresent(h.t.db, [svixId]);

const replayRequests = (): number =>
  h.api.requests.filter((r) => r.path.endsWith('/replay')).length;

describe('recovery (ADR-007)', () => {
  it('an outage past the retry schedule ends 100 % recovered with 0 duplicates', async () => {
    // Three emails, sent and delivered 30 h ago: past Resend's ≈ 27.6 h schedule (RS-09).
    const events = [1, 2, 3].flatMap((n) => [
      event(`msg_out_${n}_sent`, 'email.sent', `e_out_${n}`, 30),
      event(`msg_out_${n}_delivered`, 'email.delivered', `e_out_${n}`, 29.9),
    ]);
    h.api.events = events;
    const stored = events.slice(0, 3);
    for (const e of stored) expect(await h.deliver(e)).toBe(200);
    await h.storedEventually(stored.map((e) => e.id));

    const run = await h.reconciler().runScheduled();

    expect(run).toMatchObject({ checked: 6, missing: 3, replayed: 3, failed: 0, errorCode: null });
    await h.storedEventually(events.map((e) => e.id));
    for (const e of events) expect(await rowsOf(e.id), e.id).toBe(1);

    const second = await h.reconciler().runScheduled();
    expect(second).toMatchObject({ checked: 6, missing: 0, replayed: 0, errorCode: null });

    // A late re-delivery of a recovered event leaves one row (ADR-004).
    const lateSent = events[3];
    if (lateSent === undefined) throw new TypeError('fixture');
    expect(await h.deliver(lateSent)).toBe(200);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(await rowsOf(lateSent.id)).toBe(1);
  });

  it('an out-of-order replay leaves the projection of both events', async () => {
    const sent = event('msg_ooo_sent', 'email.sent', 'e_ooo', 30);
    const delivered = event('msg_ooo_delivered', 'email.delivered', 'e_ooo', 29.9);
    h.api.events = [sent, delivered];
    expect(await h.deliver(delivered)).toBe(200);
    await h.storedEventually([delivered.id]);

    const run = await h.reconciler().runScheduled();

    expect(run).toMatchObject({ missing: 1, replayed: 1 });
    await h.storedEventually([sent.id]);
    expect((await emailStateRepository.get(h.t.db, 'e_ooo'))?.status).toBe('delivered');
  });

  it('a 5-day gap since the last good run is recovered with no --lookback', async () => {
    const anchorEnd = new Date(Date.now() - 5 * 24 * HOUR_MS);
    const good = await h.t.db.transaction((tx) =>
      reconcileRunsRepository.insert(tx, {
        trigger: 'scheduled',
        dryRun: false,
        horizonStart: new Date(anchorEnd.getTime() - 72 * HOUR_MS),
        horizonEnd: anchorEnd,
        claimed: true,
      }),
    );
    await reconcileRunsRepository.finish(h.t.db, good.id, {
      checked: 0,
      missing: 0,
      replayed: 0,
      failed: 0,
      errorCode: null,
    });
    // 4.5 days old: outside the default 72 h lookback, inside the gap since the anchor.
    const lost = event('msg_gap_sent', 'email.sent', 'e_gap', 108);
    h.api.events = [lost];

    const run = await h.reconciler().runScheduled();

    expect(run?.horizonStart).toEqual(anchorEnd);
    expect(run).toMatchObject({ checked: 1, missing: 1, replayed: 1, errorCode: null });
    await h.storedEventually([lost.id]);
  });

  it('a disabled webhook stops the run with webhook_disabled before any List Events call', async () => {
    h.api.webhookStatus = 'disabled';
    h.api.events = [event('msg_dis_sent', 'email.sent', 'e_dis', 30)];

    const run = await h.reconciler().runScheduled();

    expect(run?.errorCode).toBe('webhook_disabled');
    expect(h.api.requests.map((r) => r.path)).toEqual([`/webhooks/${WEBHOOK_ID}`]);
  });

  it('a 429 storm with retry-after still completes', async () => {
    h.api.events = [
      event('msg_storm_sent', 'email.sent', 'e_storm', 30),
      event('msg_storm_delivered', 'email.delivered', 'e_storm', 29.9),
    ];
    const tooMany = {
      status: 429,
      body: { statusCode: 429, name: 'rate_limit_exceeded', message: 'Too many requests' },
      headers: { 'retry-after': '1' },
    };
    h.api.script('listEvents', [tooMany, tooMany, tooMany, tooMany, tooMany]);

    const run = await h.reconciler().runScheduled();

    expect(run).toMatchObject({ checked: 2, missing: 2, replayed: 2, errorCode: null });
    expect(h.api.requests.filter((r) => r.path.endsWith('/events'))).toHaveLength(6);
    await h.storedEventually(['msg_storm_sent', 'msg_storm_delivered']);
  });

  it('an event still queued behind a backlog is neither counted nor replayed', async () => {
    // The source queue's oldest message is 30 min old; an unstored event 20 min old may be in it.
    h.queueAttributes.snapshot = {
      ...h.queueAttributes.snapshot,
      visible: 4,
      oldestAgeSeconds: 1_800,
    };
    h.api.events = [event('msg_queued_sent', 'email.sent', 'e_queued', 20 / 60)];

    const run = await h.reconciler().runScheduled();

    expect(run).toMatchObject({ checked: 0, missing: 0, replayed: 0, errorCode: null });
    expect(replayRequests()).toBe(0);
  });

  it('one failed replay counts in failed and the run goes on', async () => {
    h.api.events = [
      event('msg_fail_a', 'email.sent', 'e_fail', 30),
      event('msg_fail_b', 'email.delivered', 'e_fail', 29.9),
    ];
    h.api.script('replayEvent', [
      {
        status: 422,
        body: { statusCode: 422, name: 'validation_error', message: 'Cannot replay' },
      },
    ]);

    const run = await h.reconciler().runScheduled();

    expect(run).toMatchObject({ checked: 2, missing: 2, replayed: 1, failed: 1, errorCode: null });
  });

  it('the time budget reached ends rate_limited, which never anchors (PP C2)', async () => {
    h.api.events = [event('msg_deadline_sent', 'email.sent', 'e_deadline', 30)];
    // A retry-after longer than the run's whole budget cannot be waited out.
    h.api.script('listEvents', [
      {
        status: 429,
        body: { statusCode: 429, name: 'rate_limit_exceeded', message: 'Too many requests' },
        headers: { 'retry-after': String(RECONCILE_RUN_BUDGET_MS / 1000) },
      },
    ]);

    const run = await h.reconciler().runScheduled();

    expect(run?.errorCode).toBe('rate_limited');
    const anchor = await h.t.db.transaction((tx) => reconcileRunsRepository.anchorHorizonEnd(tx));
    expect(anchor).toBeUndefined();
  });

  it('a dry run reports the same missing count and makes no replay request', async () => {
    h.api.events = [
      event('msg_dry_sent', 'email.sent', 'e_dry', 30),
      event('msg_dry_delivered', 'email.delivered', 'e_dry', 29.9),
    ];
    const now = new Date();
    const manual = await h.t.db.transaction((tx) =>
      reconcileRunsRepository.insert(tx, {
        trigger: 'manual',
        dryRun: true,
        ...reconcileHorizon({
          now,
          lookbackMs: RECONCILE_DEFAULT_LOOKBACK_MS,
          anchorHorizonEnd: undefined,
          oldestQueueAgeSeconds: undefined,
        }),
        claimed: false,
      }),
    );

    const run = await h.reconciler().runClaimed(manual.id);

    expect(run).toMatchObject({
      dryRun: true,
      checked: 2,
      missing: 2,
      replayed: 0,
      errorCode: null,
    });
    expect(replayRequests()).toBe(0);
    expect(await rowsOf('msg_dry_sent')).toBe(0);
  });

  it('a reconciler with no Resend configuration ends reconciler_not_configured with no request', async () => {
    h.api.events = [event('msg_nc_sent', 'email.sent', 'e_nc', 30)];

    const run = await h.reconciler({ configured: false }).runScheduled();

    expect(run?.errorCode).toBe('reconciler_not_configured');
    expect(h.api.requests).toHaveLength(0);
  });
});
