import { z } from 'zod';
import { DEFAULT_BUDGET_USD } from './guardrails.stack.ts';

// pp-infra → env-and-inputs → Deploy inputs, D33: the CDK context keys the deploy command passes as
// `-c key=value`, never from `cdk.json` or any tracked file (CBL-10). Parsed once by `main.ts`; a
// failure names the key, never the value. `pnpm synth` passes none, so every key has a default.
export const infraContextKeys = {
  commit: 'ledger:commit',
  alertEmail: 'ledger:alertEmail',
  budgetUsd: 'ledger:budgetUsd',
  killSwitch: 'ledger:killSwitch',
  budgetDrill: 'ledger:budgetDrill',
  simulator: 'ledger:simulator',
  // Slice 4 D21: the Resend webhook id the reconciler lists and replays.
  resendWebhookId: 'ledger:resendWebhookId',
} as const;

// Slice 4 D21: what the reconciler reads as no webhook configured; its runs then end
// `reconciler_not_configured`.
export const UNSET_WEBHOOK_ID = 'unset';

// A synth without a commit exports `unset`, which no `git merge-base --is-ancestor` accepts, so a
// deploy built from it refuses every contract step (D33 step 4, fail closed).
export const UNSET_COMMIT = 'unset';

export const infraConfigSchema = z
  .object({
    [infraContextKeys.commit]: z
      .string()
      .regex(/^[0-9a-f]{40}$/, { error: 'must be a full 40-hex commit SHA' })
      .default(UNSET_COMMIT),
    // aws.md → Budget alarms item 3: never committed; the synthesized template holds it, so
    // `cdk.out/` stays git-ignored (CBL-19).
    [infraContextKeys.alertEmail]: z.email({ error: 'must be an email address' }).optional(),
    // Item 2: the cap, in USD.
    [infraContextKeys.budgetUsd]: z.coerce
      .number({ error: 'must be a positive number' })
      .positive({ error: 'must be a positive number' })
      .default(DEFAULT_BUDGET_USD),
    // Item 5: off by default; the owner's deployment sets it on.
    [infraContextKeys.killSwitch]: z
      .enum(['on', 'off'], { error: 'must be on or off' })
      .default('off'),
    // D36: the drill budget, only while the budget part of the trip drill runs.
    [infraContextKeys.budgetDrill]: z
      .enum(['true', 'false'], { error: 'must be true or false' })
      .default('false'),
    // Slice 3, D11, D12: the simulator secret, only in the owner's deployment (ADR-016).
    [infraContextKeys.simulator]: z
      .enum(['true', 'false'], { error: 'must be true or false' })
      .default('false'),
    // Slice 4 D21, D29: an id, never a secret; `pnpm synth` passes none.
    [infraContextKeys.resendWebhookId]: z
      .string()
      .min(1, { error: 'must be a webhook id' })
      .default(UNSET_WEBHOOK_ID),
  })
  .transform((context) => ({
    commit: context[infraContextKeys.commit],
    alertEmail: context[infraContextKeys.alertEmail],
    budgetUsd: context[infraContextKeys.budgetUsd],
    killSwitch: context[infraContextKeys.killSwitch] === 'on',
    budgetDrill: context[infraContextKeys.budgetDrill] === 'true',
    simulator: context[infraContextKeys.simulator] === 'true',
    resendWebhookId: context[infraContextKeys.resendWebhookId],
  }));

export type InfraConfig = z.output<typeof infraConfigSchema>;
