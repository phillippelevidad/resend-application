import {
  GetEventSourceMappingCommand,
  type LambdaClient,
  ListEventSourceMappingsCommand,
  UpdateEventSourceMappingCommand,
} from '@aws-sdk/client-lambda';
import { type EventSourceState, eventSourceStateFromLambda } from '@ledger/core';
import { type EventSourceControlPort, LedgerError } from '@ledger/shared';

export type LambdaEventSourceControlAdapterDeps = { client: LambdaClient; functionName: string };

// D1, D16, ADR-015: the worker's event source mapping, bound to one function by name. A function
// cannot carry its own mapping's UUID as a variable (a CloudFormation cycle, C5), so the adapter
// finds it with `ListEventSourceMappings` on first use, requires exactly one, and caches the UUID for
// the instance's life (one per container): the mapping is created with the stack and only a stack
// replacement changes it, which also replaces every container. A failed lookup is not cached, so the
// next call retries. `Enabled` pauses and resumes polling from the same place (AWS-18).
export class LambdaEventSourceControlAdapter implements EventSourceControlPort {
  readonly #client: LambdaClient;
  readonly #functionName: string;
  #uuid: string | undefined;

  constructor({ client, functionName }: LambdaEventSourceControlAdapterDeps) {
    this.#client = client;
    this.#functionName = functionName;
  }

  async getState(): Promise<EventSourceState> {
    const mapping = await this.#client.send(
      new GetEventSourceMappingCommand({ UUID: await this.#mappingUuid() }),
    );
    return eventSourceStateFromLambda(mapping.State);
  }

  async enable(): Promise<void> {
    await this.#setEnabled(true);
  }

  async disable(): Promise<void> {
    await this.#setEnabled(false);
  }

  async #setEnabled(enabled: boolean): Promise<void> {
    await this.#client.send(
      new UpdateEventSourceMappingCommand({ UUID: await this.#mappingUuid(), Enabled: enabled }),
    );
  }

  async #mappingUuid(): Promise<string> {
    if (this.#uuid !== undefined) return this.#uuid;
    const listed = await this.#client.send(
      new ListEventSourceMappingsCommand({ FunctionName: this.#functionName }),
    );
    const mappings = listed.EventSourceMappings ?? [];
    // A `NextMarker` means more mappings exist than this page holds: not exactly one either.
    const uuid =
      mappings.length === 1 && listed.NextMarker === undefined ? mappings[0]?.UUID : undefined;
    if (uuid === undefined) {
      throw new LedgerError(
        'internal_error',
        'The worker function does not have exactly one event source mapping.',
      );
    }
    this.#uuid = uuid;
    return uuid;
  }
}
