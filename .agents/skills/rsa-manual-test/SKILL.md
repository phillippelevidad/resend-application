---
name: rsa-manual-test
description: Executes Ledger by hand the way the owner would — the `ledger` CLI, read-API requests, signed ingest requests and `pnpm sim` runs, locally or against the kept deploy — and reports what it observed, step by step, with `pass`, `fail`, `inconclusive`, `blocked` and `held (ask-first)` verdicts. Two modes. Walkthrough mode executes a slice's `openspec/changes/<change>/WALKTHROUGH.md` and records `WALKTHROUGH-RUN.md` beside it; free-form mode checks one behaviour on request ("try `ledger reconcile` against a gap", "does ingest actually dedupe", "reproduce this `--json` error") and records `.ai/testing/<YYYYMMDD-HHMM>-<slug>.md`. Load it for any request to walk, smoke-test, manually test, try out or reproduce something in Ledger — "walk the slice", "run the walkthrough", "manual test", "smoke test ledger", "reproduce", `/rsa-manual-test` — and in the slice chain right after `wf-after-apply-check` and before `opsx:archive`, whose hand-off depends on the run's verdict. It reports only: it never fixes code, never edits the walkthrough or a doc, never runs `pnpm verify` or the test suites (that gate is `wf-after-apply-check`'s), and never makes a live Resend write (send, `resend webhooks listen`, replay, webhook create or update, secret rotation), an AWS deploy or create, or an npm publish without the owner's yes in this conversation.
---

# rsa-manual-test — walk Ledger, report what it does

A test run is worth something only because it can surprise you. Do not decide the outcome in
advance. Ledger is an async pipeline: ingest answers `200` once an event is verified and enqueued
([ADR-001](../../../.ai/architecture.md#adr-001--verify-then-enqueue)), and a stopped worker looks
exactly like success. A verdict rests on the thing that changed, never on the absence of an error.

**Owns:** executing one `WALKTHROUGH.md` or one free-form check · the always-on
[watch-list](#watch-list--every-step-whatever-the-prompt-says) · the run file
([run-record.md](references/run-record.md)) · promoting confirmed defects to
`.ai/test-findings.md` · the [Known issues](references/environment.md#known-issues) rows · the run's
commit and push.

**Does not own:** fixing anything (→ `opsx:apply`, or [`wf-after-apply-check`](../wf-after-apply-check/SKILL.md)
for a change under verification) · the gate (→ `pnpm verify`, run by `wf-after-apply-check`) · what a
walkthrough must contain (→ [build-checklist → How to work this checklist](../../../.ai/build-checklist.md#how-to-work-this-checklist)
and [walkthrough-format.md](references/walkthrough-format.md)) · which commands, flags and codes
exist (→ [api-contract.md](../../../.ai/api-contract.md)) · the CLI's output rules (→
[pp-cli](../pp-cli/SKILL.md#output-and-exit-codes), checked here, never restated).

## Hard rules (MUST)

1. **Report only.** A run writes its run file, `.ai/test-findings.md` rows and
   [Known issues](references/environment.md#known-issues) rows, nothing else. It never edits code,
   config, migrations, the walkthrough or a doc: a stale walkthrough is a `doc-drift` finding.
2. **A step that observed nothing is not a pass.** It is `inconclusive`. Ingest `200` proves only
   "verified and enqueued". A `pass` names what changed: a ledger row read back, a projection
   state, an exit code with its `--json` field, an invariant line.
3. **Ask-first, in this conversation.** Never execute an `**Ask-first:**` step, or any unmarked live
   Resend write, AWS deploy or create, npm publish, or other action the card's `Ops` line reserves
   for the owner's approval that the run discovers, without the owner's yes in
   this conversation; otherwise its status is `held (ask-first)`. An approval in a pre-proposal, a
   change or another chat does not carry over ([Permissions](../../../AGENTS.md#permissions)).
   Before the first live action, post the [alignment message](#alignment-message) and wait.
4. **Test data only.** Resend test addresses only (`delivered@resend.dev`, `bounced@resend.dev`, …,
   [RS-32](../../../.ai/resend.md#facts)), never a real recipient address.
5. **Public repo: redact evidence.** Never paste into a run file a token (`LEDGER_TOKEN`, the
   plaintext `ledger token create` prints), an API key, a webhook signing secret, a deployed URL,
   an AWS account id, or a Resend webhook or account id. Write `<redacted:kind>` instead
   ([CBL-07, CBL-10](../../../.ai/check-before-launch.md#public-repo-hygiene)).
6. **Own only what you create.** Never reset or bulk-delete data the run did not create, and never
   stop a process it did not start. List everything it created (sim seed and run namespace, tokens
   minted, temporary webhooks). After an interrupted `resend webhooks listen`, check for a leftover
   webhook with a read-only list ([RS-33](../../../.ai/resend.md#facts),
   [RS-U18](../../../.ai/resend.md#unverified)); deleting one is a write, so Ask-first.
7. **Never run `pnpm verify` or the test suites.** That is `wf-after-apply-check`'s gate, not a walk.
8. **Wait on conditions, not sleeps.** Poll with a bounded timeout and record the waited time; a
   timeout without the change is `inconclusive`. Long commands follow
   [root AGENTS.md → Waiting for a long command](../../../AGENTS.md#waiting-for-a-long-command-on-this-machine):
   `run_in_background`, a log, `Monitor`, and a check that nothing survived before any restart.
9. **Time-box: 45 minutes wall clock** unless the prompt sets one. Read the clock (`date`) at the
   start and at each path. At the limit, mark the rest `not-run` and wrap up.
10. **Stop at a blocker.** A step that fails, retried once, with no route around it is `blocked`.
    Skip the steps that depend on it, keep the independent ones.
11. **One run, no sub-agents** unless the prompt asks. Running as a helper agent, this skill runs no
    git commands, read-only ones included (the HEAD sha and the next `TF-` id come from the
    orchestrator), and returns the run file to the orchestrator
    ([Commit and push as you go](../../../AGENTS.md#commit-and-push-as-you-go)).

## Procedure

1. **Parse.** Mode (walkthrough when a change or `WALKTHROUGH.md` is named or implied by the chain;
   free-form otherwise), target, overrides (time box, local or deployed, approvals given now). Write
   one sentence saying what "done" means. A missing input (a key, a URL) is `blocked` at the step
   that needs it, not a question, unless it changes what is tested.
2. **Read.** Walkthrough mode: the `WALKTHROUGH.md`, the build-checklist card of every slice its
   `→ slice N` notes name, the change's `tasks.md` and `VERIFICATION.md`. Free-form: the diff, the
   change, or the operation's entry in [api-contract.md](../../../.ai/api-contract.md). Never plan
   from a feature name alone.
3. **Environment** per [environment.md → Fast path](references/environment.md#fast-path). Record
   `git rev-parse --short HEAD`, whether the tree is dirty, and what the run started vs adopted.
4. **Align** if any step is live (rule 3), and wait for the reply.
5. **Execute.** Each step: command, exit code, observed output, status. Run the
   [watch-list](#watch-list--every-step-whatever-the-prompt-says) on every step. Fill the run file
   as you go, never at the end.
6. **Confirm** each finding once more: re-run it, or read the code that explains it. An
   unreproduced finding stays `unconfirmed`. The runner MAY run read-only SQL to confirm or explain
   a finding, never as a step's pass criterion and never a write: every slice is hand-walkable
   without SQL ([ADR-011](../../../.ai/architecture.md#adr-011--one-contract-many-surfaces)).
7. **Wrap up** ([below](#wrap-up)).

### Alignment message

```
Testing: <the behaviour or the walkthrough, one sentence>
Env: local (apps/local) | local mode (docker compose) | deployed (kept stack)   HEAD: <sha>
Plan: <3–6 one-line bullets, in run order>
Live Resend writes: <n — each, what it writes> | none
AWS actions: <n — each> | none
Evidence: <what will prove each claim: the ledger read, the invariant line, the exit code>
Anything here I should change?
```

## Watch-list — every step, whatever the prompt says

- **Exit code** matches [pp-cli](../pp-cli/SKILL.md#output-and-exit-codes): `0` success, `1` a
  registry error, `2` a usage error.
- **`--json` stdout** is exactly one JSON document and nothing else: no progress line, no colour.
- **Errors** carry the [one shape](../../../AGENTS.md#error-shape)
  `{ "error": { code, message, hint, docs } }`, and the `code` is in
  [api-contract.md → Error codes](../../../.ai/api-contract.md#error-codes).
- **No unmasked recipient address** in CLI output, API responses or logs: masks only
  ([Conventions → Redaction](../../../.ai/api-contract.md#conventions)).
- **No secret or token** in any output or log line, other than the one plaintext print of
  `ledger token create`.
- **Duplicates** leave one ledger row and no second effect.
- **State does not depend on arrival order**: it comes from the projection, never from transport
  ([ADR-003](../../../.ai/architecture.md#adr-003--projection-is-a-pure-function-of-the-event-set)).
- **Queue and DLQ return to 0** in `ledger health`, once the slice under walk ships it (slice 2).
- **One log line per failure**, JSON, holding only the [log fields](../../../.ai/data-modeling.md#log-fields).

Any breach of [lens clause 6](../../../AGENTS.md#decision-lens--evidence-over-claims-right-sized)
(a lost event, a duplicate effect, order-dependent state, a security or PII exposure, misstated
Resend behaviour or implied affiliation, a budget-alarm gap) is a **blocker**, whatever its size.

## Routing table

| Running | Load |
| --- | --- |
| A `WALKTHROUGH.md` | [walkthrough-format.md → How the runner reads it](references/walkthrough-format.md#how-the-runner-reads-it), [run-record.md](references/run-record.md), [environment.md](references/environment.md) |
| A free-form check | [run-record.md](references/run-record.md), [environment.md](references/environment.md) |
| Any step touching Resend | [.ai/resend.md](../../../.ai/resend.md) (the `RS-NN` facts and `[Unverified]` rows) |
| Any deploy, teardown or AWS step | [.ai/aws.md](../../../.ai/aws.md) and [check-before-launch.md](../../../.ai/check-before-launch.md) |

## Wrap-up

1. **Close the run file:** every step has a status, the verdict and the counts are filled
   ([run-record.md](references/run-record.md)).
2. **Promote** per [run-record.md → Promote](references/run-record.md#promote-to-test-findingsmd).
3. **Clean up what the run created:** revoke the tokens it minted, stop only the processes it
   started, and list what remains under `## Data created`.
4. **Commit and push** the run file, any `.ai/test-findings.md` rows and any Known-issues rows as
   one commit through [wf-commit](../wf-commit/SKILL.md): staged by path, message through a file
   and `git commit -F` ([Commit messages](../../../AGENTS.md#commit-messages)), no attribution
   line of any kind, then `git push`. Rule 11 applies as a helper agent.
5. **Report** in at most 15 lines: verdict · counts by status and by severity · the findings ·
   the held Ask-first steps, each with what it writes · what was blocked and why · data created ·
   the run file path · the next step ([Archive hand-off](#archive-hand-off)).

## Archive hand-off

Name `opsx:archive` as the next step only when the latest run has no `fail`, no `inconclusive`, no
`blocked` and no `not-run` step. A `held (ask-first)` or `skipped (owner-observed)` step is listed
for the owner and does not block by itself, **unless a `Ships` bullet's evidence is that step**
(slice 2's verify-stage send, slice 3's alarm email): then it MUST be `pass`, run by the owner or
with their yes, before archive. A `pass (doc-drift)` step goes back to `wf-after-apply-check`,
which corrects the walkthrough, so a stale one is never archived. Otherwise the next step is
`wf-after-apply-check` or `opsx:apply` with the findings.
