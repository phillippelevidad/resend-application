import { eventSourceSchema } from '@ledger/core';
import { index, jsonb, pgTable, primaryKey, text, timestamp } from 'drizzle-orm/pg-core';
import type { z } from 'zod';
import { closedSetCheck } from './closed-set-check.ts';

// The immutable ledger (ADR-004): one row per Resend event, keyed on `svix_id`, append-only, so no
// `updated_at`. The typed columns are read once, at insert, each null where unreadable (D17).
export const webhookEvents = pgTable(
  'webhook_events',
  {
    svixId: text('svix_id').notNull(),
    // Null when the payload has no string `type` (C5). No CHECK: unknown types are stored (RS-25).
    type: text('type'),
    // Null when `created_at` is not an ISO 8601 date-time with offset (a schema-failing payload).
    eventCreatedAt: timestamp('event_created_at', { withTimezone: true }),
    // From the envelope, no default: the table's base time field.
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull(),
    // Null unless the type is one of the ten outbound email types (D17, RS-25).
    emailId: text('email_id'),
    // Keyed hashes in `data.to`'s positions (RS-27); null under the same rule as `email_id`.
    toHashes: text('to_hashes').array(),
    source: text('source').$type<z.infer<typeof eventSourceSchema>>().notNull(),
    // The sanitized parse output (D3), any JSON value (D17); typed `unknown`, parsed on read.
    payload: jsonb('payload').notNull(),
  },
  (t) => [
    primaryKey({ name: 'webhook_events_pkey', columns: [t.svixId] }),
    closedSetCheck('webhook_events_source_check', t.source, eventSourceSchema.options),
    // Serves webhookEventsRepository.loadForEmail (the worker's step 6) and listTimeline.
    index('webhook_events_email_id_event_created_at_idx').on(t.emailId, t.eventCreatedAt),
  ],
);

export type WebhookEventRow = typeof webhookEvents.$inferSelect;
export type NewWebhookEvent = typeof webhookEvents.$inferInsert;
