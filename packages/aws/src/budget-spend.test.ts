// D26, D35: the re-arm's spend read over a stubbed Budgets client. Shape and error names from the
// DescribeBudget API Reference
// (https://docs.aws.amazon.com/aws-cost-management/latest/APIReference/API_budgets_DescribeBudget.html).
import { type BudgetsClient, NotFoundException } from '@aws-sdk/client-budgets';
import { LedgerError } from '@ledger/shared';
import { describe, expect, it } from 'vitest';
import { readBudgetSpend } from './budget-spend.ts';
import { StubClient } from './testing/stub-client.ts';

const metadata = { $metadata: {} };
const budget = { accountId: '123456789012', budgetName: 'LedgerGuardrails-monthly' };

describe('readBudgetSpend', () => {
  it('sends one DescribeBudget and maps ActualSpend and the limit to numbers', async () => {
    const stub = new StubClient().answer('DescribeBudget', () => ({
      Budget: {
        BudgetName: 'LedgerGuardrails-monthly',
        BudgetLimit: { Amount: '50.0', Unit: 'USD' },
        CalculatedSpend: { ActualSpend: { Amount: '12.345', Unit: 'USD' } },
      },
      ...metadata,
    }));

    const spend = await readBudgetSpend(stub.as<BudgetsClient>(), budget);

    expect(stub.sent).toEqual([
      {
        name: 'DescribeBudget',
        input: { AccountId: '123456789012', BudgetName: 'LedgerGuardrails-monthly' },
      },
    ]);
    expect(spend).toEqual({ actual: 12.345, limit: 50, unit: 'USD' });
  });

  it('rejects a budget with no calculated spend yet as a constant internal_error', async () => {
    const stub = new StubClient().answer('DescribeBudget', () => ({
      Budget: {
        BudgetName: 'LedgerGuardrails-monthly',
        BudgetLimit: { Amount: '50', Unit: 'USD' },
      },
      ...metadata,
    }));

    const failure = await readBudgetSpend(stub.as<BudgetsClient>(), budget).catch(
      (caught: unknown) => caught,
    );

    expect(failure).toBeInstanceOf(LedgerError);
    expect((failure as LedgerError).message).not.toContain(budget.accountId);
  });

  it('rejects with the SDK error unchanged when the budget does not exist (NotFoundException)', async () => {
    const stub = new StubClient().answer('DescribeBudget', () => {
      throw new NotFoundException({ message: 'no budget', ...metadata });
    });

    const failure = await readBudgetSpend(stub.as<BudgetsClient>(), budget).catch(
      (caught: unknown) => caught,
    );

    expect((failure as Error).name).toBe('NotFoundException');
  });
});
