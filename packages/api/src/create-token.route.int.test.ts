import { apiTokensRepository } from '@ledger/db';
import { createTestDatabase, type TestDatabase } from '@ledger/db/testing';
import { hashApiToken, hasValidTag } from '@ledger/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApi } from './create-api.ts';
import type { ErrorResponse } from './error-response.schema.ts';
import { bearer, issueTestToken, TEST_TOKEN_TAG_KEY, testApiDeps } from './testing.ts';
import type { CreatedTokenResponse } from './token-response.schema.ts';

// Ships 5, R11 (D3, D21), as the runtime role: `token.create` mints under the installation's tag
// key, stores the hash only, and answers the plaintext this once.

const runbook = 'https://github.com/phillippelevidad/resend-application/blob/main/docs/runbook.md';

let t: TestDatabase;
let api: ReturnType<typeof createApi>;
let operate: string;

beforeAll(async () => {
  t = await createTestDatabase();
  api = createApi(testApiDeps(t.db));
  ({ token: operate } = await issueTestToken(t.db, { scope: 'operate' }));
});

afterAll(async () => {
  await t.drop();
});

type Answer = { status: number; text: string; body: CreatedTokenResponse & ErrorResponse };

async function create(init: RequestInit): Promise<Answer> {
  const response = await api.request('/tokens', {
    method: 'POST',
    ...init,
    headers: { ...bearer(operate), ...(init.headers as Record<string, string> | undefined) },
  });
  const text = await response.text();
  return { status: response.status, text, body: JSON.parse(text) };
}

const asJson = (body: unknown): RequestInit => ({
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

const validationFailed = (
  message: string,
  hint = 'Fix the field the message names, then retry.',
) => ({
  error: { code: 'validation_failed', message, hint, docs: `${runbook}#validation_failed` },
});

describe('token.create', () => {
  it('answers 201 with the token object and a tag-valid plaintext, stored only as its hash', async () => {
    const { status, body } = await create(asJson({ name: 'review-2026-10-20', scope: 'read' }));

    expect(status).toBe(201);
    expect(body).toEqual({
      object: 'token',
      token_id: expect.any(Number),
      name: 'review-2026-10-20',
      scope: 'read',
      created_at: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T.*Z$/),
      revoked_at: null,
      token: expect.stringMatching(/^ldg_[0-9a-f]{64}_[0-9a-f]{64}$/),
    });
    expect(hasValidTag(body.token, TEST_TOKEN_TAG_KEY)).toBe(true);

    const row = await apiTokensRepository.findById(t.db, body.token_id);
    expect(row?.tokenHash).toBe(hashApiToken(body.token));
    expect(row?.bootstrap).toBe(false);
    // No column holds the plaintext, or any part of it.
    const [random] = body.token.slice('ldg_'.length).split('_');
    for (const value of Object.values(row ?? {})) {
      expect(String(value)).not.toContain(random);
    }
  });

  it('the new token authenticates as itself, and the response held no hash', async () => {
    const { text, body } = await create(asJson({ name: 'ci.reader_1', scope: 'read' }));

    const current = await api.request('/tokens/current', { headers: bearer(body.token) });

    expect(current.status).toBe(200);
    expect(await current.json()).toMatchObject({ token_id: body.token_id, name: 'ci.reader_1' });
    expect(text).not.toContain(hashApiToken(body.token));
  });

  it('is not idempotent: the same request twice mints two tokens', async () => {
    const first = await create(asJson({ name: 'twice', scope: 'operate' }));
    const second = await create(asJson({ name: 'twice', scope: 'operate' }));

    expect([first.status, second.status]).toEqual([201, 201]);
    expect(second.body.token_id).not.toBe(first.body.token_id);
    expect(second.body.token).not.toBe(first.body.token);
  });

  it.each(['-starts-with-dash', '', 'has space', 'a'.repeat(65), 'naïve', 'semi;colon'])(
    'a bad name (%s) answers 400 validation_failed naming name, never its value',
    async (name) => {
      const { status, text, body } = await create(asJson({ name, scope: 'read' }));

      expect(status).toBe(400);
      expect(body).toEqual(
        validationFailed(
          "name must be 1 to 64 characters from A-Z, a-z, 0-9, '.', '_' and '-', starting with a letter or digit.",
        ),
      );
      if (name.length > 1) {
        expect(text).not.toContain(name);
      }
    },
  );

  it.each(['admin', 'READ', 7])(
    'a scope outside read and operate (%s) answers 400 validation_failed naming scope',
    async (scope) => {
      const { status, body } = await create(asJson({ name: 'ok', scope }));

      expect(status).toBe(400);
      expect(body).toEqual(validationFailed('scope must be read or operate.'));
    },
  );

  it.each([
    ['no body', {}],
    [
      'no Content-Type, a JSON body',
      { body: new TextEncoder().encode('{"name":"x","scope":"read"}') },
    ],
    [
      'a text/plain body',
      { headers: { 'content-type': 'text/plain' }, body: '{"name":"x","scope":"read"}' },
    ],
    ['malformed JSON', { headers: { 'content-type': 'application/json' }, body: '{"name":' }],
    ['a JSON body that is not an object', asJson(['x', 'read'])],
    ['a JSON object without name', asJson({ scope: 'read' })],
    ['a non-string name', asJson({ name: 42, scope: 'read' })],
  ] satisfies [string, RequestInit][])(
    '%s answers 400 validation_failed naming the body',
    async (_case, init) => {
      const { status, body } = await create(init);

      expect(status).toBe(400);
      expect(body).toEqual(
        validationFailed(
          'The request body must be a JSON object with name and scope fields.',
          'Send Content-Type: application/json with a JSON body.',
        ),
      );
    },
  );
});
