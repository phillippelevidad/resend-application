import { apiTokensRepository } from '@ledger/db';
import { createTestDatabase, type TestDatabase } from '@ledger/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApi } from './create-api.ts';
import type { ErrorResponse } from './error-response.schema.ts';
import { bearer, issueTestToken, testApiDeps } from './testing.ts';
import type { TokenResponse } from './token-response.schema.ts';

// Ships 5, R12 (D21), as the runtime role: `token.revoke` sets `revoked_at` once, takes effect on the
// revoked token's next request, and never revokes the last active `operate` token. The concurrent
// form of that guard, through the same command, is `revoke-token.command.int.test.ts`.

const runbook = 'https://github.com/phillippelevidad/resend-application/blob/main/docs/runbook.md';

let t: TestDatabase;
let api: ReturnType<typeof createApi>;

beforeAll(async () => {
  t = await createTestDatabase();
  api = createApi(testApiDeps(t.db));
});

afterAll(async () => {
  await t.drop();
});

type Answer = { status: number; body: TokenResponse & ErrorResponse };

async function call(method: string, path: string, token: string): Promise<Answer> {
  const response = await api.request(path, { method, headers: bearer(token) });
  return { status: response.status, body: (await response.json()) as Answer['body'] };
}

const revoke = (tokenId: number | string, as: string): Promise<Answer> =>
  call('POST', `/tokens/${tokenId}/revoke`, as);

describe('token.revoke', () => {
  it('revokes a read token: 200 with revoked_at, its next request 401, its row kept', async () => {
    const { token: operate } = await issueTestToken(t.db, { scope: 'operate' });
    const target = await issueTestToken(t.db, { scope: 'read', name: 'to-revoke' });

    const { status, body } = await revoke(target.tokenId, operate);

    expect(status).toBe(200);
    expect(body).toEqual({
      object: 'token',
      token_id: target.tokenId,
      name: 'to-revoke',
      scope: 'read',
      created_at: expect.any(String),
      revoked_at: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T.*Z$/),
    });
    const next = await call('GET', '/tokens/current', target.token);
    expect(next.status).toBe(401);
    expect(next.body.error.code).toBe('unauthorized');
    expect((await apiTokensRepository.findById(t.db, target.tokenId))?.revokedAt).toBeInstanceOf(
      Date,
    );
  });

  it('is idempotent: revoking a revoked token answers 200 with it unchanged', async () => {
    const { token: operate } = await issueTestToken(t.db, { scope: 'operate' });
    const target = await issueTestToken(t.db, { scope: 'read' });

    const first = await revoke(target.tokenId, operate);
    const second = await revoke(target.tokenId, operate);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(second.body).toEqual(first.body);
  });

  it('an id no row holds answers 404 token_not_found', async () => {
    const { token: operate } = await issueTestToken(t.db, { scope: 'operate' });

    const { status, body } = await revoke('999999999999999', operate);

    expect(status).toBe(404);
    expect(body.error).toEqual({
      code: 'token_not_found',
      message: 'No token with this id.',
      hint: 'List tokens with `ledger token list`.',
      docs: `${runbook}#token_not_found`,
    });
  });

  it.each(['0', '1234567890123456', 'abc', '-1', '1.5'])(
    'token_id %s answers 400 validation_failed naming token_id',
    async (tokenId) => {
      const { token: operate } = await issueTestToken(t.db, { scope: 'operate' });

      const { status, body } = await revoke(tokenId, operate);

      expect(status).toBe(400);
      expect(body.error).toEqual({
        code: 'validation_failed',
        message: 'token_id must be a positive integer.',
        hint: 'Fix the field the message names, then retry.',
        docs: `${runbook}#validation_failed`,
      });
    },
  );

  it('an operate token may revoke itself while another active operate token exists', async () => {
    await issueTestToken(t.db, { scope: 'operate', name: 'stays' });
    const self = await issueTestToken(t.db, { scope: 'operate', name: 'self' });

    const { status, body } = await revoke(self.tokenId, self.token);

    expect(status).toBe(200);
    expect(body.revoked_at).not.toBeNull();
    expect((await call('GET', '/tokens/current', self.token)).status).toBe(401);
  });

  it('revoking the only active operate token answers 409 last_operate_token and it stays active', async () => {
    const last = await issueTestToken(t.db, { scope: 'operate', name: 'last' });
    // Every other active `operate` row in this file's clone is revoked, so `last` is the only one.
    await t.db.transaction(async (tx) => {
      for (const row of await apiTokensRepository.lockActiveOperate(tx)) {
        if (row.id !== last.tokenId) {
          await apiTokensRepository.markRevoked(tx, row.id);
        }
      }
    });

    const { status, body } = await revoke(last.tokenId, last.token);

    expect(status).toBe(409);
    expect(body.error).toEqual({
      code: 'last_operate_token',
      message: 'Revoking this token would leave no active `operate` token.',
      hint: 'Create another `operate` token first.',
      docs: `${runbook}#last_operate_token`,
    });
    expect((await apiTokensRepository.findById(t.db, last.tokenId))?.revokedAt).toBeNull();
    expect((await call('GET', '/tokens/current', last.token)).status).toBe(200);
  });
});
