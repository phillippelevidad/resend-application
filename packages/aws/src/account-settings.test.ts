// D25 step 2: the account's concurrency quota over a stubbed Lambda client. Fields from the
// GetAccountSettings reference
// (https://docs.aws.amazon.com/lambda/latest/api/API_GetAccountSettings.html).
import { type LambdaClient, TooManyRequestsException } from '@aws-sdk/client-lambda';
import { LedgerError } from '@ledger/shared';
import { describe, expect, it } from 'vitest';
import { readAccountSettings } from './account-settings.ts';
import { StubClient } from './testing/stub-client.ts';

const metadata = { $metadata: {} };

const failureOf = (promise: Promise<unknown>): Promise<unknown> =>
  promise.then(
    () => undefined,
    (caught: unknown) => caught,
  );

describe('readAccountSettings', () => {
  it('sends one GetAccountSettings and maps AccountLimit.ConcurrentExecutions', async () => {
    const lambda = new StubClient().answer('GetAccountSettings', () => ({
      AccountLimit: { ConcurrentExecutions: 50, UnreservedConcurrentExecutions: 50 },
      AccountUsage: { FunctionCount: 5 },
      ...metadata,
    }));

    expect(await readAccountSettings(lambda.as<LambdaClient>())).toEqual({
      concurrentExecutions: 50,
    });
    expect(lambda.sent).toEqual([{ name: 'GetAccountSettings', input: {} }]);
  });

  it('rejects an answer without the quota as a constant internal_error', async () => {
    const lambda = new StubClient().answer('GetAccountSettings', () => ({
      AccountLimit: {},
      ...metadata,
    }));

    const failure = await failureOf(readAccountSettings(lambda.as<LambdaClient>()));

    expect(failure).toBeInstanceOf(LedgerError);
    expect((failure as LedgerError).code).toBe('internal_error');
  });

  it('rejects with the SDK error unchanged (TooManyRequestsException)', async () => {
    const error = new TooManyRequestsException({ message: 'x', ...metadata });
    const lambda = new StubClient().answer('GetAccountSettings', () => {
      throw error;
    });

    expect(await failureOf(readAccountSettings(lambda.as<LambdaClient>()))).toBe(error);
  });
});
