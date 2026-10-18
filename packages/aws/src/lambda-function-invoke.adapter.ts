import { InvokeCommand, type LambdaClient } from '@aws-sdk/client-lambda';
import { type FunctionInvokePort, LedgerError } from '@ledger/shared';

export type LambdaFunctionInvokeAdapterDeps = { client: LambdaClient; functionName: string };

// D1, D26: a synchronous invoke of one function (`RequestResponse`): the read API → the worker's
// resume (D20). The payload and the result are JSON. A function error arrives as a successful call
// carrying `FunctionError` and an error object as its payload (Lambda Invoke API Reference), so it is
// turned into a constant rejection here; the error object can quote the function's own message, so
// none of it is kept. A payload that is not JSON is a constant rejection too. A failed call rejects
// with the SDK's own error.
export class LambdaFunctionInvokeAdapter implements FunctionInvokePort {
  readonly #client: LambdaClient;
  readonly #functionName: string;

  constructor({ client, functionName }: LambdaFunctionInvokeAdapterDeps) {
    this.#client = client;
    this.#functionName = functionName;
  }

  async invoke(payload: unknown): Promise<unknown> {
    const output = await this.#client.send(
      new InvokeCommand({
        FunctionName: this.#functionName,
        InvocationType: 'RequestResponse',
        Payload: new TextEncoder().encode(JSON.stringify(payload)),
      }),
    );
    if (output.FunctionError !== undefined) {
      throw new LedgerError('internal_error', 'The invoked function returned an error.');
    }
    try {
      return JSON.parse(new TextDecoder().decode(output.Payload)) as unknown;
    } catch {
      throw new LedgerError('internal_error', 'The invoked function returned a non-JSON result.');
    }
  }
}
