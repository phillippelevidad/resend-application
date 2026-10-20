import type { LedgerEvent } from '@ledger/core';
import { asc, count, eq, inArray, sql } from 'drizzle-orm';
import type { Executor } from './executor.ts';
import { type NewWebhookEvent, webhookEvents } from './schema/webhook-events.ts';

// One `email.get` timeline row. `payload` stays `unknown`: the mapper parses it, without throwing,
// for the fields it reads (pp-database → jsonb).
export type TimelineRow = {
  svixId: string;
  type: string | null;
  eventCreatedAt: Date | null;
  payload: unknown;
};

export const webhookEventsRepository = {
  // ADR-004: the primary key dedupes; `RETURNING` yields only a row this call inserted, so `false`
  // means a duplicate, learned without a read first.
  async insertIfAbsent(db: Executor, row: NewWebhookEvent): Promise<boolean> {
    // D17: a top-level JSON `null` payload is the `jsonb` value `null`; Drizzle binds a JS `null`
    // as SQL NULL, which `payload`'s NOT NULL refuses.
    const payload = row.payload === null ? sql`'null'::jsonb` : row.payload;
    const inserted = await db
      .insert(webhookEvents)
      .values({ ...row, payload })
      .onConflictDoNothing({ target: webhookEvents.svixId })
      .returning({ svixId: webhookEvents.svixId });
    return inserted.length === 1;
  },

  // D14 step 6: every stored event of the email, as the projection reads it. Unordered: the fold
  // orders by `(event_created_at, rank(type), svix_id)` itself (ADR-003).
  async loadForEmail(db: Executor, emailId: string): Promise<LedgerEvent[]> {
    const rows = await db
      .select({
        svixId: webhookEvents.svixId,
        type: webhookEvents.type,
        eventCreatedAt: webhookEvents.eventCreatedAt,
        toHashes: webhookEvents.toHashes,
        payload: webhookEvents.payload,
      })
      .from(webhookEvents)
      .where(eq(webhookEvents.emailId, emailId));
    // D17 sets `email_id` only on the ten outbound types, so a null `type` drops no row here; the
    // check narrows `type` to the string a `LedgerEvent` carries.
    return rows.flatMap(({ svixId, type, eventCreatedAt, toHashes, payload }) =>
      type === null ? [] : [{ svixId, type, eventCreatedAt, recipientKeys: toHashes, payload }],
    );
  },

  // `email.get`'s timeline: every stored event of the email. The mapper applies the fold order's
  // `rank(type)` tie-break (D25); this order only makes the rest deterministic.
  async listTimeline(db: Executor, emailId: string): Promise<TimelineRow[]> {
    return db
      .select({
        svixId: webhookEvents.svixId,
        type: webhookEvents.type,
        eventCreatedAt: webhookEvents.eventCreatedAt,
        payload: webhookEvents.payload,
      })
      .from(webhookEvents)
      .where(eq(webhookEvents.emailId, emailId))
      .orderBy(sql`${webhookEvents.eventCreatedAt} asc nulls last`, asc(webhookEvents.svixId));
  },

  // D37: how many of the simulator's sent events are stored, to settle a live run.
  async countPresent(db: Executor, svixIds: readonly string[]): Promise<number> {
    if (svixIds.length === 0) {
      return 0;
    }
    const [row] = await db
      .select({ present: count() })
      .from(webhookEvents)
      .where(inArray(webhookEvents.svixId, [...svixIds]));
    return row?.present ?? 0;
  },

  // Slice 4 D6: which of a List Events page's ids are stored, a primary-key lookup. The reconciler
  // counts the rest as missing (ADR-007).
  async presentSvixIds(db: Executor, svixIds: readonly string[]): Promise<Set<string>> {
    if (svixIds.length === 0) {
      return new Set();
    }
    const rows = await db
      .select({ svixId: webhookEvents.svixId })
      .from(webhookEvents)
      .where(inArray(webhookEvents.svixId, [...svixIds]));
    return new Set(rows.map((row) => row.svixId));
  },
};
