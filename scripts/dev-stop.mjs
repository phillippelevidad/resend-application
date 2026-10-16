#!/usr/bin/env node
// Stops what `pnpm dev:full` (or `pnpm dev`) started:
//
//   pnpm dev:stop
//
// 1. `docker compose stop`: the containers stop and the database volume is kept.
// 2. The dev server: the process tree dev:full recorded, and whatever still listens on the API
//    port. A process is stopped only when it can be tied to this repo: its command line, or an
//    ancestor's, names `@ledger/app-local` or the repo path. Anything else is reported by PID and
//    left alone.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import {
  API_PORT,
  DEV_PID_FILE,
  descendants,
  exec,
  isWindows,
  listeners,
  portInUse,
  processTable,
  repoRoot,
  repoRootOf,
} from './dev-processes.mjs';

const say = (message) => console.log(`dev:stop: ${message}`);
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

function stopTree(pid, table, why) {
  if (isWindows) {
    const result = exec('taskkill', ['/PID', String(pid), '/T', '/F']);
    say(
      `stopped pid ${pid} and its children (${why})${result.status === 0 ? '' : `: ${result.stderr.trim()}`}`,
    );
    return;
  }
  for (const child of descendants(pid, table).reverse()) {
    try {
      process.kill(child, 'SIGTERM');
    } catch {
      // Already gone.
    }
  }
  try {
    process.kill(pid, 'SIGTERM');
    say(`stopped pid ${pid} and its children (${why})`);
  } catch (error) {
    say(`could not stop pid ${pid} (${why}): ${error.message}`);
  }
}

// Read only: main removes the file once the process table is read, so a failed read keeps it.
function recordedPid() {
  if (!existsSync(DEV_PID_FILE)) return undefined;
  let pid;
  try {
    pid = Number(JSON.parse(readFileSync(DEV_PID_FILE, 'utf8')).pid);
  } catch {
    pid = undefined;
  }
  return pid || undefined;
}

async function main() {
  const compose = spawnSync('docker compose stop', {
    cwd: repoRoot,
    shell: true,
    stdio: 'inherit',
  });
  say(
    compose.status === 0
      ? 'compose services stopped (the database volume is kept).'
      : 'docker compose stop failed (is Docker running?); continuing with the dev server.',
  );

  const recorded = recordedPid();
  const busy = await portInUse(API_PORT);
  if (!recorded && !busy) {
    rmSync(DEV_PID_FILE, { force: true });
    say(`nothing listens on port ${API_PORT}.`);
    return;
  }

  const table = processTable();
  if (!table) {
    console.error('dev:stop: could not read the process table; stop the dev server by hand.');
    process.exit(1);
  }
  rmSync(DEV_PID_FILE, { force: true });

  const roots = new Map();
  // The recorded pid counts only while its command line still names the dev server: pids are
  // reused, and a reused pid whose command line merely names the repo path (an editor opened on
  // it) must never have its tree stopped.
  if (recorded && table.has(recorded) && table.get(recorded).cmd.includes('@ledger/app-local')) {
    roots.set(recorded, 'started by dev:full');
  }
  let refused = false;
  for (const pid of listeners(API_PORT)) {
    const root = repoRootOf(pid, table);
    if (root === undefined) {
      const { name = '?', cmd = '' } = table.get(pid) ?? {};
      console.error(
        `dev:stop: pid ${pid} (${name}) listens on port ${API_PORT} but cannot be tied to this repo; leaving it alone.\n  ${cmd}`,
      );
      refused = true;
    } else if (
      !roots.has(root) &&
      ![...roots.keys()].some((known) => descendants(known, table).includes(root))
    ) {
      roots.set(root, `listening on port ${API_PORT}`);
    }
  }
  for (const [pid, why] of roots) stopTree(pid, table, why);

  if (refused) process.exit(1);
  for (let waited = 0; waited < 10; waited += 1) {
    if (!(await portInUse(API_PORT))) {
      say(`port ${API_PORT} is free.`);
      return;
    }
    await sleep(1000);
  }
  console.error(`dev:stop: port ${API_PORT} still answers; see above.`);
  process.exit(1);
}

await main();
