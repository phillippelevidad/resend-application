// Slice 4 D23, the local-stack delta: locally `reconcile.start` inserts a manual run and hands it to
// the in-process reconciler, which composes no Resend client, so the run ends
// `reconciler_not_configured`; `ledger gaps` and `ledger health` read it. The real `main.ts` serves
// this file's Postgres clone, as the runtime role, and the real CLI runs against it as child
// processes, as the walk runs them. An int test rather than e2e: the e2e tier has no Postgres, and a
// local run must be inserted, finished and listed.
import { type ChildProcess, spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { issueTestToken } from '@ledger/api/testing';
import { createTestDatabase, type TestDatabase } from '@ledger/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const mainPath = fileURLToPath(new URL('./main.ts', import.meta.url));
const cliPath = fileURLToPath(new URL('../../cli/src/main.ts', import.meta.url));
const tokenTagKeyHex = '6d'.repeat(32);
// Built at run time, so no `whsec_` literal sits in the source (the gitleaks rule).
const simulatorSecret = `whsec_${Buffer.from('ledger-local-reconcile-int').toString('base64')}`;

// Every variable either process reads is set here; the developer's own are removed first.
const ownNames = [
  'DATABASE_URL',
  'LEDGER_ADDRESS_HASH_KEY',
  'LEDGER_TOKEN_TAG_KEY',
  'LEDGER_WEBHOOK_SECRETS',
  'LEDGER_SIMULATOR_SECRET',
  'LEDGER_URL',
  'LEDGER_TOKEN',
];
const inherited = (): NodeJS.ProcessEnv => {
  const env = { ...process.env };
  for (const name of ownNames) delete env[name];
  return env;
};

let t: TestDatabase;
let server: ChildProcess;
let baseUrl: string;
let token: string;

async function freePort(): Promise<number> {
  const probe = createServer();
  probe.listen(0, '127.0.0.1');
  await once(probe, 'listening');
  const address = probe.address();
  probe.close();
  await once(probe, 'close');
  if (address === null || typeof address === 'string') throw new TypeError('no port');
  return address.port;
}

async function waitForListening(proc: ChildProcess): Promise<void> {
  let buffered = '';
  proc.stdout?.setEncoding('utf8');
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new TypeError('the local server never listened')),
      15_000,
    );
    proc.stdout?.on('data', (chunk: string) => {
      buffered += chunk;
      if (buffered.includes('local server listening')) {
        clearTimeout(timer);
        resolve();
      }
    });
    proc.once('exit', () => reject(new TypeError('the local server exited before listening')));
  });
}

// One CLI run to its exit; 'close' waits for stdio to drain.
async function ledger(args: readonly string[]): Promise<{ code: number | null; stdout: string }> {
  const proc = spawn(process.execPath, [cliPath, ...args], {
    env: { ...inherited(), LEDGER_URL: baseUrl, LEDGER_TOKEN: token },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  proc.stdout?.setEncoding('utf8');
  proc.stdout?.on('data', (chunk: string) => {
    stdout += chunk;
  });
  const [code] = (await once(proc, 'close')) as [number | null];
  return { code, stdout };
}

beforeAll(async () => {
  t = await createTestDatabase();
  ({ token } = await issueTestToken(t.db, {
    scope: 'operate',
    tagKey: new Uint8Array(Buffer.from(tokenTagKeyHex, 'hex')),
  }));
  const port = await freePort();
  baseUrl = `http://127.0.0.1:${port}`;
  server = spawn(process.execPath, [mainPath, '--port', String(port)], {
    env: {
      ...inherited(),
      DATABASE_URL: t.runtimeUrl,
      LEDGER_ADDRESS_HASH_KEY: '0b'.repeat(32),
      LEDGER_TOKEN_TAG_KEY: tokenTagKeyHex,
      LEDGER_SIMULATOR_SECRET: simulatorSecret,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await waitForListening(server);
}, 30_000);

afterAll(async () => {
  if (server.exitCode === null && server.signalCode === null) {
    const exited = once(server, 'exit');
    server.kill();
    await exited;
  }
  await t.drop();
}, 30_000);

describe('local reconcile (D23)', () => {
  it('ledger reconcile --dry-run --json exits 1 with reconciler_not_configured; gaps and health show the run', {
    timeout: 60_000,
  }, async () => {
    const reconcile = await ledger(['reconcile', '--dry-run', '--json']);

    expect(reconcile.code).toBe(1);
    const failure = JSON.parse(reconcile.stdout) as { error: { code: string } };
    expect(failure.error.code).toBe('reconciler_not_configured');

    const gaps = await ledger(['gaps']);
    expect(gaps.code).toBe(0);
    const [row] = gaps.stdout.trimEnd().split('\n');
    expect(row).toMatch(/^ {2}\d+ +manual +dry run .*reconciler_not_configured$/);

    const health = await ledger(['health']);
    expect(health.code).toBe(0);
    expect(health.stdout).toMatch(/^reconcile {3}run \d+ reconciler_not_configured$/m);
  });
});
