import { z } from 'zod';

// D4: the bearer-token scopes of api-contract.md → Conventions. `api_tokens`' `CHECK` is built from
// this set, so a scope outside it never reaches a row.
export const tokenScopes = ['read', 'operate'] as const;

export const tokenScopeSchema = z.enum(tokenScopes);

export type TokenScope = z.infer<typeof tokenScopeSchema>;

// D21: a token's name, 1 to 64 characters from A-Z, a-z, 0-9, '.', '_' and '-', starting with a
// letter or digit. One pattern for `token.create` and the deploy command's `--issue-operate-token`.
export const tokenNamePattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
