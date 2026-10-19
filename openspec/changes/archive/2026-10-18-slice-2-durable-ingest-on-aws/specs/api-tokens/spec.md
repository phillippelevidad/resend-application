# Spec Delta

## Purpose

Defines the read API's bearer tokens: their format, the tag check that rejects a forged token
before any database read, storage as a hash only, the two scopes, and the single bootstrap token
that lets an installation issue every later one.

## ADDED Requirements

### Requirement: Token format
A token SHALL be `ldg_<random>_<tag>`, where `random` is 32 random bytes as 64 lowercase hex characters and `tag` is the HMAC-SHA-256 of `random` under the installation's token-tag key, as 64 lowercase hex characters.

#### Scenario: A minted token
- **WHEN** a token is minted
- **THEN** it matches `^ldg_[0-9a-f]{64}_[0-9a-f]{64}$` and its tag verifies under the installation's tag key

#### Scenario: Two mints differ
- **WHEN** two tokens are minted under one key
- **THEN** their `random` parts differ

### Requirement: Tag check before any database read
A token that does not match the format, or whose tag does not verify under the installation's tag key, SHALL be rejected without a database connection. The tag SHALL be compared in constant time.

#### Scenario: Forged tag
- **WHEN** a request carries a token of the right shape whose tag was computed under another key
- **THEN** it is rejected as `unauthorized` and no database connection is attempted

#### Scenario: Malformed token
- **WHEN** a request carries `ldg_abc`
- **THEN** it is rejected as `unauthorized` and no database connection is attempted

### Requirement: Hashed at rest, plaintext once
A token SHALL be stored only as the SHA-256 of the whole token string. Its plaintext SHALL be returned once, by the call that creates it, and SHALL NOT appear in any table, log line, other response or output.

#### Scenario: Stored row
- **WHEN** a token is created
- **THEN** its `api_tokens` row holds a 64-hex `token_hash` and no column holds the plaintext

#### Scenario: Later reads never show it
- **WHEN** the token is read back through `token.list` or `token.getCurrent`
- **THEN** the response holds neither the plaintext nor the hash

### Requirement: Two scopes
Each token SHALL carry exactly one scope, `read` or `operate`, enforced by a database check. An `operate` token SHALL satisfy every `read` route.

#### Scenario: Scope outside the set
- **WHEN** a row with scope `admin` is inserted
- **THEN** the insert fails with SQLSTATE `23514`

#### Scenario: Operate reads
- **WHEN** an `operate` token calls a `read` route
- **THEN** the route answers as it would for a `read` token

### Requirement: Revocation is immediate and audited
A revoked token SHALL be rejected as `unauthorized` on its next request, with no redeploy. Its row SHALL stay, with `revoked_at` set once.

#### Scenario: Revoked token
- **WHEN** a token is revoked and then used
- **THEN** the request answers `401 unauthorized` and the row still exists with `revoked_at` set

### Requirement: One bootstrap token per installation
The first `operate` token SHALL be issued by the deploy command, and locally by the setup command, at most once per database: a second issuance attempt SHALL insert no row and print no token.

#### Scenario: Bootstrap twice
- **WHEN** the bootstrap insert runs twice against one database
- **THEN** exactly one bootstrap row exists and the second attempt returns no token

#### Scenario: Identity insert as the runtime role
- **WHEN** the runtime role inserts a token row
- **THEN** the row gets a generated `id` and the insert succeeds
