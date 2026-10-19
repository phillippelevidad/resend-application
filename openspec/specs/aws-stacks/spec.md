# aws-stacks Specification

## Purpose

States what the two synthesized AWS stacks hold, so the cost brake, the budget cap and the kill
switch are proven on the template before anything is deployed, and the kill switch's behavior is
proven against its AWS calls.

## Requirements

### Requirement: Cost-brake properties on the templates
Both synthesized templates SHALL hold every cost-brake property: arm64 functions on `nodejs24.x`, no VPC and no EC2 resource, an explicit log group per function with 30-day retention destroyed with the stack, no custom resource, no KMS key, SSE-SQS queues, no reserved or provisioned concurrency, no secret value in the template, and at most ten standard alarms across both stacks (AWS-28).

#### Scenario: A function in a VPC
- **WHEN** any function is synthesized with a VPC configuration
- **THEN** the template assertion for that property fails

#### Scenario: An empty template cannot pass
- **WHEN** a template holds no function at all
- **THEN** the paired count assertion fails, so an "every function" property never passes by matching nothing

#### Scenario: Five alarms within the free count
- **WHEN** both templates are synthesized with the kill switch and the simulator flag on
- **THEN** they hold five standard alarms between them, within AWS-28's ten

### Requirement: Queues and the worker's event source
The app stack SHALL hold a source queue retaining messages 13 days and a DLQ retaining them 14 days, with `maxReceiveCount` 5, a source visibility timeout derived from the worker's timeout (AWS-08), and one event source mapping with batch size 10, no batching window, `ReportBatchItemFailures` and `MaximumConcurrency` 5 (ADR-008, AWS-04).

#### Scenario: Mapping settings
- **WHEN** the app template is synthesized
- **THEN** its mapping has batch size 10, no batching window, `FunctionResponseTypes: [ReportBatchItemFailures]` and a `MaximumConcurrency` of 5

#### Scenario: Derived visibility timeout
- **WHEN** the worker's timeout changes
- **THEN** the source queue's visibility timeout in the template changes with it, by the AWS-08 derivation

### Requirement: The HTTP API routes ingest and the read API
The app stack's HTTP API SHALL route the ingest endpoint (api-contract.md → Ingest boundary) to ingest and every other request to the read API, on a stage whose default-route throttle is rate 100 and burst 200 (aws.md → Budget alarms item 7).

#### Scenario: Throttle on the app template
- **WHEN** the app template is synthesized
- **THEN** its `$default` stage carries the default-route throttle at rate 100 and burst 200

### Requirement: Each function's environment is exactly its names
Each function's environment variables SHALL equal, as a set, the keys of the names object the shared kernel declares for that function, and every value SHALL be an ARN, URL or name, never a secret. With the simulator flag, ingest's set SHALL be its names object plus the simulator names object, and without it, its names object alone.

#### Scenario: A variable on the wrong function
- **WHEN** a variable is set on a function whose names object does not list it
- **THEN** that function's environment assertion fails

#### Scenario: No secret value reaches a function
- **WHEN** any template is synthesized
- **THEN** it holds no `resolve:secretsmanager` reference and no environment value is a secret

#### Scenario: Ingest's names both ways
- **WHEN** the app stack is synthesized with and without the simulator flag
- **THEN** ingest's environment keys equal its names object plus `SIMULATOR_SECRET_ARN` with the flag, and its names object alone without it

### Requirement: Secrets least privilege
The app stack SHALL hold two secrets, `ledger/webhook-signing-secrets` and `ledger/database`, plus `ledger/simulator-signing-secret` only with the simulator flag, each with no value and no physical name in the template and destroyed with the stack, and each function SHALL be granted read on exactly the secrets the Secrets layout names for it.

#### Scenario: Ingest's grants
- **WHEN** the app template is synthesized
- **THEN** ingest's role can read the signing-secrets secret and not the database secret

#### Scenario: Simulator secret's grant
- **WHEN** the app template is synthesized with the simulator flag
- **THEN** ingest's role can read the simulator secret, and no other function's role can

### Requirement: The hourly resume schedule
The app stack SHALL hold one hourly schedule, flexible window off, no retry, events older than 60 seconds dropped, that sends the worker the resume event (AWS-10, ADR-015).

#### Scenario: Schedule settings
- **WHEN** the app template is synthesized
- **THEN** it holds exactly one schedule with an hourly cron, window `OFF`, zero retry attempts and a target of the worker

### Requirement: The usage trip
The app stack SHALL hold one alarm on the HTTP API's request count, summed over 15 minutes, with threshold 15,000 and missing data not breaching, whose action is the guardrails trip topic, referenced by a constructed ARN rather than a cross-stack import.

#### Scenario: One burst passes
- **WHEN** one burst of about 12,000 requests arrives in 15 minutes (item 7)
- **THEN** the alarm's threshold is not crossed

#### Scenario: Usage trip wiring
- **WHEN** the app template is synthesized
- **THEN** the usage-trip alarm's action is the trip topic's ARN and the template holds no `Fn::ImportValue`

### Requirement: The app stack's outputs
The app template SHALL output `DeployedCommit` equal to the commit it was synthesized from, the API URL, both secret ARNs, both queue URLs, the worker's function name, and the steady throttle's rate and burst. With the simulator flag, it SHALL also output `SimulatorSecretArn`, and without it, no such output.

#### Scenario: Deployed commit
- **WHEN** the app stack is synthesized for a commit
- **THEN** its `DeployedCommit` output equals that commit

#### Scenario: Simulator secret output only with the flag
- **WHEN** the app stack is synthesized with and without the simulator flag
- **THEN** `SimulatorSecretArn` is an output only with the flag

### Requirement: The guardrails stack and its budget
A separate guardrails stack importing nothing from the app stack SHALL hold one monthly cost budget excluding credits, with ACTUAL 50 %, ACTUAL 80 % and FORECASTED 100 % notifications to an alert topic, and ACTUAL 100 % to a trip topic. Both topics SHALL be unencrypted and let Budgets and CloudWatch publish (AWS-33, AWS-35, AWS-52).

#### Scenario: Budget wiring
- **WHEN** the guardrails template is synthesized
- **THEN** it holds one budget with `IncludeCredit: false` and four notifications, three to the alert topic and ACTUAL 100 % to the trip topic

#### Scenario: Alert address
- **WHEN** an alert address is given at synth
- **THEN** it subscribes to both topics, and no tracked file holds it

#### Scenario: Drill budget only on request
- **WHEN** the guardrails stack is synthesized without the budget-drill flag
- **THEN** it holds no drill budget

### Requirement: The kill switch is deployed, armed by choice
Every deployment SHALL hold the kill switch function and an alarm on its `Errors`; the trip topic SHALL be subscribed to it only when the kill switch is set `on`, which the stack reports as `KillSwitchArmed` (aws.md → Budget alarms items 4, 5).

#### Scenario: Armed
- **WHEN** the guardrails stack is synthesized with the kill switch `on`
- **THEN** the trip topic has a subscription to the kill switch and `KillSwitchArmed` is `true`

#### Scenario: Disarmed by default
- **WHEN** it is synthesized without the setting
- **THEN** the kill switch function and its `Errors` alarm exist, no subscription exists, and `KillSwitchArmed` is `false`

### Requirement: The kill switch stops compute in order
On a trip the kill switch SHALL first disable the worker's event source, then set concurrency `0` on every app function by the app stack's name prefix, then lower the default and every per-route throttle to its stop value, then report what it changed with no id, URL or account. A re-run SHALL change nothing more.

#### Scenario: Order of a trip
- **WHEN** the kill switch handles a message on the trip topic
- **THEN** the event source is disabled before any concurrency is set to `0`

#### Scenario: A later slice's function
- **WHEN** the app stack holds a function the kill switch's code does not name
- **THEN** that function's concurrency is set to `0` too, because it carries the app stack's prefix

#### Scenario: Re-run
- **WHEN** the kill switch handles a second trip message on an already tripped stack
- **THEN** it issues no change and reports the same state

### Requirement: Restoring from a trip
Restoring SHALL remove every app function's concurrency setting, re-enable the worker's event source, restore the default-route throttle from the app stack's declared values and remove every per-route throttle.

#### Scenario: Restore after a trip
- **WHEN** a tripped stack is restored
- **THEN** no app function carries a concurrency setting, the event source is enabled and the stage throttle equals the declared rate and burst

### Requirement: Bundles load
Every synthesized function bundle SHALL load in Node and export a `handler` function with no AWS access, and bundling SHALL use the repository's own `esbuild`, never a Docker fallback (AWS-55).

#### Scenario: Unloadable bundle
- **WHEN** a bundle throws on import
- **THEN** the bundle smoke check fails before any deploy

### Requirement: Operational alarms email through the alert topic
The app stack SHALL hold three alarms whose one action, on `ALARM` only, is the guardrails alert topic, referenced by a constructed ARN rather than a cross-stack import, each with missing data not breaching (AWS-22): `LedgerApp-queue-age` (source queue oldest-message age, `Maximum` over 300 s, above 900 s), `LedgerApp-dlq-depth` (DLQ visible messages, `Maximum` over 300 s, above 0) and `LedgerApp-api-5xx` (HTTP API `5xx`, `Sum` over 300 s, above 0).

#### Scenario: Queue-age alarm
- **WHEN** the app template is synthesized
- **THEN** it holds `LedgerApp-queue-age` on `ApproximateAgeOfOldestMessage` of the source queue, `Maximum`, period 300, one evaluation period, threshold 900, `GreaterThanThreshold`, `TreatMissingData: notBreaching`, and one alarm action, the alert topic's ARN

#### Scenario: DLQ-depth alarm
- **WHEN** the app template is synthesized
- **THEN** it holds `LedgerApp-dlq-depth` on `ApproximateNumberOfMessagesVisible` of the DLQ, threshold 0, `GreaterThanThreshold`, missing data not breaching, and the alert topic as its one action

#### Scenario: 5xx alarm
- **WHEN** the app template is synthesized
- **THEN** it holds `LedgerApp-api-5xx` on the HTTP API's `5xx` metric, `Sum`, threshold 0, missing data not breaching, and the alert topic as its one action

#### Scenario: No OK action
- **WHEN** either template is synthesized
- **THEN** none of the three alarms holds an `OKActions` or `InsufficientDataActions` entry, and the template holds no `Fn::ImportValue`

### Requirement: Every alarm describes itself and links its runbook entry
Every alarm in both templates SHALL carry an `AlarmDescription` of one line saying what fired, followed by `Runbook: <runbook base URL>#<slug>`, where the slug is the GitHub anchor of the alarm's runbook heading. No description SHALL hold an ARN, account id, deployed URL or address.

#### Scenario: All five described
- **WHEN** both templates are synthesized with the kill switch on
- **THEN** each of the five alarms' descriptions ends with `Runbook: <runbook base URL>#<its name in lowercase>`

### Requirement: The simulator secret exists only with the flag
Without the simulator flag, the app stack SHALL hold no simulator secret and ingest SHALL reference none, in its environment or its policy. With it, the stack SHALL hold `ledger/simulator-signing-secret` with no value and no physical name, destroyed with the stack, readable by ingest only, and ingest's environment SHALL name it (ADR-016).

#### Scenario: Adopter default
- **WHEN** the app stack is synthesized without the simulator flag
- **THEN** it holds two secrets, and no `SIMULATOR_SECRET_ARN` appears in ingest's environment or any policy

#### Scenario: Owner's deployment
- **WHEN** the app stack is synthesized with the simulator flag
- **THEN** it holds three secrets, ingest's environment keys are its names object plus `SIMULATOR_SECRET_ARN`, and only ingest's role can read the simulator secret

### Requirement: The read API may inspect and redrive the DLQ
The read API's role SHALL hold `sqs:ReceiveMessage`, `sqs:DeleteMessage`, `sqs:StartMessageMoveTask`, `sqs:ListMessageMoveTasks` and `sqs:GetQueueAttributes` on the DLQ, and `sqs:SendMessage` and `sqs:GetQueueAttributes` on the source queue: the documented minimum for a redrive to the source queue (AWS-60). No other function SHALL gain a DLQ permission.

#### Scenario: Read API grants
- **WHEN** the app template is synthesized
- **THEN** the read API's SQS statements hold exactly those actions on those two queues, and neither ingest's nor the worker's policy holds `sqs:StartMessageMoveTask`
