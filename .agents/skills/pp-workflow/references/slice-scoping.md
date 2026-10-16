# Slice scoping

A slice is a small, independently shippable v0, hand-walkable through the CLI, the API or the
simulator ([architecture.md → Build order](../../../../.ai/architecture.md#build-order-vertical-slices)).
Scoping fails two opposite ways: taking a slice too early (a dependency has not landed) and letting
it grow (a Deferred-tail item folded in because the file was already open). This procedure
prevents both.

Ordering and rationale are canonical in architecture.md → Build order; each card's goal, `Ships`,
UI surfaces, `Ops`, Deferred tail and `Status` are in [build-checklist.md](../../../../.ai/build-checklist.md).
Neither is restated here.

## 1 — Pick the slice

1. Name the track being advanced: the spine, or a lettered branch whose card says when it MAY
   start and when it MUST land ([How to work this checklist](../../../../.ai/build-checklist.md#how-to-work-this-checklist)).
2. On that track, take the first card whose `Status` is `[ ]` and whose `Depends on` are all `[x]`
   ([Legend](../../../../.ai/build-checklist.md#legend)). A `[!]` card waits for the owner decision
   its `Status` line names.
3. Read the card's `Ops` line. Every Ask-first step it lists (a dependency, CI, a deploy, a live
   Resend write) is named to the owner before the work that needs it starts.
4. If the owner names a slice out of order, say what it depends on and what is unlanded, then
   follow their decision.

## 2 — Explode `Ships` into tasks

`Ships` bullets are capability-level on purpose. Explode them **only for the slice being started**,
into OpenSpec `tasks.md`; a breakdown written for a future slice is speculation that will be wrong
by the time it is read.

- Derive each task from the docs the bullet already links: the ADRs, the
  [data-modeling.md](../../../../.ai/data-modeling.md) entries, the
  [api-contract.md](../../../../.ai/api-contract.md) operations, the `RS-NN` / `AWS-NN` facts.
- Every bullet maps to at least one task that produces its named evidence. A bullet whose evidence
  no task produces is a bullet that will be ticked on faith.
- Quote bullets verbatim. A reworded bullet is a scope change: edit the card first, with the owner.
- An `[Unverified]` row the card owes ([Open questions owed by slice](../../../../.ai/architecture.md#open-questions-owed-by-slice))
  is settled, or proven safe either way, before the slice is done
  ([about.md → Open questions](../../../../.ai/about.md#open-questions)).
- If a bullet cannot be exploded without inventing a decision, that is an open question, not a
  design task.
- Answer the self-service test in writing for the lifecycle stages the slice touches
  ([about.md → Guiding principles](../../../../.ai/about.md#guiding-principles),
  [features.md → Adopter lifecycle](../../../../.ai/features.md#adopter-lifecycle)). The
  pre-proposal carries the answer; "nothing owed" is a valid one, an unanswered test is not.

## 3 — The in-scope test

Run the rows in order; the first one that answers, answers.

| Test | If yes |
| --- | --- |
| Is it named in this card's `Ships` list? | **In.** |
| Is it in this card's Deferred tail, or in a later card's `Ships`? | **Out.** Leave it where it is documented; proximity is not a reason |
| Is it required for a `Ships` bullet to work end to end, or for the slice to stay hand-walkable ([lens clause 3](../../../../AGENTS.md#decision-lens--evidence-over-claims-right-sized))? | **In**, and say so in the commit body |
| Is it a spend-anyway defect this slice's code would ship with: a lost event, a duplicate effect, order-dependent state, a security or PII exposure (MCP output included), a misstated Resend behavior or implied affiliation, a budget-alarm gap ([lens clause 6](../../../../AGENTS.md#decision-lens--evidence-over-claims-right-sized))? | **In.** Correctness of event handling outranks scope (tie-break) |
| None of the above? | **Out.** Surface it to the owner; do not build it silently |

Moving something out is a deferral, and a deferral carries a countable threshold or a named
observable event, never "when demand warrants"; a categorical one is rejected, not deferred
([lens clause 2](../../../../AGENTS.md#decision-lens--evidence-over-claims-right-sized),
[Deferred (YAGNI)](../../../../.ai/architecture.md#deferred-yagni)).

Inside a milestone, adopter or reviewer harm in the gap between slices is not a reason to pull work
forward; a gap a named later slice carries is the plan working. Build cost and testability are the
reasons that survive (lens clause 3).

## 4 — When work stalls

- **Blocked by an owner decision or an unverified fact:** mark the card `[!]` on its `Status` line
  with a one-line reason, and park the question in
  [about.md → Open questions](../../../../.ai/about.md#open-questions), tagged `[Unverified]` when it
  is a fact. Do not resolve it in a doc or in code.
- **Blocked on an Ask-first item:** do the parts that do not depend on the answer first, commit them
  around the held change, and ask at the point the answer is needed
  ([Commit and push as you go](../../../../AGENTS.md#commit-and-push-as-you-go)).
- **A `Ships` bullet contradicts the code or another doc:** correct the fact in the same change, or
  surface the decision. Never leave both versions standing.
- **A Resend behavior the docs don't settle:** add it to Open questions as `[Unverified]` with the
  experiment that would settle it; never build on the guess
  ([lens](../../../../AGENTS.md#decision-lens--evidence-over-claims-right-sized)).

## 5 — Commit shape

Commit and push each finished step as it lands, never the whole slice at once
([Commit and push as you go](../../../../AGENTS.md#commit-and-push-as-you-go)). Cut steps vertically,
each a working increment, rather than as a horizontal refactor series. A schema step (the Drizzle
schema, its migration and the Model index tick) SHOULD be its own commit.

Status updates are status only: move the card's `Status` marker and tick its `Ships` boxes in
place, with no changelog and no dated notes. The heading is an anchor other docs link to, so a
status change never touches it ([Legend](../../../../.ai/build-checklist.md#legend)).
