import { type ChildProcess, spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const mainPath = fileURLToPath(new URL('./main.ts', import.meta.url));
const startupTimeoutMs = 15_000;

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

function startLocal(args: readonly string[]): ChildProcess {
  child = spawn(process.execPath, [mainPath, ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
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

function waitForListening(proc: ChildProcess): Promise<{ level: string; message: string }> {
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
      const lines = buffered.split('\n');
      lines.pop();
      const line = lines.find((l) => l.includes('local server listening'));
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
  it('serves the routeless @ledger/api on loopback, proving Node 24 type stripping runs a workspace package through the pnpm node_modules link', {
    timeout: startupTimeoutMs + 5_000,
  }, async () => {
    const port = await freePort();
    const proc = startLocal(['--port', String(port)]);

    const listening = await waitForListening(proc);
    expect(listening).toEqual({ level: 'info', message: 'local server listening' });

    const response = await fetch(`http://127.0.0.1:${port}/`);
    expect(response.status).toBe(404);
  });

  it('exits 1 and serves nothing when --host is not loopback, so unauthenticated routes never leave the machine', {
    timeout: startupTimeoutMs + 5_000,
  }, async () => {
    const port = await freePort();
    const proc = startLocal(['--host', '0.0.0.0', '--port', String(port)]);
    const stdout = collect(proc.stdout);
    const stderr = collect(proc.stderr);

    // 'close' waits for stdio to drain, so the captured output is complete.
    const [code] = await once(proc, 'close');

    expect(code).toBe(1);
    expect(stdout.text()).toBe('');
    expect(JSON.parse(stderr.text())).toMatchObject({ level: 'error' });
  });
});
