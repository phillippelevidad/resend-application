import { apiTokensRepository } from '@ledger/db';
import { createTestDatabase, type TestDatabase } from '@ledger/db/testing';
import { hashApiToken } from '@ledger/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApi } from './create-api.ts';
import type { ErrorResponse } from './error-response.schema.ts';
import { bearer, issueTestToken, type TestToken, testApiDeps } from './testing.ts';
import type { TokenListResponse } from './token-response.schema.ts';

// Ships 5, R11 (D21), as the runtime role: `token.list` pages newest first by `token_id`, keyset on
// `after`, and never answers a hash or a plaintext token. This file's clone holds exactly the three
// tokens `beforeAll` issues, so the pages are known.

const runbook = 'https://github.com/phillippelevidad/resend-application/blob/main/docs/runbook.md';

let t: TestDatabase;
let api: ReturnType<typeof createApi>;
// Oldest first: the caller, then two more.
let caller: TestToken;
let middle: TestToken;
let newest: TestToken;

beforeAll(async () => {
  t = await createTestDatabase();
  api = createApi(testApiDeps(t.db));
  caller = await issueTestToken(t.db, { scope: 'operate', name: 'caller' });
  middle = await issueTestToken(t.db, { scope: 'read', name: 'middle' });
  newest = await issueTestToken(t.db, { scope: 'read', name: 'newest' });
});

afterAll(async () => {
  await t.drop();
});

async function list(query: string): Promise<{
  status: number;
  text: string;
  body: TokenListResponse & ErrorResponse;
}> {
  const response = await api.request(`/tokens${query}`, { headers: bearer(caller.token) });
  const text = await response.text();
  return { status: response.status, text, body: JSON.parse(text) };
}

const ids = (body: TokenListResponse): number[] => body.data.map((token) => token.token_id);

describe('token.list', () => {
  it('pages newest first: limit=2 answers the two newest with has_more, after the second the oldest', async () => {
    const first = await list('?limit=2');

    expect(first.status).toBe(200);
    expect(first.body.object).toBe('list');
    expect(ids(first.body)).toEqual([newest.tokenId, middle.tokenId]);
    expect(first.body.has_more).toBe(true);

    const second = await list(`?limit=2&after=${middle.tokenId}`);

    expect(second.status).toBe(200);
    expect(ids(second.body)).toEqual([caller.tokenId]);
    expect(second.body.has_more).toBe(false);
  });

  it('without limit answers every token up to the default page, each a token object without a hash', async () => {
    const { status, text, body } = await list('');

    expect(status).toBe(200);
    expect(body.has_more).toBe(false);
    expect(body.data).toEqual([
      {
        object: 'token',
        token_id: newest.tokenId,
        name: 'newest',
        scope: 'read',
        created_at: expect.any(String),
        revoked_at: null,
      },
      expect.objectContaining({ token_id: middle.tokenId, name: 'middle', scope: 'read' }),
      expect.objectContaining({ token_id: caller.tokenId, name: 'caller', scope: 'operate' }),
    ]);
    for (const token of [caller, middle, newest]) {
      expect(text).not.toContain(token.token);
      expect(text).not.toContain(hashApiToken(token.token));
    }
    expect(text).not.toMatch(/"(token|token_hash|bootstrap)":/);
  });

  it('lists a revoked token too, with its revoked_at', async () => {
    const revoked = await issueTestToken(t.db, { scope: 'read', name: 'revoked' });
    await t.db.transaction((tx) => apiTokensRepository.markRevoked(tx, revoked.tokenId));

    const { body } = await list('?limit=1');

    expect(body.data).toEqual([
      expect.objectContaining({ token_id: revoked.tokenId, revoked_at: expect.any(String) }),
    ]);
    expect(body.has_more).toBe(true);
  });

  it('accepts limit=100, the upper bound', async () => {
    expect((await list('?limit=100')).status).toBe(200);
  });

  it.each(['0', '101', 'abc', '1.5', '', '-1', '020'])(
    'limit=%s answers 400 validation_failed naming limit',
    async (limit) => {
      const { status, body } = await list(`?limit=${limit}`);

      expect(status).toBe(400);
      expect(body.error).toEqual({
        code: 'validation_failed',
        message: 'limit must be an integer from 1 to 100.',
        hint: 'Fix the field the message names, then retry.',
        docs: `${runbook}#validation_failed`,
      });
    },
  );

  it.each(['0', 'abc', '1234567890123456', '-3', 'tok_1'])(
    'after=%s answers 400 validation_failed naming after',
    async (after) => {
      const { status, body } = await list(`?after=${after}`);

      expect(status).toBe(400);
      expect(body.error).toEqual({
        code: 'validation_failed',
        message: 'after must be a token id, a positive integer.',
        hint: 'Fix the field the message names, then retry.',
        docs: `${runbook}#validation_failed`,
      });
    },
  );
});
