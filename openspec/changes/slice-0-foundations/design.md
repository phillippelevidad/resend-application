# Design — slice 0: Foundations

## Context

See [proposal.md → Why](proposal.md#why). The pre-proposal
[2026-10-16-slice-0-foundations.md](../../../.ai/pre-proposals/2026-10-16-slice-0-foundations.md)
(*PP*) is decision-complete and checked. This design carries its decisions forward by number
(D1–D21, C1–C10), adds no new ones, and states the "how" `opsx:apply` builds from. Where a detail
is long (mask tokenization, sim output lines), the PP section is the full statement and this file
names it.

State on `HEAD` (verified 2026-10-16, PP §5):

- `packages/core/src/index.ts` and `sim/src/main.ts` are `export {}` stubs.
- `scripts/verify.mjs` runs `install, docker, lint, typecheck, unit, synth, e2e`. CI runs it
  unchanged and already fetches full history (`fetch-depth: 0`).
- `biome.json` already bans `pg`, `drizzle-orm`, `drizzle-orm/**`, `resend` and `@aws-sdk/*` in
  `packages/core/**` and `packages/shared/**`. Nothing tests the ban.
- Installed: Zod 4.6.7 (for `packages/api`; `z.looseObject`, `z.iso.datetime({ offset: true })` and
  `z.discriminatedUnion` exist and behave as D11 needs, checked 2026-10-16) and Biome 2.5.15.
  fast-check is not installed; `4.10.2` exists on npm.
- Vitest projects: `unit` takes `{packages,apps,sim,infra}/**/*.test.ts` minus `int` and `e2e`;
  `e2e` takes `{apps,sim}/**/*.e2e.test.ts`. `scripts/` is in no project.
- Node 24 type stripping, no build step. `@ledger/*` exports point at `./src/*.ts`.

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

### 1. Module layout in `packages/core` (D21)

Kebab-case files with role suffixes (pp-general → coding-standards), each beside its tests:

| File | Export | Decision |
| --- | --- | --- |
| `email-event-types.ts` | `emailEventTypes` (`as const`, ten outbound types) | D11 |
| `webhook-envelope.schema.ts` | `webhookEnvelopeSchema` | D11 |
| `email-event.schema.ts` | `emailEventSchema` | D11 |
| `email-status.schema.ts` | `emailStatusSchema` | D2 |
| `deliverability.schema.ts` | `deliverabilitySchema` | D2 |
| `sticky-signal.schema.ts`, `soft-signal.schema.ts` | `stickySignalSchema`, `softSignalSchema` | D4 |
| `event-rank.ts` | `eventRank` | D1 |
| `ledger-event.ts` | `LedgerEvent` type | D3 |
| `project-email.projection.ts` | `projectEmail` | D3–D5 |
| `project-recipient.projection.ts` | `projectRecipient` | D6, D7 |
| `normalize-address.ts` | `normalizeAddress` | D14 |
| `mask-text.ts`, `mask-address.ts`, `mask-from.ts` | `maskText`, `maskAddress`, `maskFrom` | D13 |
| `testing.ts` → `testing/ledger-history.ts` | `ledgerHistory` (public via `./testing`) | D15 |
| `testing/email-history.ts` | `emailHistory` (core-internal) | D15 |
| `fixtures/resend/<type-kebab>.json` | Resend doc examples | D12 |

`index.ts` re-exports every primary export. `package.json` gains `"./testing": "./src/testing.ts"`,
because `sim` imports it in this diff. Closed sets are Zod enums with inferred types, never a
TypeScript `enum` (pp-general → Never).

**Alternative rejected:** one `events.ts` holding schemas and types. It breaks the one-primary-export
file rule and makes the boundary test's fixtures harder to place.

### 2. Schemas: envelope first, then a typed union (D11, D12)

Parsing is two-step. `webhookEnvelopeSchema` (`z.looseObject` of `type`, `created_at` with offset,
`data`) accepts every payload, unknown types included. Only when `type` is in `emailEventTypes` is
`emailEventSchema`, a `z.discriminatedUnion('type', …)` of `z.looseObject` members, applied.
Required fields are only `type`, `created_at`, `data.email_id` and `data.to`. Every event-specific
object is optional. `bounce.type` and `subType` are `z.string()`.

Fixtures are fetched at apply from each `webhooks/emails/<type>.md` page (ten outbound types plus
`email.received` for the envelope). A table in `email-event.schema.test.ts` records
`{ file, sourceUrl, fetchedOn }` and any address substituted with a Resend test address. An example
that contradicts RS-26–RS-29 is recorded in resend.md, never absorbed (C1).

**Why:** an over-strict schema skips real events, which is lost state (tie-break: correctness
first). **Alternative rejected:** a union including a catch-all member for unknown types. It blurs
"typed" from "kept raw" and makes the projection's skip rule implicit.

### 3. Precedence: one rank table (D1, D2; owner-ruled 2026-10-16)

`eventRank`: `scheduled` 0 · `sent` 1 · `delivery_delayed` 2 · `delivered` 3 · `opened` 4 ·
`clicked` 5 · `complained` 6 · `suppressed` 7 · `failed` 8 · `bounced` 9 · other 10. It serves both
as ADR-003's fold tie-break `rank(type)` and, restricted to the eight statuses, as outcome
precedence. Sticky precedence follows it: `hard_bounced` > `suppressed` > `complained`.

**Alternatives rejected:** recency (`last_event`, ADR-003 rejects it); equal-rank terminal negatives
(strict monotonicity would fail on a late-sorted second terminal type); a live Resend lookup from
core (ADR-012, ADR-013, RS-31).

### 4. `projectEmail(emailId, events)` (D3–D5, D8, D9)

1. Parse each `LedgerEvent.payload` (envelope, then typed).
2. Skip, never throw: non-outbound types, schema failures, `eventCreatedAt === null`, another
   `data.email_id`, `recipientKeys` null or misaligned with `data.to` (ADR-004 "stored raw, skipped
   by projections and counted").
3. Dedupe by `svixId`.
4. Sort by `(eventCreatedAt, eventRank(type), svixId)` and fold.

Output `EmailState` and `EmailRecipientState[]` (sorted by `recipientKey`) as PP D4 lists them,
field for field. The deciding event is the max of `(precedence, bounce.type === 'Permanent')`, ties
to the earliest in fold order (D5). Each recipient row folds only events whose own `data.to` names
it (RS-27), and carries two signals:

- `stickySignal`: max by sticky precedence over the row's `Permanent` bounces, `suppressed` and
  `complained` events. Earliest wins ties.
- `softSignal`: the latest in fold order of the row's `delivered` and non-`Permanent` bounces.

Each signal carries its event's `eventCreatedAt` and `svixId`.

**Why signals on the row (C3):** a row's `status` hides the signal deliverability needs. `failed`
outranks `suppressed`, and `bounced` outranks a later `delivered`. Monotonicity of sticky states
(Ships 5, property 3) fails if stickiness is read from `status`. **Alternative rejected:**
`projectRecipient` reading raw events across emails. data-modeling recomputes `recipient_state` from
`email_recipients` rows, so the row must carry what the recompute needs.

### 5. `projectRecipient(recipientKey, rows)` (D6, D7)

Reads only the rows' signals, never their `status`:

1. **Sticky.** If any row has a `stickySignal`, take the highest by sticky precedence. Ties go to the
   earliest by `(stickySignalAt, eventRank(type), stickySignalSvixId)`.
2. **Else soft.** The latest `softSignal` by `(softSignalAt, eventRank(type), softSignalSvixId)`:
   `delivered` → `ok`, `bounced` → `soft_bouncing`.
3. **Else** `ok`, with `since` and `causeEmailId` null (C9).

Only the exact string `Permanent` is hard. Every other value, missing included, is soft (D7). That
makes the output independent of RS-U12's answer, and a misread costs at most one non-sticky state.
`addressMasked` comes from the row with the smallest `emailId`.

### 6. Normalization and masks (D13, D14)

`normalizeAddress = trim().toLowerCase()`. Masks are pure code-point operations, done in this order:

1. Map `\p{Cc}` to `*`.
2. Tokenize. Separators are `\p{White_Space}`, `\p{P}` and `\p{S}`, except `*`.
3. Keep `min(3, ⌊n/3⌋)` of each token.
4. Mask every `\p{Nd}`.

`maskAddress` splits at the last `@` and keeps the first character of each domain label. `maskFrom`
handles `Name <addr>`. Full rules: PP D13.

**Why `*` is a token character:** with `*` as a separator, `del******` re-tokenizes to `del` and
idempotence fails. Mapping control characters before tokenizing keeps them from acting as
separators that change token lengths on a second pass. This is the minimal reading under which the
ratified idempotence property can hold.

### 7. Arbitraries and `pnpm sim` (D15, D16)

`ledgerHistory({ namespace })` lives in `@ledger/core/testing`, so core's properties and `sim` share
one generator (pp-testing → properties-and-arbitraries). It generates every case PP D15 lists. The
cases that carry this slice's evidence:

- `created_at` drawn from a small pool of instants (ties), in both RS-U10 worlds;
- bounce after delivery present and absent (RS-U11);
- `bounce.type` from `Permanent`, `Transient`, `Temporary`, `Undetermined` and any string (RS-U12);
- `data.suppressed` present and absent (RS-U19);
- sticky events followed by higher-ranked non-sticky ones on the same email;
- control characters in text fields;
- `@resend.dev` addresses only;
- ids from namespace plus counter.

`sim/src/main.ts` parses flags with `node:util` `parseArgs`. It samples one history with
`fc.sample(ledgerHistory({ namespace }), { seed, numRuns: 1 })[0]`, applies seeded duplicates and a
seeded permutation, projects, and prints the PP D16 lines. The JSON carries masks only, with
`recipientKey` omitted, because in slice 0 the key is the normalized address. Unseeded values are
only a missing `--seed` / `--namespace` (`node:crypto`). Root script:
`"sim": "node --env-file-if-exists=.env.local sim/src/main.ts"`.

`sim` declares `"@ledger/core": "workspace:*"` under `dependencies`, because `main.ts` imports it at
runtime. It declares `fast-check` under `devDependencies` as approved: Biome's
`noUndeclaredDependencies` runs with default options in `biome.json`, which accept a devDependency
import from non-test code.

### 8. Boundary test (D17)

`packages/core/src/import-boundaries.test.ts` (unit tier) does four things:

1. Copies `biome.json`, `packages/core/package.json` and `packages/aws/package.json` into a temp
   directory under `os.tmpdir()`.
2. Writes one fixture file per case.
3. Runs `node_modules/.bin/biome lint --vcs-enabled=false --reporter=json` from there.
4. Asserts on `lint/style/noRestrictedImports` per file.

The `packages/aws` pair pins override semantics and settles the about.md bullet.

**Alternatives rejected:**

- Biome over stdin: it reports no rule in 2.5.15 (probed, PP §5).
- A violating file committed in the tree: it would fail lint for everyone.
- `@biomejs/js-api`: a new dependency for the same binary.

If Biome cannot lint from the temp directory, apply stops and reports. No fallback is invented.

### 9. `secrets` stage (D18)

`scripts/secret-scan.mjs` uses Node built-ins only and runs after `docker`. It has two phases:

1. **Canary.** A temp git repo with one commit holding three fake values, assembled at runtime from
   fragments. The pinned image must exit 1 with findings for `resend-api-key`,
   `resend-webhook-secret` and `postgres-url`.
2. **Repo.** `git clone --mirror` into a temp dir. Then
   `docker run --rm -v <mirror>:/repo:ro -v <repo>/.gitleaks.toml:/config/.gitleaks.toml:ro`, with
   `safe.directory=*` set through `GIT_CONFIG_*` env, runs
   `<image> git --log-opts=--all --config /config/.gitleaks.toml --redact --no-banner --exit-code 1 /repo`.
   It must exit 0. Temp dirs are removed in `finally`.

`.gitleaks.toml`: `[extend] useDefault = true` plus three rules:

- `resend-api-key`: `\bre_[A-Za-z0-9_]{20,}`.
- `resend-webhook-secret`: `\bwhsec_[A-Za-z0-9+/]{20,}={0,2}`.
- `postgres-url`: `postgres(?:ql)?://[^\s:/@]+:[^\s@/]+@[^\s/:?#]+`, with an allowlist for
  `localhost` and `127.0.0.1`.

The `[[rules.allowlists]]` syntax is checked against v8.30.1's docs at apply.

**Why a mirror clone:** in a worktree `.git` is a file pointing outside any mount, so a mounted
checkout has no history. A mirror carries every ref and avoids Windows `.git` lock files. **Why the
canary:** the bullet's "scratch commit" evidence recurs at every review, so lens clause 1 scripts
it. **Alternatives rejected:** the gitleaks binary or an npm wrapper (Docker is already required);
the GitHub gitleaks action (would diverge from the local command).

### 10. `links` stage (D19; owner-ruled 2026-10-16)

`scripts/check-links.mjs` uses Node built-ins and runs after `lint`. With no arguments it checks
`README.md`; arguments name other files. Its canary runs first, on a temp `target.md` and
`probe.md`, and must report exactly one `missing anchor` and one `missing file`. The check:

- extracts inline links and images;
- skips `http(s):` and `mailto:`;
- resolves each path from the file that holds it;
- matches each anchor against GitHub-style heading slugs (lowercase, drop characters other than
  letters, marks, numbers, spaces, `-` and `_`, spaces to `-`, duplicates suffixed `-1`, `-2`, …)
  or an explicit `id`/`name`.

Output lines are as PP D19 gives them. **Alternatives rejected:** a link-checker image or npm package
(a dependency plus network in the merge gate); external URL checks (owner-ruled out, tripwire in PP
§3).

### 11. Gate order (D20)

`STAGES` becomes `install, docker, secrets, lint, links, typecheck, unit, synth, e2e`. `secrets`
runs early so a leak fails fast, and after `docker` because it needs it. The header comment drops
the slice-0 items from its planned list. `ci.yml` is untouched, which keeps it "the same command in
CI" by construction.

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
| Secret scan catches each rule and the repo is clean (`verify-gate`) | the `secrets` stage's canary and repo scan, every run | gate |
| Link check catches missing anchor and file (`verify-gate`) | the `links` stage's canary, every run | gate |

`numRuns` stays at fast-check's default. A failing seed becomes a named regression
(pp-testing → locking a regression).

## Risks / Trade-offs

- **[gitleaks container can't read the mirror on Windows: path translation, `safe.directory`]** →
  Run `node scripts/secret-scan.mjs` by hand before wiring the stage, from this worktree and the main
  checkout. CI on Linux is the second check. `spawnSync` with an argument array avoids shell path
  mangling.
- **[Biome won't lint from a temp directory: `$schema`, VCS, `overrides` path matching]** → The
  boundary test is the first step of its task group. Stop and report rather than commit a violating
  file.
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
