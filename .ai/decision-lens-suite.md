# Decision-lens regression suite

The settled decisions the [decision lens](../AGENTS.md#decision-lens--evidence-over-claims-right-sized)
MUST reproduce, verdict **and** reason, from its own text. A lens edit is tested against this suite
instead of argued. The owner ratifies the lens and the suite together.

**Current score: 21/21** (2026-10-15, re-scored after bootstrap step 13). Step 13 pointed the lens
at the ADRs and `.ai/` instead of the frozen idea doc, and renamed "v0 per phase" to "v0 per
slice". It kept the five decisions and the Postgres reason verbatim, so no verdict or Why moved.
Before that, the lens scored 21/21 as edited in bootstrap step 2. The step-1 lens scored
18/21. It failed case 1 (FIFO matched by name only, and clause 6 could argue *for* FIFO), case 4 (the
Postgres reason matched by name only) and case 9 (clause 2 called cost temporal, so the lens said
defer, not reject). The same edit fixed all three: the "Postgres only" reason, "order comes from the
projection, never from transport" in clause 6, "build cost" plus "an always-on charge in a kept-up
deploy" in clause 2, and "in an ADR" in the cost brake.

## How to use it

- Any lens edit MUST re-score **every** case against the draft's own text and record the score above.
- A case passes only when the draft reaches both the **verdict** and the **Why**. Facts a case cites
  (Resend or AWS behavior, a number in [about.md](about.md)) are inputs. The decision and its reason
  MUST come from the lens. Matching the item by name, or finding it in a list without its reason, is
  a fail.
- A case the draft cannot satisfy is a **finding**. MUST NOT edit the expected verdict to pass a draft.
- A decision ratified since the last lens edit that the lens must reproduce MUST be added in that
  same edit. Case numbers are stable: append, never renumber.
- Directions. Over-building guards: 1, 4, 5, 7, 8, 9, 11, 15, 16. Under-building guards: 2, 3, 6,
  10, 12, 17, 18, 19, 20, 21. Claim guards: 13, 14.
- Sources lead with the [architecture.md](architecture.md) ADR that carries the case, where one
  exists (re-pointed in bootstrap step 7), then [about.md](about.md). [docs/idea.md](../docs/idea.md)
  links are provenance only: it is a frozen RFC.

## Cases

| # | Case | Verdict | Why | Clause | Source |
| - | ---- | ------- | --- | ------ | ------ |
| 1 | SQS FIFO for event ordering | reject | FIFO orders arrival at our queue, but Resend promises no delivery order (retries and replays arrive whenever they arrive). It costs throughput and gives false correctness. Order comes from the projection, so the reason holds at every point below the ceiling. | 2 categorical; 6 order-dependent state | [ADR-002](architecture.md#adr-002--sqs-standard-not-fifo), [idea §5.3](../docs/idea.md#53-worker-and-the-event-ledger), [about → Open questions](about.md#open-questions) (event timestamps) |
| 2 | Verify, then enqueue; no database in the request path | admit (spend anyway) | With the write in the request path, a DB outage fails deliveries. Resend retries only for a bounded window (≈ 27.6 h by its schedule, 24 h on another page, `[Unverified]`), and recovery from List Events has unverified reach, so past it events are lost. The queue holds them up to 14 days. | 6 lost events; tie-break | [ADR-001](architecture.md#adr-001--verify-then-enqueue), [idea §5.1](../docs/idea.md#51-architecture-overview), [about → Open questions](about.md#open-questions) (retry window, List Events reach) |
| 3 | Recompute the projection from the event set, not incrementally | admit | Incremental updates make state depend on arrival order. A set-based recompute makes permutation and duplication invariance true and property-testable. Cost is O(events per email), small at the ceiling. | 6 order-dependent state; 1 ceiling; evidence | [ADR-003](architecture.md#adr-003--projection-is-a-pure-function-of-the-event-set), [idea §5.4](../docs/idea.md#54-order-independent-projections), [§9](../docs/idea.md#9-general-questions), [about → Platform scale assumptions](about.md#platform-scale-assumptions) |
| 4 | Multi-database connectors | reject | The Ingester already ships them, and Ledger builds what it does not. Ledger's own workload is transactional: dedupe, row locks and the outbox commit in one transaction, which is Postgres. | Complement, don't duplicate; 2 categorical | [ADR-005](architecture.md#adr-005--postgres-only), [idea §3](../docs/idea.md#3-goals-and-non-goals), [§9](../docs/idea.md#9-general-questions), [about → Positioning](about.md#positioning) |
| 5 | Multi-tenant hosting | reject | Self-hosted, one installation, one team. Generality beyond the ceiling, at every point below it. | 1 ceiling; 2 categorical; 5 signal | [idea §3](../docs/idea.md#3-goals-and-non-goals), [about → Platform scale assumptions](about.md#platform-scale-assumptions) |
| 6 | Outbox + Resend idempotency keys for alert emails | admit (spend anyway) | A retried dispatch without a key sends two alerts. With the same key, Resend returns the same response without sending again, for 24 h. | 6 duplicate effects | [ADR-006](architecture.md#adr-006--transactional-outbox-for-reactions), [idea §5.6](../docs/idea.md#56-reactions-via-a-transactional-outbox), [Resend → idempotency keys](https://resend.com/docs/dashboard/emails/idempotency-keys) (checked 2026-10-15) |
| 7 | Minimal read-only web UI | defer with tripwire | The CLI and MCP cover every persona's job, so the UI proves no row yet. Whether a demo step needs it is known only once the M2 demo exists (sequencing). Tripwire: M2 is done **and** a demo step cannot be shown through CLI or MCP output. | 2 temporal; 5 signal | [idea §10.8](../docs/idea.md#10-open-questions), [about → Open questions](about.md#open-questions) |
| 8 | Inngest worker adapter | defer with tripwire | SQS + Lambda makes the reliability primitives explicit and testable. A second worker proves no row of What this project must demonstrate yet. Tripwire: M2 is done **and** a row in What this project must demonstrate names a claim only it can prove. | 2 temporal; 5 signal | [idea §9](../docs/idea.md#9-general-questions), [§10.7](../docs/idea.md#10-open-questions), [about → Open questions](about.md#open-questions) |
| 9 | NAT gateway or provisioned RDS in the owner's kept-up deploy | reject; only an ADR with a measured reason reopens it | Both bill by the hour whether or not traffic flows. A NAT gateway alone is USD 0.045/h (US East, Ohio), about USD 33 a month, against a ≤ USD 5 idle target. The stack stays up for an unknown time, so the charge is paid at every point below the ceiling, which makes it categorical. The Postgres host itself is decided in [integrations.md](integrations.md). | Cost brake; 2 categorical; 7 deploy and keep | [ADR-010](architecture.md#adr-010--serverless-on-aws-cdk-an-app-stack-and-a-guardrails-stack), [about → Success metrics](about.md#success-metrics), [AWS VPC pricing](https://aws.amazon.com/vpc/pricing/), [RDS for PostgreSQL pricing](https://aws.amazon.com/rds/postgresql/pricing/) (checked 2026-10-15) |
| 10 | Budget alarm with a hard monthly cap, from the first deploy | admit (spend anyway) | The stack stays up until the owner tears it down, and review timing is unknown. Unbounded spend is never tolerable. "Hard cap" means alerts plus a kill switch. | 6 budget-alarm gap; 7 deploy and keep | [about → Risk appetite](about.md#risk-appetite), [Success metrics](about.md#success-metrics) |
| 11 | Multi-region failover for ingest | reject | No row in What this project must demonstrate names regional availability, and the ceiling is one deployment, so the reason holds at every point below it: infrastructure depth no claim depends on. A regional outage is an ingest outage, which the retry window and the reconciler address (case 2). | 5 signal; 1 ceiling; 2 categorical | [about → Platform scale assumptions](about.md#platform-scale-assumptions), [What this project must demonstrate](about.md#what-this-project-must-demonstrate), [idea §6.4](../docs/idea.md#64-failure-modes-and-expected-behavior) |
| 12 | A slice whose result is visible only through SQL | admit the smallest read path that walks it (CLI, API or simulator) | Every finished slice MUST be hand-walkable. "A later slice adds the CLI" does not answer it, because the walk is how the slice is verified. Testability pulls the work forward. How the M1 CLI reads state is decided separately, in step 7. | 3 reviewers at milestone boundaries, hand-walk limb | [ADR-011](architecture.md#adr-011--one-contract-many-surfaces), [about → Target personas](about.md#target-personas) |
| 13 | Dedupe replays on `svix_id` alone, relying on the redelivery carrying the original `svix-id` | do not build on it yet; keep it `[Unverified]` in Open questions until the docs or a test confirm it | The docs confirm only that Replay returns the same `msg_` id. The header is backed by a community report, not a Resend page. | Verify Resend behavior | [about → Open questions](about.md#open-questions) (replay keeps `svix-id`), [Resend → replay event](https://resend.com/docs/api-reference/webhooks/replay-event) |
| 14 | The README claims "no lost events" before the recovery test exists | reject the claim until its evidence lands, then link it | A claim without evidence is deleted or moved to Open questions. Every row in What this project must demonstrate is a gap until its evidence lands. | Evidence | [about → What this project must demonstrate](about.md#what-this-project-must-demonstrate), [Success metrics](about.md#success-metrics), [idea §5.9](../docs/idea.md#59-the-chaos-and-simulation-harness) |
| 15 | Swap Drizzle for another ORM in `packages/db` | reject, unless the doc that introduces it gives a one-line reason | The stack is chosen to stay close to what Resend publicly describes using. A deviation without its stated reason is drift. | Public stack | [idea §6.1](../docs/idea.md#61-stack) |
| 16 | One PR that lands the CDK stack, metrics and alarms, and the reconciler | split: each phase ships usable and tested on its own, in the smallest PR | v0 first. Small PRs are how Resend ships, and they are what a reviewer can merge fast. | v0 per slice, smallest PR | [architecture → Build order](architecture.md#build-order-vertical-slices), [idea §3](../docs/idea.md#3-goals-and-non-goals) (goal 7), [§7](../docs/idea.md#7-implementation-plan), [about → What this project must demonstrate](about.md#what-this-project-must-demonstrate) |
| 17 | Re-seed the demo database by hand (SQL) before each demo run | admit a script | One owner, no on-call. A manual step that recurs per demo does not survive repeated reviews, so it is on the adopter's path and MUST be scripted. | 1 ceiling, owner-operations limb | [about → Platform scale assumptions](about.md#platform-scale-assumptions) |
| 18 | Recovering missed events needs the operator to replay them in the Resend dashboard | admit the smallest version that removes the manual step: the reconciler replays through the Headless Webhook API | Recovery is a step on the adopter's self-service walk (`… → recover → …`). A dashboard step there is not intended. | 4 self-service test | [about → Guiding principles](about.md#guiding-principles), [What this project must demonstrate](about.md#what-this-project-must-demonstrate), [ADR-007](architecture.md#adr-007--recovery-by-id-diff-and-replay-through-ingest), [idea §5.5](../docs/idea.md#55-reconciler-recovering-missed-events) |
| 19 | Cut the reconciler lookback below Resend's retry window to spend fewer API calls | reject | An event whose last retry fails is about 27.6 h old (`[Unverified]` against a 24 h figure). A shorter lookback never sees it, so it is lost. No loss outranks cost. API pressure is met by cadence and rate-limit headroom, not by shortening the lookback. | Tie-break; 6 lost events | [ADR-007](architecture.md#adr-007--recovery-by-id-diff-and-replay-through-ingest), [idea §5.5](../docs/idea.md#55-reconciler-recovering-missed-events), [about → Open questions](about.md#open-questions) (retry window) |
| 20 | Register the MCP operate tools (`reconcile`, `redrive_dlq`) by default, for demo convenience | reject; admit (spend anyway) the default that leaves them unregistered without the `operate` scope | `reconcile` starts live replays, which are Resend writes. An agent holding a read token must be unable to start one. A live Resend write nobody requested is never tolerable. | 6 security exposure | [ADR-011](architecture.md#adr-011--one-contract-many-surfaces), [idea §5.7](../docs/idea.md#57-interfaces-read-api-sdk-cli-mcp), [about → Risk appetite](about.md#risk-appetite) |
| 21 | A name, npm scope or branding that implies the project is Resend's | reject | Implying affiliation is never tolerable, so the cost of a neutral name is paid whatever it is. The final name is picked before the first npm publish. | 6 implying affiliation | [about → Positioning](about.md#positioning), [Risk appetite](about.md#risk-appetite), [Open questions](about.md#open-questions) (final name) |

Every lens clause has at least one case: evidence (3, 14), verify Resend (13), complement (4),
cost brake (9), public stack (15), v0 (16), clause 1 (5, 17), clause 2 (1, 7), clause 3 (12),
clause 4 (18), clause 5 (8, 11), clause 6 (2, 6, 20, 21), clause 7 (9, 10), tie-break (2, 19).

## Phrases the lens cannot lose

Each row was tested by cutting the phrase from the lens and re-scoring every case (2026-10-15).

| Phrase | Cutting it |
| ------ | ---------- |
| "infrastructure depth no claim depends on" (clause 5) | Case 11 flips to admit: one deployment can span regions, and an ADR would make it "learning AWS" |
| "hand-walkable through the CLI, the API or the simulator, because the walk is how the slice is verified" (clause 3) | Case 12 flips to defer: "a gap that a named later slice carries is the plan working" |
| "order comes from the projection, never from transport" (clause 6) | Case 1 loses its Why, and clause 6 can argue for FIFO as order safety |
| "an always-on charge in a kept-up deploy" (clause 2) | Case 9 flips to defer: cost is otherwise read as temporal |
| "per deploy, per demo or per review walk MUST be scripted" (clause 1) | Case 17 flips to run-thin: Risk appetite lets the owner's own demo operations stay manual |
| "Complement, don't duplicate" | Case 4 keeps its verdict by name ("multi-database" in clause 2) but loses "the Ingester already ships them" |
| "a budget-alarm gap" (clause 6) **and** "Budget alarms with a hard monthly cap are mandatory from the first deploy" (clause 7) | Either one alone keeps case 10. Cutting both flips it to defer as polish under the cost brake |
