# Simulator

`sim/` generates event histories, signs and sends them through ingest, and checks the system's rows
against its own ground truth after every run. It is `pnpm sim`, not a `ledger` subcommand, because
it holds a signing secret and reads through `packages/db`
([ADR-016](../../../../.ai/architecture.md#adr-016--the-simulator-reaches-aws-only-through-an-opt-in-simulator-secret)).
The invariants are [architecture.md → Simulator invariants](../../../../.ai/architecture.md#simulator-invariants),
cited by number, never restated here. Package name `@ledger/sim`
([package names](../../pp-general/references/imports-and-tsconfig.md#package-names)).

## Layout

| Path | Holds |
| --- | --- |
| `sim/src/main.ts` | The composition root: parses `process.env` once ([config-and-env.md](../../pp-general/references/config-and-env.md)) and the flags with `node:util` `parseArgs` (no dependency), prints the seed, runs, checks, exits |
| `sim/src/invariants/invariant-<n>.ts` | One checker per invariant number, exporting `invariant<n>` |
| `@ledger/core/testing` | The arbitraries the histories come from ([properties-and-arbitraries.md](properties-and-arbitraries.md)) and the signer below |

Run as `node --env-file-if-exists=.env.local sim/src/main.ts` behind the `pnpm sim` script
([local env file](../../pp-general/references/config-and-env.md#local-env-file)); the script lands
in slice 0 with its [Commands](../../../../AGENTS.md#commands) line.

## Signing

Svix's scheme, on `node:crypto`, no dependency. The signed content is
`` `${svix_id}.${svix_timestamp}.${body}` ``, HMAC-SHA256 keyed with the base64-decoded part after
`whsec_`, sent as `svix-signature: v1,<base64>`; `svix-timestamp` is Unix seconds (RS-03,
[Svix → manual verification](https://docs.svix.com/receiving/verifying-payloads/how-manual)).

```ts
// packages/core/src/testing/sign-webhook.ts — shape; slice 0 or 1 writes it
import { Buffer } from 'node:buffer';
import { createHmac } from 'node:crypto';

export function signWebhook(input: { id: string; timestamp: number; body: string; secret: string }) {
  const key = Buffer.from(input.secret.slice('whsec_'.length), 'base64');
  const digest = createHmac('sha256', key)
    .update(`${input.id}.${input.timestamp}.${input.body}`)
    .digest('base64');
  return { 'svix-id': input.id, 'svix-timestamp': String(input.timestamp), 'svix-signature': `v1,${digest}` };
}
```

- **Proven by a round trip, not by reading it.** A test in `packages/ingest`, the one package
  besides `resend-client` allowed to import `resend`
  ([boundaries](../../pp-general/references/boundaries.md#review-greps)), signs with `signWebhook`
  and passes the result to `webhooks.verify`, which accepts it; a one-byte change to the body is
  rejected (RS-01, RS-02). The same signer feeds ingest's unit tests: old, new and both
  signatures, forged and stale (ADR-009).
- **The body is sent byte for byte as signed** (RS-01). Never re-serialize it after signing.
- **`svix-timestamp` is the wall clock**, because ingest rejects one more than 5 minutes off
  (RS-02). It is the one wall-clock value in a run; a stale test signs 6 minutes in the past.
- **The secret is the simulator secret only**, `LEDGER_SIMULATOR_SECRET`
  ([api-contract.md → Conventions](../../../../.ai/api-contract.md#conventions)), in the `whsec_`
  form `webhooks.verify` takes (RS-02). Ingest stamps what it verifies `source = simulated`.

## Seed and determinism

- **Every run prints its seed as its first line**, so any run can be replayed. With no seed given,
  `main.ts` picks one and prints it; that choice is the run's only unseeded value.
- **Everything generated derives from the seed:** the history, its ids, the duplicates and the
  shuffle, drawn from the shared arbitraries with `fc.sample(arbitrary, { seed, numRuns })`
  (`sample` takes fast-check's `Parameters`,
  [fast-check → Runners](https://fast-check.dev/docs/core-blocks/runners/)). Never `Math.random`,
  `Date.now` or `randomUUID` in generated data.
- **The slice 0 evidence is determinism itself:** `pnpm sim` prints the projection of a generated,
  shuffled history, identical for a fixed seed
  ([slice 0](../../../../.ai/build-checklist.md#0--foundations)).
- A failing seed becomes a named regression at the cheapest tier that reproduces it: a property or
  integration test before another simulator run
  ([locking a regression](properties-and-arbitraries.md#locking-a-regression)).

## Ground truth and runs

- The generated history is the ground truth: the set of distinct events, keyed by `svix_id`. A
  duplicate is a resend of the same signed event, so it adds no truth.
- The run sends, then waits for the system to settle with a **bounded** wait, and fails the run at
  its bound instead of waiting forever. How a run detects settling is the slice 1 pre-proposal's.
- Knobs are the ones the Ships lists name: the seed, `--duplicates <ratio>` and `--shuffle`
  (slices 0–1), `--burst 10000/10s`, `--chaos db-outage` and the poison run (slice 3),
  `--chaos worker-crash:0.05` and `--chaos dispatcher-crash:0.05` (slice 6)
  ([build-checklist](../../../../.ai/build-checklist.md#3--operations-and-evidence-on-aws)). Each
  knob's mechanism, and the seed flag's name, are its slice's pre-proposal's; a new knob lands
  with the Ships bullet that needs it.

## Invariant checkers

- **One checker per number**, named by it: `invariant-2.ts` checks invariant 2 and nothing else. A
  new checker needs its number in Simulator invariants first.
- A checker compares the ground truth with what the system holds, read through `packages/db`
  (ADR-016), never by raw SQL in `sim`. Invariant 2 recomputes `projectEmail` and
  `projectRecipient` from the ground truth with `packages/core` and compares rows.
- **Each run reports every invariant it checked**, by number, pass or fail, with counts and ids
  only, never an address, subject or payload
  ([PII in code](../../pp-general/references/logging-and-pii.md#pii-in-code)). An invariant the run
  did not check is reported as not checked, never as passed
  ([report honesty](../../pp-workflow/SKILL.md#definition-of-done)).
- The process exits non-zero when any checked invariant fails, so a run can gate.
- The receivers invariant 3 counts at (the fake Resend sink and the callback receiver) and how
  invariant 4 reads the DLQ are slices 6 and 3's.

## Where it may point

- Local mode (slices 1, 2B) and the owner's deployment only. An adopter's stack has no simulator
  secret, so a simulated request is refused (ADR-016).
- Fresh `svix_id`s on every event, never one captured from a live delivery (ADR-016).
- Resend test addresses only; a burst spreads recipients over `+label` forms (slice 3).
- Reactions caused by simulated events reach only the simulator's receiver sink, never Resend or a
  real callback URL ([ADR-006](../../../../.ai/architecture.md#adr-006--transactional-outbox-for-reactions)).
