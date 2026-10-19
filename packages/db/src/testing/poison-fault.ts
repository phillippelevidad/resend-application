import { sql } from 'drizzle-orm';
import type { Executor } from '../executor.ts';

// The sim's poison fault (D27): a transient `NOT VALID` CHECK on `webhook_events` that refuses any
// new row whose `svix_id` starts with this prefix, with `23514`, while every other insert and every
// existing row stands. A test fault, never a migration: no schema file declares it. Only the sim
// mints an id with this prefix (Resend's are `msg_…`, the sim's others `<namespace>-svix-…`), so the
// run marks the ids it poisons instead of listing them, and both statements stay constant: no
// runtime value reaches the DDL (pp-database → Never).
export const POISON_ID_PREFIX = 'simpoison_';

// Needs the table's owner: the runtime role gets `42501`. A leftover from a crashed run makes this
// fail `42710`, so a caller runs `removePoisonFault` first.
export async function addPoisonFault(db: Executor): Promise<void> {
  await db.execute(
    sql`ALTER TABLE webhook_events ADD CONSTRAINT ledger_sim_poison CHECK (NOT starts_with(svix_id, 'simpoison_')) NOT VALID`,
  );
}

// The fix, and the leftover's cleanup: a no-op when the constraint is absent.
export async function removePoisonFault(db: Executor): Promise<void> {
  await db.execute(sql`ALTER TABLE webhook_events DROP CONSTRAINT IF EXISTS ledger_sim_poison`);
}
