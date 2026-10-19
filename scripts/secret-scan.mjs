#!/usr/bin/env node
// The `secrets` stage of `pnpm verify` (design D18): gitleaks over every commit on every ref,
// with .gitleaks.toml, from a version- and digest-pinned image.
//
//   node scripts/secret-scan.mjs
//
// 1. Canary: a throwaway repo under the OS temp dir with one fake value per custom rule, assembled
//    here from fragments so no tracked line matches a rule. Every custom rule must report it.
// 2. Repo: a `git clone --mirror` of this repo, scanned with the same arguments; it must be clean.
//    A mirror because in a worktree `.git` is a file pointing outside any mount, and a mirror
//    carries every ref without Windows `.git` lock files.
//
// Output is `--redact`ed and only rule id, file, line and commit are printed: CI logs are public.
// Node built-ins only; `docker` and `git` are spawned with argument arrays, never a shell.
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const IMAGE =
  'ghcr.io/gitleaks/gitleaks:v8.30.1@sha256:c00b6bd0aeb3071cbcb79009cb16a60dd9e0a7c60e2be9ab65d25e6bc8abbb7f';
const CUSTOM_RULES = [
  'resend-api-key',
  'resend-webhook-secret',
  'ledger-api-token',
  'postgres-url',
];
const say = (message) => console.log(`secrets: ${message}`);
const fail = (message) => console.error(`secrets: ${message}`);

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    ...options,
  });
  if (result.error) throw new Error(`could not run ${command}: ${result.error.message}`);
  return result;
}

function git(args, cwd) {
  const result = run('git', args, { cwd });
  if (result.status !== 0) {
    throw new Error(`git ${args[0]} failed (exit ${result.status}): ${result.stderr.trim()}`);
  }
  return result.stdout.trim();
}

/** The work tree root, from this file's location; works where `.git` is a worktree's file. */
function repoRoot() {
  const scriptDir = dirname(fileURLToPath(import.meta.url));
  return resolve(git(['rev-parse', '--show-toplevel'], scriptDir));
}

/** One gitleaks run over the repo at `repoDir`; findings come back as the redacted JSON report. */
function gitleaks(repoDir, configPath) {
  const result = run('docker', [
    'run',
    '--rm',
    '-v',
    `${configPath}:/config/.gitleaks.toml:ro`,
    '-v',
    `${repoDir}:/repo:ro`,
    // The container's user does not own the mount.
    '-e',
    'GIT_CONFIG_COUNT=1',
    '-e',
    'GIT_CONFIG_KEY_0=safe.directory',
    '-e',
    'GIT_CONFIG_VALUE_0=*',
    IMAGE,
    'git',
    '--log-opts=--all',
    '--config',
    '/config/.gitleaks.toml',
    '--redact',
    '--no-banner',
    '--exit-code',
    '1',
    '--report-format',
    'json',
    '--report-path',
    '-',
    '/repo',
  ]);
  if (result.status !== 0 && result.status !== 1) {
    throw new Error(`gitleaks failed (exit ${result.status}): ${result.stderr.trim()}`);
  }
  let findings;
  try {
    findings = JSON.parse(result.stdout || '[]');
  } catch {
    throw new Error(`gitleaks printed no JSON report (exit ${result.status})`);
  }
  return { status: result.status, findings, log: result.stderr.trim() };
}

/** A one-commit repo holding one fake value per custom rule, none of them in this file. */
function writeCanary(dir) {
  const fakeKey = ['re', '_'].join('') + 'LedgerCanary'.repeat(2);
  const fakeSecret = ['whsec', '_'].join('') + 'TGVkZ2VyQ2FuYXJ5'.repeat(2);
  const fakeToken = `${['ldg', '_'].join('')}${'c0ffee'.repeat(11).slice(0, 64)}_${'5a'.repeat(32)}`;
  const fakeUrl = `${['postgres', '://'].join('')}canary:${'not-a-secret'}@${'db.example.invalid'}`;
  writeFileSync(
    join(dir, 'canary.env'),
    `RESEND_KEY=${fakeKey}\nWEBHOOK_SECRET=${fakeSecret}\nLEDGER_TOKEN=${fakeToken}\nDATABASE_URL=${fakeUrl}/ledger\n`,
  );
  const identity = ['-c', 'user.name=canary', '-c', 'user.email=canary@example.invalid'];
  git(['init', '-q', '-b', 'main'], dir);
  git(['add', 'canary.env'], dir);
  // A throwaway fixture repo that never leaves the temp dir, so a signing prompt must not block it.
  git([...identity, '-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'canary'], dir);
}

function printFindings(findings) {
  for (const finding of findings) {
    const commit = finding.Commit ? ` commit ${finding.Commit.slice(0, 12)}` : '';
    fail(`finding ${finding.RuleID} ${finding.File}:${finding.StartLine}${commit}`);
  }
}

function main() {
  const root = repoRoot();
  const configPath = join(root, '.gitleaks.toml');
  const temp = mkdtempSync(join(tmpdir(), 'ledger-secrets-'));
  try {
    const canaryDir = join(temp, 'canary');
    mkdirSync(canaryDir);
    writeCanary(canaryDir);
    // Scanned as a mirror, the same input shape as the repo scan, so a gitleaks that read nothing
    // from a bare repo would fail the canary instead of passing the repo silently.
    const canaryMirror = join(temp, 'canary.git');
    git(['clone', '-q', '--mirror', canaryDir, canaryMirror], temp);

    const canary = gitleaks(canaryMirror, configPath);
    const caught = new Set(canary.findings.map((finding) => finding.RuleID));
    const missed = CUSTOM_RULES.filter((rule) => !caught.has(rule));
    if (canary.status !== 1 || missed.length > 0) {
      for (const rule of missed) fail(`canary missed rule ${rule}`);
      if (missed.length === 0) fail(`canary scan exited ${canary.status}, expected 1`);
      return 1;
    }
    say(`canary caught ${CUSTOM_RULES.length}/${CUSTOM_RULES.length} rules`);

    const mirror = join(temp, 'repo.git');
    git(['clone', '-q', '--mirror', root, mirror], temp);
    const commits = git(['rev-list', '--all', '--count'], mirror);
    const scan = gitleaks(mirror, configPath);
    if (scan.status !== 0 || scan.findings.length > 0) {
      printFindings(scan.findings);
      if (scan.log) console.error(scan.log);
      fail(`repo has ${scan.findings.length} finding(s) (${commits} commits scanned)`);
      return 1;
    }
    say(`repo clean (${commits} commits scanned)`);
    return 0;
  } finally {
    rmSync(temp, { recursive: true, force: true, maxRetries: 3 });
  }
}

try {
  process.exitCode = main();
} catch (error) {
  fail(error.message);
  process.exitCode = 1;
}
