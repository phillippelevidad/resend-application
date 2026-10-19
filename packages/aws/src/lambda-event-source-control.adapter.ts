import { setTimeout as sleepFor } from 'node:timers/promises';
import {
  GetEventSourceMappingCommand,
  type LambdaClient,
  ListEventSourceMappingsCommand,
  UpdateEventSourceMappingCommand,
} from '@aws-sdk/client-lambda';
import { type EventSourceState, eventSourceStateFromLambda } from '@ledger/core';
import { type ClockPort, type EventSourceControlPort, LedgerError } from '@ledger/shared';

// D16, D29: how long `enable` and `disable` wait out a mapping in transition before they rethrow.
// 10 s fits every caller that keeps the default: the worker's outage pause runs after D27's 40 s
// bound inside its 60 s timeout, and its resume answers the read API's synchronous invoke inside the
// API's 25 s timeout (D20) with a healthy probe taking a second or two. The kill switch passes its own
// (`KILL_SWITCH_SETTLE_TIMEOUT_MS`).
export const EVENT_SOURCE_SETTLE_TIMEOUT_MS = 10_000;
// One `GetEventSourceMapping` and one `UpdateEventSourceMapping` per poll at most.
export const EVENT_SOURCE_SETTLE_POLL_MS = 1_000;

// The wait's budget and the time it reads and sleeps through; a test passes a fake clock and a sleep
// that advances it.
export type EventSourceSettle = {
  readonly timeoutMs: number;
  readonly clock: ClockPort;
  readonly sleep: (ms: number) => Promise<void>;
};

export type LambdaEventSourceControlAdapterDeps = {
  client: LambdaClient;
  functionName: string;
  settle?: Partial<EventSourceSettle>;
};

const systemClock: ClockPort = { now: () => new Date() };
const realSleep = (ms: number): Promise<void> => sleepFor(ms);

// The UpdateEventSourceMapping errors a transition raises: `ResourceInUseException` ("The operation
// conflicts with the resource's availability") and `ResourceConflictException` ("another operation is
// in progress"), per the API Reference's Errors section (lambda/API_UpdateEventSourceMapping).
const TRANSITION_ERRORS: ReadonlySet<string> = new Set([
  'ResourceInUseException',
  'ResourceConflictException',
]);

// D1, D16, ADR-015: the worker's event source mapping, bound to one function by name. A function
// cannot carry its own mapping's UUID as a variable (a CloudFormation cycle, C5), so the adapter
// finds it with `ListEventSourceMappings` on first use, requires exactly one, and caches the UUID for
// the instance's life (one per container). A stack update can replace the mapping without replacing
// a warm container (deploy.ts builds a fresh adapter for that reason), so a cached UUID that answers
// `ResourceNotFoundException` is dropped and the call runs once more on a fresh lookup. A failed
// lookup is not cached, so the next call retries. `Enabled` pauses and resumes polling from the same
// place (AWS-18). A mapping mid-transition (`Enabling`, `Disabling`, `Updating`, `Creating`) refuses
// the update, so `enable` and `disable` wait it out within `settle.timeoutMs` (D16, D29): poll, stop
// once the mapping settled at the target, update once it settled elsewhere, and rethrow the SDK error
// unchanged when the budget runs out.
export class LambdaEventSourceControlAdapter implements EventSourceControlPort {
  readonly #client: LambdaClient;
  readonly #functionName: string;
  readonly #settle: EventSourceSettle;
  #uuid: string | undefined;

  constructor({ client, functionName, settle = {} }: LambdaEventSourceControlAdapterDeps) {
    this.#client = client;
    this.#functionName = functionName;
    this.#settle = {
      timeoutMs: settle.timeoutMs ?? EVENT_SOURCE_SETTLE_TIMEOUT_MS,
      clock: settle.clock ?? systemClock,
      sleep: settle.sleep ?? realSleep,
    };
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
    const target: EventSourceState = enabled ? 'enabled' : 'paused';
    const { clock, sleep, timeoutMs } = this.#settle;
    const deadline = clock.now().getTime() + timeoutMs;
    for (;;) {
      try {
        await this.#onMapping((UUID) =>
          this.#client.send(new UpdateEventSourceMappingCommand({ UUID, Enabled: enabled })),
        );
        return;
      } catch (error) {
        const remaining = deadline - clock.now().getTime();
        if (!TRANSITION_ERRORS.has((error as Error).name) || remaining <= 0) throw error;
        await sleep(Math.min(EVENT_SOURCE_SETTLE_POLL_MS, remaining));
      }
      // The transition may have ended at the target (the worker paused itself, a resume landed), so
      // a settled mapping already there is left alone.
      if ((await this.getState()) === target) return;
    }
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
