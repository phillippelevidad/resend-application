import { SendMessageCommand, type SQSClient } from '@aws-sdk/client-sqs';
import type { IngestEnvelope } from '@ledger/core';
import type { QueuePort } from '@ledger/shared';

export type SqsQueueAdapterDeps = { client: SQSClient; queueUrl: string };

// D1, D26: ingest's queue on AWS. The envelope travels as the message body, JSON, exactly as the
// in-process queue carries it. `enqueue` resolves only once `SendMessage` returned, and a failed send
// rejects with the SDK's own error (its name is what ingest logs): ingest answers `200` only after
// the enqueue resolved and `503` when it rejected (ADR-001). No dedupe id: SQS standard is
// at-least-once and the worker dedupes on `svix_id` (ADR-002, ADR-004).
export class SqsQueueAdapter implements QueuePort {
  readonly #client: SQSClient;
  readonly #queueUrl: string;

  constructor({ client, queueUrl }: SqsQueueAdapterDeps) {
    this.#client = client;
    this.#queueUrl = queueUrl;
  }

  async enqueue(envelope: IngestEnvelope): Promise<void> {
    await this.#client.send(
      new SendMessageCommand({ QueueUrl: this.#queueUrl, MessageBody: JSON.stringify(envelope) }),
    );
  }
}
