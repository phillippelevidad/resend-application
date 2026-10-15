# tech-review — reviewing a design against skills written to review a diff

The `pp-*` skills are the binding technical conventions, and every one of them is written for a reader holding a **diff**: *"then read the diff — base fields present, a unique constraint behind every idempotency key…"*. Pass 3 has no diff. It has a design that will become one.

**So read the design as the diff it becomes.** For each surface the change touches, load that skill and run two of its sections against the artifacts:

- its **`Never` list** — short, concrete, each prohibition already naming the correct alternative. A design that commits to one of these is [A2](findings.md): a departure, which is allowed only if argued.
- its **gate's "then read the diff" checklist** — the properties the finished code must have. A design that leaves one of them undecided is [A3](findings.md): not forbidden, just not decided, and the builder will decide it alone at 2am.

You are not inventing a review standard. You are applying one that is already written, prioritised, and binding.

## Routing — which skills the change earns

Read the change's **Impact** section and its task groups, then load every row that matches. Loading too few is the failure mode; a skill costs one read and catches a class of defect.

| Load | When the change touches |
| --- | --- |
| [`pp-workflow`](../../pp-workflow/SKILL.md) + [`pp-general`](../../pp-general/SKILL.md) | Always — read order, slice scoping, the `pnpm verify` gate, doc duties, Ask-first, naming, boundaries, the YAGNI test, test tiers, error shape, logging, PII |
| [`pp-database`](../../pp-database/SKILL.md) | Any table, column, enum, index, constraint, `jsonb` column, migration, or seed edit |
| [`pp-backend`](../../pp-backend/SKILL.md) | Anything under `apps/` or `packages/` — a Lambda handler, schema, command, reader, projection, repository, port, adapter, outbox event, worker handler, module |
| [`pp-frontend`](../../pp-frontend/SKILL.md) | Any user-facing surface — `apps/cli`, `apps/mcp`, `packages/sdk` — a command, flag, tool, output format |
| [`pp-ux-copy`](../../pp-ux-copy/SKILL.md) | Any screen, state, CLI or MCP message, or error `hint` named anywhere in the change |
| [`pp-money`](../../pp-money/SKILL.md) | Checkout, order, payment, split, payout, commission, promotion, fiscal document, reconciliation, return, dispute, `billing_*`. **It constrains the two above and wins where they collide** |

The script's `patterns` check trips a handful of these by keyword, but it greps prose — it cannot tell a design that *does* the forbidden thing from one that names it while rejecting it. Treat every `patterns` finding as a pointer to read, and never treat a silent `patterns` section as evidence that a surface is clean.

## The ADR pass

Separately from the skills, walk every ADR in [`architecture.md`](../../../../.ai/architecture.md) the change touches — **whether or not `design.md` cites it.** A design citing no ADR is not outside the ratified set; it is one nobody checked against it.

Three questions per ADR:

1. **Does the design conform?** Quote the ADR's binding wording and compare.
2. **If not, is the departure argued?** [The OpenSpec design rule](../../../../openspec/config.yaml): *"If the design must depart from one, say so explicitly and propose superseding it — never diverge silently."* An argued departure is a decision. A silent one is [A2](findings.md).
3. **Does it need a doc edit?** A departure, a clarification, or a tripwire the change retires all become **tasks** in `tasks.md`. Never edit `.ai/` from this skill.

Also check the [Deferred (YAGNI)](../../../../.ai/architecture.md#deferred-yagni) table: a **categorical** reject that the design quietly builds (Kafka, microservices, SQS FIFO, a second database) is reopened only by a superseding ADR, not by a design document. A **temporal** deferral being pulled forward needs a reason the lens allows — build cost or testability, never integrator harm in the gap.

---

## Schema — `pp-database`

The new-table recipe is the checklist; the design either answers it or leaves the builder to.

| Read the design for | The defect when it is silent |
| --- | --- |
| Base fields on every new table | A table that cannot be audited, versioned or deduped later without a migration against rows |
| Every idempotency key (`svix_id`, the outbox `dedupe_key`) backed by a **unique constraint**, never a read-then-insert | The duplicate-insert test is the mandatory proof; a key enforced only in code passes review and duplicates under concurrency |
| Each unique constraint's columns matching the identity it protects | A uniqueness rule that is accidentally too wide or too narrow — two recipients of one email collapsing into one row |
| Every column's **nullability**, every enum's **members and their meanings** | The migration needs both, so an unstated nullable is a decision the builder makes alone |
| Each index and the query it serves | An index nobody needs, or a query with none |
| FKs and `onDelete` behaviour | `Cascade` across an aggregate boundary, or onto a ledger or audit row |
| The app role's grants for the new table **and its enums** | Working locally as superuser, failing as the app role |
| Backfill **failure** behaviour, stated | "Backfill from X" with no answer for a row where X is absent. It must fail loudly, not invent a value |
| The seed extended **before** the migration that reads it | The backfill blocks mid-apply on a fresh database |
| The Drizzle schema in `packages/db` as the source of truth, migrations expand/contract | A hand-edited generated migration, or a contract step that needs downtime |
| The **Model index** `Modeled` checkbox as a task | The only place "is this table real yet?" is answerable |

Its `Never` list in one line each: business logic in a trigger or procedure · a DB view as an API · `Cascade` across aggregates or onto ledger/audit rows · updating or deleting a `webhook_events` row outside the retention job · state or unbounded arrays in JSON · a `status` string standing in for a state machine · a stored projection that cannot be recomputed from the event set · editing an applied migration.

## Backend — `pp-backend`

| Read the design for | The defect when it is silent |
| --- | --- |
| The ledger insert, the projection upsert and the outbox row inside **one transaction**, with the transactional client passed down | A write outside that transaction, which reads as fine and diverges on the first crash |
| Every webhook verified **before** it is enqueued; every read-API call authenticated before it runs | An unverified payload reaching the queue, where nothing underneath catches it |
| Every state move as a **named command driving one persisted transition** | A mutation that is not a transition; a generic transition endpoint; a `state` written directly |
| Every side effect as an outbox row **in the same transaction** | A notification that fires and a commit that does not, or the reverse |
| Every handler idempotent on `svix_id` or the outbox `dedupe_key` | At-least-once delivery is the contract, so "it will only run once" is not a design |
| No Resend API call outside `packages/resend-client`; the port named | An SDK call inside a handler, which cannot be tested without the vendor and bypasses the shared rate limit |
| No app importing from another app; `packages/core` free of I/O | The import graph is the boundary check and it is greppable |
| List reads on the standard envelope | A second pagination shape reaching the SDK |
| SQS for delivery, Postgres for truth, **only** | A second queue, a cache or a FIFO ordering standing in as source of truth or ordering guarantee |
| The OpenAPI surface re-exported and the client in `packages/sdk` regenerated, as a task | The drift check is what makes a contract change mechanically enforced; skipping it makes the next omission a runtime error |

Watch specifically for the **read-then-write** shape: a cap, a quota, or a uniqueness rule enforced by counting first. Two concurrent submits both pass it. The constraint decides, never a read.

## Frontend — `pp-frontend`, `pp-ux-copy`

| Read the design for | The defect when it is silent |
| --- | --- |
| Reads and mutations through `packages/sdk`, never the database | A CLI command or MCP tool doing business logic; the CLI and MCP server are presentation and orchestration only |
| The caller resolved server-side from its credential, never from a client-supplied header | A client-supplied identifier reaching the API with the server's authority |
| Every view: actor, scope, reads, actions, and **all four states** — empty, loading, error, success | A missing empty state, which is the first state every new integrator sees |
| The user-facing copy **written**, not described | "An appropriate message" is a screen invented at 2am. `pp-ux-copy`'s vocabulary is binding and its forbidden terms are forbidden |
| API-error → `code`/`hint` mapping named per failure | Every backend refusal rendering as one generic message |
| Timestamps and counts formatted at one layer | The CLI, the SDK and the MCP server each formatting the same timestamp differently |
| Read-only by default where a surface must not mutate; the a11y floor | An MCP tool that can replay or rotate a secret on the day it ships |
| Exit codes and the error shape on every failure path | A thrown read crashing the whole CLI with a stack trace |

## Money — `pp-money`, and it wins

If the change touches the money path at all, this section is not optional and it overrules the two above.

| Read the design for | The defect when it is silent |
| --- | --- |
| Idempotency on every create / capture / refund, with the key persisted and unique | A double charge that no test would have caught |
| Integer minor units, `bigint`, everywhere | A float anywhere on the path |
| Totals **derived from line items**, never stored bare | A stored total that drifts from the rules that produced it |
| Provider responses captured immutably | A reconciliation that cannot be reconstructed |
| Optimistic concurrency (`version`) on money-bearing aggregates | Two writers, one lost update, real money |
| Reversals as new entries, never edits | An audit trail that cannot be trusted |
| Fiscal duties named, or explicitly `Not touched — <why>` | Silence where a tax document is owed |

A change that touches only **platform billing** — the platform billing its own accounts — is a distinct bounded context from the end user's money path, and the design should say so plainly. It is still integer minor units, still terms captured rather than referenced live, still a new row rather than an edit for a price change.

---

## Writing the finding

Every technical finding lands the same way, and the shape matters because the builder reads it, not you:

1. **What the design commits to**, quoted from the artifact.
2. **The rule it meets**, quoted from the skill or the ADR, with its anchor.
3. **The cheapest correct alternative** — every `Never` entry already names one; use it rather than inventing a third option.
4. **Where the repair goes**: the behaviour in the spec, the mechanism in `design.md`, the ordering and the check clause in `tasks.md`.

If the correct alternative is genuinely more expensive and both paths are lawful, that is rung 5 — the owner round — not a repair. Say what each costs and which you would take.
