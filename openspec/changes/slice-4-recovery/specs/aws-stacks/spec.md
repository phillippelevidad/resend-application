# aws-stacks — spec delta

## ADDED Requirements

### Requirement: The reconciler function
The app stack SHALL hold `LedgerApp-reconciler`, with 256 MB of memory, a 900 s timeout (AWS-03) and no reserved concurrency, whose asynchronous invokes are never retried and are dropped after 60 s of age (AWS-53, AWS-63), and which the kill switch stops and restores with the other `LedgerApp-` functions.

#### Scenario: Function settings
- **WHEN** the app template is synthesized
- **THEN** it holds `LedgerApp-reconciler` with `MemorySize` 256, `Timeout` 900 and no `ReservedConcurrentExecutions`, and the existing every-function assertions count it

#### Scenario: Invoke config
- **WHEN** the app template is synthesized
- **THEN** it holds exactly one `AWS::Lambda::EventInvokeConfig`, on the reconciler, with `MaximumRetryAttempts` 0 and `MaximumEventAgeInSeconds` 60

### Requirement: The hourly reconcile schedule
The app stack SHALL hold `LedgerApp-reconcile-hourly` on the same hourly cron as the resume schedule, flexible window off, no retry, events older than 60 seconds dropped, that sends the reconciler the scheduled-run event (AWS-10).

#### Scenario: Schedule settings
- **WHEN** the app template is synthesized
- **THEN** `LedgerApp-reconcile-hourly` has the resume schedule's cron expression, window `OFF`, zero retry attempts, a maximum event age of 60 and a target of the reconciler

### Requirement: Reconciler permissions
The reconciler's role SHALL be able to read `ledger/resend-api-key` and `ledger/database` only, read both queues' attributes, and read CloudWatch metric statistics. The read API's role SHALL be able to invoke the reconciler and no other function's role SHALL.

#### Scenario: Reconciler grants
- **WHEN** the app template is synthesized
- **THEN** the reconciler's `secretsmanager:GetSecretValue` resources are exactly those two secrets, and no other function's role can read `ledger/resend-api-key`

#### Scenario: Who may invoke it
- **WHEN** the app template is synthesized
- **THEN** only the read API's role holds `lambda:InvokeFunction` on the reconciler's ARN, besides the schedule's own role

### Requirement: The reconcile-gap alarm
The app stack SHALL hold `LedgerApp-reconcile-gap` on `Ledger` / `reconcile.missing` with no dimension, `Maximum` over 3600 s, one evaluation period, above 0, missing data breaching, on a wall clock evaluation window so an hour with no datapoint is evaluated as breaching (AWS-64), with one `ALARM` action, the alert topic.

#### Scenario: Alarm settings
- **WHEN** the app template is synthesized
- **THEN** it holds `LedgerApp-reconcile-gap` with those settings, `TreatMissingData: breaching`, `EvaluationWindow: { WallClockWindow: {} }`, and one alarm action, the alert topic's constructed ARN

## MODIFIED Requirements

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
- **THEN** they hold the five alarms of slices 2 and 3 (`LedgerApp-usage-trip`, `LedgerGuardrails-kill-switch-errors`, `LedgerApp-queue-age`, `LedgerApp-dlq-depth`, `LedgerApp-api-5xx`) and `LedgerApp-reconcile-gap`: six standard alarms between them, within AWS-28's ten

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

#### Scenario: The reconciler's and the read API's names
- **WHEN** the app stack is synthesized
- **THEN** the reconciler's environment keys equal its names object (`DATABASE_SECRET_ARN`, `RESEND_API_KEY_SECRET_ARN`, `RESEND_WEBHOOK_ID`, `QUEUE_URL`, `DLQ_URL`), and the read API's include `RECONCILER_FUNCTION_NAME`

#### Scenario: No webhook id given
- **WHEN** the app stack is synthesized without a Resend webhook id
- **THEN** the reconciler's `RESEND_WEBHOOK_ID` is `unset`

### Requirement: Secrets least privilege
The app stack SHALL hold three secrets, `ledger/webhook-signing-secrets`, `ledger/database` and `ledger/resend-api-key`, plus `ledger/simulator-signing-secret` only with the simulator flag, each with no value and no physical name in the template and destroyed with the stack, and each function SHALL be granted read on exactly the secrets the Secrets layout names for it.

#### Scenario: Ingest's grants
- **WHEN** the app template is synthesized
- **THEN** ingest's role can read the signing-secrets secret and not the database secret

#### Scenario: Simulator secret's grant
- **WHEN** the app template is synthesized with the simulator flag
- **THEN** ingest's role can read the simulator secret, and no other function's role can

#### Scenario: Resend key's grant
- **WHEN** the app template is synthesized
- **THEN** only the reconciler's role can read `ledger/resend-api-key`

### Requirement: The hourly resume schedule
The app stack SHALL hold one hourly resume schedule, flexible window off, no retry, events older than 60 seconds dropped, that sends the worker the resume event (AWS-10, ADR-015). It and the reconcile schedule SHALL be the stack's only two schedules, on one cron expression.

#### Scenario: Schedule settings
- **WHEN** the app template is synthesized
- **THEN** it holds exactly two schedules, both with the same hourly cron, window `OFF` and zero retry attempts, and the resume schedule's target is the worker

### Requirement: The app stack's outputs
The app template SHALL output `DeployedCommit` equal to the commit it was synthesized from, the API URL, the signing-secrets, database and Resend API key secret ARNs, both queue URLs, the worker's function name, and the steady throttle's rate and burst. With the simulator flag, it SHALL also output `SimulatorSecretArn`, and without it, no such output.

#### Scenario: Deployed commit
- **WHEN** the app stack is synthesized for a commit
- **THEN** its `DeployedCommit` output equals that commit

#### Scenario: Resend API key secret output
- **WHEN** the app stack is synthesized
- **THEN** it outputs `ResendApiKeySecretArn`

#### Scenario: Simulator secret output only with the flag
- **WHEN** the app stack is synthesized with and without the simulator flag
- **THEN** `SimulatorSecretArn` is an output only with the flag

### Requirement: Operational alarms email through the alert topic
The app stack SHALL hold three alarms whose one action, on `ALARM` only, is the guardrails alert topic, referenced by a constructed ARN rather than a cross-stack import, each with missing data not breaching (AWS-22): `LedgerApp-queue-age` (source queue oldest-message age, `Maximum` over 300 s, above 900 s), `LedgerApp-dlq-depth` (DLQ visible messages, `Maximum` over 300 s, above 0) and `LedgerApp-api-5xx` (HTTP API `5xx`, `Sum` over 300 s, above 0). The reconcile-gap alarm uses the same topic and action rule.

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
- **THEN** none of the four alarms on the alert topic from the app stack holds an `OKActions` or `InsufficientDataActions` entry, and the template holds no `Fn::ImportValue`

### Requirement: Every alarm describes itself and links its runbook entry
Every alarm in both templates SHALL carry an `AlarmDescription` of one line saying what fired, followed by `Runbook: <runbook base URL>#<slug>`, where the slug is the GitHub anchor of the alarm's runbook heading. No description SHALL hold an ARN, account id, deployed URL or address.

#### Scenario: All five described
- **WHEN** both templates are synthesized with the kill switch on
- **THEN** each of the five alarms of slices 2 and 3 has a description ending with `Runbook: <runbook base URL>#<its name in lowercase>`

#### Scenario: The reconcile-gap description
- **WHEN** the app template is synthesized
- **THEN** `LedgerApp-reconcile-gap`'s description starts `A reconcile run found missing events, or none finished cleanly this hour` and ends with `Runbook: <runbook base URL>#ledgerapp-reconcile-gap`

### Requirement: The simulator secret exists only with the flag
Without the simulator flag, the app stack SHALL hold no simulator secret and ingest SHALL reference none, in its environment or its policy. With it, the stack SHALL hold `ledger/simulator-signing-secret` with no value and no physical name, destroyed with the stack, readable by ingest only, and ingest's environment SHALL name it (ADR-016).

#### Scenario: Adopter default
- **WHEN** the app stack is synthesized without the simulator flag
- **THEN** it holds three secrets, and no `SIMULATOR_SECRET_ARN` appears in ingest's environment or any policy

#### Scenario: Owner's deployment
- **WHEN** the app stack is synthesized with the simulator flag
- **THEN** it holds four secrets, ingest's environment keys are its names object plus `SIMULATOR_SECRET_ARN`, and only ingest's role can read the simulator secret
