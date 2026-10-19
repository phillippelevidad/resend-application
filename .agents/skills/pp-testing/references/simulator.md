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
| `sim/src/live-run.ts` | The plain live run: the signed one-at-a-time send, the settle bound and its wait |
| `sim/src/aws-run-guard.ts` | The [AWS-run guard](#aws-runs) over injected readers |
| `sim/src/burst-run.ts` · `paced-sender.ts` | `--burst`: its steps over injected dependencies, and the paced, measured send |
| `sim/src/db-outage-run.ts` · `poison-run.ts` | `--chaos db-outage` and `--poison`: each run's steps over injected dependencies, composed for `main.ts` |
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
// packages/core/src/testing/sign-webhook.ts — shape; slice 1 writes it
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

- **Every run prints its seed and its run namespace as its first line**, so any run can be
  replayed. With either not given, `main.ts` picks one and prints it; those choices are the run's
  only unseeded values.
- **Ids derive from the seed and the namespace together** (`svix_id`, `email_id`, `+label`
  addresses), so each run's `svix_id`s are fresh (ADR-016) on a persistent store. Seed alone would
  resend a past run's ids: an event this run lost reads green on invariant 1 because a past run stored
its `svix_id`, and `+label`
  addresses fold runs into one `recipient_state` row, breaking invariant 2. Replaying a seed with its
  namespace is for a fresh database only, and every checker reads only the run's namespace.
- **Everything generated derives from the seed** (ids also from the namespace): the history, its
  ids, the duplicates and the shuffle, drawn from the shared arbitraries with `fc.sample(arbitrary, { seed, numRuns })`
  (`sample` takes fast-check's `Parameters`,
  [fast-check → Runners](https://fast-check.dev/docs/core-blocks/runners/)). Each `fc.sample` call
  restarts the generator from its seed, so every draw after the history takes its own seed derived
  from the run's (`sim/src/derive-seed.ts`); two draws on one seed read one stream and come out
  correlated. Never `Math.random`, `Date.now` or `randomUUID` in generated data.
- **The slice 0 evidence is determinism itself:** `pnpm sim` prints the projection of a generated,
  shuffled history, identical for a fixed seed and namespace
  ([slice 0](../../../../.ai/build-checklist.md#0--foundations)).
- A failing seed becomes a named regression at the cheapest tier that reproduces it: a property or
  integration test before another simulator run
  ([locking a regression](properties-and-arbitraries.md#locking-a-regression)).

## Ground truth and runs

- The generated history is the ground truth: the set of distinct events, keyed by `svix_id`. A
  duplicate is a resend of the same signed event, so it adds no truth.
- The run sends, then waits for the system to settle with a **bounded** wait, and fails the run at
  its bound instead of waiting forever. It polls `webhookEventsRepository.countPresent` over the
  run's `svix_id`s; the bound scales with the run, `30 s + 100 ms × generated events` (1,030 s for
  a 10,000-event burst), polled every 250 ms, or every 2 s once the bound passes 60 s. At the bound
  it prints `sim: not settled after <bound>s (<present>/<generated> stored)` and exits `1`. A poison
  run settles over the non-poisoned ids, its bound still counting every generated event. Then it
  checks invariants 1 and 2 through `packages/db` reads
  ([live-run.ts](../../../../sim/src/live-run.ts) `settleBound`, `settle`).
- **Live or offline:** a run is live iff `LEDGER_URL` is set and non-empty. A shell value, even
  empty, wins over `.env.local` (Node's `--env-file-if-exists` never overrides the environment), so
  `LEDGER_URL= pnpm sim` stays offline; [main.e2e.test.ts](../../../../sim/src/main.e2e.test.ts)
  pins it and spawns every run with `LEDGER_URL` removed.
- **Labels are mandatory in `pnpm sim`:** it always passes `labelEveryAddress: true`, so every
  address carries `+<namespace>-<n>` and the history gains the walk probe `<namespace>-probe`
  (`delivered+<namespace>@` and `bounced+<namespace>@resend.dev`) plus one
  `<namespace>-observed-<local>` email per test address, replaying `testAddressSequences`
  ([RS-39](../../../../.ai/resend.md#facts)) to `<local>+<namespace>-10@resend.dev`. Those
  sequences hold event types and bounce type and sub-type only, never an id, timestamp or address
  captured from a delivery. `ledgerHistory`'s default stays unlabelled so core's properties keep
  exercising bare addresses.
- Knobs are the ones the Ships lists name: the seed, `--duplicates <ratio>` and `--shuffle`
  (slices 0–1), `--burst <events>/<seconds>s`, `--chaos db-outage` and `--poison <1-10>`
  (slice 3, [AWS runs](#aws-runs)), `--chaos worker-crash:0.05` and `--chaos dispatcher-crash:0.05`
  (slice 6) ([build-checklist](../../../../.ai/build-checklist.md#3--operations-and-evidence-on-aws)).
  `--burst`, `--chaos`, `--poison` and `--duplicates` exclude one another (exit `2` naming the
  pair); `--shuffle` combines with any. Each knob's mechanism, and the seed flag's name, are its
  slice's pre-proposal's; a new knob lands with the Ships bullet that needs it.

## AWS runs

`--burst`, `--chaos db-outage` and `--poison` make a run an **AWS run**, against the owner's
deployment only, with `.env.deployed.local` loaded. Every step that reads or changes AWS or
Postgres is injected, so each run's order, refusals and `finally` are unit-tested over fakes and a
fake clock; `main.ts` composes the real steps with `@ledger/aws`'s client factories.

- **No `LEDGER_URL` → exit `2`** with `sim: <flag> needs a live run against the deployed stack: load .env.deployed.local`,
  before any output or network call ([main.e2e.test.ts](../../../../sim/src/main.e2e.test.ts)).
- **The guard** ([aws-run-guard.ts](../../../../sim/src/aws-run-guard.ts)) reads both stacks'
  outputs, then refuses with exit `1` before sending or changing anything, in this order:
  `LEDGER_URL` (trailing slash ignored) is not `ApiUrl`; the stack is tripped (any app function's
  reserved concurrency `0`); `KillSwitchArmed` is not `true`; the DLQ depth is not 0; the app
  stack holds no `SimulatorSecretArn` (deployed without `LEDGER_SIMULATOR=on`, so ingest would
  answer every simulator-signed request `401`). A plain `--duplicates`/`--shuffle` run takes no
  guard and works against any `LEDGER_URL`, deployed included.
- **`--chaos db-outage`** ([db-outage-run.ts](../../../../sim/src/db-outage-run.ts)) also refuses an
  event source not `enabled`, and a `LedgerApp-queue-age` that already reads `ALARM` before any
  fault (`sim: LedgerApp-queue-age already reads ALARM; wait for it to return to OK, then rerun`,
  exit `1`, nothing changed), because the hold below would end at `0m` on a stale alarm, a false
  pass; `OK` and `INSUFFICIENT_DATA` proceed. It repoints the deployed database secret's `pooledUrl` host to
  `ledger-sim-db-outage.invalid` (RFC 2606: every connect fails `ENOTFOUND` under a pg origin,
  which the classifier counts as connection-class), recycles the worker and the read API with a
  `Description` update (AWS-U15), sends the history, waits (bounded 10 min) for the event source to
  read `paused`, then holds (bounded 45 min) until `LedgerApp-queue-age` reads `ALARM` with the DLQ
  at 0. `finally` writes the original back only while the secret still holds the `.invalid` host
  and recycles both again. It then waits (bounded 65 min) for `enabled`, settles, and checks
  invariants 1, 2 and 4. The secret's value stays in memory, never printed or written.
- **`--poison <n>`** ([poison-run.ts](../../../../sim/src/poison-run.ts)) re-ids `n` seeded events
  (never the walk probe's) as `simpoison_<namespace>_<k>` in the generated history, before it is
  arranged, so the ground truth, the send and invariant 4 carry the same ids. Through
  `DATABASE_URL`, which MUST own `webhook_events` (a `42501` refuses, nothing sent), it drops a
  leftover then adds `@ledger/db/testing`'s constant `CHECK` that fails exactly those inserts with
  `23514`: not connection-class, so each follows ADR-008 to the DLQ while the others commit. It
  settles the others, waits (bounded 40 min, the sixth receive after five 360 s visibility
  timeouts, AWS-08, AWS-09) for the DLQ depth to reach `n`, reports
  `others stored <k>/<k> exactly once (<n> poisoned wait in the DLQ)` as a pass condition, and
  removes the fault in `finally`. `@ledger/db/testing` loads under plain `node` because it imports
  `vitest` lazily (D32 of slice 3).

## The burst and the throttle

`--burst` ([burst-run.ts](../../../../sim/src/burst-run.ts)) raises the steady default-route
throttle for its run only ([Budget alarms](../../../../.ai/aws.md#budget-alarms) item 7), through
`@ledger/aws` and the same stage helpers the kill switch and re-arm use
([pp-infra → scripts.md](../../pp-infra/references/scripts.md#shape)):

- **The guard first**, so a tripped or unarmed stack refuses before anything changes.
- **Two preflights, read from the deployment:** `AccountLimit.ConcurrentExecutions` MUST be at
  least 1,000 (AWS-U05), and the usage trip's metric `Sum` over its last period, read from the
  deployed alarm (never a constant), plus the burst's events MUST NOT exceed its threshold.
- **Raise to rate 1,200, burst 2,400, then restore in `finally` only if the throttle still reads
  the value the burst set.** A crash still restores; a trip mid-burst has lowered it to the stop
  value, and a blind restore would re-open API Gateway. Its test: the value changes during the run,
  and `finally` leaves it, printing `throttle left at <rate>/<burst>: changed during the burst (a trip?)`.
- **The history is broadcast-shaped** (`burstHistory`): exactly `events` events, one distinct
  `+label` test address per email. No projection is printed.
- **The send is paced** ([paced-sender.ts](../../../../sim/src/paced-sender.ts)): request `i` due
  at `i × seconds/events`, at most 512 in flight, each signed at send time, no retry; it prints the
  client-observed `p50_ms` and `p99_ms`. After settling it prints `storage before=… after=…
  bytes_per_event=… bursts_left=…` and checks invariants 1, 2 and 4.

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
- **Invariant 4 reads the DLQ through `DlqPort`** ([invariant-4.ts](../../../../sim/src/invariants/invariant-4.ts)):
  up to 10 samples of 10, collecting distinct `svix_id`s from the parsed envelopes (never the
  payload) until it holds `depth` of them. Pass iff the depth equals the poisoned count, every
  collected id is poisoned and every poisoned id was collected; a run with nothing poisoned passes
  only on an empty DLQ. The AWS runs build an `SqsDlqAdapter` from the stack's `DlqUrl` and
  `QueueUrl`; a plain live run prints `invariant 4 not checked (AWS runs check it: --burst, --chaos or --poison)`.
- **A poison run prints invariants 1 and 2 as not checked**
  (`invariant 1 not checked (<n> poisoned events wait in the DLQ)`, and the same for 2): both are over every
  generated event, and the poisoned ones are not stored yet, so a pass over the subset would be one
  the run did not earn.
- The receivers invariant 3 counts at (the fake Resend sink and the callback receiver) are slice 6's.

## Where it may point

- Local mode (slices 1, 2B) and the owner's deployment only. An adopter's stack has no simulator
  secret, so a simulated request is refused (ADR-016).
- Fresh `svix_id`s on every event, never one captured from a live delivery (ADR-016).
- Resend test addresses only; a burst spreads recipients over `+label` forms (slice 3).
- Reactions caused by simulated events reach only the simulator's receiver sink, never Resend or a
  real callback URL ([ADR-006](../../../../.ai/architecture.md#adr-006--transactional-outbox-for-reactions)).
