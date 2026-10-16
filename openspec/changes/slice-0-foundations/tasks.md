# Tasks — slice 0: Foundations

Each `D<n>` below is a decision in [design.md](design.md), which carries what to build; the
pre-proposal ([2026-10-16-slice-0-foundations.md](../../../.ai/pre-proposals/2026-10-16-slice-0-foundations.md),
*PP*) keeps its authority trail. Load `pp-workflow`, `pp-general`, `pp-backend` (core) and
`pp-testing` before code. Every group ends with `pnpm check` exiting 0, then a commit staged by path
and pushed ([root AGENTS.md → Commit and push as you go](../../../AGENTS.md#commit-and-push-as-you-go)).
A group that touches an e2e test also runs `pnpm test:e2e`. Each group also lands the doc updates
and `Ships` ticks its own evidence triggers. A doc task's check is that every link it adds resolves
to a file that exists in the same commit.

The card is `.ai/build-checklist.md` → 0 — Foundations: each group ticks the `Ships` boxes its
evidence lands, and its `Status` line moves only after the walk (Workflow follow-up). No task edits
`.ai/api-contract.md` or `.env.example`: the slice adds no operation and no environment variable
(proposal → Impact).

Ships 1 and 2 are already met and ticked (PP §5). Their evidence is re-confirmed by group 11.

## 1. Dependencies (Ask-first, owner-approved 2026-10-16 in PP §7)

- [x] 1.1 Add `"zod": "4.6.7"` to `packages/core` `dependencies`, `"fast-check": "4.10.2"` to the `devDependencies` of `packages/core` and `sim`, and `"@ledger/core": "workspace:*"` to `sim` `dependencies` (not Ask-first, O-09). Use exact versions and nothing else. Any other package stops for the owner. Run `pnpm install`. Verify: `git diff pnpm-lock.yaml` adds only these entries and their transitive deps, and `pnpm install --frozen-lockfile` exits 0.
- [x] 1.2 Run `pnpm check`, then commit and push the manifests and lockfile. Verify: `pnpm check` exits 0 before the commit, and `git status --short` is empty after the push.

## 2. Event schemas and Resend fixtures (Ships 4, RS-U19; D11, D12)

- [x] 2.1 Fetch the example payload from each `https://resend.com/docs/webhooks/emails/<slug>.md` page, where the slug is the event name in kebab case (`scheduled`, `sent`, `delivered`, `delivery-delayed`, `bounced`, `failed`, `suppressed`, `complained`, `opened`, `clicked`, `received`). Save each as `packages/core/src/fixtures/resend/email-<slug>.json`, replacing any non-test address with a Resend test address. Compare each with RS-26–RS-29, and record any contradiction in resend.md rather than adapting to it. Verify: 11 fixture files exist, each is valid JSON, and `git grep -nE "@[a-z0-9.-]+\.[a-z]+" -- packages/core/src/fixtures | grep -v "@resend.dev"` prints nothing.
- [x] 2.2 Write `email-event-types.ts` (`emailEventTypes`, `as const`), `webhook-envelope.schema.ts` and `email-event.schema.ts` as in D11. Required fields are only `type`, `created_at`, `data.email_id` and `data.to`. Objects are `z.looseObject()`; `data.bounce.type` / `data.bounce.subType` are `z.string()`; every event-specific object is optional. Verify: `pnpm typecheck` exits 0.
- [x] 2.3 Write `email-event.schema.test.ts` with a fixture table of `{ file, sourceUrl, fetchedOn, substitution }`. It asserts that the ten outbound fixtures parse typed and `email-received.json` parses as envelope-only. Negatives: a missing `data.email_id` fails; an unknown type and a `domain.*` type are envelope-only; an extra field passes and is preserved; `data.bounce.type` `Temporary`, `Undetermined` and an unknown string are preserved; `email.suppressed` parses with and without `data.suppressed`, in a test whose name cites RS-U19. Verify: `pnpm test` passes, and making `data.suppressed` required fails the RS-U19 test (revert after).
- [x] 2.4 Docs: the resend.md RS-U19 row cites the test (it stays `[Unverified]` as a fact). The resend.md Sources table gains a pointer to `packages/core/src/fixtures/resend/` (C1). The about.md "Smaller Resend gaps" bullet cites RS-U19's test. Tick `Ships` 4 on the card. Verify: the RS-U19 row and the about.md bullet each link `email-event.schema.test.ts`, and the card's fourth `Ships` box reads `[x]`.
- [x] 2.5 Run `pnpm check`, then commit and push. Verify: `pnpm check` exits 0 before the commit, and `git status --short` is empty after the push.

## 3. Address normalization and masks (Ships 6, mask half; D13, D14)

- [x] 3.1 Write `normalize-address.ts` (`trim().toLowerCase()`) and `normalize-address.test.ts`, covering case, surrounding whitespace, and no display-name parsing. Verify: `pnpm test` passes.
- [x] 3.2 Write `mask-text.ts`, `mask-address.ts` and `mask-from.ts` per D13. The order is: control characters to `*` first; then tokenize with `*` as a token character; keep `min(3, ⌊n/3⌋)`; mask digits. `maskFrom` splits at the last `<` when the sender ends in `>`. Add unit cases for the ratified examples (`delivered@resend.dev` → `del******@r*****.d**`, `Your invoice is ready` → `Y*** in***** ** r****`), a no-`@` input, a `Name <addr>` sender and a one-time code. Verify: `pnpm test` passes.
- [x] 3.3 Write `mask-text.prop.test.ts`, `mask-address.prop.test.ts` and `mask-from.prop.test.ts`. Each asserts five properties: idempotent; length-preserving in code points; no `\p{Nd}` in output; at most 3 characters revealed per token; no `\p{Cc}` in output. Inputs include digits, control characters, astral code points, `*`, separators and, for `maskFrom`, `<` and `>`. Verify: the properties pass, and treating `*` as a separator makes idempotence fail (revert after).
- [x] 3.4 Docs: data-modeling.md PII & retention, the slice-0 mask evidence links the three prop-test files. Verify: the slice-0 line under PII & retention **Evidence** links all three files.
- [x] 3.5 Run `pnpm check`, then commit and push. Verify: `pnpm check` exits 0 before the commit, and `git status --short` is empty after the push.

## 4. `projectEmail` (Ships 5 half, Ships 6 two-recipient half; RS-U10, RS-U11; D1–D5, D8, D9)

- [ ] 4.1 Write the closed sets and shared types from D1 / D2: `email-status.schema.ts`, `deliverability.schema.ts`, `sticky-signal.schema.ts`, `soft-signal.schema.ts` (Zod enums, inferred types, no TS `enum`), `event-rank.ts` (`eventRank`) and `ledger-event.ts` (`LedgerEvent`, D3). Add a unit test pinning `eventRank` to D1's order. Verify: `pnpm test` passes.
- [ ] 4.2 Write `src/testing/email-history.ts` (`emailHistory`, core-internal) to generate every case D15 lists for one email, with `recipientKeys = to.map(normalizeAddress)`. Verify: a small unit test asserts a sample holds tied `created_at`, a bounce after a delivery, and both RS-U10 worlds.
- [ ] 4.3 Write `project-email.projection.ts` per D3–D5: parse; skip, never throw; dedupe by `svixId`; sort by `(eventCreatedAt, eventRank, svixId)`; fold. It produces `EmailState` and the per-recipient `EmailRecipientState` rows with both signals, with exactly the fields D4 lists. Verify: `pnpm typecheck` exits 0.
- [ ] 4.4 Write `project-email.projection.prop.test.ts` with one `it` per property: permutation invariance, idempotence under repeats, precedence monotonicity, and agreement with a precedence-first oracle written in the file. Add named tests "a bounce outranks delivered in either world (RS-U11)", a tie-heavy run whose name cites RS-U10, and the two-recipient property. Verify: the properties pass, and each fails when its mechanism is removed, one at a time (revert after): sorting, dedupe, or precedence replaced by recency.
- [ ] 4.5 Write `project-email.projection.test.ts` (unit, R8). An unknown type, `email.received`, a schema-failing payload, a null `eventCreatedAt`, another `email_id` and misaligned `recipientKeys` each leave the projection equal, with no throw. Verify: `pnpm test` passes.
- [ ] 4.6 Export every primary export so far from `packages/core/src/index.ts`. Verify: `pnpm typecheck` exits 0.
- [ ] 4.7 Docs, part 1 (architecture and data-modeling). Verify: each edited evidence line links an existing test file, and every non-slice-0 evidence item it held before is still there.
  - architecture.md: Reliability core "Order independence" evidence and ADR-003 **Evidence** link the prop-test file, keeping the slice 1 sim-invariant half pending. ADR-003's prose states the full D1 order and that `complained` ranks between `delivered` and the terminal negatives (C4), recorded as an amendment in the ADR's existing style: "**amended 2026-10-16** (owner ruling, slice 0 pre-proposal D1)".
  - data-modeling.md: `email_state.status` is null before an outcome (C9). `email_recipients` gains the six signal columns `sticky_signal`, `sticky_signal_at`, `sticky_signal_svix_id`, `soft_signal`, `soft_signal_at`, `soft_signal_svix_id` (C3, D4). The slice-0 evidence lines link tests; later slices' lines stay.
- [ ] 4.8 Docs, part 2 (resend.md, about.md, features.md, card). Verify: RS-36, RS-37 and RS-38 each carry a quote and a Sources row, and each added test link resolves.
  - resend.md: the RS-U10 and RS-U11 rows cite their tests. Add three facts, each re-read on its page at apply and quoted, with Sources rows: RS-36, dashboard email events including `canceled` and `queued` (not webhook types), and `delivery_delayed` retried "for up to 14 hours" then `bounced` ([manage-emails](https://resend.com/docs/dashboard/emails/manage-emails.md)); RS-37, suppression origins `bounce` (permanent), `complaint` and `manual`, with suppressed sends skipped ([email-suppressions](https://resend.com/docs/dashboard/emails/email-suppressions.md), [suppression list](https://resend.com/docs/knowledge-base/why-are-my-emails-landing-on-the-suppression-list.md)); RS-38, Retrieve Email's `last_event` ([retrieve-email](https://resend.com/docs/api-reference/emails/retrieve-email.md)). A page that no longer says it drops the fact and goes in the report.
  - about.md: "What this project must demonstrate" row 1 links the properties. The RS-U10 and RS-U11 open-question bullets cite their tests.
  - features.md: the `projectEmail` bullet links its test.
  - Card: tick `Ships` 6 (masks from group 3 plus the two-recipient property).
- [ ] 4.9 Run `pnpm check`, then commit and push. Verify: `pnpm check` exits 0 before the commit, and `git status --short` is empty after the push.

## 5. `projectRecipient` (Ships 5, Ships 10; RS-U12; D6, D7)

- [ ] 5.1 Write `src/testing/ledger-history.ts` (`ledgerHistory({ namespace })`) per D15: at least 2 emails of at least 2 events each, several recipients per email, recipients shared across emails, and each event's `data.to` a subset. It puts sticky events before higher-ranked non-sticky ones on the same email (`suppressed` then `failed`, `complained` then a `Transient` bounce), and draws `data.bounce.type` from `Permanent`, `Transient`, `Temporary`, `Undetermined` and any string. Ids come from namespace plus counter. Verify: a unit test asserts a sample holds a shared recipient and a sticky-then-higher-ranked pair.
- [ ] 5.2 Write `project-recipient.projection.ts` per D6 / D7: sticky signal first, else the latest soft signal, else `ok` with null `since` / `causeEmailId`. It reads signals only, never `status`. Verify: `pnpm typecheck` exits 0.
- [ ] 5.3 Write `project-recipient.projection.prop.test.ts`: properties 1–4 with an oracle that reads the events behind the rows directly (max sticky signal; latest delivery or soft bounce). Add named tests "only `Permanent` yields hard_bounced; any other bounce.type yields soft_bouncing (RS-U12)", "a later delivery of the same email clears soft_bouncing", and the sticky-after-higher-ranked case. Export `projectRecipient` from `index.ts`. Verify: the properties pass, and deriving deliverability from a row's `status` makes property 3 fail (revert after).
- [ ] 5.4 Docs. Verify: `git grep -nE "RS-U1[0129]" -- .ai/resend.md` shows a test link on each of the four rows, and the card's fifth and tenth `Ships` boxes read `[x]`.
  - data-modeling.md: `recipient_state` states D6's fold from the row signals, never `status`; every non-`Permanent` bounce goes to `soft_bouncing` (C6, D7); `recipient_state.since` / `cause_email_id` are null while `ok` is undecided (C9).
  - architecture.md: ADR-003 **Evidence** and Reliability core add this prop-test file.
  - resend.md: the RS-U12 row cites its test.
  - about.md: the RS-U12 bullet cites its test.
  - features.md: the recipient-deliverability pointer moves to slice 0 (C5).
  - Card: tick `Ships` 5, and `Ships` 10 once the RS-U10, U11, U12 and U19 rows all cite their tests.
- [ ] 5.5 Run `pnpm check`, then commit and push. Verify: `pnpm check` exits 0 before the commit, and `git status --short` is empty after the push.

## 6. Simulator (Ships 8; D15, D16)

- [ ] 6.1 Add `packages/core/src/testing.ts` re-exporting `ledgerHistory`, and `"./testing": "./src/testing.ts"` to `packages/core/package.json` `exports`. Verify: `pnpm typecheck` exits 0.
- [ ] 6.2 Write `sim/src/main.ts` per D16. Flags via `parseArgs`: `--seed`, `--namespace`, `--duplicates`, `--shuffle`. It samples the history with `fc.sample(…, { seed, numRuns: 1 })`, applies seeded duplicates and a seeded permutation, projects, then prints the two header lines (`events` counts the generated events, `duplicates` the repeats added) and the masks-only JSON with `recipientKey` omitted. A bad flag prints `sim: <flag> <reason>` on stderr and exits 2. Add `"sim": "node --env-file-if-exists=.env.local sim/src/main.ts"` to the root `package.json`. Verify: `pnpm sim --seed 42 --namespace walk` exits 0 and line 1 is `sim seed=42 namespace=walk`.
- [ ] 6.3 Write `sim/src/main.e2e.test.ts`, spawning the running `node` binary on `sim/src/main.ts`. It asserts: the same seed and namespace twice give identical stdout; `--shuffle --duplicates 0.3` leaves the JSON block identical and line 2 shows a non-zero `duplicates`; another namespace gives different email ids; no generated `to`, `from` or `subject` that differs from its own mask appears in stdout (the history is regenerated with the same seed and namespace); `--duplicates 2` exits 2. Verify: `pnpm test:e2e` passes.
- [ ] 6.4 Docs. Verify: the Commands line names all four flags, and the card's eighth `Ships` box reads `[x]`.
  - Root AGENTS.md Commands gains `pnpm sim` with its flags.
  - rsa-manual-test environment.md: the `pnpm sim` row gains its exact command and flags.
  - pp-testing simulator.md Signing: "slice 0 or 1 writes it" becomes "slice 1" (C10).
  - Card: tick `Ships` 8.
- [ ] 6.5 Run `pnpm check` and `pnpm test:e2e`, then commit and push. Verify: both exit 0 before the commit, and `git status --short` is empty after the push.

## 7. Core import boundary (Ships 7; D17)

- [x] 7.1 First, confirm Biome lints from a temp directory holding copies of `biome.json`, `packages/core/package.json` and `packages/aws/package.json`, launched as the running `node` binary on `node_modules/@biomejs/biome/bin/biome` (it did when probed on 2026-10-16). If it no longer does, stop and report. Do not commit a violating file into the tree. Verify: one run over a `pg` fixture reports `lint/style/noRestrictedImports`.
- [x] 7.2 Write `packages/core/src/import-boundaries.test.ts` per D17, matching diagnostic paths after normalizing `\` to `/`. In `packages/core/src/`, `pg`, `drizzle-orm`, `drizzle-orm/pg-core`, `resend` and `@aws-sdk/client-sqs` each raise `lint/style/noRestrictedImports`, and `zod` raises none. In `packages/aws/src/`, `@aws-sdk/client-sqs` raises none and a deep `@ledger/db/src/x.ts` raises it (replace semantics, as probed). Verify: `pnpm test` passes, and deleting the `packages/core/**` override from `biome.json` makes the test fail (revert after).
- [x] 7.3 Docs. Verify: ADR-013's evidence still names the slice 2B item, `git grep -n "unproven until slice 0" -- .agents` prints nothing, and the card's seventh `Ships` box reads `[x]`.
  - architecture.md: ADR-013 **Evidence** links the test for the lint half and keeps "sim invariants pass in local mode (slice 2B)" pending.
  - about.md: the "Biome `overrides` scoping" bullet moves to Resolved: an override's list replaces the base list, as the test pins.
  - pp-general imports-and-tsconfig.md (Lint enforcement): the `[Unverified]` / "unproven until slice 0" sentences are replaced by the verified fact and the test's path.
  - Card: tick `Ships` 7.
- [x] 7.4 Run `pnpm check`, then commit and push. Verify: `pnpm check` exits 0 before the commit, and `git status --short` is empty after the push.

## 8. Secret-scan stage (Ships 3; Ask-first image and CI stage, owner-approved 2026-10-16 in PP §7; D18)

- [x] 8.1 Write `.gitleaks.toml` exactly as D18 gives it (the syntax was checked against v8.30.1 on 2026-10-16), each rule with a `description`. Verify: a scan of this repo with the pinned image reports no finding.
- [x] 8.2 Write `scripts/secret-scan.mjs` (Node built-ins only) per D18. Image: `ghcr.io/gitleaks/gitleaks:v8.30.1@sha256:c00b6bd0aeb3071cbcb79009cb16a60dd9e0a7c60e2be9ab65d25e6bc8abbb7f`. Steps: a canary repo with three runtime-assembled fake values, scanned with the repo scan's arguments plus a JSON report on stdout; a `git clone --mirror`; the repo scan with `--log-opts=--all --redact --no-banner --exit-code 1` and `safe.directory` passed through `GIT_CONFIG_*`; `<k>` from `git rev-list --all --count` in the mirror; temp dirs removed in `finally`. Verify: `node scripts/secret-scan.mjs` exits 0 and prints `secrets: canary caught 3/3 rules` and `secrets: repo clean (<k> commits scanned)`, run from this worktree and from a fresh non-worktree clone under `os.tmpdir()` (never the owner's main checkout). Breaking one custom rule's regex makes it print `secrets: canary missed rule <id>` and exit 1 (revert after).
- [x] 8.3 Add the stage `{ name: 'secrets', command: 'node scripts/secret-scan.mjs' }` to `scripts/verify.mjs`, right after `docker`. No `.github/workflows/ci.yml` edit. Verify: `pnpm verify --from secrets` runs it first and it passes (a partial run, not the gate).
- [x] 8.4 Docs. Verify: the Commands stage list matches `STAGES` in `scripts/verify.mjs`, and the card's third `Ships` box reads `[x]`.
  - Root AGENTS.md Commands: the `pnpm verify` stage list, and a line for `node scripts/secret-scan.mjs`.
  - rsa-manual-test environment.md: `node scripts/secret-scan.mjs` is listed as walkable.
  - Card: tick `Ships` 3.
- [x] 8.5 Run `pnpm check`, then commit and push. Verify: `pnpm check` exits 0 before the commit, and `git status --short` is empty after the push.

## 9. Link-check stage (Ships 9; CI stage, owner-approved 2026-10-16 in PP §7; D19)

- [ ] 9.1 Write `scripts/check-links.mjs` (Node built-ins only) per D19. It runs its canary first, checks `README.md` by default or the files named as arguments, skips `http(s):` and `mailto:`, and prints the D19 output lines. Verify: `node scripts/check-links.mjs` exits 0 with `links: canary caught 2/2` and `links: README.md <n> checked, 0 broken`. A temp `probe.md` with one valid and one missing-anchor link to a sibling `target.md` exits 1 with `2 checked, 1 broken` and `(missing anchor)`.
- [ ] 9.2 Add `{ name: 'links', command: 'node scripts/check-links.mjs' }` to `scripts/verify.mjs`, right after `lint`, so the order is `install, docker, secrets, lint, links, typecheck, unit, synth, e2e`. Remove "gitleaks and the README link check (slice 0)" from the planned-stages header comment (D20). Verify: `pnpm verify --from lint` runs `lint` then `links`, and both pass.
- [ ] 9.3 Docs. Verify: `node scripts/check-links.mjs` still exits 0, and the card's ninth `Ships` box reads `[x]`.
  - Root AGENTS.md Commands: the stage list, a line for `node scripts/check-links.mjs [file …]`, and the "planned stages" sentence with the slice-0 items removed.
  - rsa-manual-test environment.md: `node scripts/check-links.mjs` is listed as walkable.
  - Card: tick `Ships` 9.
- [ ] 9.4 Run `pnpm check`, then commit and push. Verify: `pnpm check` exits 0 before the commit, and `git status --short` is empty after the push.

## 10. Walkthrough

- [ ] 10.1 Write `openspec/changes/slice-0-foundations/WALKTHROUGH.md` in the format of `.agents/skills/rsa-manual-test/references/walkthrough-format.md`, following PP §21. Verify: as stated after the outline below.
  - Before you start: `pnpm install`, Docker running. Ask-first steps: none.
  - Path A: secret scan, walked as Reviewer.
  - Path B: link check, walked as Application developer. B1 is the README run; B2 is the temp `probe.md` missing-anchor case.
  - Path C: `pnpm sim` C1–C4, walked as Reviewer.
  - Path D: the CI run via `gh run list` / `gh run view --log`, walked as Reviewer.
  - Teardown T1 deletes B2's temp directory.
  - "What this walk cannot reach today" table: the local `pnpm verify` run and the suites go to `wf-after-apply-check`; `pnpm sim` against a live process goes to slice 1.

  Verify: every card `UI surfaces` entry is reached; both personas walk a path; every step has an exact command and an `Expect:` quoting output as the code prints it; no numbered line carries a blocked word without `→ slice N`.
- [ ] 10.2 Verify all ten `Ships` boxes on the card are ticked. The `Status` line stays `[~]` until the walk passes (PP §22; see Workflow follow-up). Then commit and push. Verify: `git status --short` is empty after the push.

## 11. Gate

- [ ] 11.1 Run `pnpm exec openspec validate slice-0-foundations --type change --strict`. Verify: it reports the change is valid.
- [ ] 11.2 After the final push, run `gh run list --branch slice-0-foundations --limit 1`. Verify: conclusion `success` on the pushed `HEAD`, and `gh run view <id> --log` shows the `secrets` and `links` stages passing. Report an in-progress run as in progress.
- [ ] 11.3 Run `pnpm verify` in the background, redirected to a log. Verify: it exits 0 and ends `VERIFY PASSED`.

## Workflow follow-up

- Run `wf-after-apply-check`. It READ-flags `Status` `[~]`, which is expected until the walk.
- Run `rsa-manual-test` over `WALKTHROUGH.md`. It records `WALKTHROUGH-RUN.md` in this folder.
- Once the walk passes, set the card's `Status` to `[x]` (PP §22), then commit and push.
- Run `opsx:archive`.
