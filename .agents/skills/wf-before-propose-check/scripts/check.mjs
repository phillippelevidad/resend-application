#!/usr/bin/env node
// Mechanical checks over a pre-proposal produced by `wf-before-propose`.
//
//   node .agents/skills/wf-before-propose-check/scripts/check.mjs <path-to-pre-proposal.md> [--slice 2B]
//
// It only reports what a machine can decide with certainty — a link that does not
// resolve, a `Ships` bullet that drifted, a cross-reference to a `D7` that was never
// written. Everything it cannot decide it says nothing about, so a clean run is not a
// clean document: it is a document where the cheap defects are gone and the reading
// can start.
//
// Exit code is 0 unless the file itself could not be read — findings are data, not failure.

import { readFileSync, existsSync, statSync, readdirSync } from "node:fs";
import { resolve, dirname, join, relative, sep } from "node:path";

// ---------------------------------------------------------------- setup

const args = process.argv.slice(2);
const docArg = args.find((a) => !a.startsWith("--"));
if (!docArg) {
  console.error("usage: check.mjs <pre-proposal.md> [--slice <id>]");
  process.exit(2);
}
const sliceFlag = (() => {
  const i = args.indexOf("--slice");
  return i >= 0 ? args[i + 1] : null;
})();

const docPath = resolve(docArg);
if (!existsSync(docPath)) {
  console.error(`not found: ${docPath}`);
  process.exit(2);
}
const doc = readFileSync(docPath, "utf8");
const docDir = dirname(docPath);
const docLines = doc.split(/\r?\n/);

const repoRoot = (() => {
  let d = docDir;
  for (let i = 0; i < 12; i++) {
    if (existsSync(join(d, ".ai", "build-checklist.md"))) return d;
    const up = dirname(d);
    if (up === d) break;
    d = up;
  }
  return process.cwd();
})();

const findings = [];
const record = (check, level, msg) => findings.push({ check, level, msg });

// Every path check resolves relative to the document, so a copy outside
// `.ai/pre-proposals/` reports the whole link set as broken. Check in place.
if (!existsSync(join(repoRoot, ".ai", "build-checklist.md"))) {
  console.error(`! no .ai/build-checklist.md above ${docPath} — run this against the document in its real location, or every path finding is noise.`);
  process.exit(2);
}

// ---------------------------------------------------------------- helpers

/** GitHub-flavoured heading slug, matching how the `.ai/` docs anchor themselves. */
function slugify(heading) {
  return heading
    .trim()
    .replace(/<[^>]*>/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1") // unwrap md links, keep the text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, "") // GitHub keeps hyphens and underscores, drops the rest
    .replace(/\s/g, "-");
}

/** Every anchor a markdown file exposes, duplicates suffixed the way GitHub does. */
const anchorCache = new Map();
function anchorsOf(filePath) {
  if (anchorCache.has(filePath)) return anchorCache.get(filePath);
  const set = new Set();
  try {
    const seen = new Map();
    for (const line of readFileSync(filePath, "utf8").split(/\r?\n/)) {
      const m = /^(#{1,6})\s+(.*)$/.exec(line);
      if (!m) continue;
      const base = slugify(m[2]);
      if (!base) continue;
      const n = seen.get(base) ?? 0;
      seen.set(base, n + 1);
      set.add(n === 0 ? base : `${base}-${n}`);
    }
  } catch {
    /* unreadable — the link check reports the file, not the anchor */
  }
  anchorCache.set(filePath, set);
  return set;
}

/** Strip markdown decoration so two renderings of the same sentence compare equal. */
function normalize(text) {
  return text
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1") // links → their text
    .replace(/[*_`]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Body of `## <n>. <title>` up to the next `## ` heading. */
function sectionBody(n) {
  const start = docLines.findIndex((l) => new RegExp(`^##\\s+${n}\\.\\s`).test(l));
  if (start < 0) return null;
  let end = docLines.length;
  for (let i = start + 1; i < docLines.length; i++) {
    if (/^##\s+\d+\.\s/.test(docLines[i])) {
      end = i;
      break;
    }
  }
  return { start, end, text: docLines.slice(start, end).join("\n") };
}

/** Which `## <n>.` section a given line index falls inside. */
function sectionOfLine(idx) {
  for (let i = idx; i >= 0; i--) {
    const m = /^##\s+(\d+)\.\s/.exec(docLines[i]);
    if (m) return Number(m[1]);
  }
  return 0;
}

function listFiles(dir, name, out = []) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) listFiles(p, name, out);
    else if (e.name === name) out.push(p);
  }
  return out;
}

// ---------------------------------------------------------------- 1. sections present

const SECTIONS = 25;
{
  const missing = [];
  for (let n = 1; n <= SECTIONS; n++) {
    if (!docLines.some((l) => new RegExp(`^##\\s+${n}\\.\\s`).test(l))) missing.push(n);
  }
  if (missing.length) {
    record(
      "sections",
      "BLOCK",
      `sections absent entirely (a section that does not apply is written "Not touched — <why>", never dropped): ${missing.join(", ")}`,
    );
  }
  // More than a third gone means this is an authoring job, not a repair job.
  if (missing.length > SECTIONS / 3) {
    record("sections", "BLOCK", `${missing.length}/${SECTIONS} sections missing — re-run wf-before-propose rather than repairing this`);
  }
}

// ---------------------------------------------------------------- 2. links resolve

{
  const linkRe = /\[[^\]]*\]\(([^)\s]+)\)/g;
  const seen = new Set();
  let m;
  while ((m = linkRe.exec(doc))) {
    const target = m[1];
    if (/^(https?:|mailto:)/.test(target)) continue;
    const lineNo = doc.slice(0, m.index).split("\n").length;
    const [filePart, anchorPart] = target.split("#");
    const key = target;

    if (!filePart) {
      // Internal anchor into this same document. Section 22 quotes copy destined for
      // other files, where a bare anchor is correct — flag it to read, not to fix.
      if (!anchorsOf(docPath).has(anchorPart)) {
        const sec = sectionOfLine(lineNo - 1);
        record(
          "links",
          sec === 22 ? "READ" : "BLOCK",
          `L${lineNo} (§${sec}): internal anchor #${anchorPart} does not exist in this document`,
        );
      }
      continue;
    }
    if (seen.has(key)) continue;
    seen.add(key);

    const abs = resolve(docDir, filePart);
    if (!existsSync(abs)) {
      record("links", "BLOCK", `L${lineNo}: link target does not exist — ${target}`);
      continue;
    }
    if (anchorPart && abs.endsWith(".md") && !anchorsOf(abs).has(anchorPart)) {
      record("links", "BLOCK", `L${lineNo}: file exists but anchor does not — ${target}`);
    }
  }
}

// ---------------------------------------------------------------- 3. file:line evidence

{
  const re = /`((?:[\w.@-]+\/)+[\w.-]+\.\w+):(\d+)(?:-(\d+))?`/g;
  const seen = new Set();
  let m;
  while ((m = re.exec(doc))) {
    const [, rel, fromStr, toStr] = m;
    const key = `${rel}:${fromStr}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const lineNo = doc.slice(0, m.index).split("\n").length;
    const abs = join(repoRoot, rel);
    if (!existsSync(abs)) {
      record("evidence", "BLOCK", `L${lineNo}: cited file does not exist — ${rel}:${fromStr}`);
      continue;
    }
    const count = readFileSync(abs, "utf8").split(/\r?\n/).length;
    const last = Number(toStr ?? fromStr);
    if (last > count) {
      record("evidence", "BLOCK", `L${lineNo}: ${rel} has ${count} lines, cited line ${last} does not exist`);
    }
  }
}

// ---------------------------------------------------------------- 4. unresolved markers

{
  // Case-sensitive on the acronyms: a pt-BR document says "Todo o período", which is not a marker.
  const re = /\b(TBD|TODO|[Tt]o be decided|[Dd]ecide later|[Uu]nclear|[Ww]e (?:could|might) (?:also )?(?:either|choose)|[Ee]ither way|[Uu]p to the implementer|[Ii]mplementer(?:'s)? choice|[Aa]t implementation time)\b/;
  const allowed = new Set([3, 6, 22, 25]); // deferrals, contradictions, doc edits, owner ops
  docLines.forEach((line, i) => {
    if (/^\s*(\||#)/.test(line) || /^#/.test(line)) return;
    const m = re.exec(line);
    if (!m) return;
    const sec = sectionOfLine(i);
    const level = allowed.has(sec) ? "READ" : "BLOCK";
    record("residue", level, `L${i + 1} (§${sec}): "${m[0]}" — ${line.trim().slice(0, 140)}`);
  });
}

// ---------------------------------------------------------------- 5. Ships verbatim

{
  const slice =
    sliceFlag ??
    (() => {
      const m = /\|\s*\*\*Slice\*\*\s*\|\s*([\w.]+)\s*—/.exec(doc);
      return m ? m[1] : null;
    })();

  const checklist = join(repoRoot, ".ai", "build-checklist.md");
  if (!slice) {
    record("scope", "READ", "could not read the slice id from the metadata block — pass --slice <id> to compare the Ships list");
  } else if (!existsSync(checklist)) {
    record("scope", "READ", `build-checklist.md not found at ${checklist}`);
  } else {
    const cl = readFileSync(checklist, "utf8").split(/\r?\n/);
    const start = cl.findIndex((l) => new RegExp(`^###\\s+${slice.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s+—`).test(l));
    if (start < 0) {
      record("scope", "BLOCK", `no card "### ${slice} — …" in build-checklist.md — the slice id in the metadata block does not resolve`);
    } else {
      let end = cl.length;
      for (let i = start + 1; i < cl.length; i++) if (/^###\s/.test(cl[i])) { end = i; break; }
      const card = cl.slice(start, end);

      // Ships bullets: `  - [ ] …`, continuation lines folded in.
      const ships = [];
      let inShips = false;
      for (const line of card) {
        if (/^-\s+\*\*Ships:\*\*/.test(line)) { inShips = true; continue; }
        if (inShips && /^-\s+\*\*/.test(line)) break;
        if (!inShips) continue;
        const m = /^\s{2,}-\s+\[[ xX]\]\s+(.*)$/.exec(line);
        if (m) ships.push(m[1]);
        else if (ships.length && line.trim()) ships[ships.length - 1] += " " + line.trim();
      }

      const sec2 = sectionBody(2);
      if (!sec2) {
        record("scope", "BLOCK", "section 2 is missing — the scope contract has no home");
      } else {
        const items = [];
        let blank = false;
        for (const line of sec2.text.split("\n")) {
          const m = /^(\d+)\.\s+(.*)$/.exec(line);
          if (m) {
            items.push(m[2]);
            blank = false;
            continue;
          }
          if (!line.trim()) {
            blank = true;
            continue;
          }
          // A fresh block at column 0 after a blank line ends the list — section 2 closes with prose
          // (the card's UI-surfaces line, then the rule), which is not part of any Ships bullet.
          if (items.length && blank && !/^\s/.test(line)) break;
          if (items.length && !/^##/.test(line)) items[items.length - 1] += " " + line.trim();
        }
        if (ships.length !== items.length) {
          record("scope", "BLOCK", `the card has ${ships.length} Ships bullets, section 2 lists ${items.length} — the scope contract drifted in count`);
        }
        const nShips = ships.map(normalize);
        const nItems = items.map(normalize);
        nShips.forEach((s, i) => {
          if (nItems.includes(s)) return;
          const near = nItems.find((t) => t.slice(0, 60) === s.slice(0, 60));
          if (near) {
            const at = [...s].findIndex((c, k) => c !== near[k]);
            record("scope", "BLOCK", `Ships bullet ${i + 1} was reworded — diverges around char ${at}: card "…${s.slice(Math.max(0, at - 40), at + 60)}…" vs doc "…${near.slice(Math.max(0, at - 40), at + 60)}…"`);
          } else {
            record("scope", "BLOCK", `Ships bullet ${i + 1} is absent from section 2: "${s.slice(0, 110)}…"`);
          }
        });
        nItems.forEach((t, i) => {
          if (!nShips.includes(t) && !nShips.some((s) => s.slice(0, 60) === t.slice(0, 60))) {
            record("scope", "BLOCK", `section 2 item ${i + 1} is not on the card — scope was widened: "${t.slice(0, 110)}…"`);
          }
        });
      }
    }
  }
}

// ---------------------------------------------------------------- 6. cross-references

{
  const idsIn = (body, re) => {
    const out = new Set();
    if (!body) return out;
    let m;
    const r = new RegExp(re.source, "gm");
    while ((m = r.exec(body.text))) out.add(m[1]);
    return out;
  };

  // Section 7 states a decision either as a bolded lead-in or as its own heading; both are in use.
  const decisions = idsIn(sectionBody(7), /^(?:\*\*|#{2,4}\s+)(D\d+)\s*[—–-]/);
  const contradictions = (() => {
    const s = sectionBody(6);
    const out = new Set();
    if (!s) return out;
    let m;
    const r = /\b(X\d+)\b/g;
    while ((m = r.exec(s.text))) out.add(m[1]);
    return out;
  })();
  const ruleMax = (() => {
    const s = sectionBody(14);
    if (!s) return 0;
    let max = 0;
    for (const line of s.text.split("\n")) {
      const m = /^(\d+)\.\s/.exec(line);
      if (m) max = Math.max(max, Number(m[1]));
    }
    return max;
  })();

  const cited = (re) => {
    const out = new Map();
    let m;
    const r = new RegExp(re.source, "g");
    while ((m = r.exec(doc))) {
      const line = doc.slice(0, m.index).split("\n").length;
      if (!out.has(m[1])) out.set(m[1], line);
    }
    return out;
  };

  for (const [id, line] of cited(/\[(D\d+)\]\(#/)) {
    if (!decisions.has(id)) record("xref", "BLOCK", `L${line}: cites ${id}, which section 7 does not define`);
  }
  for (const [id, line] of cited(/\[(X\d+)\]\(#/)) {
    if (!contradictions.has(id)) record("xref", "BLOCK", `L${line}: cites ${id}, which section 6 does not define`);
  }
  if (ruleMax > 0) {
    let m;
    const r = /\brules?\s+(\d+)(?:\s*[–-]\s*(\d+))?/gi;
    while ((m = r.exec(doc))) {
      const hi = Number(m[2] ?? m[1]);
      if (hi > ruleMax) {
        const line = doc.slice(0, m.index).split("\n").length;
        record("xref", "BLOCK", `L${line}: cites "${m[0]}" but section 14 stops at rule ${ruleMax}`);
      }
    }
  }

  // Every decision must carry an authority.
  const s7 = sectionBody(7);
  if (s7) {
    const blocks = s7.text.split(/\n(?=(?:\*\*|#{2,4}\s+)D\d+\s*[—–-])/).slice(1);
    for (const b of blocks) {
      const id = /^(?:\*\*|#{2,4}\s+)(D\d+)/.exec(b)?.[1] ?? "?";
      const hasAuthority = /Authority:/i.test(b) || /owner-ruled/i.test(b) || /\.md#/.test(b) || /decision lens/i.test(b);
      if (!hasAuthority) record("authority", "BLOCK", `${id} carries no authority line — a decision with no anchor, lens clause or owner ruling is a guess`);
    }
  }
}

// ---------------------------------------------------------------- 7. capability paths

{
  const specDirs = new Set(
    listFiles(join(repoRoot, "openspec", "specs"), "spec.md").map((p) =>
      relative(join(repoRoot, "openspec", "specs"), dirname(p)).split(sep).join("/"),
    ),
  );
  const s23 = sectionBody(23);
  if (s23) {
    for (const line of s23.text.split("\n")) {
      if (!/\b(ADDED|MODIFIED)\b/.test(line)) continue;
      const m = /`([\w-]+(?:\/[\w-]+)+)`/.exec(line);
      if (!m) continue;
      const path = m[1].replace(/^openspec\/specs\//, "");
      const declared = /\bADDED\b/.test(line) ? "ADDED" : "MODIFIED";
      const exists = specDirs.has(path);
      if (declared === "ADDED" && exists) {
        record("openspec", "BLOCK", `\`${path}\` is marked ADDED but openspec/specs/${path}/spec.md already exists — it is MODIFIED`);
      }
      if (declared === "MODIFIED" && !exists) {
        record("openspec", "BLOCK", `\`${path}\` is marked MODIFIED but openspec/specs/${path}/ does not exist — it is ADDED`);
      }
    }
  }
  if (specDirs.size === 0) record("openspec", "READ", "openspec/specs holds no spec.md — every delta is ADDED");
}

// ---------------------------------------------------------------- 8. owner rulings

// A ruling from this run's question round settles build shape. It does not settle a
// legal or fiscal duty — that channel is a `.human/` brief, and a marker written on top
// of an agent's own recommendation has passed for one here before.
{
  const legalish =
    /\b(LGPD|NFS-?e|NF-?e|nota fiscal|tribut|imposto|ISS|ICMS|Simples Nacional|contador|advogad|consumer law|CDC|Marco Civil|termos de uso|ToU|DPA|liabilit|indemnif|retenção|retencao|data retention|erasure|KYC|KYB)/i;
  const briefs = existsSync(join(repoRoot, ".human"))
    ? readdirSync(join(repoRoot, ".human")).filter((f) => f.startsWith("open-question-"))
    : [];

  docLines.forEach((line, i) => {
    if (!/owner-ruled/i.test(line)) return;
    // Anchor the claim to the decision it sits under; a prose mention is not a claim.
    let head = null;
    for (let k = i; k >= 0 && i - k < 25; k--) {
      const m = /^\*\*(D\d+)\s*[—–-]\s*(.*)$/.exec(docLines[k]);
      if (m) { head = m; break; }
      if (/^##\s/.test(docLines[k])) break;
    }
    if (!head) return;
    const subject = `${head[2]} ${line}`;
    const flag = legalish.test(subject);
    record(
      "ruling",
      flag ? "BLOCK" : "READ",
      flag
        ? `L${i + 1}: ${head[1]} is owner-ruled on a legal/fiscal subject — that channel is a .human/ brief, not a question round`
        : `L${i + 1}: ${head[1]} owner-ruled — confirm the owner actually answered this`,
    );
  });
  if (briefs.length) record("ruling", "READ", `.human/ briefs on file: ${briefs.length} (${briefs.map((b) => b.replace(/^open-question-|\.md$/g, "")).join(", ")})`);
}

// ---------------------------------------------------------------- 9. deferral triggers

{
  const s3 = sectionBody(3);
  if (s3) {
    if (/when demand warrants|if it becomes|as needed|later if/i.test(s3.text)) {
      record("deferral", "BLOCK", "section 3 contains an uncountable deferral trigger — every deferral needs a countable threshold or a named observable event");
    }
    const hasTriggers = /trigger:/i.test(s3.text) || /\bslice \d/i.test(s3.text);
    if (!hasTriggers) record("deferral", "READ", "section 3 names no trigger and no carrying slice — check each deferral has one");
  }
}

// ---------------------------------------------------------------- 10. named identifiers
// F1's needle-in-a-haystack, turned into a short list. Every backticked identifier the
// document leans on is either something the slice builds or something it assumes exists —
// and the second kind, when it does not exist, is the defect that reads as complete prose.
// The script cannot tell the two apart. It can tell you which ones the repo has never
// heard of, which is the list worth walking.

const SOURCE_ROOTS = [
  "backend/src",
  "backend/prisma",
  "supabase",
  "storefront/src",
  "backoffice/src",
  "admin/src",
  "auth/src",
  "packages/ui/src",
  "packages/api-client/src",
];
const SOURCE_EXT = /\.(ts|tsx|js|mjs|sql|prisma|json)$/;

function collectSourceTokens() {
  const tokens = new Set();
  const walk = (dir) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name === "node_modules" || e.name === ".next" || e.name === "dist") continue;
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (SOURCE_EXT.test(e.name)) {
        let text;
        try {
          text = readFileSync(p, "utf8");
        } catch {
          continue;
        }
        for (const t of text.match(/[A-Za-z_][A-Za-z0-9_]{2,}/g) ?? []) tokens.add(t);
      }
    }
  };
  for (const r of SOURCE_ROOTS) walk(join(repoRoot, r));
  return tokens;
}

{
  const STOP = new Set(
    ("true false null undefined string number boolean object array void never unknown this that " +
      "and the for with from into over under when then else must should shall not never always " +
      "value values type types kind kinds name names item items list lists data row rows table tables " +
      "column columns field fields state status active pending closed error errors page pages view views " +
      "read reads write writes command commands event events job jobs test tests spec specs " +
      "monthly yearly slice slices tenant tenants operator operators seller sellers buyer buyers admin")
      .split(/\s+/),
  );

  // A filename is not a mechanism — `proxy.ts` and `views.md` are noise here.
  const FILE_EXT = /\.(ts|tsx|js|jsx|mjs|cjs|md|sql|json|ya?ml|prisma|css|scss|html|sh|env|lock|toml|txt|png|svg)$/i;

  // Backticked identifier-shaped tokens: `snake_case`, `camelCase`, `Type.member`, `a.b.c`.
  const candidates = new Map(); // token -> first line
  const re = /`([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*)`/g;
  let m;
  while ((m = re.exec(doc))) {
    const raw = m[1];
    if (raw.length < 4) continue;
    if (STOP.has(raw.toLowerCase())) continue;
    if (FILE_EXT.test(raw)) continue;
    // Must look like code: an underscore, an interior capital, or a dot.
    if (!/[_.]/.test(raw) && !/[a-z][A-Z]/.test(raw)) continue;
    if (!candidates.has(raw)) candidates.set(raw, doc.slice(0, m.index).split("\n").length);
  }

  if (candidates.size) {
    const known = collectSourceTokens();
    const grafted = []; // owner exists, member does not — the shape worth reading
    const wholly = []; // nothing of it exists — usually just new work

    for (const [tok, line] of candidates) {
      const parts = tok.split(".");
      const missing = parts.filter((p) => !known.has(p));
      if (!missing.length) continue;
      if (parts.length > 1 && missing.length < parts.length) {
        grafted.push({ tok, line, owner: parts.filter((p) => known.has(p)).join("."), missing: missing.join(", ") });
      } else {
        wholly.push({ tok, line });
      }
    }

    // A member hung off something that exists is how "the gate reads
    // WebhookEvent.replayedAt" survives a read: the type is real, the field is not.
    for (const g of grafted.slice(0, 25)) {
      record(
        "identifiers",
        "READ",
        `L${g.line}: \`${g.tok}\` — \`${g.owner}\` exists in the source tree, \`${g.missing}\` does not. Does this slice add it, or is the doc assuming it?`,
      );
    }
    if (grafted.length > 25) record("identifiers", "READ", `…and ${grafted.length - 25} more of the same shape`);

    // Everything else is mostly the tables and operations the slice is here to build.
    // Listed as names only, so a stowaway among them is still visible.
    if (wholly.length) {
      record(
        "identifiers",
        "READ",
        `${wholly.length} identifier(s) appear nowhere in the source tree — expected for what this slice builds, so scan for one that should already exist: ${wholly
          .slice(0, 60)
          .map((w) => `\`${w.tok}\``)
          .join(" ")}${wholly.length > 60 ? " …" : ""}`,
      );
    }
  }
}

// ---------------------------------------------------------------- 11. objects described twice
// F3: the same object described in several sections is where the document contradicts
// itself. The script cannot judge whether two descriptions agree — it can hand you the
// short list of objects described often enough to be worth comparing.

{
  const spans = [];
  for (let n = 8; n <= 15; n++) {
    const s = sectionBody(n);
    if (s) spans.push({ n, text: s.text });
  }
  if (spans.length) {
    const counts = new Map();
    const re = /`([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)?)`/g;
    for (const { n, text } of spans) {
      const seen = new Set();
      let m;
      const r = new RegExp(re.source, "g");
      while ((m = r.exec(text))) {
        const tok = m[1];
        // Bare words like `pending` and `active` are vocabulary, not objects.
        if (tok.length < 5 || seen.has(tok)) continue;
        if (!/[_.]/.test(tok) && !/[a-z][A-Z]/.test(tok)) continue;
        seen.add(tok);
        if (!counts.has(tok)) counts.set(tok, []);
        counts.get(tok).push(n);
      }
    }
    const multi = [...counts.entries()]
      .filter(([, secs]) => secs.length >= 3)
      .sort((a, b) => b[1].length - a[1].length)
      .slice(0, 20);
    for (const [tok, secs] of multi) {
      record("cross-section", "READ", `\`${tok}\` is described in §${secs.join(", §")} — compare them, they must agree`);
    }
  }
}

// ---------------------------------------------------------------- report

const order = ["sections", "links", "evidence", "scope", "xref", "authority", "openspec", "residue", "ruling", "deferral", "identifiers", "cross-section"];
const blocking = findings.filter((f) => f.level === "BLOCK").length;

console.log(`# mechanical checks — ${relative(repoRoot, docPath).split(sep).join("/")}`);
console.log(`# repo root: ${repoRoot}`);
console.log("");
for (const check of order) {
  const rows = findings.filter((f) => f.check === check);
  if (!rows.length) {
    console.log(`[${check}] OK`);
    continue;
  }
  console.log(`[${check}] ${rows.length} item(s)`);
  for (const r of rows) console.log(`  ${r.level}  ${r.msg}`);
}
console.log("");
console.log(`# ${blocking} blocking, ${findings.length - blocking} to read`);
console.log("# A clean run is not a clean document. It means the cheap defects are gone.");
