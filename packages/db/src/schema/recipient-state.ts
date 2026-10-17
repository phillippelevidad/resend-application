import { type Deliverability, deliverabilitySchema } from '@ledger/core';
import { pgTable, primaryKey, text, timestamp } from 'drizzle-orm/pg-core';
import { closedSetCheck } from './closed-set-check.ts';

// Deliverability per address: `projectRecipient` over every `email_recipients` row for the hash.
// The row is the recipient lock target (ADR-004) and `recipient.get`'s lookup.
export const recipientState = pgTable(
  'recipient_state',
  {
    addressHash: text('address_hash').notNull(),
    addressMasked: text('address_masked').notNull(),
    deliverability: text('deliverability').$type<Deliverability>().notNull(),
    // Both null while `ok` was decided by no event (C9).
    since: timestamp('since', { withTimezone: true }),
    causeEmailId: text('cause_email_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ name: 'recipient_state_pkey', columns: [t.addressHash] }),
    closedSetCheck(
      'recipient_state_deliverability_check',
      t.deliverability,
      deliverabilitySchema.options,
    ),
  ],
);

export type RecipientStateRow = typeof recipientState.$inferSelect;
export type NewRecipientState = typeof recipientState.$inferInsert;
