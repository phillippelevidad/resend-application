#!/usr/bin/env node
// Brings node_modules up to date after a pull, a merge or a branch switch, and does nothing when
// nothing changed:
//
//   pnpm deps
//
// It hashes pnpm-lock.yaml, pnpm-workspace.yaml and every workspace package.json, and keeps the
// hash in node_modules (so deleting node_modules forgets it). A changed hash, or no node_modules,
// runs `pnpm install`; an unchanged one exits at once.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const HASH_FILE = join(repoRoot, 'node_modules', '.ledger-deps-hash');
const say = (message) => console.log(`deps: ${message}`);

/** The workspace globs from pnpm-workspace.yaml: `dir/*` (every child folder) or `dir`. */
function workspaceDirs() {
  const yaml = readFileSync(join(repoRoot, 'pnpm-workspace.yaml'), 'utf8');
  const patterns = [...yaml.matchAll(/^\s*-\s*["']?([^"'\s#]+)["']?/gm)].map((match) => match[1]);
  const dirs = [];
  for (const pattern of patterns) {
    if (pattern.endsWith('/*')) {
      const parent = join(repoRoot, pattern.slice(0, -2));
      if (!existsSync(parent)) continue;
      for (const entry of readdirSync(parent, { withFileTypes: true })) {
        if (entry.isDirectory()) dirs.push(`${pattern.slice(0, -2)}/${entry.name}`);
      }
    } else {
      dirs.push(pattern);
    }
  }
  return dirs.sort();
}

/** sha256 over each file's path and bytes; a missing file hashes as absent. */
function fingerprint() {
  const files = [
    'pnpm-lock.yaml',
    'pnpm-workspace.yaml',
    'package.json',
    ...workspaceDirs().map((dir) => `${dir}/package.json`),
  ];
  const hash = createHash('sha256');
  for (const file of files) {
    const path = join(repoRoot, file);
    hash.update(`${file}\0`);
    hash.update(existsSync(path) ? readFileSync(path) : '<missing>');
    hash.update('\0');
  }
  return hash.digest('hex');
}

const stored = existsSync(HASH_FILE) ? readFileSync(HASH_FILE, 'utf8').trim() : undefined;
if (stored && stored === fingerprint()) {
  say('dependencies unchanged; nothing to install.');
  process.exit(0);
}

say(
  stored
    ? 'the lockfile or a package.json changed; running pnpm install.'
    : 'no install recorded; running pnpm install.',
);
const { status } = spawnSync('pnpm install', { cwd: repoRoot, shell: true, stdio: 'inherit' });
if (status !== 0) {
  console.error('deps: pnpm install failed; see above.');
  process.exit(1);
}
// Hashed after the install, which may rewrite the lockfile.
writeFileSync(HASH_FILE, `${fingerprint()}\n`);
say('dependencies installed and recorded.');
