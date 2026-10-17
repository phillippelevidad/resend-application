import { compareCodeUnits } from '@ledger/core';
import { eq, inArray, sql } from 'drizzle-orm';
import type { Executor, Transaction } from './executor.ts';
import {
  type NewRecipientState,
  type RecipientStateRow,
  recipientState,
} from './schema/recipient-state.ts';

// What a recompute writes: every projected column, nothing the database owns.
export type RecipientStateValues = Omit<
  RecipientStateRow,
  'addressHash' | 'createdAt' | 'updatedAt'
>;

// ADR-004 orders recipient rows by `address_hash`, compared by code unit. `COLLATE "C"` makes
// Postgres order them the same way whatever the database's default collation.
const byAddressHash = sql`${recipientState.addressHash} collate "C"`;

export const recipientStateRepository = {
  // ADR-004's lock order, after the email row: each recipient row inserted if absent, in sorted
  // `address_hash` order, since an insert that conflicts with an uncommitted one waits for it. The
  // placeholder (`ok`, the new event's mask) is overwritten before commit (D14).
  async createIfAbsent(db: Executor, rows: readonly NewRecipientState[]): Promise<void> {
    if (rows.length === 0) {
      return;
    }
    const sorted = [...rows].sort((a, b) => compareCodeUnits(a.addressHash, b.addressHash));
    await db
      .insert(recipientState)
      .values(sorted)
      .onConflictDoNothing({ target: recipientState.addressHash });
  },

  // The recipient locks (ADR-004), taken in sorted `address_hash` order, so two emails naming the
  // same recipients in opposite `data.to` order never deadlock.
  async lockRecipients(tx: Transaction, hashes: readonly string[]): Promise<void> {
    if (hashes.length === 0) {
      return;
    }
    await tx
      .select({ addressHash: recipientState.addressHash })
      .from(recipientState)
      .where(inArray(recipientState.addressHash, [...hashes]))
      .orderBy(byAddressHash)
      .for('update');
  },

  // ADR-003: the recompute overwrites the whole row; `updated_at` is set here, never by a trigger.
  async update(db: Executor, addressHash: string, values: RecipientStateValues): Promise<void> {
    await db
      .update(recipientState)
      .set({ ...values, updatedAt: sql`now()` })
      .where(eq(recipientState.addressHash, addressHash));
  },

  // `recipient.get`'s lookup, by the keyed hash of the requested address (D24).
  async get(db: Executor, addressHash: string): Promise<RecipientStateRow | undefined> {
    const [row] = await db
      .select()
      .from(recipientState)
      .where(eq(recipientState.addressHash, addressHash));
    return row;
  },

  // Simulator invariant 2 (D37): the stored rows of the recipients a run generated.
  async listByAddressHashes(db: Executor, hashes: readonly string[]): Promise<RecipientStateRow[]> {
    if (hashes.length === 0) {
      return [];
    }
    return db
      .select()
      .from(recipientState)
      .where(inArray(recipientState.addressHash, [...hashes]));
  },
};
