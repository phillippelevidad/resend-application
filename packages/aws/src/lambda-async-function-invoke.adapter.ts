import { InvokeCommand, type LambdaClient } from '@aws-sdk/client-lambda';
import { type AsyncFunctionInvokePort, LedgerError } from '@ledger/shared';

export type LambdaAsyncFunctionInvokeAdapterDeps = { client: LambdaClient; functionName: string };

// The status Lambda answers when it has queued an `Event` invoke (Lambda Invoke API Reference).
const ACCEPTED = 202;

// Slice 4 D7: an asynchronous invoke of one function (`Event`): the read API → the reconciler's
// manual run (D18). Lambda queues the event and answers `202`; the function's own outcome never
// comes back. Any other status is a constant rejection; a failed call rejects with the SDK's error.
// Retries and the event's age are bounded on the function's invoke config (AWS-63).
export class LambdaAsyncFunctionInvokeAdapter implements AsyncFunctionInvokePort {
  readonly #client: LambdaClient;
  readonly #functionName: string;

  constructor({ client, functionName }: LambdaAsyncFunctionInvokeAdapterDeps) {
    this.#client = client;
    this.#functionName = functionName;
  }

  async invokeAsync(payload: unknown): Promise<void> {
    const output = await this.#client.send(
      new InvokeCommand({
        FunctionName: this.#functionName,
        InvocationType: 'Event',
        Payload: new TextEncoder().encode(JSON.stringify(payload)),
      }),
    );
    if (output.StatusCode !== ACCEPTED) {
      throw new LedgerError('internal_error', 'The asynchronous invoke was not accepted.');
    }
  }
}
