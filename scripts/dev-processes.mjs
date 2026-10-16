// What `dev:full` and `dev:stop` share: the local ports, the pid file, and how a process is tied
// to this repo before either script adopts or stops it.
import { spawnSync } from 'node:child_process';
import { connect } from 'node:net';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const repoRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));

// Chosen clear of the other local stacks this machine runs side by side (3000–3003, 3100–3103,
// 5432, 54320–54329, 6379, 6380, 8080, 8108, 8180) and of Windows' excluded port ranges.
// apps/local's `--port` default and compose.yaml's host port carry the same numbers.
export const API_PORT = 3200;
export const POSTGRES_PORT = 55432;

// dev:full writes it; dev:stop reads it to stop the tree dev:full spawned.
export const DEV_PID_FILE = join(repoRoot, 'node_modules', '.ledger-dev.json');

export const isWindows = process.platform === 'win32';

const MARKERS = ['@ledger/app-local', repoRoot.replaceAll('\\', '/').toLowerCase()];

// The process table with every command line can pass spawnSync's 1 MiB default buffer on a busy
// machine, which kills the child and reads as "could not read the process table".
export const exec = (command, args) =>
  spawnSync(command, args, {
    cwd: repoRoot,
    encoding: 'utf8',
    timeout: 30_000,
    maxBuffer: 64 * 1024 * 1024,
  });

export const portInUse = (port) =>
  new Promise((done) => {
    const socket = connect({ host: '127.0.0.1', port });
    socket.once('connect', () => {
      socket.destroy();
      done(true);
    });
    socket.once('error', () => done(false));
  });

/** pid → { ppid, name, cmd } for every process, or undefined when the table cannot be read. */
export function processTable() {
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
export function listeners(port) {
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
export function repoRootOf(pid, table) {
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

export function descendants(root, table) {
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
