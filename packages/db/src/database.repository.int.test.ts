// D11: the runtime role can read its database's size, which `health.get` and the worker's resume
// probe compare with `STORAGE_LIMIT_BYTES`.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { databaseRepository } from './database.repository.ts';
import { HARNESS_ROLE_TIMEOUTS } from './testing/postgres-container.ts';
import { createTestDatabase, type TestDatabase } from './testing.ts';

let t: TestDatabase;

beforeAll(async () => {
  t = await createTestDatabase();
});

afterAll(async () => {
  await t.drop();
});

describe('databaseRepository.storageBytes as the runtime role', () => {
  it("answers the database's size in bytes, as a number", async () => {
    const bytes = await databaseRepository.storageBytes(t.db);
    expect(Number.isSafeInteger(bytes)).toBe(true);
    expect(bytes).toBeGreaterThan(0);
  });
});

// D37, PG-U06: what `pnpm aws:db-check` prints through the pooled URL, here over a direct session.
describe('databaseRepository.sessionTimeouts as the runtime role', () => {
  it("answers the role's two timeouts as the session applies them", async () => {
    expect(await databaseRepository.sessionTimeouts(t.db)).toEqual({
      idleInTransactionSessionTimeout: `${HARNESS_ROLE_TIMEOUTS.idleInTransactionMs / 1000}s`,
      lockTimeout: `${HARNESS_ROLE_TIMEOUTS.lockTimeoutMs / 1000}s`,
    });
  });
});
