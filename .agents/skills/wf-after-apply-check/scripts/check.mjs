#!/usr/bin/env node
// Mechanical checks over an *implemented* OpenSpec change, run after `opsx:apply` and before
// `opsx:archive`.
//
//   node .agents/skills/wf-after-apply-check/scripts/check.mjs [<change-dir-or-name>] [--base <ref>]
//
// With no argument it takes the newest directory under `openspec/changes/` that is not
// `archive/`, and diffs `merge-base(main, HEAD)...HEAD`. It reads the four change artifacts,
// the slice card, the pre-apply `REVIEW.md`, and the diff itself.
//
// It reports only what a machine can decide with certainty: an unticked task, an identifier the
// change promised that the tree does not contain, a doc duty nobody discharged, a Drizzle schema
// change with no migration, a suppressed type error, a skipped test. What it cannot decide it turns into a
// worklist for the reading passes rather than a verdict.
//
// Generated and binary files are counted as *evidence* and never listed for reading — a lock
// file is the shadow of a decision made in `package.json`, and reading it costs the budget the
// files carrying decisions need.
//
// Exit code is 0 unless the change or the diff could not be read — findings are data, not failure.

import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, join, relative, resolve, sep } from "node:path";

// ---------------------------------------------------------------- setup

const argv = process.argv.slice(2);
const baseFlagIdx = argv.indexOf("--base");
const baseValueIdx = baseFlagIdx >= 0 ? baseFlagIdx + 1 : -1;
const baseArg = baseFlagIdx >= 0 ? argv[baseValueIdx] : null;
const changeArg = argv.find(
  (a, i) => !a.startsWith("--") && i !== baseValueIdx,
);

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
    "! not inside the Ledger repo (no .ai/build-checklist.md + openspec/ above the cwd)",
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
      "! openspec/changes holds no active change — nothing was applied here",
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

const git = (args, opts = {}) =>
  spawnSync("git", args, {
    cwd: repoRoot,
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
    ...opts,
  });

// ---------------------------------------------------------------- artifacts

function loadDoc(name, path) {
  if (!existsSync(path)) return null;
  const text = readFileSync(path, "utf8");
  return { name, path, text, lines: text.split(/\r?\n/) };
}

const proposal = loadDoc("proposal.md", join(changeDir, "proposal.md"));
const design = loadDoc("design.md", join(changeDir, "design.md"));
const tasks = loadDoc("tasks.md", join(changeDir, "tasks.md"));
const walkthrough = loadDoc(
  "WALKTHROUGH.md",
  join(changeDir, "WALKTHROUGH.md"),
);
const review = loadDoc("REVIEW.md", join(changeDir, "REVIEW.md"));

const deltas = (() => {
  const out = [];
  const walk = (dir, rel) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p, `${rel}${e.name}/`);
      else if (e.name === "spec.md")
        out.push(loadDoc(`specs/${rel}spec.md`, p));
    }
  };
  walk(join(changeDir, "specs"), "");
  return out.filter(Boolean);
})();

const artifacts = [proposal, design, tasks, ...deltas].filter(Boolean);

for (const [label, doc] of [
  ["proposal.md", proposal],
  ["design.md", design],
  ["tasks.md", tasks],
])
  if (!doc) record("artifacts", "BLOCK", `${label} is missing from the change`);
if (!deltas.length)
  record("artifacts", "BLOCK", "no `specs/<capability>/spec.md` in the change");
if (!walkthrough)
  record(
    "artifacts",
    "BLOCK",
    "no `WALKTHROUGH.md` — a slice cannot be ticked without one (build-checklist → the walkthrough a slice owes)",
  );
if (!review)
  record(
    "artifacts",
    "READ",
    "no `REVIEW.md` — the pre-apply gate left no record, so its unconfirmed list is unavailable and this review starts colder",
  );

// ---------------------------------------------------------------- openspec validate

{
  const r = spawnSync(
    "npx",
    [
      "--no-install",
      "openspec",
      "validate",
      changeName,
      "--type",
      "change",
      "--strict",
      "--no-interactive",
    ],
    { cwd: repoRoot, encoding: "utf8", shell: process.platform === "win32" },
  );
  if (r.error || r.status === null)
    record(
      "openspec",
      "READ",
      "`openspec validate --strict` could not run here — run it by hand before trusting the spec shape",
    );
  else if (r.status !== 0) {
    const out = `${r.stdout ?? ""}${r.stderr ?? ""}`
      .split(/\r?\n/)
      .filter((l) => l.trim())
      .slice(0, 12);
    for (const l of out) record("openspec", "BLOCK", l.trim());
  }
}

// ---------------------------------------------------------------- the diff

const base = (() => {
  if (baseArg) return baseArg;
  for (const ref of ["main", "origin/main", "master", "origin/master"]) {
    const r = git(["merge-base", ref, "HEAD"]);
    if (r.status === 0 && r.stdout.trim()) return r.stdout.trim();
  }
  return null;
})();

if (!base) {
  console.error(
    "! could not resolve a diff base — pass one with `--base <ref>` (no main/master reachable)",
  );
  process.exit(2);
}

// Drizzle Kit's `meta/` snapshots and journal are emitted alongside each migration; the `.sql`
// file is the reviewable thing.
const NOISE =
  /(^|\/)(pnpm-lock\.yaml|package-lock\.json|yarn\.lock|\.pnp\.cjs)$|(^|\/)(node_modules|dist|build|coverage|cdk\.out|\.turbo)\/|^packages\/db\/(drizzle|migrations)\/meta\/|\.(snap|map|tsbuildinfo|min\.js|png|jpe?g|gif|webp|avif|ico|svg|woff2?|ttf|otf|eot|pdf|zip|mp4|webm)$/i;

// Migrations live under `packages/db/`; the exact folder is not named yet, so accept both.
const MIGRATION = /^packages\/db\/(drizzle|migrations)\/.*\.sql$/;
const TEST_FILE = /\.(spec|test)\.[jt]sx?$/;
// The Drizzle schema: `packages/db/src/schema/**`, or any `packages/db/src` file declaring a table.
const isSchemaFile = (p) => {
  if (!/^packages\/db\/src\/.*\.ts$/.test(p) || TEST_FILE.test(p)) return false;
  if (p.startsWith("packages/db/src/schema/")) return true;
  const full = join(repoRoot, p);
  return existsSync(full) && /\bpgTable\s*\(/.test(readFileSync(full, "utf8"));
};

const parseDiff = (text) => {
  const files = new Map();
  let cur = null;
  let newLine = 0;
  for (const line of text.split(/\r?\n/)) {
    const h = /^diff --git a\/(.+?) b\/(.+)$/.exec(line);
    if (h) {
      cur = { path: h[2], added: [], removed: 0 };
      files.set(cur.path, cur);
      newLine = 0;
      continue;
    }
    if (!cur) continue;
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
    if (hunk) {
      newLine = Number(hunk[1]);
      continue;
    }
    if (line.startsWith("+++") || line.startsWith("---")) continue;
    if (line.startsWith("+")) {
      cur.added.push({ n: newLine, text: line.slice(1) });
      newLine++;
    } else if (line.startsWith("-")) cur.removed++;
    else if (line.startsWith(" ")) newLine++;
  }
  return files;
};

const diffText = (() => {
  const r = git(["diff", "--unified=0", `${base}...HEAD`]);
  if (r.status !== 0) {
    console.error(`! git diff ${base}...HEAD failed: ${r.stderr?.trim()}`);
    process.exit(2);
  }
  return r.stdout;
})();

const diffFiles = parseDiff(diffText);
const nameStatus = (() => {
  const r = git(["diff", "--name-status", `${base}...HEAD`]);
  const m = new Map();
  if (r.status !== 0) return m;
  for (const line of r.stdout.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const parts = line.split("\t");
    m.set(parts[parts.length - 1], parts[0][0]);
  }
  return m;
})();

const allPaths = [...new Set([...diffFiles.keys(), ...nameStatus.keys()])];
const noisePaths = allPaths.filter((p) => NOISE.test(p));
const readable = allPaths.filter((p) => !NOISE.test(p));

const bucketOf = (p) => {
  if (TEST_FILE.test(p) || /^sim\//.test(p)) return "tests-docs";
  if (/^packages\/db\//.test(p)) return "schema";
  if (/^(apps\/(cli|mcp)|packages\/sdk)\//.test(p)) return "sdk-cli-mcp";
  if (/^infra\//.test(p)) return "infra";
  if (/^(apps|packages|scripts)\//.test(p)) return "backend";
  return "tests-docs";
};

const buckets = {
  schema: [],
  backend: [],
  infra: [],
  "sdk-cli-mcp": [],
  "tests-docs": [],
};
for (const p of readable) buckets[bucketOf(p)].push(p);

const addedOf = (p) => diffFiles.get(p)?.added ?? [];
const addedLines = (paths) =>
  paths.flatMap((p) => addedOf(p).map((a) => ({ ...a, path: p })));
const allAdded = addedLines(readable);

record(
  "diff",
  "READ",
  `\`${base.slice(0, 12)}...HEAD\` — ${readable.length} readable file(s), ${allAdded.length} added line(s); ${noisePaths.length} generated/binary file(s) excluded from reading`,
);
for (const [name, list] of Object.entries(buckets))
  if (list.length)
    record(
      "surfaces",
      "READ",
      `${name} — ${list.length} file(s), ${addedLines(list).length} added line(s): ${list.slice(0, 40).join(" ")}${list.length > 40 ? ` …and ${list.length - 40} more` : ""}`,
    );

// generated files are evidence, not reading
{
  const lock = noisePaths.find((p) =>
    /(pnpm-lock\.yaml|package-lock\.json)$/.test(p),
  );
  if (lock) {
    const pkgs = readable.filter((p) => /(^|\/)package\.json$/.test(p));
    record(
      "generated",
      "READ",
      `${lock} changed — a dependency moved, which is **Ask-first**. Read ${pkgs.length ? pkgs.join(" ") : "the package.json diff (none in this range — check why)"}, never the lock`,
    );
  }
  const schemaChanged = readable.filter(isSchemaFile);
  const migrationAdded = readable.some(
    (p) => MIGRATION.test(p) && nameStatus.get(p) === "A",
  );
  if (schemaChanged.length && !migrationAdded)
    record(
      "generated",
      "BLOCK",
      `the \`packages/db\` schema changed (${schemaChanged.join(" ")}) and no migration was added under \`packages/db/(drizzle|migrations)/\` — the drift stage should have caught this`,
    );
  const editedMigrations = readable.filter(
    (p) => MIGRATION.test(p) && nameStatus.get(p) === "M",
  );
  if (editedMigrations.length)
    record(
      "generated",
      "BLOCK",
      `existing migration(s) edited: ${editedMigrations.join(" ")} — a pushed migration is never edited; the fix is a new forward migration, Ask-first (pp-database → Never)`,
    );
}

// ---------------------------------------------------------------- tasks

const taskItems = [];
if (tasks) {
  tasks.lines.forEach((line, idx) => {
    const m = /^\s*[-*]\s*\[([ xX~])\]\s*(.*)$/.exec(line);
    if (!m) return;
    const idm = /^(\d+(?:\.\d+)*)\s+/.exec(m[2]);
    taskItems.push({
      done: m[1].toLowerCase() === "x",
      id: idm ? idm[1] : null,
      text: m[2],
      idx,
    });
  });

  const open = taskItems.filter((t) => !t.done);
  if (open.length)
    record(
      "tasks",
      "BLOCK",
      `${open.length} of ${taskItems.length} task(s) unticked — the change is not implemented: ${open
        .slice(0, 12)
        .map((t) => t.id ?? `L${t.idx + 1}`)
        .join(
          ", ",
        )}${open.length > 12 ? " …" : ""}. That is an \`opsx:apply\` job, not this one`,
    );
  else if (taskItems.length)
    record(
      "tasks",
      "READ",
      `${taskItems.length} task(s), all ticked — every tick is a claim this pass has to check`,
    );

  const askFirst = taskItems.filter((t) => /ask-first/i.test(t.text));
  if (askFirst.length)
    record(
      "tasks",
      "READ",
      `${askFirst.length} Ask-first task(s) ticked: ${askFirst.map((t) => t.id ?? `L${t.idx + 1}`).join(", ")} — confirm the owner actually approved each before it was committed`,
    );

  // A task stating no check is a task whose completion nothing proves.
  const noCheck = taskItems.filter(
    (t) => !/\bverif|\bconfirm|\bassert|\bprove|\bexpect|exit 0/i.test(t.text),
  );
  if (noCheck.length)
    record(
      "tasks",
      "READ",
      `${noCheck.length} task(s) state no verification clause: ${noCheck
        .slice(0, 12)
        .map((t) => t.id ?? `L${t.idx + 1}`)
        .join(
          ", ",
        )}${noCheck.length > 12 ? " …" : ""} — nothing records what "done" meant for these`,
    );

  const verifyTask = taskItems.find((t) => /pnpm verify/i.test(t.text));
  if (!verifyTask)
    record(
      "tasks",
      "BLOCK",
      "no task runs `pnpm verify` — the gate is not in the task list",
    );
}

// ---------------------------------------------------------------- source tree index

const SOURCE_ROOTS = ["packages", "apps", "infra", "sim", "scripts"];
// The planned layout — root AGENTS.md → Projects.
const PROJECTS = [
  "packages/core",
  "packages/db",
  "packages/resend-client",
  "packages/sdk",
  "apps/ingest",
  "apps/worker",
  "apps/dispatcher",
  "apps/reconciler",
  "apps/api",
  "apps/cli",
  "apps/mcp",
  "infra",
  "sim",
];
const SOURCE_EXT = /\.(ts|tsx|js|mjs|sql|json)$/;
const FILE_EXTS =
  /\.(ts|tsx|js|jsx|mjs|cjs|md|sql|json|ya?ml|css|html|sh|env|lock|toml|txt|png|svg)$/i;

const sourceTokens = (() => {
  const tokens = new Set();
  const walk = (dir) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (
        ["node_modules", "dist", "cdk.out", "coverage", "meta"].includes(e.name)
      )
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
})();

function cleanToken(raw) {
  const t = raw
    .replace(/\(.*$/, "")
    .replace(/[.,;:]+$/, "")
    .trim();
  if (t.length < 4 || t.startsWith("_")) return null;
  if (FILE_EXTS.test(t)) return null;
  if (!/[_.]/.test(t) && !/[a-z][A-Z]/.test(t)) return null;
  return t;
}

// ---------------------------------------------------------------- unbuilt — promised, absent

{
  const STOP = new Set(
    (
      "true false null undefined string number boolean object array void never unknown " +
      "value values type types kind kinds name names item items list lists data row rows " +
      "column columns field fields state status active pending closed error errors page pages " +
      "read reads write writes command commands event events job jobs test tests spec specs " +
      "email emails recipient recipients webhook webhooks token tokens scope scopes"
    ).split(/\s+/),
  );
  // A line that defers something, rules it out, or routes it to another slice is naming a
  // thing the change deliberately did NOT build. Counting those as unbuilt buries the ones
  // that matter — a deferred tail alone can produce thirty of them.
  const OUT_OF_SCOPE =
    /\bdefer|\bout of scope\b|\bnon-goal|\brejected\b|\bnot in this slice\b|→\s*slice|\bslice \d|\blater slice\b|\bwill not\b|\bdo not build\b|\bfuture\b/i;
  const outOfScopeHeading =
    /^#+\s.*(deferred|non-goals?|out of scope|rejected|alternatives)/i;

  const candidates = new Map();
  for (const doc of artifacts) {
    let inOutOfScope = false;
    doc.lines.forEach((line, i) => {
      if (/^#+\s/.test(line)) inOutOfScope = outOfScopeHeading.test(line);
      const skip = inOutOfScope || OUT_OF_SCOPE.test(line);
      for (const m of line.matchAll(
        /`([A-Za-z_][A-Za-z0-9_.]*(?:\([^`]*\))?)`/g,
      )) {
        const tok = cleanToken(m[1]);
        if (!tok || STOP.has(tok.toLowerCase())) continue;
        const prev = candidates.get(tok);
        // One in-scope mention outranks any number of deferred ones.
        if (prev && (!prev.skip || skip)) continue;
        candidates.set(tok, { where: `${doc.name} L${i + 1}`, skip });
      }
    });
  }

  // `webhook_event` in prose and `webhook_events` in the migration are the same table.
  const known = (p) =>
    sourceTokens.has(p) ||
    sourceTokens.has(`${p}s`) ||
    (p.endsWith("s") && sourceTokens.has(p.slice(0, -1))) ||
    (p.endsWith("y") && sourceTokens.has(`${p.slice(0, -1)}ies`));

  const missing = [];
  for (const [tok, meta] of candidates) {
    if (meta.skip) continue;
    const parts = tok.split(".").filter((p) => p.length >= 3);
    if (!parts.length) continue;
    const gone = parts.filter((p) => !known(p));
    if (gone.length)
      missing.push({ tok, where: meta.where, gone: gone.join(", ") });
  }
  if (missing.length)
    for (const m of missing.slice(0, 40))
      record(
        "unbuilt",
        "READ",
        `${m.where}: \`${m.tok}\` — \`${m.gone}\` appears nowhere in the source tree. The change committed to it; find the code or find the ticked box it belongs to`,
      );
  if (missing.length > 40)
    record(
      "unbuilt",
      "READ",
      `…and ${missing.length - 40} more of the same shape`,
    );
  if (!missing.length)
    record(
      "unbuilt",
      "READ",
      "every identifier the change names exists somewhere in the tree — existence is not behaviour, so pass 2 still reads the code behind each ticked box",
    );
}

// ---------------------------------------------------------------- undeclared — built, unnamed

// Tasks describe work in prose, so most files are legitimately unnamed — listing them all
// buries the signal. A whole *directory* nothing in the change mentions is the shape worth
// reading: that is where scope crept, or where a task produced something it did not describe.
{
  const artifactText = artifacts.map((a) => a.text).join("\n");
  const byDir = new Map();
  for (const p of readable) {
    if (p.startsWith("openspec/changes/")) continue;
    const dir = p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : ".";
    if (!byDir.has(dir)) byDir.set(dir, []);
    byDir.get(dir).push(p);
  }
  const silent = [];
  for (const [dir, files] of byDir) {
    const named =
      artifactText.includes(dir) ||
      files.some((f) => artifactText.includes(basename(f)));
    if (!named) silent.push({ dir, n: files.length });
  }
  if (silent.length)
    record(
      "undeclared",
      "READ",
      `${silent.length} director(ies) whose files the change never names: ${silent
        .slice(0, 20)
        .map((s) => `${s.dir} (${s.n})`)
        .join(
          " · ",
        )}${silent.length > 20 ? " …" : ""} — either scope crept, or a task's text does not match what it produced`,
    );
  const declaredElsewhere = readable.filter(
    (p) =>
      !p.startsWith("openspec/changes/") && artifactText.includes(basename(p)),
  ).length;
  record(
    "undeclared",
    "READ",
    `${declaredElsewhere} of ${readable.length} changed file(s) are named somewhere in the change`,
  );
}

// ---------------------------------------------------------------- doc duties

const checklist = loadDoc(
  "build-checklist.md",
  join(repoRoot, ".ai", "build-checklist.md"),
);
const dataModeling = loadDoc(
  "data-modeling.md",
  join(repoRoot, ".ai", "data-modeling.md"),
);
const apiContract = loadDoc(
  "api-contract.md",
  join(repoRoot, ".ai", "api-contract.md"),
);

// The change name is the most reliable source: a proposal links several slices (its
// dependencies, its deferred tail's destinations) and the first link is rarely its own.
const sliceId = (() => {
  const n = /\bslice[-_ ]?(\d+[a-z]?)\b/i.exec(changeName);
  if (n) return n[1].toUpperCase();
  const m = /build-checklist\.md#(\d+[a-z]?)[-#]/i.exec(proposal?.text ?? "");
  return m ? m[1].toUpperCase() : null;
})();

{
  // build-checklist: status line + Ships boxes
  if (checklist && sliceId) {
    const head = checklist.lines.findIndex((l) =>
      new RegExp(`^###\\s+${sliceId}\\s+—`, "i").test(l),
    );
    if (head < 0)
      record(
        "duties",
        "READ",
        `no \`### ${sliceId} — …\` heading in build-checklist.md — resolve the slice by hand before judging its status`,
      );
    else {
      let end = checklist.lines.length;
      for (let i = head + 1; i < checklist.lines.length; i++)
        if (/^###\s/.test(checklist.lines[i])) {
          end = i;
          break;
        }
      const card = checklist.lines.slice(head, end);
      const statusLine = card.find((l) => /\*\*Status:\*\*/.test(l));
      const marker = statusLine ? /`\[([ x~!])\]`/.exec(statusLine)?.[1] : null;
      const ships = card.filter((l) => /^\s*[-*]\s*\[[ xX!~]\]/.test(l));
      const shipsOpen = ships.filter((l) => /^\s*[-*]\s*\[[ ~]\]/.test(l));
      if (marker !== "x")
        record(
          "duties",
          "READ",
          `build-checklist slice ${sliceId} Status is \`[${marker ?? "?"}]\` — a finished slice is \`[x]\`, or \`[!]\` with a one-line reason`,
        );
      if (shipsOpen.length)
        record(
          "duties",
          "BLOCK",
          `${shipsOpen.length} of ${ships.length} \`Ships\` box(es) on slice ${sliceId} are unticked — a ticked Status over an unticked Ships bullet is the card lying`,
        );
      if (/^###\s+\S*\[[ x~!]\]/.test(checklist.lines[head]))
        record(
          "duties",
          "BLOCK",
          `slice ${sliceId}'s heading carries a status marker — headings are anchors other docs link to and MUST stay marker-free`,
        );
    }
  } else if (!sliceId)
    record(
      "duties",
      "READ",
      "could not resolve the slice id from the change — check the card by hand",
    );

  // data-modeling Model index: every new Drizzle table ticked
  const newModels = [
    ...new Set(
      readable
        .filter(isSchemaFile)
        .flatMap((p) => addedOf(p))
        .map(
          (a) =>
            /\bpgTable\s*\(\s*["'`]([a-z_][a-z0-9_]*)["'`]/.exec(a.text)?.[1],
        )
        .filter(Boolean),
    ),
  ];
  if (newModels.length && dataModeling) {
    const untickedModels = newModels.filter((m) => {
      const row = dataModeling.lines.find(
        (l) => l.includes(`\`${m}\``) && /^\s*\|/.test(l),
      );
      return !row || !/\[x\]/i.test(row);
    });
    if (untickedModels.length)
      record(
        "duties",
        "BLOCK",
        `Model index in data-modeling.md has no ticked \`Modeled\` box for: ${untickedModels.join(", ")} — that index is the only place "is this table real yet?" is answerable`,
      );
    record(
      "duties",
      "READ",
      `${newModels.length} new Drizzle table(s) in this change: ${newModels.join(", ")} — each also owes a \`###\` section in data-modeling.md that matches the migration`,
    );
  }

  // api-contract: operation-shaped names the change introduces
  if (apiContract) {
    // `handler.ts` is a file and `crypto.randomBytes` is a library call; neither is an operation.
    const NOT_AN_OP =
      /^(drizzle|sql|db|tx|crypto|console|process|path|fs|os|util|url|http|https|zod|z|vi|fc|cdk|aws|node|math|json|object|array|string|number|date|promise|globalThis)$/i;
    const ops = new Set();
    for (const doc of artifacts)
      for (const m of doc.text.matchAll(
        /`([a-z][A-Za-z]*\.[a-z][A-Za-z]*)`/g,
      )) {
        const [ns, op] = m[1].split(".");
        if (NOT_AN_OP.test(ns) || FILE_EXTS.test(m[1])) continue;
        if (op.length < 3) continue;
        ops.add(m[1]);
      }
    const absent = [...ops].filter(
      (o) => !apiContract.text.includes(o) && sourceTokens.has(o.split(".")[0]),
    );
    if (absent.length)
      record(
        "duties",
        "READ",
        `operation-shaped names the change uses that api-contract.md does not carry: ${absent
          .slice(0, 20)
          .map((o) => `\`${o}\``)
          .join(
            " ",
          )}${absent.length > 20 ? " …" : ""} — some are code symbols, not operations; the rest are an undischarged duty`,
      );
  }

  // env vars — the root `.env.example`, plus any a project keeps of its own
  {
    const examples = [".", ...PROJECTS]
      .map((p) => join(repoRoot, p, ".env.example"))
      .filter((p) => existsSync(p))
      .map((p) => readFileSync(p, "utf8"))
      .join("\n");
    const used = new Set();
    for (const a of allAdded)
      for (const m of a.text.matchAll(/process\.env\.([A-Z][A-Z0-9_]{2,})/g))
        used.add(m[1]);
    if (used.size && examples) {
      const missing = [...used].filter((v) => !examples.includes(v));
      if (missing.length)
        record(
          "duties",
          "BLOCK",
          `env var(s) read in the diff and absent from every \`.env.example\`: ${missing.join(", ")} — it works on the machine that wrote it`,
        );
    } else if (used.size && !examples)
      record(
        "duties",
        "READ",
        `${used.size} env var(s) read in the diff and no \`.env.example\` found anywhere`,
      );
  }

  // project folders — root AGENTS.md → Projects is the one table
  {
    const rootAgents = loadDoc("AGENTS.md", join(repoRoot, "AGENTS.md"));
    const newProjects = new Set();
    for (const p of readable) {
      if (nameStatus.get(p) !== "A") continue;
      const m = /^((?:apps|packages)\/[^/]+|infra|sim)\//.exec(p);
      if (m) newProjects.add(m[1]);
    }
    const unnamed = [...newProjects].filter(
      (d) => rootAgents && !rootAgents.text.includes(`**${d}**`),
    );
    if (unnamed.length)
      record(
        "duties",
        "BLOCK",
        `project folder(s) with added files that root AGENTS.md → Projects does not list: ${unnamed.join(" · ")} — the table is updated as projects land`,
      );
    const strays = [...newProjects].filter((d) => !PROJECTS.includes(d));
    if (strays.length)
      record(
        "duties",
        "READ",
        `project folder(s) outside the planned layout: ${strays.join(" · ")} — a new project is a layout decision; confirm the Projects table was updated deliberately`,
      );
  }

  // walkthrough shape
  if (walkthrough) {
    const steps = walkthrough.lines.filter((l) => /^\s*\d+\.\s/.test(l)).length;
    const paths = walkthrough.lines.filter((l) =>
      /^##\s+Path\s/i.test(l),
    ).length;
    record(
      "duties",
      "READ",
      `WALKTHROUGH.md — ${paths} path(s), ${steps} numbered step(s). Pass 5 reads each against the code`,
    );
    if (!steps)
      record(
        "duties",
        "BLOCK",
        "WALKTHROUGH.md carries no numbered steps — it is a report, not a script",
      );
    // Only numbered steps carry the rule — the preamble is allowed to explain it.
    const undated = [];
    walkthrough.lines.forEach((l, i) => {
      if (!/^\s*\d+\.\s/.test(l)) return;
      if (
        !/\b(not yet|cannot|does not exist|coming|todo|no surface|nothing)\b/i.test(
          l,
        )
      )
        return;
      if (/slice\s*\d|→/i.test(l)) return;
      undated.push(i + 1);
    });
    if (undated.length)
      record(
        "duties",
        "BLOCK",
        `${undated.length} walkthrough step(s) say something is incomplete without naming the slice that carries it (L${undated.slice(0, 8).join(", ")}) — an unwalkable step with no destination is the slice not being done`,
      );
  }
}

// ---------------------------------------------------------------- tripwires over added lines

const tripwires = [
  {
    id: "raw sql",
    level: "BLOCK",
    where: /^(apps|packages|infra|sim|scripts)\//,
    re: /\bsql\.raw\s*\(|\.unsafe\s*\(/,
    soften: TEST_FILE,
    why: "unparameterised raw SQL — Drizzle's `sql` template binds parameters, `sql.raw` does not",
  },
  {
    id: "grant all",
    level: "BLOCK",
    where: MIGRATION,
    re: /GRANT\s+ALL\b/i,
    why: "`GRANT ALL` — grant the narrowest privileges the table needs, per command",
  },
  {
    id: "secret",
    level: "BLOCK",
    where: /./,
    re: /(sk_live_|sk_test_|xoxb-|AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY)|((password|secret|api_?key|access_?token)\s*[:=]\s*["'][^"'$\s]{16,}["'])/i,
    soften: /\.(spec|test)\.[jt]sx?$|(^|\/)(seed\.sql|fixtures?)\b/,
    why: "a credential shape in the tree — a key in a fixture is a key in the history",
  },
  {
    id: "suppressed type error",
    level: "READ",
    where: /./,
    // No `(?!\s*$)` on the eslint branch: that skips a line ending at `eslint-disable`
    // (blanket — all rules) and keeps a targeted `eslint-disable-next-line no-console`.
    re: /@ts-(ignore|expect-error|nocheck)|eslint-disable(-next-line)?/,
    why: "a suppression is a gate loosened locally — read what it hides",
  },
  {
    id: "skipped test",
    level: "BLOCK",
    where: /\.(spec|test)\.[jt]sx?$/,
    re: /\b(it|test|describe)\.(only|skip)\b|\b(xit|xdescribe)\s*\(/,
    why: "a suite that is green because it is not running",
  },
  {
    id: "console",
    level: "READ",
    // The CLI prints to stdout on purpose; everywhere else Winston is the interface.
    where: /^(apps\/(?!cli\/)[^/]+|packages\/[^/]+)\/src\//,
    re: /console\.(log|info|debug|warn)\s*\(/,
    why: "the logger is the interface, and PII must never reach a log line",
  },
  {
    id: "residue",
    level: "READ",
    where: /./,
    re: /\b(TODO|FIXME|XXX|HACK)\b/,
    why: "unfinished work left in the tree with no task carrying it",
  },
  {
    id: "control char",
    level: "BLOCK",
    where: /\.(ts|tsx|js|mjs|sql|json|md)$/,
    re: new RegExp("[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F]"),
    why: "a control byte written into a source file — the known failure mode of shell-based editing on this machine",
  },
];

// A hit in a place where the pattern is the *correct* thing to do is still worth seeing, and
// is still wrong as a BLOCK: a migration test reaches for raw SQL on purpose, and a fixture
// carries a fake key shape so the verifier has something to reject.
for (const t of tripwires) {
  const hits = allAdded.filter(
    (a) => t.where.test(a.path) && t.re.test(a.text),
  );
  if (!hits.length) continue;
  for (const level of ["BLOCK", "READ"]) {
    const group = hits.filter((h) => {
      const softened = t.soften?.test(h.path) ?? false;
      const l = t.level === "BLOCK" && !softened ? "BLOCK" : "READ";
      return l === level;
    });
    if (!group.length) continue;
    record(
      "patterns",
      level,
      `${t.id}${level === "READ" && t.level === "BLOCK" ? " (in a place the pattern may be correct)" : ""} — ${t.why}: ${group
        .slice(0, 8)
        .map((h) => `${h.path}:${h.n}`)
        .join(
          " · ",
        )}${group.length > 8 ? ` …and ${group.length - 8} more` : ""}`,
    );
  }
}

// ---------------------------------------------------------------- runtime-role grants on every new table

// pp-database's gate asks for the runtime role's grants on every new table. The role name is not
// fixed yet, so this accepts any `GRANT … ON <table> … TO` and leaves the role to the reader.
{
  const migText = readable
    .filter((p) => MIGRATION.test(p))
    .map((p) => {
      const full = join(repoRoot, p);
      return existsSync(full) ? readFileSync(full, "utf8") : "";
    })
    .join("\n");
  const created = [
    ...new Set(
      [
        ...migText.matchAll(
          /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:"?public"?\.)?"?([a-z_][a-z0-9_]*)"?/gi,
        ),
      ].map((m) => m[1]),
    ),
  ];
  for (const t of created) {
    const grant = new RegExp(
      `GRANT[^;]*\\bON\\b[^;]*\\b${t}\\b[^;]*\\bTO\\b`,
      "i",
    ).test(migText);
    if (!grant)
      record(
        "grants",
        "READ",
        `\`${t}\` is created with no \`GRANT … TO\` the runtime role in this change — works as the owner, fails as a narrower role. Confirm which role the deployed Lambdas connect as`,
      );
  }
  if (created.length)
    record(
      "grants",
      "READ",
      `${created.length} table(s) created in this change: ${created.join(", ")}`,
    );
}

// ---------------------------------------------------------------- mandatory-tier tests

// pp-workflow → Test tiers: these surfaces owe an integration test against real Postgres.
// `packages/core` is pure (its projections are proven by `*.prop.test.ts`) and `sim/` is evidence,
// not the path under test, so neither trips the Postgres tier.
{
  const specs = readable.filter((p) => TEST_FILE.test(p));
  const integration = specs.filter((p) => /\.int\.test\.ts$/.test(p));
  const src = readable.filter(
    (p) =>
      /^(apps|packages)\//.test(p) &&
      !/^packages\/core\//.test(p) &&
      !TEST_FILE.test(p),
  );
  const srcAdded = addedLines(src);
  const triggers = [];
  if (readable.some((p) => MIGRATION.test(p))) triggers.push("a migration");
  if (
    srcAdded.some((a) =>
      /\b(Authorization|Bearer)\b|\bscopes?\b[^;\n]*\b(read|operate)\b|["'`]operate["'`]/.test(
        a.text,
      ),
    )
  )
    triggers.push("an auth boundary (token scopes)");
  if (
    srcAdded.some((a) =>
      /\bsvix_?[Ii]d\b|dedupe_?[Kk]ey|onConflictDo(Nothing|Update)|ON\s+CONFLICT/.test(
        a.text,
      ),
    )
  )
    triggers.push("idempotency");
  if (
    srcAdded.some((a) =>
      /transition|state_machine|\.transition\b/i.test(a.text),
    )
  )
    triggers.push("a state transition");
  if (src.some((p) => /projec/i.test(p)))
    triggers.push("an order-independent projection");
  // SQS redrive's evidence is the `packages/aws` adapter's `*.test.ts` against the port contract
  // (pp-testing → Fakes at the port), not a Postgres test.
  if (
    src.some(
      (p) =>
        !/^packages\/aws\//.test(p) &&
        /(outbox|dispatch|reconcil|redrive|replay|dlq)/i.test(p),
    )
  )
    triggers.push("the correctness path (outbox, reconcile, redrive, replay)");
  if (triggers.length && !integration.length)
    record(
      "tests",
      "BLOCK",
      `this change touches ${triggers.join(", ")} — the mandatory test tier — and adds no integration test (\`*.int.test.ts\`, pp-testing → Test files and tiers)`,
    );
  else
    record(
      "tests",
      "READ",
      `${specs.length} test file(s) changed, ${integration.length} integration${triggers.length ? ` · mandatory-tier triggers: ${triggers.join(", ")}` : ""}`,
    );

  const reqs = deltas.flatMap(
    (d) => d.text.match(/^###\s+Requirement:.*$/gm) ?? [],
  );
  const scenarios = deltas.flatMap(
    (d) => d.text.match(/^####\s+Scenario:/gm) ?? [],
  );
  if (reqs.length)
    record(
      "tests",
      "READ",
      `${reqs.length} requirement(s) and ${scenarios.length} scenario(s) in the deltas — each scenario is a test that should exist and fail if the behaviour broke`,
    );
}

// ---------------------------------------------------------------- REVIEW.md's unconfirmed list

if (review) {
  const start = review.lines.findIndex((l) =>
    /^##\s.*could not confirm/i.test(l),
  );
  if (start >= 0) {
    const items = [];
    for (let i = start + 1; i < review.lines.length; i++) {
      if (/^##\s/.test(review.lines[i])) break;
      const m = /^\s*[-*]\s+(.*)$/.exec(review.lines[i]);
      if (m) items.push(m[1]);
    }
    for (const it of items)
      record(
        "unconfirmed",
        "READ",
        `the pre-apply review could not confirm this and you can: ${it.replace(/\*\*/g, "").slice(0, 240)}`,
      );
  }
}

// ---------------------------------------------------------------- residue in the artifacts

{
  for (const doc of [...artifacts, walkthrough].filter(Boolean)) {
    doc.lines.forEach((l, i) => {
      if (/\b(TBD|TODO|FIXME|\?\?\?|<placeholder>|XXX)\b/.test(l))
        record(
          "residue",
          "READ",
          `${doc.name}:${i + 1} — unresolved marker: ${l.trim().slice(0, 120)}`,
        );
    });
  }
  const uncommitted = git(["status", "--porcelain"]).stdout ?? "";
  const dirty = uncommitted.split(/\r?\n/).filter((l) => l.trim());
  if (dirty.length)
    record(
      "residue",
      "READ",
      `${dirty.length} uncommitted change(s) in the working tree — the diff read here is committed work only: ${dirty
        .slice(0, 8)
        .map((l) => l.trim())
        .join(" · ")}${dirty.length > 8 ? " …" : ""}`,
    );
}

// ---------------------------------------------------------------- report

const order = [
  "artifacts",
  "openspec",
  "tasks",
  "diff",
  "generated",
  "grants",
  "patterns",
  "tests",
  "duties",
  "unbuilt",
  "undeclared",
  "unconfirmed",
  "residue",
  "surfaces",
];
const blocking = findings.filter((f) => f.level === "BLOCK").length;

console.log(
  `# mechanical checks — ${relative(repoRoot, changeDir).split(sep).join("/")}`,
);
console.log(`# repo root:  ${repoRoot}`);
console.log(`# diff base:  ${base}`);
console.log(`# slice card: ${sliceId ?? "unresolved"}`);
console.log(
  `# artifacts:  ${proposal ? "proposal" : "—"}, ${design ? "design" : "—"}, ${tasks ? "tasks" : "—"}, ${deltas.length} delta(s), ${walkthrough ? "walkthrough" : "no walkthrough"}`,
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
  "# A clean run is not a finished slice. It means the cheap defects are gone and the reading can start.",
);
