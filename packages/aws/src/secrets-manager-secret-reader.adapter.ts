import { GetSecretValueCommand, type SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import { LedgerError, type SecretReaderPort } from '@ledger/shared';

export type SecretsManagerSecretReaderAdapterDeps = { client: SecretsManagerClient };

// D1, D13: a secret's value on AWS, read by the ARN an internal variable carries (CBL-01: a function
// holds the ARN, never the value). One `GetSecretValue` per call; caching is the caller's (ingest's
// TTL, D13; each root's once-per-container read, D32). A failed read rejects with the SDK's own error.
// A secret with no `SecretString` (a binary value) is not one Ledger wrote, so it rejects with a
// constant that quotes no id or value.
export class SecretsManagerSecretReaderAdapter implements SecretReaderPort {
  readonly #client: SecretsManagerClient;

  constructor({ client }: SecretsManagerSecretReaderAdapterDeps) {
    this.#client = client;
  }

  async read(secretId: string): Promise<string> {
    const output = await this.#client.send(new GetSecretValueCommand({ SecretId: secretId }));
    if (output.SecretString === undefined) {
      throw new LedgerError('internal_error', 'The secret holds no string value.');
    }
    return output.SecretString;
  }
}
