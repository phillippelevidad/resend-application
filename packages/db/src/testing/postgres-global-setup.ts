import { randomBytes } from 'node:crypto';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { Client, escapeIdentifier } from 'pg';
import type { TestProject } from 'vitest/node';
import { prepareDatabase, RUNTIME_ROLE } from '../prepare-database.ts';

// The compose tag: Postgres 18, the major the Neon project runs (integrations.md → Decision — Neon),
// pinned to an exact minor so runs are reproducible.
const IMAGE = 'postgres:18.6-alpine';
const TEMPLATE = 'ledger_template';

// What the global setup hands each int test file (pp-testing → Postgres harness, step 5).
export type PostgresHarness = {
  // The owner on the maintenance database, for CREATE / DROP DATABASE.
  maintenanceUrl: string;
  runtimeUser: string;
  runtimePassword: string;
  template: string;
};

declare module 'vitest' {
  export interface ProvidedContext {
    postgresHarness: PostgresHarness;
  }
}

// The `int` project's global setup: one container per run. The runtime role and every migration
// go through `prepareDatabase`, the entry point `pnpm db:setup` and slice 2's deploy command call,
// so a failing migration fails here, before any test runs (verify-gate spec).
export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  const container = await new PostgreSqlContainer(IMAGE).withDatabase(TEMPLATE).start();
  const teardown = async (): Promise<void> => {
    await container.stop();
  };
  try {
    const templateUrl = container.getConnectionUri();
    const maintenanceUrl = withDatabase(templateUrl, 'postgres');
    const runtimePassword = randomBytes(24).toString('hex');

    // Roles are cluster-wide, so every clone sees the role; the template carries the grants.
    await prepareDatabase({ ownerUrl: templateUrl, runtimePassword });
    await markTemplate(maintenanceUrl);

    project.provide('postgresHarness', {
      maintenanceUrl,
      runtimeUser: RUNTIME_ROLE,
      runtimePassword,
      template: TEMPLATE,
    });
    return teardown;
  } catch (err) {
    // A failed migration fails the run before any test; the container goes with it.
    await teardown();
    throw err;
  }
}

// prepareDatabase has closed its connection: no session may be connected to a template while it
// is copied (Postgres → Template databases).
async function markTemplate(maintenanceUrl: string): Promise<void> {
  const admin = new Client({ connectionString: maintenanceUrl });
  await admin.connect();
  try {
    await admin.query(`ALTER DATABASE ${escapeIdentifier(TEMPLATE)} WITH is_template = true`);
  } finally {
    await admin.end();
  }
}

function withDatabase(url: string, database: string): string {
  const parsed = new URL(url);
  parsed.pathname = `/${database}`;
  return parsed.toString();
}
