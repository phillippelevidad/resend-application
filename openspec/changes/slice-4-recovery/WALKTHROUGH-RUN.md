# Slice 4 — walkthrough run

- **Run:** 2026-10-20 16:32 (UTC−3) · walkthrough mode · change `slice-4-recovery`
- **HEAD:** `6194533` (clean) · **Environment:** local (apps/local) and deployed (kept stack)
- **Started by this run:** none · **Adopted:** apps/local and compose Postgres (`pnpm dev:full`, up)
- **Time box:** 45 min · **Wall clock used:** 29 min · four helper agents walked A, B/D, C and F

**Verdict:** walked with findings — every step runnable today passed; C3 waits for 2026-10-21,
E was held by the owner, and one doc-drift finding (F5).

| pass | doc-drift | fail | inconclusive | blocked | held | n/a-today | skipped | not-run |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 26 | 1 | 0 | 0 | 0 | 0 | 0 | 8 | 0 |

Steps marked "today, owner-approved" ran earlier on 2026-10-20 in this same conversation with the
owner's yes; the owner chose to cite them rather than repeat their live writes.

| Step | Status | Observed | Finding |
| --- | --- | --- | --- |
| A1 | pass | exit 0; `{"object":"list","has_more":false,"data":[]}` | |
| A2 | pass | exit 1 after 3.9 s; stderr `ledger: reconcile run 1 started; follow it with ledger gaps.`; `"code":"reconciler_not_configured"` | |
| A3 | pass | `1   manual      dry run   2026-10-20T19:36:36.841Z   checked 0   missing 0   replayed 0   failed 0   reconciler_not_configured` | |
| A4 | pass | last line `reconcile   run 1 reconciler_not_configured` | |
| A5 | pass | both exit 1, `validation_failed`, the two expected messages verbatim, no started notice | |
| A6 | pass | exit 1 `reconciler_not_configured` (run 2); `--no-wait` exit 0, run 3 `"trigger":"manual"`, `"finished_at":null`, notice on stderr | |
| B1 | pass | exit 1, last line `aws:deploy: refused: LEDGER_DEPLOY_RESEND_WEBHOOK_ID must be set to the Resend webhook id, with LEDGER_DEPLOY_RESEND_API_KEY and LEDGER_DEPLOY_WEBHOOK_SECRETS`; run under a non-existent AWS profile | |
| B2 | pass | today, owner-approved: `aws:deploy: ledger/resend-api-key written`, `KillSwitchArmed true`, `done`; no line held the key | |
| B3 | pass | exit 0; `reconcile   run 11 finished 2026-10-20T19:00:12.970Z, missing 0, replayed 0` | |
| B4 | pass | `--json` one document; run 11 `"trigger":"scheduled"`, `"missing":0`, `"error":null` (also runs 1, 5, 6) | |
| B5 | pass | `"OK"` at 18:00:38 UTC after the clean 17:00 hour; `"ALARM"` again at 19:36 for D1's hour, as the runbook expects | |
| C1 | pass | HTTP 200, `"object":"list"`, items `id` (`msg_…`), `type`, `created_at` | |
| C2 | pass | email `01a15a7a-…`: ledger timeline `svix_id`s = List Events ids {`msg_3KyAIMzI…`, `msg_3KyAIPDu…`} (RS-U02); masks only | |
| C3 | skipped (date) | RS-U03 reach read waits for 2026-10-21 (webhook younger than 72 h) | |
| C4 | pass | today, owner-approved (E1): replay `200`, same id returned | |
| C5 | pass | today (E1): newest attempt `200` on a 41 h old event (RS-U20) | |
| C6 | pass | today (E1): one `worker.duplicates` line for that `svix_id`; `event_count` 2 → 2 (RS-U01) | |
| C7 | pass | today, owner-approved: delete `"deleted": true`; revoked and never-issued key both `400 validation_error` "API key is invalid" | |
| D1 | pass | today, owner-approved, 18:02 UTC: every expected line in order, `aws:gap-drill: done`, exit 0 | |
| D2 | pass | `--since 3h` (1h no longer reaches 18:13): runs 9, 8, 7 in the expected order and counts | |
| D3 | pass | `reconcile   run 11 finished …, missing 0, replayed 0` (the newest run is now the 19:00 scheduled one) | |
| D4 | pass | `OK` → `ALARM` 19:00:18 UTC, the email confirmed by the owner; `ALARM` → `OK` 20:00:18 UTC after the clean 19:00 hour | |
| E1–E7 | skipped (owner held) | RS-U04 and RS-U05 closed safe either way (design.md → D39) | |
| F1 | pass | exit 0, token id 17, `review-walk`, `read`; plaintext captured to a scratch file, never shown | |
| F2 | pass | exit 0, 11 runs, each ending `ok` | |
| F3 | pass | exit 1, `"code":"forbidden"`, no started notice; the list unchanged (11 runs) | |
| F4 | pass | `links: README.md 34 checked, 0 broken` | |
| F5 | pass (doc-drift) | every claim's link resolves and supports it; PR #13 wording present | F1 |
| T1 | pass | revoke exit 0, `revoked_at` set; the revoked token then reads `unauthorized` | |

## Findings

### F1 — F5's Expect names "Planned for M2", which the README no longer has

- **Severity:** polish · **Category:** doc-drift · **Status:** confirmed · **Step:** F5
- **Expected:** "MCP and reactions sit under 'Planned for M2' with no behavior claimed", per F5.
- **Observed:** the README names the stages (owner's rename, 2026-10-20, `78da5c9`): MCP and
  reactions sit under "Next up, the MVP" in the Roadmap, with no behavior claimed as built.
- **Evidence:** README.md → Roadmap; `.ai/about.md` → Milestones.
- **Suspected cause:** the walkthrough predates the README rewrite.
- **Proposed fix:** F5's Expect names "the roadmap's MVP stage".

## Held for the owner

- None held. C3 runs on or after 2026-10-21 (Ships 7).

## Data created

- Local reconcile runs 1, 2, 3 (`reconciler_not_configured`): kept.
- Deployed `read` token `review-walk`, id 17: revoked.
- No Resend write and no AWS write in this run; two read-only AWS reads (B5, D4), owner-approved.
