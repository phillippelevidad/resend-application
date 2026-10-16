import { App } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { expect, test } from 'vitest';
import { AppStack } from './app.stack.ts';

const template = Template.fromStack(new AppStack(new App(), 'Test'));

// Baseline until slice 2: the template declares no resource of any type, so a deploy of it
// creates nothing (ADR-010). Slice 2 replaces this with one assertion per cost-brake property.
test('the app stack synthesizes with zero resources', () => {
  expect(Object.keys(template.toJSON().Resources ?? {})).toEqual([]);
});
