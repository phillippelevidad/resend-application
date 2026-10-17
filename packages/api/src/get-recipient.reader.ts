import { type Deliverability, errorRegistry, hashAddress } from '@ledger/core';
import { type Executor, recipientStateRepository } from '@ledger/db';
import { LedgerError } from '@ledger/shared';

export type GetRecipientInput = { address: string };

// The read shape `recipientResponseMapper` turns into the wire object: no address, no hash.
export type RecipientRead = {
  addressMasked: string;
  deliverability: Deliverability;
  since: Date | null;
  causeEmailId: string | null;
};

// `recipient.get` (api-contract.md): the address is hashed server-side, normalizing first (D1, D24),
// and looked up by its keyed hash; the address itself is never stored or returned.
export class GetRecipientReader {
  readonly #db: Executor;
  readonly #addressHashKey: Uint8Array;

  constructor(db: Executor, addressHashKey: Uint8Array) {
    this.#db = db;
    this.#addressHashKey = addressHashKey;
  }

  async execute(input: GetRecipientInput): Promise<RecipientRead> {
    const row = await recipientStateRepository.get(
      this.#db,
      hashAddress(this.#addressHashKey, input.address),
    );
    // `recipient_not_found`, never a default `ok`: an address never seen must not read as
    // deliverable (api-contract.md → recipient.get).
    if (row === undefined) {
      throw new LedgerError('recipient_not_found', errorRegistry.recipient_not_found.message);
    }
    return {
      addressMasked: row.addressMasked,
      deliverability: row.deliverability,
      since: row.since,
      causeEmailId: row.causeEmailId,
    };
  }
}
