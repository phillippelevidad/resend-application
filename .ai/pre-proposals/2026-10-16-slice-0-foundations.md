# Pre-proposal — slice 0: Foundations

| Field | Value |
| --- | --- |
| **Slice** | 0 — [Foundations](../build-checklist.md#0--foundations) |
| Change name | `slice-0-foundations` → `openspec/changes/slice-0-foundations/` (first change; `openspec/changes/archive/` is empty) |
| Date | 2026-10-16 |
| Card status | `[~]` (two of ten `Ships` boxes ticked) |
| Depends on | — (foundational) |
| Track | Spine (0 → 1 → …) |
| Touches | `packages/core`, `sim`, `scripts/`, root `package.json`, `.gitleaks.toml` (new), `.ai/` docs, `AGENTS.md`, two skills' text |
| Earlier pre-proposal | None |
| Branch | `slice-0-foundations` |
| Checked | 2026-10-16 · 18 repaired, 0 for the owner |

## 1. Why now

Slice 0 is the root of the spine. Every later slice builds on its outputs: slice 1's worker commits
`projectEmail` / `projectRecipient` output under row locks, slice 1's `sim` run checks invariant 2 against
the same functions, and the read API maps the masks. Building these as pure `packages/core` code first
is the cheapest point to prove them. They are property-testable in milliseconds with no I/O
([ADR-003](../architecture.md#adr-003--projection-is-a-pure-function-of-the-event-set),
[ADR-013](../architecture.md#adr-013--pure-core-and-local-mode)), and once a projection reaches a kept
deploy, changing it triggers the rebuild deferral ([Deferred (YAGNI)](../architecture.md#deferred-yagni),
"Projection rebuild" row). The secret scan has to exist before the first real key or URL is
handled (slice 1 brings `.env.local` with `DATABASE_URL` and signing secrets).

## 2. Scope — the `Ships` list, verbatim

1. pnpm workspace with strict TypeScript, Biome and Vitest; `pnpm verify` mirrors CI stage for stage and exits 0 only when every stage ran and passed.
2. GitHub Actions CI runs `pnpm verify` on every push and pull request (`pull_request`, never `pull_request_target`; `permissions: contents: read`; third-party actions pinned by commit SHA; `pnpm install --frozen-lockfile`); evidence: a green run on a pushed commit.
3. `pnpm verify` runs a gitleaks stage over the full git history (`git --log-opts=--all`) from a version-pinned Docker image, the same command in CI, with `.gitleaks.toml` extending the default ruleset (`[extend] useDefault = true`) and adding rules for Resend API keys (`re_`), `whsec_` signing secrets and Postgres URLs; evidence: the stage exits 1 on a scratch commit carrying a fake key and 0 on the repo.
4. `packages/core` Zod schemas for the RS-25–RS-29 event types, event-specific objects optional, unknown types kept raw; evidence: schema unit tests over the resend.md payload examples.
5. `projectEmail` and `projectRecipient` pass fast-check properties 1–4: permutation invariance, idempotence, monotonicity (for `projectRecipient`, of the sticky states), oracle agreement (ADR-003).
6. `packages/core` address normalization and mask functions ([PII & retention](../data-modeling.md#pii--retention)); evidence: fast-check properties (masks idempotent, length-preserving, no digit revealed, at most 3 characters revealed per token, no control character) and the two-recipient property (a bounce naming one recipient leaves the other's outcome unchanged).
7. Lint rule rejects any AWS, Postgres or Resend import in `packages/core` (ADR-013); evidence: a deliberate-violation fixture fails the lint stage.
8. `sim` history generator with seed, duplicate and shuffle knobs; `pnpm sim` prints the projection of a generated, shuffled history, identical for a fixed seed and run namespace.
9. README skeleton states the problem, the positioning against the Ingester and the no-affiliation line; the CI link check reports 0 broken links.
10. RS-U10, RS-U11, RS-U12 and RS-U19 proved safe either way by named property and schema tests, each [Unverified] row citing its test.

**UI surfaces:** `pnpm verify` locally · the CI run on a pushed commit · `pnpm sim` printing a projection.
**Ops:** owner approves the CI workflow (Ask-first: CI change) and each new dependency, the gitleaks image included (Ask-first). Docker locally. No Resend or AWS step.

## 3. Out of scope

The card's **Deferred tail**, verbatim: "Drizzle schema, ingest, worker and read path ([slice 1](../build-checklist.md#1--local-ledger-and-read-path)). Any AWS resource ([slice 2](../build-checklist.md#2--durable-ingest-on-aws)). Simulator runs against a live process ([slice 1](../build-checklist.md#1--local-ledger-and-read-path)) and on AWS ([slice 3](../build-checklist.md#3--operations-and-evidence-on-aws))."

The harvest also turned up the following, none of which the card carries:

| Item | Carried by / tripwire |
| --- | --- |
| Keyed address hash (`address_hash`, `key_id`) | Slice 1: the worker is its first consumer ([PII & retention](../data-modeling.md#pii--retention)). Core projections take caller-supplied recipient keys (D3), so slice 0 needs no hash |
| `signWebhook` in `@ledger/core/testing` ([simulator.md → Signing](../../.agents/skills/pp-testing/references/simulator.md#signing) says "slice 0 or 1") | Slice 1: the first signed send is `pnpm sim` against `apps/local`. Slice 0's `sim` sends nothing (C10) |
| Sim invariant checkers, `LEDGER_SIMULATOR_SECRET`, a bounded settle wait | Slice 1 (invariants 1–2 against a live process) |
| A mask that is a fixed point of `normalizeAddress` (needed for redaction's "rebuild yields identical projections") | Slice 7, retention ([ADR-014](../architecture.md#adr-014--raw-payload-retention-and-redaction)); its rebuild integration test is the evidence |
| Checking external URLs in the link check | Owner-ruled 2026-10-16: relative links and anchors only (D19). Tripwire: a README external link is reported broken by a reader or reviewer |
| Link check over Markdown other than `README.md` | The first slice whose `Ships` names "the CI link check" for another file (slice 3 runbook, slice 10 learning log) adds that file to the script's list |
| Projections for non-email events, `email.received` | [Deferred (YAGNI)](../architecture.md#deferred-yagni), existing tripwires |
| README status-line refresh and the evidence links for the claims slice 0 proves | The M1 boundary ([slice 4](../build-checklist.md#4--recovery) Ships, lens clause 3). This slice links the evidence in `.ai/` docs only (section 22) |

## 4. Prerequisites

- **Slices:** none.
- **Owner ops:** Docker running locally (the `docker` stage already requires it). No Resend key, no AWS account.
- **Environment variables:** none read in this slice.
- **Open questions the slice depends on:** RS-U10, RS-U11, RS-U12, RS-U19 ([resend.md → Unverified](../resend.md#unverified)). Each MAY close here by a test that proves the design safe under both answers ([Open questions owed by slice](../architecture.md#open-questions-owed-by-slice)). Also the library bullet "Biome `overrides` scoping" ([about.md → Open questions](../about.md#open-questions)), which this slice settles (D17). None blocks.
- **Ask-first approvals:** granted in this run (section 7).

## 5. Reality check — per-`Ships`-item verdict

Checked against `HEAD` `a7616da` on `slice-0-foundations` (2026-10-16).

| # | Verdict | Evidence | What remains |
| --- | --- | --- | --- |
| 1 | **already done** | `scripts/verify.mjs:16-28` (stages install, docker, lint, typecheck, unit, synth, e2e; `VERIFY PASSED` only after a full run, `:96-106`); `tsconfig.base.json` strict; `biome.json`; `vitest.config.ts` | Ticked. Gains two stages (D18, D19) |
| 2 | **already done** | `.github/workflows/ci.yml:5-41` (`push` + `pull_request`, `permissions: contents: read`, SHA-pinned actions, `fetch-depth: 0`, runs `pnpm verify` whose first stage is `pnpm install --frozen-lockfile`); green run `38940186835` on this branch | Ticked. No edit needed (D20) |
| 3 | **absent** | No `.gitleaks.toml`, no `secrets` stage. `ci.yml:27-28` already fetches full history "for the gitleaks stage slice 0 adds". A history scan for `re_…`, `whsec_…` (≥ 20 chars) and credentialed `postgres://` URLs found none (only the bare `whsec_` prefix in docs) | Everything: D18 |
| 4 | **absent** | `packages/core/src/index.ts:1-2` is `export {}`; `zod` is not declared in `packages/core/package.json` (installed at 4.6.7 for `packages/api`) | Everything: D11, D12 |
| 5 | **absent** | No projection code; `fast-check` not installed | Everything: D1–D6, D8, D9 |
| 6 | **absent** | No normalization or mask code | Everything: D13, D14 |
| 7 | **partial** | The ban exists: `biome.json:71-103` (override for `packages/core/**` and `packages/shared/**` banning `pg`, `drizzle-orm`, `drizzle-orm/**`, `resend`, `@aws-sdk/*`). It was observed only by hand with throwaway files ([pp-general → Lint enforcement](../../.agents/skills/pp-general/references/imports-and-tsconfig.md#lint-enforcement-biome)). No committed fixture. Probe, 2026-10-16: `biome lint --stdin-file-path=…` in 2.5.15 echoes the input with "The contents aren't fixed" and reports no rule, so stdin can't carry the fixture | The committed fixture test: D17 |
| 8 | **absent** | `sim/src/main.ts:1-2` is `export {}`; no `sim` script in root `package.json` | Everything: D15, D16 |
| 9 | **partial** | `README.md` states the problem ("The problem"), positioning ("How it relates to Resend's Webhook Ingester") and the no-affiliation line ("It's an independent project, not affiliated with or endorsed by Resend."). Its 13 relative link targets all resolve by inspection. No link check exists | The check and its verify stage: D19. No README content change |
| 10 | **absent** | RS-U10/U11/U12/U19 rows cite no test ([resend.md:243-252](../resend.md#unverified)) | The tests (D7–D10, section 20) and the row edits (section 22) |

`openspec/specs/` is empty, so every capability in section 23 is `ADDED`.

## 6. Contradictions and how each resolves

| # | Sources disagree | Resolution |
| --- | --- | --- |
| C1 | Ships 4: "schema unit tests over **the resend.md payload examples**". But [resend.md](../resend.md#event-types-and-payloads-rs-25rs-30) holds no payload examples. It cites the pages that do (`webhooks/emails/*`, `webhooks/event-types`, [Sources](../resend.md#sources)) | The examples are those on the pages resend.md cites for RS-26–RS-30, fetched as `.md` at apply (AGENTS.md: "Verify Resend behavior; never assume it"). Each fixture records its page URL and fetch date (D12). The bullet's intent holds and its wording stays. resend.md's Sources gains a pointer to the fixtures (section 22) |
| C2 | The card's UI surfaces name "`pnpm verify` locally". But [rsa-manual-test hard rule 7](../../.agents/skills/rsa-manual-test/SKILL.md#hard-rules-must): "**Never run `pnpm verify` or the test suites.**" | Both stand. `wf-after-apply-check` runs `pnpm verify` and records it. The walkthrough reaches the `pnpm verify` surface through the two stage commands this slice adds (`node scripts/secret-scan.mjs`, `node scripts/check-links.mjs`), which are not the gate. It reaches the full gate through the CI run's log (section 21) |
| C3 | [data-modeling → `recipient_state`](../data-modeling.md#recipient_state--deliverability-per-address): `soft_bouncing` clears "by `event_created_at`, `rank` and `svix_id` breaking ties". But the recompute "reads every `email_recipients` row for the hash", and `email_recipients` carries no `svix_id` | A row's `status` alone cannot feed that rule: under D1 a later `failed` or non-`Permanent` `bounced` outranks a `suppressed` or `complained` on the same email, and a `bounced` outranks a later `delivered`, so the signal `recipient_state` needs is hidden behind the row's top status. Core's per-recipient email state carries two derived signals, each with its event's `event_created_at` and `svix_id` (`stickySignal*`, `softSignal*`, D4, D6). data-modeling's `email_recipients` table gains the six columns, so slice 1's schema has a source for them (section 22). The source-of-truth rule holds: each is computable from the event set |
| C4 | [ADR-003](../architecture.md#adr-003--projection-is-a-pure-function-of-the-event-set) lists terminal negatives as "`bounced`, `failed`, `suppressed`". `complained` is absent, yet `recipient_state.deliverability` has a sticky `complained` that can only come from the per-recipient email status ("The same closed set as `email_state.status`", [`email_recipients`](../data-modeling.md#email_recipients--outcome-per-email-and-recipient)) | `complained` is in the status closed set ("the outcome-bearing email types of RS-25", [`email_state`](../data-modeling.md#email_state--current-state-per-email)). It ranks above `delivered` (it always follows delivery, RS-29) and below the terminal negatives, which ADR-003 does not include it in. Full order owner-ruled (D1) |
| C5 | [features.md → Ledger & projections](../features.md#ledger--projections): "Recipient deliverability derived from email states … evidence: property test · slice 1". But the card puts `projectRecipient`'s properties 1–4 in slice 0 | The card governs: features.md's capability sections are non-binding ([features.md → Status](../features.md)). The bullet's pointer moves to slice 0 when the test lands (section 22) |
| C6 | [resend.md → Mechanisms](../resend.md#event-types-and-payloads-rs-25rs-30): "`Undetermined` neither" (hard nor soft). D7 folds every non-`Permanent` bounce, `Undetermined` included, into `soft_bouncing` | No conflict in fact. resend.md describes Resend's classification; `soft_bouncing` is Ledger's "a non-permanent bounce since the last delivery". Folding every non-`Permanent` value makes the result independent of RS-U12's answer, which is what "safe either way" requires. The `recipient_state` row in data-modeling states the fold rule (section 22) |
| C7 | [manage-emails → Understand email events](https://resend.com/docs/dashboard/emails/manage-emails.md) (fetched 2026-10-16) lists `canceled` and `queued`, which are not webhook event types in RS-25 | They are dashboard/API email states, not webhook types (RS-25's list is from `webhooks/event-types`). Neither enters the status set. Recorded as a new fact (section 22) |
| C8 | [idea §5.4](../../docs/idea.md#54-order-independent-projections) keeps `complained` as an orthogonal flag (`complained_at`) | Frozen RFC, never the rule. The ratified `email_state` field table has no `complained_at`. C4 governs |
| C9 | Nullability is unstated: `email_state.status` when an email has only `opened`/`clicked` events; `recipient_state.since` / `cause_email_id` when no event decided the state | `status` is null until an outcome-bearing event exists. Inventing `delivered` from an `opened` breaks the source-of-truth rule, and opens are unreliable (RS-29). `since` / `cause_email_id` are null while `ok` was decided by no event. data-modeling gains both notes. Slice 1's schema makes the columns nullable (section 22) |
| C10 | [simulator.md → Signing](../../.agents/skills/pp-testing/references/simulator.md#signing): `signWebhook` "slice 0 or 1 writes it" | Slice 1. Slice 0's `sim` signs and sends nothing. In-scope test: not in `Ships`, not required by one ([slice-scoping → 3](../../.agents/skills/pp-workflow/references/slice-scoping.md#3--the-in-scope-test)) |

Also checked with no conflict found: card `Ships` vs [architecture.md → Build order](../architecture.md#build-order-vertical-slices) row 0; `api-contract.md` has no `Slices: … 0 — Foundations` entry, and the card names no operation; [pp-testing → properties](../../.agents/skills/pp-testing/references/properties-and-arbitraries.md) vs the card's property list; [data-modeling → Slices: 0](../data-modeling.md#email_state--current-state-per-email) evidence lines vs Ships 5, 6 and 10.

## 7. Decisions

**Ask-first approvals** (owner, 2026-10-16, one itemized round):

| Item | Exact scope | Status | Used by |
| --- | --- | --- | --- |
| `fast-check` | `4.10.2` exact (npm `latest`, published 2026-09-19), `devDependencies` of `packages/core` and `sim` | owner-approved 2026-10-16 | Tasks 3–6 |
| `zod` in `packages/core` | `4.6.7` exact, the version ADR-019 ratified (installed for `packages/api`), `dependencies` of `packages/core` | owner-approved 2026-10-16 | Task 1 |
| gitleaks image | `ghcr.io/gitleaks/gitleaks:v8.30.1@sha256:c00b6bd0aeb3071cbcb79009cb16a60dd9e0a7c60e2be9ab65d25e6bc8abbb7f` (release v8.30.1, 2026-03-21; index digest read 2026-10-16) | owner-approved 2026-10-16 | Task 8 |
| CI change | Two new stages in `scripts/verify.mjs`, which CI runs unchanged: `secrets` and `links`. No edit to `.github/workflows/ci.yml` | owner-approved 2026-10-16 | Tasks 8, 9 |

Anything else (another dependency, another image, a `ci.yml` edit) stops at apply.

### D1 — Outcome precedence and `rank(type)` (owner-ruled 2026-10-16)

One constant table in `packages/core` (`event-rank.ts` → `eventRank`) serves as both ADR-003's fold tie-break `rank(type)` and outcome precedence, low → high:

`scheduled` 0 · `sent` 1 · `delivery_delayed` 2 · `delivered` 3 · `opened` 4 · `clicked` 5 · `complained` 6 · `suppressed` 7 · `failed` 8 · `bounced` 9 · any other type 10 (skipped by projections)

Status precedence is this order restricted to the eight statuses. Recipient sticky precedence follows it: `hard_bounced` > `suppressed` > `complained`.

**Authority:** owner, 2026-10-16. Asked to check Resend's docs or API first: *"Should we check that last status live with Resend to disambiguate in those cases, using an API call? Or maybe they have the answer for this in their docs. If "no" for both questions, then use your recommendation."* Both came back "no":
- The docs define each event alone ([manage-emails#understand-email-events](https://resend.com/docs/dashboard/emails/manage-emails.md)) and state no precedence.
- [Retrieve Email](https://resend.com/docs/api-reference/emails/retrieve-email.md) returns one `last_event`, which is recency, the thing ADR-003 rejects ("Rejected: incremental `UPDATE status = new`").
- A live read inside a projection would break the source-of-truth rule ([architecture.md → System shape](../architecture.md#system-shape)) and Resend's 30-day retention (RS-31).

So the recommendation applies. Rationale: the receiving server's rejection is the most definite outcome. `complained` is the only outcome that always follows delivery (RS-29, C4).
**Rules out:** recency-based status; equal-rank terminal negatives (strict monotonicity, D5, would fail on a late-sorted second terminal type); a Resend call from `packages/core` (ADR-012, ADR-013).

### D2 — The status closed set

`emailStatusSchema = z.enum(['scheduled','sent','delivery_delayed','delivered','complained','suppressed','failed','bounced'])`. This is the "outcome-bearing email types of RS-25" ([`email_state`](../data-modeling.md#email_state--current-state-per-email)): RS-25's outbound types minus the counters (`opened`, `clicked`) and the inbound `received`. `deliverabilitySchema = z.enum(['ok','soft_bouncing','hard_bounced','complained','suppressed'])` ([`recipient_state`](../data-modeling.md#recipient_state--deliverability-per-address)). These are closed sets as Zod enums in core ([Modeling conventions](../data-modeling.md#modeling-conventions-canonical)), and slice 1's `CHECK`s mirror them. `status` is `null` when the set holds no outcome-bearing event (C9).
**Rules out:** inferring `delivered` from `opened`/`clicked`; a TypeScript `enum` ([pp-general → Never](../../.agents/skills/pp-general/SKILL.md#never)).

### D3 — Projection input: the stored ledger row, never arrival data

`ledger-event.ts` → `LedgerEvent`: `{ svixId: string; type: string; eventCreatedAt: Date | null; recipientKeys: readonly string[] | null; payload: unknown }`. This is a `webhook_events` row ([table](../data-modeling.md#webhook_events--the-immutable-ledger)) minus `received_at`, `source` and the typed `email_id` (the caller passes the email id; the payload's `data.email_id` is checked against it), so projection code *cannot* read arrival time (Reliability core design test: "Projection code MUST NOT read `received_at`, prior projection state or arrival sequence"). `recipientKeys[i]` keys `data.to[i]`:
- Slice 1 passes `to_hashes`, which "Feeds `email_recipients` after redaction has masked the raw `to`".
- Slice 0's arbitraries pass `normalizeAddress(to[i])`.

`projectEmail(emailId, events)`:
1. Parses each `payload` with `emailEventSchema` (D11).
2. Skips an event that is not an outbound email type, fails its schema, has `eventCreatedAt === null`, names another `data.email_id`, or whose `recipientKeys` is null or of a different length than `data.to`. Each of these is "stored raw, skipped by projections and counted" ([ADR-004](../architecture.md#adr-004--immutable-ledger-keyed-on-svix_id-one-transaction-per-message), [Immutable ledger](../data-modeling.md#immutable-ledger)).
3. Dedupes by `svixId` (ADR-004 keys the ledger on it. Duplicates in an input are exact repeats).
4. Sorts by `(eventCreatedAt, eventRank(type), svixId)` (ADR-003) and folds.

**Authority:** ADR-003, ADR-004, data-modeling as cited.
**Rules out:** a projection that hashes or reads raw addresses for its key (it would break rebuild after redaction, ADR-014); throwing on bad input. `packages/core` sits below `packages/shared` and its error class, and pp-general bans `throw new Error(` in `packages/`, so skipping is the only total behavior.

### D4 — Projection output shapes

- `EmailState`: `{ emailId; status: EmailStatus | null; fromMasked: string | null; subjectMasked: string | null; openCount; clickCount; firstOpenedAt: Date | null; firstClickedAt: Date | null; lastEventAt: Date | null; eventCount; recipients: EmailRecipientState[] }` (columns of [`email_state`](../data-modeling.md#email_state--current-state-per-email)).
  - `recipients` is sorted by `recipientKey`.
  - `fromMasked` / `subjectMasked` come from the first event in fold order that carries the field.
  - `openCount` / `clickCount` count distinct `email.opened` / `email.clicked` events.
  - `first*At` is the minimum `eventCreatedAt` of that type.
  - `lastEventAt` is the maximum over projected events. `eventCount` is the number of distinct projected events.
- `EmailRecipientState`: `{ emailId; recipientKey; addressMasked; status: EmailStatus | null; statusAt: Date | null; bounceType: string | null; bounceSubType: string | null; stickySignal: StickySignal | null; stickySignalAt: Date | null; stickySignalSvixId: string | null; softSignal: SoftSignal | null; softSignalAt: Date | null; softSignalSvixId: string | null }` ([`email_recipients`](../data-modeling.md#email_recipients--outcome-per-email-and-recipient) plus C3's six signal fields).
  - A recipient appears once any projected event's own `data.to` names it (RS-27).
  - `addressMasked = maskAddress(normalizeAddress(to[i]))` from the first naming event in fold order.
  - Both signals are folded from the row's own events (those whose `data.to` names the recipient), never from `status`:
    - `stickySignal` (`stickySignalSchema = z.enum(['hard_bounced','suppressed','complained'])`): each `bounced` with `bounce.type === 'Permanent'` → `hard_bounced`, `suppressed` → `suppressed`, `complained` → `complained`. The highest by sticky precedence (`hard_bounced` > `suppressed` > `complained`, D1) wins; ties go to the earliest in fold order. It is a maximum over the row's events, so adding events never lowers it.
    - `softSignal` (`softSignalSchema = z.enum(['delivered','bounced'])`): the **latest** in fold order of the row's `delivered` events and non-`Permanent` `bounced` events (D7).
    - `*At` / `*SvixId` are that event's `eventCreatedAt` and `svixId`.
- `RecipientState`: `{ recipientKey; addressMasked; deliverability; since: Date | null; causeEmailId: string | null }` ([`recipient_state`](../data-modeling.md#recipient_state--deliverability-per-address)).

The types are inferred from Zod schemas where a closed set is involved, otherwise plain TypeScript types beside the function.
**Rules out:** any column with no source in the event set ([Anti-patterns](../data-modeling.md#anti-patterns-must-not)).

### D5 — The deciding event

For the email status and for each recipient's row, the deciding event is the projected outcome event (scoped to events whose own `data.to` names the recipient, for a row) with the highest `(precedence(status), bounce.type === 'Permanent')`. Ties go to the earliest in fold order.
- `statusAt` / `bounceType` / `bounceSubType` come from it.
- The `Permanent` flag makes a later-arriving `Transient` bounce unable to displace a `Permanent` one.
- "Earliest" makes `statusAt` mean "since".

Monotonicity (property 3) is precedence-monotone: for event sets `A ⊆ B`, `precedence(status(B)) ≥ precedence(status(A))`. For `projectRecipient`, a sticky `deliverability(A)` implies a sticky `deliverability(B)` of equal or higher sticky precedence. That holds only because D6 reads `stickySignal`, a maximum over events: a row's `status` is not sticky-monotone (a `suppressed` row becomes `failed` when a `failed` event is added, C3).
**Authority:** ADR-003 ("outcome precedence, not recency"); RS-35 (`Permanent` is the hard bounce); [pp-testing → properties](../../.agents/skills/pp-testing/references/properties-and-arbitraries.md#the-properties-slice-0-owes) row 3.
**Rules out:** "latest wins"; a property-3 reading that only checks `terminal ⇒ never delivered` (weaker than the sticky-state wording).

### D6 — `projectRecipient(recipientKey, rows)`

Input: `EmailRecipientState[]` (rows of other keys are skipped). It reads the rows' signals (D4), never their `status`. Rules, in order:
1. **Sticky:** if any row has a `stickySignal`, `deliverability` is the highest by D1's sticky precedence. Ties go to the earliest by `(stickySignalAt, eventRank(type), stickySignalSvixId)`, where `type` is the signal's event type (`hard_bounced` → `email.bounced`). `since` = its `stickySignalAt`, `causeEmailId` = its row's `emailId`.
2. **Else non-sticky:** the latest `softSignal` across rows by `(softSignalAt, eventRank(type), softSignalSvixId)` decides: `delivered` → `ok`, `bounced` → `soft_bouncing`. `since` / `causeEmailId` come from it. A transient bounce followed by a delivery of the **same** email therefore clears to `ok`, as the data-modeling rule requires; a row-status reading would keep it `soft_bouncing` forever (`bounced` outranks `delivered`, D1).
3. **Else** `ok`, `since: null`, `causeEmailId: null` (C9).

`failed`, `sent`, `scheduled`, `delivery_delayed`, `opened` and `clicked` events carry no deliverability signal. `addressMasked` comes from the row with the smallest `emailId`.
**Authority:** [`recipient_state`](../data-modeling.md#recipient_state--deliverability-per-address) ("`hard_bounced`, `complained` and `suppressed` are sticky; `soft_bouncing` clears to `ok` on a `delivered` later by `event_created_at`, `rank` and `svix_id` breaking ties"), which is event-level recency, so it needs the event behind each signal; its recompute "reads every `email_recipients` row for the hash", so the signals live on the row (C3). ADR-003 ("a hard bounce comes from `bounce.type = Permanent`, never from the event type alone"). Ships 5's property 3 ("monotonicity (for `projectRecipient`, of the sticky states)") fails if stickiness is read from `status` (D5).
**Rules out:** deriving deliverability from a row's `status`; reading events across emails in `projectRecipient` (data-modeling recomputes from rows).

### D7 — RS-U12 safe either way: every non-`Permanent` bounce folds to `soft_bouncing`

`bounce.type` and `subType` are `z.string()`, never an enum. Only the exact string `Permanent` is a hard bounce. Every other value (`Transient`, `Temporary`, `Undetermined`, any unknown string, or a missing `bounce` object) is non-`Permanent`, and so `soft_bouncing` under D6.
**Authority:** [resend.md → Mechanisms](../resend.md#event-types-and-payloads-rs-25rs-30) ("typed `z.string()`, never an enum (RS-35)"); RS-U12 owed by slice 0 "(hard bounce only on `Permanent`; both fields `z.string()`)". The decision lens: the only rule whose output doesn't depend on which values Resend sends live. `soft_bouncing` is non-sticky, so a misread costs one state until the next delivery; `hard_bounced` is sticky, so it stays strict (C6).
**Rules out:** enumerating soft values (it would depend on RS-U12's open answer).

### D8 — RS-U11 safe either way

D1 makes `bounced` outrank `delivered` regardless of order or timestamps. The arbitraries generate both worlds: histories with a bounce after a delivery (by `created_at`) and histories where every bounce precedes or replaces delivery. The precedence property holds in both. The test cites RS-U11.
**Authority:** ADR-003 ("precedence is property-tested whether or not a bounce can follow a delivery (RS-U11)").

### D9 — RS-U10 safe either way

`eventCreatedAt` is only a sort key, with `eventRank` and `svixId` as tie-breaks (ADR-003). The arbitraries draw it from a small pool of instants, so most sets hold ties, including same-type ties ([pp-testing → properties](../../.agents/skills/pp-testing/references/properties-and-arbitraries.md#what-they-generate)). They generate both worlds: timestamps consistent with the lifecycle order, and timestamps unrelated to it. Permutation invariance and oracle agreement hold in both. The test cites RS-U10. The display-correctness half (`since`, `status_at`) stays with the slice 4 replay experiment ([Timestamps & ordering](../data-modeling.md#timestamps--ordering)).

### D10 — RS-U19 safe either way

`data.suppressed` is optional in the `email.suppressed` schema. A schema test parses the page's example with and without it, and both succeed. A property arbitrary generates both, and the projection's `suppressed` outcome is identical. The test cites RS-U19.
**Authority:** RS-U19 owed by slice 0 "(Zod field optional)" ([resend.md → Unverified](../resend.md#unverified)); RS-29 ("`email.suppressed` shows `data.suppressed { message, type }` in its example only"); ADR-003 ("Event-specific payload objects are optional in the Zod schemas").

### D11 — Event schemas

Two schemas, in two files:
- `webhook-envelope.schema.ts` → `webhookEnvelopeSchema`: `z.looseObject({ type: z.string(), created_at: z.iso.datetime({ offset: true }), data: z.looseObject({}) })` for every payload (RS-26). It is what the worker uses to extract typed columns.
- `email-event.schema.ts` → `emailEventSchema`: a `z.discriminatedUnion('type', …)` over the ten outbound types in `email-event-types.ts` → `emailEventTypes` (`as const`: `email.scheduled`, `sent`, `delivered`, `delivery_delayed`, `bounced`, `failed`, `suppressed`, `complained`, `opened`, `clicked`; RS-25 minus `email.received`).

Required: only `type`, `created_at`, `data.email_id` (string) and `data.to` (string array). Everything else is optional (RS-27's `from`, `subject`, `message_id`, `broadcast_id`, `template_id`, `tags`, and every event-specific object: `bounce { type, subType, message, diagnosticCode[] }`, `click`, `failed { reason }`, `suppressed { message, type }`; RS-28, RS-29). Objects are `z.looseObject`, so a new Resend field never fails a parse. `email.received`, the non-email families (RS-25) and unknown types get no data schema. They pass the envelope, are stored raw, and are skipped by projections ([Deferred](../data-modeling.md#deferred)).
**Authority:** ADR-003 ("Event-specific payload objects are optional in the Zod schemas"); [resend.md → Mechanisms](../resend.md#event-types-and-payloads-rs-25rs-30). Lens tie-break: an over-strict schema skips real events, which loses state, so required fields are only what a projection can't work without. Check `z.looseObject` and `z.iso.datetime` against the installed 4.6.7 before writing ([version rule](../../.agents/skills/pp-general/SKILL.md#check-the-installed-version-not-memory)).

### D12 — Schema fixtures from Resend's pages

At apply, fetch the example payload from each `webhooks/emails/<type>.md` page for the ten outbound types plus `email.received` (RS-30, envelope only) and store it as `packages/core/src/fixtures/resend/<type-kebab>.json` (e.g. `email-bounced.json`).
- `email-event.schema.test.ts` holds a table of `{ file, sourceUrl, fetchedOn }` and asserts each parses.
- Negative tests: a missing `data.email_id` fails; an unknown `type` parses as envelope-only; an extra unknown field passes.
- Any address in an example that is not a Resend test address is replaced by one (`delivered@resend.dev`, `onboarding@resend.dev`), and the table notes the substitution ([Permissions → Never](../../AGENTS.md#permissions)).
- An example contradicting RS-26–RS-29 is a finding: record it in resend.md, never silently adapt (AGENTS.md "Verify Resend behavior").
**Authority:** C1.

### D13 — Masks

Three functions in three files, each a pure code-point operation, mapping every control character (`\p{Cc}`: C0, DEL, C1) to `*` **before** tokenizing ([PII & retention](../data-modeling.md#pii--retention)):
- `mask-text.ts` → `maskText(s)` (subject, display name).
  - Separators are `\p{White_Space}`, `\p{P}` and `\p{S}`, **except `*`**, which counts as a token character so a mask re-tokenizes identically (idempotence).
  - Each maximal run of token characters of length `n` keeps its first `min(3, ⌊n/3⌋)` characters. Every other character becomes `*`.
  - A kept digit (`\p{Nd}`) becomes `*`.
  - Separators are kept.
- `mask-address.ts` → `maskAddress(a)`: split at the **last** `@`.
  - The local part is one token (keep `min(3, ⌊n/3⌋)`).
  - Each `.`-separated domain label keeps its first character.
  - Digits are masked everywhere.
  - With no `@`, the whole string is a local part.
  - Example: `delivered@resend.dev` → `del******@r*****.d**`.
- `mask-from.ts` → `maskFrom(f)`: `Display Name <addr>` → `maskText(name) + ' <' + maskAddress(addr) + '>'` (the `<`, `>` and the space kept), otherwise `maskAddress(f)`. This exists because `email_state.from_masked` masks `data.from`, which carries a display name (RS-27).

Every mask preserves length in code points and is idempotent.
**Authority:** data-modeling mask table and rules ("A mask preserves length in code points and is **idempotent**"). The token-character treatment of `*` and of control characters is the minimal reading under which the ratified idempotence property can hold.

### D14 — Address normalization

`normalize-address.ts` → `normalizeAddress(a) = a.trim().toLowerCase()` (locale-independent). No display-name extraction: RS-27 documents `to` as addresses, and nothing ratified asks for parsing.
**Authority:** [Modeling conventions](../data-modeling.md#modeling-conventions-canonical) ("normalized (trimmed, lowercased) by one function in `packages/core`").

### D15 — Arbitraries in `@ledger/core/testing`

`packages/core/src/testing.ts` re-exports `src/testing/ledger-history.ts` → `ledgerHistory({ namespace })` (several emails, several recipients per email, recipients shared across emails, each event's `data.to` a subset). `src/testing/email-history.ts` → `emailHistory(options)` (one email) stays internal to core's tests.

What they generate follows [pp-testing → What they generate](../../.agents/skills/pp-testing/references/properties-and-arbitraries.md#what-they-generate):
- every outbound type, plus unknown types and schema-failing payloads;
- `bounce.type` from `Permanent`, `Transient`, `Temporary`, `Undetermined` and any string;
- `data.suppressed` present and absent;
- `created_at` from a small pool of instants, in both RS-U10 worlds;
- bounce-after-delivery present and absent (RS-U11);
- control characters in addresses, labels, display names and subjects;
- addresses under `@resend.dev` only;
- ids fresh per event, with `svix_id`, `email_id` and `+label` derived from `namespace` plus a counter.

`recipientKeys = to.map(normalizeAddress)`. `package.json` gains `"./testing": "./src/testing.ts"`, because `sim` imports it in this diff ([pp-general → Case-by-case](../../.agents/skills/pp-general/SKILL.md#case-by-case)).

### D16 — `pnpm sim` (slice 0 shape)

- **Root script:** `"sim": "node --env-file-if-exists=.env.local sim/src/main.ts"` ([simulator.md → Layout](../../.agents/skills/pp-testing/references/simulator.md#layout)). No variable is read in slice 0.
- **Flags** (`node:util` `parseArgs`):
  - `--seed <uint32>`
  - `--namespace <[a-z0-9-]{1,32}>`
  - `--duplicates <ratio>` (0 ≤ r ≤ 1, default 0)
  - `--shuffle` (boolean, default off)

  A missing `--seed` / `--namespace` is chosen with `node:crypto` (`randomInt`, `randomBytes`). These are the run's only unseeded values ([Seed and determinism](../../.agents/skills/pp-testing/references/simulator.md#seed-and-determinism)).
- **Generation:**
  - The history is `fc.sample(ledgerHistory({ namespace }), { seed, numRuns: 1 })[0]`.
  - Duplicates repeat a seeded `⌊r·n⌋` of its events.
  - The shuffle is a seeded permutation drawn by `fc.sample` from the same seed.
  - The projection is `projectEmail` per email, then `projectRecipient` per recipient key.
- **Output** (stdout, `\n`-terminated):
  - Line 1 is `sim seed=<seed> namespace=<namespace>`.
  - Line 2 is `history emails=<m> events=<n> duplicates=<d> shuffled=<true|false>`.
  - Then a two-space-indented JSON document `{ "emails": [...], "recipients": [...] }`, sorted by `emailId` and by recipient key, with ISO timestamps.
  - It carries **masks only**: `recipientKey` is omitted, because in slice 0 it is the normalized address ([simulator.md → Invariant checkers](../../.agents/skills/pp-testing/references/simulator.md#invariant-checkers): "never an address").
  - Exit `0`.
- **Bad flags:** a one-line message on stderr, exit `2`.

The JSON block is identical with or without `--shuffle` / `--duplicates` for one seed and namespace. That is order independence, shown at the terminal.
**Authority:** Ships 8; [simulator.md → Ground truth and runs](../../.agents/skills/pp-testing/references/simulator.md#ground-truth-and-runs) delegates the choice to this document ("Each knob's mechanism, and the seed flag's name, are its slice's pre-proposal's"); [Seed and determinism](../../.agents/skills/pp-testing/references/simulator.md#seed-and-determinism) for line 1 and `fc.sample`.

### D17 — The deliberate-violation fixture, and settling the Biome overrides bullet

`packages/core/src/import-boundaries.test.ts` (unit tier) does the following:
1. Creates a temp directory under `os.tmpdir()` holding a copy of the repo's `biome.json` and of `packages/core/package.json` and `packages/aws/package.json` at the same relative paths.
2. Writes one fixture file per case.
3. Runs the repo's own Biome binary (`node_modules/.bin/biome lint --vcs-enabled=false --reporter=json`) in that directory.
4. Asserts on the **rule name** in the diagnostics, not just the exit code.

Cases:
- In `packages/core/src/`: `pg`, `drizzle-orm`, `drizzle-orm/pg-core`, `resend` and `@aws-sdk/client-sqs` each raise `lint/style/noRestrictedImports`. A control importing `zod` raises none.
- In `packages/aws/src/`: `@aws-sdk/client-sqs` raises no `noRestrictedImports`, and a deep `@ledger/db/src/x.ts` raises it.

The aws pair settles the library bullet. An override's `noRestrictedImports` list **replaces** the base list rather than merging with it (the observed-by-hand reading). If it shows merging instead, record that, and the bullet resolves the other way.

The stdin route was probed and doesn't report rules in 2.5.15 (section 5). If Biome can't run from the temp directory (config or schema resolution), stop and report. Don't commit a violating file into the linted tree.
**Authority:** Ships 7; [about.md → library bullet](../about.md#open-questions) ("unproven until the deliberate-violation fixture lands · slice 0"); lens clause 1 (scripted, not a hand probe). The bullet says "fails the lint stage". This test runs the same binary and the same committed `biome.json` the lint stage runs.

### D18 — The `secrets` stage

`scripts/secret-scan.mjs` (Node built-ins only, like `verify.mjs`) is stage `secrets`, placed right after `docker`. It runs two scans:

1. **Canary.** In a fresh temp git repo under `os.tmpdir()`, commit one file holding three fake values, one per custom rule. They are built at runtime from fragments, so no source line in this repo matches a rule. Run the image over that repo with a JSON report. The canary passes only on exit `1` with a finding for each of `resend-api-key`, `resend-webhook-secret` and `postgres-url`.
2. **Repo.** `git clone --mirror <repo> <tmp>/repo.git` under `os.tmpdir()`, then `docker run --rm -v <tmp>/repo.git:/repo:ro -v <repo>/.gitleaks.toml:/config/.gitleaks.toml:ro -e GIT_CONFIG_COUNT=1 -e GIT_CONFIG_KEY_0=safe.directory -e GIT_CONFIG_VALUE_0=* <image> git --log-opts=--all --config /config/.gitleaks.toml --redact --no-banner --exit-code 1 /repo` must exit `0`. The temp clone is removed in `finally`.

The stage fails if the canary misses (rule rot) or the repo has a finding. `--redact` is mandatory: CI logs are public ([Risk appetite](../about.md#risk-appetite)). `safe.directory` is needed because the container's user doesn't own the mount. The mirror clone, not a mount of the checkout, is what the container reads: in a git worktree (agents work under `.claude/worktrees/`, commit `e50be97`) `.git` is a file pointing at a gitdir outside the mount, so a direct mount has no history to scan. A mirror carries every ref, so `--log-opts=--all` still covers the full history Ships 3 names, and it also avoids `.git` lock files on a Windows mount (section 24).

`.gitleaks.toml`:
- `[extend] useDefault = true`.
- `resend-api-key`: `\bre_[A-Za-z0-9_]{20,}`.
- `resend-webhook-secret`: `\bwhsec_[A-Za-z0-9+/]{20,}={0,2}`.
- `postgres-url`: `postgres(?:ql)?://[^\s:/@]+:[^\s@/]+@[^\s/:?#]+`, i.e. a URL with a password. It has an allowlist for hosts `localhost` and `127.0.0.1`: the compose and Testcontainers throwaway credentials are not secrets ([environment.md](../../.agents/skills/rsa-manual-test/references/environment.md), compose row).

`[[rules.allowlists]]` syntax is checked against v8.30.1's docs at apply.
**Authority:** Ships 3; [Technology → Secret scan](../architecture.md#technology); lens clause 1 (the "scratch commit" evidence recurs per review, so it is scripted into every run rather than walked by hand).

### D19 — The `links` stage (owner-ruled 2026-10-16)

`scripts/check-links.mjs` (Node built-ins) is stage `links`, after `lint`. With no arguments it checks `README.md`; arguments name other files (the walkthrough's negative case, and later slices' files).
- **Canary first**, like D18: in a fresh temp directory under `os.tmpdir()` it writes `target.md` (one heading) and `probe.md` holding one valid anchor link to `target.md`, one link to a missing anchor in it, and one link to a missing file. The canary passes only when exactly the last two are reported, one `missing anchor` and one `missing file`. A broken check therefore fails the stage instead of passing a clean README silently.
- **Checked:** every relative link and image target resolves, relative to the file that holds it, to an existing file or directory, and every `#anchor` matches a heading slug in the target Markdown file (GitHub's algorithm: lowercase; drop characters other than letters, marks, numbers, spaces, `-` and `_`; spaces → `-`; duplicates suffixed `-1`, `-2`, …) or an explicit `id`/`name`.
- **Skipped:** `http(s):` and `mailto:` targets (owner-ruled).
- **Output:** `links: canary caught 2/2`, then `links: <file> <n> checked, <k> broken`, one `file:line target (reason)` per broken link. Exit `1` if any is broken or the canary misses (`links: canary missed <reason>`).

**Authority:** owner, 2026-10-16 ("Node script, README (Recommended)"); Ships 9. The canary: lens clause 5 (a check a reviewer can see fail) and testability: `scripts/` is in no Vitest project's `include` (`vitest.config.ts`), so an in-stage self-check is the cheapest proof, the same pattern as D18.

### D20 — `verify.mjs` and CI

The stage order becomes `install, docker, secrets, lint, links, typecheck, unit, synth, e2e`. The header comment drops "gitleaks and the README link check (slice 0)" from its planned list. `ci.yml` is untouched: `fetch-depth: 0` and Docker are already there (`ci.yml:28-41`). That keeps it "the same command in CI" by construction.
**Authority:** approvals table; [definition-of-done → 1](../../.agents/skills/pp-workflow/references/definition-of-done.md#1--the-gate).

### D21 — Files and names

Per [coding-standards](../../.agents/skills/pp-general/references/coding-standards.md):
- `project-email.projection.ts` → `projectEmail`
- `project-recipient.projection.ts` → `projectRecipient`
- `email-event.schema.ts`, `webhook-envelope.schema.ts`, `email-status.schema.ts` → `emailStatusSchema`, `deliverability.schema.ts` → `deliverabilitySchema`
- `email-event-types.ts`, `event-rank.ts`, `ledger-event.ts`, `normalize-address.ts`, `mask-text.ts`, `mask-address.ts`, `mask-from.ts`

- `sticky-signal.schema.ts` → `stickySignalSchema`, `soft-signal.schema.ts` → `softSignalSchema` (D4)

Tests sit beside them (`*.test.ts`, `*.prop.test.ts`). `packages/core/src/index.ts` exports every primary export above.
**Authority:** [pp-general → coding-standards → Role suffixes](../../.agents/skills/pp-general/references/coding-standards.md#role-suffixes) (`.schema.ts` → `emailEventSchema`, `.projection.ts` → `projectEmail`, kebab-case files); [vitest-layout](../../.agents/skills/pp-testing/references/vitest-layout.md) for the test suffixes.

## 8. Data model

Not touched — no schema change. `packages/db` and its migrations are slice 1's
([Model index](../data-modeling.md#model-index): every `Modeled` box stays `[ ]`). This slice fixes the *values* slice 1's columns hold (D2, D4), and records in data-modeling the three facts the schema will need: the six `email_recipients` signal columns `sticky_signal`, `sticky_signal_at`, `sticky_signal_svix_id`, `soft_signal`, `soft_signal_at`, `soft_signal_svix_id` (C3, D4; the two signal columns are closed sets with a `CHECK`), `email_state.status` null before an outcome (C9), and `recipient_state.since` / `cause_email_id` null while `ok` is undecided (C9). These are intent-doc edits, so no Ask-first schema gate applies here. Slice 1's migration is the schema change.

## 9. State machines and transitions

- **`email_state.status`:** recomputed from the full event set (D3), not advanced. The value is the max-precedence outcome under D1, `null` with none. Ties go to the earliest in fold order (D5). There are no transitions to write: slice 1's worker overwrites the row with the recomputed value under the email lock (ADR-004).
- **`email_recipients.status`:** the same, scoped to events whose own `data.to` names the recipient (RS-27, RS-U21 is slice 1's to settle).
- **`email_recipients` signals:** `stickySignal` only rises (a maximum over the row's events); `softSignal` follows the latest `delivered` / non-`Permanent` `bounced` of the row (D4).
- **`recipient_state.deliverability`:** D6, from the rows' signals, never their `status`. Sticky `hard_bounced` > `suppressed` > `complained`; `soft_bouncing` ↔ `ok` by the latest `softSignal`, same email or another. Tie-break `(signalAt, eventRank, signalSvixId)`.
- **Reactions:** none dispatched. The outbox is slice 6's.
- **Bypass check:** no code path sets a status except through these functions. Slice 0 has no writer.

## 10. Backend surface

Not touched — slice 0 adds no operation. `api-contract.md` has no `Slices:` entry naming slice 0, and the card's UI surfaces name none.

## 11. Async — outbox, jobs, webhooks

Not touched — no queue, consumer, schedule, inbound webhook or outbox in slice 0 (ADR-001/002/006/008 land in slices 1, 2 and 6).

## 12. Surfaces

| Surface | What it runs | Output | Failure output |
| --- | --- | --- | --- |
| `pnpm verify` (local) | Stages per D20 | Existing `[verify] ▶ / ✔ / ✘` lines and summary. `secrets` prints `secrets: canary caught 3/3 rules` then `secrets: repo clean (<k> commits scanned)`. `links` prints `links: canary caught 2/2` then `links: README.md <n> checked, 0 broken` | `secrets`: `secrets: canary missed rule <id>` or gitleaks' redacted finding list, exit 1. `links`: `links: canary missed <reason>`, or `README.md:<line> <target> (missing file|missing anchor)`, exit 1. `VERIFY FAILED: <stage>` |
| CI run on a pushed commit | `pnpm verify`, unchanged workflow | The same lines in the job log, conclusion `success` | Conclusion `failure`, the failing stage named |
| `pnpm sim` | D16 | Line 1 seed and namespace, line 2 counts, JSON projection (masks only) | Bad flag: `sim: <flag> <reason>` on stderr, exit 2 |

No registry error code is raised: none of these is a read-API, SDK, CLI or MCP surface ([Error codes](../api-contract.md#error-codes)). The `ledger` CLI is untouched. No `--json` applies: `pnpm sim`'s projection block is JSON already.

## 13. Recovery paths

Not touched — slice 0 stores nothing. Pure projections are what every later recovery path (redrive, replay, reconcile) relies on to make a redelivered event a no-op: idempotence property 2 here, and the `svix_id` dedupe at the ledger in slice 1.

## 14. Business rules and invariants

These become the spec requirements:
- **R1 (order independence):** for any event set, any permutation gives an equal `EmailState` and `RecipientState` (ADR-003). This holds under both RS-U10 worlds.
- **R2 (duplicate delivery):** repeating any events of the set gives an equal projection, because projections dedupe by `svix_id` (ADR-004).
- **R3 (monotonicity):** adding events never lowers status precedence. Once `recipientState` is sticky, adding events never makes it non-sticky or lower in sticky precedence (D5), including a later `failed` or non-`Permanent` `bounced` on the email that made it sticky (C3).
- **R4 (oracle):** the projection equals a naive reference written in the test file: precedence-first selection, a different algorithm from the sort-and-fold.
- **R5 (late terminal):** a `bounced`, `failed` or `suppressed` outranks `delivered` whatever their arrival order and timestamps (ADR-003, RS-U11 both worlds).
- **R6 (hard bounce):** `hard_bounced` arises only from `bounce.type === 'Permanent'`. Every other bounce yields `soft_bouncing`, never sticky, and a `delivered` later in fold order, on the same email or another, clears it to `ok` (RS-35, D6, D7).
- **R7 (per-recipient):** a bounce whose `data.to` names one recipient leaves every other recipient's `EmailRecipientState` unchanged (RS-27).
- **R8 (skip, never fail):** unknown types, non-email types, `email.received` and schema-failing payloads never change a projection and never throw (ADR-004).
- **R9 (schemas):** every Resend example payload of the ten outbound types parses. Event-specific objects are optional. Unknown fields pass. `data.suppressed` is optional (RS-U19).
- **R10 (masks):** idempotent; length-preserving in code points; no `\p{Nd}` in the output (no digit revealed); at most 3 characters revealed per token; no `\p{Cc}` in output.
- **R11 (no PII on sim output):** `pnpm sim` prints no unmasked address or subject.
- **R12 (boundary):** an AWS, Postgres or Resend import in `packages/core` fails Biome.
- **R13 (secret scan):** the `secrets` stage fails when any commit on any ref carries a Resend key, a `whsec_` secret or a credentialed non-local Postgres URL, and proves it on every run with the canary.
- **R14 (links):** the `links` stage fails on any broken relative link or anchor in `README.md`, and proves it on every run with the canary (D19).
- **R15 (sim determinism):** a fixed seed and namespace print byte-identical output, and the JSON block doesn't change with `--shuffle` or `--duplicates`.

## 15. Authorization and idempotency

Not touched — no authenticated surface and no write. Idempotence of the projection is R2. The idempotency keys themselves (`svix_id`, `dedupe_key`) are enforced from slice 1 ([Idempotency keys](../data-modeling.md#idempotency-keys)).

## 16. Cost and the Resend budget

Not touched — no AWS resource and no Resend call added. The gitleaks image pull is free and runs locally and on the GitHub-hosted runner.

## 17. PII and retention

- **Masks** are the slice's PII deliverable (D13, R10), [PII & retention](../data-modeling.md#pii--retention).
- **Fixtures:** Resend test addresses only. Any non-test address in a fetched example is substituted (D12).
- **Arbitraries:** `@resend.dev` addresses only (D15).
- **Sim output:** masks only, recipient keys omitted (D16, R11).
- **Secret scan output:** `--redact`, so a finding never prints a secret into a public CI log (D18).
- No logs, no raw payload storage, no retention job (slice 7). No erasure duty in this slice.

## 18. Integrations, env and owner ops

No provider adapter and no port (`packages/shared` stays slice 1's). No new environment variable, and no `.env.example` change. `sim` loads `.env.local` if present but reads nothing in slice 0. Owner op: Docker running. Already required by the `docker` stage.

## 19. Decision lens, in writing

**Self-service test.** Slice 0 touches none of `deploy → connect the webhook → ingest → query → recover → tear down` ([Guiding principles](../about.md#guiding-principles)). It touches the `discover` stage ([Adopter lifecycle](../features.md#adopter-lifecycle)) only through the README link check, which is automated. No step needs a human or an unbounded wait. Nothing owed.

**Cost brake.**
- **Chosen:**
  - a Node built-ins link checker, over a pinned link-checker image (no dependency, no network in the merge gate; owner-ruled);
  - gitleaks through Docker, which `verify` already needs, over a downloaded binary or an npm wrapper;
  - a canary inside the stage, over a recurring hand-made scratch commit (lens clause 1);
  - fast-check only, with no Vitest integration package ([pp-testing](../../.agents/skills/pp-testing/references/properties-and-arbitraries.md#the-properties-slice-0-owes): "no fast-check integration package");
  - the Biome binary already installed, over `@biomejs/js-api`.
- **Rejected as over-engineering at the ceiling:**
  - checking every Markdown file now (later slices add theirs);
  - a configurable precedence table (one constant; changing it is the rebuild tripwire);
  - keyed hashing in core before slice 1 needs it.

## 20. Test plan

| Requirement | Test (tier) | Fails if removed |
| --- | --- | --- |
| R1–R4 for `projectEmail` | `project-email.projection.prop.test.ts` (property): one `it` per property, oracle in the file | Sorting removed (ties exercise `rank`/`svix_id`), dedupe removed, precedence replaced by recency |
| R1–R4 for `projectRecipient` | `project-recipient.projection.prop.test.ts` (property); the oracle reads the events behind the rows directly (max sticky signal, latest delivery-or-soft-bounce), so it also checks that the row signals lose nothing. The arbitraries put sticky events and higher-ranked non-sticky ones on the same email (`suppressed` then `failed`, `complained` then a `Transient` `bounced`) | Sticky handling or the tie-break removed; deliverability read from a row's `status` (property 3 fails) |
| R5, RS-U11 | `project-email.projection.prop.test.ts`: "a bounce outranks delivered in either world (RS-U11)" | A recency rule |
| R6, RS-U12 | `project-recipient.projection.prop.test.ts`: "only `Permanent` yields hard_bounced; any other bounce.type yields soft_bouncing (RS-U12)", and "a later delivery of the same email clears soft_bouncing" | Event-type-only hard bounce; `softSignal` taken from `status` |
| R7 | `project-email.projection.prop.test.ts`: two-recipient property | Folding the email's first-seen `to` list |
| RS-U10 | Properties R1/R4 run with the small `created_at` pool and both worlds, test name cites RS-U10 | Tie-breaks removed |
| R8 | `project-email.projection.test.ts` (unit): unknown type, `email.received`, schema-failing payload, null `eventCreatedAt`, misaligned `recipientKeys` → equal projection, no throw | A throwing parse |
| R9, RS-U19 | `email-event.schema.test.ts` (unit) over D12's fixtures; `data.suppressed` present and absent (RS-U19) | A required event-specific object |
| R10 | `mask-text.prop.test.ts`, `mask-address.prop.test.ts`, `mask-from.prop.test.ts` (property); `normalize-address.test.ts` and the data-modeling examples as unit cases | `*` treated as a separator (idempotence fails); control characters masked after tokenizing |
| R12 | `import-boundaries.test.ts` (unit, D17) | The core override deleted from `biome.json` |
| R11, R15 | `sim/src/main.e2e.test.ts` (e2e): same seed and namespace twice → identical stdout; `--shuffle --duplicates 0.3` → identical JSON block; another namespace → different ids; the test regenerates the history with the same seed and namespace (`fc.sample` over `ledgerHistory`) and asserts that no generated `to`, `from` or `subject` that differs from its own mask appears in stdout | Unseeded randomness; a recipient key, raw address or raw subject printed |
| R13 | The `secrets` stage itself (canary + repo) | The custom rules removed or broken |
| R14 | The `links` stage: its canary (D19) on every run, then `README.md`; walkthrough B2 shows it by hand | The anchor or file check removed (the canary misses) |

`pnpm verify` covers all of the above. It cannot see:
- whether Resend's live payloads match its doc examples (RS-U15, slice 1);
- whether the projection rows commit correctly under locks (slice 1 integration tier);
- whether external README links rot (owner-ruled out).

`numRuns` stays at fast-check's default. A failing seed becomes a named regression ([locking](../../.agents/skills/pp-testing/references/properties-and-arbitraries.md#locking-a-regression)).

## 21. Walkthrough plan

`openspec/changes/slice-0-foundations/WALKTHROUGH.md`, in [the format](../../.agents/skills/rsa-manual-test/references/walkthrough-format.md). Personas reaching slice 0: **Reviewer** (all surfaces) and **Application developer** (the `discover` stage: the README). Support, Operator and AI agent don't reach it (no query, recovery or MCP surface). Ask-first steps: none.

**Before you start:** `pnpm install`; Docker running.

- **Path A — `pnpm verify` surface, secret scan (Reviewer).**
  - A1: `node scripts/secret-scan.mjs`. Expect exit 0, `secrets: canary caught 3/3 rules`, `secrets: repo clean`.
- **Path B — `pnpm verify` surface, link check (Application developer reading the README).**
  - B1: `node scripts/check-links.mjs`. Expect exit 0, `links: canary caught 2/2`, `links: README.md <n> checked, 0 broken`.
  - B2: with `node -e`, make a fresh directory under `os.tmpdir()` holding `target.md` (heading `# Real heading`) and `probe.md` with two links: one to `target.md` at anchor `#real-heading`, one to `target.md` at anchor `#no-such-heading`. Run `node scripts/check-links.mjs <dir>/probe.md`. Expect exit 1, `2 checked, 1 broken`, naming the `#no-such-heading` link as `missing anchor`. Both files sit in one directory because a relative link resolves from the file that holds it (D19).
- **Path C — `pnpm sim` (Reviewer).**
  - C1: `pnpm sim --seed 42 --namespace walk`, twice. Expect identical output, line 1 `sim seed=42 namespace=walk`.
  - C2: `pnpm sim --seed 42 --namespace walk --shuffle --duplicates 0.3`. Expect line 2 shows `shuffled=true` and a non-zero `duplicates`, and the JSON block is identical to C1's.
  - C3: `--namespace walk2`. Expect different `emailId`s.
  - C4: `pnpm sim --duplicates 2`. Expect exit 2 and a stderr message.
- **Path D — CI run (Reviewer).**
  - D1: `gh run list --branch slice-0-foundations --limit 1`. Expect conclusion `success` on the pushed `HEAD`.
  - D2: `gh run view <id> --log`, grepped for `[verify] ✔ secrets` and `[verify] ✔ links`. This is where the full `pnpm verify` gate is read (C2).

**Teardown:** T1 delete B2's temp directory.

**Cannot reach today:**

| Not reachable | Carried by |
| --- | --- |
| A local `pnpm verify` run and the property and unit suites | `wf-after-apply-check` (rsa-manual-test hard rule 7) |
| `pnpm sim` against a live process, invariants 1–2 | [slice 1](../build-checklist.md#1--local-ledger-and-read-path) |

## 22. Docs to update

Applied by the change, in the commits that land each piece:

- [build-checklist.md](../build-checklist.md#0--foundations): tick Ships 3–10 as each lands. `Status` `[x]` after the walk.
- [architecture.md](../architecture.md):
  - Reliability core "Order independence" evidence → the two prop-test files.
  - ADR-003 **Evidence** → same.
  - ADR-003 prose: the full precedence order (D1, owner 2026-10-16) and that `complained` ranks between `delivered` and the terminal negatives (C4).
  - ADR-013 **Evidence** → `import-boundaries.test.ts`.
- [data-modeling.md](../data-modeling.md):
  - `email_state` row notes `status` null before an outcome (C9).
  - `email_recipients` gains the six signal columns `sticky_signal`, `sticky_signal_at`, `sticky_signal_svix_id`, `soft_signal`, `soft_signal_at`, `soft_signal_svix_id`, each folded from the row's own events (C3, D4).
  - `recipient_state` states D6's fold from those signals, never from `status`, with every non-`Permanent` bounce → `soft_bouncing` (C6, D7), and the nullable `since` / `cause_email_id` (C9).
  - PII & retention slice-0 evidence → the mask prop tests.
  - The Slice-0 evidence lines → tests.
- [resend.md](../resend.md):
  - RS-U10, RS-U11, RS-U12 and RS-U19 rows cite their tests (Ships 10). They stay `[Unverified]` as facts.
  - New facts, cited and checked 2026-10-16:
    - **RS-36:** dashboard email events, including `canceled` and `queued`, which are not webhook types (C7); `delivery_delayed` is retried "for up to 14 hours" then `bounced` ([manage-emails](https://resend.com/docs/dashboard/emails/manage-emails.md)).
    - **RS-37:** suppression origins `bounce` (permanent), `complaint` and `manual`; suppressed sends are skipped ([email-suppressions](https://resend.com/docs/dashboard/emails/email-suppressions.md), [suppression list](https://resend.com/docs/knowledge-base/why-are-my-emails-landing-on-the-suppression-list.md)).
    - **RS-38:** Retrieve Email's `last_event` ([retrieve-email](https://resend.com/docs/api-reference/emails/retrieve-email.md)).
  - Sources table gains those pages and a pointer to `packages/core/src/fixtures/resend/` (C1).
- [about.md](../about.md):
  - "What this project must demonstrate", row 1: link the fast-check properties.
  - Open questions: the RS-U10/U11/U12 bullets cite their tests, and the "Smaller Resend gaps" bullet cites RS-U19's.
  - The "Biome `overrides` scoping" bullet moves to **Resolved** with D17's finding.
- [features.md](../features.md#ledger--projections): the recipient-deliverability pointer moves to slice 0 (C5); the `projectEmail` bullet links its test.
- Root [AGENTS.md](../../AGENTS.md#commands):
  - Commands gains `pnpm sim` with its flags.
  - The `pnpm verify` stage list and "planned stages" sentence are updated (gitleaks and link check landed).
- [pp-general → imports-and-tsconfig](../../.agents/skills/pp-general/references/imports-and-tsconfig.md#lint-enforcement-biome): replace the two `[Unverified]` / "unproven until slice 0" sentences with the verified fact and the test's path.
- [pp-testing → simulator.md](../../.agents/skills/pp-testing/references/simulator.md#signing): "slice 0 or 1 writes it" → "slice 1" (C10).
- [rsa-manual-test → environment.md](../../.agents/skills/rsa-manual-test/references/environment.md): the `pnpm sim` row gains its exact command and flags. The `scripts/secret-scan.mjs` and `scripts/check-links.mjs` stage commands are listed as walkable.
- `scripts/verify.mjs` header comment (D20).

None of these loosens a rule. The precedence order adds an owner ruling. The others are fact corrections or evidence links, so no gate review is owed ([Never loosen a rule](../../AGENTS.md#never-loosen-a-rule-to-fit-what-was-built)).

## 23. OpenSpec mapping

Change `slice-0-foundations` at `openspec/changes/slice-0-foundations/`. `openspec/specs/` is empty (`find openspec/specs -name spec.md` → nothing), so every delta is **ADDED**:

| Capability path | Requirements |
| --- | --- |
| `verify-gate` | Stage list and CI parity (Ships 1–2, already met, specified for the record); R13 (`secrets` stage with canary, redacted output); R14 (`links` stage) |
| `event-schemas` | R9; envelope for every type; unknown and non-email types kept raw; RS-U19 |
| `projections` | R1–R8; D1 precedence; D6 recipient rules; RS-U10, RS-U11, RS-U12 |
| `address-masking` | R10; D14 normalization; D13 address, text and from rules |
| `core-import-boundary` | R12; the Biome overrides finding |
| `simulator` | R11, R15; D16 flags and output |

Task groups, each one commit (or more) pushed as it lands, ordered so each is independently verifiable:

1. **Dependencies** (Ask-first, approved): `zod@4.6.7` in core, `fast-check@4.10.2` in core and sim, `@ledger/core: workspace:*` in sim; `pnpm install`; lockfile. Gate `pnpm check`.
2. **Event schemas + fixtures** (D11, D12): fetch the pages, write fixtures, schemas and the unit test.
3. **Normalization and masks** (D13, D14): functions and their prop and unit tests.
4. **`projectEmail`** (D1–D5, D8, D9): rank table, closed sets, `LedgerEvent`, `emailHistory` arbitrary, prop and unit tests.
5. **`projectRecipient`** (D6, D7): function and prop tests.
6. **`sim`** (D15, D16): `ledgerHistory`, `./testing` export, `sim/src/main.ts`, root script, e2e test.
7. **Import boundary** (D17): `import-boundaries.test.ts`; record the Biome finding.
8. **Secret scan** (Ask-first image and CI stage, approved; D18): `.gitleaks.toml`, `scripts/secret-scan.mjs`, `verify.mjs` stage.
9. **Link check** (CI stage, approved; D19): `scripts/check-links.mjs`, `verify.mjs` stage.
10. **Docs** (section 22) and `WALKTHROUGH.md` (section 21).
11. **Gate:** `pnpm verify` → `VERIFY PASSED`; `pnpm exec openspec validate slice-0-foundations --type change --strict`; CI green on the pushed `HEAD`.

## 24. Risks

| Risk | Likelihood | Cost | Cheapest early catch |
| --- | --- | --- | --- |
| The gitleaks container can't read the mounted mirror on Windows (path translation, `safe.directory`) | Medium | The `secrets` stage blocks local verify | Run A1 locally first in task 8, before wiring the stage; CI (Linux) is the second check |
| `pnpm verify` runs in a git worktree, where `.git` is a file and a mounted checkout has no history | High without D18's mirror clone | The `secrets` stage fails, or scans nothing, for every agent working under `.claude/worktrees/` | D18 scans a `git clone --mirror`; task 8 runs A1 from a worktree as well as the main checkout |
| Biome won't lint from a temp directory (config `$schema`, VCS, path matching for `overrides`) | Medium | D17's mechanism needs another route | First step of task 7; stop and report per D17 rather than commit a violating file |
| A Resend doc example contradicts RS-26–RS-29, or the docs changed since 2026-10-15 | Low | Schema rework, a resend.md correction | D12's fetch-and-parse is the first task 2 step |
| A Resend key format shorter than 20 chars after `re_` goes unmatched | Low | A missed real key | gitleaks' default rules still apply; record the format in resend.md if a real key is ever seen (never commit it) |
| fast-check sampling differs across platforms or versions, breaking sim determinism | Low | R15 flakes | The e2e test runs on Windows locally and Linux in CI; version pinned exactly |
| The precedence order (D1) proves wrong in practice after slice 1 | Low | A rebuild (Deferred tripwire) | Owner-ruled; slice 1's RS-U15/RS-U21 sends show real sequences |
| GitHub's slug algorithm differs from D19's for an exotic heading | Low | A false "missing anchor" (fails loudly, never silently) | README's 7 anchors pass in task 9 |

## 25. Owner ops still open

None. Every Ask-first item is approved (section 7), both owner decisions are ruled (D1, D19), and slice 0 has no Resend or AWS step.
