import { describe, expect, it } from 'vitest';
import type { SecretReaderPort } from '../secret-reader.port.ts';

// The one secret an implementation is built to hold.
export type HeldSecret = { readonly secretId: string; readonly value: string };

const held: HeldSecret = {
  secretId: 'ledger/webhook-signing-secrets',
  // Not a secret's shape: no `whsec_` literal sits in the source (the gitleaks rule).
  value: '{"secrets":["contract-test-value"]}',
};

// D1: what every `SecretReaderPort` shares. `make` builds an implementation holding exactly `held`.
export function secretReaderPortContract(
  name: string,
  make: (secret: HeldSecret) => SecretReaderPort | Promise<SecretReaderPort>,
): void {
  describe(`SecretReaderPort contract: ${name}`, () => {
    it('read answers the stored value, unchanged, for the id it holds', async () => {
      const reader = await make(held);

      await expect(reader.read(held.secretId)).resolves.toBe(held.value);
    });

    it('read rejects for an id it does not hold', async () => {
      const reader = await make(held);

      await expect(reader.read('ledger/not-a-secret')).rejects.toBeInstanceOf(Error);
    });
  });
}
