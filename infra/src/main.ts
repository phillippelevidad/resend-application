import { loadConfig } from '@ledger/shared';
import { App, Tags } from 'aws-cdk-lib';
import { AppStack } from './app.stack.ts';
import { GuardrailsStack } from './guardrails.stack.ts';
import { infraConfigSchema, infraContextKeys } from './infra.config.ts';

// Composition root of the CDK app (ADR-010). It reads the deploy inputs from CDK context once,
// parses them (infra.config.ts) and hands the stacks literal props: stacks never read context or the
// environment, so a test passes literals. Both stacks are environment-agnostic: no account in code
// or template, and region comes from the deploying credentials (CBL-10).
const app = new App();

const context: Record<string, string | undefined> = {};
for (const key of Object.values(infraContextKeys)) {
  const value: unknown = app.node.tryGetContext(key);
  context[key] = value === undefined ? undefined : String(value);
}
const config = loadConfig(infraConfigSchema, context);

// The stack names are fixed: functions, the HTTP API and the topics derive their physical names
// from them, which is how each stack finds the other's resources without a reference
// (aws.md → Budget alarms item 1).
const APP_STACK_NAME = 'LedgerApp';
const GUARDRAILS_STACK_NAME = 'LedgerGuardrails';

new GuardrailsStack(app, GUARDRAILS_STACK_NAME, {
  appStackName: APP_STACK_NAME,
  budgetUsd: config.budgetUsd,
  killSwitch: config.killSwitch,
  budgetDrill: config.budgetDrill,
  alertEmail: config.alertEmail,
});
new AppStack(app, APP_STACK_NAME, {
  commit: config.commit,
  guardrailsStackName: GUARDRAILS_STACK_NAME,
});

// aws.md → Teardown: the one project tag the post-destroy listing filters on (D27).
Tags.of(app).add('ledger-project', 'ledger');

app.synth();
