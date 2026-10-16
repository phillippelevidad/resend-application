#!/usr/bin/env node
// The full gate. CI runs exactly `pnpm verify` (.github/workflows/ci.yml), so this file is the
// one list of CI stages and a green run here is the evidence CI produces.
//
//   pnpm verify                  every stage, in order, stopping at the first failure
//   pnpm verify --from <stage>   resume from a stage after a fix (a partial run, not the gate)
//
// Exit 0 with `VERIFY PASSED` means every stage ran and passed. A partial run ends in
// `VERIFY PARTIAL`, never `VERIFY PASSED`. No stage can be skipped: this file needs only Node
// built-ins, so CI runs it before anything is installed and the install stage runs everywhere.
import { spawnSync } from 'node:child_process';

// Later slices add a stage by adding one entry here, each when it has something to check:
// the README link check (slice 0), the `int` tier with its first Testcontainers
// test and OpenAPI and SDK drift (slice 1), migration lint (slice 2).
const STAGES = [
  { name: 'install', command: 'pnpm install --frozen-lockfile' },
  {
    name: 'docker',
    command: 'docker info',
    quiet: true,
    hint: 'Docker is not running. Start Docker Desktop (or the Docker daemon) and re-run: the integration tests (Testcontainers) and the secret scan need it.',
  },
  { name: 'secrets', command: 'node scripts/secret-scan.mjs' },
  { name: 'lint', command: 'pnpm exec biome ci .' },
  { name: 'typecheck', command: 'pnpm typecheck' },
  { name: 'unit', command: 'pnpm test' },
  { name: 'synth', command: 'pnpm --filter @ledger/infra synth' },
  { name: 'e2e', command: 'pnpm test:e2e' },
];

const names = STAGES.map((stage) => stage.name);

function parseFrom(argv) {
  const index = argv.indexOf('--from');
  if (index === -1) return undefined;
  const from = argv[index + 1];
  if (!names.includes(from)) {
    console.error(`[verify] --from needs one of: ${names.join(', ')}`);
    process.exit(2);
  }
  return from;
}

const from = parseFrom(process.argv.slice(2));
const firstIndex = from ? names.indexOf(from) : 0;
const results = new Map();
let failed;

for (const [index, stage] of STAGES.entries()) {
  if (index < firstIndex) {
    results.set(stage.name, { status: 'not run', note: '--from' });
    continue;
  }
  if (failed) {
    results.set(stage.name, { status: 'not run', note: `after ${failed} failed` });
    continue;
  }
  console.log(`\n[verify] ▶ ${stage.name}\n$ ${stage.command}`);
  const startedAt = Date.now();
  const { status, error } = spawnSync(stage.command, {
    shell: true,
    stdio: stage.quiet ? 'ignore' : 'inherit',
  });
  const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);

  if (status === 0) {
    console.log(`[verify] ✔ ${stage.name} (${seconds}s)`);
    results.set(stage.name, { status: 'passed', note: `${seconds}s` });
  } else {
    console.error(`[verify] ✘ ${stage.name} (${seconds}s)`);
    if (error) console.error(`[verify]   ${error.message}`);
    if (stage.hint) console.error(`[verify]   ${stage.hint}`);
    results.set(stage.name, { status: 'failed', note: `${seconds}s, exit ${status ?? 'none'}` });
    failed = stage.name;
  }
}

const width = Math.max(...names.map((name) => name.length));
console.log('\n[verify] summary');
for (const name of names) {
  const { status, note } = results.get(name);
  console.log(`  ${name.padEnd(width)}  ${status.padEnd(7)}  ${note}`);
}

if (failed) {
  console.error(`\nVERIFY FAILED: ${failed}`);
  process.exit(1);
}
if (from) {
  console.log(
    `\nVERIFY PARTIAL: passed from ${from}; earlier stages did not run, so run pnpm verify for the gate`,
  );
  process.exit(0);
}
console.log('\nVERIFY PASSED');
