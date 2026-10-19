// D27 step 3: the recycle over a stubbed Lambda client whose `LastUpdateStatus` runs through a script.
// Status values from the FunctionConfiguration reference
// (https://docs.aws.amazon.com/lambda/latest/api/API_FunctionConfiguration.html): Successful, Failed,
// InProgress. Error names from UpdateFunctionConfiguration's Errors section
// (https://docs.aws.amazon.com/lambda/latest/api/API_UpdateFunctionConfiguration.html#API_UpdateFunctionConfiguration_Errors).
import { type LambdaClient, ResourceConflictException } from '@aws-sdk/client-lambda';
import { LedgerError } from '@ledger/shared';
import { FakeClock } from '@ledger/shared/testing';
import { describe, expect, it } from 'vitest';
import { FUNCTION_RECYCLE_POLL_MS, recycleFunction } from './function-recycle.ts';
import { StubClient } from './testing/stub-client.ts';

const metadata = { $metadata: {} };
const functionName = 'LedgerApp-worker';
const description = 'ledger-sim db-outage sim-ns';

// `GetFunctionConfiguration` answers each status in turn, the last one forever.
const lambdaReading = (...statuses: string[]) => {
  let polls = 0;
  return new StubClient()
    .answer('UpdateFunctionConfiguration', (input) => ({
      FunctionName: input.FunctionName,
      LastUpdateStatus: 'InProgress',
      ...metadata,
    }))
    .answer('GetFunctionConfiguration', (input) => {
      const status = statuses[Math.min(polls, statuses.length - 1)];
      polls += 1;
      return { FunctionName: input.FunctionName, LastUpdateStatus: status, ...metadata };
    });
};

// A fake clock whose sleep advances it, so a wait runs instantly.
const fakeTime = () => {
  const clock = new FakeClock();
  return { clock, sleep: async (ms: number) => clock.advance(ms) };
};

const failureOf = (promise: Promise<unknown>): Promise<unknown> =>
  promise.then(
    () => undefined,
    (caught: unknown) => caught,
  );

describe('recycleFunction', () => {
  it('updates the Description, then polls until LastUpdateStatus reads Successful', async () => {
    const lambda = lambdaReading('InProgress', 'InProgress', 'Successful');
    const time = fakeTime();
    const started = time.clock.now().getTime();

    await recycleFunction(lambda.as<LambdaClient>(), functionName, description, time);

    expect(lambda.sent).toEqual([
      {
        name: 'UpdateFunctionConfiguration',
        input: { FunctionName: functionName, Description: description },
      },
      { name: 'GetFunctionConfiguration', input: { FunctionName: functionName } },
      { name: 'GetFunctionConfiguration', input: { FunctionName: functionName } },
      { name: 'GetFunctionConfiguration', input: { FunctionName: functionName } },
    ]);
    expect(time.clock.now().getTime() - started).toBe(2 * FUNCTION_RECYCLE_POLL_MS);
  });

  it('clears the Description with an empty string, as the restore does', async () => {
    const lambda = lambdaReading('Successful');

    await recycleFunction(lambda.as<LambdaClient>(), functionName, '', fakeTime());

    expect(lambda.inputs('UpdateFunctionConfiguration')).toEqual([
      { FunctionName: functionName, Description: '' },
    ]);
  });

  it('throws a constant internal_error when the update reads Failed, and stops polling', async () => {
    const lambda = lambdaReading('InProgress', 'Failed');

    const failure = await failureOf(
      recycleFunction(lambda.as<LambdaClient>(), functionName, description, fakeTime()),
    );

    expect(failure).toBeInstanceOf(LedgerError);
    expect((failure as LedgerError).code).toBe('internal_error');
    expect(lambda.inputs('GetFunctionConfiguration')).toHaveLength(2);
  });

  it('throws a constant internal_error once the bound runs out while InProgress', async () => {
    const lambda = lambdaReading('InProgress');
    const time = fakeTime();

    const failure = await failureOf(
      recycleFunction(lambda.as<LambdaClient>(), functionName, description, {
        ...time,
        timeoutMs: 5_000,
      }),
    );

    expect(failure).toBeInstanceOf(LedgerError);
    expect((failure as LedgerError).code).toBe('internal_error');
    // One poll at the start and one after each of the five 1 s sleeps.
    expect(lambda.inputs('GetFunctionConfiguration')).toHaveLength(6);
  });

  it('rejects with the SDK error unchanged when the update is refused (ResourceConflictException)', async () => {
    const error = new ResourceConflictException({ message: 'x', ...metadata });
    const lambda = lambdaReading('Successful').answer('UpdateFunctionConfiguration', () => {
      throw error;
    });

    expect(
      await failureOf(
        recycleFunction(lambda.as<LambdaClient>(), functionName, description, fakeTime()),
      ),
    ).toBe(error);
    expect(lambda.names()).not.toContain('GetFunctionConfiguration');
  });
});
