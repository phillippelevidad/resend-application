# Spec Delta

## Purpose

Generates seeded, reproducible event histories and prints their projection, so anyone can see at
the terminal that duplicates and shuffling leave the projection unchanged. Later slices drive the
same generator against a live process.

## ADDED Requirements

### Requirement: Seeded history generation
`pnpm sim` SHALL generate one history of several emails and recipients from `--seed <uint32>` and `--namespace <[a-z0-9-]{1,32}>`, with every id derived from the namespace plus a counter. A missing seed or namespace SHALL be chosen at random and printed. Addresses SHALL be under `@resend.dev` only.

#### Scenario: Header lines
- **WHEN** `pnpm sim --seed 42 --namespace walk` runs
- **THEN** line 1 is `sim seed=42 namespace=walk` and line 2 is `history emails=<m> events=<n> duplicates=<d> shuffled=<true|false>`

#### Scenario: Seed chosen for the caller
- **WHEN** `pnpm sim` runs with no `--seed`
- **THEN** line 1 prints the seed it chose, and rerunning with that seed and namespace reproduces the output

### Requirement: Deterministic output
For a fixed seed and namespace, `pnpm sim` SHALL print byte-identical output on every run. A different namespace SHALL yield different ids.

#### Scenario: Same seed twice
- **WHEN** `pnpm sim --seed 42 --namespace walk` runs twice
- **THEN** the two outputs are byte-identical

#### Scenario: Another namespace
- **WHEN** `pnpm sim --seed 42 --namespace walk2` runs
- **THEN** its email ids differ from the `walk` run's

### Requirement: Duplicate and shuffle knobs leave the projection unchanged
`--duplicates <ratio>` (0 ≤ ratio ≤ 1, default 0) SHALL repeat a seeded `⌊ratio·n⌋` of the history's events, and `--shuffle` SHALL apply a seeded permutation. The printed projection SHALL be identical with or without them for one seed and namespace.

#### Scenario: Shuffled with duplicates
- **WHEN** `pnpm sim --seed 42 --namespace walk --shuffle --duplicates 0.3` runs
- **THEN** line 2 shows `shuffled=true` and a non-zero `duplicates`, and the JSON block equals the one printed without the knobs

### Requirement: Projection output, masks only
After the two header lines, `pnpm sim` SHALL print one indented JSON document `{ "emails": [...], "recipients": [...] }`, sorted by email id and recipient, with ISO timestamps, and exit 0. It SHALL print no unmasked address, sender or subject, and no recipient key.

#### Scenario: No PII in stdout
- **WHEN** the output is compared with the generated history for the same seed and namespace
- **THEN** no generated `to`, `from` or `subject` value that differs from its own mask appears in stdout

### Requirement: Bad flags are rejected
An invalid flag value SHALL print a one-line message on stderr and exit 2 without printing a projection.

#### Scenario: Ratio out of range
- **WHEN** `pnpm sim --duplicates 2` runs
- **THEN** it prints `sim: --duplicates <reason>` on stderr and exits 2
