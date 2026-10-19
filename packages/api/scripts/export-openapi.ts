// D42: writes the read API's OpenAPI 3.1 document, generated from the route schemas, to
// `<out>/openapi.json` (2-space indent, final newline). `pnpm openapi:export` runs it with the
// default `--out packages/sdk`; the `drift` stage runs it into a temp directory (ADR-011).
//
//   node packages/api/scripts/export-openapi.ts [--out <dir>]
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { createDatabase, STORAGE_LIMIT_BYTES } from '@ledger/db';
import {
  InProcessFunctionInvokeAdapter,
  InProcessQueueAdapter,
  type Logger,
  StaticEventSourceControlAdapter,
} from '@ledger/shared';
import { createApi } from '../src/create-api.ts';

const repoRoot = resolve(fileURLToPath(new URL('../../..', import.meta.url)));

const { values } = parseArgs({
  options: { out: { type: 'string' } },
  strict: true,
  allowPositionals: false,
});
const outDir = values.out === undefined ? resolve(repoRoot, 'packages/sdk') : resolve(values.out);

const silent: Logger = { info: () => {}, warn: () => {}, error: () => {} };

// Inert deps: the document comes from the route schemas alone. `pg` opens no connection until a
// query, and none runs here.
const database = createDatabase({
  url: 'postgres://inert@127.0.0.1:1/inert',
  max: 1,
  logger: silent,
});
// The local port implementations, never called: no route runs while the document is generated.
const queue = new InProcessQueueAdapter({ clock: { now: () => new Date() }, logger: silent });
const api = createApi({
  db: database.db,
  logger: silent,
  addressHashKey: new Uint8Array(32),
  tokenTagKey: new Uint8Array(32),
  requestId: () => 'export',
  queueAttributes: queue,
  eventSource: new StaticEventSourceControlAdapter(),
  workerInvoke: new InProcessFunctionInvokeAdapter(async () => undefined),
  dlq: queue,
  storageLimitBytes: STORAGE_LIMIT_BYTES,
});

const document = api.getOpenAPI31Document({
  openapi: '3.1.0',
  info: { title: 'Ledger read API', version: '0.0.0' },
});

writeFileSync(resolve(outDir, 'openapi.json'), `${JSON.stringify(document, null, 2)}\n`);
await database.pool.end();
