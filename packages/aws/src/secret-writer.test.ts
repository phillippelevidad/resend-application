// D26, D33 step 9: the deploy command's secret write over a stubbed Secrets Manager client. Error
// names from the API References: GetSecretValue
// (https://docs.aws.amazon.com/secretsmanager/latest/apireference/API_GetSecretValue.html#API_GetSecretValue_Errors)
// and PutSecretValue
// (https://docs.aws.amazon.com/secretsmanager/latest/apireference/API_PutSecretValue.html#API_PutSecretValue_Errors).
import {
  LimitExceededException,
  ResourceNotFoundException,
  type SecretsManagerClient,
} from '@aws-sdk/client-secrets-manager';
import { describe, expect, it } from 'vitest';
import { writeSecretIfChanged } from './secret-writer.ts';
import { StubClient } from './testing/stub-client.ts';

const metadata = { $metadata: {} };
const secretArn = 'arn:aws:secretsmanager:us-east-2:000000000000:secret:LedgerAppSigning-AbCdEf';

const secretsHolding = (stored: string) => {
  let current = stored;
  return new StubClient()
    .answer('GetSecretValue', () => ({ SecretString: current, ...metadata }))
    .answer('PutSecretValue', (input) => {
      current = input.SecretString as string;
      return { VersionId: 'v2', ...metadata };
    });
};

describe('writeSecretIfChanged', () => {
  it('writes a new version when the stored value differs', async () => {
    const stub = secretsHolding('CDK-generated-placeholder');

    const outcome = await writeSecretIfChanged(
      stub.as<SecretsManagerClient>(),
      secretArn,
      '["contract-test-value"]',
    );

    expect(outcome).toBe('written');
    expect(stub.sent).toEqual([
      { name: 'GetSecretValue', input: { SecretId: secretArn } },
      {
        name: 'PutSecretValue',
        input: { SecretId: secretArn, SecretString: '["contract-test-value"]' },
      },
    ]);
  });

  it('writes nothing when the stored value is the same', async () => {
    const stub = secretsHolding('["contract-test-value"]');

    const outcome = await writeSecretIfChanged(
      stub.as<SecretsManagerClient>(),
      secretArn,
      '["contract-test-value"]',
    );

    expect(outcome).toBe('unchanged');
    expect(stub.names()).toEqual(['GetSecretValue']);
  });

  it.each([
    [
      'ResourceNotFoundException on the read',
      'GetSecretValue',
      () => new ResourceNotFoundException({ message: 'missing', ...metadata }),
    ],
    [
      'LimitExceededException on the write',
      'PutSecretValue',
      () => new LimitExceededException({ message: 'versions', ...metadata }),
    ],
  ])('rejects with the SDK error unchanged on %s', async (_case, command, error) => {
    const stub = secretsHolding('old').answer(command, () => {
      throw error();
    });

    const failure = await writeSecretIfChanged(
      stub.as<SecretsManagerClient>(),
      secretArn,
      'new',
    ).catch((caught: unknown) => caught);

    expect((failure as Error).name).toBe(error().name);
  });
});
