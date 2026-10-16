# Check before launch

Things that are probably wrong, or probably missing, and belong to **no slice**. This file holds
them so a deploy or a published demo does not discover them first. Read it before every deploy and
before sharing the repo or the demo. [wf-after-apply-check](../.agents/skills/wf-after-apply-check/SKILL.md)
lands homeless findings here.

## What belongs here

An item MUST satisfy all three:

1. **No slice owns it.** If a `Ships` bullet in [build-checklist.md](build-checklist.md) covers it,
   it is that slice's. Recurring checks are the main case: a slice proves a thing once, and this
   file re-checks what a later deploy or demo can silently undo.
2. **It bites at deploy time or later**, not during local development.
3. **It is cheap to check and expensive to discover.** Minutes to verify, against a surprise bill, a
   leaked secret, or a silent loss of events.

**Exception:** [Awaiting an owner decision](#awaiting-an-owner-decision) holds decisions no slice
owns. Tests 2 and 3 do not bind them.

An item MAY be a **suspicion**: tag it `[Unverified]`. A wrong entry costs minutes to disprove.

**Not here:** open questions that need Resend or AWS to answer go to
[about.md → Open questions](about.md#open-questions) or the `[Unverified]` tables of
[resend.md](resend.md#unverified), [aws.md](aws.md#unverified) and
[integrations.md](integrations.md#unverified). Deliberately unbuilt capabilities go to
[architecture.md → Deferred](architecture.md#deferred-yagni). Work a slice carries stays on its card.

**Exit rule.** An item leaves when it is confirmed, disproved, or adopted by a slice. It is
**deleted, never struck through**, and its ID is never reused. A confirmed defect that needs
building becomes a `Ships` bullet, and the row goes. Every row cites the fact it rests on (`AWS-NN`,
`RS-NN`, an ADR) or is tagged `[Unverified]`. Every *Settle by* is a command, a query or an
observation.

**Owned elsewhere, so not repeated here.** These are things a preview of this file listed:
- **Slice 0:** the secret scan over the full history, and the README link check.
- **Slice 2:** the budget, the kill switch and the trip drill; the CDK assertions (`MaximumConcurrency`, no VPC or NAT); both body encodings at ingest; the teardown listing.
- **Slice 3:** `maxReceiveCount` and the poison run; ingest p99 under the delivery timeout (RS-U08).
- **Slice 4:** a replay keeps its `svix-id` (RS-U01); rotation overlap (RS-U09); the README claims at the M1 boundary.
- **Slice 7:** the README claims at the M2 boundary.

## Deploy configuration

| ID | Check | Why it bites | Settle by |
| --- | --- | --- | --- |
| CBL-01 | No secret **value** reaches a Lambda environment variable or the synthesized template. Each function receives only the ARNs of the secrets it reads | [integrations.md → Secrets layout](integrations.md#secrets-layout) requires ARNs only, with IAM read on those alone. A value inlined at synth time (a `SecretValue` unwrapped, or a deploy parameter passed through as an env var) is readable by anyone with Lambda read access, and it sits in `cdk.out` `[Unverified]` | After `cdk synth`: `grep -rlE 'whsec_\|re_[A-Za-z0-9]{8}\|postgres(ql)?://' cdk.out/` prints nothing. After the deploy: `aws lambda get-function-configuration --function-name <fn> --query Environment` shows ARNs and plain settings only, for every app function |
| CBL-03 | Every SNS **email** subscription is confirmed after any deploy that creates it: the first deploy, and every deploy after a teardown | A teardown deletes the subscription with its topic ([aws.md → Teardown](aws.md#teardown)). Until the new one is confirmed, alarms and kill-switch reports reach no one. The Ops lines of slices 2 (guardrails stack) and 3 (alarm topic) cover the first confirmations only. That an unconfirmed subscription receives nothing comes from no `AWS-NN` fact `[Unverified]` | `aws sns list-subscriptions-by-topic --topic-arn <topic>` for the alarm topic and the trip topic: no `SubscriptionArn` reads `PendingConfirmation` |
| CBL-16 | Every deploy of the **owner's** stack passes the kill-switch flag | The kill switch is off by default and turned on by a deploy-time flag ([aws.md → Budget alarms](aws.md#budget-alarms), item 5). A redeploy that omits the flag disarms the hard cap silently: the budget still alerts, but nothing stops compute (AWS-36). Slice 2 proves the flag once, with the trip drill | After each owner deploy, read the kill switch's armed state wherever slice 2 exposes it (a stack output, or the kill-switch function subscribed to the trip topic). It MUST read armed |

## Cost & teardown

The budget, its notifications and the kill switch are designed in
[aws.md → Budget alarms](aws.md#budget-alarms): a USD 50 cap, ACTUAL 50 %, ACTUAL 80 % and FORECASTED 100 % to
email, and ACTUAL 100 % to the trip topic. They live in the guardrails stack
([ADR-010](architecture.md#adr-010--serverless-on-aws-cdk-an-app-stack-and-a-guardrails-stack)), and
[slice 2](build-checklist.md#2--durable-ingest-on-aws) builds them and drills them. What
`cdk destroy --all` leaves behind is canonical in [aws.md → Teardown](aws.md#teardown). The rows
below are the recurring checks that keep that design true while the stack stays up
([lens clause 7](../AGENTS.md#decision-lens--evidence-over-claims-right-sized)).

| ID | Check | Why it bites | Settle by |
| --- | --- | --- | --- |
| CBL-17 | Before any demo or review window, the kept stack is armed and healthy. The kill switch is not tripped, the event source is enabled, and the queue and DLQ are at 0 | A trip sets reserved concurrency `0` on every app function, the read API included (aws.md → Budget alarms, item 4; AWS-16). A paused source holds events in SQS ([ADR-015](architecture.md#adr-015--the-worker-pauses-its-own-event-source-on-a-database-outage)). Either way, a reviewer's first command fails | `ledger health --json`. If it answers `api_unavailable`, the kill switch is likely tripped: run the re-arm script, then `ledger reconcile`. If the event source reads paused, run `ledger worker resume` |
| CBL-18 | 30 idle days after the first kept deploy, the measured idle cost is ≤ USD 5/month. No usage type appears that [aws.md → Cost shape](aws.md#cost-shape) does not list | This is the [success metric](about.md#success-metrics), and no slice measures it. Slice 2 closes AWS-U03 and AWS-U07 "safe either way" without a bill. An unlisted line (a retained log group, AWS-38; a public IPv4, AWS-13) bills for as long as the stack stays up | Cost Explorer, grouped by service and usage type, with credits excluded, over the 30 idle days. Write the numbers into the *Measured by* column of aws.md → Cost shape |

## Public-repo hygiene

Before the repo or the demo is shared, and before each recording is published.

| ID | Check | Why it bites | Settle by |
| --- | --- | --- | --- |
| CBL-07 | Every address in fixtures, docs, recordings and simulator output is a Resend test address (`@resend.dev`, RS-32). The deploy-time alert address appears nowhere tracked | A real recipient address in a public repo is a Never ([AGENTS.md → Permissions](../AGENTS.md#permissions)). The alert address is supplied at deploy time and never committed (aws.md → Budget alarms, item 3) | `git grep -nE '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}' \| grep -v '@resend\.dev'`, and account for every hit. Watch each recording before it is published |
| CBL-10 | No AWS account id, ARN, API Gateway URL, Resend webhook id or bearer token appears in tracked files or recordings | This is a public-repo rule ([.ai/AGENTS.md → Rules](AGENTS.md#rules)). A published ingest or read URL invites junk traffic onto the kept stack, which the route throttle bounds but which still bills (AWS-14, AWS-15). CDK caches context lookups, account id included, in `cdk.context.json` `[Unverified]` | `git grep -nE '\b[0-9]{12}\b\|arn:aws\|execute-api\|whsec_\|re_[A-Za-z0-9]{8}\|ldg_[A-Za-z0-9_]{20,}'`, and account for every hit. Watch each recording, `ledger token create` output included, before it is published |
| CBL-19 | `cdk.out/`, `.env*` and every local deploy-parameter file are git-ignored. The one exception is `.env.example`, committed with variable names only, never values | The synthesized template and the env files hold the values CBL-01 and CBL-07 keep out of history. The slice 0 gitleaks stage finds a leak only after it is committed | `git check-ignore -v cdk.out .env.local` matches both. `git ls-files \| grep -E '(^\|/)(cdk\.out\|\.env)' \| grep -vE '(^\|/)\.env\.example$'` prints nothing. `git grep -nE '^[A-Za-z_][A-Za-z0-9_]*=.' -- '*.env.example'` prints nothing (no value after any `=`) |
| CBL-20 | Every reviewer token is `read`-scoped, named for its review, and revoked when the review ends | Reviewer access is recordings plus a token on request ([about.md → Target personas](about.md#target-personas)). A forgotten token keeps the kept stack readable. Its output is masked and holds test addresses only ([ADR-014](architecture.md#adr-014--raw-payload-retention-and-redaction), [ADR-016](architecture.md#adr-016--the-simulator-reaches-aws-only-through-an-opt-in-simulator-secret)), but an `operate` token could start replays and redrives ([ADR-011](architecture.md#adr-011--one-contract-many-surfaces)) | Issue with `ledger token create --name review-<date> --scope read`. Afterwards, `ledger token list --json` shows no active token named `review-*` past its review, and `ledger token revoke <id>` removes any that remain |

## Behaviour only production reveals

All `[Unverified]` until observed against a real Resend account and the kept deploy.

| ID | Check | Why it bites | Settle by |
| --- | --- | --- | --- |
| CBL-21 | A single delivery after a long idle period (a cold ingest Lambda, plus a cold secret fetch) answers well inside Resend's delivery timeout `[Unverified]` | The timeout is RS-U08 (`[Svix]`: 15 s, RS-10). Slice 3 measures p99 over a 10k burst, which a warm fleet dominates. A lone first delivery pays the full init cost. A timeout is a failed attempt: Resend retries it (RS-09), dedupe makes that harmless ([ADR-004](architecture.md#adr-004--immutable-ledger-keyed-on-svix_id-one-transaction-per-message)), but repeated failures lead toward auto-disable (RS-11) | After ≥ 24 h with no traffic, make one Ask-first send to `delivered@resend.dev`. Then, in CloudWatch Logs Insights on the ingest log group, read the `REPORT` line's `Init Duration` + `Duration`, and confirm the Resend dashboard shows one attempt for the event |

## Awaiting an owner decision

None open. The reviewer-access decision (owner, 2026-10-15) is recorded in
[about.md → Target personas](about.md#target-personas), and CBL-20 checks it.
