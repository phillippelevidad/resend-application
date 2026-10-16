# Slice 0 — walkthrough

What one person does, in ~15 minutes, to prove this slice works.

**Read this first.** A step that cannot be completed today ends with `→ slice N`, naming the slice
that carries it. A step without such a note that fails is a finding against this slice.

## Before you start

```bash
pnpm install
docker info --format '{{.ServerVersion}}'
gh auth status
```

- **Shell:** Bash (Git Bash on Windows). Every step's block stands alone: no variable carries over
  from one step to the next, and C2–C3 use process substitution `<(…)` instead of temp files.
- **Docker** must be running for A1: `docker info` prints a server version, not an error.
- **`gh`** must be logged in for Path D (read-only calls).
- **Environment variables (names only):** none. Slice 0 adds none, and `pnpm sim` reads none.
  Without a `.env.local`, Node prints `.env.local not found. Continuing without it.` on stderr once
  per `pnpm sim` run (the root script's `--env-file-if-exists`); that line is expected wherever a
  step below runs `pnpm sim`.
- **This walk creates:** one temp directory `${TMPDIR:-/tmp}/ledger-walk-b2.<random>` (B2), which
  Teardown T1 removes. The secret scan and the link check remove their own temp directories.
  `pnpm sim` writes nothing.
- **Ask-first steps:** none. No Resend call, no AWS action, no push.

## Path A — `pnpm verify` stage `secrets`: the full history is clean, and the custom rules fire

**Walked as:** [Reviewer](../../../.ai/about.md#target-personas)

1. **Run the secret scan alone.**

   ```bash
   node scripts/secret-scan.mjs; echo "exit=$?"
   ```

   Expect: stdout is exactly

   ```text
   secrets: canary caught 3/3 rules
   secrets: repo clean (<k> commits scanned)
   exit=0
   ```

   where `<k>` is a positive integer, the commits on every ref of a mirror of this checkout. The
   first run may take longer while Docker pulls the pinned gitleaks image; nothing else prints.
   → **Why it matters.** The canary (fake `re_`, `whsec_` and Postgres-URL values in a throwaway
   repo) proves each custom rule fires, so "repo clean" is a real result, not a scanner that
   matches nothing.

## Path B — `pnpm verify` stage `links`: the README a developer discovers Ledger through holds no broken link

**Walked as:** [Application developer](../../../.ai/about.md#target-personas)

1. **Check the README's links.**

   ```bash
   node scripts/check-links.mjs; echo "exit=$?"
   ```

   Expect: stdout is exactly

   ```text
   links: canary caught 2/2
   links: README.md <n> checked, 0 broken
   exit=0
   ```

   where `<n>` is a positive integer (relative links and images; `http(s):` and `mailto:` are
   skipped, never fetched). Nothing on stderr.

2. **Point the checker at a file with one missing anchor.**

   ```bash
   dir=$(mktemp -d "${TMPDIR:-/tmp}/ledger-walk-b2.XXXXXX") \
     && printf '# Real heading\n\nA heading to link to.\n' > "$dir/target.md" \
     && printf '[valid](target.md#real-heading)\n[missing anchor](target.md#no-such-heading)\n' > "$dir/probe.md" \
     && node scripts/check-links.mjs "$dir/probe.md"; echo "exit=$?"
   ```

   Expect: stdout

   ```text
   links: canary caught 2/2
   links: <dir>/probe.md 2 checked, 1 broken
   ```

   then on stderr `<dir>/probe.md:2 target.md#no-such-heading (missing anchor)`, then `exit=1`.
   `<dir>` is the directory as Node receives it: Git Bash on Windows hands Node its Windows form
   (`C:/Users/<user>/AppData/Local/Temp/ledger-walk-b2.<random>`); elsewhere it is the `mktemp`
   path itself. Line 1 (`#real-heading`) is not reported. Both files sit in one directory because
   a relative link resolves from the file that holds it.

3. **Read the README's three skeleton claims.**

   ```bash
   grep -nE "^## The problem$|^## How it relates to Resend's Webhook Ingester$|not affiliated with" README.md
   ```

   Expect: exit `0`; three lines: `<line>:> It's an independent project, not affiliated with or
   endorsed by Resend.`, `<line>:## The problem` and `<line>:## How it relates to Resend's Webhook
   Ingester`, the line numbers as the README stands.

## Path C — `pnpm sim` printing a projection: same seed, same projection, whatever the order

**Walked as:** [Reviewer](../../../.ai/about.md#target-personas)

1. **Run the simulator with a fixed seed and namespace.**

   ```bash
   pnpm -s sim --seed 42 --namespace walk; echo "exit=$?"
   pnpm -s sim --seed 42 --namespace walk | grep -cE 'resend\.dev|recipientKey'
   ```

   Expect: the first command's stdout opens with exactly

   ```text
   sim seed=42 namespace=walk
   history emails=3 events=21 duplicates=0 shuffled=false
   {
     "emails": [
   ```

   then one JSON document with two arrays. `emails` holds `walk-email-0`, `walk-email-1` and
   `walk-email-2`, each with `status`, `fromMasked`, `subjectMasked`, `eventCount` and its
   per-recipient `recipients` rows (`addressMasked`, `stickySignal`, `softSignal`, …). The
   top-level `recipients` holds three rows: `"addressMasked": "bou************@r*****.d**"` →
   `"deliverability": "hard_bounced"`, `"causeEmailId": "walk-email-2"`;
   `"addressMasked": "bo*****@r*****.d**"` → `"hard_bounced"`, `"walk-email-1"`;
   `"addressMasked": "com********@r*****.d**"` → `"complained"`, `"walk-email-0"`. The output
   ends `}` then `exit=0`. The second command prints `0`: no unmasked `resend.dev` domain and no
   `recipientKey` field anywhere in the output.
   → **Why it matters.** Masks only: the simulator prints what a projection row would hold, never
   an address.

2. **Run the same seed and namespace twice and compare.**

   ```bash
   diff <(pnpm -s sim --seed 42 --namespace walk) <(pnpm -s sim --seed 42 --namespace walk) && echo identical; echo "exit=$?"
   ```

   Expect: no diff lines; stdout `identical` then `exit=0`.

3. **Shuffle the history and add duplicates; compare the projection.**

   ```bash
   pnpm -s sim --seed 42 --namespace walk --shuffle --duplicates 0.3 | sed -n 2p
   diff <(pnpm -s sim --seed 42 --namespace walk | tail -n +3) <(pnpm -s sim --seed 42 --namespace walk --shuffle --duplicates 0.3 | tail -n +3) && echo "json identical"; echo "exit=$?"
   ```

   Expect: stdout

   ```text
   history emails=3 events=21 duplicates=6 shuffled=true
   json identical
   exit=0
   ```

   `events` still counts the generated events and `duplicates` the repeats added; the JSON block
   from line 3 on is byte-identical to C1's.
   → **Why it matters.** State comes from the projection, never from arrival order or repeats
   (ADR-003).

4. **Pass a bad flag.**

   ```bash
   pnpm -s sim --duplicates 2; echo "exit=$?"
   ```

   Expect: stderr `sim: --duplicates must be a ratio from 0 to 1`; stdout holds no `sim seed=`
   line (every flag is checked before anything prints), only `exit=2`.

5. **Change the namespace and read the email ids.**

   ```bash
   pnpm -s sim --seed 42 --namespace walk2 | grep -o '"emailId": "[^"]*"' | sort -u
   ```

   Expect: exactly three lines, `"emailId": "walk2-email-0"`, `"emailId": "walk2-email-1"` and
   `"emailId": "walk2-email-2"`; no `walk-email-` id. Ids come from the namespace, so two runs
   never share an id.

## Path D — the CI run on a pushed commit: `pnpm verify` green in CI, `secrets` and `links` included

**Walked as:** [Reviewer](../../../.ai/about.md#target-personas)

1. **Read the latest CI run on the branch and the commit it ran on.**

   ```bash
   gh run list --branch slice-0-foundations --limit 1 --json databaseId,headSha,status,conclusion
   git ls-remote origin refs/heads/slice-0-foundations
   ```

   Expect: exit `0`; line 1
   `[{"conclusion":"success","databaseId":<run-id>,"headSha":"<sha>","status":"completed"}]`;
   line 2 `<sha>` then a tab and `refs/heads/slice-0-foundations`, the same `<sha>` on both lines.
   A run still `"status":"in_progress"` is reported as in progress; never push a commit to
   provoke one.

2. **Read the `pnpm verify` stages in that run's log.**

   ```bash
   gh run view <run-id> --log | grep -E '\[verify\] [✔✘]|secrets: |links: |VERIFY '
   ```

   Expect: exit `0`; every line is prefixed `verify`, a tab, `Run pnpm verify`, a tab and a
   timestamp, and after the prefix the lines read, in this order:

   ```text
   [verify] ✔ install (<s>s)
   [verify] ✔ docker (<s>s)
   secrets: canary caught 3/3 rules
   secrets: repo clean (<k> commits scanned)
   [verify] ✔ secrets (<s>s)
   [verify] ✔ lint (<s>s)
   links: canary caught 2/2
   links: README.md <n> checked, 0 broken
   [verify] ✔ links (<s>s)
   [verify] ✔ typecheck (<s>s)
   [verify] ✔ unit (<s>s)
   [verify] ✔ synth (<s>s)
   [verify] ✔ e2e (<s>s)
   VERIFY PASSED
   ```

   `<s>` is each stage's duration; no `✘` line. This is where the full `pnpm verify` gate is read.

## Teardown

1. **Delete B2's temp directory.**

   ```bash
   rm -rf "${TMPDIR:-/tmp}"/ledger-walk-b2.*; ls -d "${TMPDIR:-/tmp}"/ledger-walk-b2.* 2>/dev/null | wc -l
   ```

   Expect: prints `0`. The `ledger-walk-b2.` prefix is this walk's own, so only directories B2
   made are removed.

## What this walk cannot reach today

| Not reachable | Carried by |
| --- | --- |
| A local `pnpm verify` run, and the unit, property and e2e suites: gates, never walked ([rsa-manual-test hard rule 7](../../../.agents/skills/rsa-manual-test/SKILL.md#hard-rules-must)) | [`wf-after-apply-check`](../../../.agents/skills/wf-after-apply-check/SKILL.md) |
| `pnpm sim` against a live process, invariants 1 and 2 | [slice 1](../../../.ai/build-checklist.md#1--local-ledger-and-read-path) |
