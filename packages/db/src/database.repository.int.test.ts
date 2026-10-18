// D11: the runtime role can read its database's size, which `health.get` and the worker's resume
// probe compare with `STORAGE_LIMIT_BYTES`.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { databaseRepository } from './database.repository.ts';
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
