# deploy-and-teardown Specification

## Purpose

Gives the owner one command each to deploy, tear down, re-arm and drill the AWS installation, each
failing closed before it can lose an event, orphan stored hashes, disarm the kill switch or leave a
billable resource behind.

## Requirements

### Requirement: Deploy inputs are asserted first
`pnpm aws:deploy` SHALL refuse before any other step when the direct or pooled database URL or the alert address is missing, or when the address-hash key or token-tag key is not 64 lowercase hex. The reason SHALL name the variable, never its value, and for a key SHALL add `run pnpm db:setup once to generate it`. The deploy command SHALL never generate a key.

#### Scenario: Missing token-tag key
- **WHEN** `pnpm aws:deploy` runs with `LEDGER_TOKEN_TAG_KEY` unset
- **THEN** it prints `aws:deploy: refused: <reason>` naming `LEDGER_TOKEN_TAG_KEY` and `pnpm db:setup`, exits `1`, and changes no database or stack

### Requirement: Deploy refuses an unsafe state before changing anything
Before any migration or stack change, `pnpm aws:deploy` SHALL refuse a working tree with tracked changes, a tripped stack, a deploy that would disarm an armed kill switch, a pending contract step whose SHA is not an ancestor of the `DeployedCommit` the already deployed app stack reports (ADR-018: the code running now must have stopped using the object), and a synthesized template matching the CBL-01 secret pattern. With no app stack deployed, the contract-step check SHALL be skipped.

#### Scenario: Dirty tree
- **WHEN** a tracked file has an uncommitted change
- **THEN** the deploy refuses and runs no later step

#### Scenario: Tripped stack
- **WHEN** the deployed worker's concurrency reads `0`
- **THEN** the deploy refuses with a reason naming `pnpm aws:rearm`

#### Scenario: Disarming deploy
- **WHEN** the deployed `KillSwitchArmed` is `true` and `LEDGER_KILL_SWITCH` is not `on`
- **THEN** the deploy refuses

#### Scenario: Unsafe contract step
- **WHEN** a pending migration is marked `-- contract-step: <SHA>` and that SHA is not an ancestor of the deployed app stack's `DeployedCommit`, even though it is an ancestor of the commit being deployed
- **THEN** the deploy refuses before migrating

#### Scenario: Contract step on a first deploy
- **WHEN** a pending migration carries a contract-step marker and no app stack is deployed yet
- **THEN** the contract-step check is skipped and the deploy continues

#### Scenario: A secret in the template
- **WHEN** the synthesized output matches `whsec_`, `re_` followed by eight key characters, a Postgres URL or an `ldg_` token
- **THEN** the deploy refuses before migrating

### Requirement: Deploy refuses a mismatched address-hash key
After migrating and before writing the key anywhere, `pnpm aws:deploy` SHALL refuse when the database holds address hashes whose `key_id` prefix differs from the given key's (data-modeling.md → PII & retention).

#### Scenario: Fresh key against stored hashes
- **WHEN** the database holds hashes made under one key and the deploy is given another
- **THEN** it prints `aws:deploy: refused: <reason>` naming the `key_id` check, and no stack is deployed and no secret written

#### Scenario: Empty database
- **WHEN** the database holds no hash
- **THEN** the check passes

### Requirement: Deploy refuses a changed token tag key
Before migrating and before any stack change or secret write, `pnpm aws:deploy` SHALL refuse when the deployed `ledger/database` secret holds a token tag key whose id differs from `LEDGER_TOKEN_TAG_KEY`'s, because the new key would fail every stored token's tag check and the deploy issues no second bootstrap token. It SHALL compare key ids only and print neither key.

#### Scenario: New tag key against the deployed secret
- **WHEN** the deployed secret holds one tag key and the deploy is given another
- **THEN** it prints `aws:deploy: refused: <reason>` naming `LEDGER_TOKEN_TAG_KEY` and restoring the deployed key in `.env.local`, and nothing is migrated, no stack is deployed and no secret written

#### Scenario: First deploy
- **WHEN** no app stack is deployed, or the deployed secret holds no tag key yet
- **THEN** the check passes

### Requirement: Deploy order
`pnpm aws:deploy` SHALL migrate through the direct URL with the runtime role's timeouts, then deploy the guardrails stack, then the app stack, then write each secret only when its value changed, then issue the bootstrap token, and SHALL print the API URL, the ingest URL and `KillSwitchArmed`, never a secret value.

#### Scenario: Guardrails first
- **WHEN** a deploy succeeds
- **THEN** the guardrails stack was deployed before the app stack

#### Scenario: Secrets written by the command
- **WHEN** `LEDGER_DEPLOY_WEBHOOK_SECRETS` is set
- **THEN** the signing-secrets secret holds that set after the deploy, and the value never passed through the template

### Requirement: First token printed once
The deploy command SHALL print the bootstrap `operate` token only on the run that inserts it. `--issue-operate-token <name>` SHALL insert and print one more `operate` token.

#### Scenario: Re-run deploy
- **WHEN** `pnpm aws:deploy` runs again against the same database
- **THEN** no second bootstrap row is inserted and no token is printed

#### Scenario: Extra operate token
- **WHEN** it runs with `--issue-operate-token walk-operate`
- **THEN** it prints one new `operate` token

### Requirement: Deploy restores a paused event source
When the worker's event source was paused before the deploy, the deploy SHALL leave it paused afterwards, also when the stack deploy fails after starting (AWS-U09).

#### Scenario: Paused before deploy
- **WHEN** the worker's event source is paused and a deploy runs
- **THEN** the event source is paused after the deploy

#### Scenario: Stack deploy fails
- **WHEN** the app stack deploy fails after starting
- **THEN** the recorded pause is still restored

### Requirement: Teardown refuses to discard queued events
`pnpm aws:teardown` SHALL refuse when the source queue or the DLQ holds any visible or in-flight message, unless `--discard-queued` is given.

#### Scenario: Non-empty queue
- **WHEN** the source queue holds one message and teardown runs without the flag
- **THEN** it refuses and destroys nothing

### Requirement: Teardown order and the post-destroy listing
Teardown SHALL destroy the app stack, then the guardrails stack only if that succeeded, then list resources carrying the stack tag, exiting non-zero on any billable leftover. A secret pending deletion SHALL NOT count. It SHALL end by printing the two steps outside AWS: delete the Resend webhook, and optionally the Neon project.

#### Scenario: App destroy fails
- **WHEN** the app stack's destroy fails
- **THEN** the guardrails stack is not destroyed

#### Scenario: Clean teardown
- **WHEN** both destroys succeed and only secrets pending deletion remain
- **THEN** teardown exits `0` and prints the two outside steps

### Requirement: Scripted re-arm
`pnpm aws:rearm` SHALL restore from a trip, then warn when the month's actual spend is at or above the budget, then print `then: ledger reconcile → slice 4`.

#### Scenario: Re-arm over budget
- **WHEN** the re-arm runs while actual spend is at the budget limit
- **THEN** it restores the stack and prints a warning that only the usage trip remains re-armable this month

### Requirement: Recorded trip drill
`pnpm aws:trip-drill` SHALL refuse unless the kill switch is armed and the stack is not tripped; it SHALL then force the usage-trip alarm, wait for the tripped state, record the status codes of five unsigned ingest requests, force a kill-switch failure until its `Errors` alarm fires, restore, and print a summary with no id or URL.

#### Scenario: Disarmed stack
- **WHEN** the drill runs while `KillSwitchArmed` is `false`
- **THEN** it refuses and changes nothing

#### Scenario: Drill passes
- **WHEN** the drill runs on an armed, untripped stack
- **THEN** it reports the trip reached, the five status codes, the `Errors` alarm in `ALARM`, and the stack restored

### Requirement: Database check through the pooled URL
`pnpm aws:db-check --email-id <id>` SHALL report the runtime role's `idle_in_transaction_session_timeout` and `lock_timeout` as read through the pooled URL, and whether two transactions locking that email serialize; with `--idle-minutes <n>`, it SHALL also report whether a connection idle that long still answers. It SHALL write nothing.

#### Scenario: Settings through the pooler
- **WHEN** the check runs against the deployed database
- **THEN** it prints both settings next to their expected values, `5s` and `10s`

#### Scenario: Serialized lock
- **WHEN** the second transaction waits for the first to commit
- **THEN** the check reports the lock as serialized

### Requirement: Script output carries no secret
Every `pnpm aws:*` line SHALL be prefixed with its script name and end with `<script>: done`, `<script>: refused: <constant reason>` or `<script>: failed: <constant reason>`, the last two exiting `1`. No line SHALL print a secret, key, database URL or account id; only the deploy command prints a token, once.

#### Scenario: A failed script
- **WHEN** any `pnpm aws:*` script fails
- **THEN** its last line is `<script>: failed: <reason>`, it exits `1`, and no line holds a secret value
