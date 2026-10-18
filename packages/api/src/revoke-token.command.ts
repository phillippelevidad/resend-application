import { errorRegistry } from '@ledger/core';
import { apiTokensRepository, type Executor } from '@ledger/db';
import { LedgerError } from '@ledger/shared';
import type { TokenRead } from './token-response.mapper.ts';

export type RevokeTokenInput = { tokenId: number };

// `token.revoke` (api-contract.md, D21): one transaction that locks every active `operate` row in
// `id` order before the target, so two concurrent revokes of the last two `operate` tokens
// serialize and the second sees one left (`api-tokens.repository.int.test.ts`). Revoking a revoked
// token returns it unchanged. A token may revoke itself unless it is the last `operate` one.
export class RevokeTokenCommand {
  readonly #db: Executor;

  constructor(db: Executor) {
    this.#db = db;
  }

  async execute(input: RevokeTokenInput): Promise<TokenRead> {
    return this.#db.transaction(async (tx) => {
      const activeOperate = await apiTokensRepository.lockActiveOperate(tx);
      const target = await apiTokensRepository.lockById(tx, input.tokenId);
      if (target === undefined) {
        throw new LedgerError('token_not_found', errorRegistry.token_not_found.message);
      }
      if (target.revokedAt !== null) {
        return target;
      }
      if (target.scope === 'operate' && activeOperate.length <= 1) {
        throw new LedgerError('last_operate_token', errorRegistry.last_operate_token.message);
      }
      await apiTokensRepository.markRevoked(tx, target.id);
      const revoked = await apiTokensRepository.findById(tx, target.id);
      // Unreachable: the row is locked by this transaction and rows are never deleted.
      if (revoked === undefined) {
        throw new LedgerError('token_not_found', errorRegistry.token_not_found.message);
      }
      return revoked;
    });
  }
}
