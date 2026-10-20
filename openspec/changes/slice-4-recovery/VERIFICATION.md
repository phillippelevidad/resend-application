# Verification — 2026-10-20

**Verdict:** not done: one live item is open, Ships 7 (RS-U03's reach read, on or after
2026-10-21). Ships 11 closed on 2026-10-20: the second drill's `OK` → `ALARM` at 19:00:18 UTC, its
email confirmed by the owner. The code and docs are otherwise ready for `rsa-manual-test`.
**Gate:** `pnpm verify` exit 0, every stage run (`VERIFY PASSED`), before and after the repairs.
**Read:** `5fe2a51...HEAD`: 187 files, +14,502/−346 (4 generated files counted, not read) · the
four change artifacts and `WALKTHROUGH.md` · the slice 4 card, ADR-007, resend.md, api-contract.md
· pp-workflow, pp-general, pp-backend, pp-database, pp-infra, pp-cli, pp-testing.
**Fixed:** 4, one commit each: `efba9c5` `ca655dc` `6bd6aa6` `5e003b0`, plus `84e263d` (a refactor).

## Judgement calls the owner should know about
- A failed `getRun` poll ends `ledger reconcile`'s wait with exit 1 while the run goes on. That is
  pp-cli → Waiting's design (the run id is on stderr first). One sentence changes it: "keep polling
  through `api_unavailable`".
- The wait's backstop counts 400 polls rather than reading a clock (pp-cli → Waiting: "no clock is
  read"), so slow responses stretch it past 20 minutes.
- `ledger health`'s last-run line does not mark a dry run; it matches design.md → Surfaces exactly.
- A Ctrl-C during the drill's 10-minute wait leaves the ingest route at 0/0 with no restore; the gap
  alarm reports it within the hour and the runbook's `pnpm aws:rearm` clears it.
- A dead-lettered event is replayed every hourly run until redriven: ADR-007 says so.
- A late async invoke cannot claim an old run: invoke events older than 60 s are dropped (AWS-63).

## What this verification could not confirm
- RS-U03: List Events reach ≥ 72 h, readable on or after 2026-10-21.
- The `rsa-manual-test` walk itself; this gate only desk-checked `WALKTHROUGH.md` against the code.
