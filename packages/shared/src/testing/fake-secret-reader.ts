import type { SecretReaderPort } from '../secret-reader.port.ts';
import { fakeFailure } from './fake-failure.ts';

// D1: the secret reader's stateful fake. It holds the secrets by id, how many reads it answered and
// whether reading fails, so a test changes a value or breaks the store and asserts what the code
// under test did with it (ingest's TTL cache and its `503`).
export class FakeSecretReader implements SecretReaderPort {
  readonly secrets: Map<string, string>;
  failing = false;
  reads = 0;

  constructor(secrets: Readonly<Record<string, string>> = {}) {
    this.secrets = new Map(Object.entries(secrets));
  }

  async read(secretId: string): Promise<string> {
    this.reads += 1;
    const value = this.failing ? undefined : this.secrets.get(secretId);
    if (value === undefined) throw fakeFailure('FakeSecretReader.read');
    return value;
  }
}
