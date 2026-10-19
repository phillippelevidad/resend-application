import { randomUUID } from 'node:crypto';
import { parseArgs } from 'node:util';
import { serve } from '@hono/node-server';
import { createApi } from '@ledger/api';
import { createDatabase, STORAGE_LIMIT_BYTES } from '@ledger/db';
import { createIngest } from '@ledger/ingest';
import {
  type ClockPort,
  ConfigError,
  createLogger,
  InProcessFunctionInvokeAdapter,
  InProcessQueueAdapter,
  type Logger,
  LogMetricsAdapter,
  loadConfig,
  StaticEventSourceControlAdapter,
  StaticSecretReaderAdapter,
} from '@ledger/shared';
import { createWorker } from '@ledger/worker';
import { ingestFetch } from './ingest-fetch.ts';
import { isLoopbackHost } from './is-loopback-host.ts';
import { configFailureMessage, type LocalConfig, localConfigSchema } from './local.config.ts';

// Composition root for local mode (ADR-013, D29): the same package factories the Lambdas use, in
// one loopback process over the in-process queue, served by @hono/node-server. Every line is the
// shared logger's JSON on stdout (design.md → Log output).

// One logger per composed function (D15), and one for the process's own lines (boot, listening).
const processLogger = createLogger({ functionName: 'local' });

type Flags = { port: number; host: string };

// A refusal sets the exit code instead of calling `process.exit`, so the logger's line drains
// before the process ends; nothing else is running yet to keep it alive.
function refuse(logger: Logger, message: string): undefined {
  logger.error(message);
  process.exitCode = 1;
  return undefined;
}

function readFlags(): Flags | undefined {
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
    return refuse(
      processLogger,
      'refusing to start: unknown or malformed flag; the flags are --port and --host',
    );
  }
  if (!/^\d{1,5}$/.test(values.port) || Number(values.port) > 65535) {
    return refuse(processLogger, 'refusing to start: --port must be an integer from 0 to 65535');
  }
  // D40: local mode binds loopback only; slice 2B decides the bind for `docker compose`.
  if (!isLoopbackHost(values.host)) {
    return refuse(processLogger, 'refusing to start: --host must be 127.0.0.1, ::1 or localhost');
  }
  return { port: Number(values.port), host: values.host };
}

// D29: one line per failing variable, naming it and never its value.
function readConfig(): LocalConfig | undefined {
  try {
    return loadConfig(localConfigSchema, process.env);
  } catch (error) {
    if (!(error instanceof ConfigError)) throw error;
    for (const issue of error.issues) processLogger.error(configFailureMessage(issue.variable));
    process.exitCode = 1;
    return undefined;
  }
}

function start({ port, host }: Flags, config: LocalConfig): void {
  const clock: ClockPort = { now: () => new Date() };
  const ingestLogger = createLogger({ functionName: 'ingest' });
  const workerLogger = createLogger({ functionName: 'worker' });
  const apiLogger = createLogger({ functionName: 'api' });

  // ADR-005, D29: one size-1 pool per function that touches the database; ingest has none. Locally
  // both connect with `DATABASE_URL` as the owner (D30). `pg` connects lazily, on the first query.
  const workerDatabase = createDatabase({ url: config.databaseUrl, max: 1, logger: workerLogger });
  const apiDatabase = createDatabase({ url: config.databaseUrl, max: 1, logger: apiLogger });

  const queue = new InProcessQueueAdapter({ clock, logger: workerLogger });
  // D13: ingest reads both secrets through the port in both runtimes. Locally the Resend set is the
  // parsed `LEDGER_WEBHOOK_SECRETS`, held under one local id in the JSON form Secrets Manager holds
  // on AWS, and the simulator secret, when `LEDGER_SIMULATOR_SECRET` is set, its bare `whsec_` string
  // under a second id.
  const signingSecretsId = 'local/webhook-signing-secrets';
  const simulatorSecret = config.secrets.simulator;
  const simulatorSecretId = 'local/simulator-signing-secret';
  const ingest = createIngest({
    secretReader: new StaticSecretReaderAdapter({
      [signingSecretsId]: JSON.stringify(config.secrets.resend),
      ...(simulatorSecret === undefined ? {} : { [simulatorSecretId]: simulatorSecret }),
    }),
    signingSecretsId,
    simulatorSecretId: simulatorSecret === undefined ? undefined : simulatorSecretId,
    queue,
    clock,
    logger: ingestLogger,
    metrics: new LogMetricsAdapter(ingestLogger),
  });
  const worker = createWorker({
    database: workerDatabase,
    // D40: no event source mapping to pause locally; it reports `enabled`, so `resume` answers
    // `already_enabled` and opens no connection.
    eventSource: new StaticEventSourceControlAdapter(),
    storageLimitBytes: STORAGE_LIMIT_BYTES,
    clock,
    logger: workerLogger,
    metrics: new LogMetricsAdapter(workerLogger),
    addressHashKey: config.addressHashKey,
  });
  // D40: the same middleware as on AWS, under the local tag key; the in-process queue reports its
  // own counts, the static event source `enabled`, and the resume runs the local worker in process,
  // which answers `already_enabled`. Slice 3 D9: the in-process queue's dead list is the DLQ, until
  // slice 2B's Postgres queue.
  const api = createApi({
    db: apiDatabase.db,
    logger: apiLogger,
    addressHashKey: config.addressHashKey,
    tokenTagKey: config.tokenTagKey,
    requestId: () => randomUUID(),
    queueAttributes: queue,
    eventSource: new StaticEventSourceControlAdapter(),
    workerInvoke: new InProcessFunctionInvokeAdapter(() => worker.resume()),
    dlq: queue,
    storageLimitBytes: STORAGE_LIMIT_BYTES,
  });

  // D32: the ingest endpoint (api-contract.md → Ingest boundary) goes to ingest, as slice 2's HTTP
  // API routes it; everything else reaches the read API, where an unmatched path answers
  // `route_not_found`.
  const handleIngest = ingestFetch(ingest);
  const fetch = (request: Request): Response | Promise<Response> =>
    request.method === 'POST' && new URL(request.url).pathname === '/webhooks/resend'
      ? handleIngest(request)
      : api.fetch(request);

  queue.start(worker.processBatch);

  const closePools = (): void => {
    void workerDatabase.pool.end();
    void apiDatabase.pool.end();
  };

  const server = serve({ fetch, hostname: host, port }, () => {
    // Log fields are allow-listed (data-modeling.md → Log fields): no url or port field.
    processLogger.info('local server listening');
  });

  server.on('error', (error: NodeJS.ErrnoException) => {
    processLogger.error('local server failed to listen', { error_name: error.code ?? error.name });
    process.exitCode = 1;
    closePools();
  });

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => {
      server.close();
      closePools();
    });
  }
}

const flags = readFlags();
const config = flags === undefined ? undefined : readConfig();
if (flags !== undefined && config !== undefined) start(flags, config);
