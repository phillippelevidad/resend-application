import { errorRegistry } from '@ledger/core';
import { type DlqPort, LedgerError, type RedriveStart } from '@ledger/shared';

export type StartDlqRedriveInput = Record<string, never>;

// `dlq.startRedrive` (api-contract.md, D7): one redrive of every dead message to the source queue.
// It writes nothing to Postgres, so it opens no transaction, like `ResumeEventSourceCommand`.
export class StartDlqRedriveCommand {
  readonly #dlq: DlqPort;

  constructor(dlq: DlqPort) {
    this.#dlq = dlq;
  }

  async execute(_input: StartDlqRedriveInput = {}): Promise<RedriveStart> {
    return this.#dlq.startRedrive().catch((err: unknown) => {
      // A running task is the port's `409` (AWS-21) and passes through; any other failure, a racing
      // start's error included (AWS-U14), is raised as `internal_error` with the error as `cause`,
      // so `onError` answers `500` and logs the cause's name only.
      if (err instanceof LedgerError && err.code === 'redrive_in_progress') throw err;
      throw new LedgerError('internal_error', errorRegistry.internal_error.message, { cause: err });
    });
  }
}
