import { setTimeout as sleep } from 'node:timers/promises';
import { parseArgs } from 'node:util';
import {
  createCloudFormationClient,
  createSecretsManagerClient,
  readStackOutputs,
  SecretsManagerSecretReaderAdapter,
} from '@ledger/aws';
import {
  classifyDatabaseError,
  createDatabase,
  type Database,
  databaseRepository,
  emailStateRepository,
  RUNTIME_ROLE_TIMEOUTS,
  runTransaction,
} from '@ledger/db';
import { createLogger, errorFields } from '@ledger/shared';
import { z } from 'zod';
import { APP_STACK_NAME, appOutputKeys } from './ledger-stacks.ts';
import { createScriptOutput, processSink } from './script-output.ts';

// `pnpm aws:db-check --email-id <id> [--idle-minutes <n>]` (D37): three read-only checks of the
// deployed database through the runtime role's pooled URL, the one the functions use, through
// `packages/db` functions only. It writes nothing. The run is the owner's Ask-first run (root
// AGENTS.md → Permissions).

const out = createScriptOutput('aws:db-check', processSink);
const cloudFormation = createCloudFormationClient();
const secretReader = new SecretsManagerSecretReaderAdapter({
  client: createSecretsManagerClient(),
});

// PG-U02: how long the first transaction holds the email's lock, and the wait that reads as
// serialized (the second transaction waited for most of the hold).
const LOCK_HOLD_MS = 2_000;
const SERIALIZED_WAIT_MS = 1_500;
// PG-U04: past Neon Free's fixed 5-minute suspend (integrations.md → Decision — Neon).
const MIN_IDLE_MINUTES = 6;

// Only the pooled URL is read from `ledger/database`; the keys stay unread.
const databaseSecretSchema = z
  .string()
  .transform((value, ctx): unknown => {
    try {
      return JSON.parse(value);
    } catch {
      ctx.addIssue({ code: 'custom', message: 'must be a JSON object' });
      return z.NEVER;
    }
  })
  .pipe(z.object({ pooledUrl: z.string().startsWith('postgres') }));

const asSetting = (milliseconds: number): string => `${milliseconds / 1000}s`;

const pools: Database[] = [];
function openPool(url: string): Database {
  const database = createDatabase({
    url,
    max: 1,
    // Pool errors carry the error's name only (create-database.ts), prefixed like every line.
    logger: createLogger({
      functionName: 'aws-db-check',
      stream: { write: (line: string) => process.stderr.write(`aws:db-check: ${line}`) },
    }),
  });
  pools.push(database);
  return database;
}

async function check(): Promise<0 | 1> {
  let emailId: string;
  let idleMinutes: number | undefined;
  try {
    const { values } = parseArgs({
      args: process.argv.slice(2),
      options: { 'email-id': { type: 'string' }, 'idle-minutes': { type: 'string' } },
      strict: true,
      allowPositionals: false,
    });
    if (values['email-id'] === undefined || values['email-id'] === '') throw new Error();
    emailId = values['email-id'];
    if (values['idle-minutes'] !== undefined) {
      idleMinutes = Number(values['idle-minutes']);
      if (!Number.isInteger(idleMinutes) || idleMinutes < MIN_IDLE_MINUTES) throw new Error();
    }
  } catch {
    return out.refused(
      `usage: pnpm aws:db-check --email-id <email id> [--idle-minutes <whole minutes, at least ${MIN_IDLE_MINUTES}>]`,
    );
  }

  let pooledUrl: string;
  try {
    const app = await readStackOutputs(cloudFormation, APP_STACK_NAME);
    const secretArn = app?.outputs[appOutputKeys.databaseSecretArn];
    if (secretArn === undefined)
      return out.refused('no app stack is deployed; run pnpm aws:deploy first');
    const parsed = databaseSecretSchema.safeParse(await secretReader.read(secretArn));
    if (!parsed.success) {
      return out.refused('ledger/database holds no pooled URL yet; run pnpm aws:deploy first');
    }
    pooledUrl = parsed.data.pooledUrl;
  } catch {
    return out.failed('reading ledger/database failed');
  }

  const main = openPool(pooledUrl);

  // 1. PG-U06: the role's settings as the pooler's server session applies them.
  try {
    const timeouts = await databaseRepository.sessionTimeouts(main.db);
    const expectedIdle = asSetting(RUNTIME_ROLE_TIMEOUTS.idleInTransactionMs);
    const expectedLock = asSetting(RUNTIME_ROLE_TIMEOUTS.lockTimeoutMs);
    out.line(
      `PG-U06 idle_in_transaction_session_timeout ${timeouts.idleInTransactionSessionTimeout} (expected ${expectedIdle})`,
    );
    out.line(`PG-U06 lock_timeout ${timeouts.lockTimeout} (expected ${expectedLock})`);
    const honored =
      timeouts.idleInTransactionSessionTimeout === expectedIdle &&
      timeouts.lockTimeout === expectedLock;
    out.line(`PG-U06 ${honored ? 'honored' : 'not honored'} through the pooled URL`);
  } catch {
    return out.failed('reading the session timeouts through the pooled URL failed');
  }

  // 2. PG-U02: two size-1 pools, A holding the email's row lock while B asks for it. No write.
  try {
    if ((await emailStateRepository.get(main.db, emailId)) === undefined) {
      return out.refused("--email-id names no email in the ledger; use the verify send's id");
    }
    const first = openPool(pooledUrl);
    const second = openPool(pooledUrl);
    // B connects before A takes the lock, so B's measured wait is the lock wait alone, never a cold
    // pooler connect that could read as serialization with no lock held.
    await databaseRepository.sessionTimeouts(second.db);
    let markLocked: () => void = () => {};
    const locked = new Promise<void>((resolve) => {
      markLocked = resolve;
    });
    const holder = runTransaction(first, async (tx) => {
      await emailStateRepository.lockEmail(tx, emailId);
      markLocked();
      await sleep(LOCK_HOLD_MS);
    });
    // A holder that fails before it locks ends the check as `failed` instead of waiting forever.
    await Promise.race([locked, holder]);
    const askedAt = performance.now();
    const waiter = runTransaction(second, async (tx) => {
      await emailStateRepository.lockEmail(tx, emailId);
      return Math.round(performance.now() - askedAt);
    });
    const [, waitedMs] = await Promise.all([holder, waiter]);
    out.line(
      `PG-U02 the second transaction waited ${waitedMs} ms for the first's lock (held ${LOCK_HOLD_MS} ms): ${waitedMs >= SERIALIZED_WAIT_MS ? 'serialized' : 'not serialized'}`,
    );
  } catch {
    return out.failed('the two-transaction lock check failed');
  }

  // 3. PG-U04: the pool the functions build (`createDatabase`, size 1), idle past the suspend, then
  // queried again.
  if (idleMinutes !== undefined) {
    out.line(`PG-U04 idling ${idleMinutes} minutes`);
    await sleep(idleMinutes * 60_000);
    try {
      await databaseRepository.sessionTimeouts(main.db);
      out.line(`PG-U04 the pool answered after ${idleMinutes} minutes idle`);
    } catch (error) {
      const connectionClass = classifyDatabaseError(error) !== undefined;
      out.line(
        `PG-U04 the query after ${idleMinutes} minutes idle failed: ${errorFields(error).error_name} (connection-class: ${connectionClass ? 'yes' : 'no'})`,
      );
    }
  }

  return out.done();
}

try {
  process.exitCode = await check();
} finally {
  await Promise.all(pools.map((database) => database.pool.end()));
}
