import { z } from 'zod';

// D4: the bearer-token scopes of api-contract.md → Conventions. `api_tokens`' `CHECK` is built from
// this set, so a scope outside it never reaches a row.
export const tokenScopes = ['read', 'operate'] as const;

export const tokenScopeSchema = z.enum(tokenScopes);

export type TokenScope = z.infer<typeof tokenScopeSchema>;
