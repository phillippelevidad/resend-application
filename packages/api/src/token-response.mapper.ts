import type { ApiTokenRow } from '@ledger/db';
import type {
  CreatedTokenResponse,
  TokenListResponse,
  TokenResponse,
} from './token-response.schema.ts';

// What the token readers and commands hand the mapper: the row's type without `token_hash`, so no
// mapper can reach the hash (api-contract.md → Conventions → Redaction).
export type TokenRead = Pick<ApiTokenRow, 'id' | 'name' | 'scope' | 'createdAt' | 'revokedAt'>;

export type TokenListRead = { hasMore: boolean; tokens: TokenRead[] };

// The token routes' one mapper (pp-backend → Mappers): every wire field picked by name, so a new
// column cannot leak by passthrough.
export function tokenResponseMapper(read: TokenRead): TokenResponse {
  return {
    object: 'token',
    token_id: read.id,
    name: read.name,
    scope: read.scope,
    created_at: read.createdAt.toISOString(),
    revoked_at: read.revokedAt === null ? null : read.revokedAt.toISOString(),
  };
}

// `token.create`: the token object plus the plaintext, this once (D21).
export function createdTokenResponseMapper(read: TokenRead, token: string): CreatedTokenResponse {
  return { ...tokenResponseMapper(read), token };
}

// `token.list`: the list envelope (api-contract.md → Conventions → Pagination).
export function tokenListResponseMapper(read: TokenListRead): TokenListResponse {
  return { object: 'list', has_more: read.hasMore, data: read.tokens.map(tokenResponseMapper) };
}
