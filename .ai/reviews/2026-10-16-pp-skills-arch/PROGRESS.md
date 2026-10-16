# pp-* skills architecture review 2026-10-16: progress

One review round over the eight `pp-*` skills through the `architecture-designer` lens (failure
modes, stated trade-offs, NFRs, over- and under-engineering, pattern fit with the ADRs), before
slice 0. The consistency review is the previous run's Phase 5
([../2026-10-16-pp-skills/](../2026-10-16-pp-skills/PROGRESS.md)). Findings and their triage are in
[decisions.md](decisions.md). The brief lives in the local `stages/`, which is git-ignored.

**Resume in a fresh chat:** "continue the pp-skills architecture review". Read this file, then
[decisions.md](decisions.md), then resume from the first step not marked done.

| Step | Status |
| --- | --- |
| 1 — review: five read-only reviewers (A1 pp-workflow + pp-general, A2 pp-backend, A3 pp-database, A4 pp-testing + pp-infra, A5 pp-cli + pp-mcp) | done — 56 findings, 0 BLOCK |
| 2 — triage | done — 38 applied as low stakes, 3 under the decision lens, 1 resolved without a change, 14 to the owner as 13 decisions ([decisions.md](decisions.md)) |
| 3 — fix: five fixer agents, disjoint files, each verifying before applying; one commit per group | done — all 41 applied, none skipped; doc-side alignments applied (ADR-010 teardown order, "the teardown command", slice 0's seed line); AWS-U11 and AWS-U12 filed |
| 4 — link and anchor check over every touched file | done — 0 broken over 35 files |
| 5 — owner checkpoint: the OWNER items, one recommended pick each | **open** — AO-01 to AO-14 below |

**Left as notes, not applied:** `wf-after-apply-check/scripts/check.mjs` detects none of the new
Mandatory items (an `infra/**` change without an `infra/` test, a `packages/api` mapper without a
redaction test, `apps/local` host code without a unit test); add the triggers when slice 0 lands
the gate. pp-workflow SKILL.md is 15.6 KB (from 13.6) because the Mandatory list gained five
binding items; the others are 12.0–13.2 KB. A1-12 adds a grep stage and its violation fixture to
slice 0's scope, for the slice 0 pre-proposal.

## Owner checkpoint

Each item needs a decision the docs do not settle: a new or amended ADR, an Ask-first change, or a
slice scope change. One recommended pick each.

| ID | Finding | Question | Recommended |
| --- | --- | --- | --- |
| AO-01 | A1-05 | definition-of-done.md: "An approved plan does not approve the Ask-first items inside it; each stops for the owner". Slice 0 alone has ~8–10 stops (CI workflow, each dependency) | An itemized one-round approval counts (exact package and range, exact workflow file, exact resource, recorded in the pre-proposal); anything off the list still stops. Mirror in implement-plan |
| AO-02 | A1-08 | Config drift between `infra/src/function-env.ts` and a `.config.ts` fails at init on live traffic: for the worker every receive counts and the backlog drains to the DLQ without an ADR-015 pause | Variable-name constants in `packages/shared`, imported by both, plus one `Template` assertion that each function carries exactly its keys. Moves O-17's module |
| AO-03 | A2-06 | Async invoke is at-least-once: one reconcile run can execute twice at once, over ADR-012's rate bound and doubling replays. ADR-007 "runs never overlap" holds only at the start transaction | The reconciler claims its run with one conditional statement before any Resend call (a claim column on `reconcile_runs`, slice 4) and the invoke sets `MaximumRetryAttempts: 0`; add the duplicate-without-error sentence to AWS-53 |
| AO-04 | A2-10 + A4-13 | A Lambda killed or frozen mid-transaction leaves locks held server-side (both timeouts default 0): workers block, spend receives and dead-letter; the dispatcher's advisory lock blocks all deliveries | The role-ensure step sets `ALTER ROLE … SET idle_in_transaction_session_timeout` and `lock_timeout` below the worker timeout, with an int test (an idle lock holder; the worker still commits); whether Neon's pooler honors role settings becomes a new PG-U row for slice 2 |
| AO-05 | A3-06 | Neon Free's 1 GB storage cap meets a never-delete ledger; at the cap every insert fails non-connection-class and drains to the DLQ (~40–60 sim bursts) | A storage budget in integrations.md → Cadence (bytes/event measured in the slice 3 burst), PG-U03 extended to storage, database size in the health read, and ADR-015 amended so the over-limit error pauses the worker |
| AO-06 | A3-07 | `jsonb` rejects `\u0000` and lone surrogates: such a verified event fails its insert, is dead-lettered and fails every redrive, against ADR-004 "never dead-lettered for its content" | The repository maps that insert error to the existing "stored raw, counted" outcome, storing the payload with those characters replaced by U+FFFD; ADR-004's "as received" gains "minus what Postgres cannot store"; an int test feeds a NUL payload |
| AO-07 | A3-08 | Nothing ties a contract step to the deployed code: two commits in one deploy run the `DROP` under the previous Lambdas | The marker names the commit that stopped using the object; the deploy command records the deployed SHA as a stack output and refuses a contract step whose SHA is not an ancestor of it (ADR-018's evidence) |
| AO-08 | A3-10 | "Editing a pushed migration → Ask-first", but every step is pushed within minutes, so every in-slice schema fix becomes an owner ask or a permanent extra migration | Freeze at "merged to `main` or applied to a kept database"; before that, regenerate freely. Edits root AGENTS.md → Permissions, data-modeling.md, pp-database, wf-after-apply-check |
| AO-09 | A4-06 | aws.md item 7: the burst raises the steady throttle "only for its run", unsaid how: a crash leaves it raised; a blind restore after a mid-burst trip re-opens API Gateway; the usage-trip threshold may trip on the burst itself | The burst step refuses while tripped, raises the throttle, and restores in `finally` only if the value is still the one it set; slice 2 sizes the usage-trip threshold to admit one burst and states it in item 7 |
| AO-10 | A4-11 | Teardown deletes queued events that never reached `webhook_events` (a paused ESM, a tripped switch, a non-empty DLQ); aws.md says "the events live in Postgres" | Teardown reads source-queue and DLQ depth and refuses when either is non-zero unless an explicit discard flag is given (new script flag, Ask-first) |
| AO-11 | A4-12 | Secrets with fixed physical names in a recovery window make a redeploy after teardown fail `CREATE_FAILED` (AWS-U06), so every teardown drill needs a manual force-delete | Secrets take no physical name; functions get the ARN; the deploy script reads ARNs from stack outputs. Amends integrations.md → Secrets layout |
| AO-12 | A5-02 | A crashed reconcile run (no `finished_at`) reads "running" forever; `ledger reconcile` has no registry code to end on and cannot know the Lambda-side budget | The API derives the state: past budget with no `finished_at` returns a new run-outcome code (e.g. `run_abandoned`, registry, slice 4, Ask-first) from `getRun` and `gaps.list`; the CLI polls until finished or abandoned |
| AO-13 | A5-08 | Masks keep control characters, so a display name or subject with `ESC`/`\r` reaches a terminal raw through human CLI output (`--json` and MCP are escaped) | The `packages/core` mask maps every control character to `*`, with a fast-check property "a mask holds no control character" (slice 0's mask properties) |
| AO-14 | A2-07 (raised by the fix) | pp-backend now ends a quota `429` (`daily_quota_exceeded`, `monthly_quota_exceeded`) or a `429` without `retry-after` with `rate_limited`, but the registry's Meaning covers only the rate limit running out inside a run's budget (Ask-first registry edit) | Widen `rate_limited`'s Meaning: "…or Resend answered a `429` that cannot be waited out (a daily or monthly quota, or no `retry-after`) … (RS-19, RS-22)". A dedicated quota code adds a contract entry for a case the owner handles the same way |
