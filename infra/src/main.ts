import { App } from 'aws-cdk-lib';
import { AppStack } from './app.stack.ts';
import { GuardrailsStack } from './guardrails.stack.ts';

// Composition root of the CDK app (ADR-010). Deploy inputs (infra.config.ts) and the project tag
// land in slice 2. Both stacks are environment-agnostic: no account in code or template (CBL-10).
const app = new App();

new GuardrailsStack(app, 'LedgerGuardrails');
new AppStack(app, 'LedgerApp');

app.synth();
