# Spec Delta

## Purpose

States what the two synthesized AWS stacks hold, so the cost brake, the budget cap and the kill
switch are proven on the template before anything is deployed, and the kill switch's behavior is
proven against its AWS calls.

## ADDED Requirements

### Requirement: Cost-brake properties on the templates
Both synthesized templates SHALL hold every cost-brake property: arm64 functions on `nodejs24.x`, no VPC and no EC2 resource, an explicit log group per function with 30-day retention destroyed with the stack, no custom resource, no KMS key, SSE-SQS queues, no reserved or provisioned concurrency, no secret value in the template, and at most ten standard alarms across both stacks (AWS-28).

#### Scenario: A function in a VPC
- **WHEN** any function is synthesized with a VPC configuration
- **THEN** the template assertion for that property fails

#### Scenario: An empty template cannot pass
- **WHEN** a template holds no function at all
- **THEN** the paired count assertion fails, so an "every function" property never passes by matching nothing

### Requirement: Queues and the worker's event source
The app stack SHALL hold a source queue retaining messages 13 days and a DLQ retaining them 14 days, with `maxReceiveCount` 5, a source visibility timeout derived from the worker's timeout (AWS-08), and one event source mapping with batch size 10, no batching window, `ReportBatchItemFailures` and `MaximumConcurrency` 5 (ADR-008, AWS-04).

#### Scenario: Mapping settings
- **WHEN** the app template is synthesized
- **THEN** its mapping has batch size 10, no batching window, `FunctionResponseTypes: [ReportBatchItemFailures]` and a `MaximumConcurrency` of 5

#### Scenario: Derived visibility timeout
- **WHEN** the worker's timeout changes
- **THEN** the source queue's visibility timeout in the template changes with it, by the AWS-08 derivation

### Requirement: The HTTP API routes ingest and the read API
The app stack's HTTP API SHALL route `POST /webhooks/resend` to ingest and every other request to the read API, on a stage whose default-route throttle is rate 100 and burst 200 (aws.md → Budget alarms item 7).

#### Scenario: Throttle on the app template
- **WHEN** the app template is synthesized
- **THEN** its `$default` stage carries the default-route throttle at rate 100 and burst 200

### Requirement: Each function's environment is exactly its names
Each function's environment variables SHALL equal, as a set, the keys of its names object in `packages/shared/src/function-env.ts`, and every value SHALL be an ARN, URL or name, never a secret.

#### Scenario: A variable on the wrong function
- **WHEN** a variable is set on a function whose names object does not list it
- **THEN** that function's environment assertion fails

#### Scenario: No secret value reaches a function
- **WHEN** any template is synthesized
- **THEN** it holds no `resolve:secretsmanager` reference and no environment value is a secret

### Requirement: Secrets least privilege
The app stack SHALL hold two secrets, `ledger/webhook-signing-secrets` and `ledger/database`, each with no value and no physical name in the template and destroyed with the stack, and each function SHALL be granted read on exactly the secrets the Secrets layout names for it.

#### Scenario: Ingest's grants
- **WHEN** the app template is synthesized
- **THEN** ingest's role can read the signing-secrets secret and not the database secret

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
The app template SHALL output `DeployedCommit` equal to the commit it was synthesized from, the API URL, both secret ARNs, both queue URLs, the worker's function name, and the steady throttle's rate and burst.

#### Scenario: Deployed commit
- **WHEN** the app stack is synthesized for a commit
- **THEN** its `DeployedCommit` output equals that commit

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
