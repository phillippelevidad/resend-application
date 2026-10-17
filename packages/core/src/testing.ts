// @ledger/core/testing: the arbitraries core's properties and `sim` share, so the simulator checks
// the model the properties check (D15). Never imported by runtime code.
export {
  type LedgerHistory,
  type LedgerHistoryOptions,
  ledgerHistory,
} from './testing/ledger-history.ts';
