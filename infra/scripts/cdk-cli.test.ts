import { describe, expect, it } from 'vitest';
import { loggedArgs } from './cdk-cli.ts';

describe('loggedArgs', () => {
  it('leaves the alert address out together with its -c, and keeps every other context pair', () => {
    expect(
      loggedArgs([
        'synth',
        '-c',
        'ledger:commit=abc',
        '-c',
        'ledger:alertEmail=owner@example.invalid',
        '-c',
        'ledger:budgetUsd=50',
      ]),
    ).toEqual(['synth', '-c', 'ledger:commit=abc', '-c', 'ledger:budgetUsd=50']);
  });
});
