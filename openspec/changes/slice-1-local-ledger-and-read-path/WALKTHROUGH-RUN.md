# Slice 1 — walkthrough run

- **Run:** 2026-10-17 20:20 · walkthrough mode · change `slice-1-local-ledger-and-read-path`
- **HEAD:** `adb807d` (clean) · **Environment:** local (`apps/local` via `pnpm dev:full`)
- **Started by this run:** compose Postgres `ledger-postgres-1` (created), the `pnpm dev:full` dev server; both stopped at T3 · **Adopted:** none
- **Time box:** 45 min · **Wall clock used:** 8 min

**Verdict:** walked with findings — Paths A–C behave as written, two walkthrough-text drifts (B6, D6), Path D held for the owner.

| pass | doc-drift | fail | inconclusive | blocked | held | n/a-today | skipped | not-run |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 17 | 1 | 0 | 0 | 0 | 10 | 0 | 0 | 0 |

| Step | Status | Observed | Finding |
| --- | --- | --- | --- |
| S1 | pass | `pnpm install` done, 23 skills synced | |
| S2 | pass | Docker `28.0.4` | |
| S3 | pass | `LEDGER READY in 8s`, `api http://127.0.0.1:3200`, `db:setup: ready` | |
| A1 | pass | seed `1899796881` ns `559040d9`; `history emails=7 events=23 duplicates=4 shuffled=true`; `sent requests=27 accepted=27`, `invariant 1 pass stored=23/23`, `invariant 2 pass emails=7 recipients=10`, 3/4 lines as written, exit 0, stderr empty, grep `0`; probe `"status": "bounced"`, `"eventCount": 3`; 27 `ingest.accepted` lines | |
| A2 | pass | `identical`, `exit=0`; 27 more `worker.duplicates` lines (31 = A1's 4 + 27) | |
| A3 | pass | document as written (recipients swapped, allowed), exit 0, one JSON doc, no raw address | |
| B1 | pass | layout as written, exit 0, ANSI grep `0` | |
| B2 | pass | `hard_bounced` / `caused by 559040d9-probe`, grep `0`; `--json` `deliverability: ok`, exit 0 | |
| B3 | pass | `email_not_found` document verbatim, exit 1, stderr empty | |
| B4 | pass | stdout empty, stderr the two lines verbatim, exit 1, address echoed nowhere | |
| B5 | pass | `validation_failed` document verbatim, exit 1, input not quoted | |
| B6 | pass (doc-drift) | `Stopped`; `database_unavailable` verbatim, exit 1; `Healthy`; reread `bounced`, exit 0, no restart; **no `db.pool_error` line** until re-run with `db:down` 2 s after a read | F1 |
| B7 | pass | stdout empty, stderr `error: missing required argument 'email_id'`, exit 2 | |
| C1 | pass | masked `hard_bounced` body verbatim, `200` | |
| C2 | pass | `unauthorized` `401` ×2, `text/plain; charset=utf-8`; two bare `ingest.request_rejected` warn lines, `msg_walk_c2` logged 0 times | |
| C3 | pass | `route_not_found` body verbatim, `404` | |
| C4 | pass | the refusal line verbatim, exit 1; 0 listeners on 3299, 3200 still pid 45392 | |
| D1–D8 | held (ask-first) | owner-run tunnel, `listen` session, secret read, four sends, hard kill; not run | F2 (D6 text) |
| T1 | held (ask-first) | nothing to delete: D not run | |
| T2 | held (ask-first) | owner's tunnel: D not run | |
| T3 | pass | `compose services stopped (the database volume is kept).`, `stopped pid 25084 … (started by dev:full)`, `port 3200 is free.`, exit 0; file removed | |

Watch-list: every exit code and `--json` document as pp-cli requires; every error in the one shape with a registered code; the server log over the whole run holds 0 matches for `resend.dev`, `whsec_`, `postgres://`, `password`; duplicates left `stored` unchanged. Note: `apps/local` restarted once under `node --watch` ~1 s after its first `local server listening`, before READY and before any traffic, with no edit (unconfirmed, no event at risk).

## Findings

### F1 — B6 expects `db.pool_error` unconditionally; it logs only when an idle client is pooled

- **Severity:** minor · **Category:** doc-drift · **Status:** confirmed · **Step:** B6
- **Expected:** after `pnpm -s db:down`, the dev terminal logs `{"level":"error",…,"function_name":"api","message":"db.pool_error","error_name":"error","pg_code":"57P01"}`, per WALKTHROUGH.md B6.
- **Observed:** with B5's read > 10 s before `db:down`, no warn or error line at all; the `503` itself logs nothing (a classified error, `packages/api/src/create-api.ts:69-71`). Re-run with a read at 20:24:16 and `db:down` at 20:24:18: the exact expected line, `23:24:18.364Z`.
- **Evidence:** ns `559040d9`; server log line counts above.
- **Suspected cause:** `packages/db/src/create-database.ts:24` listens for errors on idle pooled clients (design.md:293), and `pg`'s default `idleTimeoutMillis` (10 s) has already closed the client when the walker is slower than that. Product matches design.md; the step text overstates.
- **Proposed fix:** B6 says the line appears only when `db:down` follows the previous read within ~10 s (or runs a read immediately before `db:down`); otherwise no log line is expected.

### F2 — Path D still calls RS-U21 `[Unverified]` and slice 2's, but `ac1b109` settled it as RS-43

- **Severity:** minor · **Category:** doc-drift · **Status:** confirmed · **Step:** D6 (also D intro, B2 rationale, the cannot-reach table)
- **Expected:** walkthrough text agrees with `.ai/resend.md`, where RS-U21 is struck through and RS-43 records the verified-domain two-recipient send; the slice 1 card's deferred tail says the same.
- **Observed:** WALKTHROUGH.md:420 "RS-U21 stays Unverified (D6)", :519 "That leaves RS-U21 Unverified … → slice 2", :591 lists "RS-U21's two-recipient send from the verified domain" under slice 2, :241 cites "RS-U21's documented reading".
- **Evidence:** `.ai/resend.md:84` (RS-43), `:286` (~~RS-U21~~); commits `ac1b109`, `adb807d`.
- **Suspected cause:** the RS-43 commits updated resend.md and the card, not the walkthrough.
- **Proposed fix:** point D intro, D6, B2 and the table at RS-43; drop RS-U21 from the cannot-reach row.

## Held for the owner

- D1 — owner's tunnel to `127.0.0.1:4318` · D2 — one `resend webhooks listen` session: creates a temporary webhook · D3 — owner-run `resend webhooks get` (returns the signing secret) and a `dev:full` restart · D4 — four sends from `onboarding@resend.dev` to `delivered@`, `bounced@`, `complained@`, `suppressed@resend.dev` (quota) · D5–D7 — reads of D4's traffic · D8 — hard-kill the session, owner-run `resend webhooks list` · T1 — delete the leftover webhook · T2 — stop the tunnel. None blocks archive: slice 1's Resend `Ships` bullets rest on RS-39–RS-42, recorded from the owner's run of 2026-10-17.

## Data created

- sim namespace `559040d9`, seed `1899796881`: 23 ledger rows and their projections, kept (the ledger is immutable)
- `/tmp/ledger-walk-a1.out`: removed at T3 · no tokens minted, no webhooks created
