import type { Database } from '@ledger/db';
import {
  type BatchResponse,
  type ClockPort,
  errorFields,
  type Logger,
  type MetricsPort,
  type QueueMessage,
} from '@ledger/shared';
import { RecordEventCommand } from './record-event.command.ts';

export type WorkerDeps = {
  db: Database['db'];
  clock: ClockPort;
  logger: Logger;
  metrics: MetricsPort;
  // D2: the 32-byte address-hash key the composition root decoded.
  addressHashKey: Uint8Array;
};

export type Worker = {
  processBatch(messages: readonly QueueMessage[]): Promise<BatchResponse>;
};

// D13: an object, so slice 2 adds `resume` beside `processBatch` (ADR-015). Messages run one at a
// time on the function's single size-1 pool (ADR-005).
export function createWorker({ db, clock, logger, metrics, addressHashKey }: WorkerDeps): Worker {
  const recordEvent = new RecordEventCommand({ db, clock, metrics, addressHashKey });

  return {
    async processBatch(messages) {
      // ADR-008, AWS-05: built from each message's own result, never assumed. An id left out is
      // acknowledged, so a failure is never swallowed: it is listed and redelivered.
      const batchItemFailures: { itemIdentifier: string }[] = [];
      for (const message of messages) {
        try {
          await recordEvent.execute({ body: message.body });
        } catch (error) {
          // Name, registry code and SQLSTATE only: a parse or Postgres error can quote the row.
          logger.error('worker.message_failed', errorFields(error));
          batchItemFailures.push({ itemIdentifier: message.messageId });
        }
      }
      return { batchItemFailures };
    },
  };
}
