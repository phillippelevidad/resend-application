# doc-map — where each fact lives, and how to reach it without reading everything

The `.ai/` docs are large and heavily cross-linked. Reading them end to end costs the context the writing phase needs, and the index tables are summaries that **never** substitute for the section they link. So navigate by anchor, and open the linked section whenever a decision turns on it.

Paths below are relative to the repo root.

## The one trick worth learning first

[`api-contract.md`](../../../../.ai/api-contract.md) entries each end with a `- **Slices:**` line naming the build-checklist slices that contribute to them. That line is a reverse index: one grep gives you every operation a slice owes, without reading the file whole. The endpoints, CLI commands and MCP tools that expose them are on the card's own `UI surfaces` line.

```bash
grep -n 'Slices:.*\b4 —' .ai/api-contract.md
```

Then read upward from each hit to the nearest `#### ` (an operation entry) and read that whole entry. Mind the two failure modes: a slice appearing **second** in the list (`6 — Reactions; 4 — Recovery`) means the entry is mostly a later slice's, and this slice owes only its named part; and an entry that names your slice with a caveat (`**Not slice 2**: …`) is telling you the opposite — read the caveat, it is usually the scope contract in miniature.

Beware `2` matching `2B` and vice versa: `2B`'s entries read `2B — Local-mode queue and docker compose`, so grep the exact string with its title fragment when the slice is a branch.

## Where each fact lives

| The pre-proposal needs | Read | How to get there |
| --- | --- | --- |
| The slice's scope contract | [`build-checklist.md`](../../../../.ai/build-checklist.md) | `grep -n '^### ' .ai/build-checklist.md`, then read the whole card. Headings are marker-free; `Status` is the first bullet |
| How to work a slice at all | [`build-checklist.md#how-to-work-this-checklist`](../../../../.ai/build-checklist.md#how-to-work-this-checklist) | Spine vs. parallel tracks, deploy and keep (one demo per milestone), the Ships done-list, and the `WALKTHROUGH.md` every slice owes |
| Why this slice is here, and what precedes it | [`architecture.md#build-order-vertical-slices`](../../../../.ai/architecture.md#build-order-vertical-slices) | Canonical ordering and rationale. The checklist is the progress layer over it, and owns neither |
| The ADRs the slice rests on | [`architecture.md`](../../../../.ai/architecture.md) | The card's `Refs` line links them by anchor. `grep -n '^### ADR-' .ai/architecture.md` for the full list |
| Whether a capability is deferred, and on what trigger | [`architecture.md#deferred-yagni`](../../../../.ai/architecture.md#deferred-yagni) | Sort by the stated reason: **temporal** → defer with a countable threshold or named event; **categorical** → reject, reopened only by a superseding ADR |
| Tables, columns, types, constraints | [`data-modeling.md`](../../../../.ai/data-modeling.md) | Start at [`#model-index`](../../../../.ai/data-modeling.md#model-index) for the table's **Stage** and **Modeled** box, then open its `### ` section for the field table and its rules |
| The fields every new table carries | [`data-modeling.md#base-fields--the-checklist-for-every-new-model`](../../../../.ai/data-modeling.md#base-fields--the-checklist-for-every-new-model) | Also `#modeling-conventions-canonical` and `#anti-patterns-must-not` |
| The unique key each write is idempotent on | [`data-modeling.md#idempotency-keys`](../../../../.ai/data-modeling.md#idempotency-keys) | `svix_id` for the ledger, `dedupe_key` for the outbox. Read it before any write the slice adds |
| How state is derived, and why order never comes from transport | [`architecture.md#adr-003--projection-is-a-pure-function-of-the-event-set`](../../../../.ai/architecture.md#adr-003--projection-is-a-pure-function-of-the-event-set) and [`data-modeling.md#projections-are-derived`](../../../../.ai/data-modeling.md#projections-are-derived) | Plus the table's own section. Projections are recomputed from the event set, never advanced by arrival |
| PII and retention duties | [`data-modeling.md#pii--retention`](../../../../.ai/data-modeling.md#pii--retention) and [`architecture.md#adr-014--raw-payload-retention-and-redaction`](../../../../.ai/architecture.md#adr-014--raw-payload-retention-and-redaction) | Both — the first is the modeling rules, the second is the retention decision |
| Surfaces — endpoints, CLI commands, MCP tools | The card's `UI surfaces` line, then [`pp-backend` → Surfaces](../../pp-backend/SKILL.md#surfaces--sdk-cli-mcp), [`pp-cli`](../../pp-cli/SKILL.md#output-and-exit-codes) and [`pp-mcp`](../../pp-mcp/SKILL.md#tool-registration-and-least-privilege) | One contract, many surfaces ([ADR-011](../../../../.ai/architecture.md#adr-011--one-contract-many-surfaces)) |
| Operations | [`api-contract.md`](../../../../.ai/api-contract.md) | The `Slices:` grep. Reads live under `## Read operations`, `operate`-scoped writes under `## Operate operations`, the webhook endpoint under `## Ingest boundary` |
| Auth, scopes, idempotency, errors, pagination, versioning | [`api-contract.md#conventions`](../../../../.ai/api-contract.md#conventions) | Read once per pre-proposal; these bind every operation the slice adds |
| Error codes, their statuses and who raises them | [`api-contract.md#error-codes`](../../../../.ai/api-contract.md#error-codes) | The only list. A new or changed code is a public-contract change (Ask first) |
| The capability the slice delivers, in product terms | [`features.md`](../../../../.ai/features.md) | The card's `Refs` links the journey. [`#adopter-lifecycle`](../../../../.ai/features.md#adopter-lifecycle) is the stage table the self-service test is argued against |
| Personas, vocabulary, non-goals, scale ceiling | [`about.md`](../../../../.ai/about.md) | `#target-personas`, `#domain-vocabulary`, `#non-goals--out-of-scope`, `#platform-scale-assumptions`, `#risk-appetite` |
| Resend behaviour the slice relies on | [`resend.md`](../../../../.ai/resend.md) | Cite the `RS-*` fact. A row under [`#unverified`](../../../../.ai/resend.md#unverified) is an open question, not a fact |
| AWS limits, idle cost, teardown | [`aws.md`](../../../../.ai/aws.md) | [`#cost-shape`](../../../../.ai/aws.md#cost-shape), [`#budget-alarms`](../../../../.ai/aws.md#budget-alarms), [`#teardown`](../../../../.ai/aws.md#teardown) |
| Resend discipline, secrets layout, the Postgres host | [`integrations.md`](../../../../.ai/integrations.md) | [`#locked-rules-must`](../../../../.ai/integrations.md#locked-rules-must) before any slice that calls Resend |
| What is genuinely unsettled | [`about.md#open-questions`](../../../../.ai/about.md#open-questions) | Count the bullets at read time. If a slice depends on one, say so — do not settle it here |
| The decision lens and the self-service test | [`AGENTS.md`](../../../../AGENTS.md#decision-lens--evidence-over-claims-right-sized) and [`about.md#guiding-principles`](../../../../.ai/about.md#guiding-principles) | The verdicts it must reproduce: [`decision-lens-suite.md`](../../../../.ai/decision-lens-suite.md) |

## Reality-check recipes — what the repo already contains

Run these in phase 2. Each answers one question, cheaply.

| Question | Recipe |
| --- | --- |
| Does the table exist? | `grep -rn 'pgTable(' packages/db/` — then read the table for the columns actually present, not just its name |
| Does the migration exist, and what does it already do? | List the migrations folder under `packages/db/` (chronological), then grep it for the table name. The unique keys idempotency rests on (`svix_id`, the outbox `dedupe_key`) must be in the migration, not only in the schema file |
| Is the idempotency key in place for it? | `grep -rn 'PRIMARY KEY\|UNIQUE' <migrations folder> \| grep <table>` |
| Does the project folder exist? | `ls packages/ apps/` — projects are folders (`core/`, `db/`, `resend-client/`, `ingest/`, `worker/`, `reconciler/`, …). Then `ls` the project for its layout |
| Does the operation already exist? | `grep -rn '<operationName>' packages/ apps/ --include=*.ts` and check its entry in `.ai/api-contract.md` |
| Is the capability already specified? | `find openspec/specs -name spec.md` — the directory path **is** the capability path. An existing one means the delta is `MODIFIED`, a missing one means `ADDED` |
| What did the previous slices actually ship? | `ls openspec/changes/archive/` — read the nearest slice's `proposal.md`, `design.md` and `tasks.md` for the house shape and for decisions already taken |
| Is a change already open on this? | `ls openspec/changes/` — anything outside `archive/` is in flight |
| Does the surface exist? | `ls apps/api apps/cli apps/mcp` — the read-API route, CLI command or MCP tool, scoped to the surface the card names |
| Is the shared client there? | `ls packages/sdk` — an SDK without the method means the slice pays for the method its CLI command or MCP tool needs |

Two things to look for beyond existence:

- **Partial implementations.** A table in the Drizzle schema with no migration, or a migration missing the unique key idempotency rests on, is the shape that reads as "done" in an index and fails in a duplicate-delivery test. Report `file:line` and what is missing.
- **Decisions already taken in code.** Where the code and the docs disagree, that is a phase-3 contradiction, and the archived `proposal.md` files show the house pattern for recording it: a "Where the code is right and the docs are wrong" section, with the doc update owed.

## What not to read

- Do not read `data-modeling.md`, `api-contract.md`, `resend.md` or `aws.md` end to end. They run long; anchors and the `Slices:` grep get you the same facts for a fraction of the context.
- Do not read `node_modules`, generated code (`cdk.out`, Drizzle migration snapshots), or migration SQL you are not checking a specific fact in.
- Do not summarize a `pp-*` skill or an `.ai/` section through a sub-agent. Their exact wording binds, and the summary drops it.
