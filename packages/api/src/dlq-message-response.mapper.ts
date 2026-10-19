import type { DlqMessageListResponse, DlqMessageResponse } from './dlq-message-response.schema.ts';

// What `ListDlqMessagesReader` hands the mapper: the three payload paths it read and the envelope's
// two fields, never the parsed payload (D5), so no mapper can reach an address or a subject.
export type DlqMessageRead = {
  svixId: string | null;
  type: string | null;
  emailId: string | null;
  eventCreatedAt: string | null;
  enqueuedAt: string | null;
  receiveCount: number;
};

export type DlqMessageListRead = { depth: number; hasMore: boolean; messages: DlqMessageRead[] };

// `dlq.listMessages`'s one mapper (pp-backend → Mappers): every wire field picked by name.
export function dlqMessageResponseMapper(read: DlqMessageRead): DlqMessageResponse {
  return {
    object: 'dlq_message',
    svix_id: read.svixId,
    type: read.type,
    email_id: read.emailId,
    event_created_at: read.eventCreatedAt,
    enqueued_at: read.enqueuedAt,
    receive_count: read.receiveCount,
  };
}

// The list envelope with the total `depth` beside it (D5).
export function dlqMessageListResponseMapper(read: DlqMessageListRead): DlqMessageListResponse {
  return {
    object: 'list',
    has_more: read.hasMore,
    depth: read.depth,
    data: read.messages.map(dlqMessageResponseMapper),
  };
}
