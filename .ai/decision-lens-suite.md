# Decision-lens regression suite

> **TEMPLATE — not ratified.** Bootstrap step 2 in [bootstrap-checklist.md](bootstrap-checklist.md). The preview content below is illustrative, drafted from [docs/idea.md](../docs/idea.md) without research. Nothing here is binding until this banner and the instructions comment are removed.

<!-- AGENT INSTRUCTIONS
Purpose: the settled decisions the decision lens in root AGENTS.md
(#decision-lens--evidence-over-claims-right-sized) MUST reproduce, verdict AND reason, from its own
text. A lens edit is tested against this suite instead of argued.

Consumers: whoever edits the lens (step 1 ratification, any later edit); wf-before-propose
(references/doc-map.md lists this file next to the lens); the owner, who ratifies lens and suite
together.

Inputs (read first): root AGENTS.md → Decision lens (as rewritten in step 1); about.md (ratified,
especially #platform-scale-assumptions, #what-this-project-must-demonstrate, #risk-appetite,
#non-goals--out-of-scope); bootstrap-checklist.md → Owner calibration; docs/idea.md §2.2, §3, §5,
§9, §10.

Research: none external, except confirming that each case's source states the reason given. For a
case resting on Resend behavior (e.g. idempotency keys, replay keeps svix-id), cite the Resend page
(https://resend.com/docs/llms.txt) or the resend.md RS-NN fact once step 4 lands.

Required structure: the score line ("Current score: N/M."), ## How to use it, ## Cases (table:
# | Case | Verdict | Why | Clause | Source), ## Phrases the lens cannot lose (table: Phrase | Cutting
it). Case numbers are stable; never renumber, append.

Evidence rules:
- A case's Why MUST come from a ratified source that predates the lens draft. Until architecture.md
  ADRs exist, idea.md sections and about.md count; re-point sources to ADRs in step 7 or 13.
- Score the draft lens case by case. A pass needs the verdict AND the Why, re-derived from the lens
  text. Matching by name or by finding the item in a list is a fail.
- A case the lens cannot satisfy is a finding to report, never a case to edit.
- Keep at least one case per lens clause, and at least one guarding each direction: over-building
  (signal clause, ceiling, cost brake) and under-building (spend anyway, hand-walkable slices).
- Phrases: list only phrases actually tested by cutting them and re-scoring.

Owner decisions to surface (one batched round, one recommended pick each): any case whose verdict
the owner has not ratified (preview cases 7, 8 and 11 are the likely ones); the tripwire wording for
each defer.

Done when: every case scores against the step-1 lens, the score is recorded, the phrase table is
filled from real cut tests, no [Preview] tag remains, banner and this comment are removed.
-->

**Current score: — / — (not yet scored).**

## How to use it

- Any lens edit MUST re-score **every** case against the draft's own text and record the score above.
- A case passes only when the draft reaches both the **verdict** and the **Why**.
- A case the draft cannot satisfy is a **finding**. MUST NOT edit the expected verdict to pass a draft.
- A decision ratified since the last lens edit that the lens must reproduce MUST be added in that same edit.
- [Preview] Cases 4, 5, 9 and 11 guard against over-building. Cases 2, 3, 6, 10 and 12 guard against under-building.

## Cases

| # | Case | Verdict | Why | Clause | Source |
| - | ---- | ------- | --- | ------ | ------ |
| 1 | SQS FIFO for event ordering | reject | FIFO orders by arrival at our queue, but Resend's deliveries are unordered to begin with; it costs throughput and gives false correctness. The projection makes order irrelevant. | Reversible-cheap, categorical branch | [idea §5.3](../docs/idea.md#53-worker-and-the-event-ledger) |
| 2 | Verify, then enqueue; no database in the request path | admit (spend anyway) | A DB outage would fail deliveries, and past ~28h of retries events are lost. The queue holds them up to 14 days. | Spend anyway: lost events | [idea §5.1](../docs/idea.md#51-architecture-overview) |
| 3 | Recompute the projection from the event set, not incrementally | admit | Incremental updates make state depend on arrival order; set-based recompute makes permutation and duplication invariance true and testable. Cost is O(events per email), small at the ceiling. | Spend anyway: order-dependent state; ceiling keeps cost out | [idea §5.4](../docs/idea.md#54-order-independent-projections), [§9](../docs/idea.md#9-general-questions) |
| 4 | Multi-database connectors | reject | The Ingester already ships them; Ledger's workload is transactional (row locks, outbox in the same transaction), which is Postgres. | Complement, don't duplicate; categorical branch | [idea §2.2](../docs/idea.md#22-what-already-exists-the-resend-webhook-ingester), [§3](../docs/idea.md#3-goals-and-non-goals) |
| 5 | Multi-tenant hosting | reject | Self-hosted, single team. Generality beyond the single-installation ceiling at every point below it. | Right-size to the ceiling; categorical; signal clause | [idea §3](../docs/idea.md#3-goals-and-non-goals), [about → Platform scale assumptions](about.md#platform-scale-assumptions) |
| 6 | Outbox + Resend idempotency keys for alert emails | admit (spend anyway) | A retried dispatch without a key sends two alerts. | Spend anyway: duplicate effects | [idea §5.6](../docs/idea.md#56-reactions-via-a-transactional-outbox) |
| 7 | Minimal read-only web UI | defer with tripwire | CLI and MCP cover every persona's job. [Preview] Tripwire: M2 done and a demo step cannot be shown through CLI or MCP output. | Reversible-cheap, temporal branch; signal clause | [idea §10.8](../docs/idea.md#10-open-questions) |
| 8 | Inngest worker adapter | defer with tripwire | SQS + Lambda is chosen to make the reliability primitives explicit; a second worker adds no claim yet. [Preview] Tripwire: M2 done and a comparison claim is named for it. | Temporal branch; signal clause | [idea §9](../docs/idea.md#9-general-questions), [§10.7](../docs/idea.md#10-open-questions) |
| 9 | NAT gateway or provisioned RDS | reject | Always-on idle cost under deploy-and-keep, and no claim depends on it. | Cost brake; deploy-and-keep posture | [root AGENTS.md → Cost brake](../AGENTS.md#decision-lens--evidence-over-claims-right-sized), [calibration](bootstrap-checklist.md#owner-calibration-ratified-2026-10-15) |
| 10 | Budget alarm with a hard monthly cap, from the first deploy | admit (spend anyway) | The stack stays up until the owner tears it down, at an unknown review time; unbounded spend is never tolerable. | Spend anyway: budget-alarm gap; deploy-and-keep | [calibration](bootstrap-checklist.md#owner-calibration-ratified-2026-10-15), [about → Risk appetite](about.md#risk-appetite) |
| 11 | [Preview] Multi-region failover for ingest | reject | Infrastructure depth no claim depends on, beyond the single-installation ceiling. | Signal clause ("overdoing it"); ceiling | [calibration](bootstrap-checklist.md#owner-calibration-ratified-2026-10-15) |
| 12 | [Preview] A slice whose result is visible only through SQL | admit the smallest read path (CLI command or simulator invariant) | Every finished slice MUST be hand-walkable; "a later slice adds the CLI" does not answer it, because the walk is how the slice is verified. | Reviewers arrive after the last slice, second limb | [calibration](bootstrap-checklist.md#owner-calibration-ratified-2026-10-15) |

## Phrases the lens cannot lose

[Preview] Filled only from real cut-and-rescore tests. Expected shape:

| Phrase | Cutting it |
| ------ | ---------- |
| "infrastructure depth no claim depends on" | [Preview] Case 11 flips to admit as "learning AWS" |
| "a budget-alarm gap" (spend anyway) | [Preview] Case 10 falls back to the cost brake and defers as polish |
| "hand-walkable through the CLI, the API or the simulator" | [Preview] Case 12 defers to the interfaces slice |
