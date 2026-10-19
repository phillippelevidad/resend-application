# Spec Delta

## ADDED Requirements

### Requirement: Deploy writes the simulator secret
With `LEDGER_SIMULATOR=on`, `pnpm aws:deploy` SHALL synthesize the app stack with the simulator flag and, after the stack deploy, write `LEDGER_SIMULATOR_SECRET` into the simulator secret only when its value changed, never through the template. With `off` or unset, it SHALL synthesize without the flag and write no simulator secret. It SHALL print `aws:deploy: simulator on` or `aws:deploy: simulator off` after `KillSwitchArmed`, never the value.

#### Scenario: Simulator on
- **WHEN** `pnpm aws:deploy` runs with `LEDGER_SIMULATOR=on` and a valid `LEDGER_SIMULATOR_SECRET`
- **THEN** the app stack is synthesized with the simulator flag, the simulator secret holds that value afterwards, and the output holds `aws:deploy: simulator on` and not the value

#### Scenario: Simulator off by default
- **WHEN** `pnpm aws:deploy` runs with `LEDGER_SIMULATOR` unset
- **THEN** the app stack is synthesized without the simulator flag, no simulator secret is written, and the output holds `aws:deploy: simulator off`

## MODIFIED Requirements

### Requirement: Deploy inputs are asserted first
`pnpm aws:deploy` SHALL refuse before any other step when the direct or pooled database URL or the alert address is missing, when the address-hash key or token-tag key is not 64 lowercase hex, when `LEDGER_SIMULATOR` is neither `on`, `off` nor unset, or when it is `on` and `LEDGER_SIMULATOR_SECRET` is not one `whsec_` secret (RS-02). The reason SHALL name the variable, never its value, and for a key SHALL add `run pnpm db:setup once to generate it`. The deploy command SHALL never generate a key.

#### Scenario: Missing token-tag key
- **WHEN** `pnpm aws:deploy` runs with `LEDGER_TOKEN_TAG_KEY` unset
- **THEN** it prints `aws:deploy: refused: <reason>` naming `LEDGER_TOKEN_TAG_KEY` and `pnpm db:setup`, exits `1`, and changes no database or stack

#### Scenario: Simulator on without its secret
- **WHEN** `pnpm aws:deploy` runs with `LEDGER_SIMULATOR=on` and `LEDGER_SIMULATOR_SECRET` unset
- **THEN** it prints `aws:deploy: refused: <reason>` naming `LEDGER_SIMULATOR_SECRET`, exits `1`, and makes no AWS call
