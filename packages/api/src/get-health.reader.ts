import { type EventSourceState, errorRegistry } from '@ledger/core';
import {
  classifyDatabaseError,
  databaseRepository,
  type Executor,
  reconcileRunsRepository,
} from '@ledger/db';
import {
  type EventSourceControlPort,
  LedgerError,
  type QueueAttributesPort,
  type QueueSnapshot,
} from '@ledger/shared';
import type { ReconcileRunRead } from './reconcile-run-response.mapper.ts';

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
  // Slice 4 D27: the newest run; `null` before the first run or while the database is unreachable.
  lastReconcileRun: ReconcileRunRead | null;
};

export type GetHealthReaderDeps = {
  db: Executor;
  queueAttributes: QueueAttributesPort;
  eventSource: EventSourceControlPort;
  storageLimitBytes: number;
};

const unreachable = { storageBytes: null, lastReconcileRun: null } as const;

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
    // says and logs the AWS error's name. The classifier never reads an SDK socket error
    // (`ECONNRESET`, `ENOTFOUND`) as the database: it counts a socket code only with a pg origin.
    const [queue, eventSourceState] = await Promise.all([
      queueAttributes.read(),
      eventSource.getState(),
    ]).catch((err: unknown) => {
      throw new LedgerError('internal_error', errorRegistry.internal_error.message, { cause: err });
    });
    const database = input.verified ? await this.#databaseRead() : unreachable;
    return { queue, eventSourceState, storageLimitBytes, ...database };
  }

  // At most one database attempt per request (D19): an unverified caller already spent it in the
  // middleware, so `execute` skips this; two stacked attempts would outlast API Gateway's 30 s
  // (AWS-02). Slice 4 D27: the last run is read in the same attempt, after the storage, and a
  // classified failure of either nulls both, so a dead database costs one connection timeout.
  async #databaseRead(): Promise<Pick<HealthRead, 'storageBytes' | 'lastReconcileRun'>> {
    try {
      const storageBytes = await databaseRepository.storageBytes(this.#deps.db);
      const lastReconcileRun = (await reconcileRunsRepository.latest(this.#deps.db)) ?? null;
      return { storageBytes, lastReconcileRun };
    } catch (err) {
      if (classifyDatabaseError(err) !== undefined) {
        return unreachable;
      }
      throw err;
    }
  }
}
