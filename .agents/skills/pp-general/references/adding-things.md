# Adding things — the over-build procedure

The default failure in this repo is **over-build**: reaching for the most capable construct
available instead of the one Ledger needs at its [scale ceiling](../../../../.ai/about.md#platform-scale-assumptions).
This procedure gives "it depends" an answer.

**The standing default:** the boring construct first. A pattern earns its place by removing a
*current* problem, never by being the standard answer elsewhere. Where one is adopted, adopt its
thinnest form. The governing rule is the
[decision lens](../../../../AGENTS.md#decision-lens--evidence-over-claims-right-sized), clauses 1, 2
and 5; clause 6 (spend anyway) overrides this file when an absence would lose events, duplicate an
effect, make state order-dependent or expose PII.

## Step 0 — is it already decided?

Check, in order: the accepted ADRs ([architecture.md → Decisions](../../../../.ai/architecture.md#decisions)),
[Deferred (YAGNI)](../../../../.ai/architecture.md#deferred-yagni), the
[Technology](../../../../.ai/architecture.md#technology) table, the [Projects](../../../../AGENTS.md#projects)
table, and this skill. Applying a decision needs no deliberation and no new ADR. Contradicting one
needs a superseding ADR and the owner's ratification, never a code comment. A categorical deferral
(SQS FIFO, a second database, multi-tenant) is rejected until a superseding ADR reopens it.

## Extract an abstraction

**Deciding test:** the **third** duplicate exists, **or** it is a named ADR seam.

Two occurrences are a coincidence, not evidence, and the second one is usually what teaches the
abstraction you would have got wrong at the first. The named seams are the exception, because the
ADR already paid for the deliberation: the queue port and the other port interfaces in
`packages/shared` ([ADR-013](../../../../.ai/architecture.md#adr-013--pure-core-and-local-mode)), and
`packages/resend-client` ([ADR-012](../../../../.ai/architecture.md#adr-012--resend-client-is-the-sole-resend-api-caller)).

## Rejected patterns

| Instead of | Do |
| --- | --- |
| A command bus or query bus | Call the command's or reader's `execute(input)` directly; the call stays greppable (ADR-019) |
| An in-process event emitter for anything with an effect | An outbox row in the same transaction, delivered by the dispatcher ([ADR-006](../../../../.ai/architecture.md#adr-006--transactional-outbox-for-reactions)) |
| A `BaseRepository`, generic repository or Unit of Work | Executor-first repository functions per table in `packages/db` ([pp-database](../../pp-database/SKILL.md)); the Drizzle transaction is the unit of work |
| A DI container or decorators | One hand-wired composition root per app, `main.ts` ([ADR-019](../../../../.ai/architecture.md#adr-019--application-and-surface-stack)) |
| An interface with one implementation | The concrete class. Only a named port is an interface; a test double is not a second implementation |
| A `Result` / Either type | Throw the base error with a registered `code` ([errors.md](errors.md)) |
| A service locator or module-level singleton registry | Pass dependencies to the constructor or factory in `main.ts` |
| An implicit or ambient transaction (async-local storage, a decorator) | Pass `tx` explicitly to every repository call |
| An auto-mapper, or a row passed through to the wire | An explicit `.mapper.ts`, which is where the PII masks are applied |
| A cache without a named invalidation trigger | No cache. A cache is admitted only with its trigger named in the same change; a cold cache MUST degrade to a slower correct answer |
| A generic `operate` endpoint or a free-form filter passthrough | One named operation per entry in [api-contract.md](../../../../.ai/api-contract.md) |

## Add an interface

**Deciding test:** it is a named port. A port is declared in `packages/shared` as `<name>.port.ts`
and implemented by an `.adapter.ts` in the package that owns the I/O. Everything else uses the
concrete type.

## Add a dependency

**Deciding test:** it is not a one-liner, it is not a second way to do what an installed package
already does, **and** the owner approved it. A third-party dependency is
[Ask-first](../../../../AGENTS.md#permissions): stop and ask, never add it and mention it afterwards.

- A one-liner is never a dependency. Write the line.
- A second way to do a thing the repo does one way (a second logger, a second validation library, a
  second HTTP client) is a cost paid on every future change.
- Stay close to Resend's public stack; a deviation needs one line of reasoning in the doc that
  introduces it ([decision lens](../../../../AGENTS.md#decision-lens--evidence-over-claims-right-sized)).
- Choosing a package is not installing it: it is pinned in the slice that first needs it
  ([ADR-019](../../../../.ai/architecture.md#adr-019--application-and-surface-stack)).

A `workspace:*` entry for a `@ledger/*` package is a boundary declaration, not a third-party
dependency, so it is not Ask-first (owner, O-09); it follows [imports-and-tsconfig.md → Imports](imports-and-tsconfig.md#imports).

## Add a workspace package

**Deciding test:** the [Projects](../../../../AGENTS.md#projects) table lands it in this slice,
**or** a second project imports it in this diff.

Code shared by one consumer is not shared code; it is code with an extra hop. Colocate first, and
lift on the second real consumer, not the anticipated one. A new package updates the Projects
table in the same change ([pp-workflow → Definition of done](../../pp-workflow/SKILL.md#definition-of-done)).

## Defer something

**Deciding test:** the deferral names a countable threshold or a named observable event (a
tripwire), never "when demand warrants" ([lens clause 2](../../../../AGENTS.md#decision-lens--evidence-over-claims-right-sized)).
Sort it by its reason first: temporal (build cost, sequencing) defers on a tripwire; categorical
(the reason holds at every point below the ceiling) is rejected.

## When the answer is still unclear

Prefer the reversible-cheap option and record what would change your mind: a count, a second
consumer, a measured number. That sentence turns the next "it depends" into a decision. A choice
that is genuinely cross-cutting is an ADR and an owner decision, drafted with `architecture-designer`,
not an inline judgement call.
