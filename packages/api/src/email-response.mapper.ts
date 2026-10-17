import { eventRank } from '@ledger/core';
import type { TimelineRow } from '@ledger/db';
import { z } from 'zod';
import type { EmailResponse } from './email-response.schema.ts';
import type { EmailRead } from './get-email.reader.ts';

// RS-28: only `type` and `subType` leave the payload; the bounce `message` and `diagnosticCode`
// can quote the address and are never read. Loose and non-throwing: a payload that fails this
// parse answers null for both, never an error (D25).
const bouncePayloadSchema = z.looseObject({
  data: z.looseObject({
    bounce: z.looseObject({
      type: z.string().nullish(),
      subType: z.string().nullish(),
    }),
  }),
});

type Bounce = { bounce_type: string | null; bounce_sub_type: string | null };

function bounceOf(row: TimelineRow): Bounce {
  if (row.type !== 'email.bounced') {
    return { bounce_type: null, bounce_sub_type: null };
  }
  const parsed = bouncePayloadSchema.safeParse(row.payload);
  if (!parsed.success) {
    return { bounce_type: null, bounce_sub_type: null };
  }
  const { type, subType } = parsed.data.data.bounce;
  return { bounce_type: type ?? null, bounce_sub_type: subType ?? null };
}

// ADR-003's fold order: `event_created_at` nulls last, then `rank(type)`, then `svix_id` by code
// unit, so the timeline reads the way the projection folded it, whatever order the rows arrived in.
function compareFoldOrder(a: TimelineRow, b: TimelineRow): number {
  const at = a.eventCreatedAt?.getTime();
  const bt = b.eventCreatedAt?.getTime();
  if (at !== bt) {
    if (at === undefined) return 1;
    if (bt === undefined) return -1;
    return at - bt;
  }
  return (
    eventRank(a.type ?? '') - eventRank(b.type ?? '') ||
    (a.svixId < b.svixId ? -1 : a.svixId > b.svixId ? 1 : 0)
  );
}

const iso = (value: Date | null): string | null => (value === null ? null : value.toISOString());

// `email.get`'s one mapper (pp-backend → Mappers): every wire field picked by name from the read
// shape, so a new column or payload field cannot leak by passthrough. The stored `*_masked` columns
// are already masks (data-modeling.md → PII & retention). An absent `email_state` (every event
// unprojectable) answers `status: null`, zero counts and no recipients (D25).
export function emailResponseMapper(read: EmailRead): EmailResponse {
  const { state } = read;
  return {
    object: 'email',
    email_id: read.emailId,
    status: state?.status ?? null,
    from_masked: state?.fromMasked ?? null,
    subject_masked: state?.subjectMasked ?? null,
    open_count: state?.openCount ?? 0,
    click_count: state?.clickCount ?? 0,
    first_opened_at: iso(state?.firstOpenedAt ?? null),
    first_clicked_at: iso(state?.firstClickedAt ?? null),
    last_event_at: iso(state?.lastEventAt ?? null),
    event_count: state?.eventCount ?? 0,
    recipients:
      state === undefined
        ? []
        : read.recipients.map((row) => ({
            address_masked: row.addressMasked,
            status: row.status,
            status_at: iso(row.statusAt),
            bounce_type: row.bounceType,
            bounce_sub_type: row.bounceSubType,
          })),
    timeline: read.timeline
      // D17 sets `email_id` only with a string `type`, so this drops no row; it narrows the type.
      .filter((row): row is TimelineRow & { type: string } => row.type !== null)
      .sort(compareFoldOrder)
      .map((row) => ({
        svix_id: row.svixId,
        type: row.type,
        event_created_at: iso(row.eventCreatedAt),
        ...bounceOf(row),
      })),
  };
}
