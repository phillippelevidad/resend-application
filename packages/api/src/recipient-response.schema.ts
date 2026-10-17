import { z } from '@hono/zod-openapi';
import { deliverabilitySchema } from '@ledger/core';

// `recipient.get`'s `200` body (design.md → Surfaces): the address only as its mask, never the
// address or its hash (api-contract.md → Conventions → Redaction).
export const recipientResponseSchema = z
  .object({
    object: z.literal('recipient'),
    address_masked: z.string(),
    deliverability: deliverabilitySchema,
    // Both null while `ok` was decided by no event.
    since: z.iso.datetime().nullable(),
    cause_email_id: z.string().nullable(),
  })
  .openapi('Recipient');

export type RecipientResponse = z.infer<typeof recipientResponseSchema>;
