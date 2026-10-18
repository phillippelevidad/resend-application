// Ships 3, 4 and 6 (slice 1), ADR-004's evidence on real Postgres, as the runtime role: one ledger
// row per `svix_id` (sequential, concurrent, redelivered under a new message id), all or nothing per
// message, unstorable characters sanitized, unprojectable events stored raw, projections equal to
// the projection of the stored events in any arrival order, and the lock order that keeps two
// emails sharing recipients deadlock-free. Concurrency is interleaved by polling
// `pg_stat_activity`, never by sleeping (pp-testing → Faults and concurrency).
import {
  type EmailRecipientState,
  hashAddress,
  type IngestEnvelope,
  projectEmail,
  projectRecipient,
} from '@ledger/core';
import {
  createDatabase,
  type Database,
  type EmailRecipientRow,
  emailRecipientsRepository,
  emailStateRepository,
  recipientStateRepository,
  STORAGE_LIMIT_BYTES,
  type Transaction,
  webhookEventsRepository,
} from '@ledger/db';
import { createTestDatabase, sqlStateOf, type TestDatabase } from '@ledger/db/testing';
import type { Logger } from '@ledger/shared';
import { FakeClock, FakeEventSourceControl, RecordingMetrics } from '@ledger/shared/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createWorker } from './create-worker.ts';
import { RecordEventCommand } from './record-event.command.ts';

const key = new Uint8Array(32).fill(11);
const clock = new FakeClock('2026-10-17T12:01:00.000Z');
// Every envelope was received 2.5 s before the clock's instant, so the lag is exact.
const receivedAt = '2026-10-17T12:00:57.500Z';
const expectedLagMs = 2_500;

const silentLogger: Logger = { info: () => {}, warn: () => {}, error: () => {} };

let t: TestDatabase;
// Two size-1 pools as the runtime role, one per simulated worker container (ADR-005), each named so
// `pg_stat_activity` tells their sessions apart.
let workerA: Database;
let workerB: Database;

beforeAll(async () => {
  t = await createTestDatabase();
  workerA = createDatabase({ url: named(t.runtimeUrl, 'worker_a'), max: 1, logger: silentLogger });
  workerB = createDatabase({ url: named(t.runtimeUrl, 'worker_b'), max: 1, logger: silentLogger });
});

afterAll(async () => {
  await Promise.all([workerA.pool.end(), workerB.pool.end()]);
  await t.drop();
});

function named(url: string, applicationName: string): string {
  const parsed = new URL(url);
  parsed.searchParams.set('application_name', applicationName);
  return parsed.toString();
}

// Fresh ids per test: tests in this file share one clone and assert only on their own ids.
let lastId = 0;
const fresh = (label: string): string => {
  lastId += 1;
  return `${label}_${lastId}`;
};
const address = (label: string): string => `delivered+${fresh(label)}@resend.dev`;

const at = (second: number): string => new Date(Date.UTC(2026, 9, 17, 12, 0, second)).toISOString();

type Payload = unknown;

function emailEvent(
  type: string,
  emailId: string,
  to: readonly string[],
  second: number,
  data: Record<string, unknown> = {},
): Payload {
  return {
    type,
    created_at: at(second),
    data: {
      email_id: emailId,
      to,
      from: 'Ledger Test <delivered@resend.dev>',
      subject: 'Order confirmation',
      ...data,
    },
  };
}

// The message body as the queue holds it (D8, D12).
function body(svixId: string, payload: Payload): string {
  const envelope: IngestEnvelope = {
    svixId,
    receivedAt,
    source: 'simulated',
    rawBody: JSON.stringify(payload),
    headers: { 'svix-timestamp': '1792238457' },
  };
  return JSON.stringify(envelope);
}

function command(metrics: RecordingMetrics, database: Database = t.database): RecordEventCommand {
  return new RecordEventCommand({ database, clock, metrics, addressHashKey: key });
}

const metricLines = (metrics: RecordingMetrics, name: string) =>
  metrics.recorded.filter((metric) => metric.name === name);

// Test-generated ids only: a quote in one would be a bug in the test, so it fails loudly.
function literal(value: string): string {
  if (!/^[A-Za-z0-9_.+@-]+$/.test(value)) {
    throw new TypeError('Unsafe literal in a test query.');
  }
  return `'${value}'`;
}

type StoredEvent = {
  type: string | null;
  event_created_at: Date | null;
  email_id: string | null;
  to_hashes: string[] | null;
  payload: unknown;
  payload_kind: string;
};

// Read as the runtime role (pp-testing: never assert through the owner).
async function storedEvents(svixId: string): Promise<StoredEvent[]> {
  const result = await t.db.execute<StoredEvent>(
    `select type, event_created_at, email_id, to_hashes, payload, jsonb_typeof(payload) as payload_kind
       from webhook_events where svix_id = ${literal(svixId)}`,
  );
  return result.rows;
}

const toRecipientState = (row: EmailRecipientRow): EmailRecipientState => ({
  emailId: row.emailId,
  recipientKey: row.addressHash,
  addressMasked: row.addressMasked,
  status: row.status,
  statusAt: row.statusAt,
  bounceType: row.bounceType,
  bounceSubType: row.bounceSubType,
  stickySignal: row.stickySignal,
  stickySignalAt: row.stickySignalAt,
  stickySignalSvixId: row.stickySignalSvixId,
  softSignal: row.softSignal,
  softSignalAt: row.softSignalAt,
  softSignalSvixId: row.softSignalSvixId,
});

// The oracle (ADR-003): every projection row of the email equals the slice 0 functions applied to
// the stored events, and each of its recipients' `recipient_state` equals `projectRecipient` over
// every `email_recipients` row for the hash.
async function expectProjectionOfStoredEvents(emailId: string): Promise<void> {
  const events = await webhookEventsRepository.loadForEmail(t.db, emailId);
  const expected = projectEmail(emailId, events);
  const { recipients, ...emailColumns } = expected;
  expect(await emailStateRepository.get(t.db, emailId)).toMatchObject(emailColumns);
  const stored = await emailRecipientsRepository.listByEmail(t.db, emailId);
  expect(stored.map(toRecipientState)).toEqual(recipients);
  for (const { recipientKey } of recipients) {
    const rows = await emailRecipientsRepository.listByAddressHash(t.db, recipientKey);
    const { recipientKey: addressHash, ...recipientColumns } = projectRecipient(
      recipientKey,
      rows.map(toRecipientState),
    );
    expect(await recipientStateRepository.get(t.db, addressHash)).toMatchObject(recipientColumns);
  }
}

// Every projection row an email and its recipients own, whole, `updated_at` included.
async function projectionRows(emailId: string, hashes: readonly string[]) {
  return {
    email: await emailStateRepository.get(t.db, emailId),
    recipients: await emailRecipientsRepository.listByEmail(t.db, emailId),
    recipientStates: await recipientStateRepository.listByAddressHashes(t.db, hashes),
  };
}

type Gate = { open: () => void; opened: Promise<void> };

function gate(): Gate {
  let open: () => void = () => {};
  const opened = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { open, opened };
}

const released = Symbol('released');

// Runs `work` in an owner transaction and holds it open until the returned release is called, then
// rolls it back. The owner only injects faults and holds locks (pp-testing → harness).
async function holdInOwnerTransaction(
  work: (tx: Transaction) => Promise<unknown>,
): Promise<() => Promise<void>> {
  const held = gate();
  const release = gate();
  const done = t.owner
    .transaction(async (tx) => {
      await work(tx);
      held.open();
      await release.opened;
      throw released;
    })
    .catch((error: unknown) => {
      if (error !== released) throw error;
    });
  await Promise.race([held.opened, done]);
  return async () => {
    release.open();
    await done;
  };
}

// Polls, with a bound, until the named session waits on a heavyweight lock.
async function waitUntilBlockedOnLock(applicationName: string): Promise<void> {
  for (let attempt = 0; attempt < 2_000; attempt += 1) {
    const { rows } = await t.owner.execute<{ wait_event_type: string | null }>(
      `select wait_event_type from pg_stat_activity where application_name = ${literal(applicationName)}`,
    );
    if (rows.some((row) => row.wait_event_type === 'Lock')) {
      return;
    }
  }
  throw new TypeError(`${applicationName} never waited on a lock.`);
}

describe('one ledger row per event (ADR-004)', () => {
  it('a sequential duplicate leaves one row, unchanged projections and one worker.duplicates', async () => {
    const emailId = fresh('e_seq_dup');
    const to = [address('seq_dup')];
    const svixId = fresh('msg_seq_dup');
    const message = body(svixId, emailEvent('email.sent', emailId, to, 1));
    const metrics = new RecordingMetrics();

    expect(await command(metrics).execute({ body: message })).toBe('projected');
    const hashes = to.map((a) => hashAddress(key, a));
    const afterFirst = await projectionRows(emailId, hashes);
    expect(await command(metrics).execute({ body: message })).toBe('duplicate');

    expect(await webhookEventsRepository.countPresent(t.db, [svixId])).toBe(1);
    expect(await projectionRows(emailId, hashes)).toEqual(afterFirst);
    expect(metricLines(metrics, 'worker.duplicates')).toEqual([
      { kind: 'count', name: 'worker.duplicates', value: 1, fields: { svix_id: svixId } },
    ]);
  });

  it('every committed message emits one worker.processing_lag in ms: projected, duplicate, unprojectable', async () => {
    const emailId = fresh('e_lag');
    const projected = fresh('msg_lag');
    const unknown = fresh('msg_lag_unknown');
    const metrics = new RecordingMetrics();
    const sent = body(projected, emailEvent('email.sent', emailId, [address('lag')], 1));

    await command(metrics).execute({ body: sent });
    await command(metrics).execute({ body: sent });
    await command(metrics).execute({
      body: body(unknown, { type: 'email.teleported', created_at: at(2) }),
    });

    expect(metricLines(metrics, 'worker.processing_lag')).toEqual([
      {
        kind: 'duration',
        name: 'worker.processing_lag',
        value: expectedLagMs,
        fields: { svix_id: projected },
      },
      {
        kind: 'duration',
        name: 'worker.processing_lag',
        value: expectedLagMs,
        fields: { svix_id: projected },
      },
      {
        kind: 'duration',
        name: 'worker.processing_lag',
        value: expectedLagMs,
        fields: { svix_id: unknown },
      },
    ]);
  });

  it('two concurrent copies of one svix_id leave one row; the second commits as a duplicate', async () => {
    const emailId = fresh('e_conc_dup');
    const to = [address('conc_dup')];
    // Pre-seed the email, so its `email_state` row exists for the owner to lock.
    await command(new RecordingMetrics()).execute({
      body: body(fresh('msg_conc_seed'), emailEvent('email.sent', emailId, to, 1)),
    });
    const svixId = fresh('msg_conc_dup');
    const message = body(svixId, emailEvent('email.delivered', emailId, to, 2));
    const metricsA = new RecordingMetrics();
    const metricsB = new RecordingMetrics();

    // A inserts its ledger row, then waits on the email lock the owner holds.
    const release = await holdInOwnerTransaction((tx) =>
      emailStateRepository.lockEmail(tx, emailId),
    );
    const first = command(metricsA, workerA).execute({ body: message });
    await waitUntilBlockedOnLock('worker_a');
    // B waits on A's uncommitted `svix_id`.
    const second = command(metricsB, workerB).execute({ body: message });
    await waitUntilBlockedOnLock('worker_b');
    await release();

    expect(await Promise.all([first, second])).toEqual(['projected', 'duplicate']);
    expect(await webhookEventsRepository.countPresent(t.db, [svixId])).toBe(1);
    expect(metricLines(metricsB, 'worker.duplicates')).toHaveLength(1);
    expect(metricLines(metricsA, 'worker.duplicates')).toHaveLength(0);
    await expectProjectionOfStoredEvents(emailId);
  });

  it('the same svix_id under a new messageId commits as a duplicate and changes no projection (AWS-21)', async () => {
    const emailId = fresh('e_redrive');
    const to = [address('redrive')];
    const hashes = to.map((a) => hashAddress(key, a));
    const svixId = fresh('msg_redrive');
    const message = body(
      svixId,
      emailEvent('email.bounced', emailId, to, 3, { bounce: { type: 'Permanent' } }),
    );
    const metrics = new RecordingMetrics();
    const worker = createWorker({
      database: t.database,
      eventSource: new FakeEventSourceControl(),
      storageLimitBytes: STORAGE_LIMIT_BYTES,
      clock,
      logger: silentLogger,
      metrics,
      addressHashKey: key,
    });

    expect(await worker.processBatch([{ messageId: 'sqs-1', body: message }])).toEqual({
      batchItemFailures: [],
    });
    const afterFirst = await projectionRows(emailId, hashes);
    expect(await worker.processBatch([{ messageId: 'sqs-redriven-2', body: message }])).toEqual({
      batchItemFailures: [],
    });

    expect(await webhookEventsRepository.countPresent(t.db, [svixId])).toBe(1);
    expect(await projectionRows(emailId, hashes)).toEqual(afterFirst);
    expect(metricLines(metrics, 'worker.duplicates')).toHaveLength(1);
  });
});

describe('all or nothing per message (ADR-004)', () => {
  it('a fault after the ledger insert commits nothing; the redelivery commits one row of everything', async () => {
    const emailId = fresh('e_fault');
    const to = [address('fault_a'), address('fault_b')];
    const hashes = to.map((a) => hashAddress(key, a));
    const svixId = fresh('msg_fault');
    const message = body(svixId, emailEvent('email.sent', emailId, to, 1));

    // Rejects every new `email_state` row, leaving existing ones alone.
    await t.owner.execute(
      'alter table email_state add constraint test_fault check (false) not valid',
    );
    try {
      expect(await sqlStateOf(command(new RecordingMetrics()).execute({ body: message }))).toBe(
        '23514',
      );
      expect(await webhookEventsRepository.countPresent(t.db, [svixId])).toBe(0);
      expect(await projectionRows(emailId, hashes)).toEqual({
        email: undefined,
        recipients: [],
        recipientStates: [],
      });
    } finally {
      await t.owner.execute('alter table email_state drop constraint test_fault');
    }

    expect(await command(new RecordingMetrics()).execute({ body: message })).toBe('projected');
    expect(await webhookEventsRepository.countPresent(t.db, [svixId])).toBe(1);
    const rows = await projectionRows(emailId, hashes);
    expect(rows.email).toBeDefined();
    expect(rows.recipients).toHaveLength(2);
    expect(rows.recipientStates).toHaveLength(2);
    await expectProjectionOfStoredEvents(emailId);
  });
});

describe('unstorable characters never dead-letter an event (D3)', () => {
  it('a NUL in the subject is stored as U+FFFD, projected, and counted once', async () => {
    const emailId = fresh('e_nul');
    const svixId = fresh('msg_nul');
    const metrics = new RecordingMetrics();
    const payload = emailEvent('email.sent', emailId, [address('nul')], 1, {
      subject: 'Order\u0000 confirmation',
    });

    expect(await command(metrics).execute({ body: body(svixId, payload) })).toBe('projected');

    // U+FFFD, written as the literal character (Biome rewrites the escape).
    expect(await storedEvents(svixId)).toMatchObject([
      { payload: { data: { subject: 'Order� confirmation' } } },
    ]);
    const state = await emailStateRepository.get(t.db, emailId);
    expect(state?.status).toBe('sent');
    expect(state?.subjectMasked).not.toBeNull();
    expect(metricLines(metrics, 'worker.payload_sanitized')).toEqual([
      { kind: 'count', name: 'worker.payload_sanitized', value: 1, fields: { svix_id: svixId } },
    ]);
    await expectProjectionOfStoredEvents(emailId);
  });

  it('a lone surrogate in a tag value is stored as U+FFFD and commits on its first receive', async () => {
    const emailId = fresh('e_surrogate');
    const svixId = fresh('msg_surrogate');
    const metrics = new RecordingMetrics();
    const worker = createWorker({
      database: t.database,
      eventSource: new FakeEventSourceControl(),
      storageLimitBytes: STORAGE_LIMIT_BYTES,
      clock,
      logger: silentLogger,
      metrics,
      addressHashKey: key,
    });
    const payload = emailEvent('email.delivered', emailId, [address('surrogate')], 2, {
      tags: { campaign: 'spring\uD800' },
    });

    expect(
      await worker.processBatch([{ messageId: 'sqs-1', body: body(svixId, payload) }]),
    ).toEqual({ batchItemFailures: [] });

    expect(await storedEvents(svixId)).toMatchObject([
      { payload: { data: { tags: { campaign: 'spring�' } } } },
    ]);
    expect((await emailStateRepository.get(t.db, emailId))?.status).toBe('delivered');
    expect(metricLines(metrics, 'worker.payload_sanitized')).toHaveLength(1);
  });
});

describe('unprojectable events are stored raw (ADR-004, D19)', () => {
  const recipient = 'delivered+unprojectable@resend.dev';
  const cases: [string, (emailId: string) => Payload, Partial<StoredEvent>][] = [
    [
      'an unknown type',
      (emailId) => emailEvent('email.teleported', emailId, [recipient], 1),
      { type: 'email.teleported', email_id: null, to_hashes: null },
    ],
    [
      'a non-email type (contact.created)',
      (emailId) => ({
        type: 'contact.created',
        created_at: at(1),
        data: { id: emailId, email: recipient, first_name: 'Test' },
      }),
      { type: 'contact.created', email_id: null, to_hashes: null },
    ],
    [
      'an inbound email (email.received)',
      (emailId) => emailEvent('email.received', emailId, [recipient], 1),
      { type: 'email.received', email_id: null, to_hashes: null },
    ],
    [
      'a schema-failing outbound event (email.delivered without data.email_id)',
      () => ({ type: 'email.delivered', created_at: at(1), data: { to: [recipient] } }),
      { type: 'email.delivered', email_id: null, to_hashes: [hashAddress(key, recipient)] },
    ],
    [
      'a JSON array payload',
      () => [{ type: 'email.sent' }],
      {
        type: null,
        event_created_at: null,
        email_id: null,
        to_hashes: null,
        payload_kind: 'array',
      },
    ],
    [
      'a JSON null payload',
      () => null,
      { type: null, event_created_at: null, email_id: null, to_hashes: null, payload_kind: 'null' },
    ],
  ];

  it.each(cases)(
    '%s is stored unchanged with no projection row and one projection.unknown_event_type',
    async (_label, payloadFor, columns) => {
      const emailId = fresh('e_unprojectable');
      const svixId = fresh('msg_unprojectable');
      const payload = payloadFor(emailId);
      const metrics = new RecordingMetrics();
      const worker = createWorker({
        database: t.database,
        eventSource: new FakeEventSourceControl(),
        storageLimitBytes: STORAGE_LIMIT_BYTES,
        clock,
        logger: silentLogger,
        metrics,
        addressHashKey: key,
      });

      // Committed on its first receive: never redelivered, never on the dead list.
      expect(
        await worker.processBatch([{ messageId: 'sqs-1', body: body(svixId, payload) }]),
      ).toEqual({ batchItemFailures: [] });

      const stored = await storedEvents(svixId);
      expect(stored).toHaveLength(1);
      expect(stored[0]).toMatchObject({ ...columns, payload });
      expect(await projectionRows(emailId, [hashAddress(key, recipient)])).toEqual({
        email: undefined,
        recipients: [],
        recipientStates: [],
      });
      const type = typeof columns.type === 'string' ? columns.type : undefined;
      expect(metricLines(metrics, 'projection.unknown_event_type')).toEqual([
        {
          kind: 'count',
          name: 'projection.unknown_event_type',
          value: 1,
          fields: { svix_id: svixId, type },
        },
      ]);
    },
  );
});

describe('projections equal the event set (ADR-003)', () => {
  it('out-of-order arrival yields the projection of the stored events', async () => {
    const emailId = fresh('e_order');
    const to = [address('order_a'), address('order_b')];
    const sent = body(fresh('msg_order_sent'), emailEvent('email.sent', emailId, to, 1));
    const delivered = body(
      fresh('msg_order_delivered'),
      emailEvent('email.delivered', emailId, to, 2),
    );
    const bounced = body(
      fresh('msg_order_bounced'),
      emailEvent('email.bounced', emailId, [to[1] ?? ''], 3, {
        bounce: { type: 'Permanent', subType: 'General' },
      }),
    );

    for (const message of [bounced, sent, delivered]) {
      expect(await command(new RecordingMetrics()).execute({ body: message })).toBe('projected');
      await expectProjectionOfStoredEvents(emailId);
    }

    const state = await emailStateRepository.get(t.db, emailId);
    expect(state).toMatchObject({ status: 'bounced', eventCount: 3, lastEventAt: new Date(at(3)) });
    const bouncedHash = hashAddress(key, to[1] ?? '');
    expect(await recipientStateRepository.get(t.db, bouncedHash)).toMatchObject({
      deliverability: 'hard_bounced',
      since: new Date(at(3)),
      causeEmailId: emailId,
    });
    expect(await recipientStateRepository.get(t.db, hashAddress(key, to[0] ?? ''))).toMatchObject({
      deliverability: 'ok',
      since: new Date(at(2)),
    });
  });

  it("an event naming one recipient recomputes that recipient only; the other's row is unchanged (RS-27)", async () => {
    const emailId = fresh('e_one_named');
    const named = address('one_named');
    const other = address('one_other');
    await command(new RecordingMetrics()).execute({
      body: body(fresh('msg_one_sent'), emailEvent('email.sent', emailId, [named, other], 1)),
    });
    const otherBefore = await recipientStateRepository.get(t.db, hashAddress(key, other));

    await command(new RecordingMetrics()).execute({
      body: body(fresh('msg_one_delivered'), emailEvent('email.delivered', emailId, [named], 2)),
    });

    expect(await recipientStateRepository.get(t.db, hashAddress(key, other))).toEqual(otherBefore);
    expect(await recipientStateRepository.get(t.db, hashAddress(key, named))).toMatchObject({
      deliverability: 'ok',
      since: new Date(at(2)),
      causeEmailId: emailId,
    });
    await expectProjectionOfStoredEvents(emailId);
  });
});

describe('lock order prevents deadlock (ADR-004)', () => {
  type Side = { database: Database; name: string };

  // `held` is named only by the first email and sorts after both shared recipients, so in sorted
  // order the first message takes both shared rows, then waits on the owner's uncommitted `held`
  // row: it holds its transaction after locking. Without the sort, it takes `p`, waits on `held`
  // while the second takes `q`, and the two close a cycle once the owner lets go.
  async function interleave(first: Side, second: Side): Promise<void> {
    const p = address('lock_p');
    const q = address('lock_q');
    const shared = [hashAddress(key, p), hashAddress(key, q)];
    let held = address('lock_held');
    while (shared.some((hash) => hashAddress(key, held) <= hash)) {
      held = address('lock_held');
    }
    const firstEmail = fresh('e_lock_first');
    const secondEmail = fresh('e_lock_second');
    const firstMessage = body(
      fresh('msg_lock_first'),
      emailEvent('email.sent', firstEmail, [p, held, q], 1),
    );
    const secondMessage = body(
      fresh('msg_lock_second'),
      emailEvent('email.sent', secondEmail, [q, p], 1),
    );

    const release = await holdInOwnerTransaction((tx) =>
      recipientStateRepository.createIfAbsent(tx, [
        { addressHash: hashAddress(key, held), addressMasked: 'd***', deliverability: 'ok' },
      ]),
    );
    const firstRun = command(new RecordingMetrics(), first.database).execute({
      body: firstMessage,
    });
    await waitUntilBlockedOnLock(first.name);
    const secondRun = command(new RecordingMetrics(), second.database).execute({
      body: secondMessage,
    });
    await waitUntilBlockedOnLock(second.name);
    await release();

    expect(await Promise.all([firstRun, secondRun])).toEqual(['projected', 'projected']);
    await expectProjectionOfStoredEvents(firstEmail);
    await expectProjectionOfStoredEvents(secondEmail);
  }

  it('two emails sharing recipients in opposite data.to order commit when A holds and B waits', async () => {
    await interleave(
      { database: workerA, name: 'worker_a' },
      { database: workerB, name: 'worker_b' },
    );
  });

  it('two emails sharing recipients in opposite data.to order commit when B holds and A waits', async () => {
    await interleave(
      { database: workerB, name: 'worker_b' },
      { database: workerA, name: 'worker_a' },
    );
  });
});
