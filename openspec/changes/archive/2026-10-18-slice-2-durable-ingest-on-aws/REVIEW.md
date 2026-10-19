# Review — 2026-10-17

**Verdict:** ready for `opsx:apply`
**Checked against:** the slice card · `.ai/pre-proposals/2026-10-17-slice-2-durable-ingest-on-aws.md` · pp-workflow, pp-general, pp-backend, pp-database, pp-infra, pp-cli, pp-testing · ADR-008, ADR-015, ADR-018 · the repo at `b344ab2`
**Repaired:** 11. The worker's retry now really gets a fresh connection, through `runTransaction` (D15; the stock Drizzle path reused a hung client and timed out before pausing). The contract-step check compares against the deployed `DeployedCommit`, not the commit being deployed (spec vs ADR-018). Composition roots get AWS clients from `@ledger/aws` factories (D26 vs the module boundary). The contract-suite cases for the new operations moved after the SDK methods exist (8.5 → 9.1). Slice 1's api tests are updated when the middleware lands (8.1). Specs name operations, not paths. Three dropped §22 doc duties restored. The D9 citation path is fixed, and D33/Goals wording no longer claims every refusal precedes migration.

## Judgement calls the builder should know about
- `deploy-checks.int.test.ts` reads through the harness's owner connection (D12). The deploy runs these reads as the owner, and the runtime role cannot see the `drizzle` schema. A pp-testing rule that bound owner-free assertions even for deploy-time reads would change this.
- `runTransaction` skips `ROLLBACK` on a classified error and lets the closed connection roll back server-side. If Postgres were found to keep a transaction open after the client disconnects, this would need revisiting. It does not keep it open: a backend ends its transaction when its connection ends.
- The read API's single queries (`pool.query`) already release a failed client with the error, so only the worker's transaction path needed the fix. `token.revoke`'s transaction keeps `db.transaction`: it is a read-path availability cost, not event loss.

## What this review could not confirm
- That a deployed `Query read timeout` really leaves the socket hung, as opposed to reset. `run-transaction.int.test.ts` proves the mechanism either way. Only slice 3's `--chaos db-outage` sees AWS.
- Every AWS-side behaviour D42 lists (AWS-U01, U02, U11, PG-U01, U02, U06): owed to group 13's live runs, as planned.
- The check script reads `#### D<n>` headings as undefined (244 false `BLOCK`s) and flags a REMOVED requirement for having no scenario. Both are script defects; this run used a patched copy for the decisions check.
