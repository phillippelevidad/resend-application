import { describe, expect, it } from 'vitest';
import {
  eventSourceStateFromLambda,
  eventSourceStateSchema,
  eventSourceStates,
} from './event-source-states.ts';

describe('eventSourceStateSchema', () => {
  it.each(eventSourceStates)('accepts %s, so health can report it', (state) => {
    expect(eventSourceStateSchema.parse(state)).toBe(state);
  });

  it("rejects Lambda's raw Enabled, so an unmapped state never reaches the wire", () => {
    expect(eventSourceStateSchema.safeParse('Enabled').success).toBe(false);
  });
});

describe('eventSourceStateFromLambda (AWS-18)', () => {
  it.each([
    ['Enabled', 'enabled'],
    ['Disabled', 'paused'],
    ['Updating', 'changing'],
    ['Creating', 'changing'],
    ['Enabling', 'changing'],
    ['Disabling', 'changing'],
    [undefined, 'changing'],
  ] as const)('maps the mapping state %s to %s', (lambdaState, expected) => {
    expect(eventSourceStateFromLambda(lambdaState)).toBe(expected);
  });
});
