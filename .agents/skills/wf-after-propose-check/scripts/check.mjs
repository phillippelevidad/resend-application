#!/usr/bin/env node
// Mechanical checks over an OpenSpec change produced by `opsx:propose`, run before `opsx:apply`.
//
//   node .agents/skills/wf-after-propose-check/scripts/check.mjs [<change-dir-or-name>]
//
// With no argument it takes the newest directory under `openspec/changes/` that is not
// `archive/`. It reads all four artifacts together — `proposal.md`, `design.md`,
// `tasks.md` and every `specs/<capability>/spec.md` — plus the pre-proposal the change
// was written from, and the slice card that is the scope contract.
//
// It reports only what a machine can decide with certainty: a link that does not resolve,
// a `Ships` bullet that vanished between the card and the proposal, a `D7` cited by a task
// that `design.md` never defines, an operation named nowhere in `api-contract.md`. What it
// cannot decide it turns into a worklist for the reading passes rather than a verdict.
//
// Exit code is 0 unless the change itself could not be read — findings are data, not failure.

import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, join, relative, resolve, sep } from "node:path";

// ---------------------------------------------------------------- setup

const args = process.argv.slice(2);
const changeArg = args.find((a) => !a.startsWith("--"));

const repoRoot = (() => {
  let d = process.cwd();
  for (let i = 0; i < 12; i++) {
    if (
      existsSync(join(d, ".ai", "build-checklist.md")) &&
      existsSync(join(d, "openspec"))
    )
      return d;
    const up = dirname(d);
    if (up === d) break;
    d = up;
  }
  return null;
})();

if (!repoRoot) {
  console.error(
    "! not inside this repo (no .ai/build-checklist.md + openspec/ above the cwd)",
  );
  process.exit(2);
}

const changesDir = join(repoRoot, "openspec", "changes");

const changeDir = (() => {
  if (changeArg) {
    const asPath = resolve(changeArg);
    if (existsSync(join(asPath, "proposal.md"))) return asPath;
    const asName = join(changesDir, basename(changeArg));
    if (existsSync(asName)) return asName;
    console.error(`! no change at ${changeArg}`);
    process.exit(2);
  }
  let entries;
  try {
    entries = readdirSync(changesDir, { withFileTypes: true }).filter(
      (e) => e.isDirectory() && e.name !== "archive",
    );
  } catch {
    console.error(`! ${changesDir} is unreadable`);
    process.exit(2);
  }
  if (!entries.length) {
    console.error(
      "! openspec/changes holds no active change — `opsx:propose` has not run",
    );
    process.exit(2);
  }
  return entries
    .map((e) => join(changesDir, e.name))
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0];
})();

const changeName = basename(changeDir);

const findings = [];
const record = (check, level, msg) => findings.push({ check, level, msg });

// ---------------------------------------------------------------- artifacts

function loadDoc(name, path) {
  if (!existsSync(path)) return null;
  const text = readFileSync(path, "utf8");
  return { name, path, text, lines: text.split(/\r?\n/) };
}

function specFiles(dir, out = []) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) specFiles(p, out);
    else if (e.name === "spec.md") out.push(p);
  }
  return out;
}

const proposal = loadDoc("proposal.md", join(changeDir, "proposal.md"));
const design = loadDoc("design.md", join(changeDir, "design.md"));
const tasks = loadDoc("tasks.md", join(changeDir, "tasks.md"));
const specsRoot = join(changeDir, "specs");
const deltas = specFiles(specsRoot).map((p) => {
  const d = loadDoc(relative(changeDir, p).split(sep).join("/"), p);
  d.capPath = relative(specsRoot, dirname(p)).split(sep).join("/");
  return d;
});

const artifacts = [proposal, design, tasks, ...deltas].filter(Boolean);
if (!proposal) {
  console.error(
    `! ${changeDir} has no proposal.md — this is not a change directory`,
  );
  process.exit(2);
}

// ---------------------------------------------------------------- helpers

/** GitHub-flavoured heading slug, matching how the `.ai/` docs anchor themselves. */
function slugify(heading) {
  return heading
    .trim()
    .replace(/<[^>]*>/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, "")
    .replace(/\s/g, "-");
}

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
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[*_`]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Hostnames and file names read as dotted identifiers; neither is a mechanism. */
const TLDS = new Set([
  "market",
  "live",
  "com",
  "br",
  "dev",
  "app",
  "io",
  "net",
  "org",
  "localhost",
]);
const FILE_EXTS =
  /\.(ts|tsx|js|jsx|mjs|cjs|md|sql|json|ya?ml|prisma|css|scss|html|sh|env|lock|toml|txt|png|svg)$/i;

/**
 * A backticked token read as a mechanism name, or null when it is not one.
 * `projectEmail(events)` and `projectEmail` are the same mechanism, and
 * treating them as two is how something covered reads as uncovered.
 */
function cleanToken(raw) {
  const t = raw
    .replace(/\(.*$/, "")
    .replace(/[.,;:]+$/, "")
    .trim();
  if (t.length < 4 || t.startsWith("_")) return null;
  if (FILE_EXTS.test(t)) return null;
  const parts = t.split(".");
  if (parts.length > 1 && TLDS.has(parts[parts.length - 1].toLowerCase()))
    return null;
  if (!/[_.]/.test(t) && !/[a-z][A-Z]/.test(t)) return null;
  return t;
}

/** Every backticked mechanism name in a document. */
function tokensOf(doc) {
  const s = new Set();
  if (!doc) return s;
  for (const m of doc.text.matchAll(
    /`([A-Za-z_][A-Za-z0-9_.]*(?:\([^`]*\))?)`/g,
  )) {
    const t = cleanToken(m[1]);
    if (t) s.add(t);
  }
  return s;
}

/** Body of a `## <heading>` block in one artifact, up to the next `## `. */
function h2Body(doc, re) {
  if (!doc) return null;
  const start = doc.lines.findIndex((l) => /^##\s/.test(l) && re.test(l));
  if (start < 0) return null;
  let end = doc.lines.length;
  for (let i = start + 1; i < doc.lines.length; i++) {
    if (/^##\s/.test(doc.lines[i])) {
      end = i;
      break;
    }
  }
  return { start, end, text: doc.lines.slice(start, end).join("\n") };
}

/** Which `## ` heading a line index falls under, as its text. */
function h2OfLine(doc, idx) {
  for (let i = idx; i >= 0; i--) {
    const m = /^##\s+(.*)$/.exec(doc.lines[i]);
    if (m) return m[1].replace(/[*`]/g, "").trim();
  }
  return "(preamble)";
}

function dirsUnder(root) {
  const out = new Set();
  for (const p of specFiles(root))
    out.add(relative(root, dirname(p)).split(sep).join("/"));
  return out;
}

function git(argv) {
  const r = spawnSync("git", argv, {
    cwd: repoRoot,
    encoding: "utf8",
    shell: false,
  });
  return r.status === 0 ? r.stdout : null;
}

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
      if (e.name === "node_modules" || e.name === ".next" || e.name === "dist")
        continue;
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (SOURCE_EXT.test(e.name)) {
        let text;
        try {
          text = readFileSync(p, "utf8");
        } catch {
          continue;
        }
        for (const t of text.match(/[A-Za-z_][A-Za-z0-9_]{2,}/g) ?? [])
          tokens.add(t);
      }
    }
  };
  for (const r of SOURCE_ROOTS) walk(join(repoRoot, r));
  return tokens;
}

const sourceTokens = collectSourceTokens();

// ---------------------------------------------------------------- upstream: pre-proposal + card

const preProposal = (() => {
  const dir = join(repoRoot, ".ai", "pre-proposals");
  if (!existsSync(dir)) return null;
  const files = readdirSync(dir).filter((f) => f.endsWith(".md"));
  if (!files.length) return null;
  // Same basename as the change directory is the convention; then a `Change name` match;
  // then the newest file, reported so the reader can reject the guess.
  const exact = files.find((f) => f === `${changeName}.md`);
  if (exact) return loadDoc(`pre-proposal ${exact}`, join(dir, exact));
  const stem = changeName.replace(/^\d{4}-\d{2}-\d{2}-/, "");
  for (const f of files) {
    const t = readFileSync(join(dir, f), "utf8");
    if (
      new RegExp(
        `\\*\\*Change name\\*\\*\\s*\\|\\s*\`${stem.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\``,
      ).test(t)
    ) {
      return loadDoc(`pre-proposal ${f}`, join(dir, f));
    }
  }
  const newest = files
    .map((f) => join(dir, f))
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0];
  record(
    "upstream",
    "READ",
    `no pre-proposal named \`${changeName}.md\` and none declaring change name \`${stem}\` — falling back to the newest, ${basename(newest)}. Confirm it is the right upstream before trusting any coverage finding.`,
  );
  return loadDoc(`pre-proposal ${basename(newest)}`, newest);
})();

if (!preProposal) {
  record(
    "upstream",
    "READ",
    "no `.ai/pre-proposals/` document — the coverage checks are skipped and the card is the only upstream. That is a thinner review, so say so in the report.",
  );
}

/** Body of `## <n>. <title>` in the pre-proposal. */
function ppSection(n) {
  if (!preProposal) return null;
  const start = preProposal.lines.findIndex((l) =>
    new RegExp(`^##\\s+${n}\\.\\s`).test(l),
  );
  if (start < 0) return null;
  let end = preProposal.lines.length;
  for (let i = start + 1; i < preProposal.lines.length; i++) {
    if (/^##\s+\d+\.\s/.test(preProposal.lines[i])) {
      end = i;
      break;
    }
  }
  return { start, end, text: preProposal.lines.slice(start, end).join("\n") };
}

const sliceId = (() => {
  if (preProposal) {
    const m = /\|\s*\*\*Slice\*\*\s*\|\s*([\w.]+)\s*—/.exec(preProposal.text);
    if (m) return m[1];
  }
  const m = /slice-([\w]+)-/.exec(changeName);
  return m ? m[1].toUpperCase() : null;
})();

const card = (() => {
  if (!sliceId) return null;
  const path = join(repoRoot, ".ai", "build-checklist.md");
  const cl = readFileSync(path, "utf8").split(/\r?\n/);
  const esc = sliceId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const start = cl.findIndex((l) =>
    new RegExp(`^###\\s+${esc}\\s+—`, "i").test(l),
  );
  if (start < 0) return null;
  let end = cl.length;
  for (let i = start + 1; i < cl.length; i++)
    if (/^###\s/.test(cl[i])) {
      end = i;
      break;
    }
  return cl.slice(start, end);
})();

const shipsBullets = (() => {
  if (!card) return [];
  const ships = [];
  let inShips = false;
  for (const line of card) {
    if (/^-\s+\*\*Ships:\*\*/.test(line)) {
      inShips = true;
      continue;
    }
    if (inShips && /^-\s+\*\*/.test(line)) break;
    if (!inShips) continue;
    const m = /^\s{2,}-\s+\[[ xX]\]\s+(.*)$/.exec(line);
    if (m) ships.push(m[1]);
    else if (ships.length && line.trim())
      ships[ships.length - 1] += " " + line.trim();
  }
  return ships;
})();

// ---------------------------------------------------------------- 1. artifacts present

{
  const required = [
    ["proposal.md", proposal],
    ["design.md", design],
    ["tasks.md", tasks],
  ];
  for (const [name, doc] of required) {
    if (!doc)
      record(
        "artifacts",
        "BLOCK",
        `${name} is missing — \`opsx:apply\` reads it`,
      );
    else if (doc.lines.filter((l) => l.trim()).length < 12)
      record(
        "artifacts",
        "BLOCK",
        `${name} is ${doc.lines.length} lines — a stub, not an artifact`,
      );
  }
  if (!deltas.length) {
    const skip = existsSync(join(changeDir, ".openspec.yaml"))
      ? /skip_specs:\s*true/.test(
          readFileSync(join(changeDir, ".openspec.yaml"), "utf8"),
        )
      : false;
    record(
      "artifacts",
      skip ? "READ" : "BLOCK",
      skip
        ? "no spec deltas, and `.openspec.yaml` declares `skip_specs: true` — confirm this change really changes no required behaviour"
        : "no `specs/<capability>/spec.md` delta — a change with behaviour to state and no delta is the shape that ships untested",
    );
  }
  if (!card)
    record(
      "artifacts",
      "READ",
      `could not resolve a build-checklist card for slice "${sliceId ?? "?"}" — the Ships contract is unchecked`,
    );
}

// ---------------------------------------------------------------- 2. openspec validate

{
  const r = spawnSync("openspec", ["validate", changeName, "--strict"], {
    cwd: repoRoot,
    encoding: "utf8",
    shell: true,
  });
  if (r.error || r.status === null) {
    record(
      "openspec",
      "READ",
      "the `openspec` CLI did not run here — its structural checks are not part of this run",
    );
  } else if (r.status !== 0) {
    const out = `${r.stdout ?? ""}${r.stderr ?? ""}`
      .trim()
      .split(/\r?\n/)
      .slice(0, 20);
    record(
      "openspec",
      "BLOCK",
      `\`openspec validate ${changeName} --strict\` failed:`,
    );
    for (const l of out)
      if (l.trim()) record("openspec", "BLOCK", `    ${l.trim()}`);
  }
}

// ---------------------------------------------------------------- 3. links resolve

{
  for (const doc of artifacts) {
    const docDir = dirname(doc.path);
    const seen = new Set();
    const linkRe = /\[[^\]]*\]\(([^)\s]+)\)/g;
    let m;
    while ((m = linkRe.exec(doc.text))) {
      const target = m[1];
      if (/^(https?:|mailto:)/.test(target)) continue;
      const lineNo = doc.text.slice(0, m.index).split("\n").length;
      const [filePart, anchorPart] = target.split("#");

      if (!filePart) {
        if (!anchorsOf(doc.path).has(anchorPart))
          record(
            "links",
            "BLOCK",
            `${doc.name} L${lineNo}: internal anchor #${anchorPart} does not exist in this file`,
          );
        continue;
      }
      const key = `${doc.name}::${target}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const abs = resolve(docDir, filePart);
      if (!existsSync(abs)) {
        record(
          "links",
          "BLOCK",
          `${doc.name} L${lineNo}: link target does not exist — ${target}`,
        );
        continue;
      }
      if (anchorPart && abs.endsWith(".md") && !anchorsOf(abs).has(anchorPart))
        record(
          "links",
          "BLOCK",
          `${doc.name} L${lineNo}: file exists but anchor does not — ${target}`,
        );
    }
  }
}

// ---------------------------------------------------------------- 4. file:line evidence

{
  const re = /`((?:[\w.@-]+\/)+[\w.-]+\.\w+):(\d+)(?:-(\d+))?`/g;
  const seen = new Set();
  for (const doc of artifacts) {
    let m;
    const r = new RegExp(re.source, "g");
    while ((m = r.exec(doc.text))) {
      const [, rel, fromStr, toStr] = m;
      const key = `${rel}:${fromStr}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const lineNo = doc.text.slice(0, m.index).split("\n").length;
      const abs = join(repoRoot, rel);
      if (!existsSync(abs)) {
        record(
          "evidence",
          "BLOCK",
          `${doc.name} L${lineNo}: cited file does not exist — ${rel}:${fromStr}`,
        );
        continue;
      }
      const count = readFileSync(abs, "utf8").split(/\r?\n/).length;
      const last = Number(toStr ?? fromStr);
      if (last > count)
        record(
          "evidence",
          "BLOCK",
          `${doc.name} L${lineNo}: ${rel} has ${count} lines, cited line ${last} does not exist`,
        );
    }
  }
}

// ---------------------------------------------------------------- 5. scope — the card's Ships list

{
  if (!shipsBullets.length) {
    if (card)
      record(
        "scope",
        "READ",
        "the card has no parsable `Ships` list — check the scope contract by hand",
      );
  } else if (proposal) {
    const pNorm = normalize(proposal.text);
    const nShips = shipsBullets.map(normalize);

    nShips.forEach((s, i) => {
      if (pNorm.includes(s)) return;
      const head = s.slice(0, 60);
      const at = pNorm.indexOf(head);
      if (at >= 0) {
        const got = pNorm.slice(at, at + s.length + 80);
        let k = 0;
        while (k < s.length && s[k] === got[k]) k++;
        record(
          "scope",
          "BLOCK",
          `Ships bullet ${i + 1} was reworded in proposal.md — diverges around char ${k}: card "…${s.slice(Math.max(0, k - 40), k + 60)}…" vs proposal "…${got.slice(Math.max(0, k - 40), k + 60)}…"`,
        );
      } else {
        record(
          "scope",
          "BLOCK",
          `Ships bullet ${i + 1} appears nowhere in proposal.md — the scope contract dropped it: "${s.slice(0, 110)}…"`,
        );
      }
    });

    // Widening: find the `## ` section holding the scope list, then flag items in it that
    // match no bullet. Numbered lists elsewhere in the proposal are left alone.
    const items = [];
    proposal.lines.forEach((line, i) => {
      const m = /^(\d+)\.\s+(.*)$/.exec(line);
      if (m) items.push({ idx: i, text: m[2], sec: h2OfLine(proposal, i) });
      else if (
        items.length &&
        line.trim() &&
        !/^#/.test(line) &&
        i === items[items.length - 1].idx + 1
      )
        items[items.length - 1].text += " " + line.trim();
    });
    const bySection = new Map();
    for (const it of items) {
      const n = normalize(it.text);
      const matched = nShips.some(
        (s) => n.includes(s.slice(0, 60)) || s.includes(n.slice(0, 60)),
      );
      if (!bySection.has(it.sec))
        bySection.set(it.sec, { matched: 0, misses: [] });
      const b = bySection.get(it.sec);
      if (matched) b.matched++;
      else b.misses.push(n);
    }
    const scopeSection = [...bySection.entries()].sort(
      (a, b) => b[1].matched - a[1].matched,
    )[0];
    if (scopeSection && scopeSection[1].matched >= 3) {
      for (const miss of scopeSection[1].misses)
        record(
          "scope",
          "BLOCK",
          `proposal.md "${scopeSection[0]}" lists an item the card does not carry — scope was widened: "${miss.slice(0, 110)}…"`,
        );
    }
  }
}

// ---------------------------------------------------------------- 6. decisions

{
  const designIds = new Set();
  const designHeadingLines = new Set();
  if (design) {
    design.lines.forEach((line, i) => {
      const m = /^###\s+(D\d+(?:\s*\/\s*D\d+)*)\s*[—–\-:]/.exec(line);
      if (!m) return;
      designHeadingLines.add(i);
      for (const id of m[1].split(/\s*\/\s*/)) designIds.add(id.trim());
    });
  }

  const ppIds = new Set();
  const s7 = ppSection(7);
  if (s7) {
    for (const line of s7.text.split("\n")) {
      const m = /^\*\*(D\d+)\s*[—–\-]/.exec(line);
      if (m) ppIds.add(m[1]);
    }
  }

  // Dangling citations — a task or a spec pointing at a decision design.md never made.
  for (const doc of artifacts) {
    const r = /\bD(\d+)\b/g;
    let m;
    while ((m = r.exec(doc.text))) {
      const lineNo = doc.text.slice(0, m.index).split("\n").length;
      if (doc === design && designHeadingLines.has(lineNo - 1)) continue;
      const id = `D${m[1]}`;
      if (!designIds.has(id))
        record(
          "decisions",
          "BLOCK",
          `${doc.name} L${lineNo}: cites ${id}, which design.md does not define — the builder has nothing to read`,
        );
    }
  }

  if (ppIds.size) {
    const dropped = [...ppIds].filter((id) => !designIds.has(id));
    const added = [...designIds].filter((id) => !ppIds.has(id));
    if (dropped.length)
      record(
        "decisions",
        "READ",
        `the pre-proposal decided ${dropped.join(", ")} and design.md carries no such id — either the decision was renumbered, folded into another, or lost. Read each: a lost decision is the class that reaches the migration.`,
      );
    if (added.length)
      record(
        "decisions",
        "READ",
        `design.md decides ${added.join(", ")}, which the pre-proposal never carried — new technical calls made at proposal time. Each needs an authority the pre-proposal never checked.`,
      );
  }

  // Every decision must carry an authority, exactly as the pre-proposal's did. Reported as
  // two lists rather than two findings per decision — a per-decision line for seventeen
  // decisions buries the one that matters.
  if (design) {
    const unanchored = [];
    const noAlternative = [];
    const blocks = design.text.split(/\n(?=###\s+D\d+)/).slice(1);
    for (const b of blocks) {
      const id = /^###\s+(D\d+[^\n—–\-:]*)/.exec(b)?.[1]?.trim() ?? "?";
      const hasAuthority =
        /\.md[#)]/.test(b) ||
        /`[\w./@-]+\.\w+:\d+/.test(b) ||
        /owner-ruled/i.test(b) ||
        /decision lens/i.test(b) ||
        /ADR-\d+/.test(b) ||
        /pp-[a-z]+/.test(b);
      if (!hasAuthority) unanchored.push(id);
      if (!/alternative|rejected|instead of|rather than|over\s+\w/i.test(b))
        noAlternative.push(id);
    }
    if (unanchored.length)
      record(
        "decisions",
        "READ",
        `design.md decisions carrying no anchor, \`file:line\`, ADR, skill or lens clause: ${unanchored.join(", ")} — read each and name what settles it, or it is a preference the builder may reverse`,
      );
    if (noAlternative.length)
      record(
        "decisions",
        "READ",
        `design.md decisions stating no rejected alternative: ${noAlternative.join(", ")} — the schema asks "why X over Y", and a decision with no Y is one the builder re-opens at 2am`,
      );
  }
}

// ---------------------------------------------------------------- 7. capabilities

{
  const mainSpecs = dirsUnder(join(repoRoot, "openspec", "specs"));
  const deltaPaths = new Set(deltas.map((d) => d.capPath));

  const listed = { new: new Set(), modified: new Set() };
  if (proposal) {
    let bucket = null;
    for (const line of proposal.lines) {
      if (/^###\s+New Capabilities/i.test(line)) bucket = "new";
      else if (/^###\s+Modified Capabilities/i.test(line)) bucket = "modified";
      else if (/^##\s/.test(line)) bucket = null;
      else if (bucket) {
        const m = /^-\s+`([\w-]+(?:\/[\w-]+)*)`/.exec(line.trim());
        if (m) listed[bucket].add(m[1].replace(/^openspec\/specs\//, ""));
      }
    }
  }

  for (const p of listed.new)
    if (mainSpecs.has(p))
      record(
        "capabilities",
        "BLOCK",
        `proposal.md lists \`${p}\` as NEW but \`openspec/specs/${p}/spec.md\` already exists — it is MODIFIED`,
      );
  for (const p of listed.modified)
    if (!mainSpecs.has(p))
      record(
        "capabilities",
        "BLOCK",
        `proposal.md lists \`${p}\` as MODIFIED but \`openspec/specs/${p}/\` does not exist — it is NEW`,
      );
  for (const p of [...listed.new, ...listed.modified])
    if (!deltaPaths.has(p))
      record(
        "capabilities",
        "BLOCK",
        `proposal.md lists \`${p}\` but the change carries no \`specs/${p}/spec.md\` — the capability was promised and never written`,
      );
  for (const p of deltaPaths)
    if (!listed.new.has(p) && !listed.modified.has(p))
      record(
        "capabilities",
        "BLOCK",
        `\`specs/${p}/spec.md\` exists but proposal.md's Capabilities section never lists it — the proposal and the specs disagree about what this change touches`,
      );

  for (const d of deltas) {
    const isNew = !mainSpecs.has(d.capPath);
    const ops = [
      ...d.text.matchAll(
        /^##\s+(ADDED|MODIFIED|REMOVED|RENAMED)\s+Requirements/gm,
      ),
    ].map((m) => m[1]);
    if (!ops.length)
      record(
        "capabilities",
        "BLOCK",
        `${d.name} has no \`## ADDED|MODIFIED|REMOVED|RENAMED Requirements\` header — nothing to apply`,
      );
    if (isNew && ops.some((o) => o !== "ADDED"))
      record(
        "capabilities",
        "BLOCK",
        `${d.name} declares ${ops.filter((o) => o !== "ADDED").join("/")} on a capability that does not exist yet — there is nothing there to modify or remove`,
      );
    const hasPurpose = /^##\s+Purpose/m.test(d.text);
    if (isNew && !hasPurpose)
      record(
        "capabilities",
        "READ",
        `${d.name} is a new capability with no \`## Purpose\` — the template asks for one`,
      );
    if (!isNew && hasPurpose)
      record(
        "capabilities",
        "READ",
        `${d.name} is a delta on an existing capability and still carries \`## Purpose\` — the template says delete it there`,
      );
  }

  // The pre-proposal already mapped the capability set; a path it named and the change
  // dropped is scope quietly leaving through the spec layer.
  const s23 = ppSection(23);
  if (s23) {
    const mapped = new Set();
    for (const m of s23.text.matchAll(/`([\w-]+(?:\/[\w-]+)+)`/g))
      mapped.add(m[1].replace(/^openspec\/specs\//, ""));
    for (const p of mapped)
      if (!deltaPaths.has(p) && (mainSpecs.has(p) || /\//.test(p)))
        record(
          "capabilities",
          "READ",
          `the pre-proposal's §23 mapped \`${p}\`; the change carries no delta for it — dropped, or renamed?`,
        );
  }
}

// ---------------------------------------------------------------- 8. spec shape

{
  for (const d of deltas) {
    const blocks = d.text.split(/\n(?=###\s+Requirement:)/).slice(1);
    if (!blocks.length)
      record(
        "spec-shape",
        "BLOCK",
        `${d.name} declares requirements and defines none`,
      );
    for (const b of blocks) {
      const title = (/^###\s+Requirement:\s*(.*)$/m.exec(b)?.[1] ?? "?").trim();
      const scenarios = [...b.matchAll(/^####\s+Scenario:\s*(.*)$/gm)];
      if (!scenarios.length)
        record(
          "spec-shape",
          "BLOCK",
          `${d.name} — "${title.slice(0, 70)}" has no \`#### Scenario:\` — a requirement with no scenario cannot be tested, so nothing proves it shipped`,
        );
      const body = b.split(/^####\s+Scenario:/m)[0];
      if (!/\b(SHALL|MUST)\b/.test(body))
        record(
          "spec-shape",
          "READ",
          `${d.name} — "${title.slice(0, 70)}" states no SHALL/MUST in its body; check it is a requirement and not a description`,
        );
      for (const s of b.split(/\n(?=####\s+Scenario:)/).slice(1)) {
        const sTitle = (
          /^####\s+Scenario:\s*(.*)$/m.exec(s)?.[1] ?? "?"
        ).trim();
        if (!/\*\*WHEN\*\*/.test(s) || !/\*\*THEN\*\*/.test(s))
          record(
            "spec-shape",
            "BLOCK",
            `${d.name} — scenario "${sTitle.slice(0, 60)}" is missing a WHEN or a THEN`,
          );
      }
    }

    // A spec is a behaviour contract. Implementation names in it are the leak that makes
    // the spec un-reusable the moment the implementation changes.
    const leaks = new Set();
    for (const m of d.text.matchAll(/`([A-Za-z0-9_./-]+)`/g)) {
      const t = m[1];
      if (/\.(ts|tsx|sql|prisma|mjs|json)$/.test(t)) leaks.add(t);
      else if (
        /^[A-Z][A-Za-z0-9]*(Command|Service|Repository|Controller|Guard|Module|Interceptor|Middleware|Dto)$/.test(
          t,
        )
      )
        leaks.add(t);
    }
    if (leaks.size)
      record(
        "spec-shape",
        "READ",
        `${d.name} names implementation, not behaviour: ${[...leaks]
          .slice(0, 8)
          .map((t) => `\`${t}\``)
          .join(
            " ",
          )} — a spec that changes when a class is renamed is the wrong altitude`,
      );

    const paths = [
      ...d.text.matchAll(/\b(GET|POST|PUT|PATCH|DELETE)\s+(\/[\w{}\/-]*)/g),
    ];
    if (paths.length)
      record(
        "spec-shape",
        "BLOCK",
        `${d.name} assigns endpoint paths (${paths
          .slice(0, 3)
          .map((p) => `${p[1]} ${p[2]}`)
          .join(
            ", ",
          )}) — api-contract.md is the only place operations get paths and verbs`,
      );
  }
}

// ---------------------------------------------------------------- 9. tasks

{
  if (tasks) {
    const groups = [];
    tasks.lines.forEach((line, i) => {
      const m = /^##\s+(\d+)\.\s+(.*)$/.exec(line);
      if (m) groups.push({ n: Number(m[1]), title: m[2], idx: i });
    });
    const items = [];
    tasks.lines.forEach((line, i) => {
      const m = /^\s*-\s+\[([ xX])\]\s+([\d.]+)?\s*(.*)$/.exec(line);
      if (m)
        items.push({ done: m[1] !== " ", id: m[2] ?? "", text: m[3], idx: i });
    });

    if (!items.length)
      record(
        "tasks",
        "BLOCK",
        "tasks.md has no `- [ ]` checkboxes — the apply phase tracks progress by parsing them, so nothing would be tracked",
      );

    const done = items.filter((t) => t.done);
    if (done.length)
      record(
        "tasks",
        "BLOCK",
        `${done.length} task(s) are already ticked — this is not a pre-apply state. Either apply has started (review it as work in progress, not as a plan) or the boxes were written pre-ticked`,
      );

    // The gate must be the last thing anyone does.
    const runsVerify = (t) =>
      /\bruns?\b[^.]{0,40}pnpm verify|pnpm verify[^.]{0,40}\b(and report|exit 0)/i.test(
        t.text,
      );
    const verifyItems = items.filter(runsVerify);
    if (!verifyItems.length)
      record(
        "tasks",
        "BLOCK",
        "no task runs `pnpm verify` and reports its output — exit 0 with every stage run is the only definition of done, and a task that merely names a `verify` stage is not that task",
      );
    else if (groups.length) {
      const lastGroup = groups[groups.length - 1];
      if (!verifyItems.some((t) => t.idx > lastGroup.idx))
        record(
          "tasks",
          "BLOCK",
          `\`pnpm verify\` runs in an earlier group and not in the last one ("${lastGroup.title.slice(0, 50)}") — the gate must be the last thing anyone does`,
        );
    }

    // Each task states how it is verified. This is the schema's own rule, and it is what
    // makes a task independently checkable rather than a description of intent.
    const unverifiable = items.filter(
      (t) =>
        !/\bverif|\bprove|\bassert|exit 0|passes|fails|report|renders|refus|returns\b/i.test(
          t.text,
        ),
    );
    if (unverifiable.length)
      record(
        "tasks",
        "READ",
        `${unverifiable.length} task(s) state no way to check completion — ${unverifiable
          .slice(0, 4)
          .map((t) => t.id || `L${t.idx + 1}`)
          .join(", ")}${unverifiable.length > 4 ? " …" : ""}`,
      );

    // Ask-first: derive the triggers from the change itself, then require the pause.
    const all = artifacts.map((a) => a.text).join("\n");
    const triggers = [
      [
        /schema\.prisma|supabase\/migrations|CREATE TABLE|ALTER TABLE|CREATE UNIQUE INDEX/i,
        "DB schema change",
      ],
      [
        /package\.json|new dependency|add(?:ing)? a dependency/i,
        "new dependency",
      ],
      [/\.github\/workflows|CI change/i, "CI change"],
      [
        /OpenAPI|api-client|public contract|ApiHeader|security scheme/i,
        "public contract change",
      ],
    ];
    const flagged = tasks.text.match(/Ask-first/gi)?.length ?? 0;
    for (const [re, label] of triggers) {
      if (!re.test(all)) continue;
      if (!new RegExp(`Ask-first`, "i").test(tasks.text))
        record(
          "tasks",
          "BLOCK",
          `the change involves a ${label} and no task is flagged **Ask-first** — apply would commit it without the owner`,
        );
    }
    if (flagged)
      record(
        "tasks",
        "READ",
        `${flagged} Ask-first marker(s) in tasks.md — check each names what the owner is approving, not just that they must approve`,
      );

    // Doc-update duties pp-workflow owes. Only asked for where the change earns them.
    const duties = [
      [
        /build-checklist/i,
        "the build-checklist slice `Status` line and its `Ships` boxes",
        true,
      ],
      [
        /Model index|data-modeling/i,
        "the data-modeling **Model index** `Modeled` checkbox",
        /CREATE TABLE|new table|schema\.prisma/i.test(all),
      ],
      [
        /api-contract/i,
        "`.ai/api-contract.md`",
        /operation|endpoint|OpenAPI/i.test(all),
      ],
      [
        /AGENTS\.md/i,
        "the project `AGENTS.md` folder tree",
        /new (file|folder|directory)|proxy\.ts|route segment/i.test(all),
      ],
      [
        /\.env\.example/i,
        "`.env.example`",
        /env var|environment variable|process\.env|[A-Z_]{6,}=/.test(all),
      ],
      [/views\.md/i, "`.ai/views.md`", /screen|surface|view|page/i.test(all)],
    ];
    for (const [re, label, owed] of duties)
      if (owed && !re.test(tasks.text))
        record(
          "tasks",
          "READ",
          `no task updates ${label} — pp-workflow makes it part of the change, and a doc duty left out of tasks.md is one nobody does`,
        );

    // Ordering: a task naming an artifact that a later task creates.
    // Skip the verify task (it names everything) and Ask-first namers (they
    // name work a later task is supposed to build). A create-verb has to sit
    // immediately before the backticked token, not merely somewhere in the task.
    const createNear = (text, tok) => {
      const escaped = tok.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      // Verb at the start of the task or of a new clause — not "a create with"
      // or "half-created", which are how this check drowned in false positives.
      if (
        !new RegExp(
          `(?:^|[.;]\\s+)(?:\\*\\*)?(?:add(?:s|ing)?|creates?|introduces?|writes?|implements?|generates?|exposes?|declares?)\\b[^\\\`\\n]{0,80}\`${escaped}\``,
          "i",
        ).test(text)
      )
        return false;
      // "Add the clause to `api-contract.md`" edits an existing file; it does not create it.
      if (new RegExp(`\\bto\\s+\\[?\`${escaped}\``, "i").test(text))
        return false;
      return true;
    };
    const artifactsIn = (text) => {
      const out = new Set();
      for (const m of text.matchAll(/`([^`]+)`/g)) {
        const raw = m[1].replace(/\(.*$/, "").trim();
        const tok = cleanToken(m[1]);
        if (tok) out.add(tok);
        else if (
          raw.length >= 4 &&
          (FILE_EXTS.test(raw) || /\/[\w.-]/.test(raw))
        )
          out.add(raw);
      }
      return out;
    };
    const firstByTok = new Map();
    const inverted = [];
    for (const t of items) {
      if (runsVerify(t)) continue;
      const askFirst = /Ask-first/i.test(t.text);
      for (const tok of artifactsIn(t.text)) {
        const created = createNear(t.text, tok);
        if (askFirst && !created) continue;
        const prev = firstByTok.get(tok);
        if (!prev) {
          firstByTok.set(tok, { id: t.id, idx: t.idx, created });
          continue;
        }
        if (created && !prev.created) {
          inverted.push({ tok, named: prev, created: t });
          prev.created = true;
        }
      }
    }
    if (inverted.length)
      record(
        "tasks",
        "READ",
        `${inverted.length} task(s) name an artifact a later task creates — ${inverted
          .slice(0, 6)
          .map(
            (x) =>
              `${x.named.id || `L${x.named.idx + 1}`} names \`${x.tok}\` before ${x.created.id || `L${x.created.idx + 1}`}`,
          )
          .join(
            "; ",
          )}${inverted.length > 6 ? " …" : ""} — apply walks tasks in order`,
      );

    const pairs = [
      [
        /seed\.sql/i,
        /\bmigration\b|\bbackfill\b/i,
        "`seed.sql` edit",
        "migration/backfill",
      ],
      [
        /OpenAPI|api-contract\.md|public contract/i,
        /generate:api-client|regenerat(?:e|ed|ing).{0,40}(?:api[- ]?client|\bclient\b)/i,
        "contract change",
        "client regeneration",
      ],
    ];
    for (const [needFirst, needSecond, firstLabel, secondLabel] of pairs) {
      const a = items.find((t) => !runsVerify(t) && needFirst.test(t.text));
      const b = items.find((t) => !runsVerify(t) && needSecond.test(t.text));
      if (a && b && b.idx < a.idx)
        record(
          "tasks",
          "READ",
          `task ${b.id || `L${b.idx + 1}`} (${secondLabel}) appears before task ${a.id || `L${a.idx + 1}`} (${firstLabel}) — apply walks tasks in order`,
        );
    }

    const groupNums = groups.map((g) => g.n);
    if (groupNums.some((n, i) => i > 0 && n <= groupNums[i - 1]))
      record(
        "tasks",
        "READ",
        `task group numbers are not ascending (${groupNums.join(", ")}) — apply walks them in order`,
      );
  }
}

// ---------------------------------------------------------------- 10. coverage — what the pre-proposal carried

{
  const changeText = artifacts.map((a) => a.text).join("\n");
  const changeNorm = normalize(changeText).toLowerCase();
  const specText = deltas.map((d) => d.text).join("\n");

  const distinctive = (text) => {
    const out = new Set();
    for (const m of text.matchAll(
      /`([A-Za-z_][A-Za-z0-9_.]*(?:\([^`]*\))?)`/g,
    )) {
      const t = cleanToken(m[1]);
      if (t) out.add(t);
    }
    return [...out];
  };

  // §14 — business rules. Each should have become a requirement somewhere.
  const s14 = ppSection(14);
  if (s14 && deltas.length) {
    const rules = [];
    for (const line of s14.text.split("\n")) {
      const m = /^(\d+)\.\s+(.*)$/.exec(line);
      if (m) rules.push({ n: Number(m[1]), text: m[2] });
      else if (rules.length && line.trim() && !/^#/.test(line))
        rules[rules.length - 1].text += " " + line.trim();
    }
    // A rule is matched on any backticked word it names, mechanism or vocabulary —
    // `bounced` is as good a hook as `recipient_state` for asking "did this rule
    // survive?", and requiring mechanism-shaped tokens invents orphans that are covered.
    const ruleWords = (text) =>
      [
        ...new Set(
          [...text.matchAll(/`([A-Za-z_][A-Za-z0-9_.]{3,})`/g)].map(
            (m) => m[1],
          ),
        ),
      ].filter((t) => !FILE_EXTS.test(t));
    const orphans = rules.filter((r) => {
      const toks = ruleWords(r.text);
      if (!toks.length) return false;
      return !toks.some((t) => specText.includes(t));
    });
    if (orphans.length)
      record(
        "coverage",
        "READ",
        `${orphans.length} of the pre-proposal's ${rules.length} §14 rules name nothing that appears in any spec delta — rule ${orphans
          .slice(0, 6)
          .map((r) => r.n)
          .join(
            ", ",
          )}${orphans.length > 6 ? " …" : ""}. A rule with no requirement is a rule nothing will prove.`,
      );
    if (rules.length) {
      const reqCount = (specText.match(/^###\s+Requirement:/gm) ?? []).length;
      record(
        "coverage",
        "READ",
        `${rules.length} rules in the pre-proposal's §14, ${reqCount} \`### Requirement:\` in the deltas — the counts need not match, but a large gap is where rules go missing`,
      );
    }
  }

  // §12 — UI surfaces. Each named view should reach tasks.md.
  const s12 = ppSection(12);
  if (s12 && tasks) {
    const views = [];
    for (const line of s12.text.split("\n")) {
      const m = /^###\s+12\.\d+\s+(.*)$/.exec(line);
      if (!m) continue;
      const tail = m[1]
        .split("—")
        .pop()
        .replace(/\(.*?\)/g, "")
        .replace(/[,*`].*$/, "")
        .trim();
      if (tail.length > 3) views.push(tail);
    }
    const missing = views.filter(
      (v) => !normalize(tasks.text).toLowerCase().includes(v.toLowerCase()),
    );
    if (missing.length)
      record(
        "coverage",
        "READ",
        `views the pre-proposal specified and tasks.md never names: ${missing.map((v) => `"${v}"`).join(", ")} — a screen with no task is a screen nobody builds`,
      );
  }

  // §22 — the doc edits the change owes.
  const s22 = ppSection(22);
  if (s22 && tasks) {
    const docs = new Set();
    for (const m of s22.text.matchAll(/([\w-]+\.md|\.env\.example)/g))
      docs.add(m[1]);
    const missing = [...docs].filter((d) => !tasks.text.includes(d));
    if (missing.length)
      record(
        "coverage",
        "READ",
        `the pre-proposal's §22 owes edits to ${missing.join(", ")} and tasks.md names none of them — the change would land leaving a ratified doc wrong`,
      );
  }

  // §8 / §10 — tables and operations named upstream, absent downstream.
  for (const [n, label] of [
    [8, "data-model objects"],
    [10, "backend operations"],
    [11, "async mechanisms"],
    [18, "env vars, secrets and owner ops"],
  ]) {
    const s = ppSection(n);
    if (!s) continue;
    // Only things that do not already exist. A token the source tree knows was context in
    // the pre-proposal, not work the change owes, and listing it drowns the ones that are.
    const toks = distinctive(s.text).filter(
      (t) => t.length >= 6 && !t.split(".").every((p) => sourceTokens.has(p)),
    );
    const missing = toks.filter((t) => !changeText.includes(t));
    if (missing.length)
      record(
        "coverage",
        "READ",
        `§${n} ${label} named in the pre-proposal, absent from the source tree, and absent from the change: ${missing
          .slice(0, 20)
          .map((t) => `\`${t}\``)
          .join(
            " ",
          )}${missing.length > 20 ? ` …and ${missing.length - 20} more` : ""}`,
      );
  }
}

// ---------------------------------------------------------------- 11. residue

{
  const re =
    /\b(TBD|TODO|to be decided|decide later|unclear|up to the implementer|implementer(?:'s)? choice|at implementation time|as appropriate|an appropriate message|we (?:could|might) (?:also )?(?:either|choose))\b/i;
  const allowedHeadings = /deferred|open question|risk|non-goal|out of scope/i;
  for (const doc of artifacts) {
    doc.lines.forEach((line, i) => {
      if (/^#/.test(line)) return;
      const m = re.exec(line);
      if (!m) return;
      const sec = h2OfLine(doc, i);
      record(
        "residue",
        allowedHeadings.test(sec) ? "READ" : "BLOCK",
        `${doc.name} L${i + 1} (${sec}): "${m[0]}" — ${line.trim().slice(0, 130)}`,
      );
    });
  }
}

// ---------------------------------------------------------------- 12. named identifiers

{
  const STOP = new Set(
    (
      "true false null undefined string number boolean object array void never unknown this that " +
      "and the for with from into over under when then else must should shall not always " +
      "value values type types kind kinds name names item items list lists data row rows table tables " +
      "column columns field fields state status active pending closed error errors page pages view views " +
      "read reads write writes command commands event events job jobs test tests spec specs " +
      "monthly yearly slice slices tenant tenants operator operators seller sellers buyer buyers admin"
    ).split(/\s+/),
  );
  const candidates = new Map(); // token -> "artifact Lnn"
  for (const doc of artifacts) {
    const r = /`([A-Za-z_][A-Za-z0-9_.]*(?:\([^`]*\))?)`/g;
    let m;
    while ((m = r.exec(doc.text))) {
      const raw = cleanToken(m[1]);
      if (!raw) continue;
      if (STOP.has(raw.toLowerCase())) continue;
      if (!candidates.has(raw))
        candidates.set(
          raw,
          `${doc.name} L${doc.text.slice(0, m.index).split("\n").length}`,
        );
    }
  }

  const grafted = [];
  const wholly = [];
  for (const [tok, where] of candidates) {
    // Segments under three characters are below the source tokeniser's floor, so `profile.id`
    // would always read as grafted. That is a property of the scan, not of the document.
    const parts = tok.split(".").filter((p) => p.length >= 3);
    if (!parts.length) continue;
    const missing = parts.filter((p) => !sourceTokens.has(p));
    if (!missing.length) continue;
    if (parts.length > 1 && missing.length < parts.length)
      grafted.push({
        tok,
        where,
        owner: parts.filter((p) => sourceTokens.has(p)).join("."),
        missing: missing.join(", "),
      });
    else wholly.push({ tok, where });
  }

  for (const g of grafted.slice(0, 25))
    record(
      "identifiers",
      "READ",
      `${g.where}: \`${g.tok}\` — \`${g.owner}\` exists in the source tree, \`${g.missing}\` does not. Does this change add it, or is it assuming it?`,
    );
  if (grafted.length > 25)
    record(
      "identifiers",
      "READ",
      `…and ${grafted.length - 25} more of the same shape`,
    );
  if (wholly.length)
    record(
      "identifiers",
      "READ",
      `${wholly.length} identifier(s) appear nowhere in the source tree — expected for what this change builds, so scan for one that should already exist: ${wholly
        .slice(0, 60)
        .map((w) => `\`${w.tok}\``)
        .join(" ")}${wholly.length > 60 ? " …" : ""}`,
    );
}

// ---------------------------------------------------------------- 13. operations against api-contract.md

{
  const contractPath = join(repoRoot, ".ai", "api-contract.md");
  if (existsSync(contractPath)) {
    const contract = readFileSync(contractPath, "utf8");
    const VERBS = new Set(
      (
        "create get list add remove update delete publish verify activate suspend close unlock provision cancel send " +
        "start stop drive manage upsert author ship pay refund accept reject submit approve mint exchange rotate set"
      ).split(/\s+/),
    );
    const ops = new Map();
    for (const doc of artifacts) {
      const r = /`([a-z][A-Za-z0-9]*)\.([a-z][A-Za-z0-9]*)`/g;
      let m;
      while ((m = r.exec(doc.text))) {
        const [full, , second] = [m[0].slice(1, -1), m[1], m[2]];
        const verbish = /[a-z][A-Z]/.test(second) || VERBS.has(second);
        if (!verbish) continue;
        if (!ops.has(full))
          ops.set(
            full,
            `${doc.name} L${doc.text.slice(0, m.index).split("\n").length}`,
          );
      }
    }
    for (const [op, where] of ops)
      if (!contract.includes(op))
        record(
          "contract",
          "BLOCK",
          `${where}: operation \`${op}\` appears nowhere in \`.ai/api-contract.md\` — operations are named there first, then implemented against it (pp-workflow → Never)`,
        );
  }

  // Endpoint paths anywhere in the change must be paths api-contract.md already assigns.
  if (existsSync(contractPath)) {
    const contract = readFileSync(contractPath, "utf8");
    const seen = new Set();
    for (const doc of artifacts) {
      const r = /\b(GET|POST|PUT|PATCH|DELETE)\s+(\/[\w{}\/-]+)/g;
      let m;
      while ((m = r.exec(doc.text))) {
        const p = m[2].replace(/\{[^}]*\}/g, "{id}");
        if (seen.has(p)) continue;
        seen.add(p);
        if (!contract.replace(/\{[^}]*\}/g, "{id}").includes(p))
          record(
            "contract",
            "READ",
            `${doc.name}: names \`${m[1]} ${m[2]}\`, a path api-contract.md does not assign — check it is not invented here`,
          );
      }
    }
  }
}

// ---------------------------------------------------------------- 14. binding-pattern tripwires

{
  const all = artifacts.map((a) => ({ name: a.name, text: a.text }));
  const trip = (re, msg, level = "READ") => {
    for (const a of all) {
      const m = re.exec(a.text);
      if (!m) continue;
      const lineNo = a.text.slice(0, m.index).split("\n").length;
      record(
        "patterns",
        level,
        `${a.name} L${lineNo}: ${msg} — near "${m[0].slice(0, 80)}"`,
      );
      return;
    }
  };

  trip(
    /redis[^.\n]{0,60}(queue|job queue|enqueue|as the queue)/i,
    "Redis named as a queue. PG-Boss owns delivery (pp-backend → Never, ADR-017)",
    "BLOCK",
  );
  trip(
    /\btenant_id\b[^.\n]{0,60}(from the (?:body|request|client)|client-supplied|request field)/i,
    "a client-supplied `tenant_id`, which is a MUST NOT everywhere",
    "BLOCK",
  );
  trip(
    /(business logic|the rule|validat\w+)[^.\n]{0,40}\b(in the BFF|in the proxy|server action)/i,
    "business logic placed in a BFF — mutations live in backend",
  );
  trip(
    /\b(trigger|stored procedure|plpgsql function)\b[^.\n]{0,60}(comput|calculat|derive|enforce the rule)/i,
    "business logic in a DB trigger or function (pp-database → Never)",
  );
  trip(
    /\bDB view\b|\bdatabase view\b/i,
    "a database view used as a contract (pp-database → Never)",
  );
  trip(
    /global exception filter|route version/i,
    "a global exception filter or route versioning (pp-backend → Never)",
  );
  trip(
    /@nestjs\/cqrs|BaseRepository|IRepository|BaseEntity|@Transactional/i,
    "a framework abstraction pp-backend forbids by name",
  );
  trip(
    /full[- ]text search|to_tsvector|postgres FTS/i,
    "Postgres FTS on the search path, which is a MUST NOT",
  );
  trip(
    /onDelete:\s*Cascade/i,
    "`onDelete: Cascade` — check it does not cross an aggregate boundary or touch money/fiscal/audit rows",
  );

  // Money path: if the change touches it, pp-money binds and the artifacts must show it.
  const moneyRe =
    /\b(checkout|order|payment|split|payout|commission|fiscal[_ ]document|nota fiscal|reconciliation|refund|invoice|billing_)\w*/i;
  const touchesMoney = all.some((a) => moneyRe.test(a.text));
  if (touchesMoney) {
    const t = all.map((a) => a.text).join("\n");
    if (!/idempot/i.test(t))
      record(
        "patterns",
        "BLOCK",
        "the change touches the money path and no artifact says anything about idempotency — pp-money binds and wins over pp-backend and pp-database",
      );
    if (!/pp-money/.test(t))
      record(
        "patterns",
        "READ",
        "the money path is touched and no artifact cites `pp-money` — check the design was written under it",
      );
    if (
      /\b(float|double|decimal|numeric)\b/i.test(t) &&
      !/centavos|bigint/i.test(t)
    )
      record(
        "patterns",
        "READ",
        "a non-integer money type is named without centavos/bigint nearby — money is integer centavos",
      );
  }

  // Tenancy: a new table needs an RLS decision, stated.
  if (
    /CREATE TABLE|new table|gains? (?:a |three |two )?column/i.test(
      all.map((a) => a.text).join("\n"),
    )
  ) {
    const t = all.map((a) => a.text).join("\n");
    if (!/apply_tenant_rls|RLS/i.test(t))
      record(
        "patterns",
        "BLOCK",
        "the change adds or alters a table and no artifact states an RLS decision — every table is tenant-scoped via `apply_tenant_rls` or global with explicit deny policies",
      );
    if (!/seed\.sql/i.test(t))
      record(
        "patterns",
        "READ",
        "schema moves and `supabase/seed.sql` is never mentioned — a backfill that assumes seeded rows have a shape they do not is the defect that blocks the migration",
      );
  }

  // ADR departures must be argued, never silent.
  if (design) {
    const adrs = new Set(
      [...design.text.matchAll(/ADR-(\d+)/g)].map((m) => m[1]),
    );
    if (!adrs.size)
      record(
        "patterns",
        "READ",
        "design.md cites no ADR — check the technical approach really is outside every ratified architecture decision",
      );
    if (
      /supersede|superseding|depart(?:s|ing)? from|diverge/i.test(design.text)
    )
      record(
        "patterns",
        "READ",
        "design.md speaks of superseding or departing from a ratified decision — a departure is fine, a silent one is not. Check it is argued and that the ADR edit is a task",
      );
  }

  // PII / LGPD.
  const t = all.map((a) => a.text).join("\n");
  if (
    /\b(email|cpf|cnpj|phone|address|name of the (?:buyer|seller)|personal data)\b/i.test(
      t,
    ) &&
    !/LGPD|PII/i.test(t)
  )
    record(
      "patterns",
      "READ",
      "personal data is named and no artifact answers the PII/LGPD question — legal basis, retention, and what must never be logged",
    );
}

// ---------------------------------------------------------------- 15. freshness

{
  const created = (() => {
    const y = join(changeDir, ".openspec.yaml");
    if (existsSync(y)) {
      const m = /created:\s*([\d-]+)/.exec(readFileSync(y, "utf8"));
      if (m) return m[1];
    }
    if (preProposal) {
      const m = /\|\s*\*\*Date\*\*\s*\|\s*([\d-]+)/.exec(preProposal.text);
      if (m) return m[1];
    }
    return null;
  })();

  if (created) {
    const log = git([
      "log",
      `--since=${created}`,
      "--pretty=format:%h %ad %s",
      "--date=short",
    ]);
    const files = git([
      "log",
      `--since=${created}`,
      "--name-only",
      "--pretty=format:",
    ]);
    const touched = new Set(
      (files ?? "")
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => l && SOURCE_ROOTS.some((r) => l.startsWith(r))),
    );
    if (log && log.trim()) {
      const commits = log.trim().split(/\r?\n/);
      record(
        "freshness",
        "READ",
        `${commits.length} commit(s) since the change was written (${created}): ${commits.slice(0, 5).join(" · ")}${commits.length > 5 ? " …" : ""}`,
      );
      if (touched.size)
        record(
          "freshness",
          "READ",
          `source files that moved since then — re-verify any claim resting on them: ${[...touched].slice(0, 20).join(" ")}${touched.size > 20 ? ` …and ${touched.size - 20} more` : ""}`,
        );
    }
  } else {
    record(
      "freshness",
      "READ",
      "no `created:` date on the change and no pre-proposal date — the staleness check could not run",
    );
  }
}

// ---------------------------------------------------------------- 16. orphans across artifacts

{
  const inProposal = tokensOf(proposal);
  const inDesign = tokensOf(design);
  const inTasks = tokensOf(tasks);
  const inSpecs = new Set(deltas.flatMap((d) => [...tokensOf(d)]));

  // Only what the change *commits to*: a spec delta states what must hold, and design.md's
  // data-model and migration sections state what gets built. Everything else in design.md is
  // context and rejected alternatives — `MessageGroupId` appears there precisely because SQS
  // FIFO is NOT built, and listing it as uncovered work buries the ones that are.
  const committed = new Set(inSpecs);
  for (const re of [
    /^##\s+Data model/i,
    /^##\s+Migration Plan/i,
    /^##\s+Schema/i,
  ]) {
    const body = h2Body(design, re);
    if (!body) continue;
    for (const m of body.text.matchAll(
      /`([A-Za-z_][A-Za-z0-9_.]*(?:\([^`]*\))?)`/g,
    )) {
      const t = cleanToken(m[1]);
      if (t) committed.add(t);
    }
  }

  const plannedNotBuilt = [...committed].filter((t) => !inTasks.has(t));
  if (plannedNotBuilt.length)
    record(
      "orphans",
      "READ",
      `committed to in a spec delta or design.md's data model, and named in no task: ${plannedNotBuilt
        .slice(0, 30)
        .map((t) => `\`${t}\``)
        .join(
          " ",
        )}${plannedNotBuilt.length > 30 ? ` …and ${plannedNotBuilt.length - 30} more` : ""} — each is either covered by a task that does not name it, or is work nobody will do`,
    );

  const builtNotPlanned = [...inTasks].filter(
    (t) => !inDesign.has(t) && !inProposal.has(t) && !inSpecs.has(t),
  );
  if (builtNotPlanned.length)
    record(
      "orphans",
      "READ",
      `named only in tasks.md: ${builtNotPlanned
        .slice(0, 25)
        .map((t) => `\`${t}\``)
        .join(
          " ",
        )}${builtNotPlanned.length > 25 ? " …" : ""} — invented at the task layer, so no spec proves it and no decision authorises it`,
    );
}

// ---------------------------------------------------------------- report

const order = [
  "artifacts",
  "openspec",
  "links",
  "evidence",
  "scope",
  "capabilities",
  "spec-shape",
  "decisions",
  "contract",
  "patterns",
  "tasks",
  "residue",
  "coverage",
  "orphans",
  "identifiers",
  "freshness",
  "upstream",
];
const blocking = findings.filter((f) => f.level === "BLOCK").length;

console.log(
  `# mechanical checks — ${relative(repoRoot, changeDir).split(sep).join("/")}`,
);
console.log(`# repo root:     ${repoRoot}`);
console.log(
  `# slice card:    ${sliceId ?? "unresolved"}${card ? "" : "  (not found)"}`,
);
console.log(
  `# pre-proposal:  ${preProposal ? relative(repoRoot, preProposal.path).split(sep).join("/") : "none"}`,
);
console.log(
  `# artifacts:     proposal.md, design.md, tasks.md, ${deltas.length} spec delta(s)`,
);
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
console.log(
  "# A clean run is not a buildable change. It means the cheap defects are gone and the reading can start.",
);
