// The Mandatory worker failure path (pp-workflow → Test tiers; ADR-008, AWS-05): the batch response
// lists exactly the messages that failed, built from each message's own result, because an empty
// one deletes the whole batch. The others commit.
import type { IngestEnvelope } from '@ledger/core';
import { emailStateRepository, webhookEventsRepository } from '@ledger/db';
import { createTestDatabase, type TestDatabase } from '@ledger/db/testing';
import { createLogger } from '@ledger/shared';
import { FakeClock, RecordingMetrics } from '@ledger/shared/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createWorker } from './create-worker.ts';

let t: TestDatabase;

beforeAll(async () => {
  t = await createTestDatabase();
});

afterAll(async () => {
  await t.drop();
});

const subject = 'Quarterly statement for account 5521';

function body(svixId: string, emailId: string): string {
  const envelope: IngestEnvelope = {
    svixId,
    receivedAt: '2026-10-17T12:01:00.000Z',
    source: 'simulated',
    rawBody: JSON.stringify({
      type: 'email.sent',
      created_at: '2026-10-17T12:00:00.000Z',
      data: { email_id: emailId, to: ['delivered@resend.dev'], subject },
    }),
    headers: { 'svix-timestamp': '1792238460' },
  };
  return JSON.stringify(envelope);
}

describe('createWorker.processBatch (ADR-008)', () => {
  it('a batch of three with one invalid envelope lists exactly that messageId; the other two commit', async () => {
    const lines: string[] = [];
    const worker = createWorker({
      db: t.db,
      clock: new FakeClock('2026-10-17T12:01:00.000Z'),
      logger: createLogger({
        functionName: 'worker',
        stream: { write: (line) => lines.push(line) },
      }),
      metrics: new RecordingMetrics(),
      addressHashKey: new Uint8Array(32).fill(5),
    });
    // Fails `ingestEnvelopeSchema`: `receivedAt` is not an ISO 8601 date-time, and the body quotes
    // a subject that must not reach the log.
    const invalid = JSON.stringify({
      svixId: 'msg_batch_invalid',
      receivedAt: subject,
      source: 'simulated',
      rawBody: '{}',
      headers: { 'svix-timestamp': '1792238460' },
    });

    const response = await worker.processBatch([
      { messageId: 'sqs-1', body: body('msg_batch_first', 'e_batch_first') },
      { messageId: 'sqs-2', body: invalid },
      { messageId: 'sqs-3', body: body('msg_batch_third', 'e_batch_third') },
    ]);

    expect(response).toEqual({ batchItemFailures: [{ itemIdentifier: 'sqs-2' }] });
    expect(
      await webhookEventsRepository.countPresent(t.db, [
        'msg_batch_first',
        'msg_batch_invalid',
        'msg_batch_third',
      ]),
    ).toBe(2);
    expect((await emailStateRepository.get(t.db, 'e_batch_first'))?.status).toBe('sent');
    expect((await emailStateRepository.get(t.db, 'e_batch_third'))?.status).toBe('sent');

    // One constant line, the error's name only: never the body or the parse error's text.
    const failures = lines
      .map((line) => JSON.parse(line) as Record<string, unknown>)
      .filter((line) => line.message === 'worker.message_failed');
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatchObject({ level: 'error', error_name: 'ZodError' });
    expect(lines.join('\n')).not.toContain(subject);
  });
});
