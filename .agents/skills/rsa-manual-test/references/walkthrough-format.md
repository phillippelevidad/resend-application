# Walkthrough format

The one format for a slice's `openspec/changes/slice-<id>-<kebab>/WALKTHROUGH.md`. The rule it
serves is [build-checklist → How to work this checklist](../../../../.ai/build-checklist.md#how-to-work-this-checklist)
(the walkthrough a slice owes); this file adds the shape. The pre-proposal's §21 sketches the paths,
`opsx:apply` writes the file, [`wf-after-apply-check`](../../wf-after-apply-check/SKILL.md) Pass 5
desk-checks it against the code, and [`rsa-manual-test`](../SKILL.md) executes it before
`opsx:archive`.

## Template

Copy it; replace every `<…>`.

````markdown
# Slice <id> — walkthrough

What one person does, in ~15 minutes, to prove this slice works.

**Read this first.** A step that cannot be completed today ends with `→ slice N`, naming the slice
that carries it. A step without such a note that fails is a finding against this slice.

## Before you start

```bash
pnpm install
<non-destructive setup commands, from root AGENTS.md → Commands>
```

- **Environment variables (names only):** `LEDGER_URL`, `<…>`.
- **This walk creates:** <sim run namespace, tokens, temporary webhooks, …>; Teardown removes <…>.
- **Ask-first steps:** <A4 — one send to `delivered@resend.dev`>, <…> | none.

## Path A — <surface(s)>: <what it proves>

**Walked as:** <persona from about.md → Target personas>

1. **<Bold action>.**

   ```bash
   <exact command or request>
   ```

   Expect: <exit code>; <exact output fragment, `--json` field and value, or error `code`>.
   → **Why it matters.** <one line, optional>

## Teardown

1. **<Revoke, stop or delete what the walk created>.** Same shape as a path step. Deleting a
   temporary webhook is a write, so the last Ask-first.

## What this walk cannot reach today

| Not reachable | Carried by |
| --- | --- |
| <behaviour> | [slice N](../../../.ai/build-checklist.md#<card-anchor>) |
````

Paths are lettered `A`, `B`, …; a runner cites a step as path letter plus number (`A3`), teardown
steps as `T1`, `T2`. Links in the file are relative to the change folder.

## Step format

Every step is a numbered list item (`1.`). `wf-after-apply-check/scripts/check.mjs` counts the
`## Path` headings and every line matching `^\s*\d+\.\s`, and blocks a walkthrough with none.

- **Line one:** `N. **<Bold action>.**`, imperative.
- **The command:** a fenced `bash` block with the exact command or request. API steps use `curl`
  with the variable names `$LEDGER_URL` and `$LEDGER_TOKEN`, never values.
- **`Expect:`** the exit code, and the exact output fragment, `--json` field and value, or error
  `code`, quoted as the code produces it. "It works" is not an expectation.
- **Optional:** `→ **Why it matters.**` in one line.
- **`**Ask-first:** <action>`** on every step that writes to a live Resend account (a send,
  `resend webhooks listen`, a replay, a webhook create or update, a secret rotation), deploys or
  creates on AWS, publishes to npm, or does anything else the card's `Ops` line reserves for the
  owner's approval ([Permissions](../../../../AGENTS.md#permissions),
  [build-checklist → How to work this checklist](../../../../.ai/build-checklist.md#how-to-work-this-checklist)).
- **Not completable today:** the step ends with `→ slice N`, linked to the card. check.mjs blocks a
  numbered line that says `not yet`, `cannot`, `does not exist`, `coming`, `todo`, `no surface` or
  `nothing` without a `slice N` or `→` on the same line, so keep those words off line one or end it
  with the note.

Worked examples, one per surface kind. **Illustrative: the slice's own card and
[api-contract.md](../../../../.ai/api-contract.md) are the source** of every command, flag, field
and code.

````markdown
3. **Read the email back.**

   ```bash
   ledger email <email_id> --json
   ```

   Expect: exit `0`; stdout is one JSON document with `"object": "email"` and the state `delivered`
   (field name as `packages/sdk/openapi.json` gives it). An unknown id instead exits `1` with
   `"code": "email_not_found"`.

4. **Send a request with a bad signature.**

   ```bash
   curl -s -o /dev/null -w '%{http_code}\n' -X POST "$LEDGER_URL/webhooks/resend" \
     -H 'content-type: application/json' -H 'svix-id: msg_walk_a4' \
     -H "svix-timestamp: $(date +%s)" -H 'svix-signature: v1,AAAA' -d '{"type":"email.sent"}'
   ```

   Expect: `401`. Ingest is not an operation, so the body carries no registry `code`
   (api-contract.md → Ingest boundary).

5. **Run the simulator with duplicates and shuffle.**

   ```bash
   pnpm sim --duplicates 0.2 --shuffle
   ```

   Expect: exit `0`; the first line prints the seed and the run namespace; invariants 1 and 2
   reported as passed, by number (<the line as the simulator prints it>).

6. **Send one test email.**

   ```bash
   curl -X POST 'https://api.resend.com/emails' -H "Authorization: Bearer $RESEND_API_KEY" \
     -H 'Content-Type: application/json' \
     -d '{"from":"onboarding@resend.dev","to":["delivered@resend.dev"],"subject":"walk A6","html":"<p>walk</p>"}'
   ```

   Expect: a response carrying the new email's `id`, or `403` `validation_error` if test addresses
   are not exempt from the own-address rule (RS-34, [RS-U14](../../../../.ai/resend.md#unverified));
   then step 7 reads it with `ledger email`.
   **Ask-first:** one live send from the owner's Resend account (counts against quota, RS-32).
````

Sources: [Ingest boundary](../../../../.ai/api-contract.md#ingest-boundary) and Error codes; the
[slice 1 card](../../../../.ai/build-checklist.md#1--local-ledger-and-read-path)'s `UI surfaces`;
Resend's [Send Email](https://resend.com/docs/api-reference/emails/send-email). Sign within 5 minutes
of `svix-timestamp` (RS-02), or the `401` proves nothing about the signature.

## Coverage

- **Every surface reached, every role walked.** Every entry on the card's `UI surfaces` line is
  reached by at least one step. A path MAY group entries walked together (`pnpm sim`, then
  `ledger email`); its `**Walked as:**` names a [persona](../../../../.ai/about.md#target-personas),
  and every persona that reaches the slice walks at least one path (about.md: "walked by hand in
  every role that reaches it").
- **Every self-service stage the card claims** (`deploy → connect the webhook → ingest → query →
  recover → tear down`, [about.md → Guiding principles](../../../../.ai/about.md#guiding-principles))
  has a step ([B7](../../wf-after-apply-check/references/findings.md#b7--the-slice-cannot-be-walked)).
- **Every `Ships` bullet whose evidence is a working command** has a step.
- **No SQL in a step.** A state a step needs is read through the CLI, the API or the simulator.
- **Setup is non-destructive.** No reset, no delete of data the walk did not create.
- **~15 minutes** for one person. A walk that recurs per review is a script candidate
  ([lens clause 1](../../../../AGENTS.md#decision-lens--evidence-over-claims-right-sized)): say so on the card.

## How the runner reads it

- **Step ids** are the walkthrough's own (`A3`, `T2`); setup commands are `S1`, `S2`, in order.
- **Before you start:** run each command. A destructive one (a reset, a bulk delete) is
  `skipped (destructive)`, and the state it would set is confirmed another way. A missing
  environment variable is `blocked`, naming the variable, never its value.
- **`→ slice N`:** if slice N's `Status` in [build-checklist](../../../../.ai/build-checklist.md#legend)
  is not `[x]`, the step is `n/a-today (slice N)`. If it is `[x]`, execute and judge the step: never
  hide a regression behind an old note.
- **`**Ask-first:**`** steps run only on the owner's yes in this conversation, else
  `held (ask-first)` ([SKILL.md hard rule 3](../SKILL.md#hard-rules-must)).
- **Observed ≠ expected:** decide which side is wrong before filing.

| Situation | Record |
| --- | --- |
| The product does not do what the step, a spec or a ratified `.ai/` doc says, and nothing later changed that intent | `fail` + a finding |
| A later change deliberately moved the behaviour, and the product matches the newer intent | `pass (doc-drift)` + a `doc-drift` finding naming the step, what it says and what is true now |
| Cannot tell which side is right | `fail` + a finding with cause `[Unverified]`, both readings stated |

The [watch-list](../SKILL.md#watch-list--every-step-whatever-the-prompt-says) applies to every step, even where `Expect:` is silent.
