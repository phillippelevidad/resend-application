import { parseArgs } from 'node:util';
import { serve } from '@hono/node-server';
import { createApi } from '@ledger/api';
import { isLoopbackHost } from './is-loopback-host.ts';

// Composition root for local mode (ADR-013): the same package factories the Lambdas use, served
// by @hono/node-server. stdout carries only the listening line, which scripts wait for.

function refuse(message: string, fields: Record<string, string> = {}): never {
  process.stderr.write(`${JSON.stringify({ level: 'error', message, ...fields })}\n`);
  process.exit(1);
}

function readFlags(): { port: number; host: string } {
  let values: { port: string; host: string };
  try {
    ({ values } = parseArgs({
      options: {
        // Clear of the other local stacks; scripts/dev-processes.mjs carries the same number.
        port: { type: 'string', default: '3200' },
        host: { type: 'string', default: '127.0.0.1' },
      },
      strict: true,
      allowPositionals: false,
    }));
  } catch {
    refuse('refusing to start: unknown or malformed flag; the flags are --port and --host');
  }
  if (!/^\d{1,5}$/.test(values.port) || Number(values.port) > 65535) {
    refuse('refusing to start: --port must be an integer from 0 to 65535');
  }
  // Auth is skipped in slice 1, so only a loopback bind is allowed (api-contract.md → Conventions).
  if (!isLoopbackHost(values.host)) {
    refuse(
      'refusing to start: --host must be 127.0.0.1, ::1 or localhost because local mode skips auth',
    );
  }
  return { port: Number(values.port), host: values.host };
}

const { port, host } = readFlags();
const api = createApi();

const server = serve({ fetch: api.fetch, hostname: host, port }, () => {
  // Log fields are allow-listed (data-modeling.md → Log fields): no url or port field.
  process.stdout.write(`${JSON.stringify({ level: 'info', message: 'local server listening' })}\n`);
});

server.on('error', (error: NodeJS.ErrnoException) => {
  refuse('local server failed to listen', { error_name: error.code ?? error.name });
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    server.close();
  });
}
