import { z } from '@hono/zod-openapi';
import { tokenScopeSchema } from '@ledger/core';

const timestamp = z.iso.datetime();

// The token object (design.md → Surfaces → Token object): never the hash, and never the plaintext
// outside `token.create`'s one answer (api-tokens spec).
export const tokenResponseSchema = z
  .object({
    object: z.literal('token'),
    token_id: z.int().min(1),
    name: z.string(),
    scope: tokenScopeSchema,
    created_at: timestamp,
    revoked_at: timestamp.nullable(),
  })
  .openapi('Token');

export type TokenResponse = z.infer<typeof tokenResponseSchema>;

// `token.create`'s `201` body: the token object plus the plaintext, returned this once.
export const createdTokenResponseSchema = tokenResponseSchema
  .extend({ token: z.string() })
  .openapi('CreatedToken');

export type CreatedTokenResponse = z.infer<typeof createdTokenResponseSchema>;

// `token.list`'s body: Resend's list envelope (api-contract.md → Conventions → Pagination).
export const tokenListResponseSchema = z
  .object({
    object: z.literal('list'),
    has_more: z.boolean(),
    data: z.array(tokenResponseSchema),
  })
  .openapi('TokenList');

export type TokenListResponse = z.infer<typeof tokenListResponseSchema>;
