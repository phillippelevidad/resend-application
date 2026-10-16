# Spec Delta

## Purpose

Derives each email's state, each email-recipient's outcome and each recipient's deliverability from
the stored event set alone, so the result is independent of delivery order, duplicates and arrival
time, and is rebuildable from the ledger.

## ADDED Requirements

### Requirement: Projections read only the stored event set
A projection SHALL take only stored event fields (`svix_id`, `type`, the payload's `created_at`, the payload, and caller-supplied recipient keys aligned with `data.to`) and SHALL NOT read arrival time, arrival sequence or prior projection state. Resend promises no delivery order (RS-07).

#### Scenario: Same events, different arrival
- **WHEN** one event set is projected after arriving in two different orders at two different times
- **THEN** the two projections are equal

### Requirement: Order independence
For any event set, every permutation of it SHALL yield an equal email state, equal email-recipient outcomes and equal recipient deliverability. Events SHALL be ordered by `(created_at, rank(type), svix_id)`, so equal timestamps break ties by type rank and then by `svix_id`.

#### Scenario: Shuffled history
- **WHEN** an email's events are projected in generated order and in a random permutation
- **THEN** both projections are equal

#### Scenario: Tied timestamps (RS-U10)
- **WHEN** many events share one `created_at`, including several of the same type, whether or not timestamps follow lifecycle order
- **THEN** every permutation still yields an equal projection

### Requirement: Duplicate delivery is a no-op
Repeating any events in the input SHALL yield a projection equal to the one without repeats, because events are deduplicated by `svix_id`.

#### Scenario: Redelivered events
- **WHEN** a subset of an email's events is repeated in the input
- **THEN** the projection, including open and click counts and the event count, is unchanged

### Requirement: Outcome precedence, never recency
Status SHALL be the highest-precedence outcome present, low to high: `scheduled`, `sent`, `delivery_delayed`, `delivered`, `complained`, `suppressed`, `failed`, `bounced` (owner-ruled 2026-10-16). Status SHALL be null while the set holds no outcome event. `opened` and `clicked` SHALL NOT set status.

#### Scenario: Late bounce after delivery (RS-U11)
- **WHEN** an email has `email.delivered` and `email.bounced`, in either arrival order and with the bounce's `created_at` before or after the delivery's
- **THEN** status is `bounced`

#### Scenario: Only engagement events
- **WHEN** an email's set holds only `email.opened` and `email.clicked` events
- **THEN** status is null, and the open and click counts reflect the distinct events

#### Scenario: Complaint ranks above delivery
- **WHEN** an email has `email.delivered` and `email.complained` (RS-29)
- **THEN** status is `complained`

### Requirement: The deciding event
The deciding event for a status SHALL be the outcome event with the highest `(precedence, bounce.type = Permanent)`, ties going to the earliest in event order. Status time, bounce type and bounce subtype SHALL come from it.

#### Scenario: Permanent bounce not displaced
- **WHEN** an email has a `Permanent` bounce and a later `Transient` bounce
- **THEN** the bounce type reported is `Permanent`, with the permanent bounce's time

### Requirement: Precedence monotonicity
For event sets A ⊆ B, the precedence of B's status SHALL be at least that of A's. If A's deliverability for a recipient is sticky, B's SHALL be sticky with equal or higher sticky precedence.

#### Scenario: Adding events
- **WHEN** events are added to a projected set
- **THEN** status precedence never drops, and a sticky deliverability never becomes non-sticky or lower

#### Scenario: Higher-ranked non-sticky event after a sticky one
- **WHEN** an email that made a recipient `suppressed` later gains an `email.failed`, or one that made it `complained` gains a `Transient` bounce
- **THEN** that recipient's deliverability stays `suppressed` or `complained`

### Requirement: Per-recipient outcomes
An email-recipient outcome SHALL be computed only from events whose own `data.to` names that recipient (RS-27). It SHALL carry the recipient's masked address, its own status and deciding event, and its strongest sticky and latest soft signal, each with that event's time and `svix_id`.

#### Scenario: Two-recipient bounce
- **WHEN** an email to two recipients gets an `email.bounced` whose `data.to` names only one
- **THEN** the other recipient's outcome is unchanged

### Requirement: Hard bounce only on Permanent (RS-U12)
A bounce SHALL count as hard only when `bounce.type` is exactly `Permanent` (RS-35). Every other value, a missing `bounce` object included, SHALL count as a soft bounce.

#### Scenario: Any non-Permanent bounce
- **WHEN** a recipient's only signal is a bounce with `bounce.type` `Transient`, `Temporary`, `Undetermined`, an unknown string, or none
- **THEN** its deliverability is `soft_bouncing`, never `hard_bounced`

#### Scenario: Permanent bounce
- **WHEN** a recipient has a bounce with `bounce.type` `Permanent`
- **THEN** its deliverability is `hard_bounced`

### Requirement: Sticky deliverability
A recipient's deliverability SHALL be one of `ok`, `soft_bouncing`, `hard_bounced`, `complained`, `suppressed`. If any of its outcomes carries a sticky signal, deliverability SHALL be the highest by `hard_bounced` > `suppressed` > `complained`, its time and cause email from the earliest such signal.

#### Scenario: Sticky across emails
- **WHEN** a recipient was `complained` on one email and later delivered on another
- **THEN** its deliverability is `complained`

### Requirement: Soft bounces clear on a later delivery
With no sticky signal, deliverability SHALL follow the latest soft signal across the recipient's outcomes by `(time, rank, svix_id)`: a delivery gives `ok`, a soft bounce gives `soft_bouncing`. With neither it SHALL be `ok`, with no time and no cause email.

#### Scenario: Delivery after a soft bounce on the same email
- **WHEN** a recipient has a `Transient` bounce and a later `email.delivered` on the same email
- **THEN** its deliverability is `ok`, though that email's status is `bounced`

#### Scenario: No signal yet
- **WHEN** a recipient's outcomes carry only `sent` and `delivery_delayed` events
- **THEN** its deliverability is `ok` with no time and no cause email

### Requirement: Unprojectable events are skipped, never fatal
An event SHALL be skipped without error, and leave every projection unchanged, when its type is not an outbound email type, it fails its schema, it lacks `created_at`, it names another email, or its recipient keys do not align with `data.to`.

#### Scenario: Unknown and inbound events
- **WHEN** an email's set also holds an unknown type, an `email.received` and a schema-failing payload
- **THEN** the projection equals the one without them, and no error is raised

### Requirement: Agreement with an independent oracle
Each projection SHALL equal a naive reference computed by precedence-first selection, a different algorithm from the sort-and-fold, over generated histories in both RS-U10 and both RS-U11 worlds.

#### Scenario: Generated histories
- **WHEN** a property run generates histories with tied timestamps, duplicates, late bounces and sticky events followed by higher-ranked non-sticky ones
- **THEN** every projection equals the oracle's
