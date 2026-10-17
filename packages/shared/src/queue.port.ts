import type { IngestEnvelope } from '@ledger/core';

// D8, D13: a message as the consumer receives it. `body` is the envelope serialized as SQS holds it;
// `messageId` is the transport's id, never a dedupe key (AWS-21: a redrive changes it).
export type QueueMessage = { readonly messageId: string; readonly body: string };

// ADR-008, AWS-05: the ids of exactly the messages that failed. An id left out is acknowledged.
export type BatchResponse = {
  readonly batchItemFailures: readonly { readonly itemIdentifier: string }[];
};

// The worker's `processBatch` (D13). Delivery is at-least-once, in no order (ADR-002).
export type QueueConsumer = (messages: QueueMessage[]) => Promise<BatchResponse>;

// D7, D8: what ingest needs. Each runtime's consumer side is its own: the in-process adapter's
// `start` locally (slice 1), the event source mapping on AWS (slice 2).
export interface QueuePort {
  enqueue(envelope: IngestEnvelope): Promise<void>;
}
