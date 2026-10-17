#!/usr/bin/env node
// The `links` stage of `pnpm verify` (design D19): every relative link and image in a Markdown
// file (inline, reference definition, or HTML `<a href>` / `<img src>`) must resolve to an existing
// file or directory, and every `#anchor` to a heading slug or an explicit `id`/`name` in its target.
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
// A reference definition, `[label]: dest`, the target of every `[text][label]` link. A footnote
// (`[^1]: note`) is not one.
const REFERENCE_DEFINITION = /^ {0,3}\[(?!\^)(?:[^[\]]|\\[[\]])+\]:[ \t]*(<[^>]*>|\S+)/gm;
// An HTML link or image, which Markdown passes through: <a href="…"> and <img src="…">.
const HTML_LINK = /<(?:a|img)\b[^>]*?\s(?:href|src)\s*=\s*["']([^"']*)["']/gi;
const EXPLICIT_ID = /<[^>]*?\b(?:id|name)\s*=\s*["']([^"']+)["']/gi;
// Block starts that end the paragraph before them, so no code span crosses them: an ATX heading or
// a table row is a block of its own line; a list item opens a block that may wrap.
const ONE_LINE_BLOCK = /^ {0,3}(?:#{1,6}(?:\s|$)|\|)/;
const LIST_ITEM = /^ {0,3}(?:[-+*]|\d{1,9}[.)])(?:\s|$)/;
const QUOTE_MARKERS = /^(?: {0,3}> ?)+/;

/**
 * `text` with every code span blanked to spaces, newlines kept (CommonMark): a run of n backticks
 * opens a span, the next run of exactly n closes it, and a run never closed is literal text. A
 * backslash escapes a backtick outside a span only.
 */
function blankCodeSpans(text) {
  let result = '';
  let at = 0;
  while (at < text.length) {
    if (text[at] === '\\') {
      result += text.slice(at, at + 2);
      at += 2;
      continue;
    }
    if (text[at] !== '`') {
      result += text[at];
      at += 1;
      continue;
    }
    let end = at;
    while (text[end] === '`') end += 1;
    const closer = new RegExp(`(?<!\`)\`{${end - at}}(?!\`)`, 'g');
    closer.lastIndex = end;
    const close = closer.exec(text);
    const stop = close ? close.index + close[0].length : end;
    result += close ? text.slice(at, stop).replace(/[^\n]/g, ' ') : text.slice(at, stop);
    at = stop;
  }
  return result;
}

/**
 * Each line with code blanked out: fenced blocks entirely, then code spans paragraph by paragraph.
 * A span may wrap across lines, but never past a blank line or a block start, so a stray backtick
 * cannot pair with one in a later paragraph and hide the links between.
 */
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
    out.push(line);
  }
  let block = [];
  let quoted = false;
  const flush = () => {
    const blanked = blankCodeSpans(block.map((index) => out[index]).join('\n')).split('\n');
    for (const [offset, index] of block.entries()) out[index] = blanked[offset];
    block = [];
  };
  for (const [index, line] of out.entries()) {
    const markers = QUOTE_MARKERS.exec(line);
    const content = markers ? line.slice(markers[0].length) : line;
    const blank = !content.trim();
    if (
      blank ||
      Boolean(markers) !== quoted ||
      LIST_ITEM.test(content) ||
      ONE_LINE_BLOCK.test(content)
    ) {
      flush();
    }
    quoted = Boolean(markers);
    if (blank) continue;
    block.push(index);
    if (ONE_LINE_BLOCK.test(content)) flush();
  }
  flush();
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
  const matches = [
    ...prose.matchAll(INLINE_LINK),
    ...prose.matchAll(REFERENCE_DEFINITION),
    ...prose.matchAll(HTML_LINK),
  ].sort((a, b) => a.index - b.index);
  for (const match of matches) {
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
        '',
        // A stray backtick must not pair with the next paragraph's and hide the link there.
        'A stray ` tick.',
        '',
        '[missing anchor](target.md#no-such-heading) before `code`.',
        '',
        // Wrapped across two lines, as hard-wrapped prose wraps a link.
        '[missing',
        'file](no-such-file.md)',
        '',
        // A code span wrapped across two lines holds no link.
        'Not a link: `[x](',
        'no-such-file.md)`.',
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
