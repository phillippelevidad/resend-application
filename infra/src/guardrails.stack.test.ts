import { App } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { expect, test } from 'vitest';
import { GuardrailsStack } from './guardrails.stack.ts';

const template = Template.fromStack(new GuardrailsStack(new App(), 'Test'));

// Baseline until slice 2: the template declares no resource of any type, so a deploy of it
// creates nothing (ADR-010). Slice 2 adds the budget and kill-switch wiring assertions.
test('the guardrails stack synthesizes with zero resources', () => {
  expect(Object.keys(template.toJSON().Resources ?? {})).toEqual([]);
});

test('the guardrails template holds no Fn::ImportValue (aws.md Budget alarms item 1)', () => {
  expect(JSON.stringify(template.toJSON())).not.toContain('Fn::ImportValue');
});
