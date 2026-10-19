import { apiTokensRepository } from '@ledger/db';
import { createTestDatabase, type TestDatabase } from '@ledger/db/testing';
import { mintApiToken } from '@ledger/shared';
import { FakeFunctionInvoke } from '@ledger/shared/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApi } from './create-api.ts';
import type { ErrorResponse } from './error-response.schema.ts';
import { bearer, issueTestToken, TEST_TOKEN_TAG_KEY, testApiDeps } from './testing.ts';

// Ships 5, R9 (D18), as the runtime role: the lookup after the tag check, and each route's scope.
// The `401` paths that never reach the database are `auth.middleware.test.ts`.

const runbook = 'https://github.com/phillippelevidad/resend-application/blob/main/docs/runbook.md';

const unauthorized = {
  code: 'unauthorized',
  message: 'Bearer token missing, malformed, bad-tag, unknown or revoked.',
  hint: 'Set `LEDGER_TOKEN` to an active token.',
  docs: `${runbook}#unauthorized`,
};

let t: TestDatabase;
let api: ReturnType<typeof createApi>;
let workerInvoke: FakeFunctionInvoke;

beforeAll(async () => {
  t = await createTestDatabase();
  workerInvoke = new FakeFunctionInvoke({ outcome: 'already_enabled', state: 'enabled' });
  api = createApi(testApiDeps(t.db, { workerInvoke }));
});

afterAll(async () => {
  await t.drop();
});

type Answer = { status: number; body: ErrorResponse & Record<string, unknown> };

async function call(method: string, path: string, token: string, json?: unknown): Promise<Answer> {
  const response = await api.request(path, {
    method,
    headers: { ...bearer(token), 'content-type': 'application/json' },
    ...(json === undefined ? {} : { body: JSON.stringify(json) }),
  });
  return { status: response.status, body: (await response.json()) as Answer['body'] };
}

describe('token lookup', () => {
  it('a tag-valid token with no row answers 401 with the same body as every other 401', async () => {
    const unknown = mintApiToken(TEST_TOKEN_TAG_KEY).token;

    const { status, body } = await call('GET', '/health', unknown);

    expect(status).toBe(401);
    expect(body.error).toEqual(unauthorized);
  });

  it('a revoked token answers 401 on its next request, and its row stays with revoked_at set', async () => {
    const { token, tokenId } = await issueTestToken(t.db, { scope: 'read' });
    expect((await call('GET', '/tokens/current', token)).status).toBe(200);

    await t.db.transaction((tx) => apiTokensRepository.markRevoked(tx, tokenId));
    const { status, body } = await call('GET', '/tokens/current', token);

    expect(status).toBe(401);
    expect(body.error).toEqual(unauthorized);
    expect((await apiTokensRepository.findById(t.db, tokenId))?.revokedAt).toBeInstanceOf(Date);
  });
});

describe('scope', () => {
  it('a read token answers 403 forbidden on each of the four operate routes, and none of them acts', async () => {
    const { token: read } = await issueTestToken(t.db, { scope: 'read' });
    const { tokenId: target } = await issueTestToken(t.db, { scope: 'read', name: 'target' });
    const before = await apiTokensRepository.listPage(t.db, { limit: 100 });

    const answers = [
      await call('POST', '/tokens', read, { name: 'from-read', scope: 'operate' }),
      await call('GET', '/tokens', read),
      await call('POST', `/tokens/${target}/revoke`, read),
      await call('POST', '/worker/resume', read),
    ];

    for (const { status, body } of answers) {
      expect(status).toBe(403);
      expect(body.error).toEqual({
        code: 'forbidden',
        message: 'The token is valid but lacks the scope this operation needs.',
        hint: 'Use an `operate` token, or ask its owner for one.',
        docs: `${runbook}#forbidden`,
      });
    }
    expect(await apiTokensRepository.listPage(t.db, { limit: 100 })).toEqual(before);
    expect(workerInvoke.payloads).toEqual([]);
  });

  it('a read token is refused on a malformed operate request with 403, before validation', async () => {
    const { token: read } = await issueTestToken(t.db, { scope: 'read' });

    const { status, body } = await call('POST', '/tokens/0/revoke', read);

    expect(status).toBe(403);
    expect(body.error.code).toBe('forbidden');
  });

  it('an operate token answers every read route as a read token would', async () => {
    const { token: operate, tokenId } = await issueTestToken(t.db, { scope: 'operate' });

    expect((await call('GET', '/health', operate)).status).toBe(200);
    expect((await call('GET', '/tokens/current', operate)).body).toMatchObject({
      token_id: tokenId,
      scope: 'operate',
    });
    const email = await call('GET', '/emails/no-such-email', operate);
    expect(email.status).toBe(404);
    expect(email.body.error.code).toBe('email_not_found');
    const recipient = await call('POST', '/recipients/lookup', operate, {
      address: 'bounced+never@resend.dev',
    });
    expect(recipient.status).toBe(404);
    expect(recipient.body.error.code).toBe('recipient_not_found');
  });
});
