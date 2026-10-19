import { errorRegistry, ingestEnvelopeSchema } from '@ledger/core';
import { type DlqPort, type DlqRawMessage, LedgerError } from '@ledger/shared';
import type { DlqMessageListRead, DlqMessageRead } from './dlq-message-response.mapper.ts';

export type ListDlqMessagesInput = { limit: number };

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;

const stringOrNull = (value: unknown): string | null => (typeof value === 'string' ? value : null);

const parseJson = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
};

// D5: the envelope's `svixId` and `receivedAt`, then exactly three payload paths, each `null` unless
// it is a string. No other path is read, and the parsed payload goes out of scope here, so an
// address, `from`, subject, tag or bounce text never reaches the mapper (api-contract.md →
// dlq.listMessages). A body that is not an envelope keeps only its receive count.
function readMessage(raw: DlqRawMessage): DlqMessageRead {
  const envelope = ingestEnvelopeSchema.safeParse(parseJson(raw.body));
  if (!envelope.success) {
    return {
      svixId: null,
      type: null,
      emailId: null,
      eventCreatedAt: null,
      enqueuedAt: null,
      receiveCount: raw.receiveCount,
    };
  }
  const payload = asRecord(parseJson(envelope.data.rawBody));
  return {
    svixId: envelope.data.svixId,
    type: stringOrNull(payload?.type),
    emailId: stringOrNull(asRecord(payload?.data)?.email_id),
    eventCreatedAt: stringOrNull(payload?.created_at),
    enqueuedAt: envelope.data.receivedAt,
    receiveCount: raw.receiveCount,
  };
}

// `dlq.listMessages` (api-contract.md, D5): a sample of the dead store plus its depth. It never
// deletes or hides a message (the port's contract), and it reads no Postgres.
export class ListDlqMessagesReader {
  readonly #dlq: DlqPort;

  constructor(dlq: DlqPort) {
    this.#dlq = dlq;
  }

  async execute(input: ListDlqMessagesInput): Promise<DlqMessageListRead> {
    // As in `GetHealthReader`: a queue read error is raised as `internal_error` with the error as
    // `cause`, so `onError` answers `500` and logs the cause's name only.
    const sample = await this.#dlq.sample(input.limit).catch((err: unknown) => {
      throw new LedgerError('internal_error', errorRegistry.internal_error.message, { cause: err });
    });
    // A visibility-0 receive can return one message twice (D5): the first of each `svix_id` stays;
    // a `null` id names no message, so each is kept.
    const seen = new Set<string>();
    const messages: DlqMessageRead[] = [];
    for (const read of sample.messages.map(readMessage)) {
      if (read.svixId !== null) {
        if (seen.has(read.svixId)) continue;
        seen.add(read.svixId);
      }
      messages.push(read);
    }
    return { depth: sample.depth, hasMore: sample.depth > messages.length, messages };
  }
}
