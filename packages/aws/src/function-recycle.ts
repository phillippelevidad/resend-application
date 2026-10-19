import { setTimeout as sleepFor } from 'node:timers/promises';
import {
  GetFunctionConfigurationCommand,
  type LambdaClient,
  UpdateFunctionConfigurationCommand,
} from '@aws-sdk/client-lambda';
import { type ClockPort, LedgerError } from '@ledger/shared';

// D27 step 3: how long a recycle waits for the update to land before it fails the run. No page states
// how long a configuration update takes; the bound is where the run stops waiting, not an estimate.
export const FUNCTION_RECYCLE_TIMEOUT_MS = 120_000;
// One `GetFunctionConfiguration` per poll.
export const FUNCTION_RECYCLE_POLL_MS = 1_000;

// The wait's budget and the time it reads and sleeps through; a test passes a fake clock and a sleep
// that advances it.
export type FunctionRecycleWait = {
  readonly timeoutMs: number;
  readonly clock: ClockPort;
  readonly sleep: (ms: number) => Promise<void>;
};

const systemClock: ClockPort = { now: () => new Date() };
const realSleep = (ms: number): Promise<void> => sleepFor(ms);

// D27 step 3: recycle a function by updating its `Description` (`UpdateFunctionConfiguration`), then
// poll `GetFunctionConfiguration` until `LastUpdateStatus` reads `Successful`. `Failed`, or the bound
// running out while it reads `InProgress`, throws. The template sets no description, so the update is
// cosmetic drift the next deploy erases. Whether it sends later invocations to new execution
// environments is AWS-U15. Script-only.
export async function recycleFunction(
  lambda: LambdaClient,
  functionName: string,
  description: string,
  wait: Partial<FunctionRecycleWait> = {},
): Promise<void> {
  const clock = wait.clock ?? systemClock;
  const sleep = wait.sleep ?? realSleep;
  const deadline = clock.now().getTime() + (wait.timeoutMs ?? FUNCTION_RECYCLE_TIMEOUT_MS);
  await lambda.send(
    new UpdateFunctionConfigurationCommand({
      FunctionName: functionName,
      Description: description,
    }),
  );
  for (;;) {
    const configuration = await lambda.send(
      new GetFunctionConfigurationCommand({ FunctionName: functionName }),
    );
    if (configuration.LastUpdateStatus === 'Successful') return;
    if (configuration.LastUpdateStatus === 'Failed') {
      throw new LedgerError('internal_error', "The function's configuration update failed.");
    }
    const remaining = deadline - clock.now().getTime();
    if (remaining <= 0) {
      throw new LedgerError(
        'internal_error',
        "The function's configuration update did not finish in time.",
      );
    }
    await sleep(Math.min(FUNCTION_RECYCLE_POLL_MS, remaining));
  }
}
