import { Client, escapeIdentifier } from 'pg';
import type { TestProject } from 'vitest/node';
import { RUNTIME_ROLE } from '../prepare-database.ts';
import { preparePostgres, startPostgresContainer, withDatabase } from './postgres-container.ts';

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

// The `int` project's global setup: one container per run. The runtime role, its timeouts and every
// migration go through `prepareDatabase`, the entry point `pnpm db:setup` and the deploy command
// call, so a failing migration fails here, before any test runs (verify-gate spec).
export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  const container = await startPostgresContainer(TEMPLATE, { stoppable: false });
  const teardown = async (): Promise<void> => {
    await container.stop();
  };
  try {
    const templateUrl = container.getConnectionUri();
    const maintenanceUrl = withDatabase(templateUrl, 'postgres');

    // Roles and their settings are cluster-wide, so every clone sees the role and its timeouts;
    // the template carries the grants.
    const runtimePassword = await preparePostgres(templateUrl);
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
