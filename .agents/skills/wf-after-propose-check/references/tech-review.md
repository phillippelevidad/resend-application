# tech-review — reviewing a design against skills written to review a diff

The `pp-*` skills are the binding technical conventions, and every one of them is written for a reader holding a **diff**: *"then read the diff — base fields present, a unique constraint behind every idempotency key…"*. Pass 3 has no diff. It has a design that will become one.

**So read the design as the diff it becomes.** For each surface the change touches, load that skill and run two of its sections against the artifacts:

- its **`Never` list** — short, concrete, each prohibition already naming the correct alternative. A design that commits to one of these is [A2](findings.md): a departure, which is allowed only if argued.
- its **gate's "then read the diff" checklist** — the properties the finished code must have. A design that leaves one of them undecided is [A3](findings.md): not forbidden, just not decided, and the builder will decide it alone at 2am.

You are not inventing a review standard. You are applying one that is already written, prioritised, and binding.

## Routing — which skills the change earns

Read the change's **Impact** section and its task groups, then load every row that matches. Loading too few is the failure mode; a skill costs one read and catches a class of defect. This table maps what a design says to the skill; the path routing it mirrors is [pp-workflow → Which skill answers a code question](../../pp-workflow/SKILL.md#which-skill-answers-a-code-question), which wins if the two disagree.

| Load | When the change touches |
| --- | --- |
| [`pp-workflow`](../../pp-workflow/SKILL.md) | Always — read order, slice scoping, the `pnpm verify` gate, doc duties, test tiers, Ask-first, skill routing |
| [`pp-general`](../../pp-general/SKILL.md) | Always, when the change writes TypeScript — naming, imports, boundaries, adding a dependency or package, errors, logging, PII in code, config and env |
| [`pp-database`](../../pp-database/SKILL.md) | Any table, column, closed set, index, constraint, grant, `jsonb` column, or migration |
| [`pp-backend`](../../pp-backend/SKILL.md) | Anything under `packages/` or `apps/` outside `packages/db`, `apps/cli` and `apps/mcp` — a Lambda handler, projection, port, outbox reaction, reconcile or redrive path, a read-API route, `resend-client` — **and** the SDK and the rules every surface shares: an error `message` or `hint`, masks, one contract |
| [`pp-testing`](../../pp-testing/SKILL.md) | Any test the change promises, the Postgres harness, a fake, an arbitrary, or `sim/` |
| [`pp-infra`](../../pp-infra/SKILL.md) | `infra/`, a Lambda, queue, secret, schedule, alarm or log group, a deploy, teardown or AWS-facing script |
| [`pp-cli`](../../pp-cli/SKILL.md) | `apps/cli` — a command, flag, output format or exit code |
| [`pp-mcp`](../../pp-mcp/SKILL.md) | `apps/mcp` — a tool, its registration, annotations or output |

Where two rules collide, the [decision-lens tie-break](../../../../AGENTS.md#decision-lens--evidence-over-claims-right-sized) decides: correctness of event handling (no loss, no duplicate effects, order-independent state) outranks everything else.

The script's `patterns` check trips a handful of these by keyword, but it greps prose — it cannot tell a design that *does* the forbidden thing from one that names it while rejecting it. Treat every `patterns` finding as a pointer to read, and never treat a silent `patterns` section as evidence that a surface is clean.

## The ADR pass

Separately from the skills, walk every ADR in [`architecture.md`](../../../../.ai/architecture.md) the change touches — **whether or not `design.md` cites it.** A design citing no ADR is not outside the ratified set; it is one nobody checked against it.

Three questions per ADR:

1. **Does the design conform?** Quote the ADR's binding wording and compare.
2. **If not, is the departure argued?** [The OpenSpec design rule](../../../../openspec/config.yaml): *"If the design must depart from one, say so explicitly and propose superseding it — never diverge silently."* An argued departure is a decision. A silent one is [A2](findings.md).
3. **Does it need a doc edit?** A departure, a clarification, or a tripwire the change retires all become **tasks** in `tasks.md`. Never edit `.ai/` from this skill.

Also check the [Deferred (YAGNI)](../../../../.ai/architecture.md#deferred-yagni) table: a **categorical** reject that the design quietly builds (SQS FIFO, a second database, multi-tenant) is reopened only by a superseding ADR, not by a design document. A **temporal** deferral being pulled forward needs a reason the lens allows — build cost or testability, never adopter or reviewer harm in the gap between slices.

---

## Schema — `pp-database`

The [new-table recipe](../../pp-database/SKILL.md#new-table-recipe) is the checklist; the design either answers it or leaves the builder to.

| Read the design for | The defect when it is silent |
| --- | --- |
| Base fields on every new table | A table that cannot be audited or deduped later without a migration against rows |
| Every idempotency key (`svix_id`, the outbox `dedupe_key`) backed by a **unique constraint**, never a read-then-insert | The duplicate-insert test is the mandatory proof; a key enforced only in code passes review and duplicates under concurrency |
| Each unique constraint's columns matching the identity it protects | A uniqueness rule that is accidentally too wide or too narrow — two recipients of one email collapsing into one row |
| Every column's **nullability**, every closed set's **members and their meanings** (`text` + `CHECK`) | The migration needs both, so an unstated nullable is a decision the builder makes alone |
| Each index and the query it serves | An index nobody needs, or a query with none |
| FKs and `onDelete` behaviour | A cascade onto `webhook_events`, or any FK between the ledger and a projection |
| The DML-only runtime role's grants for the new table (integrations.md → Runtime role) | Working locally as superuser, failing as the runtime role |
| Backfill **failure** behaviour, stated | "Backfill from X" with no answer for a row where X is absent. It must fail loudly, not invent a value |
| The Drizzle schema in `packages/db` as the source of truth, migrations expand/contract | A hand-edited generated migration, or a contract step that needs downtime |
| The **Model index** `Modeled` checkbox as a task | The only place "is this table real yet?" is answerable |

Then walk [`pp-database` → Never](../../pp-database/SKILL.md#never) entry by entry against the design. Read it there, never from a copy: the list is the binding text and it changes.

## Backend — `pp-backend`

| Read the design for | The defect when it is silent |
| --- | --- |
| The ledger insert, the projection upsert and the outbox row inside **one transaction**, with the transactional client passed down | A write outside that transaction, which reads as fine and diverges on the first crash |
| Every webhook verified **before** it is enqueued; every read-API call authenticated before it runs | An unverified payload reaching the queue, where nothing underneath catches it |
| Projections computed by pure `packages/core` functions over the event set | State that depends on arrival order, which Resend never promises |
| Every side effect as an outbox row **in the same transaction** | A notification that fires and a commit that does not, or the reverse |
| Every handler idempotent on `svix_id` or the outbox `dedupe_key` | At-least-once delivery is the contract, so "it will only run once" is not a design |
| No Resend API call outside `packages/resend-client`; the port named | An SDK call inside a handler, which cannot be tested without the vendor and bypasses the shared rate limit |
| No app importing from another app; `packages/core` free of I/O | The import graph is the boundary check and it is greppable |
| List reads on the standard envelope | A second pagination shape reaching the SDK |
| SQS for delivery, Postgres for truth, **only** | A second queue, a cache or a FIFO ordering standing in as source of truth or ordering guarantee |
| The [api-contract.md](../../../../.ai/api-contract.md) entry and the owner's Ask-first approval for any contract change, as tasks | An operation, error code, CLI flag or MCP tool that ships without its contract entry, so the SDK and the docs drift from the code |

Watch specifically for the **read-then-write** shape: a cap, a quota, or a uniqueness rule enforced by counting first. Two concurrent submits both pass it. The constraint decides, never a read.

## Surfaces — `pp-backend`, `pp-cli`, `pp-mcp`

[`pp-backend` → Surfaces](../../pp-backend/SKILL.md#surfaces--sdk-cli-mcp) binds the SDK and the rules every surface shares. [`pp-cli` → Output and exit codes](../../pp-cli/SKILL.md#output-and-exit-codes) owns the CLI's, and [`pp-mcp` → Tool registration and least privilege](../../pp-mcp/SKILL.md#tool-registration-and-least-privilege) the MCP server's.

| Read the design for | The defect when it is silent |
| --- | --- |
| Reads and operate calls through `packages/sdk`, never the database | A CLI command or MCP tool doing business logic; the CLI and MCP server are presentation and orchestration only |
| The caller's scope resolved server-side from its bearer token, never from a client-supplied value | A client-supplied identifier reaching the API with the server's authority |
| A written `message` and `hint` per failure, each mapped to a code in the [registry](../../../../.ai/api-contract.md#error-codes) | Every refusal rendering as one generic message, or a code invented outside the registry |
| Timestamps and counts formatted at one layer | The CLI, the SDK and the MCP server each formatting the same timestamp differently |
| Operate MCP tools registered only with an `operate` token **and** `--enable-operate` | An MCP tool that can replay or redrive on the day it ships |
| CLI exit codes `0` / `1` / `2` and `--json` on every failure path | A thrown read crashing the whole CLI with a stack trace |
| Masks only, never raw PII, on every surface, MCP tool output included | A recipient address reaching a terminal or an agent's context |

---

## Writing the finding

Every technical finding lands the same way, and the shape matters because the builder reads it, not you:

1. **What the design commits to**, quoted from the artifact.
2. **The rule it meets**, quoted from the skill or the ADR, with its anchor.
3. **The cheapest correct alternative** — every `Never` entry already names one; use it rather than inventing a third option.
4. **Where the repair goes**: the behaviour in the spec, the mechanism in `design.md`, the ordering and the check clause in `tasks.md`.

If the correct alternative is genuinely more expensive and both paths are lawful, that is rung 5 — the owner round — not a repair. Say what each costs and which you would take.
