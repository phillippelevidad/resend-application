// Ships 8's contract evidence (slice 1, D41): the SDK and the read API agree on the wire. The real
// `createApi` is served by `@hono/node-server` on a loopback port over a harness database whose rows
// the worker's own command committed, and every call goes through `createLedgerClient`, so a field
// renamed on one side, a status the SDK cannot parse or a header the SDK stops sending fails here.
import type { AddressInfo } from 'node:net';
import { type ServerType, serve } from '@hono/node-server';
import { createApi } from '@ledger/api';
import {
  errorRegistry,
  hashAddress,
  type IngestEnvelope,
  maskAddress,
  maskFrom,
  maskText,
} from '@ledger/core';
import { createTestDatabase, type TestDatabase } from '@ledger/db/testing';
import { createLedgerClient, type LedgerClient, type SdkError } from '@ledger/sdk';
import { createLogger } from '@ledger/shared';
import { FakeClock, RecordingMetrics } from '@ledger/shared/testing';
import { RecordEventCommand } from '@ledger/worker';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const addressHashKey = new Uint8Array(32).fill(31);
const TOKEN = 'local-loopback-no-auth';
const EMAIL_ID = 'e_sdk_contract';
// RS-34: Resend's test addresses only.
const DELIVERED = 'delivered@resend.dev';
const BOUNCED = 'bounced@resend.dev';
const FROM = 'Acme Billing <billing@resend.dev>';
const SUBJECT = 'Your invoice 48213 is ready';

let t: TestDatabase;
let server: ServerType;
let baseUrl: string;
let client: LedgerClient;
// The `Authorization` header of every request the server answered, in order.
const authorizations: (string | null)[] = [];

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

beforeAll(async () => {
  t = await createTestDatabase();

  // Seeded through the worker's command, so the API reads exactly what the worker commits.
  const record = new RecordEventCommand({
    db: t.db,
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

  const api = createApi({
    db: t.db,
    logger: createLogger({ functionName: 'api', stream: { write: () => {} } }),
    addressHashKey,
    requestId: () => 'req-sdk-contract',
  });
  // The read API alone: the contract is the SDK's against `createApi`, not the ingest mount (D32).
  const observed = (request: Request): Response | Promise<Response> => {
    authorizations.push(request.headers.get('authorization'));
    return api.fetch(request);
  };
  const port = await new Promise<number>((resolve) => {
    server = serve({ fetch: observed, hostname: '127.0.0.1', port: 0 }, (info: AddressInfo) =>
      resolve(info.port),
    );
  });
  baseUrl = `http://127.0.0.1:${port}`;
  client = createLedgerClient({ baseUrl, token: TOKEN });
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await t.drop();
});

// The registry entry as the error shape carries it; `validation_failed` names its field instead.
const registryError = (code: keyof typeof errorRegistry): SdkError => ({
  code,
  message: errorRegistry[code].message,
  hint: errorRegistry[code].hint,
  docs: errorRegistry[code].docs,
});

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

describe('SDK against the read API (D41)', () => {
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

  it('every SDK request carries the bearer token, though the loopback server skips the check', async () => {
    authorizations.length = 0;

    await client.emails.get(EMAIL_ID);
    await client.recipients.get(DELIVERED);

    expect(authorizations).toEqual([`Bearer ${TOKEN}`, `Bearer ${TOKEN}`]);
  });

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
    const misdirected = createLedgerClient({ baseUrl: `${baseUrl}/v9`, token: TOKEN });

    expect(await misdirected.emails.get(EMAIL_ID)).toEqual({
      data: null,
      error: registryError('route_not_found'),
    });
    expect(await misdirected.recipients.get(BOUNCED)).toEqual({
      data: null,
      error: registryError('route_not_found'),
    });
  });

  it('any other unmatched method and path answers 404 route_not_found in the one error shape', async () => {
    const response = await fetch(`${baseUrl}/emails`, { method: 'DELETE' });

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: registryError('route_not_found') });
  });
});
