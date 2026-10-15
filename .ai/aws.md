# AWS

> **TEMPLATE — not ratified.** Bootstrap step 5 in [bootstrap-checklist.md](bootstrap-checklist.md). The preview content below is illustrative, drafted from [docs/idea.md](../docs/idea.md) without research. Nothing here is binding until this banner and the instructions comment are removed.

<!-- AGENT INSTRUCTIONS
Purpose: The canonical record of every AWS limit and semantic Ledger relies on, as stable `AWS-NN`
  facts with cited pages; plus the cost shape, the mandatory budget-alarm design and what teardown
  leaves behind. CDK code, ADRs and the runbook cite `AWS-NN` instead of restating AWS behavior.
Consumers: `infra/` (CDK), `apps/*` Lambda handlers, architecture.md ADRs, integrations.md
  (Postgres host), check-before-launch.md, docs/runbook.md.
Inputs (read first): root AGENTS.md (cost brake, Permissions: deploying is Ask-first);
  bootstrap-checklist.md → Owner calibration (AWS posture: deploy and KEEP until the owner tears
  down, so near-zero idle cost and budget alarms with a hard monthly cap are MANDATORY);
  about.md; docs/idea.md §5.1–§5.3, §5.5, §5.8, §6.4, §9.
Research (AWS docs only; cite the page and date for each fact):
  - API Gateway HTTP API: Lambda proxy payload format 2.0, `isBase64Encoded`, when the body is
    base64-encoded, integration timeout, payload size limit, throttling defaults.
  - Lambda: max timeout; reserved concurrency; SQS event source mapping (ESM) `MaximumConcurrency`
    (its floor and ceiling, and how it interacts with reserved concurrency); batch size and window;
    `ReportBatchItemFailures` response shape; account concurrency quota for new accounts.
  - SQS standard: at-least-once and no ordering; max/default retention; visibility timeout guidance
    relative to function timeout (the "≥ 6×" rule and its exact wording); redrive policy and
    `maxReceiveCount`; DLQ retention vs source retention (enqueue timestamp semantics); redrive
    API (`StartMessageMoveTask`); `ApproximateAgeOfOldestMessage`.
  - EventBridge Scheduler: rate/cron, flexible windows, retry policy, DLQ, free-tier quota.
  - Secrets Manager: price per secret, deletion recovery window; compare SSM Parameter Store
    SecureString (standard tier) as a deviation candidate.
  - CloudWatch: custom metric pricing (EMF; each dimension combination is a metric), alarm
    pricing, log ingestion and storage pricing, default log retention (never expire).
  - Lambda in a VPC: what reaching the internet requires (NAT gateway pricing per hour + per GB),
    VPC interface endpoint pricing, and whether Lambda needs a VPC at all for the chosen DB host.
  - AWS Budgets: pricing, alert thresholds (actual and forecasted), SNS/email targets, Budget
    Actions (what they can and cannot stop). AWS has no native hard cap: research what enforces
    one for Lambda/API Gateway/SQS (e.g. an action or a Lambda that sets reserved concurrency to 0,
    disables the ESM, throttles the stage).
  - CDK: default removal policies for log groups, secrets, queues; what `cdk destroy` does NOT
    remove (CDKToolkit bootstrap stack and its asset bucket, Lambda-created log groups).
  - Pricing pages for every service above, for the chosen region.
Required structure (headings MUST exist, in this order): fact lines (**Code:** / **Env:**) ·
  `## Verdict` · `## Facts` (one `###` per service; table Id | Fact | Consequence for Ledger |
  Source | Checked on) · `## Cost shape` · `## Budget alarms` · `## Teardown` ·
  `## Constraints and sharp edges` · `## [Unverified]` · `## Sources` · `## Learning notes`.
Evidence rules:
  - Every fact cites an AWS page + the date checked. Prices cite the pricing page and region.
  - `AWS-NN` ids are stable: never renumber, never reuse; retired rows stay, struck through.
  - Every idle-cost claim in Cost shape MUST be measurable later (Cost Explorer, a named metric).
  - Unsettled → [Unverified] row + about.md#open-questions.
  - No account ids, ARNs, endpoint URLs or notification email addresses in this public file.
Owner decisions to surface (one batched round, each with a recommended pick):
  - Monthly hard cap amount (recommend a low single-digit USD figure plus forecast alerts).
  - Region (recommend one with every service above and low latency to the owner).
  - Whether the budget and kill switch live in a separate guardrails stack that survives
    `cdk destroy` of the app stack (recommend yes).
  - Secrets Manager vs SSM Parameter Store for secrets (cost vs rotation features).
Done when: every [Preview] row is a cited fact or an [Unverified] row; Cost shape lists every
  resource that costs money while idle; the budget-alarm design names its enforcement mechanism;
  Teardown lists every leftover with how to remove it; banner and comment removed.
-->

AWS is Ledger's runtime: API Gateway HTTP API, Lambda, SQS, EventBridge Scheduler, Secrets
Manager, CloudWatch, deployed with AWS CDK to the **owner's personal account**. The stack stays
up until the owner tears it down. Research current as of **`<date>`**, region **`<region>`**.

**Code:** `infra/` (CDK app) · **Env:** `AWS_REGION`, `AWS_PROFILE` (local only; never committed)

## Verdict

`[Preview]` The serverless shape fits: every component scales to zero except what Cost shape
lists. The binding risks are a **NAT gateway** sneaking in through a VPC-bound database, and the
absence of a native **hard spending cap**, which Ledger MUST build itself.

## Facts

### API Gateway HTTP API

| Id | Fact | Consequence for Ledger | Source | Checked on |
| --- | --- | --- | --- | --- |
| AWS-01 | `[Preview]` Payload format 2.0 may deliver the body base64-encoded (`isBase64Encoded: true`). | Ingest decodes to the exact bytes before Svix verification ([resend.md](resend.md) RS-01). | — | — |
| AWS-02 | `[Preview]` Integration timeout is capped (≈ 30s). | Ingest stays far below; it never touches the DB. | — | — |

### Lambda

| Id | Fact | Consequence for Ledger | Source | Checked on |
| --- | --- | --- | --- | --- |
| AWS-03 | `[Preview]` Max function timeout is 15 min. | Reconciler runs fit; long runs resume by cursor. | — | — |
| AWS-04 | `[Preview]` ESM `MaximumConcurrency` has a floor of 2; reserved concurrency is a separate cap. | The backpressure valve (idea §5.3) is ESM max concurrency, not reserved concurrency. | — | — |
| AWS-05 | `[Preview]` `ReportBatchItemFailures` retries only the listed message ids. | One poison message doesn't redeliver the batch. | — | — |

### SQS

| Id | Fact | Consequence for Ledger | Source | Checked on |
| --- | --- | --- | --- | --- |
| AWS-06 | `[Preview]` Standard queues are at-least-once and unordered. | Dedup by `svix_id`; order-independent projection. | — | — |
| AWS-07 | `[Preview]` Retention max 14 days (default 4). | Set to 14 days: the DB-outage buffer. | — | — |
| AWS-08 | `[Preview]` Visibility timeout SHOULD be ≥ 6× the function timeout. | CDK derives it from the worker timeout. | — | — |
| AWS-09 | `[Preview]` A message's expiry keeps its original enqueue timestamp when moved to a DLQ. | DLQ retention MUST exceed source retention. | — | — |

### EventBridge Scheduler, Secrets Manager, CloudWatch, VPC

| Id | Fact | Consequence for Ledger | Source | Checked on |
| --- | --- | --- | --- | --- |
| AWS-10 | `[Preview]` Scheduler invokes Lambda on rate/cron with retries and a DLQ. | Reconciler and dispatcher triggers. | — | — |
| AWS-11 | `[Preview]` Secrets Manager bills per secret per month; deletion has a recovery window. | Few secrets; teardown note. | — | — |
| AWS-12 | `[Preview]` Each custom metric (per dimension set) and each alarm bills monthly. | Keep the metric set to idea §5.8; no high-cardinality dimensions. | — | — |
| AWS-13 | `[Preview]` Lambda in a VPC reaches the internet only via a NAT gateway (hourly + per GB). | No VPC unless the DB host forces it and the cost is stated ([integrations.md](integrations.md#postgres-host)). | — | — |

## Cost shape

`[Preview]` Every line MUST be confirmed against the pricing page for the chosen region.

| Resource | Idle cost / month | Per-event cost | Notes |
| --- | --- | --- | --- |
| API Gateway HTTP API | 0 | per million requests | |
| Lambda (all functions) | 0 | per request + GB-s | Free tier may absorb the demo |
| SQS queue + DLQ | 0 | per million requests | Empty-receive polling by the ESM: verify cost |
| EventBridge Scheduler | ≈ 0 | per invocation | 15-min cadence ≈ 3k/month |
| **Secrets Manager** | **per secret** | per 10k API calls | Costs while idle |
| **CloudWatch custom metrics** | **per metric** | — | Costs while idle |
| **CloudWatch alarms** | **per alarm** | — | Costs while idle |
| **CloudWatch Logs storage** | **per GB stored** | per GB ingested | Set retention; default is never expire |
| **Postgres host** | see [integrations.md](integrations.md#postgres-host) | | The largest idle-cost risk |
| NAT gateway | **forbidden** without a measured reason | | Cost brake |

## Budget alarms

**MANDATORY** under deploy-and-keep. `[Preview]` design to verify:

- An AWS Budget with a monthly cap of **`<owner decision>`** USD.
- Alerts at 50 % and 80 % actual, and 100 % forecasted, to an SNS topic → the owner's email
  (address supplied at deploy time, never committed).
- **Enforcement at 100 % actual:** AWS Budgets alone does not stop spend. A kill switch MUST be
  named: e.g. a Budget Action or an SNS-triggered Lambda that disables the SQS event source
  mappings, sets function reserved concurrency to 0 and throttles the API stage. Document how to
  re-arm it.
- The budget and kill switch SHOULD live in a guardrails stack that survives app-stack teardown.

## Teardown

`[Preview]` One command (`cdk destroy`) removes the app stack. Record what it leaves behind and how
to remove each:

- Lambda log groups created implicitly at runtime (not stack-owned) → define them in CDK with
  retention and `DESTROY`.
- Secrets scheduled for deletion (recovery window) → force-delete or accept the window.
- The CDKToolkit bootstrap stack and its asset bucket.
- Any DB snapshot or external DB project (see [integrations.md](integrations.md#postgres-host)).
- The guardrails stack (deliberately kept).

## Constraints and sharp edges

1. `[Preview]` **No native hard cap.** Resolution: the kill switch above.
2. `[Preview]` **A VPC-bound DB drags in a NAT gateway** for the reconciler's calls to Resend.
   Resolution: decided in [integrations.md](integrations.md#postgres-host).
3. `[Preview]` **Log groups never expire by default.** Resolution: explicit retention in CDK.

## [Unverified]

| Claim | Why unsettled | What would settle it |
| --- | --- | --- |
| `[Preview]` ESM empty receives cost nothing noticeable while idle | Not read yet | SQS pricing page + one idle week in Cost Explorer |
| `[Preview]` A Budget Action can stop Lambda/SQS spend | Actions target IAM/SCP/EC2/RDS | AWS Budgets docs |

## Sources

| Source | Supports | Checked on |
| --- | --- | --- |
| `[Preview]` Lambda developer guide → Using Lambda with SQS | AWS-04, AWS-05, AWS-08 | — |
| `[Preview]` SQS developer guide → Dead-letter queues | AWS-09 | — |

## Learning notes

M3 calls for a learning log of the AWS and distributed-systems decisions. Entries go in
**`<location — decided in architecture.md>`**, one per decision, each linking the `AWS-NN` fact or
ADR it taught. This section only points there.
