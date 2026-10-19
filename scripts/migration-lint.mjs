#!/usr/bin/env node
// The `migrations` stage of `pnpm verify` (design D38, ADR-018): migrations are expand/contract,
// so a statement that can break the running code fails unless its file is marked as a contract step.
//
//   node scripts/migration-lint.mjs
//
// A statement holding `DROP`, `RENAME`, `ALTER … TYPE` or `SET NOT NULL` (case-insensitive) fails
// its file unless line 1 is `-- contract-step: <40-hex SHA>` or
// `-- contract-step: replace: <name>, <widen|narrow>`. `--` comments are stripped first, and so are
// double-quoted identifiers, which can never be a keyword (a column named "type"). String literals
// stay: `EXECUTE 'ALTER TABLE t DROP COLUMN c'` inside a `DO` block is a contract step too.
//
// A canary runs first, in memory: an unmarked `ALTER TABLE t DROP COLUMN c;` must fail and a marked
// copy must pass, or the stage exits 1 before reading any migration. Node built-ins only.
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const MIGRATIONS_DIR = join(repoRoot, 'packages', 'db', 'drizzle');
const MARKER = /^-- contract-step: (?:[0-9a-f]{40}|replace: [^,\s]+, (?:widen|narrow))\s*$/;
const CONTRACT = [
  { label: 'DROP', pattern: /\bDROP\b/i },
  { label: 'RENAME', pattern: /\bRENAME\b/i },
  { label: 'ALTER … TYPE', pattern: /\bALTER\b[^;]*\bTYPE\b/i },
  { label: 'SET NOT NULL', pattern: /\bSET\s+NOT\s+NULL\b/i },
];
// One left-to-right pass, so a `--` inside a literal is not a comment and a quote inside a comment
// opens nothing: a string literal, a quoted identifier, or a comment to the end of its line. Only
// the last two are blanked; a literal is matched only so its contents are never read as either.
const NOT_CODE = /'(?:[^']|'')*'|"(?:[^"]|"")*"|--[^\n]*/g;
const blankNonCode = (token) => (token.startsWith("'") ? token : ' ');
const CANARY = 'ALTER TABLE t DROP COLUMN c;\n';
const CANARY_MARKER = `-- contract-step: ${'0'.repeat(40)}\n`;
const say = (message) => console.log(`migrations: ${message}`);
const fail = (message) => console.error(`migrations: ${message}`);

/** The contract keywords `sql` holds outside a marked file; empty means the file passes. */
function lint(sql) {
  const firstLine = sql.split(/\r?\n/, 1)[0];
  if (MARKER.test(firstLine)) return [];
  const code = sql.replace(NOT_CODE, blankNonCode);
  const found = [];
  for (const statement of code.split(';')) {
    for (const { label, pattern } of CONTRACT) {
      if (pattern.test(statement) && !found.includes(label)) found.push(label);
    }
  }
  return found;
}

function main() {
  const canaryCaught = lint(CANARY).length > 0;
  const markedPassed = lint(CANARY_MARKER + CANARY).length === 0;
  if (!canaryCaught || !markedPassed) {
    if (!canaryCaught) fail('canary missed: an unmarked DROP COLUMN passed');
    if (!markedPassed) fail('canary missed: a marked DROP COLUMN failed');
    return 1;
  }
  say('canary caught 1/1');

  const files = readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith('.sql'))
    .sort();
  if (files.length === 0) {
    fail(`no migration files in ${relative(repoRoot, MIGRATIONS_DIR)}`);
    return 1;
  }
  let unmarked = 0;
  for (const name of files) {
    const path = join(MIGRATIONS_DIR, name);
    const found = lint(readFileSync(path, 'utf8'));
    if (found.length > 0) {
      unmarked += 1;
      const file = relative(repoRoot, path).replaceAll('\\', '/');
      fail(`${file}: ${found.join(', ')} without a contract-step marker on line 1`);
    }
  }
  const summary = `${files.length} checked, ${unmarked} unmarked`;
  if (unmarked > 0) {
    fail(summary);
    fail(
      'mark a contract step with `-- contract-step: <40-hex SHA>` or `-- contract-step: replace: <name>, <widen|narrow>` on line 1 (ADR-018)',
    );
    return 1;
  }
  say(summary);
  return 0;
}

try {
  process.exitCode = main();
} catch (error) {
  fail(error.message);
  process.exitCode = 1;
}
