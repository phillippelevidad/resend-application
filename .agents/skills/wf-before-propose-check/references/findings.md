# findings — the eight classes, their tells, and what closes each

Ordered by what they cost when they reach the migration, not by how often they appear. Every example below is the shape of a defect that actually shipped into a pre-proposal or a `.ai/` doc in a real run of this workflow.

For each class: **the tell** (how to spot it cheaply), **what it costs** (why it is worth the pass), **how it closes** (which [fix-ladder](../SKILL.md#the-fix-ladder--what-licenses-a-repair) rung, and the usual shape of the repair).

---

## F1 — The mechanism does not exist, or the actor cannot reach it

**The tell.** The document names a field, column, route, token claim, port, id or capability as though it were there. Grep it. The two shapes:

- *Absent.* `WebhookEvent` has no `replayedAt`, but a gate is written against it. No column sources the retry count a row is promised. No enum member exists for a status the CLI output announces.
- *Present but unreachable.* The row exists, and no endpoint returns its id. The command exists, and no CLI flag or MCP tool exposes it. The read exists, and it filters out exactly the rows the caller needs — a DLQ listing returning messages that **failed validation** only, while the owner has to redrive one that **failed on a database error**, whose id they can therefore never learn.
- *Named in prose, never in code.* "Alerts are suppressed **while a reconcile run is in progress**." Which field? Which row of which table? The outbox dispatcher reads no such thing, and the sentence names nothing to grep, so it reads as settled and implements as nothing. **The sweep: take every gate, guard, cap and precondition the document states, and demand the name of what the code reads to decide it.** A condition with no named source is not a rule yet.

The second and third shapes are the dangerous ones, because every piece sounds named and the document reads as complete. Test them by walking the actor's path and by demanding an identifier per condition — not by checking the inventory.

The script helps with the first shape and only the first: it lists every backticked identifier the repo has never heard of, separating the ones **grafted onto something that does exist** (`WebhookEvent.replayedAt` — the type is real, the field is not) from the ones that are wholly new, which are usually just the slice's own work.

**What it costs.** A slice the owner cannot hand-exercise — which [the lens makes a MUST](../../../../AGENTS.md#decision-lens--evidence-over-claims-right-sized) regardless of the fact that no integrator is watching, because the walk is how the slice is verified at all. Found at build time it is a redesign; found here it is a paragraph.

**How it closes.** Rung 2 — the repo is the fact. The cheap repair is almost always already half-built: a read that loads the row anyway can return its id; a route that exists needs a button; a claim that the token already carries needs reading rather than adding. Write the repair as a numbered decision in §7 with the reachability it restores, and cost it — a fix needing new backend code is a different conversation from one needing a field on an existing response.

---

## F2 — The authority does not say that

**The tell.** The anchor resolves (the script proved that) and the section does not support the sentence. Four shapes, in order of frequency:

1. **A softened rule.** The doc says MUST; the pre-proposal says "should" or "generally". The whole rule was the modal verb.
2. **The wrong source.** ADR-007 cited for a rule stated in ADR-011. Both exist, both are about the right area, only one says it.
3. **A silence that is not.** "The docs do not settle X, so under the lens…" — and `data-modeling.md` settles X in a section nobody opened. Rung 3 was used where rung 1 applied, and the lens argument is now load-bearing under a decision the docs already made.
4. **A summary quoted as the section.** An index row, a `Model index` line, or a card's `Refs` label standing in for the section it links.

**What it costs.** Every downstream artifact inherits it. `design.md` records the decision, `spec.md` records the requirement, and the ratified doc that actually governs is discovered at review.

**How it closes.** Rung 1 — quote the governing wording verbatim and rewrite the claim to match. Where the pre-proposal's reading was *better* than the ratified doc's, the doc still governs here: keep the doc's rule and put the correction in **§22 Docs to update**, so the change carries the edit at apply time. That split is the whole reason §22 exists.

---

## F3 — The document contradicts itself

**The tell.** Pick each concrete object the slice touches — a column, a status, a route, a field, a policy, a button — and grep **every** mention of it across the document. Then compare. Real examples:

- A replay described in §10 as re-entering through normal ingest, in §14 as written straight into `webhook_events`, and in §12.5 with *both* an ingest path and a `--direct` flag.
- A reaction condition written as "not `ok`" in one section and as "`hard_bounced` only" in another — a difference that decides whether a `soft_bouncing` address fires the app callback.

This is the class a section-sampling reader cannot see, which is why pass 2 reads the whole document. The script hands you the worklist: every object described in **three or more** of §8–§15, most-mentioned first. It cannot judge whether the descriptions agree — that is the reading — but it turns "compare everything against everything" into a list of twenty.

**What it costs.** `opsx:propose` picks one reading, silently. There is a 50% chance it picks the one the owner would not have.

**How it closes.** Rung 1 or 2 — one reading is nearly always settled by a ratified doc or by the code. Fix **every** occurrence, not the one you found first, and state the resolution once, in §7, so the next reader sees a decision rather than a coincidence. Where the ratified docs *themselves* disagree, that is §6's row and §22's edit.

---

## F4 — The reality check is stale, or was never really run

**The tell.** §5's verdicts against the repo as it stands **today**. Widen past schema and routes:

| Look at | The defect it hides |
| --- | --- |
| Seed data in `packages/db` | A backfill asserting "every `email_state` row has a `webhook_events` row" when two seeded rows have none — the migration blocks mid-apply on a fresh database |
| Test fixtures | A property "already proven" by a test that does not assert it |
| The Drizzle schema vs its migrations | A table with no migration, or a migration missing the unique key idempotency rests on — reads as done, fails the duplicate-delivery test |
| The exported OpenAPI | An operation that exists in code and is missing from the OpenAPI document, so the SDK cannot type it |
| `git log` since the document's date | Anything that landed after it was written |

**What it costs.** "Already done" that is wrong makes the change skip real work. "Absent" that is wrong makes it rebuild and collide. A seed-data miss blocks the migration, which is the most expensive place to find anything.

**How it closes.** Rung 2. Correct the verdict with `file:line`, and where the fix has an **ordering** consequence — a seed edit that must precede a backfill — put it in §23's task groups, in order, with the reason inline. An ordering constraint recorded only in prose is an ordering constraint that gets lost.

---

## F5 — Scope drifted

**The tell.** The script diffs §2 against the card, so the verbatim check is done. What remains is judgement:

- **Orphan work.** Something in §8–§13 that no `Ships` bullet, view or operation authorizes. The card is the scope contract and this skill may explode it, never widen it.
- **A homeless bullet.** A `Ships` item with a verdict in §5 and no home in §8–§13. It will not get built.
- **A deferral that quietly took scope with it.** §3 defers something §12 still draws a screen for.
- **A deferral with no trigger.** "When demand warrants" is not one. It needs a countable threshold or a named observable event, or it is a [categorical reject](../../../../.ai/architecture.md#deferred-yagni) and belongs in §3 as such.

**What it costs.** A slice sized at 1–3 days that is not, or a bullet the owner ticks having never built it.

**How it closes.** Rung 1 — the card governs. Orphan work moves to §3 with the slice that carries it, or is cut. A homeless bullet gets a home. Never resolve drift by editing the card; that is the change's work at apply time, recorded in §22.

---

## F6 — A human on the owner's side is still standing on the integrator's path

**The tell.** Do not read §19's answer — run the test. Walk `discover → sign up → live → operate → get paid → leave` for the stages this slice touches, and at each step ask *who on the owner's side has to do something for this to work?* The fallbacks that hide:

- An owner script (the command's own comment often says so).
- A database query to find an id the product never shows.
- A manual publish, approval, or provisioning step.
- An unbounded wait with no in-product diagnosis.

Then place it: **off** the integrator's path it costs owner hours, is correctly cheap, and defers on a tripwire. **In** their path to a working integration it costs time-to-first-event and adoption — and it must be admitted, not answered with "escalate only on measured pain", because that pain is never measured; the integrator leaves instead of reporting it.

**What it costs.** The document claims a self-service flow the product does not have, and the claim survives into the proposal and the spec.

**How it closes.** Rung 3, and the lens names the ceiling: **admit only the smallest version that removes the fallback**. Where that version is copy, a stance, a price, or something an existing slice already ships, admit nothing. Where the removal is genuinely a new capability, price it and hold it for the owner round — that is a rung-4 item, not a repair.

---

## F7 — Residue `opsx:propose` would stop and ask about

**The tell.** `opsx:propose` asks when it meets ambiguity affecting **scope, externally observable behaviour, compatibility, or acceptance criteria**. Walk those four. The recurring shapes:

| Shape | Fix |
| --- | --- |
| A §14 rule that cannot become a `#### Scenario:` WHEN/THEN | Sharpen it into behaviour, or it is not a requirement |
| A column with no nullability, or an enum member with no meaning | State both; the migration needs them |
| Copy left as "an appropriate message" | Write the string, under [`pp-ux-copy`](../../pp-ux-copy/SKILL.md)'s vocabulary. A screen with unwritten copy is a screen invented at 2am |
| A view missing one of the four required states | Write empty, loading, error and success |
| An operation with no idempotency answer on the money path | [`pp-money`](../../pp-money/SKILL.md) binds and wins over `pp-backend` and `pp-database` |
| "The implementer will choose" | Choose, at the rung that settles it |
| A capability path marked `ADDED`/`MODIFIED` wrongly | The script checks this against `openspec/specs/` |

**What it costs.** Exactly what `wf-before-propose` exists to prevent: `opsx:propose` stopping to ask a question the docs already answer, or — worse — assuming.

**How it closes.** Rungs 1–3, mostly rung 1. If closing it needs a fact you would have to invent, it is rung 4 or 5, never rung 3.

---

## F8 — The ruling nobody made

**The tell.** An `owner-ruled <date>` marker. Two questions:

1. **Did the owner actually answer?** A ruling from a question round in the authoring session is real. A marker written by an agent on top of its own recommendation is not — that has happened, seven times in one change, and five `.ai/` rewrites were made on its strength before the owner overturned one of them.
2. **Is the subject one a question round can settle?** Build shape, sequencing, UI stance: yes. A **legal, fiscal or commercial duty**: no. That channel is a `.human/` decision brief and [`wf-open-question`](../../wf-open-question/SKILL.md), and no amount of reading closes it.

The script flags both, and flags the second as blocking.

**What it costs.** A ratified doc rewritten on an authority that does not exist. This is the most expensive class in this workflow's history precisely because it is invisible — a `RULED` marker looks like the end of a conversation.

**How it closes.** Never by deciding it yourself. Downgrade the marker to a recommendation with its real authority, and either put it in the owner round (rung 4) or route it to `wf-open-question` and record it in **§25 Owner ops still open** (rung 5). §25 is the only section allowed to hold an unresolved item, and only an op — an account to create, a signature to obtain, a professional to consult.

---

## Per-section conformance — what each section owes

Read with [wf-before-propose's template](../../wf-before-propose/references/template.md), which is the authority on the shape. This is the checking pass over it.

| § | Owes | The miss to look for |
| --- | --- | --- |
| 1 | Why now, argued from build cost and testability | An argument from integrator harm in the gap — [not available](../../../../AGENTS.md#decision-lens--evidence-over-claims-right-sized), no real user meets it |
| 2 | The `Ships` list verbatim | Script-checked. Judge only whether link rewrites changed meaning |
| 3 | Deferrals, each with a carrying slice or a countable trigger | "When demand warrants"; a deferral whose own trigger cannot fire without the deferred thing |
| 4 | Prerequisites, blocking vs lagging | A dependency slice assumed done that is not |
| 5 | A verdict per `Ships` item | F4 — re-verify, do not read |
| 6 | Contradictions, each resolved or ruled | Empty with no "having checked: …" list |
| 7 | Decisions with authority | F2, F8. Every `D<n>` cited elsewhere must exist here |
| 8 | Columns, types, nullability, enums, constraints, indexes, FKs, idempotency keys, migration order | A nullable never stated; a write with no unique key to be idempotent on; a migration that is not expand/contract; backfill order |
| 9 | States, transitions, guards, log writes, outbox dispatch | A mutation that is not a transition |
| 10 | Operations: kind, semantics, auth, scope, idempotency, new-or-existing | An invented endpoint path — [`api-contract.md`](../../../../.ai/api-contract.md) is the only place operations are named |
| 11 | Outbox types, handlers and their idempotency argument, scheduled-job overlap guards, webhook verification and replay | Queue order relied on for correctness; SQS standard owns delivery and projections make order irrelevant |
| 12 | Per view: actor, scope, reads, actions, **all four states**, copy, formatting, a11y | A missing state; copy left unwritten; a forbidden term |
| 13 | Per view: fan-out, caching, revalidation | Business logic in the BFF; a client-supplied scope trusted |
| 14 | MUST/MUST NOT, stated under duplicate and out-of-order delivery, behavioural | A rule that cannot become a scenario. Every "rule `<n>`" cited elsewhere must exist |
| 15 | Authentication per surface, scopes, the idempotency key per write, duplicate and replay expectations, the integration cases | A write with no idempotency decision; no named integration case |
| 16 | The money path, or `Not touched — <why>` | Silence where checkout, order, payment, split, payout, commission, fiscal or reconciliation is touched |
| 17 | PII fields, legal basis, retention, log discipline | `Not touched` with no reason. PII in logs or spans — resource ids only |
| 18 | Providers, env vars, secrets, owner ops | An owner op recorded as an open question. It is a work item with an owner |
| 19 | The self-service test and the cost brake, in writing | F6 — run it, do not read it |
| 20 | What proves each requirement, by tier; what `pnpm verify` cannot see | A requirement with no test that would fail if the mechanism were removed |
| 21 | One numbered path per role in `UI surfaces`, with URLs | A role the card claims that no path can walk — a finding against the slice, not the walkthrough |
| 22 | Every doc edit the change owes, including corrections this run found | An `.ai/` correction applied here instead of recorded. **Never edit `.ai/` from this skill** |
| 23 | Capability paths with `ADDED`/`MODIFIED`, requirements per delta, ordered task groups | Script-checked for the verdicts. Judge the ordering and the Ask-first flags |
| 24 | Risks with likelihood, cost, and the cheapest early catch | A risk with no catch, which is a worry rather than a risk |
| 25 | Owner ops only | A decision hiding here. It belongs in §7 |
