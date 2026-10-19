# Verification — 2026-10-18

**Verdict:** not done. Groups 13 and 14.2 (live AWS and Resend runs, each Ask-first) are open, so Ships 7, 9, 11, 12 and 15 stay unticked and `Status` stays `[~]`. Everything that can be checked before a deploy is green, ready for `rsa-manual-test` path A.
**Gate:** `pnpm verify` exit 0, every stage run (`VERIFY PASSED`): first on `a1d2ac9` before the repairs, then on `c0bc849` after the last code commit.
**Read:** `e62bf50...HEAD`: 283 files, about 24k added lines (4 generated files counted, not read). Also read: the four change artifacts, `WALKTHROUGH.md` (desk check) and `REVIEW.md`. Docs checked: build-checklist, api-contract, data-modeling, architecture (ADR-001/008/010/015/018/019), integrations, aws, resend, about, check-before-launch, features. Skills loaded: pp-workflow, pp-general, pp-backend, pp-database, pp-testing, pp-infra, pp-cli.
**Fixed:** 13, one commit each: `92cdcf7` `cdc12c3` `70cba99` `c0e7ea2` `cd1adab` `eab5671` `cb6cbd0` `236d013` `931f584` `4b04627` `3485122` `482da09` `c0bc849`.

## Judgement calls the owner should know about
- `runTransaction` now keeps a no-op `error` listener on its client while the client is checked out. Without it, a socket reset mid-transaction crashed the Lambda before D15 could retry or pause. The query's rejection still drives classification. This would change only if `pg` stopped emitting `error` on a checked-out client.
- `onError` now answers a raised `internal_error` before the database classifier, so an AWS SDK socket error answers `500` (D19, D20), not `503`. Logs carry the cause's `error_name`.
- The migration lint keeps string literals when it scans (D38 strips only comments). It still strips double-quoted identifiers, which can never hide a keyword. D38 now says so.
- No fix was made to: the deploy's tripped check reading only the worker (the spec's "Tripped stack" defines it that way); a mapping read as `changing` at deploy time; the trip report saying `paused` without reading it back; a failed `ledger/database` read in the worker draining to the DLQ without a pause. Each is listed in the report with a recommendation.

## What this verification could not confirm
- Every AWS-side behaviour D42 owes (AWS-U01, U02, U11, PG-U02, PG-U06, and the rest of Ships 15): group 13's live runs.
- `aws:rearm`'s over-budget warning and `aws:trip-drill`'s refusals have spec scenarios but no automated test. `pnpm db:setup`'s orchestration (keys written before the database step, the `local-setup` fallback, failure lines holding no URL) is tested only through its pure merge. Walk path A and group 13 exercise them by hand.
- Whether a deployed `Query read timeout` leaves the socket hung or reset. `run-transaction.int.test.ts` covers both mechanisms locally.
