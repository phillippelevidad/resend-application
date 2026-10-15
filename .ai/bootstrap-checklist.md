# Bootstrap checklist — writing the `.ai/` docs

The ordered plan for turning every template in `.ai/` into its final, ratified version. Work it top
to bottom: each step lists what it depends on, so steps whose dependencies are done MAY run in
parallel. **Delete this file when every step is `[x]`** (step 16 does it).

## How a step runs

1. Open the step's file. It starts with a **TEMPLATE banner** and an `AGENT INSTRUCTIONS` comment:
   purpose, inputs, research, required structure, evidence rules, done-when. Follow them.
2. Research before writing. Resend behavior is verified against its docs
   (`https://resend.com/docs/llms.txt`, any page as `.md`) and cited; AWS behavior against AWS docs.
   What the docs don't settle goes to [about.md → Open questions](about.md#open-questions), tagged
   `[Unverified]`, never guessed.
3. Replace the preview content. Preview content is illustrative only — it was drafted from
   [docs/idea.md](../docs/idea.md) without research and MUST NOT survive unverified.
4. Remove the TEMPLATE banner and the `AGENT INSTRUCTIONS` comment. A file without them is final.
5. Owner decisions the step surfaces are asked in **one batched round**, each with a recommended
   pick ([decision lens](../AGENTS.md#decision-lens--evidence-over-claims-right-sized)).
6. Tick the step here, then commit and push (`docs: write .ai/<file>`).

## Legend

`[ ]` todo · `[~]` in progress · `[x]` done · `[!]` blocked on an owner decision

## Owner calibration (ratified 2026-10-15)

These answers are inputs to steps 1–2 and are not re-asked:

- **Authority:** `docs/idea.md` is frozen as a dated RFC (step 13). `.ai/` becomes the only living
  source: facts → `resend.md`/`aws.md`, decisions → ADRs, open questions → `about.md`.
- **Milestones, no dates:** **M1 — MVP** (foundations, local v0, durable ingest on AWS, recovery,
  and a usable CLI; evidence over breadth) · **M2 — Feature complete** (every
  [idea §7](../docs/idea.md#7-implementation-plan) phase at v0 depth, real AWS deploy, simulator
  evidence) · **M3 — Stretch** (SDK and CLI published to npm with semver; real AWS load numbers
  from the 10k burst; a learning log of the AWS and distributed-systems decisions). Upstream PRs to
  Resend's Webhook Ingester are not planned.
- **AWS posture:** deploy, record, keep. Real deploys to a personal account; the stack stays up
  until the **owner** decides to tear it down, because review timing is unknown. So idle cost must
  be near zero and **budget alarms with a hard monthly cap are mandatory**, not polish. AWS Budgets
  only alerts — it has no native hard stop — so "hard cap" means alerts **plus** a kill switch that
  stops spend when the cap is hit ([aws.md → Budget alarms](aws.md#budget-alarms), step 5).
- **"Overdoing it", working definition:** effort is admitted when it produces something a reviewer
  can check — a test, an invariant, a measured number, a working command — against a stated role
  requirement or Resend value. Overdoing it is generality beyond the demo's ceiling (multi-tenant,
  multi-database), polish nobody notices in a 30-minute review, and infrastructure depth no claim
  depends on. Learning AWS is the point; learning that no ADR or test makes visible is wasted.

## Steps

### Step 1 — `about.md` and the decision lens

- **Status:** `[x]`
- **Produces:** [about.md](about.md); the rewritten decision lens in [root AGENTS.md](../AGENTS.md#decision-lens--evidence-over-claims-right-sized) (keep the heading text — skills cite its anchor).
- **Depends on:** owner calibration (above).
- **Owner input:** confirm the lens draft and the risk appetite before ratifying.
- **Done when:** every anchor the skills cite exists (`#risk-appetite`, `#open-questions`, `#target-personas`, `#platform-scale-assumptions`, `#domain-vocabulary`, `#non-goals--out-of-scope`); [idea §10](../docs/idea.md#10-open-questions) is carried into Open questions.

### Step 2 — `decision-lens-suite.md`

- **Status:** `[x]`
- **Produces:** [decision-lens-suite.md](decision-lens-suite.md).
- **Depends on:** 1.
- **Done when:** the lens from step 1 reproduces every case's verdict **and** its reason from its own text; score recorded.

### Step 3 — `features.md`

- **Status:** `[x]`
- **Produces:** [features.md](features.md) — adopter lifecycle (binding), journeys, capability inventory, Ingester parity (non-binding).
- **Depends on:** 1. MAY run in parallel with 4 and 5.
- **Owner input (2026-10-15):** *verify* is one real test send to `delivered@resend.dev` plus `ledger email`; the simulator never targets a stack holding adopter data. A project domain is deferred on a tripwire ([about.md](about.md#open-questions)).

### Step 4 — `resend.md`

- **Status:** `[x]`
- **Owner input (2026-10-15):** read-only live calls allowed, with the owner's key in the git-ignored `.env.local`; any write falls back to an `[Unverified]` row plus a proposed Ask-first experiment. Every open item names the slice that owes it, so nothing ships resting on a guess. Key layout deferred to step 6. Sending-side facts included.
- **Produces:** [resend.md](resend.md) — every Resend behavior Ledger relies on, as stable `RS-NN` facts with cited pages.
- **Depends on:** 1. MAY run in parallel with 3 and 5.
- **Note:** read-only research. Any **write** call against a live Resend account is Ask-first.
- **Back-fill:** replace the Resend page links in [features.md](features.md) with their `RS-NN` ids.

### Step 5 — `aws.md`

- **Status:** `[ ]`
- **Produces:** [aws.md](aws.md) — AWS service limits and semantics Ledger relies on, as `AWS-NN` facts, plus the cost shape and the budget-alarm design.
- **Depends on:** 1. MAY run in parallel with 3 and 4.

### Step 6 — `integrations.md`

- **Status:** `[ ]`
- **Produces:** [integrations.md](integrations.md) — Resend calling discipline, the relationship to the Webhook Ingester, and the Postgres host decision.
- **Depends on:** 4, 5.
- **Owner input:** the Postgres host pick (recommendation required).

### Step 7 — `architecture.md`

- **Status:** `[ ]`
- **Produces:** [architecture.md](architecture.md) — ADRs, system shape, Deferred (YAGNI), the build order with final slice IDs mapped to milestones M1–M3, risks.
- **Depends on:** 2, 3, 4, 5, 6.
- **Owner input:** the M1 slice cut, including how the MVP CLI reads state (see the conflict noted in the file).
- **MUST:** every `RS-UNN` row in [resend.md](resend.md#unverified) and every unverified bullet in [about.md](about.md#open-questions) lands in the slice it names, or moves with a recorded reason. Constraint 4 in resend.md (`401` does not stop retries) supersedes the idea §5.2 rationale.

### Step 8 — `data-modeling.md`

- **Status:** `[ ]`
- **Produces:** [data-modeling.md](data-modeling.md).
- **Depends on:** 7.

### Step 9 — `api-contract.md`

- **Status:** `[ ]`
- **Produces:** [api-contract.md](api-contract.md) — every operation with its surfaces (route, SDK, CLI, MCP), scopes, errors, and the error-code registry.
- **Depends on:** 3, 7, 8.
- **Note:** the post-propose gate BLOCKs any change citing an operation missing from this file, so it MUST be final before the first `opsx:propose`.
- **Back-fill:** every surface a [features.md journey](features.md#journeys) names resolves to an operation here (DLQ inspect/redrive and the health read included).

### Step 10 — `build-checklist.md`

- **Status:** `[ ]`
- **Produces:** [build-checklist.md](build-checklist.md) — one card per slice, in the exact format the `wf-*` scripts parse.
- **Depends on:** 7, 8, 9.
- **Back-fill:** replace the phase-named slice pointers in [features.md](features.md) (`· recovery · M1`) with card anchors (`build-checklist.md#<id>--<kebab-title>`). Do the same for the *Owed by* column in [resend.md → \[Unverified\]](resend.md#unverified) and the slice names in [about.md → Open questions](about.md#open-questions). Each owing card's done-when MUST name the `RS-UNN` it settles, or proves safe either way, along with its Ask-first experiment.

### Step 11 — `check-before-launch.md`

- **Status:** `[ ]`
- **Produces:** [check-before-launch.md](check-before-launch.md) — homeless pre-deploy and pre-demo checks.
- **Depends on:** 5, 7. Grows after every deploy.

### Step 12 — `commands/auto-decide.md`

- **Status:** `[ ]`
- **Produces:** [commands/auto-decide.md](commands/auto-decide.md).
- **Depends on:** 1, 2.

### Step 13 — Freeze `docs/idea.md`; realign root docs

- **Status:** `[ ]`
- **Produces:** an RFC banner on [docs/idea.md](../docs/idea.md) (status Accepted, dated, "living decisions are in `.ai/`"); root `AGENTS.md` updated: *Product & domain context*, the "do NOT re-litigate" sentence (now points at ADRs), *Data model*, *Projects*; README pointer.
- **Depends on:** 1–11.

### Step 14 — Adapt the `wf-*` skills to Ledger

- **Status:** `[ ]`
- **Produces:** the script and reference fixes the de-branding pass deferred — `check.mjs` source roots (`packages`, `apps`, `infra`, `sim`), Prisma → Drizzle `pgTable`, tenant/RLS/money/LGPD tripwires replaced or removed, `VERBS` gains `redrive`/`replay`/`inspect`/`explain`, `views.md` and BFF duties removed, the self-service stages, missing `pp-*`/`wf-open-question` references resolved.
- **Depends on:** 7, 8, 9, 10.

### Step 15 — Install OpenSpec

- **Status:** `[ ]`
- **Produces:** `openspec/` (`changes/`, `specs/`, `config.yaml` injecting the `.ai/` read order and per-artifact rules). Required by the post-propose and post-apply gates.
- **Depends on:** 13, 14. **Ask-first** (new dependency).

### Step 16 — Finalize the index

- **Status:** `[ ]`
- **Produces:** [AGENTS.md](AGENTS.md) index matches the files on disk; root `AGENTS.md → Patterns and practices` lists the skills; this file deleted.
- **Depends on:** 1–15.

## Later — not part of the bootstrap

- `test-findings.md` and `testing/` — once slice 1 ships something to walk (CLI/API/simulator runs, not browser walks).
- A walkthrough-runner skill to write into them.
