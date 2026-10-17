import { emailEventSchema, emailEventTypes, hashAddress, type IngestEnvelope } from '@ledger/core';
import type { NewWebhookEvent } from '@ledger/db';
import { z } from 'zod';

// D17: what the worker inserts, and what it locks when the event is projectable. `projectable` is
// `projectEmail`'s own skip rules, so the worker locks exactly the rows the projection folds.
export type LedgerRow =
  | { readonly row: NewWebhookEvent; readonly projectable: false }
  | {
      readonly row: NewWebhookEvent;
      readonly projectable: true;
      readonly emailId: string;
      readonly eventCreatedAt: Date;
      // `data.to` as received, and `toHashes[i]` its keyed hash: the masks come from the first.
      readonly to: readonly string[];
      readonly toHashes: readonly string[];
    };

// The same rule `emailEventSchema` applies to `created_at` (RS-26).
const createdAtSchema = z.iso.datetime({ offset: true });

// `timestamptz` binds through `toISOString()`, and Postgres refuses a UTC year outside 1–9999 in
// that form (no year 0; a 5-digit year prints as `+010000`). The schema admits `0000-01-01` and
// `9999-12-31T23:00:00-05:00`, so such an instant would fail the insert on every receive and
// dead-list a verified event: it is unreadable instead, stored null.
const toStorableInstant = (iso: string): Date | null => {
  const instant = new Date(iso);
  const year = instant.getUTCFullYear();
  return year >= 1 && year <= 9999 ? instant : null;
};

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isOutbound = (type: string | null): boolean =>
  type !== null && (emailEventTypes as readonly string[]).includes(type);

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === 'string');

// D17, ADR-004: pure, and each column is read on its own, null where unreadable, so a verified
// event is never refused for its content. `payload` is the sanitized parse output, stored as the
// JSON value it is, never the Zod output. A payload that is not a plain object is checked first:
// reading `type` off `null` would throw on every receive and dead-list the event.
export function toLedgerRow(
  envelope: IngestEnvelope,
  payload: unknown,
  addressHashKey: Uint8Array,
): LedgerRow {
  const base = {
    svixId: envelope.svixId,
    receivedAt: new Date(envelope.receivedAt),
    source: envelope.source,
    payload,
  };
  if (!isPlainObject(payload)) {
    return {
      row: { ...base, type: null, eventCreatedAt: null, emailId: null, toHashes: null },
      projectable: false,
    };
  }

  const type = typeof payload.type === 'string' ? payload.type : null;
  const createdAt = createdAtSchema.safeParse(payload.created_at);
  const eventCreatedAt = createdAt.success ? toStorableInstant(createdAt.data) : null;
  // RS-25: only the ten outbound types carry an `email_id` and a `to` this ledger keys on;
  // `email.received` names an inbound email, so it stays null.
  const data = isOutbound(type) && isPlainObject(payload.data) ? payload.data : undefined;
  const emailId = typeof data?.email_id === 'string' ? data.email_id : null;
  const to = isStringArray(data?.to) ? data.to : null;
  // RS-27: same positions as `data.to`.
  const toHashes = to === null ? null : to.map((address) => hashAddress(addressHashKey, address));

  const row: NewWebhookEvent = { ...base, type, eventCreatedAt, emailId, toHashes };
  if (
    emailId === null ||
    eventCreatedAt === null ||
    to === null ||
    toHashes === null ||
    !emailEventSchema.safeParse(payload).success
  ) {
    return { row, projectable: false };
  }
  return { row, projectable: true, emailId, eventCreatedAt, to, toHashes };
}
