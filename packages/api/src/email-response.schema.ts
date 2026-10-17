import { z } from '@hono/zod-openapi';
import { emailStatusSchema } from '@ledger/core';

// `email.get`'s `200` body (design.md → Surfaces): masks only, every timestamp ISO 8601 UTC or null.
// Never the payload, `to`, a raw `from` or subject, bounce diagnostics, `address_hash` or the
// signal columns (api-contract.md → Conventions → Redaction).
const timestamp = z.iso.datetime();

const recipientSchema = z.object({
  address_masked: z.string(),
  status: emailStatusSchema.nullable(),
  status_at: timestamp.nullable(),
  bounce_type: z.string().nullable(),
  bounce_sub_type: z.string().nullable(),
});

const timelineItemSchema = z.object({
  svix_id: z.string(),
  type: z.string(),
  event_created_at: timestamp.nullable(),
  bounce_type: z.string().nullable(),
  bounce_sub_type: z.string().nullable(),
});

export const emailResponseSchema = z
  .object({
    object: z.literal('email'),
    email_id: z.string(),
    status: emailStatusSchema.nullable(),
    from_masked: z.string().nullable(),
    subject_masked: z.string().nullable(),
    open_count: z.int(),
    click_count: z.int(),
    first_opened_at: timestamp.nullable(),
    first_clicked_at: timestamp.nullable(),
    last_event_at: timestamp.nullable(),
    event_count: z.int(),
    // Ordered by `address_hash`, which is never returned.
    recipients: z.array(recipientSchema),
    // Every ledger row of the email, in fold order: `event_created_at` nulls last, `rank(type)`,
    // `svix_id` (ADR-003).
    timeline: z.array(timelineItemSchema),
  })
  .openapi('Email');

export type EmailResponse = z.infer<typeof emailResponseSchema>;
