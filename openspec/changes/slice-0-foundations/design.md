# Design — slice 0: Foundations

## Context

See [proposal.md → Why](proposal.md#why). The pre-proposal
[2026-10-16-slice-0-foundations.md](../../../.ai/pre-proposals/2026-10-16-slice-0-foundations.md)
(*PP*) is decision-complete and checked. Each decision below keeps its PP number (D1–D21) and
carries everything `opsx:apply` needs to build it; the PP keeps the full authority trail and the
contradictions C1–C10. This design adds no decision the PP did not settle.

State on `HEAD` (verified 2026-10-16):

- `packages/core/src/index.ts` and `sim/src/main.ts` are `export {}` stubs.
- `scripts/verify.mjs` runs `install, docker, lint, typecheck, unit, synth, e2e`. CI runs it
  unchanged and already fetches full history (`fetch-depth: 0`).
- `biome.json` already bans `pg`, `drizzle-orm`, `drizzle-orm/**`, `resend` and `@aws-sdk/*` in
  `packages/core/**` and `packages/shared/**`. Nothing tests the ban.
- Installed: Zod 4.6.7 (for `packages/api`; `z.looseObject()`, `z.iso.datetime({ offset: true })`
  and `z.discriminatedUnion()` exist and behave as D11 needs, checked 2026-10-16) and Biome 2.5.15.
  fast-check is not installed; `4.10.2` exists on npm. `packages/core` and `sim` already declare
  `vitest: catalog:`.
- Vitest projects: `unit` takes `{packages,apps,sim,infra}/**/*.test.ts` minus `int` and `e2e`;
  `e2e` takes `{apps,sim}/**/*.e2e.test.ts`. `scripts/` is in no project.
- Node 24 type stripping, no build step. `@ledger/*` exports point at `./src/*.ts`.
- Probed 2026-10-16 (this review): the pinned gitleaks image scans a mirror clone of the full
  history with default rules and finds no leak (8 commits); the D18 config is valid and each
  custom rule fires; Biome lints from a temp directory and the D17 cases report as D17 expects.

Binding constraints: ADR-003 (projection is a pure function of the event set), ADR-004 (ledger keyed
on `svix_id`; bad events stored raw and skipped), ADR-013 (pure core), the module boundaries in root
AGENTS.md, and the `pp-general`, `pp-backend` (core), `pp-testing` and `pp-workflow` skills.

## Goals / Non-Goals

**Goals:**

- Projections whose four properties hold on generated histories in both worlds of every open Resend
  question this slice owes (RS-U10, RS-U11, RS-U12, RS-U19), so slice 1 commits their output
  unchanged.
- Gates that prove themselves on every run (the canaries), so a broken check fails loudly instead of
  passing a clean repo silently.
- Zero new runtime surface: no route, env var, table or AWS resource.

**Non-Goals** (design-level; scope exclusions are in proposal.md):

- No `@ledger/shared` dependency from core. Core sits below shared's error class, so core never
  throws on input. It skips (D3).
- No keyed hashing in core. Projections take caller-supplied recipient keys (D3).
- No configurable precedence. One constant table; changing it is the projection-rebuild tripwire.
- No Vitest–fast-check integration package (pp-testing: "no fast-check integration package").

## Decisions

### D21 — Module layout in `packages/core`

Kebab-case files with role suffixes (pp-general → coding-standards), each beside its tests:

| File | Export | Decision |
| --- | --- | --- |
| `email-event-types.ts` | `emailEventTypes` (`as const`, ten outbound types) | D11 |
| `webhook-envelope.schema.ts` | `webhookEnvelopeSchema` | D11 |
| `email-event.schema.ts` | `emailEventSchema` | D11 |
| `email-status.schema.ts` | `emailStatusSchema` | D2 |
| `deliverability.schema.ts` | `deliverabilitySchema` | D2 |
| `sticky-signal.schema.ts`, `soft-signal.schema.ts` | `stickySignalSchema`, `softSignalSchema` | D2, D4 |
| `event-rank.ts` | `eventRank` | D1 |
| `ledger-event.ts` | `LedgerEvent` type | D3 |
| `project-email.projection.ts` | `projectEmail`, `EmailState`, `EmailRecipientState` | D3–D5 |
| `project-recipient.projection.ts` | `projectRecipient`, `RecipientState` | D6, D7 |
| `normalize-address.ts` | `normalizeAddress` | D14 |
| `mask-text.ts`, `mask-address.ts`, `mask-from.ts` | `maskText`, `maskAddress`, `maskFrom` | D13 |
| `testing.ts` → `testing/ledger-history.ts` | `ledgerHistory` (public via `./testing`) | D15 |
| `testing/email-history.ts` | `emailHistory` (core-internal) | D15 |
| `testing/mask-input-char.ts` | `maskInputChar` (core-internal: the code-point arbitrary the three mask prop tests share) | D13 |
| `fixtures/resend/email-<event>.json` | Resend doc examples (`email-bounced.json`, `email-delivery-delayed.json`, …) | D12 |

`index.ts` re-exports every primary export. `package.json` gains `"./testing": "./src/testing.ts"`,
because `sim` imports it in this diff. Closed sets are Zod enums with inferred types, never a
TypeScript `enum` (pp-general → Never).

**Alternative rejected:** one `events.ts` holding schemas and types. It breaks the one-primary-export
file rule and makes the boundary test's fixtures harder to place.

### D11 / D12 — Schemas, envelope first, and their fixtures

Parsing is two-step, with `safeParse` only (core never throws, D3):

- `webhookEnvelopeSchema = z.looseObject({ type: z.string(), created_at: z.iso.datetime({ offset: true }), data: z.looseObject({}) })`
  accepts every payload, unknown types included (RS-26).
- `emailEventSchema` is a `z.discriminatedUnion('type', …)` of `z.looseObject()` members, one per
  type in `emailEventTypes`: `email.scheduled`, `email.sent`, `email.delivered`,
  `email.delivery_delayed`, `email.bounced`, `email.failed`, `email.suppressed`,
  `email.complained`, `email.opened`, `email.clicked` (RS-25 minus `email.received`). It is applied
  only when `type` is in `emailEventTypes`.

Required: only `type`, `created_at`, `data.email_id` (string) and `data.to` (string array). Optional:
RS-27's `from`, `subject`, `message_id`, `broadcast_id`, `template_id`, `tags`, and every
event-specific object: `bounce { type, subType, message, diagnosticCode[] }` (RS-28), `click`,
`failed { reason }`, `suppressed { message, type }` (RS-29). Every object is `z.looseObject()`, so a new
Resend field never fails a parse. `data.bounce.type` and `data.bounce.subType` are `z.string()`
(D7). `email.received`, the non-email families and unknown types get no data schema: they pass the
envelope, are stored raw and are skipped by projections.

**Fixtures (D12).** At apply, fetch the example payload from each
`https://resend.com/docs/webhooks/emails/<slug>.md` page, where the slug is the event name in
kebab case (`delivery-delayed`; all 11 pages are listed in `https://resend.com/docs/llms.txt`,
checked 2026-10-16), for the ten outbound types plus `received`. Save each as
`fixtures/resend/email-<slug>.json`. Replace any address that is not a Resend test address with
`delivered@resend.dev` or `onboarding@resend.dev`. `email-event.schema.test.ts` holds a table of
`{ file, sourceUrl, fetchedOn, substitution }`. An example that contradicts RS-26–RS-29 is recorded
in resend.md, never absorbed (C1).

**Authority:** ADR-003 ("Event-specific payload objects are optional in the Zod schemas");
[resend.md → Event types and payloads](../../../.ai/resend.md#event-types-and-payloads-rs-25rs-30);
C1 for the fixtures.
**Why:** an over-strict schema skips real events, which is lost state (tie-break: correctness
first). **Alternative rejected:** a union including a catch-all member for unknown types. It blurs
"typed" from "kept raw" and makes the projection's skip rule implicit.

### D1 / D2 — Precedence and the closed sets (D1 owner-ruled 2026-10-16)

`eventRank`: `email.scheduled` 0 · `sent` 1 · `delivery_delayed` 2 · `delivered` 3 · `opened` 4 ·
`clicked` 5 · `complained` 6 · `suppressed` 7 · `failed` 8 · `bounced` 9 · any other type 10. It
serves both as ADR-003's fold tie-break `rank(type)` and, restricted to the eight statuses, as
outcome precedence. Sticky precedence follows it: `hard_bounced` > `suppressed` > `complained`.

Closed sets (Zod enums, inferred types):

- `emailStatusSchema`: `scheduled`, `sent`, `delivery_delayed`, `delivered`, `complained`,
  `suppressed`, `failed`, `bounced`. RS-25's outbound types minus the counters (`opened`,
  `clicked`). Status is `null` while the set holds no outcome event (C9); it is never inferred from
  an `opened` or `clicked`.
- `deliverabilitySchema`: `ok`, `soft_bouncing`, `hard_bounced`, `complained`, `suppressed`.
- `stickySignalSchema`: `hard_bounced`, `suppressed`, `complained`.
- `softSignalSchema`: `delivered`, `bounced`.

Slice 1's `CHECK` constraints mirror these sets.

**Alternatives rejected:** recency (`last_event`, ADR-003 rejects it); equal-rank terminal negatives
(strict monotonicity would fail on a late-sorted second terminal type); a live Resend lookup from
core (ADR-012, ADR-013, RS-31).

### D3 — Projection input: the stored ledger row, never arrival data

`LedgerEvent = { svixId: string; type: string; eventCreatedAt: Date | null; recipientKeys: readonly string[] | null; payload: unknown }`:
a `webhook_events` row minus `received_at`, `source` and the typed `email_id`, so projection code
cannot read arrival time. `recipientKeys[i]` keys `data.to[i]`: slice 1 passes `to_hashes`; slice 0's
arbitraries pass `normalizeAddress(to[i])`.

The signature is `projectEmail(emailId, events)`. ADR-003 writes `projectEmail(events)`; the caller
passes the id it holds the email lock for (ADR-004), and an event naming another `data.email_id` is
skipped. `projectEmail`:

1. Parses each `payload`: envelope, then typed (D11).
2. Skips, never throws, an event that is not an outbound email type, fails its schema, has
   `eventCreatedAt === null`, names another `data.email_id`, or whose `recipientKeys` is null or of
   a different length than `data.to` (ADR-004: "stored raw, skipped by projections and counted";
   slice 1's worker does the counting).
3. Dedupes by `svixId`. Two inputs with one `svixId` are one stored row (the ledger's primary key,
   ADR-004), so which copy survives cannot change the result.
4. Sorts by `(eventCreatedAt, eventRank(type), svixId)` (ADR-003) and folds.

**Alternatives rejected:** a projection that hashes or reads raw addresses for its key (it would break rebuild
after redaction, ADR-014); throwing on bad input (`packages/core` sits below `packages/shared`'s
error class, and pp-general bans `throw new Error(` in `packages/`).

### D4 / D5 — Output shapes and the deciding event

`EmailState` (the [`email_state`](../../../.ai/data-modeling.md#email_state--current-state-per-email)
columns):

- `{ emailId; status: EmailStatus | null; fromMasked: string | null; subjectMasked: string | null; openCount; clickCount; firstOpenedAt: Date | null; firstClickedAt: Date | null; lastEventAt: Date | null; eventCount; recipients: EmailRecipientState[] }`.
- `fromMasked = maskFrom(data.from)`, `subjectMasked = maskText(data.subject)`, each from the first
  event in fold order that carries the field.
- `openCount` / `clickCount` count distinct `email.opened` / `email.clicked` events; `first*At` is
  the minimum `eventCreatedAt` of that type.
- `lastEventAt` is the maximum `eventCreatedAt` and `eventCount` the number of distinct events, both
  over projected events only.
- ADR-003's "counters plus first/last timestamps" are these columns: `firstOpenedAt`,
  `firstClickedAt` and `lastEventAt`, as data-modeling ratifies them. No per-type last timestamp is
  added.

`EmailRecipientState` (the [`email_recipients`](../../../.ai/data-modeling.md#email_recipients--outcome-per-email-and-recipient)
columns plus C3's six signal fields), `recipients` sorted by `recipientKey`:

- `{ emailId; recipientKey; addressMasked; status: EmailStatus | null; statusAt: Date | null; bounceType: string | null; bounceSubType: string | null; stickySignal: StickySignal | null; stickySignalAt: Date | null; stickySignalSvixId: string | null; softSignal: SoftSignal | null; softSignalAt: Date | null; softSignalSvixId: string | null }`.
- A recipient appears once any projected event's own `data.to` names it, and its row folds only
  those events (RS-27). `addressMasked = maskAddress(normalizeAddress(to[i]))` from the first naming
  event in fold order.
- `stickySignal`: each `email.bounced` with `data.bounce.type === 'Permanent'` → `hard_bounced`,
  `email.suppressed` → `suppressed`, `email.complained` → `complained`. The highest by sticky
  precedence wins; ties go to the earliest in fold order. A maximum, so adding events never lowers it.
- `softSignal`: the **latest** in fold order of the row's `email.delivered` events and
  non-`Permanent` `email.bounced` events (D7).
- Each signal's `*At` / `*SvixId` are that event's `eventCreatedAt` and `svixId`.

`RecipientState`: `{ recipientKey; addressMasked; deliverability; since: Date | null; causeEmailId: string | null }`.

**The deciding event (D5).** For the email status, and for each row's status, it is the outcome
event with the highest `(precedence(status), bounce.type === 'Permanent')`; ties go to the earliest
in fold order. A row's `statusAt`, `bounceType` and `bounceSubType` come from it, so a later
`Transient` bounce cannot displace a `Permanent` one, and `statusAt` means "since". Monotonicity
(property 3) is precedence-monotone: for event sets `A ⊆ B`, `precedence(status(B)) ≥
precedence(status(A))`; for `projectRecipient`, a sticky `deliverability(A)` implies a sticky
`deliverability(B)` of equal or higher sticky precedence.

**Why signals on the row (C3):** a row's `status` hides the signal deliverability needs. `failed`
outranks `suppressed`, and `bounced` outranks a later `delivered`. Monotonicity of sticky states
(Ships 5, property 3) fails if stickiness is read from `status`. **Alternative rejected:**
`projectRecipient` reading raw events across emails. data-modeling recomputes `recipient_state` from
`email_recipients` rows, so the row must carry what the recompute needs.

### D6 / D7 — `projectRecipient(recipientKey, rows)`

Input: `EmailRecipientState[]`; rows of other keys are skipped. It reads only the rows' signals,
never their `status`. A signal's event type maps `hard_bounced` and `bounced` → `email.bounced`,
`suppressed` → `email.suppressed`, `complained` → `email.complained`, `delivered` →
`email.delivered`.

1. **Sticky.** If any row has a `stickySignal`, `deliverability` is the highest by sticky
   precedence. Among signals of that value, the earliest by `(stickySignalAt, eventRank(type),
   stickySignalSvixId)` gives `since` (its `stickySignalAt`) and `causeEmailId` (its row's
   `emailId`).
2. **Else soft.** The latest `softSignal` across rows by `(softSignalAt, eventRank(type),
   softSignalSvixId)` decides: `delivered` → `ok`, `bounced` → `soft_bouncing`, with `since` and
   `causeEmailId` from it. A transient bounce followed by a delivery of the same email clears to
   `ok`.
3. **Else** `ok`, with `since` and `causeEmailId` null (C9).

`failed`, `sent`, `scheduled`, `delivery_delayed`, `opened` and `clicked` carry no deliverability
signal. `addressMasked` comes from the row with the smallest `emailId`.

**D7 (RS-U12 safe either way):** only the exact string `Permanent` is hard. Every other value
(`Transient`, `Temporary`, `Undetermined`, any unknown string, a missing `bounce` object) is soft.
The output does not depend on RS-U12's answer, and a misread costs at most one non-sticky state
until the next delivery.

**Authority:** [`recipient_state`](../../../.ai/data-modeling.md#recipient_state--deliverability-per-address)
(sticky set; `soft_bouncing` clears on a later `delivered`; recompute from `email_recipients` rows);
ADR-003 (hard bounce from `bounce.type = Permanent` only); RS-U12 owed by slice 0.
**Alternatives rejected:** deriving deliverability from a row's `status`; enumerating soft values
(it would depend on RS-U12's open answer).

### D8 / D9 / D10 — RS-U11, RS-U10, RS-U19 safe either way

- **D8 (RS-U11):** D1 makes `bounced` outrank `delivered` regardless of order or timestamps. The
  arbitraries generate histories with a bounce after a delivery by `created_at` and histories where
  every bounce precedes or replaces delivery. The test cites RS-U11.
- **D9 (RS-U10):** `eventCreatedAt` is only a sort key, with `eventRank` and `svixId` as
  tie-breaks. The arbitraries draw it from a small pool of instants (most sets tie, some on type
  too), with timestamps both consistent with the lifecycle order and unrelated to it. Permutation
  invariance and oracle agreement hold in both. The test cites RS-U10.
- **D10 (RS-U19):** `data.suppressed` is optional. A schema test parses the page's example with and
  without it; the arbitrary generates both, and the `suppressed` outcome is identical. The test
  cites RS-U19.

**Authority:** ADR-003's **Conditional** clause; [resend.md → Unverified](../../../.ai/resend.md#unverified)
(each row owed by slice 0 "safe either way"). **Alternative rejected:** settling any of them by a
live send now (Ask-first, and slice 1 and 4 own the experiments).

### D13 / D14 — Normalization and masks

`normalizeAddress(a) = a.trim().toLowerCase()`, locale-independent, with no display-name parsing
(D14). Masks are pure code-point operations, done in this order:

1. Map every `\p{Cc}` (C0, DEL, C1) to `*`.
2. Tokenize. Separators are `\p{White_Space}`, `\p{P}` and `\p{S}`, except `*`, which is a token
   character. Separators are kept.
3. Each token of length `n` keeps its first `min(3, ⌊n/3⌋)` characters; the rest become `*`.
4. Every `\p{Nd}` becomes `*`, kept characters included.

- `maskText(s)` (subject, display name): steps 1–4.
- `maskAddress(a)`: steps 1 and 4 apply. Split at the **last** `@`. The local part is one token
  (step 3). Each `.`-separated domain label keeps its first character. With no `@`, the whole string
  is a local part. `delivered@resend.dev` → `del******@r*****.d**`.
- `maskFrom(f)`: when `f` ends in `>` and holds a `<`, split at the last `<`. The prefix
  (whitespace included) goes through `maskText`, the part between `<` and `>` through
  `maskAddress`, and `<` and `>` are kept. Otherwise `maskAddress(f)`. Splitting at the last `<`
  keeps the length, and the second pass splits at the same place, so the mask stays idempotent.

**Authority:** [data-modeling → PII & retention](../../../.ai/data-modeling.md#pii--retention)
(the mask table and rules) and [Modeling conventions](../../../.ai/data-modeling.md#modeling-conventions-canonical)
(one normalization function in core).
**Why `*` is a token character:** with `*` as a separator, `del******` re-tokenizes to `del` and
idempotence fails. Mapping control characters before tokenizing keeps them from acting as
separators that change token lengths on a second pass. This is the minimal reading under which the
ratified idempotence property can hold. **Alternative rejected:** masking control characters after
tokenizing (they would split tokens, and a second pass would keep different characters).

### D15 / D16 — Arbitraries and `pnpm sim`

`ledgerHistory({ namespace })` lives in `@ledger/core/testing`, so core's properties and `sim` share
one generator (pp-testing → properties-and-arbitraries). `emailHistory(options)` (one email) stays
internal to core's tests. Both generate:

- every outbound type, plus unknown types and schema-failing payloads of known types;
- `created_at` from a small pool of instants (ties), in both RS-U10 worlds;
- bounce after delivery present and absent (RS-U11);
- `data.bounce.type` from `Permanent`, `Transient`, `Temporary`, `Undetermined` and any string
  (RS-U12);
- `data.suppressed` present and absent (RS-U19);
- control characters in local parts, labels, display names and subjects;
- `@resend.dev` addresses only, with `+label` forms;
- ids (`svix_id`, `email_id`, `+label`) from `namespace` plus a counter, fresh per event;
- `recipientKeys = to.map(normalizeAddress)`.

`ledgerHistory` adds: at least 2 emails of at least 2 events each, several recipients per email,
recipients shared across emails, each event's `data.to` a subset, and sticky events followed by
higher-ranked non-sticky ones on the same email (`suppressed` then `failed`, `complained` then a
`Transient` bounce). The minimum sizes make every `pnpm sim` run hold an email id to compare, and
make `--duplicates 0.3` repeat at least one event.

`pnpm sim` (D16):

- **Root script:** `"sim": "node --env-file-if-exists=.env.local sim/src/main.ts"`. No variable is
  read in slice 0.
- **Flags** (`node:util` `parseArgs`): `--seed <uint32>`, `--namespace <[a-z0-9-]{1,32}>`,
  `--duplicates <ratio>` (0 ≤ r ≤ 1, default 0), `--shuffle` (default off). A missing `--seed` /
  `--namespace` is chosen with `node:crypto` (`randomInt`, `randomBytes`): the run's only unseeded
  values.
- **Generation:** the history is `fc.sample(ledgerHistory({ namespace }), { seed, numRuns: 1 })[0]`.
  Duplicates repeat a seeded `⌊r·n⌋` of its `n` events. The shuffle is a seeded permutation drawn by
  `fc.sample` from the same seed. The projection is `projectEmail` per email, then
  `projectRecipient` per recipient key.
- **Output** (stdout, `\n`-terminated), exit `0`:
  - line 1: `sim seed=<seed> namespace=<namespace>`;
  - line 2: `history emails=<m> events=<n> duplicates=<d> shuffled=<true|false>`, where `n` counts
    the generated events (skipped ones included) and `d` the repeats added;
  - then a two-space-indented JSON document `{ "emails": [...], "recipients": [...] }`, sorted by
    `emailId` and by recipient key, with ISO timestamps. It carries **masks only**: `recipientKey`
    is omitted, because in slice 0 it is the normalized address.
- **Bad flags:** one line `sim: <flag> <reason>` on stderr, exit `2`, no projection printed.

The JSON block is identical with or without `--shuffle` / `--duplicates` for one seed and namespace:
order independence, shown at the terminal.

**As built:** `sim/src/main.ts` is the entry point and composes four one-export modules
(pp-general → coding-standards): `read-sim-flags.ts` (`readSimFlags`, the flags and their
`sim: <flag> <reason>` errors), `sample-once.ts` (`sampleOnce`, one seeded `fc.sample` draw),
`arrange-events.ts` (`arrangeEvents`, the seeded duplicates and permutation) and
`project-ledger.ts` (`projectLedger`, the per-email and per-recipient projection, masks only).

`sim` declares `"@ledger/core": "workspace:*"` under `dependencies`, because `main.ts` imports it at
runtime, and `fast-check` under `devDependencies` as approved. Biome's `noUndeclaredDependencies`
runs with default options, which accept a devDependency import from `sim/src/main.ts` (probed
2026-10-16).

**Authority:** [pp-testing → properties-and-arbitraries](../../../.agents/skills/pp-testing/references/properties-and-arbitraries.md#what-they-generate)
and [simulator.md → Seed and determinism](../../../.agents/skills/pp-testing/references/simulator.md#seed-and-determinism),
which leaves each knob's mechanism to this slice. **Alternative rejected:** separate generators for
the properties and for `sim` (the simulator would stop checking the model the properties check).

### D17 — Boundary test

`packages/core/src/import-boundaries.test.ts` (unit tier):

1. Copies `biome.json`, `packages/core/package.json` and `packages/aws/package.json` into a temp
   directory under `os.tmpdir()`, at the same relative paths.
2. Writes one fixture file per case.
3. Runs Biome from there: the running `node` binary on the repo's
   `node_modules/@biomejs/biome/bin/biome`, with `lint --vcs-enabled=false --reporter=json`. Not
   `node_modules/.bin/biome`: on Windows that is a `.cmd`, which `spawnSync` refuses without a shell
   (`EINVAL`).
4. Asserts on `lint/style/noRestrictedImports` per file, matching diagnostic paths after
   normalizing `\` to `/` (Windows reports backslashes). Other rules (`noUndeclaredDependencies`
   fires on every fixture) are ignored.

Cases: in `packages/core/src/`, `pg`, `drizzle-orm`, `drizzle-orm/pg-core`, `resend` and
`@aws-sdk/client-sqs` each raise `noRestrictedImports`, and `zod` raises none. In
`packages/aws/src/`, `@aws-sdk/client-sqs` raises none and a deep `@ledger/db/src/x.ts` raises it:
an override's list **replaces** the base list. That is what Biome 2.5.15 reported when probed on
2026-10-16; the test pins it and settles the about.md bullet.

**Authority:** Ships 7; ADR-013; [about.md → Open questions](../../../.ai/about.md#open-questions)
("unproven until the deliberate-violation fixture lands"). The bullet says "fails the lint stage":
this test runs the same binary and the same committed `biome.json` the lint stage runs.

**Alternatives rejected:**

- Biome over stdin: it reports no rule in 2.5.15 (probed, PP §5).
- A violating file committed in the tree: it would fail lint for everyone.
- `@biomejs/js-api`: a new dependency for the same binary.

If Biome stops linting from the temp directory, apply stops and reports. No fallback is invented.

### D18 — `secrets` stage

`scripts/secret-scan.mjs` uses Node built-ins only, spawns `docker` and `git` with argument arrays
(no shell), and runs after `docker`. Image:
`ghcr.io/gitleaks/gitleaks:v8.30.1@sha256:c00b6bd0aeb3071cbcb79009cb16a60dd9e0a7c60e2be9ab65d25e6bc8abbb7f`.
Every scan uses the same arguments: `git --log-opts=--all --config /config/.gitleaks.toml --redact
--no-banner --exit-code 1 /repo`, with `-v <repo>/.gitleaks.toml:/config/.gitleaks.toml:ro` and
`-e GIT_CONFIG_COUNT=1 -e GIT_CONFIG_KEY_0=safe.directory -e GIT_CONFIG_VALUE_0=*` (the
container's user does not own the mount).

1. **Canary.** A temp git repo under `os.tmpdir()` with one commit holding three fake values,
   assembled at runtime from fragments so no tracked line matches a rule. A `git clone --mirror`
   of it, the repo scan's input shape, is mounted at `/repo` and scanned with the arguments above
   plus `--report-format json --report-path -`. The canary
   passes only on exit 1 with a finding whose `RuleID` is each of `resend-api-key`,
   `resend-webhook-secret` and `postgres-url`. That is the bullet's "exits 1 on a scratch commit
   carrying a fake key", run by this stage's own command.
2. **Repo.** `git clone --mirror <repo> <tmp>/repo.git`, mounted read-only at `/repo` and scanned
   with the same arguments. It must exit 0. `<k>` is `git rev-list --all --count` in the mirror.

Temp dirs are removed in `finally`. Output: `secrets: canary caught 3/3 rules`, then
`secrets: repo clean (<k> commits scanned)`; on failure `secrets: canary missed rule <id>` (exit 1,
the repo is not scanned) or gitleaks' redacted findings (exit 1).

`.gitleaks.toml` (valid in v8.30.1, probed 2026-10-16):

```toml
[extend]
useDefault = true

[[rules]]
id = "resend-api-key"
regex = '''\bre_[A-Za-z0-9_]{20,}'''

[[rules]]
id = "resend-webhook-secret"
regex = '''\bwhsec_[A-Za-z0-9+/]{20,}={0,2}'''

[[rules]]
id = "postgres-url"
regex = '''postgres(?:ql)?://[^\s:/@]+:[^\s@/]+@[^\s/:?#]+'''
[[rules.allowlists]]
regexTarget = "match"
regexes = ['''@(?:localhost|127\.0\.0\.1)$''']
```

Each rule also carries a `description`. The allowlist covers the compose and Testcontainers
throwaway credentials. It is anchored at the end of the match, which stops before any `:port` or
`/db`: unanchored, it also allowlisted a real host that merely starts with `localhost.` or
`127.0.0.1.` (probed in `wf-after-apply-check`, 2026-10-17).

**Authority:** Ships 3; [architecture.md → Technology](../../../.ai/architecture.md#technology)
(secret scan); [about.md → Risk appetite](../../../.ai/about.md#risk-appetite).

**Why a mirror clone:** in a worktree `.git` is a file pointing outside any mount, so a mounted
checkout has no history. A mirror carries every ref and avoids Windows `.git` lock files. **Why the
canary:** the bullet's "scratch commit" evidence recurs at every review, so lens clause 1 scripts
it. **Why `--redact`:** CI logs are public (Risk appetite). **Alternatives rejected:** the gitleaks
binary or an npm wrapper (Docker is already required); the GitHub gitleaks action (it would run a
different command from the local one).

### D19 — `links` stage (owner-ruled 2026-10-16)

`scripts/check-links.mjs` uses Node built-ins and runs after `lint`. With no arguments it checks
`README.md`; arguments name other files. Its canary runs first: in a fresh temp directory it writes
`target.md` (one heading) and `probe.md` with one valid anchor link to `target.md`, one link to a
missing anchor in it and one link to a missing file. It must report exactly one `missing anchor`
and one `missing file`. The check:

- extracts inline links and images;
- skips `http(s):` and `mailto:`;
- resolves each path from the file that holds it, to an existing file or directory;
- matches each anchor against GitHub-style heading slugs (lowercase, drop characters other than
  letters, marks, numbers, spaces, `-` and `_`, spaces to `-`, duplicates suffixed `-1`, `-2`, …)
  or an explicit `id`/`name`.

Output: `links: canary caught 2/2`, then `links: <file> <n> checked, <k> broken`, then one
`<file>:<line> <target> (missing file|missing anchor)` per broken link. Exit 1 if any link is broken
or the canary misses (`links: canary missed <reason>`).

**Alternatives rejected:** a link-checker image or npm package (a dependency plus network in the
merge gate); external URL checks (owner-ruled out, tripwire in PP §3).

### D20 — Gate order

`STAGES` becomes `install, docker, secrets, lint, links, typecheck, unit, synth, e2e`. `secrets`
runs early so a leak fails fast, and after `docker` because it needs it. The header comment drops
"gitleaks and the README link check (slice 0)" from its planned list. `ci.yml` is untouched, which
keeps it "the same command in CI" by construction.

### Evidence map

Every reliability claim, and the test that carries it (PP §20):

| Claim (spec) | Evidence | Tier |
| --- | --- | --- |
| Order independence, duplicates, monotonicity, oracle; RS-U10, RS-U11 (`projections`) | `project-email.projection.prop.test.ts` | property |
| The same four properties for recipients; sticky after higher-ranked non-sticky; RS-U12; soft clears on later delivery (`projections`) | `project-recipient.projection.prop.test.ts` | property |
| Two-recipient bounce (`projections`) | `project-email.projection.prop.test.ts` | property |
| Unprojectable events skipped, never fatal (`projections`) | `project-email.projection.test.ts` | unit |
| Schemas parse doc examples; RS-U19; open bounce strings; extra fields (`event-schemas`) | `email-event.schema.test.ts` | unit |
| Masks idempotent, length-preserving, no digit, ≤ 3 revealed, no `\p{Cc}` (`address-masking`) | `mask-text.prop.test.ts`, `mask-address.prop.test.ts`, `mask-from.prop.test.ts`; ratified examples in `normalize-address.test.ts` and each mask's unit cases | property, unit |
| Core boundary; override scoping (`core-import-boundary`) | `import-boundaries.test.ts` | unit |
| Sim determinism, knobs, masks-only stdout, bad flags (`simulator`) | `sim/src/main.e2e.test.ts` | e2e |
| The knobs reorder and repeat what is projected (`simulator`) | `sim/src/arrange-events.test.ts` | unit |
| Secret scan catches each rule and the repo is clean (`verify-gate`) | the `secrets` stage's canary and repo scan, every run | gate |
| Link check catches missing anchor and file (`verify-gate`) | the `links` stage's canary, every run | gate |

`numRuns` stays at fast-check's default. A failing seed becomes a named regression
(pp-testing → locking a regression).

## Risks / Trade-offs

- **[gitleaks container can't read the mirror on Windows: path translation, `safe.directory`]** →
  Probed 2026-10-16: a Windows-path mount of a mirror with `safe.directory` passed by env scans the
  full history. Task 8.2 still runs the script from a worktree and from a fresh non-worktree clone;
  CI on Linux is the second check. `spawnSync` with an argument array avoids shell path mangling.
- **[Biome won't lint from a temp directory: `$schema`, VCS, `overrides` path matching]** → Probed
  2026-10-16: it lints, with the D17 launcher and path normalization. The boundary test is still
  the first step of its task group; stop and report rather than commit a violating file.
- **[Biome's JSON reporter is "experimental and may change in patch releases"]** → Biome is pinned
  exactly (`2.5.15`); a version bump that changes the shape fails the boundary test loudly.
- **[A Resend doc example contradicts RS-26–RS-29, or the pages changed]** → Fetch and parse first in
  the schema group. Record any contradiction in resend.md.
- **[fast-check sampling differs across platforms, breaking sim determinism]** → Exact pin; the e2e
  test runs on Windows locally and Linux in CI.
- **[The precedence order proves wrong after slice 1's real sends]** → Owner-ruled. Slice 1's RS-U15
  and RS-U21 sends show real sequences. A change is a rebuild (Deferred tripwire).
- **[GitHub's slug algorithm differs for an exotic heading]** → Fails loudly as a false "missing
  anchor", never silently. README's anchors pass in the link group.
- **[A `re_` key shorter than 20 characters after the prefix goes unmatched]** → gitleaks' default
  rules still apply. Record the format in resend.md if a real key is ever seen; never commit it.
- **Trade-off: the six signal fields on `EmailRecipientState`** widen slice 1's `email_recipients`
  table. Accepted (C3): without them, `recipient_state` cannot be recomputed from rows correctly.

## Migration Plan

None. No deploy, no table, no migration. Rollback is reverting the commits: each task group lands
as its own commit, so any one reverts alone.
