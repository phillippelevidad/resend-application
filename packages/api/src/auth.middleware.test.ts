import { createDatabase } from '@ledger/db';
import { mintApiToken } from '@ledger/shared';
import { afterAll, describe, expect, it } from 'vitest';
import { createApi } from './create-api.ts';
import { bearer, TEST_TOKEN_TAG_KEY, testApiDeps } from './testing/api-test-deps.ts';

// D18: the tag check runs before any database connection opens. The database is at 127.0.0.1:1,
// where nothing listens: any lookup fails `ECONNREFUSED`, a connection-class error that answers
// `503`. So a `401` here is itself the evidence that no connection was attempted, and the
// tag-valid contrast case shows the same app does attempt one once the tag verifies.

const runbook = 'https://github.com/phillippelevidad/resend-application/blob/main/docs/runbook.md';

const unauthorized = {
  error: {
    code: 'unauthorized',
    message: 'Bearer token missing, malformed, bad-tag, unknown or revoked.',
    hint: 'Set `LEDGER_TOKEN` to an active token.',
    docs: `${runbook}#unauthorized`,
  },
};

const silent = { info: () => {}, warn: () => {}, error: () => {} };
const unreachable = createDatabase({
  url: 'postgres://ledger:ledger@127.0.0.1:1/ledger',
  max: 1,
  logger: silent,
});
const api = createApi(testApiDeps(unreachable.db));

afterAll(async () => {
  await unreachable.pool.end();
});

// Right shape (`ldg_` + 64 hex + `_` + 64 hex), tag computed under another installation's key.
const badTag = mintApiToken(new Uint8Array(32).fill(0x11)).token;
const tagValid = mintApiToken(TEST_TOKEN_TAG_KEY).token;

describe('auth middleware before any database connection', () => {
  it.each([
    ['no Authorization header', {}],
    ['a Basic credential', { authorization: 'Basic bGVkZ2VyOmxlZGdlcg==' }],
    ['a malformed token, ldg_abc', bearer('ldg_abc')],
    ['a well-shaped token with a bad tag', bearer(badTag)],
  ] satisfies [string, Record<string, string>][])(
    '%s answers 401 unauthorized with the registry message, the database never reached',
    async (_case, headers) => {
      for (const path of ['/emails/e1', '/health', '/tokens', '/nope']) {
        const response = await api.request(path, { headers });

        expect(response.status).toBe(401);
        expect(await response.json()).toEqual(unauthorized);
      }
    },
  );

  it.each([
    ['no token', {}],
    ['a bad-tag token', bearer(badTag)],
  ] satisfies [string, Record<string, string>][])(
    'POST routes with %s answer 401 before their body is validated',
    async (_case, headers) => {
      for (const path of ['/recipients/lookup', '/tokens', '/tokens/1/revoke', '/worker/resume']) {
        const response = await api.request(path, {
          method: 'POST',
          headers: { ...headers, 'content-type': 'application/json' },
          body: '{}',
        });

        expect(response.status).toBe(401);
        expect(await response.json()).toEqual(unauthorized);
      }
    },
  );

  it('a tag-valid token reaches the lookup: with the database unreachable it answers 503, not 401', async () => {
    const response = await api.request('/emails/e1', { headers: bearer(tagValid) });

    expect(response.status).toBe(503);
    expect(((await response.json()) as typeof unauthorized).error.code).toBe(
      'database_unavailable',
    );
  });

  it('health.get with a tag-valid token answers 200 on the tag alone while the database is unreachable', async () => {
    const response = await api.request('/health', { headers: bearer(tagValid) });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      object: 'health',
      database: { reachable: false, storage_bytes: null },
    });
  });
});
