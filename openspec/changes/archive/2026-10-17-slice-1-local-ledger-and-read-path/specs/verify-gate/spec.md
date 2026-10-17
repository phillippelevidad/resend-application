# Spec Delta

## MODIFIED Requirements

### Requirement: One gate, identical locally and in CI
`pnpm verify` SHALL run the stages `install, docker, secrets, lint, links, typecheck, drift, unit, int, synth, e2e` in that order, stopping at the first failure. CI SHALL run exactly `pnpm verify` on every push and pull request, so the stage list has one source.

#### Scenario: Every stage passes
- **WHEN** `pnpm verify` runs and every stage exits 0
- **THEN** it prints `VERIFY PASSED` and exits 0

#### Scenario: A stage fails
- **WHEN** any stage exits non-zero
- **THEN** no later stage runs, it prints `VERIFY FAILED: <stage>` and exits 1

#### Scenario: A resumed run is not the gate
- **WHEN** `pnpm verify --from <stage>` runs and every remaining stage passes
- **THEN** it ends `VERIFY PARTIAL`, never `VERIFY PASSED`

## ADDED Requirements

### Requirement: Contract drift fails the gate
The `drift` stage SHALL regenerate the read API's OpenAPI document and the SDK's generated types into a temporary directory and compare them byte for byte with the committed `packages/sdk/openapi.json` and `packages/sdk/src/openapi-types.ts`, failing when either differs.

#### Scenario: Committed files match
- **WHEN** both committed files equal what the read API generates
- **THEN** the stage prints `drift: openapi.json and openapi-types.ts match packages/api` and exits 0

#### Scenario: A route changed without export
- **WHEN** a read-API route's schema changes and `pnpm openapi:export` was not run
- **THEN** the stage prints `drift: <file> differs from packages/api; run pnpm openapi:export and read the diff (a changed contract is Ask-first)` and exits 1

### Requirement: The drift stage proves itself on every run
Before comparing the committed files, the `drift` stage SHALL compare a copy of the freshly generated `openapi.json` with one byte changed, and SHALL fail unless that copy is reported as drift.

#### Scenario: Canary caught
- **WHEN** the one-byte-changed copy is reported as drift
- **THEN** the stage prints `drift: canary caught 1/1` and goes on to the committed files

#### Scenario: Canary missed
- **WHEN** the comparison reports no drift for the changed copy
- **THEN** the stage exits 1 without comparing the committed files

### Requirement: Migrations apply to a fresh Postgres before integration tests
The `int` stage SHALL start a fresh Postgres, ensure the runtime role, and apply every migration as the owner before any integration test runs; each test SHALL then connect as the runtime role, so a failing migration or a missing grant fails the gate (ADR-018).

#### Scenario: A migration fails
- **WHEN** any migration fails to apply to the fresh Postgres
- **THEN** no integration test runs and the stage exits non-zero

#### Scenario: A missing grant
- **WHEN** a table the tests write lacks a grant to the runtime role
- **THEN** an integration test fails with a permission error and the stage exits non-zero

#### Scenario: Closed sets match their checks
- **WHEN** the integration tests insert every member of each closed-set column's tuple as the runtime role, and one value outside it
- **THEN** every member is accepted and the outsider is refused with SQLSTATE `23514`
