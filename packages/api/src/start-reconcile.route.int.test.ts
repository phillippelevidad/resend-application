// Slice 4 D18, D27, Ships 2 and 4, as the runtime role: `reconcile.start` answers `202` with the
// inserted manual run and hands it to the reconciler; a `read` token is refused before any start; a
// run already unfinished answers `409`; a rejected hand-off finishes the row, so the next start is
// accepted; each bad field is named. The database outage case is in get-health.route.int.test.ts.
import { createTestDatabase, type TestDatabase } from '@ledger/db/testing';
import { FakeAsyncFunctionInvoke } from '@ledger/shared/testing';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApi } from './create-api.ts';
import type { ErrorResponse } from './error-response.schema.ts';
import type { ReconcileRunResponse } from './reconcile-run-response.schema.ts';
import { bearer, issueTestToken, testApiDeps } from './testing.ts';

const bodyMessage =
  'The request body must be a JSON object with optional dry_run and lookback fields.';

let t: TestDatabase;
let invoke: FakeAsyncFunctionInvoke;
let api: ReturnType<typeof createApi>;
let operate: string;
let read: string;

beforeAll(async () => {
  t = await createTestDatabase();
  ({ token: operate } = await issueTestToken(t.db, { scope: 'operate' }));
  ({ token: read } = await issueTestToken(t.db, { scope: 'read' }));
});

afterAll(async () => {
  await t.drop();
});

// A fresh invoke per test, and no unfinished run left by the one before.
beforeEach(async () => {
  invoke = new FakeAsyncFunctionInvoke();
  api = createApi(testApiDeps(t.db, { reconcilerInvoke: invoke }));
  await t.owner.execute(
    `update reconcile_runs set finished_at = now(), error_code = 'internal_error' where finished_at is null`,
  );
});

const rowCount = async (): Promise<number> => {
  const { rows } = await t.owner.execute<{ n: number }>(
    'select count(*)::int as n from reconcile_runs',
  );
  return rows[0]?.n ?? 0;
};

async function start(
  body: string,
  token = operate,
): Promise<{ status: number; body: ReconcileRunResponse & ErrorResponse }> {
  const response = await api.request('/reconcile', {
    method: 'POST',
    headers: { ...bearer(token), 'content-type': 'application/json' },
    body,
  });
  return {
    status: response.status,
    body: (await response.json()) as ReconcileRunResponse & ErrorResponse,
  };
}

describe('reconcile.start', () => {
  it('answers 202 with the inserted manual run and invokes the reconciler once with its id', async () => {
    const { status, body } = await start('{}');

    expect(status).toBe(202);
    expect(body).toMatchObject({
      object: 'reconcile_run',
      trigger: 'manual',
      dry_run: false,
      finished_at: null,
      error: null,
    });
    expect(invoke.payloads).toEqual([{ ledger: 'reconcile-run', run_id: body.run_id }]);
  });

  it('starts a dry run with its lookback', async () => {
    const { status, body } = await start('{ "dry_run": true, "lookback": "6h" }');

    expect(status).toBe(202);
    expect(body.dry_run).toBe(true);
    const span = Date.parse(body.horizon_end) - Date.parse(body.horizon_start);
    expect(span).toBeLessThanOrEqual(6 * 3_600_000);
  });

  it('answers 409 reconcile_in_progress while a run is unfinished, inserting no row', async () => {
    expect((await start('{}')).status).toBe(202);
    const before = await rowCount();

    const { status, body } = await start('{}');

    expect(status).toBe(409);
    expect(body.error.code).toBe('reconcile_in_progress');
    expect(await rowCount()).toBe(before);
  });

  it('answers 403 forbidden to a read token before any validation, inserting no row', async () => {
    const before = await rowCount();

    const { status, body } = await start('{ "lookback": "31d" }', read);

    expect(status).toBe(403);
    expect(body.error.code).toBe('forbidden');
    expect(await rowCount()).toBe(before);
    expect(invoke.payloads).toEqual([]);
  });

  it('answers 500 internal_error on a rejected hand-off, finishes the row, and accepts the next start', async () => {
    invoke.failNext();

    const failed = await start('{}');

    expect(failed.status).toBe(500);
    expect(failed.body.error.code).toBe('internal_error');
    const { rows } = await t.owner.execute<{ error_code: string | null; finished: boolean }>(
      'select error_code, finished_at is not null as finished from reconcile_runs order by id desc limit 1',
    );
    expect(rows[0]).toEqual({ error_code: 'internal_error', finished: true });

    expect((await start('{}')).status).toBe(202);
  });

  it.each([
    ['{ "lookback": "31d" }', 'lookback must be a duration from 1m to 30d, such as 72h.'],
    ['{ "lookback": "2x" }', 'lookback must be a duration from 1m to 30d, such as 72h.'],
    ['{ "lookback": 72 }', 'lookback must be a duration from 1m to 30d, such as 72h.'],
    ['{ "dry_run": "yes" }', 'dry_run must be true or false.'],
    ['[]', bodyMessage],
    ['"x"', bodyMessage],
    ['not json', bodyMessage],
  ])('answers 400 validation_failed for the body %s', async (body, message) => {
    const before = await rowCount();

    const response = await start(body);

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('validation_failed');
    expect(response.body.error.message).toBe(message);
    expect(await rowCount()).toBe(before);
  });
});
