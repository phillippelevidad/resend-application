// D1, D20, D26: the synchronous invoke over a stubbed Lambda client. `FunctionError` and the error
// payload follow the Invoke API Reference
// (https://docs.aws.amazon.com/lambda/latest/api/API_Invoke.html#API_Invoke_ResponseElements); error
// names from its Errors section.
import {
  type LambdaClient,
  ResourceNotFoundException,
  TooManyRequestsException,
} from '@aws-sdk/client-lambda';
import { LedgerError } from '@ledger/shared';
import { functionInvokePortContract, type InvokedFunction } from '@ledger/shared/testing';
import { describe, expect, it } from 'vitest';
import { LambdaFunctionInvokeAdapter } from './lambda-function-invoke.adapter.ts';
import { StubClient } from './testing/stub-client.ts';

const metadata = { $metadata: {} };
const functionName = 'LedgerApp-worker';
const encode = (value: string): Uint8Array => new TextEncoder().encode(value);
const decode = (payload: unknown): unknown =>
  JSON.parse(new TextDecoder().decode(payload as Uint8Array));

// A Lambda that runs `fn` on the decoded payload, answering as `RequestResponse` does: status 200,
// the result as JSON, or `FunctionError: Unhandled` with an error object (`errorType`,
// `errorMessage`) when the function throws.
const lambdaRunning = (fn: InvokedFunction) =>
  new StubClient().answer('Invoke', async (input) => {
    try {
      const result = await fn(decode(input.Payload));
      return { StatusCode: 200, Payload: encode(JSON.stringify(result)), ...metadata };
    } catch (error) {
      const { name, message } = error as Error;
      return {
        StatusCode: 200,
        FunctionError: 'Unhandled',
        Payload: encode(JSON.stringify({ errorType: name, errorMessage: message })),
        ...metadata,
      };
    }
  });

const invoker = (stub: StubClient) =>
  new LambdaFunctionInvokeAdapter({ client: stub.as<LambdaClient>(), functionName });

describe('LambdaFunctionInvokeAdapter', () => {
  it('sends one RequestResponse Invoke to its function with the payload as JSON', async () => {
    const stub = lambdaRunning(async () => ({ outcome: 'resumed', state: 'enabled' }));

    await expect(invoker(stub).invoke({ ledger: 'resume-event-source' })).resolves.toEqual({
      outcome: 'resumed',
      state: 'enabled',
    });

    expect(stub.sent).toHaveLength(1);
    expect(stub.sent[0]?.name).toBe('Invoke');
    expect(stub.sent[0]?.input).toMatchObject({
      FunctionName: functionName,
      InvocationType: 'RequestResponse',
    });
    expect(decode(stub.sent[0]?.input.Payload)).toEqual({ ledger: 'resume-event-source' });
  });

  it('rejects a FunctionError as a constant internal_error that keeps nothing of the payload', async () => {
    const stub = lambdaRunning(async () => {
      throw new TypeError('worker failed near delivered@resend.dev');
    });

    const failure = await invoker(stub)
      .invoke({})
      .catch((caught: unknown) => caught);

    expect(failure).toBeInstanceOf(LedgerError);
    expect((failure as LedgerError).code).toBe('internal_error');
    expect((failure as LedgerError).message).not.toContain('resend.dev');
    expect((failure as LedgerError).cause).toBeUndefined();
  });

  it.each([
    ['a non-JSON payload', encode('not json')],
    ['no payload', undefined],
  ])('rejects %s as a constant internal_error', async (_case, payload) => {
    const stub = new StubClient().answer('Invoke', () => ({
      StatusCode: 200,
      ...(payload === undefined ? {} : { Payload: payload }),
      ...metadata,
    }));

    const failure = await invoker(stub)
      .invoke({})
      .catch((caught: unknown) => caught);

    expect(failure).toBeInstanceOf(LedgerError);
    expect((failure as LedgerError).code).toBe('internal_error');
  });

  it.each([
    [
      'ResourceNotFoundException',
      () => new ResourceNotFoundException({ message: 'no', ...metadata }),
    ],
    [
      'TooManyRequestsException',
      () => new TooManyRequestsException({ message: 'slow', ...metadata }),
    ],
  ])('rejects with the SDK error unchanged on %s', async (name, error) => {
    const stub = new StubClient().answer('Invoke', () => {
      throw error();
    });

    const failure = await invoker(stub)
      .invoke({})
      .catch((caught: unknown) => caught);

    expect((failure as Error).name).toBe(name);
  });
});

functionInvokePortContract('LambdaFunctionInvokeAdapter', (fn) => invoker(lambdaRunning(fn)));
