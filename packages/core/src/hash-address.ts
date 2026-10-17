import { createHmac } from 'node:crypto';
import { normalizeAddress } from './normalize-address.ts';

// D1: the one keyed address hash (data-modeling → PII & retention). Keyed, because an unkeyed hash
// of a known address set is reversible by dictionary. `node:crypto` is a Node built-in, so core
// stays pure (ADR-013).

// D1: the first 8 hex characters of HMAC-SHA-256(key, "ledger:key-id"). It prefixes every hash, so
// a row records which key produced it.
export function addressHashKeyId(key: Uint8Array): string {
  return createHmac('sha256', key).update('ledger:key-id').digest('hex').slice(0, 8);
}

// Normalizes inside, so no caller can hash an unnormalized address.
export function hashAddress(key: Uint8Array, address: string): string {
  const digest = createHmac('sha256', key).update(normalizeAddress(address)).digest('hex');
  return `${addressHashKeyId(key)}.${digest}`;
}
