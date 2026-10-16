# diff-review — what to read, what to skip, and the checklist per surface

Pass 4 is the only pass whose cost scales with the size of the diff, so it is the only one that needs a spending rule. Two decisions make it affordable: **read nothing that was generated**, and **split by surface rather than by lens** so the diff is read once instead of four times.

## What not to read

A large share of any diff in this repo is byproduct — a file that changed *because* something else changed, carrying no decision of its own. Reading it costs tokens and finds nothing, and worse, it dilutes the reading budget for the files that do carry decisions.

**Never read these; the script excludes them from every worklist:**

| Excluded | Why |
| --- | --- |
| `pnpm-lock.yaml`, `package-lock.json`, `yarn.lock` | A dependency decision is visible in `package.json`; the lock is its shadow |
| `packages/db/(drizzle\|migrations)/meta/**` (Drizzle snapshots and journal) | Emitted by `drizzle-kit` from the `pgTable` schema. The schema and the migration SQL are the reviewable things |
| `cdk.out/**` | Synthesized CloudFormation. Review the CDK app in `infra/` |
| `**/dist/**`, `**/build/**`, `**/.turbo/**`, `**/coverage/**`, `**/node_modules/**` | Build output |
| `*.snap`, `*.min.js`, `*.map`, `*.tsbuildinfo` | Derived artifacts |
| `*.png *.jpg *.jpeg *.gif *.webp *.avif *.ico *.svg *.woff *.woff2 *.ttf *.pdf` | Binary or asset content; a diff tool has nothing useful to say about it |

**But do not drop them silently — they are evidence.** Their *presence or absence* answers duty questions the reading cannot:

- Drizzle `meta/` changed while the `packages/db` schema changed → a migration was generated; read its SQL. Schema changed and no migration was added → [B4](findings.md), and the script raises it as a BLOCK. A `meta/` change with no schema change → someone ran the generator by hand or edited a snapshot; find out which.
- `pnpm-lock.yaml` changed → a dependency moved. That is **Ask-first**; confirm it was approved (one at a time, or named with its version range on the pre-proposal's itemized list), and read the `package.json` line, not the lock.
- A new binary asset appeared → check where it is served from and whether it belongs in the repo at all.

So: **count them, name them in one line, and read none of them.**

## Splitting the work

The script's `surfaces` worklist buckets the readable diff five ways. Hand each helper **one bucket and one section of this file**, verbatim, in a single wave. Under ~800 readable lines, skip the helpers and read it yourself — the coordination costs more than the reading.

### The brief to hand each helper

Paste this, filling the three slots. Do not paraphrase it; the constraints are what keep the finding usable.

```
You are reviewing one surface of an implemented change in this repo.
Read-only: do not edit, do not commit, do not run the test suite.

Surface: <schema | backend | infra | sdk-cli-mcp | tests-docs>
Files:   <the file list from the `surfaces` worklist — these only, nothing else>
Base:    git diff <base>...HEAD -- <those paths>

Apply both checklists below to every changed file. Report ONLY findings you can point at.

<paste the two tables for that surface from diff-review.md>

For each finding, return exactly:
  file:line · what breaks, and the input or caller that breaks it · the rule or the reasoning ·
  the cheapest fix you can see
Rank by blast radius: a lost event or a duplicate side effect first, then state that depends on arrival order, then wrong behaviour, then everything else.
No summary, no praise, no restating the file's purpose. If a file is clean, say nothing about it.
A finding you are unsure of is still worth reporting — say "unsure" and say why.
Do not read any file outside your list, and do not read `.ai/` docs or `.agents/skills/` — the
coordinator holds those and their exact wording is what binds.
```

**Every returned finding is a lead, not a fact.** Open the `file:line` yourself before it becomes a commit. Helpers read a slice of the world with no plan in front of them; they will report things the design already settled, and they will occasionally be confidently wrong.

---

## Schema — `packages/db/**` (the Drizzle `pgTable` schema, migrations under `packages/db/drizzle/`, seeds)

Load [`pp-database`](../../pp-database/SKILL.md). Its [new-table recipe](../../pp-database/SKILL.md#new-table-recipe) is the checklist the schema and migration either satisfy or do not; its [`Never` list](../../pp-database/SKILL.md#never) and [data-modeling.md → Anti-patterns](../../../../.ai/data-modeling.md#anti-patterns-must-not) are the hard edges.

### Correctness

| Read for | The bug when it is absent |
| --- | --- |
| [Base fields](../../../../.ai/data-modeling.md#base-fields--the-checklist-for-every-new-model) on every new table — `updated_at` on mutable rows only, never on `webhook_events` | A table that cannot be audited or deduped later without a migration against live rows, or an append-only table that pretends it mutates |
| Every column's nullability matching the code that writes it | A `NOT NULL` the command never sets, or a nullable the reader assumes present |
| Every closed set as `text` + `CHECK`, its members matching the Zod enum in `packages/core` and every value the code writes; no `pgEnum`; no `CHECK` on `webhook_events.type` | A write that fails at runtime on a value the `CHECK` does not carry, or an unknown event type rejected instead of stored |
| Every idempotency key (`svix_id`, `dedupe_key`) backed by a primary key or unique constraint, on exactly the columns the key means | A dedupe that is accidentally too narrow or too wide — the same event stored twice, or two distinct reactions collapsed into one |
| `NULLS NOT DISTINCT` where two nulls must collide, plain where they must not | The subtlest constraint bug there is, and it only appears with real data |
| No foreign key or cascade between `webhook_events` and a projection | A cascade that deletes history, or a projection that can no longer be rebuilt from the ledger alone |
| Each index serving a query that exists, and each hot query having one | A sequential scan on the table the read API hits on every request |
| Every projection column with a source in the event set | A column nothing can recompute, so a rebuild silently loses it |
| Backfill **failure** behaviour, stated and implemented | "Backfill from X" with no answer for a row where X is absent. It must fail loudly, not invent a value |
| Seeds and fixtures covering ≥2 emails with interleaved events | Order-independence tests pass because there is only one email |
| Expand/contract: the migration is safe to run before the code that needs it ([ADR-018](../../../../.ai/architecture.md#adr-018--migrations-run-from-the-deploy-command-before-the-code-that-needs-them)) | A deploy that breaks the running version between the migration and the code |
| A migration for every schema change, generated from the `pgTable` schema | The script raises this as a BLOCK; the schema and the database disagree on the next deploy |

### Security

| Read for | The hole when it is absent |
| --- | --- |
| The DML-only runtime role (integrations.md → Runtime role) granted the **narrowest** privileges each new table needs (`GRANT … ON <table> … TO`) | Works locally as superuser and fails as the deployed role — or an append-only table that silently accepts an `UPDATE` |
| No raw address, subject or display name in any column other than `webhook_events.payload` — `dedupe_key`, `outbox.payload` and `last_error` included; addresses as `address_hash` (keyed HMAC) + `address_masked` | PII copied into every projection and every reaction row, beyond the retention job's reach |
| No unkeyed hash of an address and no plaintext token at rest | A plain SHA-256 of an address is reversible by dictionary |
| `jsonb` only for the raw event payload, the outbox payload and the local queue envelope | A `jsonb` field a query filters on or a projection reads, which no constraint can check |
| No business logic in a trigger or stored procedure, and no view used as an API | Logic that the pure core and its property tests never see |
| No secret, API key or real recipient address in a table, seed, fixture or migration — Resend test addresses only | A credential or a real person's address in a public repo's history |
| All SQL pooler-safe ([integrations.md → Decision — Neon](../../../../.ai/integrations.md#decision--neon)) | A session-level feature that works against a direct connection and breaks behind the pooler |
| No edit to a frozen migration: merged to `main` or applied to a kept database ([`pp-database` → Never](../../pp-database/SKILL.md#never)) | A forward migration is the only fix; changing the frozen one is Ask-first. The script raises an edited migration already on the diff base as a BLOCK; one this change added is regenerated freely |

---

## Backend — `apps/**`, `packages/**`, `scripts/` (minus `packages/db`, `packages/sdk`, `apps/cli`, `apps/mcp`)

Load [`pp-backend`](../../pp-backend/SKILL.md) for `apps/**` and `packages/**`; root `scripts/` is [`pp-general`](../../pp-general/SKILL.md)'s alone.

### Correctness

| Read for | The bug when it is absent |
| --- | --- |
| Every worker query inside the one ledger transaction, with the **transactional client** passed all the way down | A query that escapes the transaction reads outside the `FOR UPDATE` lock on the email. It looks correct and it loses updates |
| A **constraint**, not a read, deciding every cap, quota and uniqueness rule | The read-then-write race: two concurrent submits both count `n-1` and both insert |
| Every projection row written by recomputing it from the event set, never patched (`SET status = $new`) | A `status` that reflects the last message processed rather than the events stored |
| Every side effect as an **outbox row in the same transaction** | The notification fires and the commit does not, or the reverse |
| Every worker handler idempotent on `dedupe_key`; every outbound Resend send carrying an idempotency key derived from it | At-least-once is the delivery contract. "It will only run once" is not a design |
| The whole write inside one transaction where two tables must agree | A half-written aggregate that no test with one row will ever produce |
| Error shape: the one `{ error: { code, message, hint, docs } }` shape, validation through Zod | A hand-rolled error body the SDK, the CLI's `--json` and the MCP tools cannot read |
| List reads on the standard pagination envelope ([api-contract.md → Conventions](../../../../.ai/api-contract.md#conventions)) | A second pagination shape the SDK, the CLI and the MCP tools each have to special-case |
| No Resend API call outside `packages/resend-client` | A call that bypasses the shared rate-limit budget, untestable without the vendor |
| No app importing another app; nothing in `packages/core` importing AWS, Postgres or Resend | The import graph is the boundary check, and it is greppable |
| SQS for delivery and Postgres for truth, **only** | A cache, a second queue or an in-memory map treated as source of truth |
| Projections as a pure function of the event **set**, folded in `(event_created_at, rank(type), svix_id)` order, never by row time | State decided by arrival order: a late `email.delivered` overwriting an earlier `email.bounced` |

### Security

| Read for | The hole when it is absent |
| --- | --- |
| Every command **authorized before it runs**, on the caller's scope — especially an `operate` command | The check that was assumed to live in the guard and lives nowhere |
| A guard that checks the right thing — read the predicate, not the decorator | A guard that runs, passes, and asserts the wrong scope |
| The caller's scope (`read` / `operate`) resolved server-side from its bearer token, never from a body, query or header | A client that grants itself `operate` |
| Every request body through a Zod schema, with bounds on anything unbounded | An array field with no max, an integer with no range |
| No raw SQL built by concatenation; Drizzle's `sql` template parameterised, `sql.raw(` and `.unsafe(` absent or fed only constants | Injection |
| No PII in a log, span, error message, outbox payload, `last_error` or URL | Log `svix_id` plus `email_id` and look the record up |
| No secret in the tree; every credential from env or Secrets Manager | A key in a fixture is a key in the history |
| Webhook handlers verifying their signature against the **raw** body, with every active secret and the timestamp tolerance, before enqueueing | An endpoint anyone can post to, or one that verifies a re-serialised body |

---

## Infra — `infra/**`

Load [`pp-infra`](../../pp-infra/SKILL.md). Walk its [`Never` list](../../pp-infra/SKILL.md#never) and its gate against the diff, and check every property in [Cost brake in code](../../pp-infra/SKILL.md#cost-brake-in-code) still has its `Template` assertion. A cost-brake property with no assertion is a [budget-alarm-class gap](../../../../AGENTS.md#decision-lens--evidence-over-claims-right-sized) (lens clause 6), not polish. Creating or deploying an AWS resource is Ask-first.

### Correctness

| Read for | The bug when it is absent |
| --- | --- |
| Every function built by the one shared function construct: `NodejsFunction`, local esbuild, ES modules, `nodejs24.x`, arm64, AWS SDK bundled ([bundling](../../pp-infra/references/cdk-app.md#bundling)) | One function on the default runtime, on x86, bundled in Docker or on the runtime's SDK, so a cost-brake property silently misses it |
| Every [cost-brake property](../../pp-infra/SKILL.md#cost-brake-in-code) with its `Template` assertion, paired with a count, numbers from the stack's named constants | A property that drifts on the next change with nothing red, or an "all resources" assertion that passes on a template with none |
| The visibility timeout derived from the worker timeout and batching window, never a literal (AWS-08); the worker mapping's batch size, `MaximumConcurrency` and `ReportBatchItemFailures` (ADR-008); DLQ retention above the source's (AWS-09) | A redelivery mid-run, a whole batch retried or deleted on one failure, or dead-lettered messages expiring first |
| Every Postgres-touching schedule on the one hourly cron, window `OFF`, explicit retry policy ([Cadence](../../../../.ai/integrations.md#cadence-and-the-database)) | A tick that keeps Neon awake past the wake budget |
| The guardrails stack importing nothing from the app stack, and holding the budget, trip topic, kill switch and its `Errors` alarm ([Budget alarms](../../../../.ai/aws.md#budget-alarms)) | A budget-alarm gap on the next app redeploy, or a kill switch that fails silently (lens clause 6) |
| The deploy command's order: refuse while tripped, ensure the role, migrate, guardrails then app, restore a pause ([ADR-018](../../../../.ai/architecture.md#adr-018--migrations-run-from-the-deploy-command-before-the-code-that-needs-them)); each scripted step reads state first and a failed step exits non-zero | Code ahead of its schema, a redeploy that re-enables a paused source, or a re-run that double-applies |
| Log groups explicit with retention and `DESTROY`; secrets `DESTROY`; no `logRetention` (AWS-38, AWS-40) | A teardown that leaves billable log groups or secrets |

### Security

| Read for | The hole when it is absent |
| --- | --- |
| No secret value in an env var, the template or `cdk.out/`: ARNs only, read by the function's own grant ([Secrets layout](../../../../.ai/integrations.md#secrets-layout), [CBL-01](../../../../.ai/check-before-launch.md#deploy-configuration)) | A signing secret or database URL readable by anyone with Lambda read access |
| IAM by grant methods, per function, only what it uses; the kill switch scoped to stack-prefixed ARNs | One function able to read every secret, or a kill switch able to touch another stack |
| No account id, ARN literal, `fromLookup` or deploy input in a tracked file ([CBL-10, CBL-19](../../../../.ai/check-before-launch.md#public-repo-hygiene)) | An account id or alert address in a public repo's history |
| Scripts spawn the CDK CLI with an argument array, never a shell string; AWS calls only through `@ledger/aws` | Shell injection through a deploy input, or `@aws-sdk/*` outside `packages/aws` |
| Every new AWS resource, deploy and AWS-facing run owner-approved | An Ask-first change made alone |

---

## Surfaces — SDK, CLI, MCP — `packages/sdk/**`, `apps/cli/**`, `apps/mcp/**`

Load [`pp-backend` → Surfaces](../../pp-backend/SKILL.md#surfaces--sdk-cli-mcp) for the SDK and the shared rules, [`pp-cli`](../../pp-cli/SKILL.md) for `apps/cli/**`, and [`pp-mcp`](../../pp-mcp/SKILL.md) for `apps/mcp/**`. [api-contract.md → Conventions](../../../../.ai/api-contract.md#conventions) binds every surface, and the [error-code registry](../../../../.ai/api-contract.md#error-codes) is the only list of codes.

### Correctness

| Read for | The bug when it is absent |
| --- | --- |
| The CLI and the MCP server calling the read API **only through `packages/sdk`** — no import of `packages/db`, no direct `fetch` | A second contract that drifts from the first on the next change |
| Every failure path mapped to a **registered** `code` with a written `message` and `hint` | A raw stack trace, or a code the registry does not carry — itself an unapproved contract change |
| CLI exit codes `0` / `1` / `2` as the contract states, and `--json` printing exactly the one error shape | A script that treats a usage error as success, or cannot parse the failure |
| Every operation the surface exposes registered in [api-contract.md](../../../../.ai/api-contract.md), with its scope | A command or tool nobody approved — adding or changing one is Ask-first |
| The SDK's types generated from the OpenAPI document (ADR-011), matching the response the API actually returns | A field the SDK promises and the API never sends |
| List commands and tools following the pagination envelope, not truncating silently | A CLI that shows the first page and calls it the whole answer |

### Security

| Read for | The hole when it is absent |
| --- | --- |
| Masks only, never a raw address, subject or body — **MCP tool output included** | PII handed to a model's context, and from there to wherever it goes next |
| `operate` MCP tools registered only with an `operate` token **and** `--enable-operate` | A read-only assistant that can trigger a replay |
| The token read from `LEDGER_TOKEN`, never a `--token` flag | A bearer token in shell history and process listings |
| Addresses sent only in request bodies, never in a path or query string | An address in every access log between the client and the API |

---

## Tests, docs and config — `**/*.test.ts`, `sim/**`, `.ai/**`, `*.md`, `.env.example`, CI

Load [`pp-testing`](../../pp-testing/SKILL.md) for the tests and `sim/`: file and tier naming, the Postgres harness, fakes at the port, arbitraries and invariant checkers.

### Correctness

| Read for | The bug when it is absent |
| --- | --- |
| The **mandatory-tier test** for every mandatory surface the diff touched | Against real Postgres (`*.int.test.ts`): idempotency on `svix_id` and the outbox `dedupe_key`, order-independent projections, outbox delivery, reconcile and replay, the Postgres side of DLQ redrive (one row under a new `messageId`; local mode's redrive), migrations, auth boundaries (bearer-token scopes `read` / `operate`). Plus: SQS redrive through the `packages/aws` adapter against its port contract and sim invariant 4; a forged, stale or unsigned request never reaching the queue port ([ADR-001](../../../../.ai/architecture.md#adr-001--verify-then-enqueue)); the worker's batch response listing exactly the failed messages (AWS-05, ADR-008; batch-failure unit test) and a database outage pausing the event source with no message in the DLQ (ADR-015; Testcontainers, database stopped); one passing CDK `Template` assertion per cost-brake property, budget and kill-switch wiring included ([`pp-infra` → Cost brake in code](../../pp-infra/SKILL.md#cost-brake-in-code)); a route-level redaction test in `packages/api` for every route whose mapper reads `webhook_events` or a queue envelope (`email.get`, slice 1; `dlq.listMessages`, slice 3), fed a `delivered@resend.dev` recipient and a subject, finding neither raw in the response; the local server that skips auth refusing to start on a non-loopback host (unit test); and every MCP tool's actual output carrying masks only (slice 5). [`pp-workflow` → Test tiers](../../pp-workflow/SKILL.md#test-tiers) owns the tier; nothing else is negotiable |
| An idempotency test that would **fail** if the dedupe were dropped — it must assert one row and one effect after a duplicate delivery, not just that the insert runs | The test that passes against a table with no unique constraint |
| A test per spec `#### Scenario:` — the WHEN/THEN is the test | A requirement with no failing test ships unbuilt and green |
| Assertions on the **refusal**, not only the happy path | Half of these findings are a refusal that returns 200 |
| No `.only`, no `.skip`, no `xit`, no commented-out assertion | A suite that is green because it is not running |
| `.env.example` carrying every new var, and the boot assertion for required ones | Works on the machine that wrote it |
| No gate disabled, skipped or loosened anywhere in CI or config | The `Never` tier. No approval path exists |

### Docs

Docs are read by the coordinator, not a helper — the `.ai/` corpus binds by its exact wording and a summarised reading of it is worthless. What the helper reports here is only **what changed**, so the coordinator can check it against [findings.md → B3 and B4](findings.md).
