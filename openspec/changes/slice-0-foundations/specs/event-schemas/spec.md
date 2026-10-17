# Spec Delta

## Purpose

Validates Resend webhook payloads so the ledger stores every event raw and projections read only
the fields they can rely on, without ever losing an event to an over-strict schema.

## ADDED Requirements

### Requirement: Envelope for every event
Every webhook payload SHALL be validated against an envelope of `type` (string), `created_at` (ISO 8601 datetime with offset) and `data` (object), per RS-26. The envelope SHALL accept unknown fields at every level.

#### Scenario: A payload of a known type
- **WHEN** an `email.delivered` payload with `type`, `created_at` and `data` is validated
- **THEN** it passes the envelope

#### Scenario: A non-email family
- **WHEN** a `domain.*`, `contact.*`, `suppression.*` or `topic.*` payload (RS-25) is validated
- **THEN** it passes the envelope and has no typed email schema applied

#### Scenario: An unknown event type
- **WHEN** a payload carries a `type` that RS-25 does not list
- **THEN** it passes the envelope and is kept raw, with no typed schema applied

### Requirement: Typed outbound email events
The ten outbound email types of RS-25 (`email.scheduled`, `sent`, `delivered`, `delivery_delayed`, `bounced`, `failed`, `suppressed`, `complained`, `opened`, `clicked`) SHALL each have a typed schema discriminated on `type`. Only `type`, `created_at`, `data.email_id` (string) and `data.to` (string array, RS-27) SHALL be required.

#### Scenario: Missing email id
- **WHEN** an `email.sent` payload lacks `data.email_id`
- **THEN** the typed schema rejects it

#### Scenario: Shared optional fields absent
- **WHEN** an outbound email payload omits `from`, `subject`, `message_id`, `broadcast_id`, `template_id` and `tags` (RS-27)
- **THEN** the typed schema accepts it

#### Scenario: Inbound email is envelope-only
- **WHEN** an `email.received` payload (RS-30) is validated
- **THEN** it passes the envelope and has no typed outbound schema applied

### Requirement: Event-specific objects are optional
Event-specific objects SHALL be optional in every typed schema: `bounce { type, subType, message, diagnosticCode[] }` (RS-28), `click`, `failed { reason }` and `suppressed { message, type }` (RS-29).

#### Scenario: Suppressed event with and without its object (RS-U19)
- **WHEN** an `email.suppressed` payload is validated once with `data.suppressed` and once without it
- **THEN** both pass the typed schema

#### Scenario: Bounce without its bounce object
- **WHEN** an `email.bounced` payload omits `data.bounce`
- **THEN** it passes the typed schema

### Requirement: Bounce classification is an open string
`data.bounce.type` and `data.bounce.subType` SHALL accept any string and SHALL NOT be restricted to a closed set, because RS-28's examples and RS-35's documented list disagree (RS-U12).

#### Scenario: Example-only and unknown values
- **WHEN** an `email.bounced` payload carries `data.bounce.type` of `Temporary`, `Undetermined` or a value no page documents
- **THEN** it passes the typed schema with the value preserved

### Requirement: New Resend fields never fail a parse
Every object in the typed schemas SHALL accept fields it does not declare, and SHALL preserve them.

#### Scenario: An extra field
- **WHEN** an outbound email payload carries a top-level or `data` field no schema declares
- **THEN** it passes the typed schema

### Requirement: A field no projection reads never fails a parse
A field no projection reads (RS-27–RS-29) SHALL keep its documented type in the schema, and a value off that type SHALL parse as absent instead of failing the event. The fields a projection reads (`type`, `created_at`, `data.email_id`, `data.to`, `data.from`, `data.subject`, and `data.bounce` with its `type` and `subType`) SHALL still fail the parse when off-type, as before.

#### Scenario: A Permanent bounce with a drifted unread field
- **WHEN** an `email.bounced` payload with `data.bounce.type` `Permanent` carries `data.bounce.diagnosticCode` as a string, or a `data.tags` value that is not a string
- **THEN** it passes the typed schema, and the recipient's projection reads `hard_bounced`

#### Scenario: Any value in any unread field
- **WHEN** any outbound example carries any JSON value in any field no projection reads
- **THEN** it passes the typed schema and projects exactly as the untouched example does

#### Scenario: A read field off its type
- **WHEN** an outbound payload carries a `data.from`, `data.subject`, `data.bounce`, `data.bounce.type` or `data.bounce.subType` off its documented type
- **THEN** the typed schema rejects it

### Requirement: Resend's documented examples parse
The example payload on each `webhooks/emails/<type>` page that resend.md cites for RS-26–RS-30 SHALL be kept as a fixture recording its source URL and fetch date, with any non-test address replaced by a Resend test address. Each fixture SHALL pass its schema.

#### Scenario: Every documented example
- **WHEN** the ten outbound fixtures are validated against the typed schemas, and the `email.received` fixture against the envelope
- **THEN** every one passes

#### Scenario: An example contradicting a recorded fact
- **WHEN** a fetched example contradicts RS-26–RS-29
- **THEN** the contradiction is recorded in resend.md rather than absorbed silently into a schema
