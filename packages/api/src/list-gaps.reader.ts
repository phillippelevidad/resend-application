import { type Executor, reconcileRunsRepository } from '@ledger/db';
import type { ClockPort } from '@ledger/shared';
import type { ReconcileRunListRead } from './reconcile-run-response.mapper.ts';

export type ListGapsInput = { sinceMs: number; limit: number; after: number | undefined };

// `gaps.list` (api-contract.md, D28): runs started within `since`, newest first by `run_id`, keyset
// on the PK. Recorded runs only: no Resend call. A single statement, so no snapshot transaction.
export class ListGapsReader {
  readonly #db: Executor;
  readonly #clock: ClockPort;

  constructor(db: Executor, clock: ClockPort) {
    this.#db = db;
    this.#clock = clock;
  }

  async execute({ sinceMs, limit, after }: ListGapsInput): Promise<ReconcileRunListRead> {
    const since = new Date(this.#clock.now().getTime() - sinceMs);
    const { rows, hasMore } = await reconcileRunsRepository.listSince(this.#db, {
      since,
      limit,
      after,
    });
    return { hasMore, runs: rows };
  }
}
