#!/usr/bin/env node
import { existsSync, mkdirSync, readdirSync, rmSync, symlinkSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const sourceDir = join(repoRoot, '.agents', 'skills');
const claudeDir = join(repoRoot, '.claude');
const targetDir = join(claudeDir, 'skills');

if (!existsSync(sourceDir)) {
  console.error(`Source directory not found: ${sourceDir}`);
  process.exit(1);
}

rmSync(targetDir, { recursive: true, force: true });
mkdirSync(claudeDir, { recursive: true });
mkdirSync(targetDir, { recursive: true });

const entries = readdirSync(sourceDir, { withFileTypes: true }).filter((entry) =>
  entry.isDirectory(),
);

for (const entry of entries) {
  const sourcePath = resolve(sourceDir, entry.name);
  const linkPath = join(targetDir, entry.name);

  if (process.platform === 'win32') {
    symlinkSync(sourcePath, linkPath, 'junction');
  } else {
    symlinkSync(relative(targetDir, sourcePath), linkPath, 'dir');
  }

  console.log(`${entry.name} -> ${relative(repoRoot, sourcePath)}`);
}

console.log(`Synced ${entries.length} skills to ${relative(repoRoot, targetDir)}`);
