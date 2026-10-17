# Spec Delta

## MODIFIED Requirements

### Requirement: Seeded history generation
`pnpm sim` SHALL generate one history of several emails and recipients from `--seed <uint32>` and `--namespace <[a-z0-9-]{1,32}>`, with every id derived from the namespace plus a counter. A missing seed or namespace SHALL be chosen at random and printed. Addresses SHALL be under `@resend.dev` only and SHALL all carry the run's namespace: each generated address as `<local>+<namespace>-<n>@resend.dev`, and the walk probe's two fixed addresses as `<local>+<namespace>@resend.dev`, so two runs never share an email, a `svix_id` or a recipient, and no probe address equals a generated one.

#### Scenario: Header lines
- **WHEN** `pnpm sim --seed 42 --namespace walk` runs
- **THEN** line 1 is `sim seed=42 namespace=walk` and line 2 is `history emails=<m> events=<n> duplicates=<d> shuffled=<true|false>`

#### Scenario: Seed chosen for the caller
- **WHEN** `pnpm sim` runs with no `--seed`
- **THEN** line 1 prints the seed it chose, and rerunning with that seed and namespace reproduces the output

#### Scenario: Every address labelled
- **WHEN** a history is generated for namespace `walk`
- **THEN** every generated recipient address carries a `+walk` label, and no two runs with different namespaces share a recipient address

### Requirement: Projection output, masks only
After the two header lines, `pnpm sim` SHALL print one indented JSON document `{ "emails": [...], "recipients": [...] }`, sorted by email id and recipient key, with ISO timestamps. An offline run SHALL then exit 0. In either mode it SHALL print no unmasked address, sender or subject, and no recipient key.

#### Scenario: No PII in stdout
- **WHEN** the output is compared with the generated history for the same seed and namespace
- **THEN** no generated `to`, `from` or `subject` value that differs from its own mask appears in stdout

#### Scenario: No PII in a live run's stdout
- **WHEN** a live run's stdout is compared with its generated history
- **THEN** no generated `to`, `from` or `subject` value that differs from its own mask appears, and no keyed address hash appears

## ADDED Requirements

### Requirement: Live mode follows LEDGER_URL
`pnpm sim` SHALL run live when `LEDGER_URL` is set and non-empty, in the shell or in `.env.local`, and offline when it is unset or empty. A value set in the shell, even empty, SHALL win over `.env.local`. An offline run's behavior SHALL be unchanged apart from the labelled addresses.

#### Scenario: Offline run with a local configuration
- **WHEN** `LEDGER_URL= pnpm sim --seed 42 --namespace walk` runs with `.env.local` holding a `LEDGER_URL`
- **THEN** it sends nothing, prints the header lines and the projection, and exits 0

### Requirement: Live run sends every event signed
A live run SHALL send every arranged event, duplicates and shuffle included, one at a time, to the ingest endpoint at `LEDGER_URL`, signed with the simulator secret and the wall-clock `svix-timestamp`, then print `sent requests=<k> accepted=<a>`, where `a` counts the `200` answers.

#### Scenario: Every event accepted
- **WHEN** `pnpm sim --duplicates 0.2 --shuffle` runs live against a running local process
- **THEN** it prints `sent requests=<k> accepted=<k>`

### Requirement: Live run waits for the ledger to settle
After sending, a live run SHALL poll the ledger every 250 ms until every generated `svix_id` is stored, and SHALL fail after 30 seconds with `sim: not settled after 30s (<present>/<generated> stored)` and exit `1`.

#### Scenario: Settled
- **WHEN** every generated event has been stored
- **THEN** the run proceeds to the invariant checks

### Requirement: Invariants 1 and 2 checked against the local process
A settled live run SHALL check invariant 1 (every generated `svix_id` stored exactly once) and invariant 2 (every `email_state`, `email_recipients` and `recipient_state` row of the run equals the projection of the ground truth), print `invariant 3 not checked (slice 6)` and `invariant 4 not checked (slice 3)`, and exit `0` only when both pass and every request was accepted.

#### Scenario: Shuffled with duplicates against apps/local
- **WHEN** `pnpm sim --duplicates 0.2 --shuffle` runs live against `apps/local`
- **THEN** it prints `invariant 1 pass stored=<n>/<n>` and `invariant 2 pass emails=<m> recipients=<r>`, then the two `not checked` lines, and exits 0

#### Scenario: Rerun is all duplicates
- **WHEN** the same seed and namespace run live a second time
- **THEN** every event is a duplicate, both invariants pass again, and stdout is identical to the first run's

#### Scenario: A checker that can fail
- **WHEN** the invariant 1 checker is given ground truth holding a `svix_id` the ledger rows lack, or the invariant 2 checker a projection row that differs from the ground truth
- **THEN** it reports `invariant 1 fail missing=<k> svix_ids=<up to 5 ids>` or `invariant 2 fail email_ids=<…>`, and the run's exit status is 1

### Requirement: Live run prerequisites
A live run SHALL require `LEDGER_SIMULATOR_SECRET`, `DATABASE_URL` and `LEDGER_ADDRESS_HASH_KEY`, printing `sim: <NAME> is required when LEDGER_URL is set` and exiting `2` when one is missing. When nothing answers its first request, it SHALL stop sending, print a message pointing at `pnpm dev:full` and `LEDGER_URL= pnpm sim`, and exit `1`, never printing the URL's value.

#### Scenario: Missing simulator secret
- **WHEN** `LEDGER_URL` is set and `LEDGER_SIMULATOR_SECRET` is not
- **THEN** it prints `sim: LEDGER_SIMULATOR_SECRET is required when LEDGER_URL is set` and exits 2

#### Scenario: Nothing listening
- **WHEN** `LEDGER_URL` points at a port where nothing listens
- **THEN** it prints `sim: no Ledger answered at LEDGER_URL; start it with pnpm dev:full, or run LEDGER_URL= pnpm sim for an offline run` and exits 1 after one request

### Requirement: The walk probe email
Every history SHALL hold one fixed email `<namespace>-probe` to `delivered+<namespace>@resend.dev` and `bounced+<namespace>@resend.dev`: `email.sent` to both, `email.delivered` to the first, and `email.bounced` with `bounce.type` `Permanent` and `subType` `General` to the second (RS-27, RS-28, RS-35). It SHALL be part of the ground truth.

#### Scenario: Probe projection
- **WHEN** a run with namespace `walk` settles
- **THEN** `walk-probe` projects to `status: bounced`, the first recipient `ok` and the second `hard_bounced`, caused by `walk-probe`

### Requirement: Observed test-address sequences in every history
Once RS-U15 is observed, every history SHALL also hold one email per Resend test address (RS-32) replaying that address's observed ordered event types and bounce type and sub-type, with fresh namespaced ids and labelled addresses, and no id, timestamp or address captured from a live delivery.

#### Scenario: Observed sequence projects as observed
- **WHEN** each recorded test-address sequence is projected
- **THEN** its recipient's deliverability is the one its observation implies
