// @ledger/sdk: public TS client for the read API (ADR-011, ADR-019). The package's one public
// surface; the fake client ships through `./testing`.
export {
  apiUnavailable,
  createLedgerClient,
  type Email,
  internalError,
  type LedgerClient,
  type LedgerClientConfig,
  type Recipient,
  type SdkError,
  type SdkResult,
} from './create-ledger-client.ts';
