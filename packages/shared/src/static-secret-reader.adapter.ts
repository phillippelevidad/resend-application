import { LedgerError } from './ledger.error.ts';
import type { SecretReaderPort } from './secret-reader.port.ts';

// D1, D13: local mode's secret reader. `apps/local` builds it over the value its config parsed from
// `.env.local`, so ingest takes the port in both runtimes. It answers that one value for the one id
// it was built with and rejects any other, as Secrets Manager rejects an id it does not hold.
export class StaticSecretReaderAdapter implements SecretReaderPort {
  readonly #secretId: string;
  readonly #value: string;

  constructor(secretId: string, value: string) {
    this.#secretId = secretId;
    this.#value = value;
  }

  async read(secretId: string): Promise<string> {
    if (secretId !== this.#secretId) {
      throw new LedgerError('internal_error', 'No secret is configured under the requested id.');
    }
    return this.#value;
  }
}
