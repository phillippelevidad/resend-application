import { type BudgetsClient, DescribeBudgetCommand } from '@aws-sdk/client-budgets';
import { LedgerError } from '@ledger/shared';

export type BudgetSpend = {
  readonly actual: number;
  readonly limit: number;
  // The currency both amounts are in (`USD`).
  readonly unit: string;
};

// D26, D35: the re-arm reads the month's actual spend from the budget itself (`DescribeBudget` →
// `CalculatedSpend.ActualSpend`) and warns when it is at or above the limit, because the budget does
// not trip again that month (AWS-34). Script-only. `DescribeBudget` needs the account id, which the
// caller takes from a stack output's ARN; it is never printed. AWS-U10 (what this read costs) is
// settled by the re-arm's own task, not here.
export async function readBudgetSpend(
  client: BudgetsClient,
  budget: { accountId: string; budgetName: string },
): Promise<BudgetSpend> {
  const output = await client.send(
    new DescribeBudgetCommand({ AccountId: budget.accountId, BudgetName: budget.budgetName }),
  );
  const actual = output.Budget?.CalculatedSpend?.ActualSpend;
  const limit = output.Budget?.BudgetLimit;
  const actualAmount = Number(actual?.Amount);
  const limitAmount = Number(limit?.Amount);
  if (
    actual?.Amount === undefined ||
    limit?.Amount === undefined ||
    !Number.isFinite(actualAmount) ||
    !Number.isFinite(limitAmount)
  ) {
    throw new LedgerError('internal_error', 'The budget reported no actual spend or limit.');
  }
  return { actual: actualAmount, limit: limitAmount, unit: limit.Unit ?? actual.Unit ?? 'USD' };
}
