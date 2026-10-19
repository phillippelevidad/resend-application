import { type ChildProcess, spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { signWebhook } from '@ledger/core/testing';
import { mintApiToken } from '@ledger/shared';
import { afterEach, describe, expect, it } from 'vitest';

const mainPath = fileURLToPath(new URL('./main.ts', import.meta.url));
const startupTimeoutMs = 15_000;

// Placeholders the boot assertion accepts. No Postgres listens at the URL (port 9 is discard), so
// the process runs as during a database outage: `pg` connects on the first query, and that query
// fails. The secret is built at run time, so no `whsec_` literal sits in the source (the gitleaks
// rule).
const tokenTagKeyHex = '5c'.repeat(32);
const placeholderEnv = {
  DATABASE_URL: 'postgres://127.0.0.1:9/ledger',
  LEDGER_ADDRESS_HASH_KEY: '0a'.repeat(32),
  LEDGER_TOKEN_TAG_KEY: tokenTagKeyHex,
  LEDGER_SIMULATOR_SECRET: `whsec_${Buffer.from('ledger-local-e2e-placeholder').toString('base64')}`,
};

// The process reads only what the test passes: the developer's shell exports are removed, and the
// child runs `node main.ts` with no `--env-file`, so `.env.local` never applies.
const configNames = [
  'DATABASE_URL',
  'LEDGER_ADDRESS_HASH_KEY',
  'LEDGER_TOKEN_TAG_KEY',
  'LEDGER_WEBHOOK_SECRETS',
  'LEDGER_SIMULATOR_SECRET',
];

let child: ChildProcess | undefined;

async function freePort(): Promise<number> {
  const probe = createServer();
  probe.listen(0, '127.0.0.1');
  await once(probe, 'listening');
  const address = probe.address();
  probe.close();
  await once(probe, 'close');
  if (address === null || typeof address === 'string') {
    expect.unreachable('a TCP listener always reports an AddressInfo');
  }
  return address.port;
}

function startLocal(
  args: readonly string[],
  env: Readonly<Record<string, string>> = placeholderEnv,
): ChildProcess {
  const inherited = { ...process.env };
  for (const name of configNames) delete inherited[name];
  child = spawn(process.execPath, [mainPath, ...args], {
    env: { ...inherited, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return child;
}

function collect(stream: NodeJS.ReadableStream | null): { text: () => string } {
  let text = '';
  stream?.setEncoding('utf8');
  stream?.on('data', (chunk: string) => {
    text += chunk;
  });
  return { text: () => text };
}

function lines(text: string): Record<string, unknown>[] {
  return text
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

// Runs a process expected to refuse, to completion. 'close' waits for stdio to drain, so the
// captured output is complete.
async function runToExit(
  args: readonly string[],
  env?: Readonly<Record<string, string>>,
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  const proc = startLocal(args, env);
  const stdout = collect(proc.stdout);
  const stderr = collect(proc.stderr);
  const [code] = (await once(proc, 'close')) as [number | null];
  return { code, stdout: stdout.text(), stderr: stderr.text() };
}

function waitForListening(proc: ChildProcess): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let buffered = '';
    const timer = setTimeout(
      () => reject(new Error('no listening line before the startup timeout')),
      startupTimeoutMs,
    );
    proc.stdout?.setEncoding('utf8');
    proc.stdout?.on('data', (chunk: string) => {
      buffered += chunk;
      // Complete lines only: a chunk can end mid-line, and a partial line does not parse.
      const complete = buffered.split('\n');
      complete.pop();
      const line = complete.find((l) => l.includes('local server listening'));
      if (line !== undefined) {
        clearTimeout(timer);
        resolve(JSON.parse(line));
      }
    });
    proc.once('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`local server exited with code ${code} before listening`));
    });
  });
}

afterEach(async () => {
  const proc = child;
  child = undefined;
  if (proc !== undefined && proc.exitCode === null && proc.signalCode === null) {
    const exited = once(proc, 'exit');
    proc.kill();
    await exited;
  }
});

describe('apps/local main.ts', () => {
  it('serves the read API and ingest on loopback with no reachable database: 401 without a token, health on the tag alone, and 401 unauthorized for an unsigned webhook', {
    timeout: startupTimeoutMs + 5_000,
  }, async () => {
    const port = await freePort();
    const proc = startLocal(['--port', String(port)]);

    const listening = await waitForListening(proc);
    expect(listening).toMatchObject({
      level: 'info',
      function_name: 'local',
      message: 'local server listening',
    });

    // D18: every mode enforces the bearer token, an unmatched path included.
    const root = await fetch(`http://127.0.0.1:${port}/`);
    expect(root.status).toBe(401);
    expect(await root.json()).toMatchObject({ error: { code: 'unauthorized' } });

    // D18, D19: with the database unreachable, `health.get` answers on the token's tag alone.
    const token = mintApiToken(new Uint8Array(Buffer.from(tokenTagKeyHex, 'hex'))).token;
    const health = await fetch(`http://127.0.0.1:${port}/health`, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(health.status).toBe(200);
    expect(await health.json()).toMatchObject({
      object: 'health',
      queue: { visible: 0, in_flight: 0, oldest_age_seconds: null },
      event_source: { state: 'enabled' },
      database: { reachable: false, storage_bytes: null },
    });

    const unsigned = await fetch(`http://127.0.0.1:${port}/webhooks/resend`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'email.sent', data: { email_id: 'e2e-unsigned' } }),
    });
    expect(unsigned.status).toBe(401);
    expect(unsigned.headers.get('content-type')).toBe('text/plain; charset=utf-8');
    expect(await unsigned.text()).toBe('unauthorized');
  });

  // D13: locally the Resend secret set reaches ingest through `StaticSecretReaderAdapter` over the
  // parsed `LEDGER_WEBHOOK_SECRETS`. A wrong id or value shape there answers every signed delivery
  // `503`; the unsigned case above never reads the set. Ingest answers after the in-process
  // enqueue, before the worker touches the (unreachable) database.
  it('accepts a delivery signed with a LEDGER_WEBHOOK_SECRETS secret: 200 ok', {
    timeout: startupTimeoutMs + 5_000,
  }, async () => {
    const webhookSecret = `whsec_${Buffer.from('ledger-local-e2e-resend').toString('base64')}`;
    const port = await freePort();
    const proc = startLocal(['--port', String(port)], {
      ...placeholderEnv,
      LEDGER_WEBHOOK_SECRETS: webhookSecret,
    });
    await waitForListening(proc);

    const body = JSON.stringify({
      type: 'email.sent',
      created_at: '2026-10-17T12:00:00.000Z',
      data: { email_id: 'e2e-signed', to: ['delivered@resend.dev'] },
    });
    const signed = await fetch(`http://127.0.0.1:${port}/webhooks/resend`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...signWebhook({
          secret: webhookSecret,
          svixId: 'msg_e2e_signed',
          timestamp: Math.floor(Date.now() / 1000),
          body,
        }),
      },
      body,
    });
    expect(signed.status).toBe(200);
    expect(await signed.text()).toBe('ok');
  });

  it('exits 1 and serves nothing when --host is not loopback', {
    timeout: startupTimeoutMs + 5_000,
  }, async () => {
    const port = await freePort();
    const { code, stdout, stderr } = await runToExit(['--host', '0.0.0.0', '--port', String(port)]);

    expect(code).toBe(1);
    expect(stderr).toBe('');
    const logged = lines(stdout);
    expect(logged).toHaveLength(1);
    expect(logged[0]).toMatchObject({
      level: 'error',
      function_name: 'local',
      message: 'refusing to start: --host must be 127.0.0.1, ::1 or localhost',
    });
  });

  it('exits 1 naming LEDGER_TOKEN_TAG_KEY when it is unset, and never prints a configured value', {
    timeout: startupTimeoutMs + 5_000,
  }, async () => {
    const { LEDGER_TOKEN_TAG_KEY: _unset, ...env } = placeholderEnv;
    const { code, stdout } = await runToExit(['--port', String(await freePort())], env);

    expect(code).toBe(1);
    const logged = lines(stdout);
    expect(logged).toEqual([
      expect.objectContaining({
        level: 'error',
        message: 'refusing to start: LEDGER_TOKEN_TAG_KEY must be 64 lowercase hex characters',
      }),
    ]);
    for (const value of Object.values(env)) expect(stdout).not.toContain(value);
  });

  it('exits 1 naming LEDGER_ADDRESS_HASH_KEY when it is unset, and never prints a configured value', {
    timeout: startupTimeoutMs + 5_000,
  }, async () => {
    const { LEDGER_ADDRESS_HASH_KEY: _unset, ...env } = placeholderEnv;
    const { code, stdout } = await runToExit(['--port', String(await freePort())], env);

    expect(code).toBe(1);
    const logged = lines(stdout);
    expect(logged.length).toBeGreaterThan(0);
    for (const line of logged) expect(line).toMatchObject({ level: 'error' });
    expect(logged.map((line) => line.message).join('\n')).toContain('LEDGER_ADDRESS_HASH_KEY');
    expect(stdout).not.toContain('listening');
    for (const value of Object.values(env)) expect(stdout).not.toContain(value);
  });

  it('exits 1 when no signing secret is set at all, because an empty secret set would answer 401 to every delivery', {
    timeout: startupTimeoutMs + 5_000,
  }, async () => {
    const { LEDGER_SIMULATOR_SECRET: _unset, ...env } = placeholderEnv;
    const { code, stdout } = await runToExit(['--port', String(await freePort())], env);

    expect(code).toBe(1);
    const logged = lines(stdout);
    expect(logged).toHaveLength(1);
    expect(logged[0]).toMatchObject({ level: 'error' });
    expect(String(logged[0]?.message)).toContain('LEDGER_WEBHOOK_SECRETS');
    expect(String(logged[0]?.message)).toContain('LEDGER_SIMULATOR_SECRET');
    for (const value of Object.values(env)) expect(stdout).not.toContain(value);
  });
});
