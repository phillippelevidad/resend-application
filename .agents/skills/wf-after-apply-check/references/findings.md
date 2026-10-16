# findings — the seven classes, their tells, and what closes each

Ordered by what they cost **after `opsx:archive`**, not by how often they appear. Once the change is archived its four artifacts stop being read, `.ai/` becomes the only memory of what was decided, and the next slice is built on top of whatever this one left behind. That is the price list.

For each class: **the tell** (how to spot it cheaply), **what it costs**, **how it closes** (which [fix-ladder](../SKILL.md#the-fix-ladder--which-side-is-wrong) rung, and the usual shape of the repair).

---

## B1 — A ticked box with nothing behind it

The signature class of this gate. `opsx:apply` ticks the task it just worked on, and nothing between that tick and the archive checks the code. The tick is a claim about the past made by the party with the least incentive to doubt it.

**The tell.** Three shapes, and the third is the common one:

| Shape | What you are looking at |
| --- | --- |
| Nothing was built | The script's `unbuilt` worklist names it. A migration, a handler, a CLI command the task promised and the tree does not hold |
| Something was built, and it is not what the task said | The names match, the behaviour does not. A cap enforced at a different number, a refusal that returns 200, a field written but never read |
| **The task's own verification clause was never run** | The task said *"verify a duplicate `svix_id` leaves exactly one `outbox` row"* and no test asserts it. The box is ticked on the code existing, not on the check passing |

The third shape is what makes this class worth a dedicated pass. Every well-written task in this repo states how completion is checked **inside the task** — that clause is a test specification, and a ticked box over an unwritten test is the exact failure the clause was put there to prevent.

**What it costs.** The slice is called done, the card is ticked, and the missing piece surfaces in slice N+1 as a thing "that used to work" — except it never did, and by then the change is archived and nobody knows what was promised.

**How it closes.** Rung 1 — the task settles it, so the repair is to write the missing code or the missing test. Where the task itself was wrong (the check it names is impossible, or the behaviour was deliberately changed), that is rung 2: correct the task, state why, and keep the code.

**Where it is not a finding:** the task is covered by code that does not name it, or the drop was deliberate and the change says so. Check both before writing it up.

---

## B2 — The code departs from the plan, and nothing says so

**The tell.** `design.md` says one thing and the diff does another. A different table shape, a different call order, an extra column, a guard that moved, an index that did not land, a decision `D<n>` the code quietly reversed.

**A departure is not a defect. Silence is.** The builder had the code in front of them and the planner did not; sometimes the code is simply right. This repo says so explicitly for designs departing from ADRs — *"say so explicitly and propose superseding it — never diverge silently"* — and the same standard applies one layer down.

**What it costs.** The next slice reads `design.md`, `.ai/` and the archived spec — never the diff. A silent departure means the *plan* is what gets built on, and the code underneath it is a surprise waiting for whoever touches it next. Worse, an undocumented departure that happens to be right still costs: it will be "corrected" back by someone who trusts the doc.

**How it closes.** Rung 1 if a binding rule or a ratified doc says the code is wrong — fix the code. Rung 2 if the code is right — keep it, and write the departure into `design.md` with its reason, correct `tasks.md` and the spec delta so they describe what exists, and where it supersedes an ADR, say that too. Never edit `.ai/` to ratify a *decision* from this skill; that is rung 5, or an entry under [about.md → Open questions](../../../../.ai/about.md#open-questions) tagged `[Unverified]` and put to the owner in the owner-decision round.

---

## B3 — A ratified `.ai/` doc is now false

The most expensive class in this file, because it is invisible, it compounds, and this is the last gate that can see it.

**The tell.** Take each `.ai/` statement the slice touched and check it against the code that now exists:

- A **model section** in [data-modeling.md](../../../../.ai/data-modeling.md) describing columns, nullability or enum members the migration did not produce.
- An **ADR** whose stated mechanism the implementation replaced.
- An **`api-contract.md` entry** whose operation changed its **scope or transition** — a rename is obvious, a scope change is not, and the contract records operation identity precisely so scope changes are visible.
- A **vocabulary term** in [about.md](../../../../.ai/about.md) a CLI command, MCP tool or error message now contradicts, or a **non-goal** the slice quietly crossed.
- A **deferred-tail bullet** on the slice card describing something that in fact shipped, or a shipped bullet describing something deferred.

**What it costs.** Every future agent reads these docs *instead of* the code — that is the entire premise of the `.ai/` corpus. A false line there is a defect injected into every slice that follows, and it is discovered when a schema built on it fails, months later.

**How it closes.** Rung 3, and the boundary matters: **correct a fact, never ratify a decision.** A column list that does not match the migration, a `Modeled` box, a status line, an operation's scope, a folder tree — those are corrections and they belong in this change. A *decision* changing — a new ADR, a superseded one, an open question answered — is rung 5 or 6: prepare it, name it, record it under [about.md → Open questions](../../../../.ai/about.md#open-questions) tagged `[Unverified]`, and put it to the owner in the owner-decision round. Edit `.ai/` in its own house style: RFC 2119, current-state only, no changelog, cross-reference rather than repeat.

---

## B4 — A duty the change owes, undischarged

Mechanical, cheap, and skipped constantly, because every one of these lands at the end of a long implementation session.

The full ledger, from [`pp-workflow` → definition of done](../../pp-workflow/SKILL.md#definition-of-done):

| If the change… | It must also contain | The miss to look for |
| --- | --- | --- |
| Adds, renames, or changes an operation, its scope or its error codes | The [api-contract.md](../../../../.ai/api-contract.md) entry naming the operation, its scope and its errors, and the Ask-first approval | A scope change with the name unchanged, or a new failure path whose `code` is not in the [registry](../../../../.ai/api-contract.md#error-codes) |
| Lands a table in the schema + migration | The ticked `Modeled` box in [data-modeling.md → Model index](../../../../.ai/data-modeling.md#model-index) | The single most-missed duty in the repo, and the only place "is this table real yet?" is answerable |
| Adds, removes, or repurposes a project folder | The [root `AGENTS.md` → Projects](../../../../AGENTS.md#projects) table | A new `apps/<name>/` or `packages/<name>/` folder that the table does not name, or one still marked planned after it landed |
| Completes or advances a slice item | The [build-checklist](../../../../.ai/build-checklist.md) `Status` line and `Ships` boxes, updated **in place** | A marker moved into the heading (which other docs anchor to), or a changelog note added where only status belongs |
| Ratifies or contradicts a documented decision | The `.ai` doc corrected in the same change — not appended to | See B3, and mind the rung-3/rung-5 boundary |
| Makes or supersedes a cross-cutting decision | A new or superseding ADR in [architecture.md](../../../../.ai/architecture.md) | Rung 5. Prepare it, do not ratify it |
| Leaves a question unresolved | The [about.md → Open questions](../../../../.ai/about.md#open-questions) entry, and the slice marked `[!]` with a one-line reason | A slice ticked `[x]` over a question the implementation actually raised |
| Ships a slice | `WALKTHROUGH.md` in the change directory, before the `Status` line is ticked | See B7 |
| Lands a command | Its line in [root `AGENTS.md` → Commands](../../../../AGENTS.md#commands) | A `pnpm` script the next contributor can only find by reading `package.json` |
| Lands the evidence for a row of [What this project must demonstrate](../../../../.ai/about.md#what-this-project-must-demonstrate) | That row's evidence column, linked to the test, invariant or measured run | A claim the project exists to make, proven in the tree and unlinked from the one place a reviewer looks |
| Relies on a Resend behavior | The `RS-NN` fact it rests on, cited from [resend.md](../../../../.ai/resend.md) | A webhook or API assumption nobody checked against Resend's docs |
| Settles an `RS-UNN`, `AWS-UNN` or `PG-UNN` row | That row updated in [resend.md](../../../../.ai/resend.md#unverified), [aws.md](../../../../.ai/aws.md#unverified) or [integrations.md](../../../../.ai/integrations.md#unverified) | A question the code answered, still listed as open |
| Introduces an env var | A public one: its `.env.example` line, names only. An internal, CDK-set one: `infra` only, never `.env.example` ([pp-infra](../../pp-infra/SKILL.md)). Either: the boot-time assertion if it is required | Works on the machine that wrote it, fails on the next one |
| Introduces a code-level convention no doc owns | The owning `pp-*` skill updated in the same change ([pp-workflow → routing](../../pp-workflow/SKILL.md#which-skill-answers-a-code-question)) | A pattern the next slice reinvents differently, because only this diff knows it |
| Touches a mandatory-tier surface | Its mandatory test | Against real Postgres: idempotency on `svix_id` and the outbox `dedupe_key`, order-independent projections, outbox delivery, reconcile and replay, the Postgres side of DLQ redrive (one row under a new `messageId`; local mode's redrive), migrations, auth boundaries (bearer-token scopes `read` / `operate`). Plus SQS redrive (the `packages/aws` adapter, sim invariant 4), verify before enqueue ([ADR-001](../../../../.ai/architecture.md#adr-001--verify-then-enqueue)), the worker failure path (batch response lists exactly the failed messages, AWS-05; a database outage pauses the event source and leaves the DLQ empty, ADR-015), one `Template` assertion per cost-brake property, budget and kill-switch wiring included ([`pp-infra` → Cost brake in code](../../pp-infra/SKILL.md#cost-brake-in-code)), a route-level redaction test for every read-API route whose mapper reads `webhook_events` or a queue envelope, the local auth skip refusing a non-loopback host, and masks-only MCP output (slice 5). [`pp-workflow` → Test tiers](../../pp-workflow/SKILL.md#test-tiers) owns the tier |

**What it costs.** Individually small; collectively the reason the docs stop being trustworthy, which is the reason the next slice needs a human.

**How it closes.** Rung 3 for the doc edits, rung 1 for a missing test. Each gets its own commit — a doc-duty commit is the easiest thing in the world for the owner to skim and approve.

---

## B5 — A correctness bug the suite would never catch

`pnpm verify` proves the tests that exist pass. This class is everything that ships green.

**The tell.** [diff-review.md](diff-review.md) carries the per-surface checklists; the shapes that recur across all of them:

- **Read-then-write.** A cap, a quota, a uniqueness rule or a "last one" guard enforced by counting first. Two concurrent requests both pass it. The constraint decides, never a read.
- **A transaction boundary in the wrong place.** An outbox row written outside the transaction that produced it — the notification fires and the commit does not, or the reverse.
- **Not idempotent under at-least-once delivery.** SQS redelivers. A handler that assumes one execution is a bug with a schedule.
- **A cap off by one.** A three-level tree that admits four, a "never the last one" that admits zero. These live in the exact code the walkthrough exercises, so they are cheap to find and embarrassing to ship.
- **A null the types were told could not happen.** A non-null assertion, an `as` cast, a Zod schema looser than the column.
- **State that started depending on arrival order.** Anywhere in the chain, including a projection that takes the latest row instead of folding the whole event set.

**What it costs.** It reaches the owner's walkthrough at best, and a real user at worst. Neither is visible to any gate that ran before this one.

**How it closes.** Rung 1, citing the `file:line` that proves it and the binding rule if one applies. Add the test that would have caught it in the same commit — a fix with no test is a regression waiting for its second chance.

---

## B6 — A security hole, and verification at the edge is the first question

Every other security class in this codebase is downstream of the ingest edge. An unverified request reaching the queue is not a bug in a feature; it is the ledger's central promise failing, because everything after it trusts what the queue holds.

**The tell.** [diff-review.md](diff-review.md) carries the surface checklists. The order to ask them in:

1. **Verification at the edge.** Every ingest path verifies the signature against the **raw** body and rejects a timestamp outside the tolerance **before** it enqueues — a check that runs but verifies a re-serialised body passes every test that only signs what it parses. A rotation keeps every active secret in the list. Nothing writes to the ledger from a path that skipped verification.
2. **Authorization before the command runs**, on the caller's scope (`read` / `operate`) — and especially on an operate tool, which must not even be registered without the scope.
3. **A client-supplied value trusted.** A scope, a role, an `email_id`, a `svix_id`, from a body, a query string or a header, where the verified request or the token should have supplied it.
4. **An id from somewhere else.** A route parameter, a queue message field, a webhook payload id — used to read or write before the token's scope or the payload's signature has been checked.
5. **PII where it must not be.** A log line, a span, an error message, an analytics event, a URL, an MCP tool result. Log `svix_id` plus `email_id` and look the record up.
6. **A secret in the tree**, or a token taken from a `--token` flag instead of `LEDGER_TOKEN`, or a signing secret written to a log.
7. **Unvalidated input.** A body without a Zod schema, a raw query built by concatenation or through `sql.raw(` / `.unsafe(`.

**What it costs.** The one class where the [decision lens](../../../../AGENTS.md#decision-lens--evidence-over-claims-right-sized) says spend regardless: security exposure is on the "spend anyway" list, alongside lost events and duplicate effects. Cost is not an argument here.

**How it closes.** Rung 1 always. Add the integration test in the same commit — auth boundaries are mandatory-tier, and the test is the proof, not the check. Where the fix needs a migration, it is a **new forward migration** and it is Ask-first: prepare it, hold it for the owner round.

---

## B7 — The slice cannot be walked

Every finished slice [MUST still be hand-walkable through the CLI, the API or the simulator](../../../../AGENTS.md#decision-lens--evidence-over-claims-right-sized), because the walk is how the slice is verified at all. An unwalkable slice is not done even though no adopter is watching. `WALKTHROUGH.md` is numbered steps, each with the exact CLI command, API request or `pnpm sim` run and its expected output ([build-checklist.md → How to work this checklist](../../../../.ai/build-checklist.md#how-to-work-this-checklist)).

**The tell.** Read `WALKTHROUGH.md` against the code:

- A step whose **mechanism does not connect** end to end — the route exists, the CLI command does not; the SDK method exists, no command or tool calls it; the read exists and filters out exactly the rows the step needs; the fixture or simulator scenario the step names does not exist.
- A step **quoting output the code does not produce** — a field, an error `code`, a `hint`, an exit code. One of the two moved, and the owner finds out mid-walk.
- A step that **cannot be completed today and names no destination slice.** That rule is explicit and it has teeth: an unwalkable step with no named destination *is* the slice not being done.
- A **self-service stage the card claims with no step** — `deploy → connect the webhook → ingest → query → recover → tear down`. A claimed stage no command reaches is a finding against this slice, not a note for a later one.

**What it costs.** The owner loses the session they set aside to test the slice, and finds out the slice was never testable. That is the most expensive fifteen minutes in this workflow.

**How it closes.** Rung 1 where the code cannot support the walk — fix the code. Rung 2 where the walkthrough drifted and the code is right — fix the walkthrough. Where the gap is real unbuilt scope, the slice is **not done**: say so, name what is missing, and do not tick anything.

---

## Writing the finding

Every finding lands the same way, whether it becomes a commit or an owner question. The shape matters because the owner reads the table, not your reasoning:

1. **What the code does**, at `file:line`, in one sentence a tired reader understands.
2. **What should be true**, quoted from the task, the spec scenario, the `.ai/` doc or the `pp-*` rule, with its anchor.
3. **Which side is wrong** — the fix-ladder rung, stated. This is the whole judgement and it should be one clause.
4. **The cheapest correct repair.** Every `pp-*` `Never` entry already names its alternative; use it rather than inventing a third option.
5. **The commit**, once made — one fix, one sha, revertible alone.

If the repair is genuinely more expensive than an equally lawful alternative, that is rung 5 — the owner round — not a repair. Say what each costs and which you would take.
