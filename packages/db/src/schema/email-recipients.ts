import {
  type EmailStatus,
  emailStatusSchema,
  type SoftSignal,
  type StickySignal,
  softSignalSchema,
  stickySignalSchema,
} from '@ledger/core';
import { index, pgTable, primaryKey, text, timestamp } from 'drizzle-orm/pg-core';
import { closedSetCheck } from './closed-set-check.ts';

// Outcome per email and recipient: the rows `projectEmail` returns, keyed on the keyed address
// hash, never the address (PII & retention). Under the email lock, inserted then locked (C9).
export const emailRecipients = pgTable(
  'email_recipients',
  {
    emailId: text('email_id').notNull(),
    addressHash: text('address_hash').notNull(),
    addressMasked: text('address_masked').notNull(),
    // Null until an outcome event names this recipient.
    status: text('status').$type<EmailStatus>(),
    statusAt: timestamp('status_at', { withTimezone: true }),
    // Open strings (RS-28, RS-35); null unless the deciding event is an `email.bounced`.
    bounceType: text('bounce_type'),
    bounceSubType: text('bounce_sub_type'),
    // The strongest sticky signal and the event behind it; all three null until one exists.
    stickySignal: text('sticky_signal').$type<StickySignal>(),
    stickySignalAt: timestamp('sticky_signal_at', { withTimezone: true }),
    stickySignalSvixId: text('sticky_signal_svix_id'),
    // The latest soft signal and the event behind it; all three null until one exists.
    softSignal: text('soft_signal').$type<SoftSignal>(),
    softSignalAt: timestamp('soft_signal_at', { withTimezone: true }),
    softSignalSvixId: text('soft_signal_svix_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ name: 'email_recipients_pkey', columns: [t.emailId, t.addressHash] }),
    closedSetCheck('email_recipients_status_check', t.status, emailStatusSchema.options),
    closedSetCheck(
      'email_recipients_sticky_signal_check',
      t.stickySignal,
      stickySignalSchema.options,
    ),
    closedSetCheck('email_recipients_soft_signal_check', t.softSignal, softSignalSchema.options),
    // Serves emailRecipientsRepository.listByAddressHash (the worker's step 8).
    index('email_recipients_address_hash_idx').on(t.addressHash),
  ],
);

export type EmailRecipientRow = typeof emailRecipients.$inferSelect;
export type NewEmailRecipient = typeof emailRecipients.$inferInsert;
