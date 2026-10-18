import type { TokenScope } from '@ledger/core';
import { apiTokensRepository, type Executor } from '@ledger/db';
import { mintApiToken } from '@ledger/shared';
import type { TokenRead } from './token-response.mapper.ts';

export type CreateTokenInput = { name: string; scope: TokenScope };

export type CreateTokenResult = { row: TokenRead; token: string };

// `token.create` (api-contract.md, D21): mints under the installation's tag key (D3) and stores the
// hash only, `bootstrap = false`. Deliberately not idempotent: each call is a new credential. The
// plaintext goes back to this one caller and is never logged.
export class CreateTokenCommand {
  readonly #db: Executor;
  readonly #tokenTagKey: Uint8Array;

  constructor(db: Executor, tokenTagKey: Uint8Array) {
    this.#db = db;
    this.#tokenTagKey = tokenTagKey;
  }

  async execute(input: CreateTokenInput): Promise<CreateTokenResult> {
    const { token, tokenHash } = mintApiToken(this.#tokenTagKey);
    const row = await this.#db.transaction((tx) =>
      apiTokensRepository.insert(tx, { name: input.name, tokenHash, scope: input.scope }),
    );
    return { row, token };
  }
}
