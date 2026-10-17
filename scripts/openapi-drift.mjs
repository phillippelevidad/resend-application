#!/usr/bin/env node
// The `drift` stage of `pnpm verify` (design D42, ADR-011): the committed contract files MUST equal
// what `packages/api` generates now, so the SDK never ships types for a contract the API no longer
// serves.
//
//   node scripts/openapi-drift.mjs
//
// It regenerates `openapi.json` and `openapi-types.ts` into a fresh temp dir, the same two commands
// `pnpm openapi:export` runs, then compares bytes with `packages/sdk/openapi.json` and
// `packages/sdk/src/openapi-types.ts` (LF on every checkout, `.gitattributes`). A canary runs first,
// on every run: a copy of the fresh `openapi.json` with one byte changed MUST be reported as drift,
// or the stage fails without comparing the committed files. Node built-ins only.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));

const FILES = [
  { name: 'openapi.json', committed: 'packages/sdk/openapi.json' },
  { name: 'openapi-types.ts', committed: 'packages/sdk/src/openapi-types.ts' },
];

/** `true` when `actual` is missing or not byte-for-byte `expected`. The one comparison the canary proves. */
function differs(expected, actual) {
  return actual === undefined || !expected.equals(actual);
}

/** Runs one generation command from the repo root; `false` when it fails. */
function run(command) {
  const { status } = spawnSync(command, {
    cwd: repoRoot,
    shell: true,
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  if (status !== 0) {
    console.error(`drift: regeneration failed: ${command}`);
    return false;
  }
  return true;
}

function check(temp) {
  const freshJson = join(temp, 'openapi.json');
  const freshTypes = join(temp, 'openapi-types.ts');
  if (
    !run(`node packages/api/scripts/export-openapi.ts --out "${temp}"`) ||
    !run(`pnpm --filter @ledger/sdk exec openapi-typescript "${freshJson}" -o "${freshTypes}"`)
  ) {
    return 1;
  }
  const fresh = new Map(FILES.map(({ name }) => [name, readFileSync(join(temp, name))]));

  const document = fresh.get('openapi.json');
  const canary = Buffer.from(document);
  const at = Math.floor(canary.length / 2);
  canary[at] = canary[at] ^ 0x01;
  if (!differs(document, canary)) {
    console.error('drift: canary missed 0/1; the comparison cannot see a changed byte');
    return 1;
  }
  console.log('drift: canary caught 1/1');

  let drifted = false;
  for (const { name, committed } of FILES) {
    const path = join(repoRoot, committed);
    if (differs(fresh.get(name), existsSync(path) ? readFileSync(path) : undefined)) {
      console.error(
        `drift: ${committed} differs from packages/api; run pnpm openapi:export and read the diff (a changed contract is Ask-first)`,
      );
      drifted = true;
    }
  }
  if (drifted) {
    return 1;
  }
  console.log('drift: openapi.json and openapi-types.ts match packages/api');
  return 0;
}

const temp = mkdtempSync(join(tmpdir(), 'ledger-drift-'));
let code;
try {
  code = check(temp);
} finally {
  rmSync(temp, { recursive: true, force: true });
}
process.exit(code);
