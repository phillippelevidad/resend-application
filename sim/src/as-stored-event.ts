import { hashAddress, type LedgerEvent } from '@ledger/core';

// The generated event as the worker reads it back (D14 step 6, D17): `recipientKeys` are
// `to_hashes`, `data.to` through `hashAddress`. The generator's keys are `normalizeAddress(to[i])`,
// and `hashAddress` normalizes first, so hashing them gives the same value. Invariant 2's ground truth
// and a live run's printed projection both key recipients this way, so the live output's recipient
// order follows the keyed hashes, as the ledger's does (D37).
export function asStoredEvent(event: LedgerEvent, addressHashKey: Uint8Array): LedgerEvent {
  const { recipientKeys } = event;
  return {
    ...event,
    recipientKeys:
      recipientKeys === null ? null : recipientKeys.map((key) => hashAddress(addressHashKey, key)),
  };
}
