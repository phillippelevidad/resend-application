# Spec Delta

## MODIFIED Requirements

### Requirement: Event source stamped from the matching secret
The queued envelope SHALL carry `source` `live` when a Resend secret matched and `simulated` when the simulator secret matched. Ingest SHALL verify against the simulator secret only when one is configured, and only after the Resend set (ADR-016). With none configured, a request signed only with a simulator secret SHALL answer `401` and enqueue nothing.

#### Scenario: Simulator delivery
- **WHEN** a request verifies only against the simulator secret
- **THEN** its envelope carries `source: simulated`

#### Scenario: Resend delivery
- **WHEN** a request verifies against a configured Resend secret
- **THEN** its envelope carries `source: live`

#### Scenario: No simulator secret configured
- **WHEN** ingest has no simulator secret configured and a request arrives signed with a simulator secret (RS-02's `whsec_` form)
- **THEN** ingest answers `401` with body `unauthorized` and the queue holds nothing

### Requirement: An unreadable secret set answers 503
When the signing-secret set cannot be read, fails to parse as a list of `whsec_` secrets, or holds no secret at all, or a configured simulator secret cannot be read or is not one `whsec_` secret, ingest SHALL answer `503` with the fixed body `unavailable`, enqueue nothing, never answer `401`, and log `ingest.secrets_unavailable` with the error's name only. Resend then retries the delivery (RS-09, RS-10).

#### Scenario: Secret read fails
- **WHEN** the secret read rejects
- **THEN** ingest answers `503` with body `unavailable` and the queue holds nothing

#### Scenario: Empty secret set
- **WHEN** the stored set is an empty list and no simulator secret is configured
- **THEN** ingest answers `503`, not `401`

#### Scenario: Simulator secret unreadable
- **WHEN** a simulator secret is configured and its read rejects or its value is not a `whsec_` secret
- **THEN** ingest answers `503` with body `unavailable` to every request, a Resend-signed one included, and the queue holds nothing
