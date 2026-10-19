import { z } from '@hono/zod-openapi';

// One dead message (design.md → D5): ids, the event type, two timestamps and the receive count,
// never an address, subject, tag, bounce text or payload, raw or masked. Every field but
// `receive_count` is `null` when the body is not an ingest envelope or the payload path is not a
// string.
export const dlqMessageResponseSchema = z
  .object({
    object: z.literal('dlq_message'),
    svix_id: z.string().nullable(),
    type: z.string().nullable(),
    email_id: z.string().nullable(),
    // The payload's `created_at` as it holds it, unparsed.
    event_created_at: z.string().nullable(),
    // The envelope's `receivedAt`: when ingest enqueued the event.
    enqueued_at: z.iso.datetime({ offset: true }).nullable(),
    receive_count: z.int().min(0),
  })
  .openapi('DlqMessage');

export type DlqMessageResponse = z.infer<typeof dlqMessageResponseSchema>;

// `dlq.listMessages`'s `200` body: Resend's list envelope plus the total `depth`, with no cursor,
// because it is a sample (api-contract.md → Conventions → Pagination, AWS-50).
export const dlqMessageListResponseSchema = z
  .object({
    object: z.literal('list'),
    has_more: z.boolean(),
    depth: z.int().min(0),
    data: z.array(dlqMessageResponseSchema),
  })
  .openapi('DlqMessageList');

export type DlqMessageListResponse = z.infer<typeof dlqMessageListResponseSchema>;
