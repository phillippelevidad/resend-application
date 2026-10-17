import { eq, inArray, sql } from 'drizzle-orm';
import type { Executor, Transaction } from './executor.ts';
import { type EmailStateRow, emailState, type NewEmailState } from './schema/email-state.ts';

// What a recompute writes: every projected column, nothing the database owns.
export type EmailStateValues = Omit<EmailStateRow, 'emailId' | 'createdAt' | 'updatedAt'>;

export const emailStateRepository = {
  // ADR-004's lock order, step one: create the email row if absent, so `lockEmail` has a row to
  // lock. The placeholder satisfies every NOT NULL and is overwritten before commit (D14).
  async createIfAbsent(db: Executor, row: NewEmailState): Promise<void> {
    await db.insert(emailState).values(row).onConflictDoNothing({ target: emailState.emailId });
  },

  // The email lock (ADR-004): held to commit, it serializes every message for this email.
  async lockEmail(tx: Transaction, emailId: string): Promise<EmailStateRow | undefined> {
    const [row] = await tx
      .select()
      .from(emailState)
      .where(eq(emailState.emailId, emailId))
      .for('update');
    return row;
  },

  // ADR-003: the recompute overwrites the whole row; `updated_at` is set here, never by a trigger.
  async update(db: Executor, emailId: string, values: EmailStateValues): Promise<void> {
    await db
      .update(emailState)
      .set({ ...values, updatedAt: sql`now()` })
      .where(eq(emailState.emailId, emailId));
  },

  async get(db: Executor, emailId: string): Promise<EmailStateRow | undefined> {
    const [row] = await db.select().from(emailState).where(eq(emailState.emailId, emailId));
    return row;
  },

  // Simulator invariant 2 (D37): the stored rows of the emails a run generated.
  async listByEmailIds(db: Executor, emailIds: readonly string[]): Promise<EmailStateRow[]> {
    if (emailIds.length === 0) {
      return [];
    }
    return db
      .select()
      .from(emailState)
      .where(inArray(emailState.emailId, [...emailIds]));
  },
};
