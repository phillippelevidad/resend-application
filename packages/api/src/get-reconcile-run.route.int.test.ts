// Slice 4 D27, Ships 4, as the runtime role: `reconcile.getRun` answers one run, running, finished
// or abandoned, `run_not_found` for an id no row holds, and names a bad id. The database outage case
// is in get-health.route.int.test.ts.
import { errorRegistry } from '@ledger/core';
import { reconcileRunsRepository } from '@ledger/db';
import { createTestDatabase, type TestDatabase } from '@ledger/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApi } from './create-api.ts';
import type { ErrorResponse } from './error-response.schema.ts';
import type { ReconcileRunResponse } from './reconcile-run-response.schema.ts';
import { bearer, issueTestToken, testApiDeps } from './testing.ts';

let t: TestDatabase;
let api: ReturnType<typeof createApi>;
let token: string;

beforeAll(async () => {
  t = await createTestDatabase();
  api = createApi(testApiDeps(t.db));
  ({ token } = await issueTestToken(t.db, { scope: 'read' }));
});

afterAll(async () => {
  await t.drop();
});

const insert = () =>
  t.db.transaction((tx) =>
    reconcileRunsRepository.insert(tx, {
      trigger: 'manual',
      dryRun: true,
      horizonStart: new Date(Date.now() - 72 * 3_600_000),
      horizonEnd: new Date(Date.now() - 600_000),
      claimed: false,
    }),
  );

async function get(runId: string): Promise<{
  status: number;
  body: ReconcileRunResponse & ErrorResponse;
}> {
  const response = await api.request(`/reconcile/runs/${runId}`, { headers: bearer(token) });
  return {
    status: response.status,
    body: (await response.json()) as ReconcileRunResponse & ErrorResponse,
  };
}

describe('reconcile.getRun', () => {
  it('answers a running run with finished_at null and error null', async () => {
    const run = await insert();
    await t.owner.execute(
      `update reconcile_runs set started_at = now() - interval '1 minute' where id = ${run.id}`,
    );

    const { status, body } = await get(String(run.id));

    expect(status).toBe(200);
    expect(body).toMatchObject({
      object: 'reconcile_run',
      run_id: run.id,
      trigger: 'manual',
      dry_run: true,
      finished_at: null,
      error: null,
    });
  });

  it('answers a finished run with its counts and stored outcome', async () => {
    const run = await insert();
    await reconcileRunsRepository.finish(t.db, run.id, {
      checked: 4,
      missing: 1,
      replayed: 0,
      failed: 0,
      errorCode: 'webhook_disabled',
    });

    const { body } = await get(String(run.id));

    expect(body).toMatchObject({ checked: 4, missing: 1, finished_at: expect.any(String) });
    expect(body.error?.code).toBe('webhook_disabled');
  });

  it('answers an unfinished run past its budget as run_abandoned', async () => {
    const run = await insert();
    await t.owner.execute(
      `update reconcile_runs set started_at = now() - interval '15 minutes' where id = ${run.id}`,
    );

    const { body } = await get(String(run.id));

    expect(body.error?.code).toBe('run_abandoned');
    expect(body.finished_at).toBeNull();
  });

  it('answers 404 run_not_found for an id no row holds', async () => {
    const { status, body } = await get('999999999');

    expect(status).toBe(404);
    expect(body.error).toMatchObject({
      code: 'run_not_found',
      message: errorRegistry.run_not_found.message,
      hint: errorRegistry.run_not_found.hint,
    });
  });

  it.each(['abc', '0', '-1', '1.5'])('answers 400 validation_failed for run_id %s', async (id) => {
    const { status, body } = await get(id);

    expect(status).toBe(400);
    expect(body.error.code).toBe('validation_failed');
    expect(body.error.message).toBe('run_id must be a positive integer.');
  });
});
