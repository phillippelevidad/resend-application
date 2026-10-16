# Proposal — slice 0: Foundations

## Why

Slice 0 is the root of the spine ([build-checklist → 0](../../../.ai/build-checklist.md#0--foundations)).
Every later slice builds on its outputs: slice 1's worker commits `projectEmail` / `projectRecipient`
output under row locks, slice 1's `sim` run checks invariant 2 against those functions, and the read
API returns the masks. Pure `packages/core` code is the cheapest place to prove them, by property
tests in milliseconds with no I/O
([ADR-003](../../../.ai/architecture.md#adr-003--projection-is-a-pure-function-of-the-event-set),
[ADR-013](../../../.ai/architecture.md#adr-013--pure-core-and-local-mode)). Once a projection reaches a
kept deploy, changing it trips the rebuild deferral
([Deferred (YAGNI)](../../../.ai/architecture.md#deferred-yagni)). The secret scan must exist before
slice 1 brings the first `.env.local` with `DATABASE_URL` and signing secrets.

The decision-complete brief is the checked pre-proposal
[2026-10-16-slice-0-foundations.md](../../../.ai/pre-proposals/2026-10-16-slice-0-foundations.md)
(cited below as *PP*). Every decision it settles (D1–D21, C1–C10) is carried forward unchanged.

## What Changes

The card's `Ships` list, verbatim, with the state each bullet is in:

1. *(already met, ticked; PP §5 row 1)* pnpm workspace with strict TypeScript, Biome and Vitest; `pnpm verify` mirrors CI stage for stage and exits 0 only when every stage ran and passed.
2. *(already met, ticked; PP §5 row 2)* GitHub Actions CI runs `pnpm verify` on every push and pull request (`pull_request`, never `pull_request_target`; `permissions: contents: read`; third-party actions pinned by commit SHA; `pnpm install --frozen-lockfile`); evidence: a green run on a pushed commit.
3. `pnpm verify` runs a gitleaks stage over the full git history (`git --log-opts=--all`) from a version-pinned Docker image, the same command in CI, with `.gitleaks.toml` extending the default ruleset (`[extend] useDefault = true`) and adding rules for Resend API keys (`re_`), `whsec_` signing secrets and Postgres URLs; evidence: the stage exits 1 on a scratch commit carrying a fake key and 0 on the repo.
4. `packages/core` Zod schemas for the RS-25–RS-29 event types, event-specific objects optional, unknown types kept raw; evidence: schema unit tests over the resend.md payload examples.
5. `projectEmail` and `projectRecipient` pass fast-check properties 1–4: permutation invariance, idempotence, monotonicity (for `projectRecipient`, of the sticky states), oracle agreement (ADR-003).
6. `packages/core` address normalization and mask functions ([PII & retention](../../../.ai/data-modeling.md#pii--retention)); evidence: fast-check properties (masks idempotent, length-preserving, no digit revealed, at most 3 characters revealed per token, no control character) and the two-recipient property (a bounce naming one recipient leaves the other's outcome unchanged).
7. Lint rule rejects any AWS, Postgres or Resend import in `packages/core` (ADR-013); evidence: a deliberate-violation fixture fails the lint stage.
8. `sim` history generator with seed, duplicate and shuffle knobs; `pnpm sim` prints the projection of a generated, shuffled history, identical for a fixed seed and run namespace.
9. README skeleton states the problem, the positioning against the Ingester and the no-affiliation line; the CI link check reports 0 broken links.
10. RS-U10, RS-U11, RS-U12 and RS-U19 proved safe either way by named property and schema tests, each [Unverified] row citing its test.

How each open bullet lands, in one line (detail in [design.md](design.md)):

- **3:** a `secrets` stage (`scripts/secret-scan.mjs`) runs gitleaks from the pinned image over a
  mirror clone, after a canary commit in a temp repo proves each custom rule fires (PP D18). The
  canary scripts the bullet's "scratch commit" evidence into every run.
- **4:** an envelope schema for every payload and a discriminated union over the ten outbound email
  types. Only `type`, `created_at`, `data.email_id` and `data.to` are required. Unit tests run over
  the example payloads fetched from the `webhooks/emails/*` pages resend.md cites (PP D11, D12, C1).
- **5:** `projectEmail` and `projectRecipient` with one precedence table, owner-ruled (PP D1), and
  per-recipient sticky and soft signals (PP D3–D6, C3).
- **6:** `normalizeAddress`, `maskText`, `maskAddress`, `maskFrom` (PP D13, D14).
- **7:** a unit test that runs the repo's Biome binary and `biome.json` over violating fixtures in a
  temp directory. It also settles the about.md "Biome `overrides` scoping" bullet (PP D17).
- **8:** `ledgerHistory` arbitrary in `@ledger/core/testing`; `pnpm sim --seed --namespace
  --duplicates --shuffle` prints masks only (PP D15, D16).
- **9:** README content already meets the bullet (PP §5 row 9). A `links` stage
  (`scripts/check-links.mjs`, Node built-ins, relative links and anchors only, owner-ruled) adds the
  check, canary first (PP D19).
- **10:** named property and schema tests, each cited from its resend.md row (PP D7–D10).
- **Gate:** stage order becomes `install, docker, secrets, lint, links, typecheck, unit, synth, e2e`.
  `ci.yml` is untouched (PP D20).

No **BREAKING** change: nothing ships to an adopter yet.

**Out of scope** (PP §3): the card's Deferred tail ("Drizzle schema, ingest, worker and read path
(slice 1). Any AWS resource (slice 2). Simulator runs against a live process (slice 1) and on AWS
(slice 3).") plus the keyed address hash, `signWebhook`, sim invariant checkers (slice 1), a mask
that is a fixed point of normalization (slice 7), external-URL link checking (owner-ruled out) and
link checking beyond `README.md` (a later slice adds its own file to the script's list).

## Capabilities

### New Capabilities

`openspec/specs/` is empty, so every capability is new (PP §23).

- `verify-gate`: the full gate's stage list and CI parity, the secret-scan stage with its canary
  and redacted output, and the README link-check stage with its canary.
- `event-schemas`: validation of Resend webhook payloads. An envelope for every type, typed
  outbound email events with event-specific objects optional, and unknown types kept raw.
- `projections`: email and recipient state derived from the event set. Order-independent,
  duplicate-safe, precedence-monotone, and safe under RS-U10, RS-U11 and RS-U12.
- `address-masking`: address normalization and the text, address and sender masks that keep PII out
  of every surface.
- `core-import-boundary`: the lint rule that keeps `packages/core` free of AWS, Postgres and Resend
  imports, proven by a committed violation fixture.
- `simulator`: the seeded history generator and `pnpm sim`'s deterministic, masks-only projection
  output.

### Modified Capabilities

None.

## Impact

- **Code:** `packages/core` (schemas, projections, masks, normalization, `./testing` arbitraries,
  Resend fixtures), `sim/src/main.ts`, `scripts/secret-scan.mjs` (new), `scripts/check-links.mjs`
  (new), `scripts/verify.mjs` (two stages), `.gitleaks.toml` (new), root `package.json` (`sim`
  script).
- **No** read-API route, error code, CLI command, MCP tool, environment variable, table, migration,
  AWS resource or Resend call. `api-contract.md` names no slice-0 operation (PP §10).
- **Docs** (PP §22): build-checklist card, architecture.md (ADR-003, ADR-013, Reliability core
  evidence), data-modeling.md (six `email_recipients` signal columns, nullability notes,
  `recipient_state` fold rule), resend.md (RS-U10/U11/U12/U19 cite tests; new RS-36–RS-38; fixture
  pointer), about.md, features.md, root AGENTS.md Commands, three skill references, and
  `WALKTHROUGH.md` in this folder. None loosens a rule (PP §22): the precedence order is an owner
  ruling, and the others are fact corrections or evidence links.

**Ask-first items** ([root AGENTS.md → Permissions](../../../AGENTS.md#permissions)). Each was
approved by the owner on 2026-10-16 in one itemized round (PP §7, approvals table):

| Item | Exact scope approved | PP §7 row |
| --- | --- | --- |
| Dependency `fast-check` | `4.10.2` exact, `devDependencies` of `packages/core` and `sim` | `fast-check` |
| Dependency `zod` in `packages/core` | `4.6.7` exact (the ADR-019 version), `dependencies` of `packages/core` | `zod` in `packages/core` |
| Docker image (dependency) | `ghcr.io/gitleaks/gitleaks:v8.30.1@sha256:c00b6bd0aeb3071cbcb79009cb16a60dd9e0a7c60e2be9ab65d25e6bc8abbb7f` | gitleaks image |
| CI change | Two new stages in `scripts/verify.mjs` (`secrets`, `links`), which CI runs unchanged; no `.github/workflows/ci.yml` edit | CI change |

`"@ledger/core": "workspace:*"` in `sim`'s `dependencies` is a boundary declaration, not a
third-party dependency, so it is not Ask-first
([pp-general → adding-things](../../../.agents/skills/pp-general/references/adding-things.md), owner
ruling O-09). Anything outside these rows (another package, another image, a `ci.yml` edit) stops for
the owner at apply. No migration, public contract, AWS resource or live Resend write is crossed.
