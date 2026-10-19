import { createTestDatabase, type TestDatabase } from '@ledger/db/testing';
import { hashApiToken } from '@ledger/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApi } from './create-api.ts';
import { bearer, issueTestToken, testApiDeps } from './testing.ts';

// D21, as the runtime role: `token.getCurrent` answers the caller's own row, never its hash.

let t: TestDatabase;
let api: ReturnType<typeof createApi>;

beforeAll(async () => {
  t = await createTestDatabase();
  api = createApi(testApiDeps(t.db));
});

afterAll(async () => {
  await t.drop();
});

describe('token.getCurrent', () => {
  it('a read token answers 200 with its own id, name and scope, never its hash or plaintext', async () => {
    await issueTestToken(t.db, { scope: 'operate', name: 'someone-else' });
    const { token, tokenId } = await issueTestToken(t.db, { scope: 'read', name: 'me' });

    const response = await api.request('/tokens/current', { headers: bearer(token) });
    const text = await response.text();

    expect(response.status).toBe(200);
    expect(JSON.parse(text)).toEqual({
      object: 'token',
      token_id: tokenId,
      name: 'me',
      scope: 'read',
      created_at: expect.any(String),
      revoked_at: null,
    });
    expect(text).not.toContain(token);
    expect(text).not.toContain(hashApiToken(token));
  });
});
