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
import { connect } from 'node:net';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const API_PORT = 3000;
const DEV_PID_FILE = join(repoRoot, 'node_modules', '.ledger-dev.json');
const MARKERS = ['@ledger/app-local', repoRoot.replaceAll('\\', '/').toLowerCase()];

const isWindows = process.platform === 'win32';
const say = (message) => console.log(`dev:stop: ${message}`);
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
// The process table with every command line can pass spawnSync's 1 MiB default buffer on a busy
// machine, which kills the child and reads as "could not read the process table".
const exec = (command, args) =>
  spawnSync(command, args, {
    cwd: repoRoot,
    encoding: 'utf8',
    timeout: 30_000,
    maxBuffer: 64 * 1024 * 1024,
  });

const portInUse = (port) =>
  new Promise((done) => {
    const socket = connect({ host: '127.0.0.1', port });
    socket.once('connect', () => {
      socket.destroy();
      done(true);
    });
    socket.once('error', () => done(false));
  });

/** pid → { ppid, name, cmd } for every process, or undefined when the table cannot be read. */
function processTable() {
  const table = new Map();
  if (isWindows) {
    const result = exec('powershell', [
      '-NoProfile',
      '-Command',
      'Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,CommandLine | ConvertTo-Json -Compress',
    ]);
    if (result.status !== 0) return undefined;
    for (const row of JSON.parse(result.stdout)) {
      table.set(row.ProcessId, {
        ppid: row.ParentProcessId,
        name: row.Name ?? '',
        cmd: row.CommandLine ?? '',
      });
    }
    return table;
  }
  const result = exec('ps', ['-A', '-o', 'pid=,ppid=,comm=,args=']);
  if (result.status !== 0) return undefined;
  for (const line of result.stdout.split('\n')) {
    const match = line.trim().match(/^(\d+)\s+(\d+)\s+(\S+)\s*(.*)$/);
    if (match) {
      table.set(Number(match[1]), { ppid: Number(match[2]), name: match[3], cmd: match[4] });
    }
  }
  return table;
}

const tiedToRepo = (cmd) => {
  const normalized = cmd.replaceAll('\\', '/').toLowerCase();
  return MARKERS.some((marker) => normalized.includes(marker));
};

/** Pids listening on `port` on any address. */
function listeners(port) {
  const pids = new Set();
  if (isWindows) {
    for (const line of exec('netstat', ['-ano']).stdout.split(/\r?\n/)) {
      const [proto, local, remote, , pid] = line.trim().split(/\s+/);
      // A listening socket's remote end is `0.0.0.0:0` or `[::]:0`; the state column is localized.
      if (!proto?.startsWith('TCP') || !remote?.endsWith(':0')) continue;
      if (Number(local.slice(local.lastIndexOf(':') + 1)) === port && Number(pid) > 0) {
        pids.add(Number(pid));
      }
    }
  } else {
    const out = exec('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t']).stdout ?? '';
    for (const pid of out.split(/\s+/).filter(Boolean)) pids.add(Number(pid));
  }
  return [...pids];
}

// The process names a dev-server chain is made of. The ancestor walk stops at the first other
// name, so an editor or terminal launched with the repo path in its command line is never a root.
const CHAIN_NAMES = /^(node|node\.exe|pnpm|pnpm\.exe|cmd\.exe|sh)$/i;

/**
 * The root of the tree to stop for `pid`: its topmost node/pnpm/shell ancestor (itself included)
 * whose command line names this repo, so the `node --watch` parent and the pnpm above it go too.
 * Undefined when nothing in that chain does.
 */
function repoRootOf(pid, table) {
  let root;
  const seen = new Set();
  for (let current = pid; current && table.has(current) && !seen.has(current); ) {
    seen.add(current);
    const { ppid, name, cmd } = table.get(current);
    if (!CHAIN_NAMES.test(name.split('/').pop())) break;
    if (tiedToRepo(cmd)) root = current;
    current = ppid;
  }
  return root;
}

function descendants(root, table) {
  const found = [];
  for (const queue = [root]; queue.length > 0; ) {
    const parent = queue.shift();
    for (const [pid, { ppid }] of table) {
      if (ppid === parent && pid !== parent) {
        found.push(pid);
        queue.push(pid);
      }
    }
  }
  return found;
}

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
