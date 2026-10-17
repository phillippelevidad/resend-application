import { z } from 'zod';

// RS-26: every payload is `{ type, created_at, data }`. Loose at every level and `type` an open
// string, so unknown types and non-email families (RS-25) pass and are kept raw.
export const webhookEnvelopeSchema = z.looseObject({
  type: z.string(),
  created_at: z.iso.datetime({ offset: true }),
  data: z.looseObject({}),
});

export type WebhookEnvelope = z.infer<typeof webhookEnvelopeSchema>;
