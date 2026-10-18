// Ships 10 (D10, integrations.md → Runtime role): the role every function connects as holds DML
// only, and carries its server-side timeouts once `prepareDatabase` has run (the harness ran it).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RUNTIME_ROLE } from './prepare-database.ts';
import { HARNESS_ROLE_TIMEOUTS } from './testing/postgres-container.ts';
import { createTestDatabase, sqlStateOf, type TestDatabase } from './testing.ts';

let t: TestDatabase;

beforeAll(async () => {
  t = await createTestDatabase();
});

afterAll(async () => {
  await t.drop();
});

describe('the runtime role', () => {
  it('is refused DELETE on webhook_events with SQLSTATE 42501: the ledger is append-only', async () => {
    expect(await sqlStateOf(t.db.execute('delete from webhook_events'))).toBe('42501');
  });

  it('is refused CREATE TABLE with SQLSTATE 42501: no DDL', async () => {
    expect(await sqlStateOf(t.db.execute('create table runtime_role_probe (id int)'))).toBe(
      '42501',
    );
  });

  it('carries both timeouts prepareDatabase set, as role-level settings', async () => {
    const { rows } = await t.db.execute<{ rolconfig: string[] | null }>(
      `select rolconfig from pg_roles where rolname = '${RUNTIME_ROLE}'`,
    );
    expect(rows[0]?.rolconfig).toEqual(
      expect.arrayContaining([
        `idle_in_transaction_session_timeout=${HARNESS_ROLE_TIMEOUTS.idleInTransactionMs}ms`,
        `lock_timeout=${HARNESS_ROLE_TIMEOUTS.lockTimeoutMs}ms`,
      ]),
    );
  });

  it('runs its sessions under those timeouts', async () => {
    const { rows } = await t.db.execute<{ idle: string; lock: string }>(
      `select current_setting('idle_in_transaction_session_timeout') as idle,
              current_setting('lock_timeout') as lock`,
    );
    expect(rows[0]).toEqual({ idle: '2s', lock: '5s' });
  });
});
