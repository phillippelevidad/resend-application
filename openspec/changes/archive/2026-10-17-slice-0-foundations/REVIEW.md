# Review — 2026-10-16

**Verdict:** ready for `opsx:apply`
**Checked against:** the slice 0 card · `.ai/pre-proposals/2026-10-16-slice-0-foundations.md` · pp-workflow, pp-general, pp-backend, pp-testing · the repo at `d4b5944`
**Repaired:** 11. design.md now defines D1–D21 itself (it pointed at the pre-proposal for the D4 fields, D13 mask rules, D16 output and D19 lines). D17 launches Biome as `node …/@biomejs/biome/bin/biome` (`.bin/biome.cmd` fails with `EINVAL` on Windows) and normalizes `\` in paths. Task 2.1's URL works for `delivery-delayed`. Task 8.2 tests a fresh clone, not the owner's checkout. The D18 canary runs the repo scan's own arguments. The deciding-event scenario now sits on the recipient outcome, and "earliest such signal" is sharpened. Task 7.3 keeps ADR-013's slice-2B evidence pending. Task 4.8 gains the RS-36–38 page URLs. Commands lines for both scripts are added. Every task carries a verify clause.

## Judgement calls the builder should know about
- ADR-003's "counters plus first/last timestamps" is read as `firstOpenedAt`, `firstClickedAt` and `lastEventAt`, the columns data-modeling ratifies. No per-type last timestamp is added (D4).
- `projectEmail(emailId, events)` differs from ADR-003's sketch `projectEmail(events)`. The reason is in D3; no ADR edit.
- `ledgerHistory` draws at least 2 emails of at least 2 events, so every `pnpm sim` run has an id to compare and `--duplicates 0.3` repeats something (D15).
- `maskFrom` splits at the last `<` when the sender ends in `>`, the minimal rule under which length and idempotence both hold (D13).

## Verified by probe in this review (2026-10-16)
- The pinned gitleaks image scans a mirror of all refs with default rules: 8 commits, no leak. The D18 `.gitleaks.toml` (with `[[rules.allowlists]]`) is valid in v8.30.1, each custom rule fires once, `127.0.0.1` is allowlisted, and `--report-path -` prints each `RuleID`.
- Biome 2.5.15 lints from a temp directory. Every D17 case reports as expected (override lists replace the base list), and a devDependency import from `sim/src/main.ts` passes `noUndeclaredDependencies`.

## What this review could not confirm
- gitleaks' `git` subcommand itself was not run here (a harness guard blocked it). The probes used `detect --source` and `dir`; task 8.2's first run is the check.
- The Resend example payloads were not fetched. Only the 11 page URLs were confirmed.
- fast-check's `fc.sample` determinism on Windows and Linux (it is not installed yet); task 6.3's e2e test in CI is the check.
- The four Ask-first approvals are taken from the pre-proposal's §7 table, not re-heard from the owner.
