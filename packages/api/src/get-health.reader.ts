import { type EventSourceState, errorRegistry } from '@ledger/core';
import { classifyDatabaseError, databaseRepository, type Executor } from '@ledger/db';
import {
  type EventSourceControlPort,
  LedgerError,
  type QueueAttributesPort,
  type QueueSnapshot,
} from '@ledger/shared';

// `verified: false` is the auth middleware's outage mark: its token lookup already found the
// database unreachable (D18).
export type GetHealthInput = { verified: boolean };

// The read shape `healthResponseMapper` turns into the wire object.
export type HealthRead = {
  queue: QueueSnapshot;
  eventSourceState: EventSourceState;
  // `null` when the database is unreachable.
  storageBytes: number | null;
  storageLimitBytes: number;
};

export type GetHealthReaderDeps = {
  db: Executor;
  queueAttributes: QueueAttributesPort;
  eventSource: EventSourceControlPort;
  storageLimitBytes: number;
};

// `health.get` (api-contract.md, D19): the queue and event-source fields from their ports, the
// storage from Postgres. A database outage is reported, never a failed response; an AWS read error
// propagates to `onError`'s `500 internal_error` (v0: no partial answer, PP §3).
export class GetHealthReader {
  readonly #deps: GetHealthReaderDeps;

  constructor(deps: GetHealthReaderDeps) {
    this.#deps = deps;
  }

  async execute(input: GetHealthInput): Promise<HealthRead> {
    const { queueAttributes, eventSource, storageLimitBytes } = this.#deps;
    // Raised as `internal_error` with the AWS error as `cause`, so `onError` answers `500` as D19
    // says. Left raw, an SDK socket error (`ECONNRESET`, `ENOTFOUND`) would match the database
    // classifier and answer `503 database_unavailable`, a status this route does not declare.
    const [queue, eventSourceState] = await Promise.all([
      queueAttributes.read(),
      eventSource.getState(),
    ]).catch((err: unknown) => {
      throw new LedgerError('internal_error', errorRegistry.internal_error.message, { cause: err });
    });
    return {
      queue,
      eventSourceState,
      storageBytes: input.verified ? await this.#storageBytes() : null,
      storageLimitBytes,
    };
  }

  // At most one database attempt per request (D19): an unverified caller already spent it in the
  // middleware, so `execute` skips this; two stacked attempts would outlast API Gateway's 30 s
  // (AWS-02).
  async #storageBytes(): Promise<number | null> {
    try {
      return await databaseRepository.storageBytes(this.#deps.db);
    } catch (err) {
      if (classifyDatabaseError(err) !== undefined) {
        return null;
      }
      throw err;
    }
  }
}
