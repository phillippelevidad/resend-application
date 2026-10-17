import { and, eq, inArray, sql } from 'drizzle-orm';
import type { Executor, Transaction } from './executor.ts';
import {
  type EmailRecipientRow,
  emailRecipients,
  type NewEmailRecipient,
} from './schema/email-recipients.ts';

// What a recompute writes: every projected column, nothing the database owns.
export type EmailRecipientValues = Omit<
  EmailRecipientRow,
  'emailId' | 'addressHash' | 'createdAt' | 'updatedAt'
>;

// ADR-004 orders recipient rows by `address_hash`, compared by code unit. `COLLATE "C"` makes
// Postgres order them the same way whatever the database's default collation.
const byAddressHash = sql`${emailRecipients.addressHash} collate "C"`;

function compareCodeUnits(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export const emailRecipientsRepository = {
  // C9: under the email lock, each row is inserted if absent, then locked by `lockRows`. Inserted
  // in sorted `address_hash` order: an insert that conflicts with an uncommitted one waits for it,
  // so creation follows the lock order too (pp-database → Transactions and locks).
  async createIfAbsent(db: Executor, rows: readonly NewEmailRecipient[]): Promise<void> {
    if (rows.length === 0) {
      return;
    }
    const sorted = [...rows].sort((a, b) => compareCodeUnits(a.addressHash, b.addressHash));
    await db
      .insert(emailRecipients)
      .values(sorted)
      .onConflictDoNothing({ target: [emailRecipients.emailId, emailRecipients.addressHash] });
  },

  // The email's recipient rows, locked in sorted `address_hash` order (ADR-004, C9).
  async lockRows(tx: Transaction, emailId: string, hashes: readonly string[]): Promise<void> {
    if (hashes.length === 0) {
      return;
    }
    await tx
      .select({ addressHash: emailRecipients.addressHash })
      .from(emailRecipients)
      .where(
        and(
          eq(emailRecipients.emailId, emailId),
          inArray(emailRecipients.addressHash, [...hashes]),
        ),
      )
      .orderBy(byAddressHash)
      .for('update');
  },

  // ADR-003: the recompute overwrites the whole row; `updated_at` is set here, never by a trigger.
  async update(
    db: Executor,
    emailId: string,
    addressHash: string,
    values: EmailRecipientValues,
  ): Promise<void> {
    await db
      .update(emailRecipients)
      .set({ ...values, updatedAt: sql`now()` })
      .where(
        and(eq(emailRecipients.emailId, emailId), eq(emailRecipients.addressHash, addressHash)),
      );
  },

  // `email.get`'s recipients, in `address_hash` order (D25).
  async listByEmail(db: Executor, emailId: string): Promise<EmailRecipientRow[]> {
    return db
      .select()
      .from(emailRecipients)
      .where(eq(emailRecipients.emailId, emailId))
      .orderBy(byAddressHash);
  },

  // D14 step 8: every row for one recipient, what `projectRecipient` folds.
  async listByAddressHash(db: Executor, addressHash: string): Promise<EmailRecipientRow[]> {
    return db.select().from(emailRecipients).where(eq(emailRecipients.addressHash, addressHash));
  },
};
