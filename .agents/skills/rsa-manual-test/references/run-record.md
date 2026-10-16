# Run record

A run leaves one file: `WALKTHROUGH-RUN.md` in the change folder (walkthrough mode) or
`.ai/testing/<YYYYMMDD-HHMM>-<slug>.md` (free-form). Confirmed defects outside an open change also
reach `.ai/test-findings.md`. Write so a fix agent can act on a finding **without re-testing**.

## Statuses

| Status | When |
| --- | --- |
| `pass` | Observed matches `Expect:` in substance, and the run saw the thing that changed |
| `pass (doc-drift)` | The product matches a newer, deliberate intent; the step's text is stale ([How the runner reads it](walkthrough-format.md#how-the-runner-reads-it)) |
| `fail` | Observed differs from `Expect:`, and the step should work today |
| `inconclusive` | The step ran but observed nothing that proves the outcome: a bounded wait timed out, a `200` with no ledger row read back, a duplicate with no proof it reached ingest |
| `blocked` | Could not run: a failed earlier step, a missing variable or key, retried once with no route around |
| `held (ask-first)` | A live Resend write, AWS deploy or create, or npm publish with no owner yes in this conversation |
| `n/a-today (slice N)` | The step names slice N and slice N's `Status` is not `[x]` |
| `skipped (<why>)` | Deliberately not run: `destructive`, `owner-observed` (an inbox only the owner reads), or another stated reason |
| `not-run` | Past the time box |

## Severity and category

| Severity | When |
| --- | --- |
| **blocker** | The flow cannot complete for the persona it serves, or any [lens clause 6](../../../../AGENTS.md#decision-lens--evidence-over-claims-right-sized) breach, whatever its size |
| **major** | An adopter hits a wrong exit code, error `code`, `--json` shape or state |
| **minor** | `message` or `hint` copy, masking cosmetics, a `docs` link |
| **polish** | Cosmetic, no adopter impact |

Categories: `bug` · `contract` (exit code, `--json`, error shape, `code`) · `data` (ledger or
projection) · `security` (secrets, PII, auth) · `ops` (deploy, teardown, cost, alarm) · `doc-drift` ·
`environment`.

## Evidence and redaction

Evidence is text, never an image: the command, its exit code, an output excerpt of at most 20
lines, the sim seed and run namespace (the first line of every `pnpm sim` run), the `email_id` and
`svix_id` observed, and the time waited.

**Truth ranking, strongest first.** When two sources disagree, the higher one wins:

1. Resend's own record, through a read-only call.
2. The ledger: `ledger email`, `ledger recipient`, or the read API over `webhook_events` and the
   projections.
3. Queue and DLQ depth: `ledger health` (slice 2 on).
4. The ingest HTTP response, which proves only "verified and enqueued".

**Redaction** is [SKILL.md hard rule 5](../SKILL.md#hard-rules-must): tokens, API keys, signing
secrets, deployed URLs, AWS account ids, Resend webhook and account ids become `<redacted:kind>`.
Addresses appear only as Resend test addresses or as the API's mask.

## Walkthrough run file

`openspec/changes/<change>/WALKTHROUGH-RUN.md`: the latest run only, overwritten each run (git
keeps the history), archived with the change, at most ~80 lines.

```markdown
# Slice <id> — walkthrough run

- **Run:** <YYYY-MM-DD HH:MM> · walkthrough mode · change `<change>`
- **HEAD:** `<short sha>` (clean | dirty: <paths>) · **Environment:** local | deployed
- **Started by this run:** <processes> · **Adopted:** <processes> | none
- **Time box:** 45 min · **Wall clock used:** <n> min

**Verdict:** walked | walked with findings | not walkable | blocked — <one sentence>.

| pass | doc-drift | fail | inconclusive | blocked | held | n/a-today | skipped | not-run |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |

| Step | Status | Observed | Finding |
| --- | --- | --- | --- |
| A1 | pass | exit 0, `"object": "email"`, state `delivered` | |

## Findings

### F1 — <what goes wrong, one line>

- **Severity:** major · **Category:** contract · **Status:** confirmed | unconfirmed · **Step:** A3
- **Expected:** <…>, per <the step, an api-contract.md entry, a pp-cli rule>
- **Observed:** <verbatim output, exit code>
- **Evidence:** <command, seed and namespace, ids, waited time>
- **Suspected cause:** `<file:line>` | `[Unverified]`
- **Proposed fix:** <the outcome, not the code>

## Held for the owner

- <A6 — one send to `delivered@resend.dev`: writes one email to the owner's Resend account>

## Data created

- <sim namespace `<ns>`, seed `<seed>`: kept | token `<redacted:token>` id <token_id>: revoked>
```

## Free-form run file

`.ai/testing/<YYYYMMDD-HHMM>-<slug>.md`, local time at the start (`date +%Y%m%d-%H%M`), slug in
kebab-case from the request. One file per run, never a folder. The same shape as the walkthrough
run file, titled for the request, with `- **Request:** <the prompt, verbatim>` as its first bullet
and `free-form` as its mode.

## Promote to test-findings.md

- **What is promoted:** a **confirmed** blocker, major or minor finding from a free-form run, or a
  walkthrough-mode finding against code outside the change under walk. A finding inside the change
  under walk stays in its `WALKTHROUGH-RUN.md`: that change fixes it. Not promoted: `polish`,
  `unconfirmed`, `environment` (a [Known issues](environment.md#known-issues) row instead).
- **Elsewhere:** a deploy-time check no slice owns goes to
  [check-before-launch.md](../../../../.ai/check-before-launch.md) only if it passes its
  [admission test](../../../../.ai/check-before-launch.md#what-belongs-here); an unverified Resend
  behaviour goes to [about.md → Open questions](../../../../.ai/about.md#open-questions), tagged
  `[Unverified]`.
- **First use creates the file** `.ai/test-findings.md`, with this header:

  ```markdown
  # Test findings

  Confirmed defects found by `rsa-manual-test` outside an open change. A fixed row is deleted and
  its id is never reused.

  | TF-NN | Seen | What happens | Cause | Proposed fix |
  | --- | --- | --- | --- | --- |
  ```

- **Row:** `| TF-07 | … | … | … | … |`. *Seen*: the surface, the
  command, and a link to the run finding. *What happens*: observed against expected, one to three
  sentences. *Cause*: `file:line` or `[Unverified]`. *Proposed fix*: the outcome.
- **Dedupe:** an open row that covers it gets its TF id written into the finding, not a new row.
- **Id:** one above the highest `TF-` id in the file **and** its history, because fixed rows are
  deleted: `git log -p -- .ai/test-findings.md | grep -o "TF-[0-9]*" | sort -t- -k2 -n | tail -1`.
  Write the id back into the finding.
