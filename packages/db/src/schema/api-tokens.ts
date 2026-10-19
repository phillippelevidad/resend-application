import { type TokenScope, tokenScopes } from '@ledger/core';
import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { closedSetCheck } from './closed-set-check.ts';

// The read API's bearer tokens (ADR-011, D7): a credential record, inserted, then revoked once.
// Only the token's SHA-256 is stored, never its plaintext (D3).
export const apiTokens = pgTable(
  'api_tokens',
  {
    // `token_id` on the wire and the keyset page key. `mode: 'number'`: ids stay below 2^53.
    id: bigint('id', { mode: 'number' }).generatedAlwaysAsIdentity(),
    name: text('name').notNull(),
    tokenHash: text('token_hash').notNull(),
    // Marks the deploy command's and setup's first `operate` token: the partial unique index below
    // lets a re-run insert none (data-modeling.md → Idempotency keys).
    bootstrap: boolean('bootstrap').notNull().default(false),
    scope: text('scope').$type<TokenScope>().notNull(),
    // Null while the token is active; set once by `markRevoked`.
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    // Set by `markRevoked` with `revoked_at` (C11), never by a trigger.
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ name: 'api_tokens_pkey', columns: [t.id] }),
    // Serves the auth middleware's `findActiveByHash`; otherwise a collision guard only.
    unique('api_tokens_token_hash_key').on(t.tokenHash),
    uniqueIndex('api_tokens_bootstrap_key').on(t.bootstrap).where(sql`${t.bootstrap}`),
    closedSetCheck('api_tokens_scope_check', t.scope, tokenScopes),
  ],
);

export type ApiTokenRow = typeof apiTokens.$inferSelect;
export type NewApiToken = typeof apiTokens.$inferInsert;
