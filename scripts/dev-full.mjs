#!/usr/bin/env node
// One command from a cold machine to a running local Ledger:
//
//   pnpm dev:full
//
// deps (install only when the lockfile or a package.json changed) → Docker → the compose Postgres
// → `pnpm build` (typecheck) → the apps/local dev server, attached. Each step checks before it
// acts, so on a half-up machine it starts only what is missing. A server already on the API port
// is adopted only when it is this repo's apps/local; anything else there fails the start, so the
// banner never points at another project's app.
//
// It ends in exactly one of two lines, for a log watcher to wait on:
//   LEDGER READY in <n>s
//   LEDGER START FAILED: <reason>
// Ctrl+C stops the dev server and leaves Postgres running; `pnpm dev:stop` stops both.
import { spawn, spawnSync } from 'node:child_process';
import { rmSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import {
  API_PORT,
  DEV_PID_FILE,
  isWindows,
  listeners,
  POSTGRES_PORT,
  processTable,
  repoRoot,
  repoRootOf,
} from './dev-processes.mjs';

const API_URL = `http://127.0.0.1:${API_PORT}`;
const POSTGRES_ADDRESS = `localhost:${POSTGRES_PORT}`;
const DOCKER_TIMEOUT_MS = 90_000;
const DOCKER_PROBE_TIMEOUT_MS = 10_000;
const SERVER_TIMEOUT_MS = 30_000;

const startedAt = Date.now();
const step = (message) => console.log(`\ndev:full: ${message}`);
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const fail = (message) => {
  console.error(`\nLEDGER START FAILED: ${message}\n`);
  process.exit(1);
};
const run = (command) =>
  spawnSync(command, { cwd: repoRoot, shell: true, stdio: 'inherit' }).status === 0;
const quiet = (command, timeout) =>
  spawnSync(command, { cwd: repoRoot, shell: true, stdio: 'ignore', timeout }).status === 0;

/** True when anything answers HTTP at `url`, whatever the status (the app has no routes yet). */
const answers = (url) =>
  new Promise((done) => {
    const probe = request(url, { method: 'GET', timeout: 2000 }, (response) => {
      response.resume();
      done(true);
    });
    probe.once('timeout', () => probe.destroy());
    probe.once('error', () => done(false));
    probe.end();
  });

async function ensureDocker() {
  // `docker info` can hang while the daemon starts, so each probe is capped and the wait is
  // measured on the clock, not counted in iterations.
  if (quiet('docker info', DOCKER_PROBE_TIMEOUT_MS)) return;
  if (!isWindows || !quiet('docker desktop --help', DOCKER_PROBE_TIMEOUT_MS)) {
    fail('Docker is not running');
  }

  step('Docker is not running; starting Docker Desktop…');
  const deadline = Date.now() + DOCKER_TIMEOUT_MS;
  spawnSync('docker desktop start', { shell: true, stdio: 'inherit', timeout: DOCKER_TIMEOUT_MS });
  while (Date.now() < deadline) {
    if (quiet('docker info', DOCKER_PROBE_TIMEOUT_MS)) return;
    await sleep(3000);
  }
  fail('Docker is not running');
}

function banner(adopted) {
  console.log(`
LEDGER READY in ${Math.round((Date.now() - startedAt) / 1000)}s
  api       ${API_URL}${adopted ? ' (already running; adopted)' : ''}
  postgres  ${POSTGRES_ADDRESS} (compose service "postgres")

  stop everything   pnpm dev:stop
  try the CLI       pnpm --filter @ledger/app-cli start --help
`);
}

function stopChild(child) {
  if (child.exitCode !== null) return;
  if (isWindows) {
    spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  } else {
    child.kill('SIGINT');
  }
}

async function startServer() {
  step('starting the apps/local dev server…');
  const child = spawn(`pnpm --filter @ledger/app-local dev --port ${API_PORT}`, {
    cwd: repoRoot,
    shell: true,
    stdio: 'inherit',
  });
  writeFileSync(DEV_PID_FILE, `${JSON.stringify({ pid: child.pid, startedAt: Date.now() })}\n`);

  let exited = false;
  child.once('exit', (code) => {
    exited = true;
    rmSync(DEV_PID_FILE, { force: true });
    process.exitCode = code ?? 0;
  });
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => {
      console.log('\ndev:full: stopping the dev server (Postgres keeps running)…');
      stopChild(child);
    });
  }

  for (let waited = 0; waited < SERVER_TIMEOUT_MS; waited += 500) {
    if (exited) fail('the apps/local dev server exited before it answered; see above');
    if (await answers(API_URL)) return;
    await sleep(500);
  }
  stopChild(child);
  fail(`the apps/local dev server did not answer on ${API_URL} within 30s`);
}

step('checking dependencies…');
if (!run('node scripts/deps.mjs')) fail('installing dependencies failed; see above');

step('checking Docker…');
await ensureDocker();

step('starting Postgres…');
if (!run('docker compose up -d --wait postgres'))
  fail('Postgres did not become healthy; see above');

step('building (typecheck)…');
if (!run('pnpm build')) fail('pnpm build failed; see above');

/**
 * Who holds the API port: 'free', 'ours' (every listener traces to this repo's dev server), or the
 * first foreign listener, which dev:full must neither adopt nor start beside.
 */
function apiPortHolder() {
  const pids = listeners(API_PORT);
  if (pids.length === 0) return 'free';
  const table = processTable();
  if (!table) fail(`port ${API_PORT} is in use and the process table could not be read`);
  const foreign = pids.find((pid) => repoRootOf(pid, table) === undefined);
  if (foreign === undefined) return 'ours';
  const { name = '?' } = table.get(foreign) ?? {};
  return { pid: foreign, name };
}

const holder = apiPortHolder();
if (holder === 'ours') {
  if (!(await answers(API_URL))) {
    fail(`this repo's dev server holds port ${API_PORT} but does not answer; run pnpm dev:stop`);
  }
  banner(true);
} else if (holder === 'free') {
  await startServer();
  banner(false);
} else {
  fail(
    `port ${API_PORT} is held by pid ${holder.pid} (${holder.name}), which is not this repo's apps/local; stop it, then re-run`,
  );
}
