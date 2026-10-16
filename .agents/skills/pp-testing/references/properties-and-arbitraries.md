# Properties and arbitraries

Property tests are first-class here
([architecture.md → Technology](../../../../.ai/architecture.md#technology)): order independence is a
claim about every arrival order, and only a generator over orders checks it. Which claims owe a
property is [Test tiers](../../pp-workflow/SKILL.md#test-tiers); the properties a slice owes are
named in its Ships list. This file owns where the arbitraries live, what they generate and how a
failure is locked.

## Where arbitraries live

- **In `packages/core`, exported through `@ledger/core/testing`**
  ([G-02](../../pp-general/references/imports-and-tsconfig.md#packages-ship-typescript-source)):
  `packages/core/src/testing.ts` re-exports from `packages/core/src/testing/`. One set, imported by
  core's own `*.prop.test.ts`, by other packages' tests, and by `sim`, so the simulator generates
  histories from the same model the properties check ([simulator.md](simulator.md)).
- Production code never imports `/testing`
  ([imports-and-tsconfig.md](../../pp-general/references/imports-and-tsconfig.md#packages-ship-typescript-source)).
- `fast-check` is a dev dependency of each package that imports it (core, `sim`), Ask-first when
  slice 0 adds it ([Permissions](../../../../AGENTS.md#permissions)). An arbitrary file is named for
  the thing it generates, with no role suffix; the exact names are slice 0's.

## What they generate

- **Event sets for one email**, over the RS-25–RS-29 types
  ([resend.md → Event types and payloads](../../../../.ai/resend.md#event-types-and-payloads-rs-25rs-30)),
  shaped by the `packages/core` Zod schemas: every event-specific object optional, `bounce.type` and
  `subType` any string as well as the documented values, plus unknown types and schema-failing
  payloads of known types (stored raw and skipped, ADR-004).
- **Both answers to an open question.** Where a Resend behavior is `[Unverified]`, the arbitrary
  generates both worlds, so the property is safe either way: a bounce after a delivery and none
  (RS-U11), `created_at` that tracks event time and that does not (RS-U10), `data.suppressed`
  present and absent (RS-U19), any `bounce.type` string (RS-U12)
  ([slice 0](../../../../.ai/build-checklist.md#0--foundations)). The test cites the row it covers.
- **Several recipients per email**, each `data.to` naming a subset, for the two-recipient property
  (ADR-003, RS-27).
- **Ids** fresh and unique per event (`svix_id`, `email_id`); duplicates are made by repeating an
  event, never by colliding ids by chance.
- **Addresses** from Resend's test domain only: `delivered@resend.dev`, `bounced@resend.dev` and
  `+label` forms ([integrations.md → Locked rules](../../../../.ai/integrations.md#locked-rules-must)).
  The mask properties generate arbitrary local parts and labels under `@resend.dev`, so pp-general's
  [address grep](../../pp-general/references/boundaries.md#review-greps) stays empty.

## The properties slice 0 owes

[ADR-003](../../../../.ai/architecture.md#adr-003--projection-is-a-pure-function-of-the-event-set)
properties 1–4 for `projectEmail` and `projectRecipient`, and the mask properties
([PII & retention](../../../../.ai/data-modeling.md#pii--retention)):

| Property | Shape |
| --- | --- |
| 1 Permutation invariance | Any reordering of the same event set gives an equal projection |
| 2 Idempotence | Repeating any events of the set gives an equal projection |
| 3 Monotonicity | Adding events to a set never moves the projection out of a state ADR-003's precedence makes sticky (for `projectRecipient`, its sticky states) |
| 4 Oracle agreement | The projection equals a deliberately naive reference written in the test file, never imported from production |
| Masks | Idempotent, length-preserving, no digit revealed, at most 3 characters revealed per token |
| Two recipients | A bounce naming one recipient leaves the other's outcome unchanged |

- One property per `it`, named for the property and its consequence
  ([test names](vitest-layout.md#test-names)).
- `numRuns` stays at fast-check's default unless a measured run says otherwise, and the change
  states the measurement.
- `fc.assert` runs inside a Vitest `it`; no fast-check integration package (a dependency for a
  wrapper).

## Locking a regression

A property that fails has found a bug, and the counterexample is the cheapest test of it.

1. The report prints `{ seed, path, endOnFailure: true }`. Passing those back to `fc.assert` "executes
   the predicate directly on the reported failure"
   ([fast-check → Read test reports](https://fast-check.dev/docs/tutorials/quick-start/read-test-reports/)).
2. Write the regression test with that seed and path pasted in, named for the bug
   ([test names](vitest-layout.md#test-names)), and see it fail.
3. Also pin the shrunk counterexample as a literal through `fc.assert`'s `examples` setting
   (examples "run first",
   [fast-check → User definable values](https://fast-check.dev/docs/configuration/user-definable-values/)).
   A seed replays the same case only while the arbitrary is unchanged; the literal keeps locking
   the bug after the arbitrary evolves.
4. Fix the code. Never remove the seed, lower `numRuns` or skip the property to get green.

The same holds for a simulator run: a failing seed becomes a named regression, at the cheapest tier
that reproduces it ([simulator.md](simulator.md#seed-and-determinism)).
