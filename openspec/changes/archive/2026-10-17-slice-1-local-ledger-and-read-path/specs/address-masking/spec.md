# Spec Delta

## ADDED Requirements

### Requirement: Keyed address hash
An address SHALL be hashed by one function as `<key_id>.<hex HMAC-SHA-256(key, normalized address)>`, where the key is the deployer-held 32-byte address-hash key and `key_id` is the first 8 hex characters of `HMAC-SHA-256(key, "ledger:key-id")`. The function SHALL normalize its input itself, so no caller can hash an unnormalized address.

#### Scenario: Format
- **WHEN** any address is hashed under any key
- **THEN** the result matches `^[0-9a-f]{8}\.[0-9a-f]{64}$`

#### Scenario: Normalization inside the hash
- **WHEN** `  Delivered@Resend.DEV ` and `delivered@resend.dev` are hashed under the same key
- **THEN** the two hashes are equal

#### Scenario: Deterministic under one key
- **WHEN** a property run hashes generated addresses twice under the same key
- **THEN** each pair of results is equal

#### Scenario: Two keys
- **WHEN** one address is hashed under two different keys
- **THEN** the two `key_id` prefixes differ and the two hashes differ
