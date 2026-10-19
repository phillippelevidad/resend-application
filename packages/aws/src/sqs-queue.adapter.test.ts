// D1, D26: ingest's SQS queue over a stubbed client. The command sent is the consequence at this
// seam; a failed send rejects with the SDK's error, unchanged. Error names from the SendMessage API
// Reference (https://docs.aws.amazon.com/AWSSimpleQueueService/latest/APIReference/API_SendMessage.html#API_SendMessage_Errors).
import { QueueDoesNotExist, RequestThrottled, type SQSClient } from '@aws-sdk/client-sqs';
import type { IngestEnvelope } from '@ledger/core';
import { queuePortContract } from '@ledger/shared/testing';
import { describe, expect, it } from 'vitest';
import { SqsQueueAdapter } from './sqs-queue.adapter.ts';
import { StubClient } from './testing/stub-client.ts';

const queueUrl = 'https://sqs.us-east-2.amazonaws.com/000000000000/LedgerApp-source';

const envelope = (svixId: string): IngestEnvelope => ({
  svixId,
  receivedAt: '2026-10-17T12:00:00.000Z',
  source: 'live',
  rawBody: '{"type":"email.sent","created_at":"2026-10-17T12:00:00.000Z","data":{}}',
  headers: { 'svix-timestamp': '1792238400' },
});

const metadata = { $metadata: {} };

describe('SqsQueueAdapter', () => {
  it('sends one SendMessage to its queue, the envelope JSON as the body', async () => {
    const stub = new StubClient().answer('SendMessage', () => ({ MessageId: 'm-1', ...metadata }));
    const queue = new SqsQueueAdapter({ client: stub.as<SQSClient>(), queueUrl });

    await queue.enqueue(envelope('msg_sqs_sent'));

    expect(stub.sent).toEqual([
      {
        name: 'SendMessage',
        input: { QueueUrl: queueUrl, MessageBody: JSON.stringify(envelope('msg_sqs_sent')) },
      },
    ]);
  });

  it.each([
    ['QueueDoesNotExist', () => new QueueDoesNotExist({ message: 'gone', ...metadata })],
    ['RequestThrottled', () => new RequestThrottled({ message: 'slow down', ...metadata })],
  ])('rejects with the SDK error unchanged when SendMessage fails with %s', async (name, error) => {
    const stub = new StubClient().answer('SendMessage', () => {
      throw error();
    });
    const queue = new SqsQueueAdapter({ client: stub.as<SQSClient>(), queueUrl });

    const failure = await queue.enqueue(envelope('msg_sqs_failed')).catch((caught) => caught);

    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).name).toBe(name);
  });
});

queuePortContract('SqsQueueAdapter', () => {
  const bodies: string[] = [];
  let failing = false;
  const stub = new StubClient().answer('SendMessage', (input) => {
    if (failing) throw new RequestThrottled({ message: 'slow down', ...metadata });
    bodies.push(input.MessageBody as string);
    return { MessageId: `m-${bodies.length}`, ...metadata };
  });
  return {
    port: new SqsQueueAdapter({ client: stub.as<SQSClient>(), queueUrl }),
    failSends: () => {
      failing = true;
    },
    accepted: async () => [...bodies],
  };
});
