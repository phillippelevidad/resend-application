# Verification — 2026-10-17

**Verdict:** not done — `Ships` 11 (RS-U21) is open: it needs a two-recipient send from a verified domain, an owner decision ([about.md → Project domain](../../../.ai/about.md#open-questions)); the card is `[!]` with that reason. Everything else is ready for `rsa-manual-test`.
**Update 2026-10-17:** the owner moved RS-U21 to slice 2 ("Move RS-U21 to a later slice. … Maybe it will be ready for slice 2."); no other blocker remains. Ready for `rsa-manual-test`, then `opsx:archive`; the card is `[~]` until the walk passes.
**Gate:** `pnpm verify` exit 0, every stage run (`VERIFY PASSED`), on `2f1a231`.
**Read:** `61e94cb...e13ea41`: 187 files, +19,253 / −1,140 (pnpm-lock and Drizzle `meta/` counted, not read) · the four change artifacts, REVIEW.md and WALKTHROUGH.md · `.ai/` about, api-contract, architecture, build-checklist, data-modeling, resend and `.env.example` diffs · pp-workflow, pp-general, pp-testing, plus pp-backend and pp-database rules on the surfaces read; the diff itself read by four surface helpers, each lead opened before acting.
**Fixed:** 6, one commit each: `da21aea` `c374e28` `73a2869` `875abff` `982edad` `2f1a231`.

## Judgement calls the owner should know about
- `email.get` now reads one `REPEATABLE READ` snapshot (`da21aea`); without it, a worker commit between its three reads answered a timeline of n events beside a state of n + 1. Recorded in design.md and pp-backend as the rule for any multi-table reader.
- A Postgres outage in local mode dead-lists in-flight events in about 4 s, and the in-memory dead list dies with the process. Documented in design.md → Risks (`2f1a231`), not fixed: ADR-015's pause (slice 2) and slice 2B's durable dead rows carry it. "Build the local pause now" would change that.
- `pnpm db:setup` regenerates `LEDGER_ADDRESS_HASH_KEY` whenever the line is empty, even while compose Postgres holds rows hashed under the old key, which splits `recipient_state` per address. Not fixed: only slice 2's deploy command refuses a mismatched `key_id`.
- Left as the contract stands (changing them is Ask-first): the CLI accepts `http://` for a non-loopback `LEDGER_URL` (cleartext bearer once slice 2 enforces tokens); the `email_id` pattern admits `.` and `..`; no body-size cap at ingest or `recipient.get` (loopback only until slice 2's API Gateway).
- Ships 10's evidence stays the live walk step (A1/A2), as design.md → Goals says: no automated test runs `liveRun` end to end, so its exit-code logic is proven only by the walk.

## What this verification could not confirm
- RS-U21: only a verified-domain send settles it (slice 2).
- Path D's live Resend steps: recorded from the owner's run of 2026-10-17 (RS-39–RS-42); not re-run here.
- The snapshot read behind Neon's transaction pooler (PG-U02, slice 2); it is transaction-scoped, so expected safe.
