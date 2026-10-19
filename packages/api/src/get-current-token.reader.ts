import { errorRegistry } from '@ledger/core';
import { apiTokensRepository, type Executor } from '@ledger/db';
import { LedgerError } from '@ledger/shared';
import type { TokenRead } from './token-response.mapper.ts';

export type GetCurrentTokenInput = { tokenId: number };

// `token.getCurrent` (api-contract.md, D21): the caller's own row, by the id the auth middleware set.
export class GetCurrentTokenReader {
  readonly #db: Executor;

  constructor(db: Executor) {
    this.#db = db;
  }

  async execute(input: GetCurrentTokenInput): Promise<TokenRead> {
    const row = await apiTokensRepository.findById(this.#db, input.tokenId);
    // The middleware found this id active a moment ago and rows are never deleted, so this is
    // unreachable; it fails closed.
    if (row === undefined) {
      throw new LedgerError('unauthorized', errorRegistry.unauthorized.message);
    }
    return row;
  }
}
