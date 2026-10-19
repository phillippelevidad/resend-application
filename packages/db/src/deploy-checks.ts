import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { LedgerError } from '@ledger/shared';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Executor } from './executor.ts';
import { MIGRATIONS_FOLDER } from './prepare-database.ts';
import { recipientState } from './schema/recipient-state.ts';

// D12: the reads behind two of the deploy command's refusals (D33 steps 4 and 7). Both run over the
// direct owner URL only: the runtime role cannot read the `drizzle` schema, and must not.

// The key id of the address-hash key the stored rows were hashed under: the 8-character prefix of
// one `recipient_state.address_hash` (`hashAddress` writes `<key id>.<digest>`), or `undefined` on
// a database that holds none yet. The deploy compares it with `addressHashKeyId(key)`, so a new key
// never orphans every stored hash (data-modeling.md → PII & retention).
export async function storedAddressHashKeyId(db: Executor): Promise<string | undefined> {
  const [row] = await db
    .select({ addressHash: recipientState.addressHash })
    .from(recipientState)
    .limit(1);
  return row?.addressHash.slice(0, 8);
}

// A pending migration's contract step: the commit that stopped using what it removes.
export type ContractStep = { tag: string; commit: string };

const SHA_MARKER = /^-- contract-step: ([0-9a-f]{40})\s*$/;
const REPLACE_MARKER = /^-- contract-step: replace: /;
const ANY_MARKER = /^-- contract-step:/;

// drizzle-kit's journal, as drizzle-orm's `readMigrationFiles` reads it.
const journalSchema = z.object({
  entries: z.array(z.object({ tag: z.string(), when: z.number() })),
});

// The SHA-marked migrations `prepareDatabase` would apply next (pp-database → The contract-step
// marker). Pending is decided as drizzle-orm 0.45.4's `PgDialect.migrate` decides it: every journal
// entry newer than the latest applied `created_at`, or every entry when the journal table does not
// exist yet. A `replace:` marker ships with its code and carries no SHA, so it is skipped; any other
// marker shape fails closed. `migrationsFolder` is the package's own, except in its test.
export async function pendingContractSteps(
  db: Executor,
  migrationsFolder: string = MIGRATIONS_FOLDER,
): Promise<ContractStep[]> {
  const latestApplied = await latestAppliedMigration(db);
  const journal = journalSchema.parse(
    JSON.parse(readFileSync(join(migrationsFolder, 'meta', '_journal.json'), 'utf8')),
  );
  const steps: ContractStep[] = [];
  for (const { tag, when } of journal.entries) {
    if (latestApplied !== undefined && when <= latestApplied) {
      continue;
    }
    const [firstLine = ''] = readFileSync(join(migrationsFolder, `${tag}.sql`), 'utf8').split(
      /\r?\n/,
    );
    const sha = SHA_MARKER.exec(firstLine)?.[1];
    if (sha !== undefined) {
      steps.push({ tag, commit: sha });
    } else if (ANY_MARKER.test(firstLine) && !REPLACE_MARKER.test(firstLine)) {
      throw new LedgerError(
        'internal_error',
        `Pending migration ${tag} carries a contract-step marker with no 40-character SHA.`,
      );
    }
  }
  return steps;
}

// The newest applied migration's `created_at` (its journal `when`), or `undefined` when no migration
// has run: on a new database the journal table does not exist yet.
async function latestAppliedMigration(db: Executor): Promise<number | undefined> {
  const exists = await db.execute<{ present: boolean }>(
    sql`select to_regclass('drizzle.__drizzle_migrations') is not null as present`,
  );
  if (exists.rows[0]?.present !== true) {
    return undefined;
  }
  const latest = await db.execute<{ created_at: string | null }>(
    sql`select max(created_at)::text as created_at from drizzle.__drizzle_migrations`,
  );
  const value = latest.rows[0]?.created_at;
  return value === null || value === undefined ? undefined : Number(value);
}
