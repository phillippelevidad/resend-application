import { createTestDatabase, type TestDatabase } from '@ledger/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApi } from './create-api.ts';
import { bearer, issueTestToken, testApiDeps } from './testing.ts';

// D23 with the auth middleware in front (D18): an unmatched method or path answers
// `route_not_found` once the token passes its lookup, which needs the database.

const runbook = 'https://github.com/phillippelevidad/resend-application/blob/main/docs/runbook.md';

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

describe('createApi with an active token', () => {
  it.each([
    ['GET', '/nope'],
    ['GET', '/'],
    ['DELETE', '/emails/e1'],
    ['GET', '/recipients/lookup'],
    ['GET', '/worker/resume'],
  ])('%s %s, served by no operation, answers 404 route_not_found', async (method, path) => {
    const response = await api.request(path, { method, headers: bearer(token) });

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      error: {
        code: 'route_not_found',
        message: 'No operation at this method and path.',
        hint: "Check `LEDGER_URL`, and that the CLI or SDK version matches the API's.",
        docs: `${runbook}#route_not_found`,
      },
    });
  });
});
