// Slice 4 D16, D6, D15, ADR-007, as the runtime role: a run is claimed before any Resend call, so a
// duplicate invoke (AWS-53) or a finished row makes none; a scheduled start never overlaps an
// unfinished run; an unexpected throw after the claim finishes the row `internal_error`; a finish
// that stores nothing (the row finished elsewhere) emits no `reconcile.*` metric (D19, D24). The real
// client runs against the fake Resend API on a fake clock started at wall-clock time, because
// `started_at` and the overlap check read Postgres's `now()` (D43).
import { RUNTIME_ROLE, reconcileRunsRepository } from '@ledger/db';
import { createTestDatabase, type TestDatabase } from '@ledger/db/testing';
import { createResendClient } from '@ledger/resend-client';
import {
  type FakeResendApi,
  FakeResendClient,
  startFakeResendApi,
} from '@ledger/resend-client/testing';
import type { LedgerError, LogFields } from '@ledger/shared';
import { FakeClock, FakeQueueAttributes, RecordingMetrics } from '@ledger/shared/testing';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createReconciler } from './create-reconciler.ts';

const WEBHOOK_ID = 'wh_fake_ledger';

let t: TestDatabase;
let api: FakeResendApi;
let lines: { message: string; fields: LogFields | undefined }[];

beforeAll(async () => {
  t = await createTestDatabase();
});

afterAll(async () => {
  await t.drop();
});

beforeEach(async () => {
  api = await startFakeResendApi();
  lines = [];
});

afterEach(async () => {
  await api.close();
});

function reconciler() {
  const clock = new FakeClock(new Date());
  const sleep = async (ms: number): Promise<void> => clock.advance(ms);
  const logger = {
    info: (message: string, fields?: LogFields) => lines.push({ message, fields }),
    warn: (message: string, fields?: LogFields) => lines.push({ message, fields }),
    error: (message: string, fields?: LogFields) => lines.push({ message, fields }),
  };
  return createReconciler({
    db: t.db,
    resend: createResendClient({
      apiKey: 're_fake_key',
      baseUrl: api.baseUrl,
      userAgent: 'ledger-reconciler',
      clock,
      sleep,
      logger,
    }),
    webhookId: WEBHOOK_ID,
    queueAttributes: new FakeQueueAttributes(),
    clock,
    logger,
    metrics: new RecordingMetrics(),
  });
}

const insertManualRun = () =>
  t.db.transaction((tx) =>
    reconcileRunsRepository.insert(tx, {
      trigger: 'manual',
      dryRun: false,
      horizonStart: new Date(Date.now() - 72 * 3_600_000),
      horizonEnd: new Date(Date.now() - 600_000),
      claimed: false,
    }),
  );

// Finishes every unfinished row, so a test's scheduled start is not refused by an earlier one's.
const finishAll = () =>
  t.owner.execute(
    `update reconcile_runs set finished_at = now(), error_code = 'internal_error' where finished_at is null`,
  );

describe('the reconciler claim (D16)', () => {
  it('a second invoke of a claimed run makes no Resend call and logs one reconcile.duplicate_invoke', async () => {
    await finishAll();
    const run = await insertManualRun();
    const first = await reconciler().runClaimed(run.id);
    expect(first?.finishedAt).toBeInstanceOf(Date);
    expect(api.requests.length).toBeGreaterThan(0);

    api.requests.length = 0;
    lines.length = 0;
    expect(await reconciler().runClaimed(run.id)).toBeUndefined();

    expect(api.requests).toHaveLength(0);
    expect(lines).toEqual([
      { message: 'reconcile.duplicate_invoke', fields: { run_id: String(run.id) } },
    ]);
  });

  it('an invoke of a run another invoke has claimed and not finished makes no Resend call', async () => {
    const run = await insertManualRun();
    await reconcileRunsRepository.claim(t.db, run.id);

    expect(await reconciler().runClaimed(run.id)).toBeUndefined();

    expect(api.requests).toHaveLength(0);
    expect((await reconcileRunsRepository.get(t.db, run.id))?.finishedAt).toBeNull();
  });

  it('an invoke of a finished row makes no Resend call', async () => {
    const run = await insertManualRun();
    await reconcileRunsRepository.finish(t.db, run.id, {
      checked: 0,
      missing: 0,
      replayed: 0,
      failed: 0,
      errorCode: 'internal_error',
    });

    expect(await reconciler().runClaimed(run.id)).toBeUndefined();

    expect(api.requests).toHaveLength(0);
  });
});

describe('the scheduled start (D6)', () => {
  it('is refused while another run is unfinished inside its budget, with no Resend call', async () => {
    await finishAll();
    await insertManualRun();

    expect(await reconciler().runScheduled()).toBeUndefined();

    expect(api.requests).toHaveLength(0);
    expect(lines).toEqual([
      { message: 'reconcile.start_refused', fields: { error_code: 'reconcile_in_progress' } },
    ]);
  });

  it('starts, claims at insert and finishes a scheduled run', async () => {
    await finishAll();

    const run = await reconciler().runScheduled();

    expect(run).toMatchObject({ trigger: 'scheduled', dryRun: false, errorCode: null });
    expect(run?.claimedAt).toBeInstanceOf(Date);
    expect(run?.finishedAt).toBeInstanceOf(Date);
    expect(api.requests[0]?.path).toBe(`/webhooks/${WEBHOOK_ID}`);
  });
});

describe('a finish that stores nothing (D19, D24)', () => {
  it('emits no reconcile.* metric and no run_finished line when the row was finished elsewhere', async () => {
    await finishAll();
    const run = await insertManualRun();
    // Another writer finishes the row after the claim and before this run's finish: the fake's
    // first call, which `executeRun` makes after the claim (RS-11).
    class FinishedElsewhere extends FakeResendClient {
      override async retrieveWebhook(...args: Parameters<FakeResendClient['retrieveWebhook']>) {
        await reconcileRunsRepository.finish(t.db, run.id, {
          checked: 0,
          missing: 0,
          replayed: 0,
          failed: 0,
          errorCode: 'internal_error',
        });
        return super.retrieveWebhook(...args);
      }
    }
    const resend = new FinishedElsewhere();
    resend.events = [
      { id: 'msg_elsewhere_1', type: 'email.sent', createdAt: new Date(Date.now() - 3_600_000) },
    ];
    const metrics = new RecordingMetrics();
    const leveled: { level: string; message: string; fields: LogFields | undefined }[] = [];
    const log = (level: string) => (message: string, fields?: LogFields) =>
      leveled.push({ level, message, fields });

    const result = await createReconciler({
      db: t.db,
      resend,
      webhookId: WEBHOOK_ID,
      queueAttributes: new FakeQueueAttributes(),
      clock: new FakeClock(new Date()),
      logger: { info: log('info'), warn: log('warn'), error: log('error') },
      metrics,
    }).runClaimed(run.id);

    expect(result).toBeUndefined();
    // The other writer's outcome stands; this run's (one missing event, replayed) was not stored.
    const stored = await reconcileRunsRepository.get(t.db, run.id);
    expect(stored).toMatchObject({ errorCode: 'internal_error', missing: 0, replayed: 0 });
    expect(metrics.recorded).toEqual([]);
    expect(leveled.map((line) => line.message)).not.toContain('reconcile.run_finished');
    expect(leveled.at(-1)).toEqual({
      level: 'warn',
      message: 'reconcile.already_finished',
      fields: { run_id: String(run.id) },
    });
  });
});

describe("the factory's edge (D15)", () => {
  it('finishes the row internal_error after an unexpected throw past the claim, and rethrows a constant', async () => {
    await finishAll();
    api.events = [
      { id: 'msg_edge_1', type: 'email.sent', createdAt: new Date(Date.now() - 3_600_000) },
    ];
    const run = await insertManualRun();
    // A real fault: the presence lookup is refused, after the claim and the first Resend calls.
    await t.owner.execute(`revoke select on webhook_events from "${RUNTIME_ROLE}"`);
    try {
      const failure = await reconciler()
        .runClaimed(run.id)
        .catch((error: unknown) => error);
      expect((failure as LedgerError).code).toBe('internal_error');
      expect((failure as LedgerError).message).toBe('The reconcile run failed unexpectedly.');
    } finally {
      await t.owner.execute(`grant select on webhook_events to "${RUNTIME_ROLE}"`);
    }

    const stored = await reconcileRunsRepository.get(t.db, run.id);
    expect(stored?.errorCode).toBe('internal_error');
    expect(stored?.finishedAt).toBeInstanceOf(Date);
    expect(lines.map((line) => line.message)).toContain('reconcile.internal_error');
  });
});
