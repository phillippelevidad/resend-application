// D1, D13: local mode's secret reader, under the shared contract.
import { describe, expect, it } from 'vitest';
import { LedgerError } from './ledger.error.ts';
import { StaticSecretReaderAdapter } from './static-secret-reader.adapter.ts';
import { secretReaderPortContract } from './testing/secret-reader-port-contract.ts';

secretReaderPortContract(
  'StaticSecretReaderAdapter',
  ({ secretId, value }) => new StaticSecretReaderAdapter({ [secretId]: value }),
);

describe('StaticSecretReaderAdapter', () => {
  it('answers each id it was built with its own value', async () => {
    const reader = new StaticSecretReaderAdapter({
      'local/signing-secrets': 'contract-test-set',
      'local/simulator-secret': 'contract-test-simulator',
    });

    await expect(reader.read('local/signing-secrets')).resolves.toBe('contract-test-set');
    await expect(reader.read('local/simulator-secret')).resolves.toBe('contract-test-simulator');
  });

  it('rejects another id as internal_error, its message naming neither id nor value', async () => {
    const reader = new StaticSecretReaderAdapter({
      'local/signing-secrets': 'contract-test-value',
    });

    const failure = await reader.read('local/other').catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(LedgerError);
    expect((failure as LedgerError).code).toBe('internal_error');
    expect((failure as LedgerError).message).not.toContain('local/');
    expect((failure as LedgerError).message).not.toContain('contract-test-value');
  });

  it('rejects an id that is only an inherited object key', async () => {
    const reader = new StaticSecretReaderAdapter({
      'local/signing-secrets': 'contract-test-value',
    });

    await expect(reader.read('toString')).rejects.toBeInstanceOf(LedgerError);
  });
});
