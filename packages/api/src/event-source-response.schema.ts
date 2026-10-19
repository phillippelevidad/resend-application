import { z } from '@hono/zod-openapi';
import { eventSourceStateSchema } from '@ledger/core';

// `worker.resumeEventSource`'s `200` body (design.md → Surfaces): the state `health.get` reports,
// and whether this call re-enabled the source.
export const eventSourceResponseSchema = z
  .object({
    object: z.literal('event_source'),
    state: eventSourceStateSchema,
    resumed: z.boolean(),
  })
  .openapi('EventSource');

export type EventSourceResponse = z.infer<typeof eventSourceResponseSchema>;
