# Slice 0 — walkthrough run

- **Run:** 2026-10-17 15:25 · walkthrough mode · change `slice-0-foundations`
- **HEAD:** `9317747` (clean) · **Environment:** local (no live process; scripts, `pnpm sim`, CI read)
- **Started by this run:** none (one-shot commands only) · **Adopted:** none
- **Time box:** 45 min · **Wall clock used:** 3 min

**Verdict:** walked — every step observed what its `Expect:` names, on the commit CI passed.

| pass | doc-drift | fail | inconclusive | blocked | held | n/a-today | skipped | not-run |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 15 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |

| Step | Status | Observed | Finding |
| --- | --- | --- | --- |
| S1 | pass | `pnpm install` exit 0, `Synced 23 skills`, `Done in 18s using pnpm v10.11.0` | |
| S2 | pass | `docker info` → `28.0.4` | |
| S3 | pass | `gh auth status`: logged in to github.com, active account | |
| A1 | pass | stdout exactly `secrets: canary caught 3/3 rules` / `secrets: repo clean (45 commits scanned)`, exit 0; 45 equals `git rev-list --all --count` | |
| B1 | pass | `links: canary caught 2/2` / `links: README.md 13 checked, 0 broken`, exit 0, stderr 0 bytes | |
| B2 | pass | stdout `links: canary caught 2/2` / `links: C:/Users/<user>/AppData/Local/Temp/ledger-walk-b2.<random>/probe.md 2 checked, 1 broken`; stderr only `…/probe.md:2 target.md#no-such-heading (missing anchor)` (re-run with `2>/dev/null` confirmed the split); exit 1; line 1 not reported | |
| B3 | pass | exit 0; `9:> It's an independent project, not affiliated with or endorsed by Resend.`, `15:## The problem`, `74:## How it relates to Resend's Webhook Ingester` | |
| C1 | pass | `sim seed=42 namespace=walk` / `history emails=3 events=21 duplicates=0 shuffled=false`, then `{` `"emails": [`; emails `walk-email-0..2` with the named fields; recipients `bou************@r*****.d**` → `hard_bounced` / `walk-email-2`, `bo*****@r*****.d**` → `hard_bounced` / `walk-email-1`, `com********@r*****.d**` → `complained` / `walk-email-0`; ends `}`, exit 0; grep count `0` | |
| C2 | pass | no diff lines; `identical`, exit 0 | |
| C3 | pass | `history emails=3 events=21 duplicates=6 shuffled=true`; `json identical`, exit 0 | |
| C4 | pass | stdout empty; stderr `sim: --duplicates must be a ratio from 0 to 1`; exit 2 | |
| C5 | pass | exactly `"emailId": "walk2-email-0"`, `…-1`, `…-2`; no `walk-email-` id | |
| D1 | pass | run `39056406649`: `"conclusion":"success"`, `"status":"completed"`, `headSha` `93177474…`; `git ls-remote` tip the same sha | |
| D2 | pass | 14 lines, `verify<TAB>Run pnpm verify<TAB><timestamp>` prefix, in the expected order: install, docker, secrets (3/3, 45 commits), lint, links (2/2, 13 checked, 0 broken), typecheck, unit, synth, e2e, `VERIFY PASSED`; no `✘` | |
| T1 | pass | printed `0` | |

**Watch-list:** exit codes `0` / `1` / `2` as pp-cli names them (C4's usage error is `2`); masks only
in every `pnpm sim` output (C1 grep `0`, C5 ids only); duplicates and shuffle leave the projection
byte-identical (C3, ADR-003). No CLI `--json`, error-shape, queue or log surface exists in slice 0.
The expected `.env.local not found. Continuing without it.` line printed once on stderr per `pnpm sim`.

**Note, not a finding:** C1's `events=21` exceeds the per-email `eventCount` sum (3 + 6 + 9 = 18).
The generator emits deliberately malformed payloads, "stored raw, skipped"
(`packages/core/src/testing/email-history.ts:27`), which `toProjectedEvent`
(`packages/core/src/project-email.projection.ts:80`) rejects by design. No event is lost: slice 0
stores nothing, and the skip is the specified behaviour.

## Findings

None.

## Held for the owner

None. The walkthrough has no Ask-first step.

## Data created

- Temp directory `ledger-walk-b2.<random>` (B2): removed by T1.
- `pnpm sim` namespaces `walk` and `walk2`, seed `42`: printed only, nothing stored.
