// Slice 4 D7: the asynchronous invoke over a stubbed Lambda client. An `Event` invoke answers
// `StatusCode: 202` once queued, with no function result
// (https://docs.aws.amazon.com/lambda/latest/api/API_Invoke.html#API_Invoke_ResponseElements).
import { type LambdaClient, TooManyRequestsException } from '@aws-sdk/client-lambda';
import { LedgerError } from '@ledger/shared';
import { type AsyncInvokedFunction, asyncFunctionInvokePortContract } from '@ledger/shared/testing';
import { describe, expect, it } from 'vitest';
import { LambdaAsyncFunctionInvokeAdapter } from './lambda-async-function-invoke.adapter.ts';
import { StubClient } from './testing/stub-client.ts';

const metadata = { $metadata: {} };
const functionName = 'LedgerApp-reconciler';
const decode = (payload: unknown): unknown =>
  JSON.parse(new TextDecoder().decode(payload as Uint8Array));

// A Lambda that queues the event: it starts `fn` on the decoded payload without awaiting it, as the
// service runs the function after answering, and answers `202`. A failing function changes nothing.
const lambdaQueueing = (fn: AsyncInvokedFunction) =>
  new StubClient().answer('Invoke', (input) => {
    void Promise.resolve()
      .then(() => fn(decode(input.Payload)))
      .catch(() => {});
    return { StatusCode: 202, ...metadata };
  });

const invoker = (stub: StubClient) =>
  new LambdaAsyncFunctionInvokeAdapter({ client: stub.as<LambdaClient>(), functionName });

describe('LambdaAsyncFunctionInvokeAdapter', () => {
  it('sends one Event Invoke to its function with the payload as JSON', async () => {
    const stub = lambdaQueueing(async () => {});

    await invoker(stub).invokeAsync({ ledger: 'reconcile-run', run_id: 7 });

    expect(stub.sent).toHaveLength(1);
    expect(stub.sent[0]?.name).toBe('Invoke');
    expect(stub.sent[0]?.input).toMatchObject({
      FunctionName: functionName,
      InvocationType: 'Event',
    });
    expect(decode(stub.sent[0]?.input.Payload)).toEqual({ ledger: 'reconcile-run', run_id: 7 });
  });

  it.each([200, 500, undefined])(
    'rejects a %s status as a constant internal_error',
    async (status) => {
      const stub = new StubClient().answer('Invoke', () => ({
        ...(status === undefined ? {} : { StatusCode: status }),
        ...metadata,
      }));

      const failure = await invoker(stub)
        .invokeAsync({})
        .catch((caught: unknown) => caught);

      expect(failure).toBeInstanceOf(LedgerError);
      expect((failure as LedgerError).code).toBe('internal_error');
    },
  );

  it('rejects with the SDK error unchanged when the call fails', async () => {
    const stub = new StubClient().answer('Invoke', () => {
      throw new TooManyRequestsException({ message: 'slow', ...metadata });
    });

    const failure = await invoker(stub)
      .invokeAsync({})
      .catch((caught: unknown) => caught);

    expect((failure as Error).name).toBe('TooManyRequestsException');
  });
});

asyncFunctionInvokePortContract('LambdaAsyncFunctionInvokeAdapter', (fn) =>
  invoker(lambdaQueueing(fn)),
);
