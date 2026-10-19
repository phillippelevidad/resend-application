# Spec Delta

## ADDED Requirements

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
- **THEN** they hold five standard alarms between them, within AWS-28's ten

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

### Requirement: The app stack's outputs
The app template SHALL output `DeployedCommit` equal to the commit it was synthesized from, the API URL, both secret ARNs, both queue URLs, the worker's function name, and the steady throttle's rate and burst. With the simulator flag, it SHALL also output `SimulatorSecretArn`, and without it, no such output.

#### Scenario: Deployed commit
- **WHEN** the app stack is synthesized for a commit
- **THEN** its `DeployedCommit` output equals that commit

#### Scenario: Simulator secret output only with the flag
- **WHEN** the app stack is synthesized with and without the simulator flag
- **THEN** `SimulatorSecretArn` is an output only with the flag
