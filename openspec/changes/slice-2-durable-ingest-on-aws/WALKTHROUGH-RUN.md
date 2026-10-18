# Slice 2 — walkthrough run

- **Run:** 2026-10-18 19:39 · walkthrough mode · change `slice-2-durable-ingest-on-aws`
- **HEAD:** `bd4cf16` (clean) · **Environment:** local (apps/local), then deployed (us-east-2, Neon)
- **Started by this run:** `pnpm dev:full` (stopped in W2); both stacks (kept) · **Adopted:** none
- **Time box:** 45 min, overridden by the owner's approval of the whole walk · **Wall clock used:** 52 min, owner wait included
- **Order:** the owner approved every Ask-first step in this conversation and asked to front-load the owner-run steps: A → B1, B2, B4 → T → B5 → G1–G3 → E1–E4 → F1, F2, F4 → C → D → F3, F5, W1 → E5 → B3 → G4 → W2. Each step ran on the stack shape its `Expect:` assumes.

**Verdict:** walked with findings — the verify stage passed end to end; teardown exits 1 on a stale tagging entry (F2) and the budget drill cannot synthesize (F3), so G5 and G6 never ran.

| pass | doc-drift | fail | inconclusive | blocked | held | n/a-today | skipped | not-run |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 42 | 0 | 2 | 0 | 2 | 0 | 0 | 1 | 0 |

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
| G4 | fail | `aws:deploy: synthesizing both stacks`, then `failed: cdk synth failed`, exit 1; cdk.log: `NotificationsWithSubscribers.0.Notification.Threshold: 0.01 is less than the minimum of 0.1` on `LedgerGuardrails/DrillBudget`. Nothing deployed (health unchanged, both stacks `CREATE_COMPLETE`) | F3 |
| G5, G6 | blocked | depend on G4's budget trip | F3 |
| T1 | fail | destroy order right, `0 secret(s)`, both outside-AWS lines, then `leftover lambda event-source-mapping:<uuid>` and `failed: billable resources remain …`, exit 1; rerun 6 min later: the same | F2 |
| T2 | pass | empty listing, exit 0: secrets delete at once (AWS-U06) | |
| T3 | pass | redeploy: B4's lines without the token line, exit 0; flag deploy: B5's lines plus the `walk-operate` token line, exit 0; new API URL; `token current` → `bootstrap` | |
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

- **Severity:** major · **Category:** ops · **Status:** confirmed · **Step:** T1
- **Expected:** no `leftover` line, exit 0 (T1; Ships 9's listing "finds nothing billable")
- **Observed:** `leftover lambda event-source-mapping:<uuid>`, exit 1, twice 6 min apart. Read-only: `get-event-source-mapping` → `ResourceNotFoundException`; `list-event-source-mappings` → 0; CloudFormation lists only `CDKToolkit`; `resourcegroupstaggingapi get-resources` still returns the mapping
- **Suspected cause:** `packages/aws/src/post-destroy-listing.ts:58-66` confirms a tagged ARN only for secrets (`DescribeSecret`); every other ARN the index still lists is a leftover. A mapping is also not billable
- **Proposed fix:** confirm each tagged ARN against its service, or skip non-billable types, with a unit test for a gone mapping; the hint then never names a resource that cannot be deleted

### F3 — `aws:deploy --budget-drill` cannot synthesize: the drill threshold is below CloudFormation's minimum

- **Severity:** blocker (Ships 7's AWS-U01 evidence) · **Category:** ops · **Status:** confirmed · **Step:** G4
- **Expected:** B5's lines, exit 0, then the drill budget's notification trips the stack (G4)
- **Observed:** `failed: cdk synth failed`, exit 1; `Threshold: 0.01 is less than the minimum of 0.1 (CloudFormation Validate)`
- **Suspected cause:** `infra/src/guardrails.stack.ts:35` `DRILL_THRESHOLD_USD = 0.01`; `guardrails.stack.test.ts:382` asserts the template equals the constant, so no gate synthesizes with the drill flag against CloudFormation's validation
- **Proposed fix:** a threshold ≥ 0.1 and a test that bounds it, then rerun G4–G6

Also seen, polish: `infra/scripts/cdk-cli.ts:38` drops the `ledger:alertEmail=` argument from the logged command line but keeps its `-c`, so cdk.log reads `-c -c ledger:budgetUsd=50`.

## Settled by this run (for 13.8)

AWS-U05 quota 50 · AWS-U06 secrets delete at once · AWS-U04 plain body (`body_base64_count` 0) · AWS-U02 status half `429` ×5 · AWS-U11 stop throttle accepted (G1 step 2) · PG-U06 honored through the pooled URL · PG-U02 serialized (2147 ms) · PG-U04 the pool answered after 6 min idle · AWS-U01 first half (guardrails deployed in us-east-2); second half blocked by F3.

## Held for the owner

- Observe the `Ledger kill switch tripped` email from G1 and confirm both SNS subscriptions from T3 (CBL-03).
- After F3's fix: G4, then G5 once both emails arrive, then G6.

## Data created

- Local: token `walk-read` id 8, revoked (A7).
- AWS: both stacks, kept; the first pair destroyed in T1. Neon: `bootstrap` id 1, kept (the owner stores it); `walk-operate` id 4 and `review-walk` id 6, revoked (F5). Resend: the production webhook, kept; one send to `delivered@resend.dev` and its two ledger rows, kept.
