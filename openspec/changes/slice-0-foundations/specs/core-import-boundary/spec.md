# Spec Delta

## Purpose

Keeps `packages/core` pure, free of AWS, Postgres and Resend imports, so projections stay
property-testable in milliseconds. The lint stage enforces the boundary, and a committed fixture
proves it on every run.

## ADDED Requirements

### Requirement: Core rejects infrastructure imports
The lint configuration the lint stage runs SHALL report a restricted-import error for any import in `packages/core` of `pg`, `drizzle-orm` or a `drizzle-orm/*` subpath, `resend`, or any `@aws-sdk/*` package (ADR-013).

#### Scenario: Each banned import
- **WHEN** a file under `packages/core/src/` imports `pg`, `drizzle-orm`, `drizzle-orm/pg-core`, `resend` or `@aws-sdk/client-sqs`
- **THEN** lint reports a `noRestrictedImports` error for that import

#### Scenario: An allowed import
- **WHEN** a file under `packages/core/src/` imports `zod`
- **THEN** lint reports no restricted-import error

### Requirement: The boundary is proven by a committed test
A committed test SHALL run the same linter version and the same committed lint configuration the lint stage runs over deliberate-violation fixtures outside the linted tree, and SHALL assert on the rule name in the diagnostics, not only the exit code. No violating file SHALL be committed into the linted tree.

#### Scenario: The core override is deleted
- **WHEN** the `packages/core` override is removed from the lint configuration
- **THEN** the boundary test fails

### Requirement: Override scoping is settled by test
The boundary test SHALL pin how a per-package override's restricted-import list combines with the base list, using an `@aws-sdk/*` import and a deep `@ledger/db` import in `packages/aws`. The observed semantics SHALL be recorded where the open question lives.

#### Scenario: Override scoping in packages/aws
- **WHEN** a file under `packages/aws/src/` imports `@aws-sdk/client-sqs` and a deep `@ledger/db/src/x.ts` path
- **THEN** the test asserts what lint reports: under the expected replace semantics, no restricted-import error for the first and one for the second. If lint shows merging instead, the test asserts merging and the record says so
