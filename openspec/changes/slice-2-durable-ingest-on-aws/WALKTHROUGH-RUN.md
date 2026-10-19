# Slice 2 — walkthrough run

- **Run:** 2026-10-18 19:39 · walkthrough mode · change `slice-2-durable-ingest-on-aws`
- **HEAD:** `bd4cf16` (clean) · **Environment:** local (apps/local), then deployed (us-east-2, Neon)
- **Started by this run:** `pnpm dev:full` (stopped in W2); both stacks (kept) · **Adopted:** none
- **Time box:** 45 min, overridden by the owner's approval of the whole walk · **Wall clock used:** 52 min, owner wait included
- **Order:** the owner approved every Ask-first step in this conversation and asked to front-load the owner-run steps: A → B1, B2, B4 → T → B5 → G1–G3 → E1–E4 → F1, F2, F4 → C → D → F3, F5, W1 → E5 → B3 → G4 → W2. Each step ran on the stack shape its `Expect:` assumes.
- **Rerun:** 2026-10-18 21:36 · HEAD `75297d1` (clean) · deployed · 13 min · the failed steps only, owner-approved in this conversation ("rerun this"): T1 → T2 → T3 → G4 → G6. Rows T1–T3, G4–G6 are this rerun's; every other row is the first run's. T3 ran with C's webhook in place, so its ingest URL changed: the Resend webhook was repointed (owner-approved `PATCH /webhooks/{id}`, its 10 events resent unchanged) and `.env.deployed.local`'s `LEDGER_URL` rewritten.

**Verdict:** walked with findings — F2 and F3 are fixed and verified on AWS; the drill budget deploys but cannot trip an account whose month-to-date spend is 0.00 USD (F4), so AWS-U01's second half and G5 stay open.

| pass | doc-drift | fail | inconclusive | blocked | held | n/a-today | skipped | not-run |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 44 | 0 | 0 | 1 | 1 | 0 | 0 | 1 | 0 |

| Step | Status | Observed | Finding |
| --- | --- | --- | --- |
| S1–S5 | pass | install exit 0; Docker `28.0.4`; `LEDGER READY in 10s` (its `db:setup` printed only `ready`: `.env.local` already slice-2 shaped, so the first-setup `wrote` lines were not observable); names only; tree clean | |
| S6 | skipped (env routed) | `$AWS_REGION` empty, `AWS_PROFILE` unset, `aws` not on PATH ([K2](../../../.agents/skills/rsa-manual-test/references/environment.md#known-issues)); profile `ledger`, `us-east-2` set per command | |
| A1 | pass | `db:setup: ready`, exit 0, no `wrote` line | |
| A2 | pass | `local-setup` (the documented variant), `operate`, id 7, no hash or plaintext, exit 0 | |
| A3 | pass | JSON exact (`storage_bytes` 8574655); human layout exact, `8.6 MB of 1.0 GB`; exit 0 both | |
| A4 | pass | `worker      enabled (already enabled)`, exit 0 | |
| A5 | pass | layout exact, id 8, `secret      ldg_<redacted:token>`, stderr notice exact; no `--name` → exact error, exit 2 | |
| A6 | pass | read token → exact `forbidden` body, `403`; no token → exact `unauthorized` body, `401` | |
| A7 | pass | list layout exact; revoke 8 exact, exit 0; `token current` still id 7; revoked token → `401`. `last_operate_token` revoke skipped per the step: three active `operate` rows (7, 3, 1), two not this run's | |
| B1 | pass | `50` (AWS-U05; ≥ `MaximumConcurrency` 5) | |
| B2 | pass | four bundling lines, both synth lines, exit 0 (plus CDK's `AI agent detected`); grep no file, `grep exit=1` | |
| B3 | pass | after C6: `synthesizing`, `migrating`, then stderr exactly the `key_id differs` refusal, exit 1, no `deploying` line | |
| B4 | pass | the 12 lines exact, token `<redacted:token>`, `KillSwitchArmed true`, exit 0; `token current` → `bootstrap`, id 1 | F1 |
| B5 | pass | the 10 lines exact, no token line, exit 0 | |
| G1 | pass | the 8 lines exact: trip 13s, `429` ×5, Errors alarm 95s, restore 25s; stderr empty; exit 0 (reserved concurrency `0` accepted on the 50-quota account) | |
| G2 | pass | inside the trip window: the exact `api_unavailable` document, exit 1 | |
| G3 | pass | `error: unknown command 'reconcile'`, exit 2 | |
| G4 | inconclusive | rerun: the deploy half passes (F3 fixed): B5's lines, exit 0; `LedgerGuardrails-drill` exists with one `ACTUAL` `GREATER_THAN` `0.1` `ABSOLUTE_VALUE` notification, state `OK`. The trip half cannot happen: both budgets read actual spend `0.0` USD | F4 |
| G5 | blocked | depends on G4's budget trip | F4 |
| G6 | pass | rerun, right after G4 (owner: "Deploy, then remove"): B5's lines, exit 0; budget names `LedgerGuardrails-monthly` plus one account budget outside this project, no `LedgerGuardrails-drill`; health all zero, `worker enabled` | |
| T1 | pass | rerun: the 7 lines exact, no `leftover` line, `0 secret(s)`, exit 0. The tagging index still listed 1 ARN, the destroyed event source mapping (`get-event-source-mapping` exit 254), so F2's check ran; CloudFormation lists only `CDKToolkit` | F2 |
| T2 | pass | rerun: 0 `ledger/` secrets, matching T1's `0 secret(s)` (AWS-U06) | |
| T3 | pass | rerun, first deploy only: B4's lines without the token line, `ledger/webhook-signing-secrets written` (C2's variable is now set), exit 0; new API URL; `token current` → `bootstrap` id 1; health all zero. The first run covered the `--issue-operate-token` deploy | |
| C1 | pass | owner-run; the webhook exists and signs correctly, shown by C5 | |
| C2 | pass | `LEDGER_DEPLOY_WEBHOOK_SECRETS=`, the value shaped `whsec_…` (checked by count, not printed) | |
| C3 | pass | B5's lines with `ledger/webhook-signing-secrets written`, exit 0; no `whsec_` in any output; cdk.out rescan `grep exit=1` | |
| C4 | pass | `{"id":"<email_id>"}`, `200` | |
| C5 | pass | within 3 s: the exact document, `delivered`, masks exact, `event_count` 2, timeline `email.sent` then `email.delivered`, each `msg_…` | |
| C6 | pass | health exact, queue and DLQ 0; two `ingest.request_decoded` lines, `body_base64_count` 0 (AWS-U04: plain body), allow-listed fields only | |
| D1 | pass | layout exact, three spaces after each timestamp | |
| D2 | pass | the four lines exact; the raw address appears 0 times | |
| E1, E2 | pass | exact `unauthorized` body, `401`, without a token and with a bad tag | |
| E3 | pass | A3's document, `enabled`, queue and DLQ 0, exit 0 | |
| E4 | pass | `worker      enabled (already enabled)`, exit 0 | |
| E5 | pass | the 7 lines exact: `5s`, `10s`, `honored`, waited 2147 ms (held 2000): `serialized`, `the pool answered after 6 minutes idle`; 372 s; exit 0 | F1 |
| F1–F4 | pass | `review-walk` id 6 created; `token current` exact; reads C5's document; `forbidden` JSON, exit 1, and resume stderr exactly two lines with empty stdout, exit 1 | |
| F5 | pass | ids 6 and 4 revoked, layout exact, exit 0; the revoked token → the exact `unauthorized` JSON, exit 1 | |
| W1 | pass | 6 and 4 carry `revoked_at`; only `bootstrap` is active | |
| W2 | pass | compose stopped, the dev server this run started stopped, `port 3200 is free.`, exit 0 | |

## Findings

### F1 — the deploy's stderr carries a `pg` SSL-mode deprecation warning

- **Severity:** polish · **Category:** environment · **Status:** confirmed (B4, T3, E5) · **Step:** B4
- **Expected:** "the deploy prints exactly these lines" (B4) · **Observed:** stderr `(node:<pid>) Warning: SECURITY WARNING: The SSL modes 'prefer', 'require', and 'verify-ca' are treated as aliases for 'verify-full'. …`, 9 lines, no value
- **Suspected cause:** the owner's Neon URLs carry `sslmode=require` ([K3](../../../.agents/skills/rsa-manual-test/references/environment.md#known-issues)) · **Proposed fix:** `sslmode=verify-full` in the owner's URLs, said in `.env.example`

### F2 — teardown fails on a resource already deleted but still in the tagging index

- **Severity:** major · **Category:** ops · **Status:** fixed in `6cfc018`, verified by the rerun's T1 · **Step:** T1
- **Expected:** no `leftover` line, exit 0 (T1; Ships 9's listing "finds nothing billable")
- **Observed:** `leftover lambda event-source-mapping:<uuid>`, exit 1, twice 6 min apart. Read-only: `get-event-source-mapping` → `ResourceNotFoundException`; `list-event-source-mappings` → 0; CloudFormation lists only `CDKToolkit`; `resourcegroupstaggingapi get-resources` still returns the mapping
- **Suspected cause:** `packages/aws/src/post-destroy-listing.ts:58-66` confirms a tagged ARN only for secrets (`DescribeSecret`); every other ARN the index still lists is a leftover. A mapping is also not billable
- **Proposed fix:** confirm each tagged ARN against its service, or skip non-billable types, with a unit test for a gone mapping; the hint then never names a resource that cannot be deleted

### F3 — `aws:deploy --budget-drill` cannot synthesize: the drill threshold is below CloudFormation's minimum

- **Severity:** blocker (Ships 7's AWS-U01 evidence) · **Category:** ops · **Status:** fixed in `09000cd` (threshold 0.1), verified by the rerun's G4 deploy · **Step:** G4
- **Expected:** B5's lines, exit 0, then the drill budget's notification trips the stack (G4)
- **Observed:** `failed: cdk synth failed`, exit 1; `Threshold: 0.01 is less than the minimum of 0.1 (CloudFormation Validate)`
- **Suspected cause:** `infra/src/guardrails.stack.ts:35` `DRILL_THRESHOLD_USD = 0.01`; `guardrails.stack.test.ts:382` asserts the template equals the constant, so no gate synthesizes with the drill flag against CloudFormation's validation
- **Proposed fix:** a threshold ≥ 0.1 and a test that bounds it, then rerun G4–G6

Also seen, polish: `infra/scripts/cdk-cli.ts:38` drops the `ledger:alertEmail=` argument from the logged command line but keeps its `-c`, so cdk.log reads `-c -c ledger:budgetUsd=50`. Fixed in `3e8d757`.

### F4 — the drill budget cannot trip an account that spends nothing

- **Severity:** blocker (Ships 7's AWS-U01 evidence) · **Category:** ops · **Status:** confirmed · **Step:** G4
- **Expected:** after G4's deploy, an AWS Budgets notification naming `LedgerGuardrails-drill`, then `Ledger kill switch tripped` (G4), settling AWS-U01's second half
- **Observed:** `describe-budgets` reads actual spend `0.0` USD on `LedgerGuardrails-monthly` and on the new `LedgerGuardrails-drill`, before and after the deploy; the drill notifies only above `0.1` USD actual, CloudFormation's minimum threshold (F3), and the stack idles near zero by design
- **Suspected cause:** D28's drill relies on month-to-date actual spend crossing an absolute threshold; with F3's floor of 0.1, an idle account never crosses it. `infra/src/guardrails.stack.ts` `DRILL_THRESHOLD_USD`
- **Proposed fix:** an owner decision on how AWS-U01's second half is settled: a drill that does not depend on the account's own spend, or record AWS-U01 as settled by a different observation, then rerun G4–G5

## Settled by this run (for 13.8)

AWS-U05 quota 50 · AWS-U06 secrets delete at once (rerun's T1, T2 again) · AWS-U04 plain body (`body_base64_count` 0) · AWS-U02 status half `429` ×5 · AWS-U11 stop throttle accepted (G1 step 2) · PG-U06 honored through the pooled URL · PG-U02 serialized (2147 ms) · PG-U04 the pool answered after 6 min idle · AWS-U01 first half (guardrails deployed in us-east-2, again in the rerun, the drill budget included); second half open on F4.

## Held for the owner

- Observe the `Ledger kill switch tripped` email from G1 and confirm both SNS subscriptions the rerun's T3 recreated (CBL-03).
- F4's decision, then G4's trip half and G5.

## Data created

- Local: token `walk-read` id 8, revoked (A7).
- AWS: both stacks, kept; the first pair destroyed in T1, the second in the rerun's T1, and the third (the rerun's T3) kept. The drill budget: created in the rerun's G4, removed in G6. Resend: the production webhook repointed to the rerun's ingest URL, kept. Neon: `bootstrap` id 1, kept (the owner stores it); `walk-operate` id 4 and `review-walk` id 6, revoked (F5). Resend: the production webhook, kept; one send to `delivered@resend.dev` and its two ledger rows, kept.
