// D1, D13, D26: the secret reader over a stubbed Secrets Manager client. Error names from the
// GetSecretValue API Reference
// (https://docs.aws.amazon.com/secretsmanager/latest/apireference/API_GetSecretValue.html#API_GetSecretValue_Errors).
import {
  DecryptionFailure,
  InternalServiceError,
  ResourceNotFoundException,
  type SecretsManagerClient,
} from '@aws-sdk/client-secrets-manager';
import { LedgerError } from '@ledger/shared';
import { secretReaderPortContract } from '@ledger/shared/testing';
import { describe, expect, it } from 'vitest';
import { SecretsManagerSecretReaderAdapter } from './secrets-manager-secret-reader.adapter.ts';
import { StubClient } from './testing/stub-client.ts';

const metadata = { $metadata: {} };
const secretArn = 'arn:aws:secretsmanager:us-east-2:000000000000:secret:ledger/database-AbCdEf';

const reader = (stub: StubClient) =>
  new SecretsManagerSecretReaderAdapter({ client: stub.as<SecretsManagerClient>() });

describe('SecretsManagerSecretReaderAdapter', () => {
  it('sends one GetSecretValue for the id and answers its SecretString unchanged', async () => {
    const stub = new StubClient().answer('GetSecretValue', () => ({
      SecretString: '{"pooledUrl":"contract-test-value"}',
      ...metadata,
    }));

    await expect(reader(stub).read(secretArn)).resolves.toBe('{"pooledUrl":"contract-test-value"}');

    expect(stub.sent).toEqual([{ name: 'GetSecretValue', input: { SecretId: secretArn } }]);
  });

  it.each([
    [
      'ResourceNotFoundException',
      () => new ResourceNotFoundException({ message: 'missing', ...metadata }),
    ],
    ['DecryptionFailure', () => new DecryptionFailure({ message: 'kms', ...metadata })],
    ['InternalServiceError', () => new InternalServiceError({ message: 'oops', ...metadata })],
  ])('rejects with the SDK error unchanged on %s', async (name, error) => {
    const stub = new StubClient().answer('GetSecretValue', () => {
      throw error();
    });

    const failure = await reader(stub)
      .read(secretArn)
      .catch((caught: unknown) => caught);

    expect((failure as Error).name).toBe(name);
  });

  it('rejects a binary-only secret as internal_error, quoting neither id nor value', async () => {
    const stub = new StubClient().answer('GetSecretValue', () => ({
      SecretBinary: new Uint8Array([1, 2, 3]),
      ...metadata,
    }));

    const failure = await reader(stub)
      .read(secretArn)
      .catch((caught: unknown) => caught);

    expect(failure).toBeInstanceOf(LedgerError);
    expect((failure as LedgerError).code).toBe('internal_error');
    expect((failure as LedgerError).message).not.toContain('ledger/');
  });
});

secretReaderPortContract('SecretsManagerSecretReaderAdapter', ({ secretId, value }) => {
  const stub = new StubClient().answer('GetSecretValue', (input) => {
    if (input.SecretId !== secretId) {
      throw new ResourceNotFoundException({ message: 'missing', ...metadata });
    }
    return { SecretString: value, ...metadata };
  });
  return reader(stub);
});
