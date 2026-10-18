# AWS

AWS is Ledger's runtime: API Gateway HTTP API, Lambda, SQS, EventBridge Scheduler, Secrets
Manager, CloudWatch, SNS and AWS Budgets, deployed with AWS CDK to the **owner's personal
account**. The stack stays up until the owner tears it down
([lens clause 7](../AGENTS.md#decision-lens--evidence-over-claims-right-sized)). This file is
the canonical record of every AWS limit and semantic Ledger relies on. CDK code, ADRs and the
runbook cite `AWS-NN` instead of restating AWS behavior. Research current as of **2026-10-15**, region
**us-east-2 (US East, Ohio)**. The numbers come from AWS docs and, because the pricing pages render
prices client-side, from the public AWS Price List offer files for us-east-2 (published 2026-09-11 to
2026-10-14).

**Code:** `infra/` (CDK app: the app stack plus a separate guardrails stack) · **Env:** `AWS_REGION`,
`AWS_PROFILE` (local only; never committed)

**Rules for this file (MUST).** `AWS-NN` and `AWS-UNN` ids are stable: never renumber, never reuse.
A retired fact keeps its row, struck through, with the reason. Every `[Unverified]` row names the
slice that owes it, and that slice MUST settle it, or prove the design safe under either answer, before it is
done ([about.md → Open questions](about.md#open-questions)). This file is public, so it holds no account
ids, ARNs, endpoint URLs or notification addresses. Deploying is Ask-first
([Permissions](../AGENTS.md#permissions)).

## Verdict

The serverless shape fits. At idle, nothing in the app stack bills by the hour. What costs money while
idle is a handful of per-month line items (secrets, metrics, alarms, log storage), all listed in
[Cost shape](#cost-shape). The Postgres host, Neon Free, sits outside AWS and bills nothing
([integrations.md](integrations.md#decision--neon)). The idle estimate is under USD 2.50/month, against the
≤ USD 5 target ([about.md → Success metrics](about.md#success-metrics)). Four facts shape the
design:

- **No native hard cap.** Budget Actions cannot stop Lambda, SQS or API Gateway (AWS-36), and budget
  data refreshes only "at least once per day" (AWS-34). Ledger builds its own kill switch, and
  accepts an overshoot window of billing lag plus up to 12 h ([Budget alarms](#budget-alarms)).
- **A VPC means a NAT gateway.** A VPC-attached Lambda has no internet access without one (AWS-13), at
  ≈ USD 32.85/month idle in Ohio, two-thirds of the cap. Rejected
  ([decision-lens-suite case 9](decision-lens-suite.md)).
- **The worker's backpressure valve has an idle cost.** `MaximumConcurrency` turns off Lambda's
  low-traffic polling optimization (AWS-04), so the idle queue is polled harder. The estimate
  fits in the SQS free tier; AWS-U03 measures it.
- **A database outage drains into the DLQ.** Each failed receive counts toward `maxReceiveCount`
  (AWS-09), so a long outage would move messages to the DLQ rather than hold them in the source
  queue. The worker pauses its own ESM instead ([Constraint 4](#constraints-and-sharp-edges)).

## Facts

### API Gateway HTTP API

| Id | Fact | Consequence for Ledger | Source | Checked on |
| --- | --- | --- | --- | --- |
| AWS-01 | Payload format 2.0 carries a top-level `isBase64Encoded` next to `body`. No HTTP API page says when the body is encoded. The function URL page, which uses the same 2.0 schema, says: "If the content type of the request is binary, the body is base64-encoded." It does not list which types count as binary. | Ingest decodes to the exact bytes whenever `isBase64Encoded` is `true`, then verifies the signature ([RS-01](resend.md#facts)). A unit test covers both encodings (AWS-U04). | apigw/http-api-lambda; lambda/urls-invocation | 2026-10-15 |
| AWS-02 | "Maximum integration timeout \| 30 seconds \| No" (not raisable). "Payload size \| 10 MB \| No". The binding limit for a Lambda proxy is Lambda's 6 MB synchronous payload. | Ingest only verifies and enqueues, so it stays far below 30 s. Resend payloads are small. | apigw/http-api-quotas; lambda/limits | 2026-10-15 |
| AWS-14 | The account throttle per region is shared by HTTP, REST and WebSocket APIs: "10,000 requests per second (RPS) … maximum bucket capacity of 5,000 requests". Stage and route throttling (`throttlingRateLimit`, `throttlingBurstLimit`) "can't exceed account-level rate limits". Throttles are "best-effort … targets rather than guaranteed request ceilings". No page says what a limit of `0` does. | The default-route throttle bounds the worst-case request rate, and therefore the worst-case spend rate inside the budget's refresh delay ([Budget alarms](#budget-alarms)). Whether `0` blocks traffic is AWS-U02. | apigw/limits; apigw/http-api-throttling | 2026-10-15 |
| AWS-15 | HTTP API in us-east-2: "$1/million requests … (first 300 million)", then $0.90. Requests are metered in 512 KB increments; this is shown only in a worked example. The free tier is "one million API calls … per month for up to 12 months", which is not always-free. | Idle cost is zero. A 10k-event simulator burst costs ≈ USD 0.01. | PL:AmazonApiGateway; apigw/pricing | 2026-10-15 |

### Lambda

| Id | Fact | Consequence for Ledger | Source | Checked on |
| --- | --- | --- | --- | --- |
| AWS-03 | "Function timeout \| 900 seconds (15 minutes)". | Reconciler runs fit. A run that reaches its time budget stops; the next run re-diffs from newest ([integrations.md → Locked rules](integrations.md#locked-rules-must), rule 3). | lambda/limits | 2026-10-15 |
| AWS-16 | "To intentionally throttle an Event Function, set its reserved concurrency to 0. This stops your Event Function from processing any events until you remove the limit." `PutFunctionConcurrency` accepts a minimum of 0. Reserved concurrency "incurs no additional charges". "You can reserve up to the Unreserved account concurrency value minus 100." The default quota is 1,000, but "New AWS accounts have reduced concurrency … quotas", and the reduced figure is not published. | Reserved concurrency `0` is the kill switch's primitive. Ledger reserves concurrency for nothing else, so a low new-account quota cannot block a deploy. Backpressure comes from AWS-04 instead (AWS-U05). | lambda/concurrency; lambda/API_PutFunctionConcurrency; lambda/limits | 2026-10-15 |
| AWS-04 | SQS event source mapping (ESM) `MaximumConcurrency`: "Minimum value of 2. Maximum value of 1000." "Don't set maximum concurrency higher than the function's reserved concurrency … Otherwise, Lambda might throttle your messages." An idle standard queue is long-polled; at low traffic Lambda "can optimize to as few as 2 concurrent invokes to reduce the Amazon SQS calls and corresponding costs. However, this optimization is not available when you enable the maximum concurrency setting." | `MaximumConcurrency` is the backpressure valve on Postgres connections ([idea §5.3](../docs/idea.md#53-worker-and-the-event-ledger)). The worker sets no reserved concurrency (AWS-16). The price is extra idle polling (AWS-24, AWS-U03). | lambda/API_ScalingConfig; lambda/sqs-scaling | 2026-10-15 |
| AWS-05 | `ReportBatchItemFailures`: "The `batchItemFailures` response must include a list of message IDs, as `itemIdentifier` JSON values." Complete **success**: an empty or null `batchItemFailures`, or an empty or null response. Complete **failure**: invalid JSON, an empty, null or unknown `itemIdentifier`, a bad key name, or a thrown exception. | The worker MUST list every message it did not commit. Returning `{}` deletes the whole batch, so a swallowed error loses events. A unit test feeds a batch with one failure and asserts the response. | lambda/sqs-errorhandling | 2026-10-15 |
| AWS-17 | ESM batch size for SQS: "Default 10. For standard queues the max is 10,000." The batching window runs from 0 to 300 s. A `BatchSize` above 10 needs `MaximumBatchingWindowInSeconds` of at least 1. A batch is also capped at 6 MB. | Default batch size 10 with no window. Larger batches are an M2 tuning knob, measured by the burst simulation. | lambda/API_UpdateEventSourceMapping | 2026-10-15 |
| AWS-18 | ESM `Enabled`: "When false, Lambda pauses polling and invocation", which lets you "pause invocation and resume later from the same location". | The kill switch disables the worker ESM. Messages wait in the queue under its retention (AWS-07). | lambda/API_UpdateEventSourceMapping | 2026-10-15 |
| AWS-19 | "By default, CloudWatch automatically creates a log group named `/aws/lambda/<function name>` … when it's first invoked", and "log data is stored … indefinitely". `LoggingConfig.LogGroup` points a function at an existing log group, whose name must not start with `aws/`. | Every function logs to a CDK-owned log group with explicit retention and removal (AWS-40), so nothing is created outside the stack. | lambda/cwlogs-loggroups; lambda/API_LoggingConfig; logs/log-groups | 2026-10-15 |
| AWS-20 | us-east-2: $0.20 per 1M requests (x86 and arm64). Compute is $0.0000166667/GB-s on x86 and $0.0000133334/GB-s on arm64. "The free tier includes one million requests and 400,000 GB-seconds per month." | Functions run on **arm64**, which is 20 % cheaper per GB-s. Scheduled ticks and demo traffic fit the free tier (AWS-U07). | PL:AWSLambda; lambda/pricing | 2026-10-15 |
| AWS-53 | Asynchronous invocation: "If the function returns an error, by default Lambda attempts to run it two more times". "When an event expires or fails all processing attempts, Lambda discards it." Throttled async events are retried "for up to 6 hours by default". "Even if your Event Function doesn't return an error, it's possible for it to receive the same event from Lambda multiple times because the queue itself is eventually consistent." "If the function can't keep up with incoming events, events might also be deleted from the queue without being sent to the function." | The SNS-triggered kill switch can fail silently after three attempts, so its `Errors` metric is alarmed ([Budget alarms](#budget-alarms) item 4). Nothing but concurrency limits an async fan-out, such as the worker's dispatcher invokes (ADR-017). One reconcile run can be invoked twice at once, so the reconciler claims its run before any Resend call, and its invoke sets `MaximumRetryAttempts: 0`; a lost invoke reads `run_abandoned` ([data-modeling.md → `reconcile_runs`](data-modeling.md#reconcile_runs--one-row-per-recovery-run)). | lambda/async-errors | 2026-10-16 |
| AWS-54 | Supported runtimes: "Node.js 24 \| `nodejs24.x` \| Amazon Linux 2023 \| Apr 30, 2028 \| Jun 1, 2028 \| Jul 1, 2028" (deprecation, block function create, block function update). "All supported Lambda runtimes support both x86\_64 and arm64 architectures." Node.js 26 (`nodejs26.x`) is in "public preview" and "should not be used for production workloads"; its target launch is "November 2026". Lambda deprecates a runtime "when any major component of the runtime reaches the end of community long-term support", and notifies "at least 180 days before". | Every function runs `nodejs24.x` on arm64, matching `engines` `>=24.12 <25` in the root `package.json`. No preview runtime. Moving to a newer LTS is a runtime-identifier change plus an `engines` bump, due before the 2028-04-30 deprecation. | lambda/runtimes | 2026-10-16 |
| AWS-56 | Reserved environment variable keys (`AWS_REGION`, `AWS_LAMBDA_FUNCTION_NAME`, …) cannot be set in a function's configuration; the total size of all environment variables does not exceed 4 KB. | An internal variable never uses a reserved key; a function reads `AWS_REGION` from the runtime. Variables hold names and ARNs, never bulky values. | lambda/configuration-envvars | 2026-10-16 |

### SQS

| Id | Fact | Consequence for Ledger | Source | Checked on |
| --- | --- | --- | --- | --- |
| AWS-06 | "Standard queues ensure at-least-once message delivery, but … more than one copy of a message might be delivered, and messages may occasionally arrive out of order." Lambda: "Lambda event source mappings process each event at least once, and duplicate processing of records can occur." | Dedupe on `svix_id` in the ledger transaction, and project order-independently. SQS standard, not FIFO ([idea §5.3](../docs/idea.md#53-worker-and-the-event-ledger)). | sqs/standard-queues; lambda/with-sqs | 2026-10-15 |
| AWS-07 | "By default, a message is retained for 4 days. The minimum is 60 seconds … The maximum is 1,209,600 seconds (14 days)." | The source queue keeps **13 days**, so the DLQ can keep longer (AWS-09). This bounds how long a tripped kill switch can hold events in SQS. | sqs/quotas-messages | 2026-10-15 |
| AWS-08 | Lambda: "set the source queue's visibility timeout to at least six times the configuration timeout on your function." With a batching window, the rule adds `MaximumBatchingWindowInSeconds`. Lambda rejects a mapping whose function timeout exceeds the visibility timeout. Maximum visibility timeout: 12 hours. | CDK derives the visibility timeout as 6 × worker timeout + batching window, and does not set it by hand. | lambda/sqs-configure; sqs/quotas-messages | 2026-10-15 |
| AWS-09 | "When the `ReceiveCount` for a message exceeds the `maxReceiveCount` for a queue, Amazon SQS moves the message to the dead-letter-queue." A standard queue's DLQ must be a standard queue, in the same account and region. "For standard queues, the expiration of a message is always based on its original enqueue timestamp … set the retention period of a dead-letter queue to be longer than the retention period of the original queue." Lambda recommends `maxReceiveCount` "at least 5". | DLQ retention is **14 days**, above the source's 13. `maxReceiveCount` is configurable, default 5. Every failed receive counts, a database outage included ([Constraint 4](#constraints-and-sharp-edges)). | sqs/API_SetQueueAttributes; sqs/dead-letter-queues; lambda/sqs-errorhandling | 2026-10-15 |
| AWS-21 | `StartMessageMoveTask` supports redrive "from queues that are configured as dead-letter queues (DLQs) of other Amazon SQS queues only". "Only one active message movement task is supported per queue." The rate is at most 500 messages/s, and a task runs at most 36 h. "All redriven messages are considered new messages with a new `messageID` and `enqueueTime`." | `ledger dlq redrive` uses it. Dedupe is on `svix_id`, never the SQS `messageId`. A redriven message's retention restarts. | sqs/API_StartMessageMoveTask; sqs/dlq-redrive | 2026-10-15 |
| AWS-22 | `ApproximateAgeOfOldestMessage` excludes "Poison-pill messages (those repeatedly received but never deleted)". Metrics are "pushed to CloudWatch at one-minute intervals". "There is no charge for the Amazon SQS metrics". A queue "inactive for more than six hours … stops delivering metrics". DLQ health uses `ApproximateNumberOfMessagesVisible`. | Alarms are on queue age (lag) and DLQ visible count (> 0), using SQS's free metrics, not EMF. An idle queue reports missing data, so alarms use `TreatMissingData: notBreaching`. Poison messages show up through the DLQ alarm, not the age alarm. | sqs/cloudwatch-metrics; sqs/monitoring | 2026-10-15 |
| AWS-23 | "The maximum is 1,048,576 bytes (1 MiB)" message size. The default is also 1 MiB. | Ingest enqueues the raw body plus a header subset. Resend payloads are far smaller. | sqs/quotas-messages | 2026-10-15 |
| AWS-24 | us-east-2 standard: "$0.40 per million … requests" after the first 1M per month free. "Every Amazon SQS action counts as a request." "Each 64 KB chunk of a payload is billed as 1 request." "Long-polling ReceiveMessage calls are billed exactly the same as short-polling ReceiveMessage calls." | ESM polling of an idle queue is billed. The estimate is 130k to 650k requests/month for the one worker ESM, inside the free tier (AWS-U03). | PL:AWSQueueService; sqs/pricing; sqs/faqs | 2026-10-15 |
| AWS-50 | `ReceiveMessage` returns "up to 10" messages (`MaxNumberOfMessages` 1–10). "Short poll is the default behavior where a weighted random set of machines is sampled … If the number of messages in the queue is small (fewer than 1,000), you most likely get fewer messages than you requested". `VisibilityTimeout` on the request "is applied to the messages that Amazon SQS returns". `ApproximateReceiveCount` is "the number of times a message has been received across all queues but not deleted". | DLQ inspect is a **sample**, never a complete listing, and it is not paginated. Depth comes from `ApproximateNumberOfMessagesVisible` (AWS-22). Inspect receives with a short visibility timeout and never deletes. Its receives add to the count it reports, which is harmless on a DLQ that has no redrive policy of its own ([api-contract.md → `dlq.listMessages`](api-contract.md#dlqlistmessages)). | sqs/API_ReceiveMessage | 2026-10-15 |
| AWS-25 | "On August 17, 2022, default server-side encryption (SSE) was applied to all Amazon SQS queues." SSE-SQS is "at no additional cost". SSE-KMS adds KMS charges. | Queues use SSE-SQS. No customer-managed KMS key, which would cost USD 1/month (AWS-31). | sqs/creating-standard; sqs/sse | 2026-10-15 |

### EventBridge Scheduler

| Id | Fact | Consequence for Ledger | Source | Checked on |
| --- | --- | --- | --- | --- |
| AWS-10 | Schedule types are `rate(value unit)` (minutes, hours or days), `cron(…)` and one-time `at(…)`. Flexible windows are `OFF` or `FLEXIBLE` with a maximum window. `RetryPolicy` ranges: `MaximumEventAgeInSeconds` 60–86400 and `MaximumRetryAttempts` 0–185. The 24 h and 185 defaults appear only in the CDK docs. Failed invocations can go to "an Amazon SQS standard queue" as a DLQ. The scheduler uses an execution role, and Lambda `Invoke` is a templated target. | Database-touching ticks (the reconciler, the dispatcher sweep and the worker's resume check) share one hourly `cron(…)` schedule with the flexible window `OFF`, so they land in one wake ([integrations.md → Cadence](integrations.md#cadence-and-the-database)). Ledger sets the retry policy explicitly, with small values, because the next tick supersedes a missed one. It does not rely on the defaults. The 1-minute minimum is documented only for EventBridge rules, so Ledger uses no cadence below 1 minute. | scheduler/schedule-types; scheduler/flexible-windows; scheduler/API_RetryPolicy; scheduler/dlq; scheduler/setting-up; scheduler/targets; cdk/ScheduleTargetBaseProps | 2026-10-15 |
| AWS-26 | "You can make 14,000,000 invocations per month for free." After that, "$1.00 per million scheduled invocations in US East (Ohio)". | Cost is zero at any cadence Ledger uses: every 15 min is 2,880 a month, every minute is 43,200. | eventbridge/pricing; PL:AWSEvents | 2026-10-15 |

### Secrets Manager and SSM Parameter Store

| Id | Fact | Consequence for Ledger | Source | Checked on |
| --- | --- | --- | --- | --- |
| AWS-11 | "$0.40 per Secret" per month, prorated hourly. "$0.05 per 10000 API Requests". A replica is billed as a separate secret. Deletion waits a recovery window of 7–30 days ("by default … a 30 day recovery window"). `ForceDeleteWithoutRecovery` skips it. "There is no charge for secrets that you have marked for deletion." | Secrets Manager holds the signing secrets, the Resend key and the DB URL ([features.md → connect webhook](features.md#adopter-lifecycle)). Every secret is an idle line in [Cost shape](#cost-shape), so the count is kept minimal. The layout is fixed in [integrations.md](integrations.md). Lambdas cache values per container; ingest's signing-secret set for at most 5 minutes ([ADR-009](architecture.md#adr-009--multi-secret-verification-and-timestamp-tolerance)). | secretsmanager/pricing; PL:AWSSecretsManager; secretsmanager/API_DeleteSecret; secretsmanager/delete-secret | 2026-10-15 |
| AWS-27 | SSM standard parameters "are available at no additional charge" (standard throughput). Each holds a "Maximum value size 4 KB". SecureString defaults to the AWS-managed key `aws/ssm`, and AWS-managed keys are free to create and store. | A comparison only. Secrets Manager is already bound by features.md, so this deviation is not taken. It would save USD 0.40 per secret per month. | ssm/pricing; ssm/advanced-parameters; kms/parameter-store; kms/pricing | 2026-10-15 |

### CloudWatch and SNS

| Id | Fact | Consequence for Ledger | Source | Checked on |
| --- | --- | --- | --- | --- |
| AWS-12 | Custom metrics in us-east-2 cost "$0.30 per metric-month for the first 10,000 metrics". They "are prorated by the hour and charges are incurred only when metrics are sent to CloudWatch in a given hour". 10 are free. "CloudWatch treats each unique combination of dimensions as a separate metric". In EMF, "Every DimensionSet used creates a new metric". | The EMF set stays at [architecture.md → Technology](architecture.md#technology) (Logging / metrics), with no high-cardinality dimension (no `svix_id` or `email_id` as a dimension; those go in log fields). A metric costs money only in hours it is emitted, so idle hours are free unless a scheduled run emits. Queue metrics come from SQS for free (AWS-22). | cloudwatch/pricing; PL:AmazonCloudWatch; cloudwatch/concepts; cloudwatch/emf-spec | 2026-10-15 |
| AWS-28 | "$0.10 per alarm metric month (standard resolution)". Composite alarms cost $0.50. 10 standard alarm metrics are free. | Ledger keeps ≤ 10 standard alarms, or Cost shape states the extra. No composite alarms. | PL:AmazonCloudWatch; cloudwatch/pricing | 2026-10-15 |
| AWS-29 | Logs in us-east-2: "$0.50 per GB … ingested in Standard log class", $0.25 in Infrequent Access, and "$0.03 per GB-mo of log storage". 5 GB per month is free. "By default, log data is stored in CloudWatch Logs indefinitely". Retention takes fixed values: 1, 3, 5, 7, 14, 30 … 3653 days. | Every log group sets **30 days** of retention. Logs carry ids, never addresses or payload bodies ([about.md → Risk appetite](about.md#risk-appetite)), which also keeps volume small. | PL:AmazonCloudWatch; logs/log-groups; logs/API_PutRetentionPolicy | 2026-10-15 |
| AWS-30 | "By default, many AWS services provide metrics at no charge". The pricing page lists "Basic Monitoring Metrics (Metrics sent from AWS Services by default)" as free. SQS is explicit (AWS-22). Lambda and API Gateway are not named. | Alarms prefer vended metrics (Lambda `Errors`, `Throttles`; API Gateway `Count`, `5xx`) over custom ones. | cloudwatch/concepts; cloudwatch/pricing | 2026-10-15 |
| AWS-31 | SNS: "First 1,000 Amazon SNS Email/Email-JSON Notifications per month are free", then $2.00 per 100,000. "First 1 million Amazon SNS requests per month are free". KMS: "$1 per customer managed KMS key version in US East (Ohio)". AWS-managed keys carry no monthly fee. | Alarm email costs nothing. No customer-managed KMS key anywhere, including the budget topic, which must stay unencrypted or use a key Budgets can use (AWS-35). | PL:AmazonSNS; sns/pricing; PL:awskms; kms/pricing | 2026-10-15 |
| AWS-57 | `GetMetricStatistics` "Gets statistics for the specified metric"; "The maximum number of data points returned from a single call is 1,440"; 1-minute data points "are available for 15 days". The pricing page bills "GetMetricStatistics, ListMetrics" "per 1,000 requests"; the us-east-2 offer file prices `CW:Requests` at "$0.01 per 1,000 requests". Free tier: "1 Million API requests (not including GetMetricData, GetInsightRuleReport and GetMetricWidgetImage: these 3 operations are always charged)". `GetMetricData` is "$0.01 per 1,000 metrics requested", with no free allowance. | `health.get`'s queue-age read is one `GetMetricStatistics` call per request ([api-contract.md → health.get](api-contract.md#healthget)), inside the 1M free API requests; past them, USD 0.01 per 1,000 health calls. `GetMetricData` is not used: it is always charged. Whether the free tier applies to the owner's account is AWS-U07. | cloudwatch/API_GetMetricStatistics; cloudwatch/pricing; PL:AmazonCloudWatch | 2026-10-17 |

### VPC

| Id | Fact | Consequence for Ledger | Source | Checked on |
| --- | --- | --- | --- | --- |
| AWS-13 | "By default, Lambda functions run in a Lambda-managed VPC that has internet access." Attaching one to a VPC "restricts the function to resources within that VPC, unless the VPC has internet access", and "Connecting a function to a public subnet doesn't give it internet access." In Ohio, a NAT gateway is "$0.045 per hour" plus $0.045 per GB processed (shown in a worked example). Since 2024-02-01, a public IPv4 address is $0.005/h. An interface endpoint is $0.01/GB; the per-AZ hourly rate did not render. | Lambdas run outside any VPC. A NAT gateway is ≈ USD 32.85/month idle (0.045 × 730 h) and is rejected. Only an ADR with a measured reason reopens it ([decision-lens-suite case 9](decision-lens-suite.md)). The Postgres host MUST be reachable without one ([integrations.md](integrations.md#postgres-host)). | lambda/vpc-internet; vpc/pricing; blog/public-ipv4; privatelink/pricing | 2026-10-15 |

### AWS Budgets and Cost Anomaly Detection

| Id | Fact | Consequence for Ledger | Source | Checked on |
| --- | --- | --- | --- | --- |
| AWS-32 | "You can monitor and receive notifications on your budgets free of charge." "Your first two action-enabled budgets are free … Afterwards each subsequent action-enabled budget will incur a $0.10 daily cost." | The guardrails budget is a plain budget with no Budget Action, so it costs USD 0. | budgets/pricing | 2026-10-15 |
| AWS-58 | Cost Explorer API: "Each request using your primary billing view … will incur a cost of $0.01"; the `AWSCostExplorer` offer file: "$0.01 per API Request". No Budgets page prices an API call: the pricing page charges only action-enabled budgets beyond two and "Each report delivered will incur a cost of $0.01", and the `AWSBudgets` offer file meters only `BudgetsUsage` ("$0.00 for Budget-days"), `ActionEnabledBudgetsUsage` and `BudgetsReports`, no request. `DescribeBudget` returns `CalculatedSpend.ActualSpend`. | The re-arm script reads month-to-date spend from the budget's `ActualSpend` (`DescribeBudget`), which no price list meters; Cost Explorer would cost USD 0.01 per read. The figure lags spend like every Budgets figure (AWS-34). | ce/pricing; budgets/pricing; budgets/API_DescribeBudget; PL:AWSCostExplorer; PL:AWSBudgets | 2026-10-17 |
| AWS-33 | Notification types are `ACTUAL \| FORECASTED`, with thresholds as `PERCENTAGE \| ABSOLUTE_VALUE`. A notification takes "one SNS subscriber and up to 10 email subscribers". The API page allows up to ten notifications per budget; the CloudFormation page says five. Forecasts need about 5 weeks of usage data. | ≤ 5 notifications per budget. The trip fires on ACTUAL, because a new account has no forecast yet. | budgets/API_Notification; cfn/budgets-budget | 2026-10-15 |
| AWS-52 | `AWS::Budgets::Budget` `CostTypes.IncludeCredit`: "Specifies whether a budget includes credits. The default value is `true`." | The budget sets it `false`, so credits cannot hide a runaway from the alerts or the trip ([Budget alarms](#budget-alarms) item 2). | cfn/budgets-costtypes | 2026-10-15 |
| AWS-34 | "AWS billing data, which Budgets uses to monitor resources, is updated at least once per day." "AWS Budgets information is updated up to three times a day. Updates typically occur 8–12 hours after the previous update." "There can be a delay between when you incur a charge and when you receive a notification from AWS Budgets for the charge." "Actual alerts are only sent out once per budget, per budget period, when a budget first reached the actual alert threshold." | The budget trip can fire more than a day after the spend that crosses the cap: billing lag plus up to 12 h between updates. The cap is "hard" only to within that window at the maximum spend rate ([Budget alarms](#budget-alarms) item 7). An ACTUAL notification fires once per month. | budgets/best-practices; budgets/managing-costs | 2026-10-15 |
| AWS-35 | The topic policy must grant `"Service": "budgets.amazonaws.com"` `"Action": "SNS:Publish"`. "Cross-account Amazon SNS isn't supported." An encrypted topic "won't work without additional permissions". The Budgets endpoint is listed in us-east-1, us-west-2 and ca-central-1, not us-east-2. The CloudFormation `AWS::Budgets::Budget` page states no region restriction. | The guardrails stack grants that policy on an unencrypted (SSE off) trip topic in the same account. Whether the budget deploys from a us-east-2 stack and publishes to a us-east-2 topic is AWS-U01. | budgets/sns-policy; gr/billing; cfn/budgets-budget | 2026-10-15 |
| AWS-36 | "Your available actions include applying an IAM policy or a service control policy (SCP). They also include targeting specific Amazon EC2 or Amazon RDS instances". | Budget Actions cannot stop Lambda, the SQS ESM or API Gateway. A deny policy on a principal does not stop service-initiated invocations. That reasoning is ours, not AWS's. So the kill switch is custom ([Budget alarms](#budget-alarms)). | budgets/controls | 2026-10-15 |
| AWS-37 | Cost Anomaly Detection: "anomalous spend detection across all deployed AWS services with no effort or cost". "It can take up to 24 hours to detect an anomaly after a usage occurs". | Not built. It is no faster than AWS-34, so it would not shorten the overshoot. Tripwire: a trip drill or a real bill shows spend crossing 80 % of the cap without an alert. | ce/anomaly-faqs; ce/manage-ad | 2026-10-15 |
| AWS-51 | The Free plan ends at the earlier of 6 months or "once you have exhausted your Free Tier credits". "When your Free plan expires, AWS suspends your account and any associated projects"; data is kept 90 days. | A kept deploy MUST run on a Paid-plan account: a Free-plan account suspends the stack at 6 months at the latest (lens clause 7). Slice 2 Ops checks the plan. | free/free-tier-faqs | 2026-10-15 |

### AWS CDK

| Id | Fact | Consequence for Ledger | Source | Checked on |
| --- | --- | --- | --- | --- |
| AWS-38 | Default removal policies: `sqs.Queue` is "default: RemovalPolicy.DESTROY". `secretsmanager.Secret` is "default: Not set". `logs.LogGroup` is "default: RemovalPolicy.Retain", with "default: RetentionDays.TWO_YEARS". | Every log group and secret sets `DESTROY` explicitly, so one-command teardown leaves nothing billable (AWS-U06). | cdk/sqs.Queue; cdk/secretsmanager.Secret; cdk/logs.LogGroup | 2026-10-15 |
| AWS-39 | Bootstrap creates an S3 staging bucket (`DeletionPolicy: Retain`, versioned, noncurrent versions expire after 30 days), an ECR repository, IAM roles and an SSM version parameter. "The current default is no KMS key". The docs advise: "do not delete and recreate the environment's bootstrap stack." | Bootstrap is a prerequisite, not part of Ledger's stacks. Teardown leaves it by default ([Teardown](#teardown)). Ledger ships no Docker assets, so the ECR repository stays empty. | cdk/bootstrapping-env; cdk/bootstrap-template | 2026-10-15 |
| AWS-40 | Lambda `logRetention`: "Deprecated: use `logGroup` instead". The docs call it "a legacy API and we strongly recommend you move away from it". Reading `fn.logGroup` adds a custom resource. | Each function gets an explicit `logs.LogGroup` (30 days, `DESTROY`) passed as `logGroup`. No `logRetention`, and no custom-resource Lambdas whose own log groups would outlive the stack. | cdk/lambda.Function | 2026-10-15 |
| AWS-55 | `NodejsFunction`: "If `esbuild` is available it will be used to bundle your code in your environment. Otherwise, bundling will happen in a Lambda compatible Docker container." In a monorepo, "the `esbuild` dependency needs to be installed in the 'root' `package.json` file". Defaults: `runtime` `NODEJS_LATEST` behind a feature flag, else `NODEJS_16_X`; `architecture` `X86_64`; `format` CommonJS; all `@aws-sdk/*` packages are external unless `bundleAwsSDK: true`. | Every function sets runtime, architecture, `format: ESM` and `bundleAwsSDK: true` explicitly; `esbuild` is a root devDependency and an infra test resolves it, so a silent Docker fallback fails `pnpm verify`. | cdk/lambda_nodejs | 2026-10-16 |

### Aurora and RDS (Postgres fallback and rejected options)

The Postgres host is Neon ([integrations.md → Decision](integrations.md#decision--neon)). These
facts back its fallback (Aurora Serverless v2 + Data API) and the two rejected AWS options.

| Id | Fact | Consequence for Ledger | Source | Checked on |
| --- | --- | --- | --- | --- |
| AWS-41 | Scale to zero is a minimum capacity of 0 ACU. Aurora PostgreSQL "must be running at least version 16.3, 15.7, 14.12, or 13.15". `SecondsUntilAutoPause`: "The minimum interval that you can set is 300 seconds (five minutes). That's the default … The maximum … is 86,400 seconds (one day)." | A fallback cluster runs PG ≥ 16.3 with `serverlessV2MinCapacity: 0`. | aurora/serverless-v2-auto-pause | 2026-10-15 |
| AWS-42 | "If any user-initiated connections are open … the instance won't pause." Aurora's own health-check connections "aren't counted". "If you send a request to your cluster through the RDS Data API, Aurora resumes the writer instance." After maintenance, "Aurora waits at least 20 minutes before pausing that instance again." | Every tick that touches the database wakes it for ≥ 300 s. The hourly reconciler alone keeps it awake ≈ 10 % of the month ([integrations.md → Cadence](integrations.md#cadence-and-the-database)). | aurora/serverless-v2-auto-pause | 2026-10-15 |
| AWS-43 | "the typical time to resume might be approximately 15 seconds". After more than 24 h paused, "the resume time can be 30 seconds or longer." "While an Aurora serverless instance is auto-paused, its instance charge is zero … AWS still charges for Aurora storage." The Data API returns `DatabaseResumingException` while resuming. | Ingest never touches the database, so a resume never fails a delivery. Worker and reconciler timeouts would need ≥ 30 s and a retry on `DatabaseResumingException`. | aurora/serverless-v2-auto-pause; rds-data/begin-transaction | 2026-10-15 |
| AWS-44 | us-east-2: "USD 0.12 per Aurora Capacity Unit hour running Aurora PostgreSQL Serverless v2" (Standard), USD 0.16 on I/O-Optimized. Storage: "$0.10 per RDS GB-month of consumed storage (Aurora PostgreSQL)". I/O: "$0.20 per RDS million I/O requests". Backup storage up to 100 % of the cluster size is free. | Awake 10 % of the month at 0.5 ACU: 73 h × 0.5 × 0.12 ≈ USD 4.38, plus storage. With the rest of the stack this breaks the ≤ USD 5 idle target, one reason the fallback lost ([integrations.md](integrations.md#decision--neon)). | PL:AmazonRDS; aurora/pricing | 2026-10-15 |
| AWS-45 | The Data API "provides a secure HTTP endpoint" and lets Lambda reach the cluster "without your needing to configure a Lambda function to access resources in a VPC". In us-east-2 it supports Aurora PostgreSQL 17.4+, 16.1+, 15.3+, 14.8+ and 13.11+, serverless and provisioned, but not T instance classes. It needs a Secrets Manager secret (`secretArn`) plus IAM. "The response size limit is 1 MiB." Statements time out after 45 s by default. Price: USD 0.35 per 1M requests up to 1B, payloads "metered at 32KB per request". The free tier is 1M requests/month for the first year only. | Reachable from a Lambda outside a VPC, so no NAT (AWS-13). It costs one more secret (AWS-11). | rds-data/overview; rds-data/regions; rds-data/limitations; rds-data/timeouts; PL:AmazonRDS | 2026-10-15 |
| AWS-46 | "A transaction can run for a maximum of 1 hour … A transaction times out if no calls use its transaction ID in three minutes", and it is then rolled back. Connections are pooled, and AWS "runs the `DISCARD ALL` statement" before reusing one. No page says a transaction stays on one connection. | Worker transactions are short, so both limits are fine. Whether `FOR UPDATE` locks hold across calls is AWS-U08. | rds-data/begin-transaction; rds-data/session-management | 2026-10-15 |
| AWS-47 | CDK `DatabaseCluster` `removalPolicy` defaults to "RemovalPolicy.SNAPSHOT (remove the cluster and instances, but retain a snapshot of the data)". `serverlessV2MinCapacity`: "The smallest value that you can use is 0" on versions that support auto-pause. `enableDataApi` defaults to `false`. | A fallback cluster sets `removalPolicy: DESTROY` and `enableDataApi: true`. Otherwise teardown leaves a billed snapshot. | cdk/rds.DatabaseCluster | 2026-10-15 |
| AWS-48 | RDS Proxy: "Your RDS Proxy must be in the same virtual private cloud (VPC) as the database. The proxy can't be publicly accessible." "If your Aurora cluster has an associated RDS Proxy … any Aurora serverless instances in such a cluster won't automatically pause." us-east-2 price: USD 0.015 per ACU-hour of the underlying Serverless v2 instance, or per vCPU-hour for provisioned instances. | Rejected for the life of the project: it needs a VPC, hence NAT (AWS-13), and it disables auto-pause ([decision-lens-suite case 9](decision-lens-suite.md)). | rds-proxy/limitations; rds-proxy/pricing; PL:AmazonRDS | 2026-10-15 |
| AWS-49 | Aurora DSQL "uses optimistic concurrency control (OCC) … evaluates conflicts at commit time". `SELECT … FOR UPDATE` works by "optimistic conflict detection at commit time rather than locking", and the losing transaction gets `SQLSTATE 40001`. "DDL and DML operations require separate transactions". "A transaction can modify up to 3,000 rows". | Rejected: the worker's lock-then-project transaction ([idea §5.3](../docs/idea.md#53-worker-and-the-event-ledger)) needs locks that block. | dsql/concurrency-control; dsql/postgresql-compatibility | 2026-10-15 |

## Cost shape

us-east-2, from the facts above. "Idle" means no webhook traffic, with only the scheduled ticks
running. Every line is measured after 30 idle days with **Cost Explorer grouped by service and usage
type**, credits excluded, which is the [success metric](about.md#success-metrics). The result is recorded here.

| Resource | Idle cost / month | Per-event cost | Measured by |
| --- | --- | --- | --- |
| API Gateway HTTP API | 0 | $1.00 / 1M requests (AWS-15) | Cost Explorer: API Gateway |
| Lambda, arm64, all functions | 0 (scheduled ticks fit the free tier) | $0.20 / 1M + $0.0000133334 / GB-s (AWS-20) | Cost Explorer: Lambda |
| SQS queue + DLQ | ≈ 0: est. 0.13–0.65M polls inside the 1M free tier; ≤ USD 0.26 without it (AWS-24) | $0.40 / 1M requests | Cost Explorer: SQS requests (AWS-U03) |
| EventBridge Scheduler | 0 (AWS-26) | $1.00 / 1M after 14M free | Cost Explorer: EventBridge |
| **Secrets Manager** | **$0.40 per secret** (AWS-11): USD 1.20 for 3 secrets in M1, 1.60 for 4 from M2 ([integrations.md → Secrets layout](integrations.md#secrets-layout)); +0.40 in the owner's deployment for the simulator secret ([ADR-016](architecture.md#adr-016--the-simulator-reaches-aws-only-through-an-opt-in-simulator-secret)) | $0.05 / 10k calls | Cost Explorer: Secrets Manager |
| CloudWatch custom metrics (EMF) | 0 in hours with no emission. Metrics emitted by every scheduled run cost $0.30 each beyond 10 free (AWS-12) | — | Cost Explorer: CloudWatch `MetricMonitorUsage` |
| CloudWatch alarms | 0 for ≤ 10; $0.10 each beyond (AWS-28) | — | Cost Explorer: CloudWatch `AlarmMonitorUsage` |
| CloudWatch Logs | ≈ 0: scheduled-run logs only, 30-day retention, inside 5 GB free (AWS-29) | $0.50 / GB ingested | Cost Explorer: CloudWatch Logs |
| SNS (alerts, trip topic) | 0 (AWS-31) | — | Cost Explorer: SNS |
| AWS Budgets | 0, plain budget (AWS-32) | — | — |
| CDK bootstrap bucket | a few MB of S3 storage; S3 price not researched | — | Cost Explorer: S3 |
| **Postgres host** (Neon Free, outside AWS) | 0: Free never bills; at its 100 CU-h quota the compute suspends instead ([integrations.md](integrations.md#decision--neon)) | — | Neon usage page: CU-hours used, against the ≤ 30 CU-h idle wake budget ([PG-U03](integrations.md#unverified), [Constraint 3](#constraints-and-sharp-edges)) |
| NAT gateway | **rejected**: ≈ USD 32.85 (AWS-13) | $0.045 / GB | Must not appear |
| Public IPv4, customer-managed KMS key | **none**: $3.65/IP, $1/key (AWS-13, AWS-31) | | Must not appear |

**Estimate:** ≈ USD 1.20–1.90/month for an adopter and ≈ 1.60–2.30 in the owner's deployment (the
simulator secret), almost all of it Secrets Manager. Postgres adds 0 on Neon Free. If the owner's
account is not on the always-free tiers, add ≤ USD 0.30 (AWS-U07).

## Budget alarms

**MANDATORY from the first deploy** ([lens clauses 6 and 7](../AGENTS.md#decision-lens--evidence-over-claims-right-sized);
[decision-lens-suite case 10](decision-lens-suite.md)). "Hard cap" means alerts **plus** a kill switch,
because AWS has no native hard cap (AWS-36). The design
below was ratified by the owner on 2026-10-15.

1. **Guardrails stack.** The budget, its topics and the kill switch live in their own CDK stack, so
   they survive app-stack redeploys, failed deploys and `cdk destroy` of the app stack alone. There is never
   a budget-alarm gap. The one-command teardown still removes it ([Teardown](#teardown)). The
   guardrails stack MUST NOT import values from the app stack (no `Fn::ImportValue`): it deploys
   first, and the kill switch finds its targets at trip time from the stack-prefixed function and API
   names (the worker's ESM through its function). A CDK assertion test checks that the guardrails
   template has no `Fn::ImportValue`.
2. **Budget.** One monthly cost budget, plain (no Budget Action), so it costs USD 0 (AWS-32), with
   `CostTypes.IncludeCredit: false`, so its thresholds track usage before credits (AWS-52). The cap is
   a deploy parameter, default **USD 50** ([about.md → Success metrics](about.md#success-metrics)).
3. **Notifications (4 of the ≤ 5 allowed, AWS-33).** ACTUAL 50 %, ACTUAL 80 % and FORECASTED 100 %
   go to email. The address is supplied at deploy time and never committed. ACTUAL 100 % goes to
   email **and** the trip topic. FORECASTED never trips, because a new account has no forecast.
4. **Kill switch: an SNS-triggered Lambda.** It is the only design that stops compute: Budget Actions
   cannot (AWS-36). On a trip it:
   - first disables the worker's ESM (AWS-18), so queued events wait in SQS for up to 13 days
     (AWS-07) and no receive is throttled toward the DLQ;
   - then sets reserved concurrency `0` on every app function (AWS-16): ingest, worker, dispatcher,
     reconciler and the read API;
   - lowers the HTTP API default-route throttle and every route-level throttle to its stop value,
     because a route setting overrides the stage default (AWS-14, AWS-U02);
   - publishes what it changed to the alert email.
   Every step checks current state first, so a re-run is safe. A CloudWatch alarm on the
   kill-switch function's `Errors` > 0 (AWS-30; one of the ≤ 10 free alarms, AWS-28) emails the
   owner, because Lambda discards an asynchronous event after its retries (AWS-53) and the budget
   does not alert again that month (AWS-34).
   It tears nothing down ([features.md → tear down](features.md#adopter-lifecycle)). Its own
   function and the guardrails stack are exempt.
5. **Default by deployment.** The kill switch ships in every deployment, **off by default** for adopters
   and turned on by a deploy-time flag. The owner's deployment sets the flag. Budget alerts are on
   everywhere. Putting the cap ahead of continuity is tolerable only in the owner's own deployment
   ([about.md → Risk appetite](about.md#risk-appetite)). An adopter who turns it on accepts that
   webhooks fail while it is tripped.
6. **Re-arm is scripted.** It is one command that restores what the app stack declares: removes the
   reserved concurrency, re-enables the ESM and restores the throttle. Then a `ledger reconcile` recovers the
   events Resend marked failed meanwhile, within List Events reach
   ([RS-U03](resend.md#unverified)); its default lookback reaches back to the last good run, so a
   trip longer than 3 days needs no `--lookback`
   ([ADR-007](architecture.md#adr-007--recovery-by-id-diff-and-replay-through-ingest)). The script
   name is fixed by the slice that builds it. A budget sends its ACTUAL alert once per budget period
   (AWS-34), so after a same-month re-arm the budget cannot trip again that month: the usage trip
   (item 7) is the re-armable trigger, and the re-arm warns when month-to-date spend is at or above
   the cap.
7. **Overshoot is bounded, not zero.** Budget data lags usage and refreshes every 8–12 h (AWS-34), so
   spend can pass the cap by the billing lag plus up to 12 h at the maximum spend rate. That rate is
   bounded by the steady default-route throttle (AWS-14), kept low (order of 100 rps). The burst
   step refuses while the kill switch is tripped, raises the throttle, and in `finally` restores it
   only if the current value is still the one it set, so a trip mid-burst is never reopened. A
   **usage trip** cuts the window to minutes: one CloudWatch
   alarm on the HTTP API's vended `Count` metric (AWS-30), summed over 15 minutes with a threshold
   derived from the cap, publishes to the trip topic, and returns to OK after a re-arm, so it can
   trip again (one of the ≤ 10 free alarms, AWS-28). The threshold MUST admit one burst
   (≈ 12k requests). The budget trip stays as the backstop. Slice 2 sets the throttle and the
   threshold, and states them here with the computed worst-case overshoot.
8. **Evidence.** A CDK assertion test proves the budget (with `IncludeCredit: false`), the notifications and the kill-switch wiring exist.
   A recorded **trip drill** (publish to the trip topic, observe each throttle, force one
   kill-switch failure and observe its alarm, re-arm, reconcile) proves they work ([features.md → Operations](features.md#operations)). Re-checked after every owner
   deploy ([CBL-16](check-before-launch.md#deploy-configuration)).
   Owed by [slice 2](build-checklist.md#2--durable-ingest-on-aws).

## Teardown

**One command, owner-triggered.** It first reads source-queue and DLQ depth (visible + in flight)
through `@ledger/aws` and refuses when either is non-zero unless `--discard-queued` is passed:
queued events have not reached Postgres, and the queues are deleted with the stack. It then
destroys the app stack, then the guardrails stack only when
the app stack's destroy succeeded, so a `DELETE_FAILED` app stack never loses its guardrails
([Budget alarms](#budget-alarms) item 1; the stacks declare no dependency, so `cdk destroy --all`
does not guarantee this order). `cdk destroy` of the app stack alone keeps the guardrails, by design. The kill switch never
tears down ([features.md → tear down](features.md#adopter-lifecycle)). This list is canonical.
[check-before-launch.md](check-before-launch.md) links here.

| Leftover | Why it survives | How to remove it |
| --- | --- | --- |
| Lambda log groups | Default `RETAIN` (AWS-38), and implicit `/aws/lambda/*` groups (AWS-19) | Prevented: explicit `logGroup` with `DESTROY` (AWS-40). The post-destroy check finds none |
| Secrets in their recovery window | Deletion waits 7–30 days (AWS-11) | Cost-free while pending (AWS-11). Secrets take no physical name, so a redeploy creates new ones and never collides with a pending one (AWS-U06, [integrations.md → Secrets layout](integrations.md#secrets-layout)) |
| Messages in the queue and DLQ | Queues default to `DESTROY` (AWS-38) | Deleted with the stack. Queued events have not reached Postgres, so teardown refuses a non-empty queue or DLQ unless `--discard-queued` is passed (above) |
| CDKToolkit bootstrap stack, staging bucket, ECR repo, roles | `DeletionPolicy: Retain` (AWS-39) | Normally kept; AWS advises not to delete and recreate it. To remove it fully: empty the versioned bucket, then delete the `CDKToolkit` stack |
| Postgres database (Neon) | External to AWS stacks | Bills nothing on Free. Deleting the Neon project removes the data. It is optional and recoverable for 7 days ([integrations.md](integrations.md#decision--neon)) |
| Resend webhook | Lives in Resend | The adopter deletes it, or Resend retries a dead endpoint and then auto-disables it ([RS-09, RS-11](resend.md#facts)) |
| SNS email subscription | Deleted with its topic | Nothing to do |

**Evidence:** a post-destroy listing of stack-tagged resources and of `/aws/lambda/*` log groups
finds nothing billable ([features.md → tear down](features.md#adopter-lifecycle)); a teardown test
refuses a non-empty queue or DLQ without `--discard-queued` · [slice 2](build-checklist.md#2--durable-ingest-on-aws).

## Constraints and sharp edges

1. **No native hard cap** (AWS-34, AWS-36). *Impact:* a runaway spends until the next billing
   refresh. *Resolution:* the kill switch, with the overshoot bounded by the route throttle
   ([Budget alarms](#budget-alarms) items 4 and 7).
2. **A VPC drags in a NAT gateway** (AWS-13). *Impact:* ≈ USD 32.85/month idle. *Resolution:* no VPC.
   The Postgres host is picked to be reachable over the public internet with TLS
   ([integrations.md](integrations.md#postgres-host)).
3. **Scheduled ticks can wake the database.** The dispatcher and reconciler run on schedules
   (AWS-10). *Impact:* a tick that opens a Postgres connection every few minutes can keep a
   scale-to-zero host from ever idling. That host's idle cost then becomes its active cost.
   *Resolution:* the host is Neon Free, which cannot bill. Database-touching ticks run at most
   hourly and share one schedule, inside a ≤ 30 CU-h/month wake budget
   ([integrations.md → Cadence](integrations.md#cadence-and-the-database)). PG-U03 measures it.
4. **A database outage drains into the DLQ.** Every failed receive counts toward `maxReceiveCount`
   (AWS-09), so with 5 receives and a visibility timeout of a few minutes (AWS-08), a database
   outage longer than ~15–30 min moves events to the DLQ instead of holding them in the source
   queue. This contradicts [idea §6.4](../docs/idea.md#64-failure-modes-and-expected-behavior)
   ("Queue holds events") as worded. No event is lost: the DLQ keeps a message until 14 days after
   its original enqueue (AWS-09), and redrive (AWS-21) puts them back, deduplicated on `svix_id`.
   *Resolution:* the worker pauses its own ESM when Postgres is unreachable (AWS-18), and the hourly
   cron resumes it
   ([architecture.md → ADR-015](architecture.md#adr-015--the-worker-pauses-its-own-event-source-on-a-database-outage)).
   The `--chaos db-outage` run is the evidence.
5. **`ReportBatchItemFailures` fails open on an empty response** (AWS-05). *Impact:* a handler
   that catches an error and returns `{}` deletes uncommitted events. *Resolution:* the worker
   builds the failure list from per-message results, and a unit test covers it.
6. **Log groups never expire, and CDK retains them** (AWS-19, AWS-38). *Resolution:* explicit
   `logGroup` with 30-day retention and `DESTROY` (AWS-40).
7. **Idle SQS metrics stop after six hours** (AWS-22). *Impact:* alarms on an idle queue see
   missing data. *Resolution:* `TreatMissingData: notBreaching` on the queue-age and DLQ alarms.

## [Unverified]

| Id | Claim | Why unsettled | What would settle it | Owed by |
| --- | --- | --- | --- | --- |
| AWS-U01 | `AWS::Budgets::Budget` deploys from a us-east-2 stack, and publishes to a us-east-2 SNS topic | The Budgets endpoint is listed in us-east-1 only, among US regions (AWS-35). The CloudFormation page states no restriction | The first guardrails deploy, then a forced low-threshold notification that reaches email and the trip topic (the slice 2 trip drill). Fallback: deploy the guardrails stack to us-east-1, with the kill switch acting on us-east-2 | [slice 2](build-checklist.md#2--durable-ingest-on-aws). MUST be settled |
| AWS-U02 | An HTTP API route throttle of `0` rejects every request, and throttled requests are not billed | No page states either (AWS-14). If not, a flood keeps billing API Gateway after a trip | The trip drill: send requests after the trip, read the status codes, and read API Gateway usage in Cost Explorer. Fallback: the lowest throttle that is accepted, with its worst-case spend stated | [slice 2](build-checklist.md#2--durable-ingest-on-aws). MUST be settled |
| AWS-U03 | ESM polling of an idle queue stays inside the SQS free tier (est. 0.13–0.65M requests/month) | No page states the poll rate (AWS-04, AWS-24). The estimate assumes back-to-back 20 s long polls by 1–5 pollers | 30 idle days: SQS request usage in Cost Explorer | [slice 2](build-checklist.md#2--durable-ingest-on-aws). Safe either way (≤ USD 0.26/month at 5 pollers) |
| AWS-U04 | When an HTTP API base64-encodes the request body | Only the function URL page states a rule (AWS-01) | Read `isBase64Encoded` on the first real Resend delivery | [slice 2](build-checklist.md#2--durable-ingest-on-aws). Safe either way (decode when `true`; unit test both) |
| AWS-U05 | The owner's account concurrency quota | New-account quotas are reduced and unpublished (AWS-16) | `aws lambda get-account-settings` before the first deploy (read-only) | [slice 2](build-checklist.md#2--durable-ingest-on-aws). Safe for the deploy (no reserved concurrency except the kill switch's `0`; `MaximumConcurrency` ≤ quota). Not safe for the burst: before `--burst`, [slice 3](build-checklist.md#3--operations-and-evidence-on-aws) MUST confirm the quota ≥ peak ingest concurrency (≈ rps × ingest duration) + `MaximumConcurrency` + headroom, and request a Service Quotas increase if it falls short |
| AWS-U06 | What a CDK `Secret` with `DESTROY` does on stack deletion: immediate delete or a recovery window | CDK's default is "Not set" (AWS-38). The CloudFormation deletion behavior was not read | The first teardown drill: list the secrets afterwards | [slice 2](build-checklist.md#2--durable-ingest-on-aws). Safe on cost (no charge while pending, AWS-11) and on redeploy (secrets take no physical name, so a pending one never collides, [integrations.md → Secrets layout](integrations.md#secrets-layout)) |
| AWS-U07 | The owner's account gets the always-free tiers (Lambda 1M requests/400k GB-s, SQS 1M, CloudWatch 10 metrics/10 alarms/5 GB, Scheduler 14M, SNS) on arm64 too | The pricing pages don't say whether they are always-free, cover arm64, or apply after the July 2025 Free Tier change. Separately, a Free-plan account is suspended at 6 months at the latest (AWS-51), so a kept deploy needs the Paid plan | The first month's bill | [slice 2](build-checklist.md#2--durable-ingest-on-aws). Safe either way (≤ USD 0.30/month at idle) |
| AWS-U08 | `SELECT … FOR UPDATE` locks taken in a Data API transaction hold across its later calls | AWS-46 says connections are pooled and `DISCARD ALL` runs between uses. No page says a transaction is pinned to one connection | A two-transaction lock test against a real fallback cluster | Not owed while Neon holds. The ADR that switches to the Aurora fallback MUST settle it ([integrations.md](integrations.md#decision--neon)) |
| AWS-U09 | A CloudFormation update of the worker's event source mapping re-applies the template's `Enabled: true` over an out-of-band disable (kill switch, ADR-015) | The CFN `AWS::Lambda::EventSourceMapping` page gives `Enabled` "Default: True" and "Update requires: No interruption", and does not say whether an update re-applies it | The slice 2 trip drill: deploy once while tripped with an ESM property change, then read the ESM state | [slice 2](build-checklist.md#2--durable-ingest-on-aws). Safe either way once the deploy command refuses while tripped and restores a pause |
| ~~AWS-U10~~ | ~~Where the re-arm script reads month-to-date spend, and what each read costs~~ | No `AWS-NN` fact covered the Cost Explorer API's request charge; the budget's own spend figure might be the free source | Read the Cost Explorer and Budgets pricing pages before the re-arm script lands | **Settled 2026-10-17 → [AWS-58](#aws-budgets-and-cost-anomaly-detection)** by the Cost Explorer and Budgets pricing pages and the `AWSCostExplorer` and `AWSBudgets` offer files: the re-arm reads the budget's `ActualSpend` (`DescribeBudget`), which no price list meters; a Cost Explorer read is USD 0.01 ([slice 2](build-checklist.md#2--durable-ingest-on-aws)) |
| AWS-U11 | The kill switch's HTTP API throttle update is authorized on `arn:aws:apigateway:<region>::/apis/*/stages/*` (and `…/routes/*` if it updates routes), the narrowest grant possible before the API's generated id exists | The API's id is generated at deploy, so no stack-prefixed ARN names it. **Read 2026-10-17** (apigw/service-authorization): service prefix `apigateway`; action `GET` (read) lists resource types `Apis` (`arn:${Partition}:apigateway:${Region}::/apis`) and `Stage` (`…::/apis/${ApiId}/stages/${StageName}`), among others; action `PATCH` (write) lists `Stage` and `Route` (`…::/apis/${ApiId}/routes/${RouteId}`), and not `RouteSettings` (`…::/apis/${ApiId}/stages/${StageName}/routesettings/${RouteKey}`), which `DELETE` covers. So `GetApis` is `GET` on `/apis`, `GetStage` is `GET` and `UpdateStage` (route throttles included) is `PATCH` on `/apis/*/stages/*`; the kill switch updates no route, so it needs no `/routes/*` grant. Still `[Unverified]` until a call succeeds under it | The first deploy's trip drill: the throttle update succeeds under that grant | [slice 2](build-checklist.md#2--durable-ingest-on-aws). MUST be settled: a wrong shape denies the kill switch's throttle step, which its `Errors` alarm and the trip drill surface ([Budget alarms](#budget-alarms) items 4 and 8) |
| AWS-U12 | An error thrown out of a Node.js handler is logged by the runtime itself (type, message, stack) to the function's log group, outside the app's logger | The Node.js errors page once cited for it now serves general troubleshooting text, which does not say | The first deploy: invoke a function whose handler throws a known constant, then read its log group | [slice 2](build-checklist.md#2--durable-ingest-on-aws). Safe either way: every handler catches at its edge and rethrows a constant with no `cause` ([pp-general → errors](../.agents/skills/pp-general/references/errors.md)) |

## Sources

Docs pages are under `https://docs.aws.amazon.com/` unless shown in full. `PL:<code>` is the AWS
Price List offer file
`https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/<code>/current/us-east-2/index.json`.

| Source | Page | Supports | Checked on |
| --- | --- | --- | --- |
| apigw/http-api-lambda | [apigateway/…/http-api-develop-integrations-lambda.html](https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-develop-integrations-lambda.html) | AWS-01 | 2026-10-15 |
| lambda/urls-invocation | [lambda/…/urls-invocation.html](https://docs.aws.amazon.com/lambda/latest/dg/urls-invocation.html) | AWS-01, AWS-U04 | 2026-10-15 |
| apigw/http-api-quotas | [apigateway/…/http-api-quotas.html](https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-quotas.html) | AWS-02 | 2026-10-15 |
| apigw/limits | [apigateway/…/limits.html](https://docs.aws.amazon.com/apigateway/latest/developerguide/limits.html) | AWS-14 | 2026-10-15 |
| apigw/http-api-throttling | [apigateway/…/http-api-throttling.html](https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-throttling.html) | AWS-14, AWS-U02 | 2026-10-15 |
| apigw/pricing | [aws.amazon.com/api-gateway/pricing](https://aws.amazon.com/api-gateway/pricing/) | AWS-15 | 2026-10-15 |
| apigw/service-authorization | [service-authorization/…/list_amazonapigatewaymanagement.html](https://docs.aws.amazon.com/service-authorization/latest/reference/list_amazonapigatewaymanagement.html), read through its machine-readable form [servicereference.us-east-1.amazonaws.com/v1/apigateway/apigateway.json](https://servicereference.us-east-1.amazonaws.com/v1/apigateway/apigateway.json) (the HTML page renders client-side) | AWS-U11 | 2026-10-17 |
| lambda/limits | [lambda/…/gettingstarted-limits.html](https://docs.aws.amazon.com/lambda/latest/dg/gettingstarted-limits.html) | AWS-02, AWS-03, AWS-16 | 2026-10-15 |
| lambda/concurrency | [lambda/…/configuration-concurrency.html](https://docs.aws.amazon.com/lambda/latest/dg/configuration-concurrency.html) | AWS-16 | 2026-10-15 |
| lambda/API_PutFunctionConcurrency | [lambda/latest/api/API_PutFunctionConcurrency.html](https://docs.aws.amazon.com/lambda/latest/api/API_PutFunctionConcurrency.html) | AWS-16 | 2026-10-15 |
| lambda/API_ScalingConfig | [lambda/latest/api/API_ScalingConfig.html](https://docs.aws.amazon.com/lambda/latest/api/API_ScalingConfig.html) | AWS-04 | 2026-10-15 |
| lambda/sqs-scaling | [lambda/…/services-sqs-scaling.html](https://docs.aws.amazon.com/lambda/latest/dg/services-sqs-scaling.html) | AWS-04, AWS-U03 | 2026-10-15 |
| lambda/sqs-errorhandling | [lambda/…/services-sqs-errorhandling.html](https://docs.aws.amazon.com/lambda/latest/dg/services-sqs-errorhandling.html) | AWS-05, AWS-09 | 2026-10-15 |
| lambda/sqs-configure | [lambda/…/services-sqs-configure.html](https://docs.aws.amazon.com/lambda/latest/dg/services-sqs-configure.html) | AWS-08 | 2026-10-15 |
| lambda/with-sqs | [lambda/…/with-sqs.html](https://docs.aws.amazon.com/lambda/latest/dg/with-sqs.html) | AWS-06 | 2026-10-15 |
| lambda/API_UpdateEventSourceMapping | [lambda/latest/api/API_UpdateEventSourceMapping.html](https://docs.aws.amazon.com/lambda/latest/api/API_UpdateEventSourceMapping.html) | AWS-17, AWS-18 | 2026-10-15 |
| lambda/cwlogs-loggroups | [lambda/…/monitoring-cloudwatchlogs-loggroups.html](https://docs.aws.amazon.com/lambda/latest/dg/monitoring-cloudwatchlogs-loggroups.html) | AWS-19 | 2026-10-15 |
| lambda/API_LoggingConfig | [lambda/latest/api/API_LoggingConfig.html](https://docs.aws.amazon.com/lambda/latest/api/API_LoggingConfig.html) | AWS-19 | 2026-10-15 |
| lambda/pricing | [aws.amazon.com/lambda/pricing](https://aws.amazon.com/lambda/pricing/) | AWS-20, AWS-U07 | 2026-10-15 |
| lambda/runtimes | [lambda/…/lambda-runtimes.html](https://docs.aws.amazon.com/lambda/latest/dg/lambda-runtimes.html) | AWS-54 | 2026-10-16 |
| lambda/async-errors | [lambda/…/invocation-async-error-handling.html](https://docs.aws.amazon.com/lambda/latest/dg/invocation-async-error-handling.html) | AWS-53 | 2026-10-16 |
| lambda/vpc-internet | [lambda/…/configuration-vpc-internet.html](https://docs.aws.amazon.com/lambda/latest/dg/configuration-vpc-internet.html) | AWS-13 | 2026-10-15 |
| sqs/standard-queues | [AWSSimpleQueueService/…/standard-queues.html](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/standard-queues.html) | AWS-06 | 2026-10-15 |
| sqs/quotas-messages | [AWSSimpleQueueService/…/quotas-messages.html](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/quotas-messages.html) | AWS-07, AWS-08, AWS-23 | 2026-10-15 |
| sqs/API_SetQueueAttributes | [AWSSimpleQueueService/latest/APIReference/API_SetQueueAttributes.html](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/APIReference/API_SetQueueAttributes.html) | AWS-09 | 2026-10-15 |
| sqs/dead-letter-queues | [AWSSimpleQueueService/…/sqs-dead-letter-queues.html](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-dead-letter-queues.html) | AWS-09 | 2026-10-15 |
| sqs/API_StartMessageMoveTask | [AWSSimpleQueueService/latest/APIReference/API_StartMessageMoveTask.html](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/APIReference/API_StartMessageMoveTask.html) | AWS-21 | 2026-10-15 |
| sqs/dlq-redrive | [AWSSimpleQueueService/…/sqs-configure-dead-letter-queue-redrive.html](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-configure-dead-letter-queue-redrive.html) | AWS-21 | 2026-10-15 |
| sqs/API_ReceiveMessage | [AWSSimpleQueueService/latest/APIReference/API_ReceiveMessage.html](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/APIReference/API_ReceiveMessage.html) | AWS-50 | 2026-10-15 |
| sqs/cloudwatch-metrics | [AWSSimpleQueueService/…/sqs-available-cloudwatch-metrics.html](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-available-cloudwatch-metrics.html) | AWS-22 | 2026-10-15 |
| sqs/monitoring | [AWSSimpleQueueService/…/monitoring-using-cloudwatch.html](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/monitoring-using-cloudwatch.html) | AWS-22 | 2026-10-15 |
| sqs/pricing, sqs/faqs | [aws.amazon.com/sqs/pricing](https://aws.amazon.com/sqs/pricing/), [aws.amazon.com/sqs/faqs](https://aws.amazon.com/sqs/faqs/) | AWS-24 | 2026-10-15 |
| sqs/creating-standard, sqs/sse | [creating-sqs-standard-queues.html](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/creating-sqs-standard-queues.html), [sqs-server-side-encryption.html](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-server-side-encryption.html) | AWS-25 | 2026-10-15 |
| scheduler/schedule-types | [scheduler/latest/UserGuide/schedule-types.html](https://docs.aws.amazon.com/scheduler/latest/UserGuide/schedule-types.html) | AWS-10 | 2026-10-15 |
| scheduler/flexible-windows | [scheduler/…/managing-schedule-flexible-time-windows.html](https://docs.aws.amazon.com/scheduler/latest/UserGuide/managing-schedule-flexible-time-windows.html) | AWS-10 | 2026-10-15 |
| scheduler/API_RetryPolicy | [scheduler/latest/APIReference/API_RetryPolicy.html](https://docs.aws.amazon.com/scheduler/latest/APIReference/API_RetryPolicy.html) | AWS-10 | 2026-10-15 |
| scheduler/dlq, setting-up, targets | [configuring-schedule-dlq.html](https://docs.aws.amazon.com/scheduler/latest/UserGuide/configuring-schedule-dlq.html), [setting-up.html](https://docs.aws.amazon.com/scheduler/latest/UserGuide/setting-up.html), [managing-targets.html](https://docs.aws.amazon.com/scheduler/latest/UserGuide/managing-targets.html) | AWS-10 | 2026-10-15 |
| cdk/ScheduleTargetBaseProps | [cdk/api/v2/docs/aws-cdk-lib.aws_scheduler_targets.ScheduleTargetBaseProps.html](https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_scheduler_targets.ScheduleTargetBaseProps.html) | AWS-10 | 2026-10-15 |
| eventbridge/pricing | [aws.amazon.com/eventbridge/pricing](https://aws.amazon.com/eventbridge/pricing/) | AWS-26 | 2026-10-15 |
| secretsmanager/pricing | [aws.amazon.com/secrets-manager/pricing](https://aws.amazon.com/secrets-manager/pricing/) | AWS-11 | 2026-10-15 |
| secretsmanager/API_DeleteSecret, delete-secret | [API_DeleteSecret.html](https://docs.aws.amazon.com/secretsmanager/latest/apireference/API_DeleteSecret.html), [manage_delete-secret.html](https://docs.aws.amazon.com/secretsmanager/latest/userguide/manage_delete-secret.html) | AWS-11, AWS-U06 | 2026-10-15 |
| ssm/pricing, ssm/advanced-parameters | [aws.amazon.com/systems-manager/pricing](https://aws.amazon.com/systems-manager/pricing/), [parameter-store-advanced-parameters.html](https://docs.aws.amazon.com/systems-manager/latest/userguide/parameter-store-advanced-parameters.html) | AWS-27 | 2026-10-15 |
| kms/parameter-store, kms/pricing | [services-parameter-store.html](https://docs.aws.amazon.com/kms/latest/developerguide/services-parameter-store.html), [aws.amazon.com/kms/pricing](https://aws.amazon.com/kms/pricing/) | AWS-27, AWS-31 | 2026-10-15 |
| cloudwatch/pricing | [aws.amazon.com/cloudwatch/pricing](https://aws.amazon.com/cloudwatch/pricing/) | AWS-12, AWS-28, AWS-29, AWS-30, AWS-57 | 2026-10-15; AWS-57 2026-10-17 |
| cloudwatch/API_GetMetricStatistics | [AmazonCloudWatch/latest/APIReference/API_GetMetricStatistics.html](https://docs.aws.amazon.com/AmazonCloudWatch/latest/APIReference/API_GetMetricStatistics.html) | AWS-57 | 2026-10-17 |
| cloudwatch/concepts | [AmazonCloudWatch/…/cloudwatch_concepts.html](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/cloudwatch_concepts.html) | AWS-12, AWS-30 | 2026-10-15 |
| cloudwatch/emf-spec | [AmazonCloudWatch/…/CloudWatch_Embedded_Metric_Format_Specification.html](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/CloudWatch_Embedded_Metric_Format_Specification.html) | AWS-12 | 2026-10-15 |
| logs/log-groups | [AmazonCloudWatch/latest/logs/Working-with-log-groups-and-streams.html](https://docs.aws.amazon.com/AmazonCloudWatch/latest/logs/Working-with-log-groups-and-streams.html) | AWS-19, AWS-29 | 2026-10-15 |
| logs/API_PutRetentionPolicy | [AmazonCloudWatchLogs/latest/APIReference/API_PutRetentionPolicy.html](https://docs.aws.amazon.com/AmazonCloudWatchLogs/latest/APIReference/API_PutRetentionPolicy.html) | AWS-29 | 2026-10-15 |
| sns/pricing | [aws.amazon.com/sns/pricing](https://aws.amazon.com/sns/pricing/) | AWS-31 | 2026-10-15 |
| vpc/pricing, privatelink/pricing | [aws.amazon.com/vpc/pricing](https://aws.amazon.com/vpc/pricing/), [aws.amazon.com/privatelink/pricing](https://aws.amazon.com/privatelink/pricing/) | AWS-13 | 2026-10-15 |
| blog/public-ipv4 | [aws.amazon.com/blogs/aws/new-aws-public-ipv4-address-charge-public-ip-insights](https://aws.amazon.com/blogs/aws/new-aws-public-ipv4-address-charge-public-ip-insights/) | AWS-13 | 2026-10-15 |
| budgets/pricing | [aws.amazon.com/aws-cost-management/aws-budgets/pricing](https://aws.amazon.com/aws-cost-management/aws-budgets/pricing/) | AWS-32, AWS-58 | 2026-10-15; AWS-58 2026-10-17 |
| budgets/API_DescribeBudget | [aws-cost-management/latest/APIReference/API_budgets_DescribeBudget.html](https://docs.aws.amazon.com/aws-cost-management/latest/APIReference/API_budgets_DescribeBudget.html) | AWS-58 | 2026-10-17 |
| ce/pricing | [aws.amazon.com/aws-cost-management/aws-cost-explorer/pricing](https://aws.amazon.com/aws-cost-management/aws-cost-explorer/pricing/) | AWS-58 | 2026-10-17 |
| budgets/API_Notification | [aws-cost-management/latest/APIReference/API_budgets_Notification.html](https://docs.aws.amazon.com/aws-cost-management/latest/APIReference/API_budgets_Notification.html) | AWS-33 | 2026-10-15 |
| cfn/budgets-budget | [AWSCloudFormation/latest/TemplateReference/aws-resource-budgets-budget.html](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-budgets-budget.html) | AWS-33, AWS-35, AWS-U01 | 2026-10-15 |
| cfn/budgets-costtypes | [AWSCloudFormation/latest/TemplateReference/aws-properties-budgets-budget-costtypes.html](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-properties-budgets-budget-costtypes.html) | AWS-52 | 2026-10-15 |
| budgets/best-practices | [cost-management/latest/userguide/budgets-best-practices.html](https://docs.aws.amazon.com/cost-management/latest/userguide/budgets-best-practices.html) | AWS-34 | 2026-10-15 |
| budgets/managing-costs | [cost-management/latest/userguide/budgets-managing-costs.html](https://docs.aws.amazon.com/cost-management/latest/userguide/budgets-managing-costs.html) | AWS-34 | 2026-10-15 |
| budgets/sns-policy | [cost-management/latest/userguide/budgets-sns-policy.html](https://docs.aws.amazon.com/cost-management/latest/userguide/budgets-sns-policy.html) | AWS-35 | 2026-10-15 |
| gr/billing | [general/latest/gr/billing.html](https://docs.aws.amazon.com/general/latest/gr/billing.html) | AWS-35, AWS-U01 | 2026-10-15 |
| budgets/controls | [cost-management/latest/userguide/budgets-controls.html](https://docs.aws.amazon.com/cost-management/latest/userguide/budgets-controls.html) | AWS-36 | 2026-10-15 |
| ce/anomaly-faqs, ce/manage-ad | [aws-cost-anomaly-detection/faqs](https://aws.amazon.com/aws-cost-management/aws-cost-anomaly-detection/faqs/), [manage-ad.html](https://docs.aws.amazon.com/cost-management/latest/userguide/manage-ad.html) | AWS-37 | 2026-10-15 |
| free/free-tier-faqs | [aws.amazon.com/free/free-tier-faqs](https://aws.amazon.com/free/free-tier-faqs/) | AWS-51 | 2026-10-15 |
| cdk/sqs.Queue, secretsmanager.Secret, logs.LogGroup | [aws_sqs.Queue](https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_sqs.Queue.html), [aws_secretsmanager.Secret](https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_secretsmanager.Secret.html), [aws_logs.LogGroup](https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_logs.LogGroup.html) | AWS-38 | 2026-10-15 |
| cdk/bootstrapping-env | [cdk/v2/guide/bootstrapping-env.html](https://docs.aws.amazon.com/cdk/v2/guide/bootstrapping-env.html) | AWS-39 | 2026-10-15 |
| cdk/bootstrap-template | [aws-cdk-cli bootstrap-template.yaml](https://github.com/aws/aws-cdk-cli/blob/main/packages/aws-cdk/lib/api/bootstrap/bootstrap-template.yaml) (template version 32) | AWS-39 | 2026-10-15 |
| cdk/lambda.Function | [aws_lambda.Function](https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_lambda.Function.html) | AWS-40 | 2026-10-15 |
| cdk/lambda_nodejs | [aws_lambda_nodejs](https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_lambda_nodejs-readme.html) | AWS-55 | 2026-10-16 |
| lambda/configuration-envvars | [lambda/…/configuration-envvars.html](https://docs.aws.amazon.com/lambda/latest/dg/configuration-envvars.html) | AWS-56 | 2026-10-16 |
| aurora/serverless-v2-auto-pause | [AmazonRDS/…/aurora-serverless-v2-auto-pause.html](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/aurora-serverless-v2-auto-pause.html) | AWS-41, AWS-42, AWS-43 | 2026-10-15 |
| aurora/pricing | [aws.amazon.com/rds/aurora/pricing](https://aws.amazon.com/rds/aurora/pricing/) (N. Virginia examples only; Ohio prices from `PL:AmazonRDS`) | AWS-44 | 2026-10-15 |
| rds-data/overview, regions, limitations, timeouts | [data-api.html](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/data-api.html), [Data_API regions](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/Concepts.Aurora_Fea_Regions_DB-eng.Feature.Data_API.html), [data-api.limitations.html](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/data-api.limitations.html), [data-api-timeouts.html](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/data-api-timeouts.html) | AWS-45 | 2026-10-15 |
| rds-data/begin-transaction, session-management | [API_BeginTransaction.html](https://docs.aws.amazon.com/rdsdataservice/latest/APIReference/API_BeginTransaction.html), [data-api.session-management.html](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/data-api.session-management.html) | AWS-43, AWS-46, AWS-U08 | 2026-10-15 |
| cdk/rds.DatabaseCluster | [aws_rds.DatabaseCluster](https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_rds.DatabaseCluster.html), [RemovalPolicy](https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.RemovalPolicy.html) | AWS-47 | 2026-10-15 |
| rds-proxy/limitations, pricing | [rds-proxy.html](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/rds-proxy.html), [aws.amazon.com/rds/proxy/pricing](https://aws.amazon.com/rds/proxy/pricing/) | AWS-48 | 2026-10-15 |
| dsql/concurrency-control, postgresql-compatibility | [working-with-concurrency-control.html](https://docs.aws.amazon.com/aurora-dsql/latest/userguide/working-with-concurrency-control.html), [unsupported features](https://docs.aws.amazon.com/aurora-dsql/latest/userguide/working-with-postgresql-compatibility-unsupported-features.html) | AWS-49 | 2026-10-15 |
| PL:AmazonApiGateway, AWSLambda, AWSQueueService, AWSEvents, AWSSecretsManager, AmazonCloudWatch, AmazonSNS, awskms, AmazonRDS | Price List offer files, us-east-2 | AWS-15, AWS-20, AWS-24, AWS-26, AWS-11, AWS-12, AWS-28, AWS-29, AWS-31, AWS-44, AWS-45, AWS-48; AmazonCloudWatch also AWS-57 (offer published 2026-10-07) | 2026-10-15; AWS-57 2026-10-17 |
| PL:AWSCostExplorer, AWSBudgets | Price List offer files with no regional variant: `https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/<code>/current/index.json` (both published 2026-09-11) | AWS-58 | 2026-10-17 |

## Learning notes

M3 calls for a learning log of the AWS and distributed-systems decisions
([about.md → Milestones](about.md#milestones)). Its location is decided in
[architecture.md](architecture.md). Each entry links the `AWS-NN` fact or ADR it taught. This
section only points there. Candidates from this research: AWS-04 (the backpressure valve has an idle
cost), AWS-05 (partial batch responses fail open), AWS-09 and Constraint 4 (a DB outage drains into
the DLQ), and AWS-34 with AWS-36 (why a "hard cap" needs a custom kill switch and still overshoots).
