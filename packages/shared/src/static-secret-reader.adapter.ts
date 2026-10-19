import { LedgerError } from './ledger.error.ts';
import type { SecretReaderPort } from './secret-reader.port.ts';

// D1, D13: local mode's secret reader. `apps/local` builds it over the values its config parsed from
// `.env.local`, one per id (the Resend set, and the simulator secret when set), so ingest takes the
// port in both runtimes. It answers each id's value and rejects any other id, as Secrets Manager
// rejects an id it does not hold.
export class StaticSecretReaderAdapter implements SecretReaderPort {
  readonly #secrets: ReadonlyMap<string, string>;

  constructor(secrets: Readonly<Record<string, string>>) {
    this.#secrets = new Map(Object.entries(secrets));
  }

  async read(secretId: string): Promise<string> {
    const value = this.#secrets.get(secretId);
    if (value === undefined) {
      throw new LedgerError('internal_error', 'No secret is configured under the requested id.');
    }
    return value;
  }
}
