import { sql } from 'drizzle-orm';
import type { Executor } from './executor.ts';

// D11: Neon Free's 1 GB, read as decimal so the probe refuses early.
export const STORAGE_LIMIT_BYTES = 1_000_000_000;

// The resume probe fails at or above this share of the limit: `pg_database_size` and Neon's own
// accounting can differ (PG-U07, revisited in slice 3).
export const STORAGE_PROBE_THRESHOLD = 0.95;

export const databaseRepository = {
  // `health.get`'s storage field and the worker's resume probe (D11, D16).
  async storageBytes(db: Executor): Promise<number> {
    const result = await db.execute<{ bytes: string }>(
      sql`select pg_database_size(current_database())::text as bytes`,
    );
    return Number(result.rows[0]?.bytes ?? 0);
  },
};
