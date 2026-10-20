# deploy-and-teardown — spec delta

## ADDED Requirements

### Requirement: Deploy writes the reconciler's key
`pnpm aws:deploy` SHALL pass `LEDGER_DEPLOY_RESEND_WEBHOOK_ID` to the app stack as a deploy input and, after the stack deploy, write `LEDGER_DEPLOY_RESEND_API_KEY` into the Resend API key secret, never through the template, printing `aws:deploy: ledger/resend-api-key written` and never the value. With both unset, it SHALL write no key.

#### Scenario: Reconciler configured
- **WHEN** `pnpm aws:deploy` runs with both variables set
- **THEN** the app stack is synthesized with that webhook id, the secret holds the key afterwards, and the output holds `ledger/resend-api-key written` and not the key

#### Scenario: Reconciler not configured
- **WHEN** `pnpm aws:deploy` runs with neither variable set and no webhook secrets given
- **THEN** no key is written, and the reconciler's webhook id is `unset`

### Requirement: The gap drill
`pnpm aws:gap-drill` SHALL, on the owner's armed and untripped deploy, lower the ingest route throttle to the kill switch's stop value, confirm the route refuses (`429` five times in a row within 60 s, AWS-U16), send one email to `delivered@resend.dev` (RS-39, RS-42), restore the throttle after the grace window and before Resend's next scheduled retry (RS-09), confirm through `ledger email` that none of the send's events is stored, then run a dry run, a real run and a final dry run.

#### Scenario: Refusals before any change
- **WHEN** the drill runs with `LEDGER_URL` not the deployed API URL, a tripped stack, a non-empty queue or DLQ, an unfinished last run, `LEDGER_DEPLOY_RESEND_WEBHOOK_ID` or `RESEND_API_KEY` unset, the minute outside `:02`–`:40`, or an ingest route setting already present
- **THEN** it prints `aws:gap-drill: refused: <reason>`, exits `1`, and changes no throttle and sends nothing

#### Scenario: A failure after the throttle is lowered
- **WHEN** any step after the lower fails on an untripped stack
- **THEN** the ingest route setting is deleted before the drill exits `1`

#### Scenario: The lowered route never refuses
- **WHEN** unsigned probes of the ingest route, one a second after the lower, do not meet `429` five times in a row within 60 s (a throttle update is not instant, AWS-14)
- **THEN** the drill sends nothing, deletes the ingest route setting, and ends `aws:gap-drill: failed: the ingest route never refused`

#### Scenario: A trip during the drill
- **WHEN** the stack is tripped while the drill runs
- **THEN** the drill leaves the route settings to the re-arm and does not delete them

#### Scenario: The recorded run
- **WHEN** the drill runs on the owner's deployment and no other mail reaches the webhook while the route is lowered
- **THEN** it prints `ingest route refusing: 429 x5`, `stored before the reconcile: 0`, `dry run: missing 2`, `reconcile: missing 2 replayed 2 failed 0`, `stored 2 of 2`, `dry run: missing 0`, `gaps: newest run missing 0`, an `events visible after <ms> ms` line and a `created_at unchanged by the replay` line, then `aws:gap-drill: done`

### Requirement: The gap drill's counts
Other mail on the webhook while the route is lowered is refused too, and List Events names no email (RS-14), so `pnpm aws:gap-drill` SHALL fail unless the dry run and the real run each find at least the send's 2 missing, the real run replays every event it found with 0 failed, `ledger email` then stores the send's 2, and the final dry run, repeated every 2 s for up to 120 s, reaches 0.

#### Scenario: Other mail refused alongside the send
- **WHEN** other mail reaches the webhook while the route is lowered
- **THEN** the dry run and the real run report more than 2 missing, the real run replays all of them with 0 failed, `stored 2 of 2` still counts only the send's events, and the drill ends `aws:gap-drill: done` once the final dry run reads 0

#### Scenario: A count mismatch
- **WHEN** the first dry run reports fewer than 2 missing, the real run replays fewer than it found or fails any, `ledger email` holds any of the send's events before the reconcile or fewer than 2 after it, or the final dry run still reads more than 0 after 120 s
- **THEN** the drill restores the throttle and ends `aws:gap-drill: failed: <reason>`

## MODIFIED Requirements

### Requirement: Deploy inputs are asserted first
`pnpm aws:deploy` SHALL refuse before any other step when the direct or pooled database URL or the alert address is missing, when the address-hash key or token-tag key is not 64 lowercase hex, when `LEDGER_SIMULATOR` is neither `on`, `off` nor unset, when it is `on` and `LEDGER_SIMULATOR_SECRET` is not one `whsec_` secret (RS-02), when exactly one of `LEDGER_DEPLOY_RESEND_API_KEY` and `LEDGER_DEPLOY_RESEND_WEBHOOK_ID` is set or the key does not start `re_`, or when `LEDGER_DEPLOY_WEBHOOK_SECRETS` is set without both. The reason SHALL name the variable, never its value, and for a key SHALL add `run pnpm db:setup once to generate it`. The deploy command SHALL never generate a key.

#### Scenario: Missing token-tag key
- **WHEN** `pnpm aws:deploy` runs with `LEDGER_TOKEN_TAG_KEY` unset
- **THEN** it prints `aws:deploy: refused: <reason>` naming `LEDGER_TOKEN_TAG_KEY` and `pnpm db:setup`, exits `1`, and changes no database or stack

#### Scenario: Simulator on without its secret
- **WHEN** `pnpm aws:deploy` runs with `LEDGER_SIMULATOR=on` and `LEDGER_SIMULATOR_SECRET` unset
- **THEN** it prints `aws:deploy: refused: <reason>` naming `LEDGER_SIMULATOR_SECRET`, exits `1`, and makes no AWS call

#### Scenario: Half-configured reconciler
- **WHEN** `pnpm aws:deploy` runs with `LEDGER_DEPLOY_RESEND_API_KEY` set and `LEDGER_DEPLOY_RESEND_WEBHOOK_ID` unset
- **THEN** it prints `aws:deploy: refused: <reason>` naming `LEDGER_DEPLOY_RESEND_WEBHOOK_ID`, exits `1`, and makes no AWS call

#### Scenario: A connected webhook without a reconciler
- **WHEN** `pnpm aws:deploy` runs with `LEDGER_DEPLOY_WEBHOOK_SECRETS` set and neither Resend variable set
- **THEN** it refuses naming `LEDGER_DEPLOY_RESEND_API_KEY`, exits `1`, and makes no AWS call

#### Scenario: A key in the wrong form
- **WHEN** `LEDGER_DEPLOY_RESEND_API_KEY` does not start `re_`
- **THEN** it refuses naming that variable, and no line holds its value

### Requirement: Teardown order and the post-destroy listing
Teardown SHALL destroy the app stack, then the guardrails stack only if that succeeded, then list resources carrying the stack tag, exiting non-zero on any billable leftover. A secret pending deletion SHALL NOT count. It SHALL end by printing the three steps outside AWS: delete the Resend webhook, revoke the Resend API key made for the reconciler, and optionally delete the Neon project.

#### Scenario: App destroy fails
- **WHEN** the app stack's destroy fails
- **THEN** the guardrails stack is not destroyed

#### Scenario: Clean teardown
- **WHEN** both destroys succeed and only secrets pending deletion remain
- **THEN** teardown exits `0` and prints the three outside steps, the reconciler key's revocation among them

### Requirement: Scripted re-arm
`pnpm aws:rearm` SHALL restore from a trip, then warn when the month's actual spend is at or above the budget, then print `then: pnpm -s ledger reconcile`.

#### Scenario: Re-arm over budget
- **WHEN** the re-arm runs while actual spend is at the budget limit
- **THEN** it restores the stack and prints a warning that only the usage trip remains re-armable this month

#### Scenario: The next step
- **WHEN** the re-arm restores the stack
- **THEN** its output holds `then: pnpm -s ledger reconcile` and no `slice 4` text
