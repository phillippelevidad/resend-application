#!/usr/bin/env node
// The `links` stage of `pnpm verify` (design D19): every relative link and image in a Markdown
// file must resolve to an existing file or directory, and every `#anchor` to a heading slug or an
// explicit `id`/`name` in its target.
//
//   node scripts/check-links.mjs              checks README.md
//   node scripts/check-links.mjs <file> …     checks the named files instead
//
// A canary runs first, over a throwaway pair of files in a fresh temp dir: it must report exactly
// one missing anchor and one missing file. `http(s):` and `mailto:` targets are skipped, never
// fetched. Links inside fenced code blocks and inline code are not links. Node built-ins only.
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const MARKDOWN = new Set(['.md', '.markdown']);
const EXTERNAL = /^(?:https?|mailto):/i;
// GitHub's line anchors on a rendered source file: #L10, #L10-L20, #L10C2-L20C5.
const LINE_ANCHOR = /^L\d+(?:C\d+)?(?:-L\d+(?:C\d+)?)?$/;
// An inline link or image: [text](dest "title") or ![alt](dest). The text may hold one level of
// brackets (an image inside a link); the destination is <…> or a run without spaces.
const INLINE_LINK =
  /!?\[(?:[^[\]]|\[[^[\]]*\])*\]\(\s*(<[^>]*>|[^\s)]+)(?:\s+(?:"[^"]*"|'[^']*'|\([^)]*\)))?\s*\)/g;
const EXPLICIT_ID = /<[^>]*?\b(?:id|name)\s*=\s*["']([^"']+)["']/gi;

/** Each line with code blanked out: fenced blocks entirely, inline code spans by equal runs. */
function proseLines(text) {
  const lines = text.split(/\r?\n/);
  const out = [];
  let fence;
  for (const line of lines) {
    const marker = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (fence) {
      if (marker && marker[1][0] === fence[0] && marker[1].length >= fence.length) {
        if (/^ {0,3}(`{3,}|~{3,})\s*$/.test(line)) fence = undefined;
      }
      out.push('');
      continue;
    }
    if (marker && !(marker[1][0] === '`' && line.slice(marker[0].length).includes('`'))) {
      fence = marker[1];
      out.push('');
      continue;
    }
    out.push(line.replace(/(`+)(?!`)([\s\S]*?[^`])\1(?!`)/g, (span) => ' '.repeat(span.length)));
  }
  return out;
}

/** Heading text as GitHub renders it: no code ticks, link syntax, emphasis or HTML tags. */
function headingText(raw) {
  return raw
    .split(/(`+[^`]*`+)/)
    .map((part, index) => {
      if (index % 2 === 1) return part.replace(/^`+|`+$/g, '');
      return part
        .replace(/<[^>]+>/g, '')
        .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
        .replace(/[*~]+/g, '')
        .replace(/(^|[^\p{L}\p{N}])_+|_+(?=[^\p{L}\p{N}]|$)/gu, '$1');
    })
    .join('')
    .trim();
}

/** GitHub-style slugs (github-slugger): duplicates get -1, -2, … in document order. */
function headingSlugs(text) {
  const slugs = new Set();
  const occurrences = new Map();
  const add = (heading) => {
    const base = headingText(heading)
      .toLowerCase()
      .replace(/[^\p{L}\p{M}\p{N} _-]/gu, '')
      .replace(/ /g, '-');
    let slug = base;
    while (occurrences.has(slug)) {
      const count = occurrences.get(base) + 1;
      occurrences.set(base, count);
      slug = `${base}-${count}`;
    }
    occurrences.set(slug, 0);
    slugs.add(slug);
  };
  const lines = proseLines(text);
  const rawLines = text.split(/\r?\n/);
  for (const [index, line] of lines.entries()) {
    const atx = /^ {0,3}#{1,6}(?:\s+(.*?))?(?:\s+#+)?\s*$/.exec(line);
    if (atx) {
      add(rawLines[index].replace(/^ {0,3}#{1,6}\s*/, '').replace(/\s+#+\s*$/, ''));
      continue;
    }
    const previous = lines[index - 1];
    if (/^ {0,3}(?:=+|-+)\s*$/.test(line) && previous?.trim() && !/^ {0,3}#/.test(previous)) {
      add(rawLines[index - 1].trim());
    }
  }
  for (const match of text.matchAll(EXPLICIT_ID)) slugs.add(match[1]);
  return slugs;
}

/** A file's text without a leading byte-order mark, which would hide a first-line heading. */
const readText = (path) => readFileSync(path, 'utf8').replace(/^﻿/, '');

const anchorCache = new Map();
function anchorsOf(path) {
  if (!anchorCache.has(path)) anchorCache.set(path, headingSlugs(readText(path)));
  return anchorCache.get(path);
}

function decode(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/** Why `target`, written in `file`, does not resolve; undefined when it does. */
function brokenReason(file, target) {
  const hashAt = target.indexOf('#');
  const pathPart = decode(hashAt === -1 ? target : target.slice(0, hashAt)).replace(/\?.*$/, '');
  const anchor = hashAt === -1 ? undefined : decode(target.slice(hashAt + 1));
  let resolved = file;
  if (pathPart) {
    resolved = pathPart.startsWith('/')
      ? join(repoRoot, pathPart)
      : resolve(dirname(file), pathPart);
  }
  if (!existsSync(resolved)) return 'missing file';
  if (!anchor) return undefined;
  if (statSync(resolved).isDirectory()) {
    const readme = join(resolved, 'README.md');
    return existsSync(readme) && anchorsOf(readme).has(anchor) ? undefined : 'missing anchor';
  }
  if (MARKDOWN.has(extname(resolved).toLowerCase())) {
    return anchorsOf(resolved).has(anchor) ? undefined : 'missing anchor';
  }
  return LINE_ANCHOR.test(anchor) ? undefined : 'missing anchor';
}

/**
 * Every checked link in `file` and the broken ones, each `{ line, target, reason }`. Matched over
 * the whole text, not line by line: a hard-wrapped file breaks a link's text across lines.
 */
function checkFile(file) {
  const broken = [];
  let checked = 0;
  const prose = proseLines(readText(file)).join('\n');
  for (const match of prose.matchAll(INLINE_LINK)) {
    const target = match[1].replace(/^<|>$/g, '');
    if (!target || EXTERNAL.test(target)) continue;
    checked += 1;
    const reason = brokenReason(file, target);
    const line = prose.slice(0, match.index).split('\n').length;
    if (reason) broken.push({ line, target, reason });
  }
  return { checked, broken };
}

/** The canary's failure, or undefined when it reports exactly the two planted breaks. */
function canaryProblem() {
  const dir = mkdtempSync(join(tmpdir(), 'ledger-links-'));
  try {
    writeFileSync(join(dir, 'target.md'), '# Canary Target\n\nA heading to link to.\n');
    const probe = join(dir, 'probe.md');
    writeFileSync(
      probe,
      [
        '[valid](target.md#canary-target)',
        '[missing anchor](target.md#no-such-heading)',
        // Wrapped across two lines, as hard-wrapped prose wraps a link.
        '[missing',
        'file](no-such-file.md)',
        '',
      ].join('\n'),
    );
    const { checked, broken } = checkFile(probe);
    const reasons = broken.map((entry) => `${entry.target} (${entry.reason})`);
    const anchors = broken.filter((entry) => entry.reason === 'missing anchor').length;
    const files = broken.filter((entry) => entry.reason === 'missing file').length;
    if (checked !== 3 || anchors !== 1 || files !== 1 || broken.length !== 2) {
      return `${checked} checked, reported [${reasons.join(', ')}]; expected 1 missing anchor and 1 missing file`;
    }
    return undefined;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function main(args) {
  const problem = canaryProblem();
  if (problem) {
    console.error(`links: canary missed ${problem}`);
    return 1;
  }
  console.log('links: canary caught 2/2');

  const files = args.length > 0 ? args : ['README.md'];
  let failed = false;
  for (const name of files) {
    const path = args.length > 0 ? resolve(name) : join(repoRoot, name);
    if (!existsSync(path)) {
      console.error(`links: ${name} not found`);
      failed = true;
      continue;
    }
    const { checked, broken } = checkFile(path);
    console.log(`links: ${name} ${checked} checked, ${broken.length} broken`);
    for (const entry of broken) {
      console.error(`${name}:${entry.line} ${entry.target} (${entry.reason})`);
    }
    if (broken.length > 0) failed = true;
  }
  return failed ? 1 : 0;
}

process.exitCode = main(process.argv.slice(2));
