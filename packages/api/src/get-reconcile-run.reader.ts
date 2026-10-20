import { errorRegistry } from '@ledger/core';
import { type Executor, reconcileRunsRepository } from '@ledger/db';
import { LedgerError } from '@ledger/shared';
import type { ReconcileRunRead } from './reconcile-run-response.mapper.ts';

// `reconcile.getRun` (api-contract.md, D28): one run by id, running, finished or abandoned. No Resend
// call; `ledger reconcile` polls it to wait.
export class GetReconcileRunReader {
  readonly #db: Executor;

  constructor(db: Executor) {
    this.#db = db;
  }

  async execute(runId: number): Promise<ReconcileRunRead> {
    const run = await reconcileRunsRepository.get(this.#db, runId);
    if (run === undefined) {
      throw new LedgerError('run_not_found', errorRegistry.run_not_found.message);
    }
    return run;
  }
}
