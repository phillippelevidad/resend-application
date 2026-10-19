# Review — 2026-10-19

**Verdict:** ready for `opsx:apply`
**Checked against:** the slice card · `.ai/pre-proposals/2026-10-19-slice-3-operations-and-evidence-on-aws.md` · pp-workflow, pp-general, pp-backend, pp-infra, pp-testing, pp-cli, pp-database (Never list) · the repo at `82612c2`
**Repaired:** 10 (the redrive route's missing response mapper; `ingestSimulatorEnv` created in 7.1 but read in 6.3; the poison fault inlined run-time ids into DDL against pp-database → Never (`sql.raw` with a runtime value), so D27 now marks poisoned ids `simpoison_` and adds one constant constraint; PP §14 rules 6 and 14 restored as an `event-ledger` delta; endpoint paths removed from the read-api delta; api-contract and `LEDGER_SIMULATOR` contract edits moved ahead of the code; four dropped §22 doc duties restored (Projects row, AWS-U15 row, features.md verify and operate links, about.md operate row); the AWS-run guard also refuses a stack without the simulator secret; proposal's "Task 1.2" → 1.1; task 2.3's literal check no longer trips on test files, and `infra/src/main.ts` takes the stack name from `@ledger/aws`)

## Judgement calls the builder should know about
- D23 gains a sixth refusal (no `SimulatorSecretArn` output). Rung 4, lens clause 1: without it a burst raises the throttle and sends 10,000 requests that all answer `401`. Drop it only if the owner wants AWS runs against a flag-off stack.
- D27's poison mechanism departs from the PP (`CHECK (svix_id NOT IN (<ids>))` per run) under rung 1: the PP's version needs runtime values in DDL, which pp-database → Never forbids, and recording an exception in a skill would cross root AGENTS.md's rule-loosening gate. The run now re-ids its chosen events `simpoison_<namespace>_<k>`, and the constraint is the constant `CHECK (NOT starts_with(svix_id, 'simpoison_')) NOT VALID`. What reopens it: an ingest-side check on `svix-id` format, which would refuse those ids.
- The design's two renames against the PP (`dlq-port-contract.ts`; `burstHistory({ seed, … })`) are fact corrections, now stated in Context.

## What this review could not confirm
- The check script reports 215 BLOCKs, all false positives: its decision regex matches `### D<n>`, while this design (like slice 2's) uses `#### D<n>`. Its contract check also reads dotted code identifiers as operations. All 33 `D<n>` were resolved by hand.
- AWS-U14, AWS-U15, RS-U08 and AWS-U05's burst half are settled only by the walk; every AWS step is Ask-first and held.
- Pass 4's self-service walk found no human step on the adopter's path beyond what PP §19 states. The quota increase and the alarm-email observation are owner-only and off the path.
