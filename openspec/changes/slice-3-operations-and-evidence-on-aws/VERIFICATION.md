# Verification — 2026-10-19

**Verdict:** done, every Ships box ticked; ready for `rsa-manual-test`, then `Status` `[x]` and `opsx:archive`.
**Gate:** `pnpm verify` exit 0, every stage run (`VERIFY PASSED`), before and after the repairs.
**Read:** `8e37a70...HEAD` — 153 files, +13,232 / −464 · the four change artifacts, `REVIEW.md`, `WALKTHROUGH.md` · the slice 3 card, the `.ai/` diffs (about, api-contract, architecture, aws, integrations, resend, data-modeling, check-before-launch) · pp-workflow, pp-general; four read-only surface reviews (backend+schema, infra, sdk-cli, sim) against pp-backend, pp-infra, pp-cli, pp-testing, pp-database checklists.
**Fixed:** 5, one commit each — `090cda8` `9c011a1` `0bf5a2f` `78ff400` `cea0ddb`.

## Ships 5's alarm email
The owner's two emails (16:08 and 16:22 UTC) match `LedgerApp-queue-age` → `ALARM` at 16:08:34 UTC and `LedgerApp-dlq-depth` → `ALARM` at 16:22:12 UTC, both from the second `--poison 1` run (its message aged the queue to 1,038 s; `cea0ddb` corrects AWS-22). The db-outage run's own queue-age email reached the owner at 14:54:34 UTC, the transition's time, 18 min after the send; Ships 5 is ticked with it recorded in ADR-015's Evidence.

## Judgement calls the owner should know about
- `dlq.listMessages` now answers `depth = max(approximate depth, items returned)` (AWS-62). The contract's shape is unchanged; only a self-contradicting `depth: 0` beside an item is gone. Reopen if `depth` must stay the raw attribute sum.
- ~~`dlq.startRedrive` still answers `empty` on an approximate depth of 0 without a confirming receive (D4 as designed).~~ Superseded: the walk saw `empty` over a just-listed message (WALKTHROUGH-RUN.md F3, branch `[Unverified]`), so D4 now confirms every answer with a receive, locked by `sqs-dlq.adapter.test.ts`'s F3 case; a re-walk of E3 → E4 after the next deploy settles the residual empty-receive case (AWS-59).
- First deploy with `LEDGER_SIMULATOR=on`: CDK creates the simulator secret with a generated, non-`whsec_` value, and ingest fails closed on it (D13), so real Resend deliveries answer `503` until the deploy writes the value moments later. Resend retries (RS-09); nothing is lost. Kept as designed.
- A Ctrl-C during an AWS sim run skips its `finally`. The design accepts a crashed run (Risks): the next db-outage run refuses a repointed secret and names `pnpm aws:deploy`, the next poison run drops a leftover constraint, and a raised burst throttle is bounded by the usage trip (aws.md item 7, ≈ USD 4.3). No signal handler was added.
- Concurrent redrive starts that race past the `RUNNING` check surface as `500 internal_error`, not `409` (D4, AWS-U14 safe either way).

## What this verification could not confirm
- The deployed runs (burst, db-outage, poison, duplicates) were not re-run; their recorded numbers in `.ai/` are taken from group 12's logs.
- Whether a `Description`-only `UpdateFunctionConfiguration` to `""` recycles a function whose description already reads `""` (the restore after an injection whose recycle never landed); AWS-U15 was settled by one run of the normal path only.
