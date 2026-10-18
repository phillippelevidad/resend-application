import type { TokenScope } from '@ledger/core';
import { LedgerError } from '@ledger/shared';
import { and, desc, eq, isNull, lt, sql } from 'drizzle-orm';
import type { Executor, Transaction } from './executor.ts';
import { type ApiTokenRow, apiTokens, type NewApiToken } from './schema/api-tokens.ts';

// What a caller inserts: the database owns `id`, the timestamps and `revoked_at`.
export type ApiTokenValues = Pick<NewApiToken, 'name' | 'tokenHash' | 'scope'>;

// What the auth middleware needs of an active token (D18).
export type ActiveApiToken = { id: number; name: string; scope: TokenScope };

export const apiTokensRepository = {
  // `token.create` and the deploy command's `--issue-operate-token`: deliberately not idempotent.
  async insert(db: Executor, row: ApiTokenValues): Promise<ApiTokenRow> {
    const [inserted] = await db.insert(apiTokens).values(row).returning();
    // Unreachable: an INSERT without ON CONFLICT either returns its row or throws.
    if (inserted === undefined) {
      throw new LedgerError('internal_error', 'The token insert returned no row.');
    }
    return inserted;
  },

  // The first `operate` token of the deploy command and `pnpm db:setup` (D8): the partial unique
  // `api_tokens_bootstrap_key` decides, so a re-run inserts none and returns `undefined`. The
  // conflict target names that index, so a `token_hash` collision still throws.
  async insertBootstrapIfAbsent(
    db: Executor,
    row: ApiTokenValues,
  ): Promise<ApiTokenRow | undefined> {
    const [inserted] = await db
      .insert(apiTokens)
      .values({ ...row, bootstrap: true })
      .onConflictDoNothing({ target: apiTokens.bootstrap, where: sql`${apiTokens.bootstrap}` })
      .returning();
    return inserted;
  },

  // The auth middleware's lookup after the tag check, served by `api_tokens_token_hash_key`.
  async findActiveByHash(db: Executor, tokenHash: string): Promise<ActiveApiToken | undefined> {
    const [row] = await db
      .select({ id: apiTokens.id, name: apiTokens.name, scope: apiTokens.scope })
      .from(apiTokens)
      .where(and(eq(apiTokens.tokenHash, tokenHash), isNull(apiTokens.revokedAt)));
    return row;
  },

  async findById(db: Executor, id: number): Promise<ApiTokenRow | undefined> {
    const [row] = await db.select().from(apiTokens).where(eq(apiTokens.id, id));
    return row;
  },

  // `token.list`: newest first, keyset on the PK (`id < afterId`), which serves the order too.
  async listPage(
    db: Executor,
    { limit, afterId }: { limit: number; afterId?: number },
  ): Promise<ApiTokenRow[]> {
    return db
      .select()
      .from(apiTokens)
      .where(afterId === undefined ? undefined : lt(apiTokens.id, afterId))
      .orderBy(desc(apiTokens.id))
      .limit(limit);
  },

  // `token.revoke`'s guard (D21): every active `operate` row locked in `id` order, so two revokes
  // of the last two `operate` tokens serialize and the second sees one left.
  async lockActiveOperate(tx: Transaction): Promise<ApiTokenRow[]> {
    return tx
      .select()
      .from(apiTokens)
      .where(and(eq(apiTokens.scope, 'operate'), isNull(apiTokens.revokedAt)))
      .orderBy(apiTokens.id)
      .for('update');
  },

  async lockById(tx: Transaction, id: number): Promise<ApiTokenRow | undefined> {
    const [row] = await tx.select().from(apiTokens).where(eq(apiTokens.id, id)).for('update');
    return row;
  },

  // Set once: a revoked row is left as it is, so a repeated revoke changes nothing (C11).
  async markRevoked(tx: Transaction, id: number): Promise<void> {
    await tx
      .update(apiTokens)
      .set({ revokedAt: sql`now()`, updatedAt: sql`now()` })
      .where(and(eq(apiTokens.id, id), isNull(apiTokens.revokedAt)));
  },
};
