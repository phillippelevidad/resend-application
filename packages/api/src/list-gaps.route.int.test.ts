// Slice 4 D27, Ships 4, as the runtime role: `gaps.list` pages runs started within `since`, newest
// first by `run_id`, derives `run_abandoned` on read, and names each bad field. The database outage
// case is in get-health.route.int.test.ts, which runs its own stoppable container.
import { reconcileRunsRepository } from '@ledger/db';
import { createTestDatabase, type TestDatabase } from '@ledger/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApi } from './create-api.ts';
import type { ErrorResponse } from './error-response.schema.ts';
import type { ReconcileRunListResponse } from './reconcile-run-list-response.schema.ts';
import { bearer, issueTestToken, testApiDeps } from './testing.ts';

let t: TestDatabase;
let api: ReturnType<typeof createApi>;
let token: string;
// Oldest first: three runs started now, one moved back 2 days, one abandoned.
const ids: number[] = [];
let oldId: number;

const insert = () =>
  t.db.transaction((tx) =>
    reconcileRunsRepository.insert(tx, {
      trigger: 'scheduled',
      dryRun: false,
      horizonStart: new Date(Date.now() - 72 * 3_600_000),
      horizonEnd: new Date(Date.now() - 600_000),
      claimed: true,
    }),
  );

const finishClean = (id: number) =>
  reconcileRunsRepository.finish(t.db, id, {
    checked: 1,
    missing: 0,
    replayed: 0,
    failed: 0,
    errorCode: null,
  });

beforeAll(async () => {
  t = await createTestDatabase();
  api = createApi(testApiDeps(t.db));
  ({ token } = await issueTestToken(t.db, { scope: 'read' }));
  const old = await insert();
  await finishClean(old.id);
  oldId = old.id;
  await t.owner.execute(
    `update reconcile_runs set started_at = now() - interval '2 days' where id = ${old.id}`,
  );
  for (let i = 0; i < 3; i += 1) {
    const run = await insert();
    await finishClean(run.id);
    ids.push(run.id);
  }
});

afterAll(async () => {
  await t.drop();
});

async function list(query: string): Promise<{
  status: number;
  body: ReconcileRunListResponse & ErrorResponse;
}> {
  const response = await api.request(`/gaps${query}`, { headers: bearer(token) });
  return {
    status: response.status,
    body: (await response.json()) as ReconcileRunListResponse & ErrorResponse,
  };
}

const runIds = (body: ReconcileRunListResponse): number[] => body.data.map((run) => run.run_id);

describe('gaps.list', () => {
  it('answers the runs in the window, newest first, with has_more false', async () => {
    const { status, body } = await list('?since=24h');

    expect(status).toBe(200);
    expect(body.object).toBe('list');
    expect(runIds(body)).toEqual([...ids].reverse());
    expect(runIds(body)).not.toContain(oldId);
    expect(body.has_more).toBe(false);
    expect(body.data[0]).toMatchObject({
      object: 'reconcile_run',
      trigger: 'scheduled',
      error: null,
    });
  });

  it('defaults since to 24h', async () => {
    expect(runIds((await list('')).body)).toEqual([...ids].reverse());
    expect(runIds((await list('?since=3d')).body)).toContain(oldId);
  });

  it('pages with limit and after', async () => {
    const first = await list('?limit=2');
    expect(runIds(first.body)).toEqual([ids[2], ids[1]]);
    expect(first.body.has_more).toBe(true);

    const second = await list(`?limit=2&after=${ids[1]}`);
    expect(runIds(second.body)).toEqual([ids[0]]);
    expect(second.body.has_more).toBe(false);
  });

  it('reads an unfinished run past its budget as run_abandoned', async () => {
    const stale = await insert();
    await t.owner.execute(
      `update reconcile_runs set started_at = now() - interval '15 minutes' where id = ${stale.id}`,
    );

    const { body } = await list('?since=1h');

    const item = body.data.find((run) => run.run_id === stale.id);
    expect(item?.error?.code).toBe('run_abandoned');
    expect(item?.finished_at).toBeNull();
    await finishClean(stale.id);
  });

  it.each([
    ['since=2x', 'since must be a duration from 1m to 30d, such as 24h.'],
    ['since=31d', 'since must be a duration from 1m to 30d, such as 24h.'],
    ['limit=0', 'limit must be an integer from 1 to 100.'],
    ['limit=101', 'limit must be an integer from 1 to 100.'],
    ['after=abc', 'after must be a run id, a positive integer.'],
    ['after=0', 'after must be a run id, a positive integer.'],
  ])('answers 400 validation_failed naming the field for %s', async (query, message) => {
    const { status, body } = await list(`?${query}`);

    expect(status).toBe(400);
    expect(body.error.code).toBe('validation_failed');
    expect(body.error.message).toBe(message);
  });

  it('answers 401 without a token', async () => {
    const response = await api.request('/gaps');
    expect(response.status).toBe(401);
  });
});
