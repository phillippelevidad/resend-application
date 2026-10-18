// Ships 9 (D12): the reads behind the deploy command's key-mismatch and contract-step refusals.
// They run through the harness's owner connection, read-only, because the deploy runs them over
// the direct owner URL and the runtime role cannot read the `drizzle` schema. Only the seed row is
// written, as the runtime role.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { addressHashKeyId, hashAddress } from '@ledger/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pendingContractSteps, storedAddressHashKeyId } from './deploy-checks.ts';
import { recipientStateRepository } from './recipient-state.repository.ts';
import { createTestDatabase, type TestDatabase } from './testing.ts';

let t: TestDatabase;
const folders: string[] = [];

beforeAll(async () => {
  t = await createTestDatabase();
});

afterAll(async () => {
  for (const folder of folders) {
    rmSync(folder, { recursive: true, force: true });
  }
  await t.drop();
});

describe('storedAddressHashKeyId', () => {
  it('answers undefined on a database that holds no recipient yet', async () => {
    expect(await storedAddressHashKeyId(t.owner)).toBeUndefined();
  });

  it('answers the key id of the key the stored hashes were made with', async () => {
    const key = new Uint8Array(32).fill(7);
    await recipientStateRepository.createIfAbsent(t.db, [
      {
        addressHash: hashAddress(key, 'delivered@resend.dev'),
        addressMasked: 'd*******@resend.dev',
        deliverability: 'ok',
      },
    ]);
    expect(await storedAddressHashKeyId(t.owner)).toBe(addressHashKeyId(key));
    expect(await storedAddressHashKeyId(t.owner)).not.toBe(
      addressHashKeyId(new Uint8Array(32).fill(8)),
    );
  });
});

// Every journal `when` below this is applied in the clone: the template applied the package's own
// migrations, the newest of which is far younger than 1970 plus a second.
const APPLIED_WHEN = 1_000;
// Far past any `when` drizzle-kit wrote, so pending.
const PENDING_WHEN = 9_000_000_000_000;

const SHA_A = 'a'.repeat(40);
const SHA_B = '0123456789abcdef0123456789abcdef01234567';

type Migration = { tag: string; when: number; sql: string };

// A migrations folder in drizzle-kit's layout: `meta/_journal.json` plus one `<tag>.sql` per entry.
function migrationsFolder(migrations: readonly Migration[]): string {
  const folder = mkdtempSync(join(tmpdir(), 'ledger-deploy-checks-'));
  folders.push(folder);
  mkdirSync(join(folder, 'meta'));
  const entries = migrations.map(({ tag, when }, idx) => ({
    idx,
    version: '7',
    when,
    tag,
    breakpoints: true,
  }));
  writeFileSync(
    join(folder, 'meta', '_journal.json'),
    JSON.stringify({ version: '7', dialect: 'postgresql', entries }),
  );
  for (const { tag, sql } of migrations) {
    writeFileSync(join(folder, `${tag}.sql`), sql);
  }
  return folder;
}

describe('pendingContractSteps', () => {
  it("answers none for the package's own migrations, every one of them applied", async () => {
    expect(await pendingContractSteps(t.owner)).toEqual([]);
  });

  it('parses the SHA marker of each pending migration and ignores the applied ones', async () => {
    const folder = migrationsFolder([
      {
        tag: '0000_applied-contract',
        when: APPLIED_WHEN,
        sql: `-- contract-step: ${SHA_B}\nALTER TABLE "x" DROP COLUMN "y";\n`,
      },
      {
        tag: '0001_pending-contract',
        when: PENDING_WHEN,
        sql: `-- contract-step: ${SHA_A}\r\nALTER TABLE "x" DROP COLUMN "z";\r\n`,
      },
      {
        tag: '0002_pending-expand',
        when: PENDING_WHEN + 1,
        sql: 'ALTER TABLE "x" ADD COLUMN "w" text;\n',
      },
    ]);
    expect(await pendingContractSteps(t.owner, folder)).toEqual([
      { tag: '0001_pending-contract', commit: SHA_A },
    ]);
  });

  it('skips a pending replace: marker, which carries no SHA and ships with its code', async () => {
    const folder = migrationsFolder([
      {
        tag: '0000_pending-replace',
        when: PENDING_WHEN,
        sql: '-- contract-step: replace: email_state_status_check, widen\nALTER TABLE "x" DROP CONSTRAINT "c";\n',
      },
    ]);
    expect(await pendingContractSteps(t.owner, folder)).toEqual([]);
  });

  it('fails closed on a pending marker that is neither a SHA nor replace:', async () => {
    const folder = migrationsFolder([
      {
        tag: '0000_pending-malformed',
        when: PENDING_WHEN,
        sql: '-- contract-step: abc123\nALTER TABLE "x" DROP COLUMN "y";\n',
      },
    ]);
    await expect(pendingContractSteps(t.owner, folder)).rejects.toMatchObject({
      code: 'internal_error',
    });
  });
});
