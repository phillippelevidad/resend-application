import { type EmailStatus, emailStatusSchema } from '@ledger/core';
import { integer, pgTable, primaryKey, text, timestamp } from 'drizzle-orm/pg-core';
import { closedSetCheck } from './closed-set-check.ts';

// Current state per email: `projectEmail` over the email's event set (ADR-003), recomputed in full
// by every projectable event. The row is the email lock target (ADR-004).
export const emailState = pgTable(
  'email_state',
  {
    emailId: text('email_id').notNull(),
    // Null until the event set holds an outcome event (`opened` / `clicked` are counters).
    status: text('status').$type<EmailStatus>(),
    // Null when no projected event carries `from` / `subject`.
    fromMasked: text('from_masked'),
    subjectMasked: text('subject_masked'),
    openCount: integer('open_count').notNull().default(0),
    clickCount: integer('click_count').notNull().default(0),
    // Null until the first `email.opened` / `email.clicked`.
    firstOpenedAt: timestamp('first_opened_at', { withTimezone: true }),
    firstClickedAt: timestamp('first_clicked_at', { withTimezone: true }),
    // The lock placeholder writes the new event's `event_created_at`; the recompute overwrites it (D14).
    lastEventAt: timestamp('last_event_at', { withTimezone: true }).notNull(),
    eventCount: integer('event_count').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    // Set by the repository's UPDATE, never by a trigger.
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ name: 'email_state_pkey', columns: [t.emailId] }),
    closedSetCheck('email_state_status_check', t.status, emailStatusSchema.options),
  ],
);

export type EmailStateRow = typeof emailState.$inferSelect;
export type NewEmailState = typeof emailState.$inferInsert;
