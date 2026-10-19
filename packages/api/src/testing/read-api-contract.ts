import {
  errorRegistry,
  hashAddress,
  type IngestEnvelope,
  maskAddress,
  maskFrom,
  maskText,
} from '@ledger/core';
import { STORAGE_LIMIT_BYTES } from '@ledger/db';
import { createTestDatabase, type TestDatabase } from '@ledger/db/testing';
import { createLedgerClient, type LedgerClient, type SdkError } from '@ledger/sdk';
import {
  type DlqPort,
  type DlqRawMessage,
  type DlqSample,
  LedgerError,
  mintApiToken,
  type RedriveStart,
} from '@ledger/shared';
import { FakeClock, FakeFunctionInvoke, RecordingMetrics } from '@ledger/shared/testing';
import { RecordEventCommand } from '@ledger/worker';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ApiDeps } from '../create-api.ts';
import { bearer, issueTestToken, TEST_TOKEN_TAG_KEY, testApiDeps } from './api-test-deps.ts';

// One way of serving the read API, built from `deps` by `make`: `apps/local` under
// `@hono/node-server`, `apps/api` through `@hono/aws-lambda` (ADR-019, D23).
export type ReadApiUnderTest = { readonly baseUrl: string; readonly close: () => Promise<void> };

const addressHashKey = new Uint8Array(32).fill(31);
const EMAIL_ID = 'e_sdk_contract';
// RS-34: Resend's test addresses only.
const DELIVERED = 'delivered@resend.dev';
const BOUNCED = 'bounced@resend.dev';
const FROM = 'Acme Billing <billing@resend.dev>';
const SUBJECT = 'Your invoice 48213 is ready';

const at = (second: number): string => new Date(Date.UTC(2026, 9, 17, 12, 0, second)).toISOString();

// One queue message as ingest enqueues it (D8, D12).
function message(svixId: string, type: string, second: number, to: readonly string[], extra = {}) {
  const envelope: IngestEnvelope = {
    svixId,
    receivedAt: '2026-10-17T12:01:00.000Z',
    source: 'simulated',
    rawBody: JSON.stringify({
      type,
      created_at: at(second),
      data: { email_id: EMAIL_ID, to, from: FROM, subject: SUBJECT, ...extra },
    }),
    headers: { 'svix-timestamp': '1792238460' },
  };
  return JSON.stringify(envelope);
}

// The registry entry as the error shape carries it; `validation_failed` names its field instead.
const registryError = (code: keyof typeof errorRegistry): SdkError => ({
  code,
  message: errorRegistry[code].message,
  hint: errorRegistry[code].hint,
  docs: errorRegistry[code].docs,
});

// `validation_failed` names its field in the message; its hint and docs are the registry's.
const validationFailed = (message: string): SdkError => ({
  code: 'validation_failed',
  message,
  hint: errorRegistry.validation_failed.hint,
  docs: errorRegistry.validation_failed.docs,
});

// The worker's `ResumeResult` on an enabled source (D16, D20).
const ALREADY_ENABLED = { outcome: 'already_enabled', state: 'enabled' } as const;

const RFC3339 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

// The DLQ port double (slice 3 D1): a dead store holding `messages` behind `depth`, whose
// `startRedrive` answers what the case scripts, or throws it, and counts the starts.
class ScriptedDlq implements DlqPort {
  messages: readonly DlqRawMessage[] = [];
  depth = 0;
  redrive: () => RedriveStart = () => ({ status: 'empty', depth: 0 });
  starts = 0;

  async sample(limit: number): Promise<DlqSample> {
    return { depth: this.depth, messages: this.messages.slice(0, limit) };
  }

  async startRedrive(): Promise<RedriveStart> {
    this.starts += 1;
    return this.redrive();
  }
}

// Neither a raw address, the raw from or subject, nor the bounce diagnostics, anywhere in the body.
function expectMasksOnly(data: unknown): void {
  const text = JSON.stringify(data);
  for (const raw of [DELIVERED, BOUNCED, 'billing@resend.dev', 'Acme Billing', SUBJECT]) {
    expect(text).not.toContain(raw);
  }
  expect(text).not.toContain('user unknown');
  expect(text).not.toContain('does not exist');
  expect(text).not.toMatch(/"(to|payload|address_hash|sticky_signal|soft_signal)"/);
}

// ADR-004's order, compared by code unit: the order `recipients` come back in.
const byHash = (a: string, b: string): number => {
  const ha = hashAddress(addressHashKey, a);
  const hb = hashAddress(addressHashKey, b);
  return ha < hb ? -1 : ha > hb ? 1 : 0;
};

// D23, ADR-011: the SDK and the read API agree on the wire, whichever way the app is served. The
// real `createApi` reads a harness clone whose rows the worker's own command committed, every call
// goes through `createLedgerClient` with a real token, so a field renamed on one side, a status the
// SDK cannot parse or a header the SDK stops sending fails here. An `int` suite: it needs Postgres.
export function readApiContract(
  name: string,
  make: (deps: ApiDeps) => Promise<ReadApiUnderTest>,
): void {
  describe(`SDK against the read API: ${name}`, () => {
    let t: TestDatabase;
    let served: ReadApiUnderTest;
    let client: LedgerClient;
    let token: string;
    let tokenId: number;
    // The only active `operate` token in this database, so revoking it is `last_operate_token`.
    let operator: LedgerClient;
    let operatorTokenId: number;
    // The worker's answer to the resume invoke, set per case (D20).
    let workerInvoke: FakeFunctionInvoke;
    // The dead store and redrive answer, set per case (slice 3 D1).
    let dlq: ScriptedDlq;

    beforeAll(async () => {
      t = await createTestDatabase();
      // Seeded through the worker's command, so the API reads exactly what the worker commits.
      const record = new RecordEventCommand({
        database: t.database,
        clock: new FakeClock('2026-10-17T12:01:00.000Z'),
        metrics: new RecordingMetrics(),
        addressHashKey,
      });
      for (const body of [
        message('msg_contract_sent', 'email.sent', 1, [DELIVERED, BOUNCED]),
        message('msg_contract_delivered', 'email.delivered', 2, [DELIVERED]),
        message('msg_contract_bounced', 'email.bounced', 3, [BOUNCED], {
          bounce: {
            type: 'Permanent',
            subType: 'General',
            message: `The recipient ${BOUNCED} does not exist.`,
            diagnosticCode: [`smtp; 550 5.1.1 <${BOUNCED}>: user unknown`],
          },
        }),
      ]) {
        await record.execute({ body });
      }
      ({ token, tokenId } = await issueTestToken(t.db, { scope: 'read', name: 'contract-reader' }));
      const operate = await issueTestToken(t.db, { scope: 'operate', name: 'contract-operator' });
      operatorTokenId = operate.tokenId;
      workerInvoke = new FakeFunctionInvoke(ALREADY_ENABLED);
      dlq = new ScriptedDlq();
      served = await make(testApiDeps(t.db, { addressHashKey, workerInvoke, dlq }));
      client = createLedgerClient({ baseUrl: served.baseUrl, token });
      operator = createLedgerClient({ baseUrl: served.baseUrl, token: operate.token });
    });

    afterAll(async () => {
      await served?.close();
      await t?.drop();
    });

    it('emails.get returns the committed email as design.md → Surfaces shapes it, masks only', async () => {
      const { data, error } = await client.emails.get(EMAIL_ID);

      expect(error).toBeNull();
      const recipients: Record<string, unknown> = {
        [DELIVERED]: {
          address_masked: maskAddress(DELIVERED),
          status: 'delivered',
          status_at: at(2),
          bounce_type: null,
          bounce_sub_type: null,
        },
        [BOUNCED]: {
          address_masked: maskAddress(BOUNCED),
          status: 'bounced',
          status_at: at(3),
          bounce_type: 'Permanent',
          bounce_sub_type: 'General',
        },
      };
      expect(data).toEqual({
        object: 'email',
        email_id: EMAIL_ID,
        status: 'bounced',
        from_masked: maskFrom(FROM),
        subject_masked: maskText(SUBJECT),
        open_count: 0,
        click_count: 0,
        first_opened_at: null,
        first_clicked_at: null,
        last_event_at: at(3),
        event_count: 3,
        recipients: [DELIVERED, BOUNCED].sort(byHash).map((address) => recipients[address]),
        timeline: [
          {
            svix_id: 'msg_contract_sent',
            type: 'email.sent',
            event_created_at: at(1),
            bounce_type: null,
            bounce_sub_type: null,
          },
          {
            svix_id: 'msg_contract_delivered',
            type: 'email.delivered',
            event_created_at: at(2),
            bounce_type: null,
            bounce_sub_type: null,
          },
          {
            svix_id: 'msg_contract_bounced',
            type: 'email.bounced',
            event_created_at: at(3),
            bounce_type: 'Permanent',
            bounce_sub_type: 'General',
          },
        ],
      });
      expectMasksOnly(data);
    });

    it('recipients.get returns the hard-bounced recipient, its address only as the mask', async () => {
      const { data, error } = await client.recipients.get(BOUNCED);

      expect(error).toBeNull();
      expect(data).toEqual({
        object: 'recipient',
        address_masked: maskAddress(BOUNCED),
        deliverability: 'hard_bounced',
        since: at(3),
        cause_email_id: EMAIL_ID,
      });
      expectMasksOnly(data);
    });

    it.each([
      ['a token no row holds', () => mintApiToken(TEST_TOKEN_TAG_KEY).token],
      ['a malformed token', () => 'local-loopback-no-auth'],
      ['a token tagged under another key', () => mintApiToken(new Uint8Array(32).fill(7)).token],
    ])(
      'emails.get and recipients.get with %s come back as error unauthorized, data null',
      async (_case, tokenOf) => {
        const stranger = createLedgerClient({ baseUrl: served.baseUrl, token: tokenOf() });

        expect(await stranger.emails.get(EMAIL_ID)).toEqual({
          data: null,
          error: registryError('unauthorized'),
        });
        expect(await stranger.recipients.get(BOUNCED)).toEqual({
          data: null,
          error: registryError('unauthorized'),
        });
      },
    );

    it('an email id no event named comes back as error email_not_found, data null', async () => {
      expect(await client.emails.get('e_sdk_contract_missing')).toEqual({
        data: null,
        error: registryError('email_not_found'),
      });
    });

    it('an address no event named comes back as error recipient_not_found, data null', async () => {
      expect(await client.recipients.get('complained@resend.dev')).toEqual({
        data: null,
        error: registryError('recipient_not_found'),
      });
    });

    it('a malformed email id and a malformed address come back as validation_failed naming the field', async () => {
      const hint = 'Fix the field the message names, then retry.';
      const docs = errorRegistry.validation_failed.docs;

      expect(await client.emails.get('bad!')).toEqual({
        data: null,
        error: {
          code: 'validation_failed',
          message: "email_id must be 1 to 128 characters from A-Z, a-z, 0-9, '.', '_' and '-'.",
          hint,
          docs,
        },
      });
      const invalidAddress = await client.recipients.get('no-at-sign');
      expect(invalidAddress).toEqual({
        data: null,
        error: {
          code: 'validation_failed',
          message: 'address must be an email address of at most 320 characters.',
          hint,
          docs,
        },
      });
      expect(JSON.stringify(invalidAddress)).not.toContain('no-at-sign');
    });

    it('an SDK pointed at a wrong base path gets route_not_found, the error a mistyped LEDGER_URL meets', async () => {
      const misdirected = createLedgerClient({ baseUrl: `${served.baseUrl}/v9`, token });

      expect(await misdirected.emails.get(EMAIL_ID)).toEqual({
        data: null,
        error: registryError('route_not_found'),
      });
      expect(await misdirected.recipients.get(BOUNCED)).toEqual({
        data: null,
        error: registryError('route_not_found'),
      });
    });

    it('any other unmatched method and path answers 404 route_not_found with a token, 401 without', async () => {
      const withToken = await fetch(`${served.baseUrl}/emails`, {
        method: 'DELETE',
        headers: bearer(token),
      });
      expect(withToken.status).toBe(404);
      expect(await withToken.json()).toEqual({ error: registryError('route_not_found') });

      const without = await fetch(`${served.baseUrl}/emails`, { method: 'DELETE' });
      expect(without.status).toBe(401);
      expect(await without.json()).toEqual({ error: registryError('unauthorized') });
    });

    // Slice 2's six operations (D19–D21, D24): each success and each error its entry names.

    it('health.get answers a read token with the queue, DLQ, event source and database', async () => {
      const { data, error } = await client.health.get();

      expect(error).toBeNull();
      expect(data).toEqual({
        object: 'health',
        queue: { visible: 0, in_flight: 0, oldest_age_seconds: null },
        dlq: { visible: 0, in_flight: 0 },
        event_source: { state: 'enabled' },
        database: {
          reachable: true,
          storage_bytes: expect.any(Number),
          storage_limit_bytes: STORAGE_LIMIT_BYTES,
        },
      });
    });

    it('every slice 2 method with a token no row holds comes back as error unauthorized, data null', async () => {
      const stranger = createLedgerClient({
        baseUrl: served.baseUrl,
        token: mintApiToken(TEST_TOKEN_TAG_KEY).token,
      });
      const unauthorized = { data: null, error: registryError('unauthorized') };

      expect(await stranger.health.get()).toEqual(unauthorized);
      expect(await stranger.worker.resumeEventSource()).toEqual(unauthorized);
      expect(await stranger.tokens.getCurrent()).toEqual(unauthorized);
      expect(await stranger.tokens.list()).toEqual(unauthorized);
      expect(await stranger.tokens.create({ name: 'nope', scope: 'read' })).toEqual(unauthorized);
      expect(await stranger.tokens.revoke(String(tokenId))).toEqual(unauthorized);
    });

    it('every operate method with a read token comes back as error forbidden, data null', async () => {
      const forbidden = { data: null, error: registryError('forbidden') };

      expect(await client.worker.resumeEventSource()).toEqual(forbidden);
      expect(await client.tokens.list()).toEqual(forbidden);
      expect(await client.tokens.create({ name: 'nope', scope: 'operate' })).toEqual(forbidden);
      expect(await client.tokens.revoke(String(operatorTokenId))).toEqual(forbidden);
    });

    it('worker.resumeEventSource returns the event source and whether it resumed', async () => {
      workerInvoke.answer = ALREADY_ENABLED;
      expect(await operator.worker.resumeEventSource()).toEqual({
        data: { object: 'event_source', state: 'enabled', resumed: false },
        error: null,
      });

      workerInvoke.answer = { outcome: 'resumed', state: 'changing' };
      try {
        expect(await operator.worker.resumeEventSource()).toEqual({
          data: { object: 'event_source', state: 'changing', resumed: true },
          error: null,
        });
      } finally {
        workerInvoke.answer = ALREADY_ENABLED;
      }
      expect(workerInvoke.payloads).toContainEqual({ ledger: 'resume-event-source' });
    });

    it('worker.resumeEventSource on a failed probe comes back as database_unavailable with the override message', async () => {
      workerInvoke.answer = { outcome: 'probe_failed', state: 'paused' };
      try {
        expect(await operator.worker.resumeEventSource()).toEqual({
          data: null,
          error: {
            ...registryError('database_unavailable'),
            message:
              'The database is unreachable or at its storage limit, so the event source stays paused.',
          },
        });
      } finally {
        workerInvoke.answer = ALREADY_ENABLED;
      }
    });

    it('tokens.getCurrent returns the calling token, never a hash', async () => {
      const { data, error } = await client.tokens.getCurrent();

      expect(error).toBeNull();
      expect(data).toEqual({
        object: 'token',
        token_id: tokenId,
        name: 'contract-reader',
        scope: 'read',
        created_at: expect.stringMatching(RFC3339),
        revoked_at: null,
      });
      expect(JSON.stringify(data)).not.toMatch(/"(token|token_hash|bootstrap)":/);
    });

    it('tokens.list returns every token newest first, and has_more when a page is short', async () => {
      const { data, error } = await operator.tokens.list({ limit: 100 });

      expect(error).toBeNull();
      expect(data?.object).toBe('list');
      expect(data?.has_more).toBe(false);
      const ids = data?.data.map((row) => row.token_id) ?? [];
      expect(ids).toEqual([...ids].sort((a, b) => b - a));
      expect(data?.data).toContainEqual({
        object: 'token',
        token_id: operatorTokenId,
        name: 'contract-operator',
        scope: 'operate',
        created_at: expect.stringMatching(RFC3339),
        revoked_at: null,
      });
      expect(ids).toContain(tokenId);
      expect(JSON.stringify(data)).not.toMatch(/"(token|token_hash|bootstrap)":/);

      const [newest = 0] = ids;
      const first = await operator.tokens.list({ limit: 1 });
      expect(first.data?.has_more).toBe(true);
      expect(first.data?.data.map((row) => row.token_id)).toEqual([newest]);
      const next = await operator.tokens.list({ limit: 100, after: newest });
      expect(next.data?.data.map((row) => row.token_id)).toEqual(ids.slice(1));
    });

    it('tokens.list with a bad limit or after comes back as validation_failed naming the field', async () => {
      expect(await operator.tokens.list({ limit: 101 })).toEqual({
        data: null,
        error: validationFailed('limit must be an integer from 1 to 100.'),
      });
      expect(await operator.tokens.list({ after: 0 })).toEqual({
        data: null,
        error: validationFailed('after must be a token id, a positive integer.'),
      });
    });

    it('tokens.create returns the token object plus its plaintext, which then authenticates as itself', async () => {
      const { data, error } = await operator.tokens.create({
        name: 'contract-created',
        scope: 'read',
      });

      expect(error).toBeNull();
      expect(data).toEqual({
        object: 'token',
        token_id: expect.any(Number),
        name: 'contract-created',
        scope: 'read',
        created_at: expect.stringMatching(RFC3339),
        revoked_at: null,
        token: expect.stringMatching(/^ldg_[0-9a-f]{64}_[0-9a-f]{64}$/),
      });
      const created = createLedgerClient({ baseUrl: served.baseUrl, token: data?.token ?? '' });
      expect((await created.tokens.getCurrent()).data?.token_id).toBe(data?.token_id);
    });

    it('tokens.create with a bad name or scope comes back as validation_failed naming the field', async () => {
      expect(await operator.tokens.create({ name: 'has space', scope: 'read' })).toEqual({
        data: null,
        error: validationFailed(
          "name must be 1 to 64 characters from A-Z, a-z, 0-9, '.', '_' and '-', starting with a letter or digit.",
        ),
      });
      // A scope the SDK's type rules out, as an untyped caller would send it.
      const scope = 'admin' as 'read';
      expect(await operator.tokens.create({ name: 'ok', scope })).toEqual({
        data: null,
        error: validationFailed('scope must be read or operate.'),
      });
    });

    it('tokens.revoke revokes a token, whose next request is unauthorized; revoking it again changes nothing', async () => {
      const minted = await operator.tokens.create({ name: 'contract-revoked', scope: 'read' });
      const id = String(minted.data?.token_id);

      const { data, error } = await operator.tokens.revoke(id);

      expect(error).toBeNull();
      expect(data).toEqual({
        object: 'token',
        token_id: minted.data?.token_id,
        name: 'contract-revoked',
        scope: 'read',
        created_at: minted.data?.created_at,
        revoked_at: expect.stringMatching(RFC3339),
      });
      const revoked = createLedgerClient({
        baseUrl: served.baseUrl,
        token: minted.data?.token ?? '',
      });
      expect(await revoked.tokens.getCurrent()).toEqual({
        data: null,
        error: registryError('unauthorized'),
      });
      expect(await operator.tokens.revoke(id)).toEqual({ data, error: null });
    });

    it('tokens.revoke comes back as token_not_found, validation_failed or last_operate_token', async () => {
      expect(await operator.tokens.revoke('999999999')).toEqual({
        data: null,
        error: registryError('token_not_found'),
      });
      expect(await operator.tokens.revoke('abc')).toEqual({
        data: null,
        error: validationFailed('token_id must be a positive integer.'),
      });
      // The operator is the only active `operate` token here.
      expect(await operator.tokens.revoke(String(operatorTokenId))).toEqual({
        data: null,
        error: registryError('last_operate_token'),
      });
      expect((await operator.tokens.getCurrent()).data?.revoked_at).toBeNull();
    });

    // Slice 3's two operations (D10): each success and each error its entry names.

    it('dlq.listMessages answers a read token with the sample, the depth and has_more, ids and counts only', async () => {
      dlq.messages = [
        {
          body: message('msg_contract_dead_1', 'email.delivered', 4, [DELIVERED]),
          receiveCount: 6,
        },
        { body: 'not an envelope', receiveCount: 7 },
        { body: message('msg_contract_dead_3', 'email.sent', 5, [BOUNCED]), receiveCount: 5 },
      ];
      dlq.depth = 3;
      try {
        const { data, error } = await client.dlq.listMessages({ limit: 2 });

        expect(error).toBeNull();
        expect(data).toEqual({
          object: 'list',
          has_more: true,
          depth: 3,
          data: [
            {
              object: 'dlq_message',
              svix_id: 'msg_contract_dead_1',
              type: 'email.delivered',
              email_id: EMAIL_ID,
              event_created_at: at(4),
              enqueued_at: '2026-10-17T12:01:00.000Z',
              receive_count: 6,
            },
            {
              object: 'dlq_message',
              svix_id: null,
              type: null,
              email_id: null,
              event_created_at: null,
              enqueued_at: null,
              receive_count: 7,
            },
          ],
        });
        expectMasksOnly(data);

        const all = await client.dlq.listMessages();
        expect(all.data?.has_more).toBe(false);
        expect(all.data?.data).toHaveLength(3);
        expectMasksOnly(all.data);
      } finally {
        dlq.messages = [];
        dlq.depth = 0;
      }
    });

    it('dlq.listMessages with a limit outside 1 to 10 comes back as validation_failed naming the field', async () => {
      const outOfRange = {
        data: null,
        error: validationFailed('limit must be an integer from 1 to 10.'),
      };

      expect(await client.dlq.listMessages({ limit: 11 })).toEqual(outOfRange);
      expect(await client.dlq.listMessages({ limit: 0 })).toEqual(outOfRange);
    });

    it('dlq.startRedrive answers started with the depth on a dead store, and empty on none', async () => {
      dlq.redrive = () => ({ status: 'started', depth: 3 });
      try {
        expect(await operator.dlq.startRedrive()).toEqual({
          data: { object: 'dlq_redrive', status: 'started', depth: 3 },
          error: null,
        });
      } finally {
        dlq.redrive = () => ({ status: 'empty', depth: 0 });
      }
      expect(await operator.dlq.startRedrive()).toEqual({
        data: { object: 'dlq_redrive', status: 'empty', depth: 0 },
        error: null,
      });
    });

    it('dlq.startRedrive while a redrive runs comes back as error redrive_in_progress, data null', async () => {
      dlq.redrive = () => {
        throw new LedgerError('redrive_in_progress', errorRegistry.redrive_in_progress.message);
      };
      try {
        expect(await operator.dlq.startRedrive()).toEqual({
          data: null,
          error: registryError('redrive_in_progress'),
        });
      } finally {
        dlq.redrive = () => ({ status: 'empty', depth: 0 });
      }
    });

    it('dlq.startRedrive with a read token comes back as error forbidden and starts no redrive', async () => {
      const before = dlq.starts;

      expect(await client.dlq.startRedrive()).toEqual({
        data: null,
        error: registryError('forbidden'),
      });
      expect(dlq.starts).toBe(before);
    });

    it('both dlq methods with a token no row holds come back as error unauthorized, data null', async () => {
      const stranger = createLedgerClient({
        baseUrl: served.baseUrl,
        token: mintApiToken(TEST_TOKEN_TAG_KEY).token,
      });
      const unauthorized = { data: null, error: registryError('unauthorized') };

      expect(await stranger.dlq.listMessages()).toEqual(unauthorized);
      expect(await stranger.dlq.startRedrive()).toEqual(unauthorized);
    });
  });
}
