# Verification — 2026-10-19

**Verdict:** code verified, ready for `rsa-manual-test`; the slice is not done until the owner records Ships 5's queue-age alarm email time (12.4) and the walk passes, then `opsx:archive`.
**Gate:** `pnpm verify` exit 0, every stage run (`VERIFY PASSED`), before and after the repairs.
**Read:** `8e37a70...HEAD` — 153 files, +13,232 / −464 · the four change artifacts, `REVIEW.md`, `WALKTHROUGH.md` · the slice 3 card, the `.ai/` diffs (about, api-contract, architecture, aws, integrations, resend, data-modeling, check-before-launch) · pp-workflow, pp-general; four read-only surface reviews (backend+schema, infra, sdk-cli, sim) against pp-backend, pp-infra, pp-cli, pp-testing, pp-database checklists.
**Fixed:** 4, one commit each — `090cda8` `9c011a1` `0bf5a2f` `78ff400`.

## Judgement calls the owner should know about
- `dlq.listMessages` now answers `depth = max(approximate depth, items returned)` (AWS-62). The contract's shape is unchanged; only a self-contradicting `depth: 0` beside an item is gone. Reopen if `depth` must stay the raw attribute sum.
- `dlq.startRedrive` still answers `empty` on an approximate depth of 0 without a confirming receive (D4 as designed). Under AWS-62's lag it can say "nothing to move" over a message that just arrived; the message stays in the DLQ and a retry moves it. Kept: D4 decided it, and no event is lost.
- First deploy with `LEDGER_SIMULATOR=on`: CDK creates the simulator secret with a generated, non-`whsec_` value, and ingest fails closed on it (D13), so real Resend deliveries answer `503` until the deploy writes the value moments later. Resend retries (RS-09); nothing is lost. Kept as designed.
- A Ctrl-C during an AWS sim run skips its `finally`. The design accepts a crashed run (Risks): the next db-outage run refuses a repointed secret and names `pnpm aws:deploy`, the next poison run drops a leftover constraint, and a raised burst throttle is bounded by the usage trip (aws.md item 7, ≈ USD 4.3). No signal handler was added.
- Concurrent redrive starts that race past the `RUNNING` check surface as `500 internal_error`, not `409` (D4, AWS-U14 safe either way).

## What this verification could not confirm
- The deployed runs (burst, db-outage, poison, duplicates) were not re-run; their recorded numbers in `.ai/` are taken from group 12's logs.
- The `LedgerApp-queue-age` alarm email's arrival time (Ships 5): only the owner's inbox shows it.
- Whether a `Description`-only `UpdateFunctionConfiguration` to `""` recycles a function whose description already reads `""` (the restore after an injection whose recycle never landed); AWS-U15 was settled by one run of the normal path only.
