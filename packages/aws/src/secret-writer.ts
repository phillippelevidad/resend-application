import {
  GetSecretValueCommand,
  PutSecretValueCommand,
  type SecretsManagerClient,
} from '@aws-sdk/client-secrets-manager';

// D26, D33 step 9: the deploy command writes `ledger/database` and `ledger/webhook-signing-secrets`
// itself, so no value passes through CDK (CBL-01). Script-only. It writes a new version only when
// the stored value differs, so a re-run deploy adds no version and no API charge beyond the read
// (AWS-11). The value is compared in memory and never returned or printed.
export async function writeSecretIfChanged(
  client: SecretsManagerClient,
  secretId: string,
  value: string,
): Promise<'written' | 'unchanged'> {
  const stored = await client.send(new GetSecretValueCommand({ SecretId: secretId }));
  if (stored.SecretString === value) return 'unchanged';
  await client.send(new PutSecretValueCommand({ SecretId: secretId, SecretString: value }));
  return 'written';
}
