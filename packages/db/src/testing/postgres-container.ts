import { randomBytes } from 'node:crypto';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { prepareDatabase, type RoleTimeouts } from '../prepare-database.ts';

// Steps 1–3 of the harness (pp-testing → Postgres harness), shared by the `int` project's global
// setup and the outage helper, so an outage test's database is prepared exactly as every other.

// The compose tag: Postgres 18, the major the Neon project runs (integrations.md → Decision — Neon),
// pinned to an exact minor so runs are reproducible.
const IMAGE = 'postgres:18.6-alpine';

// D10's harness values: the idle bound below the lock bound, and both above the longest lock wait
// any concurrency test polls for. The deploy command and setup pass `RUNTIME_ROLE_TIMEOUTS`.
export const HARNESS_ROLE_TIMEOUTS: RoleTimeouts = {
  idleInTransactionMs: 2_000,
  lockTimeoutMs: 5_000,
};

// PID 1 is a shell that outlives the server, so `pg_ctl stop` ends Postgres without ending the
// container, and `pg_ctl start` brings it back on the same port with the same data. `"$@"` is the
// image's own command (`postgres`), run through the image's own entrypoint.
const STOPPABLE_ENTRYPOINT = [
  'sh',
  '-c',
  'docker-entrypoint.sh "$@"; while :; do sleep 3600; done',
  'sh',
];

// Step 1: one container, its database named, never `postgres`. `stoppable` is the outage helper's.
export async function startPostgresContainer(
  database: string,
  { stoppable }: { stoppable: boolean },
): Promise<StartedPostgreSqlContainer> {
  const container = new PostgreSqlContainer(IMAGE).withDatabase(database);
  if (stoppable) {
    container.withEntrypoint(STOPPABLE_ENTRYPOINT).withCommand(['postgres']);
  }
  return container.start();
}

// Steps 2–3: the runtime role, its timeouts and every migration, through `prepareDatabase`, the
// entry point `pnpm db:setup` and the deploy command call. Returns the role's generated password.
export async function preparePostgres(ownerUrl: string): Promise<string> {
  const runtimePassword = randomBytes(24).toString('hex');
  await prepareDatabase({
    ownerUrl,
    runtimePassword,
    roleTimeouts: HARNESS_ROLE_TIMEOUTS,
    resetPassword: false,
  });
  return runtimePassword;
}

export function withDatabase(url: string, database: string): string {
  const parsed = new URL(url);
  parsed.pathname = `/${database}`;
  return parsed.toString();
}

export function withCredentials(url: string, user: string, password: string): string {
  const parsed = new URL(url);
  parsed.username = encodeURIComponent(user);
  parsed.password = encodeURIComponent(password);
  return parsed.toString();
}
