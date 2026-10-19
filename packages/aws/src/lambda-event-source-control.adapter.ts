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
// the instance's life (one per container). A stack update can replace the mapping without replacing
// a warm container (deploy.ts builds a fresh adapter for that reason), so a cached UUID that answers
// `ResourceNotFoundException` is dropped and the call runs once more on a fresh lookup. A failed
// lookup is not cached, so the next call retries. `Enabled` pauses and resumes polling from the same
// place (AWS-18).
export class LambdaEventSourceControlAdapter implements EventSourceControlPort {
  readonly #client: LambdaClient;
  readonly #functionName: string;
  #uuid: string | undefined;

  constructor({ client, functionName }: LambdaEventSourceControlAdapterDeps) {
    this.#client = client;
    this.#functionName = functionName;
  }

  async getState(): Promise<EventSourceState> {
    const mapping = await this.#onMapping((UUID) =>
      this.#client.send(new GetEventSourceMappingCommand({ UUID })),
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
    await this.#onMapping((UUID) =>
      this.#client.send(new UpdateEventSourceMappingCommand({ UUID, Enabled: enabled })),
    );
  }

  // Runs `call` on the mapping's UUID. A cached UUID the mapping no longer answers to is a replaced
  // mapping: forget it and run once more on a fresh lookup. A UUID just listed is not retried.
  async #onMapping<T>(call: (uuid: string) => Promise<T>): Promise<T> {
    const cached = this.#uuid !== undefined;
    const uuid = await this.#mappingUuid();
    try {
      return await call(uuid);
    } catch (error) {
      if (!cached || (error as Error).name !== 'ResourceNotFoundException') throw error;
      this.#uuid = undefined;
      return call(await this.#mappingUuid());
    }
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
