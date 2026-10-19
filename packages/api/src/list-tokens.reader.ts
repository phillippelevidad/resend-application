import { apiTokensRepository, type Executor } from '@ledger/db';
import type { TokenListRead } from './token-response.mapper.ts';

export type ListTokensInput = { limit: number; after: number | undefined };

// `token.list` (api-contract.md, D21): active and revoked tokens, newest first by `token_id`, keyset
// on the PK. One row past `limit` tells `has_more` without a count. A single statement, so no
// snapshot transaction (pp-backend → A reader never writes).
export class ListTokensReader {
  readonly #db: Executor;

  constructor(db: Executor) {
    this.#db = db;
  }

  async execute(input: ListTokensInput): Promise<TokenListRead> {
    const rows = await apiTokensRepository.listPage(this.#db, {
      limit: input.limit + 1,
      ...(input.after === undefined ? {} : { afterId: input.after }),
    });
    return { hasMore: rows.length > input.limit, tokens: rows.slice(0, input.limit) };
  }
}
