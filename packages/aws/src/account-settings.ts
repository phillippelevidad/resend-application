import { GetAccountSettingsCommand, type LambdaClient } from '@aws-sdk/client-lambda';
import { LedgerError } from '@ledger/shared';

export type AccountSettings = {
  // The account's regional Lambda concurrency quota.
  readonly concurrentExecutions: number;
};

// D25 step 2, AWS-U05's burst half: `GetAccountSettings` → `AccountLimit.ConcurrentExecutions`. New
// accounts get a reduced, unpublished quota (AWS-16), so the burst reads it before sending.
// Script-only.
export async function readAccountSettings(lambda: LambdaClient): Promise<AccountSettings> {
  const output = await lambda.send(new GetAccountSettingsCommand({}));
  const quota = output.AccountLimit?.ConcurrentExecutions;
  if (quota === undefined || !Number.isInteger(quota) || quota < 0) {
    throw new LedgerError('internal_error', 'The account settings reported no concurrency quota.');
  }
  return { concurrentExecutions: quota };
}
