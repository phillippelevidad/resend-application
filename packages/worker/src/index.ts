// @ledger/worker: the ledger transaction and the projections it commits (ADR-004). The package's
// one public surface.
export { createWorker, type Worker, type WorkerDeps } from './create-worker.ts';
export {
  RecordEventCommand,
  type RecordEventDeps,
  type RecordEventInput,
  type RecordEventOutcome,
} from './record-event.command.ts';
export { type LedgerRow, toLedgerRow } from './to-ledger-row.ts';
