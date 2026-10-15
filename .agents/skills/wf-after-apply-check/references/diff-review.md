# diff-review — what to read, what to skip, and the checklist per surface

Pass 4 is the only pass whose cost scales with the size of the diff, so it is the only one that needs a spending rule. Two decisions make it affordable: **read nothing that was generated**, and **split by surface rather than by lens** so the diff is read once instead of four times.

## What not to read

A large share of any diff in this repo is byproduct — a file that changed *because* something else changed, carrying no decision of its own. Reading it costs tokens and finds nothing, and worse, it dilutes the reading budget for the files that do carry decisions.

**Never read these; the script excludes them from every worklist:**

| Excluded | Why |
| --- | --- |
| `pnpm-lock.yaml`, `package-lock.json`, `yarn.lock` | A dependency decision is visible in `package.json`; the lock is its shadow |
| `packages/api-client/**` (generated client) | Emitted by `pnpm generate:api-client` from the OpenAPI export. The generator is the reviewable thing |
| The exported OpenAPI document (`openapi.json` / `openapi.yaml`) | Emitted from the controllers and Zod schemas. Review those |
| `**/dist/**`, `**/build/**`, `**/.next/**`, `**/.turbo/**`, `**/coverage/**`, `**/node_modules/**` | Build output |
| `*.snap`, `*.min.js`, `*.map`, `*.tsbuildinfo` | Derived artifacts |
| `*.png *.jpg *.jpeg *.gif *.webp *.avif *.ico *.svg *.woff *.woff2 *.ttf *.pdf` | Binary or asset content; a diff tool has nothing useful to say about it |
| `prisma/generated/**`, any path a codegen step writes | Same reason as the client |

**But do not drop them silently — they are evidence.** Their *presence or absence* answers duty questions the reading cannot:

- `packages/api-client/**` changed while the backend contract changed → the client was regenerated. Unchanged while controllers moved → [B4](findings.md), and the drift stage of `pnpm verify` should have caught it, so check why it did not.
- `pnpm-lock.yaml` changed → a dependency moved. That is **Ask-first**; confirm it was approved, and read the `package.json` line, not the lock.
- A new binary asset appeared → check where it is served from and whether it belongs in the repo at all.

So: **count them, name them in one line, and read none of them.**

## Splitting the work

The script's `surfaces` worklist buckets the readable diff four ways. Hand each helper **one bucket and one section of this file**, verbatim, in a single wave. Under ~800 readable lines, skip the helpers and read it yourself — the coordination costs more than the reading.

### The brief to hand each helper

Paste this, filling the three slots. Do not paraphrase it; the constraints are what keep the finding usable.

```
You are reviewing one surface of an implemented change in this repo.
Read-only: do not edit, do not commit, do not run the test suite.

Surface: <schema | backend | frontend | tests-docs>
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

## Schema — `supabase/migrations/`, `backend/prisma/schema.prisma`, `supabase/seed.sql`

Load [`pp-database`](../../pp-database/SKILL.md). The [new-table recipe](../../pp-database/references/new-table-recipe.md) is the checklist the migration either satisfies or does not.

### Correctness

| Read for | The bug when it is absent |
| --- | --- |
| Base fields on every new table | A table that cannot be audited, versioned or deduped later without a migration against live rows |
| Every column's nullability matching the code that writes it | A `NOT NULL` the command never sets, or a nullable the reader assumes present |
| Enum members matching every value the code writes | A write that fails at runtime on a value the enum does not carry |
| Every idempotency key (`svix_id`, `dedupe_key`) backed by a unique constraint, on exactly the columns the key means | A dedupe that is accidentally too narrow or too wide — the same event stored twice, or two distinct reactions collapsed into one |
| `NULLS NOT DISTINCT` where two nulls must collide, plain where they must not | The subtlest constraint bug there is, and it only appears with real data |
| `onDelete` on every FK: `Restrict` across an aggregate boundary and onto ledger or audit rows | A cascade that deletes history |
| Each index serving a query that exists, and each hot query having one | A sequential scan on the table the read API hits on every request |
| A `set_updated_at` trigger on every table carrying `updated_at`, reusing the existing function | A column that only moves when the ORM writes it, and lies after any raw update |
| Backfill **failure** behaviour, stated and implemented | "Backfill from X" with no answer for a row where X is absent. It must fail loudly, not invent a value |
| `seed.sql` extended before any migration whose backfill reads it, and covering ≥2 emails with interleaved events | The migration blocks mid-apply on a fresh database, or order-independence tests pass because there is only one email |
| The Prisma / Supabase authority split | `schema.prisma` owns table and column shape; `supabase/migrations/` owns RLS, functions and helpers |

### Security

| Read for | The hole when it is absent |
| --- | --- |
| `ALTER TABLE … ENABLE ROW LEVEL SECURITY` **and** `… FORCE` on every new table | Policies below it are inert. This is the single highest-value line in any migration in this repo |
| A policy that actually **filters** — read the predicate, do not check that a policy exists | A permissive policy passes every test that asserts "a policy is present" and leaks everything |
| `apply_tenant_rls` called, or a hand-written block that reproduces all of it — including the `anon`/`authenticated` revoke and the deny policies | Multiple permissive policies are OR'd, so a second policy **widens** access rather than narrowing it |
| `ledger_api` granted the **narrowest** privileges the table needs, and `USAGE` on each new enum | Works locally as superuser, fails as the API role — or worse, an append-only table that silently accepts an `UPDATE` affecting zero rows |
| A global (non-tenant) table carrying explicit deny policies for untrusted roles | The reason `outbox_deny_untrusted_roles` had to exist |
| No business logic in a trigger or stored procedure | The only sanctioned DB-side logic is RLS, `apply_tenant_rls` and `set_updated_at` |
| No money, fiscal, stock, state or unbounded array in a `jsonb` column; no identifying PII in a typed money/fiscal/state column | Both are `pp-database` `Never` entries with named alternatives |
| No edit to a migration that has already been applied | A forward migration is the only fix. Editing one that has run anywhere is a `Never` |

---

## Backend — `backend/src/**`

Load [`pp-backend`](../../pp-backend/SKILL.md), and [`pp-money`](../../pp-money/SKILL.md) too if the diff touches checkout, order, payment, split, payout, commission, promotion, fiscal, reconciliation, return, dispute or `billing_*` — **it wins wherever it collides.**

### Correctness

| Read for | The bug when it is absent |
| --- | --- |
| Every worker query inside the one ledger transaction, with the **transactional client** passed all the way down | A query that escapes the transaction reads outside the `FOR UPDATE` lock on the email. It looks correct and it loses updates |
| A **constraint**, not a read, deciding every cap, quota and uniqueness rule | The read-then-write race: two concurrent submits both count `n-1` and both insert |
| Every state move as a named command driving **one persisted transition** | A `status` written directly; a mutation that is not a transition; a generic transition endpoint |
| Every side effect as an **outbox row in the same transaction** | The notification fires and the commit does not, or the reverse |
| Every worker handler idempotent on `dedupe_key`; every outbound Resend send carrying an idempotency key derived from it | At-least-once is the delivery contract. "It will only run once" is not a design |
| The whole write inside one transaction where two tables must agree | A half-written aggregate that no test with one row will ever produce |
| Error shape: the one `{ error: { code, message, hint, docs } }` shape, validation through Zod | A hand-rolled error body the SDK, the CLI's `--json` and the MCP tools cannot read |
| List reads on the standard pagination envelope | A second pagination shape reaching the generated client |
| No Resend API call outside `packages/resend-client` | A call that bypasses the shared rate-limit budget, untestable without the vendor |
| No app importing another app; nothing in `packages/core` importing AWS, Postgres or Resend | The import graph is the boundary check, and it is greppable |
| SQS for delivery and Postgres for truth, **only** | A cache, a second queue or an in-memory map treated as source of truth |
| Projections as a pure function of the event **set**, folded in `(created_at, rank(type), svix_id)` order | State decided by arrival order: a late `email.delivered` overwriting an earlier `email.bounced` |

### Security

| Read for | The hole when it is absent |
| --- | --- |
| Every command **authorized before it runs**, on the caller's scope — especially an `operate` command | The check that was assumed to live in the guard and lives nowhere |
| A guard that checks the right thing — read the predicate, not the decorator | A guard that runs, passes, and asserts the wrong scope or the wrong role set |
| `tenant_id` derived from the resolved server-side context, never from a body, query or header | The `Never` that has no exceptions anywhere in this repo |
| Every id from the request proven to belong to the caller's tenant before it is read or written | The classic IDOR: RLS saves you on a scoped table and does not on a global one |
| Every request body through a Zod schema, with bounds on anything unbounded | An array field with no max, an integer with no range |
| No raw SQL built by concatenation; `$queryRaw` parameterised, `$queryRawUnsafe` absent | Injection, and RLS does not save you from it |
| No PII in a log, span, error message, analytics event or URL | Log `svix_id` plus `email_id` and look the record up |
| No secret in the tree; every credential from env or Secrets Manager | A key in a fixture is a key in the history |
| Webhook handlers verifying their signature before doing anything | An endpoint anyone can post to |
| Uploads bounded by type and size, and written to a **tenant-prefixed** path | One tenant's storage key reaching another tenant's object |

---

## Frontend — `storefront/`, `backoffice/`, `admin/`, `auth/`, `packages/ui`

Load [`pp-frontend`](../../pp-frontend/SKILL.md) and [`pp-ux-copy`](../../pp-ux-copy/SKILL.md).

### Correctness

| Read for | The bug when it is absent |
| --- | --- |
| **All four states on every view** — empty, loading, error, success | Empty is the first state every new integrator sees, and it is the one that is missing |
| Mutations in the backend, never the BFF | A Server Action doing business logic; the BFF is session, host resolution and orchestration only |
| API-error → **form-field** mapping per failure | Every backend refusal rendering as one generic banner, leaving the user nowhere to go |
| Route-segment `error` and `loading` boundaries | One thrown read blanking a whole console |
| The pt-BR copy actually written and matching `pp-ux-copy`'s vocabulary, with its forbidden terms absent | A term the copy rules forbid, shipped to a screen |
| Brazilian formatting and masks — CPF/CNPJ, CEP, phone, dates — and `R$` rendered from integer centavos | Money formatted from a float, or a mask that accepts an invalid document |
| A disabled control carrying a **readable reason**, wired with `aria-describedby` | A greyed button whose only explanation is its colour |
| Reads through the generated API client, server-side | A hand-copied DTO that drifts on the next contract change |

### Security

| Read for | The hole when it is absent |
| --- | --- |
| Tenant resolved **server-side from the host**, and inbound tenant headers **stripped before stamping** | A client-supplied `tenant_id` reaching the API carrying the BFF's authority |
| No `process.env` server value read in a `"use client"` file, and no secret in a `NEXT_PUBLIC_` name | A secret in the browser bundle, permanently |
| No `dangerouslySetInnerHTML` over anything a user or a webhook payload can carry | Stored XSS on any page that renders it |
| Session cookies `httpOnly`, `secure`, `sameSite` | The whole session model resting on one flag |
| `noindex` where a surface must not be indexed | A pre-launch page indexed on the day it opens |
| Ids in a URL not treated as authorization | The screen shows what the API returns; the API decides who may see it |

---

## Tests, docs and config — `**/*.spec.ts`, `.ai/**`, `*.md`, `.env.example`, CI

### Correctness

| Read for | The bug when it is absent |
| --- | --- |
| An **integration test against real Postgres** for every mandatory-tier surface the diff touched | Idempotency, order-independent projections, outbox delivery, reconcile and replay, state transitions, auth boundaries. `pp-general` owns the tier; nothing else is negotiable |
| An idempotency test that would **fail** if the dedupe were dropped — it must assert one row and one effect after a duplicate delivery, not just that the insert runs | The test that passes against a table with no unique constraint |
| A test per spec `#### Scenario:` — the WHEN/THEN is the test | A requirement with no failing test ships unbuilt and green |
| Assertions on the **refusal**, not only the happy path | Half of these findings are a refusal that returns 200 |
| No `.only`, no `.skip`, no `xit`, no commented-out assertion | A suite that is green because it is not running |
| `.env.example` carrying every new var, and the boot assertion for required ones | Works on the machine that wrote it |
| No gate disabled, skipped or loosened anywhere in CI or config | The `Never` tier. No approval path exists |

### Docs

Docs are read by the coordinator, not a helper — the `.ai/` corpus binds by its exact wording and a summarised reading of it is worthless. What the helper reports here is only **what changed**, so the coordinator can check it against [findings.md → B3 and B4](findings.md).
