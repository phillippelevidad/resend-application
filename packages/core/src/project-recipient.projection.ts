import type { Deliverability } from './deliverability.schema.ts';
import type { EmailEventType } from './email-event-types.ts';
import { eventRank } from './event-rank.ts';
import type { EmailRecipientState } from './project-email.projection.ts';
import type { SoftSignal } from './soft-signal.schema.ts';
import type { StickySignal } from './sticky-signal.schema.ts';

// D4: the `recipient_state` columns.
export type RecipientState = {
  recipientKey: string;
  addressMasked: string;
  deliverability: Deliverability;
  // C9: both null while `ok` was decided by no event.
  since: Date | null;
  causeEmailId: string | null;
};

// One row's signal with the keys D6 orders it by.
type Signal<S> = { signal: S; at: Date; rank: number; svixId: string; emailId: string };

// D1: sticky precedence, `hard_bounced` > `suppressed` > `complained`.
const stickyPrecedence: Readonly<Record<StickySignal, number>> = {
  complained: 0,
  suppressed: 1,
  hard_bounced: 2,
};

// D6: the event type behind each signal, for the `rank(type)` tie-break.
const stickyType: Readonly<Record<StickySignal, EmailEventType>> = {
  hard_bounced: 'email.bounced',
  suppressed: 'email.suppressed',
  complained: 'email.complained',
};

const softType: Readonly<Record<SoftSignal, EmailEventType>> = {
  delivered: 'email.delivered',
  bounced: 'email.bounced',
};

// ADR-003's fold order, `(event_created_at, rank(type), svix_id)`, by code unit.
function compareSignals<S>(a: Signal<S>, b: Signal<S>): number {
  return (
    a.at.getTime() - b.at.getTime() ||
    a.rank - b.rank ||
    (a.svixId < b.svixId ? -1 : a.svixId > b.svixId ? 1 : 0)
  );
}

// A signal without its event's time and `svix_id` is not a row `projectEmail` writes: skipped,
// never thrown (D3's rule for core).
function stickyOf(row: EmailRecipientState): Signal<StickySignal> | undefined {
  const { stickySignal, stickySignalAt, stickySignalSvixId } = row;
  if (stickySignal === null || stickySignalAt === null || stickySignalSvixId === null) {
    return undefined;
  }
  return {
    signal: stickySignal,
    at: stickySignalAt,
    rank: eventRank(stickyType[stickySignal]),
    svixId: stickySignalSvixId,
    emailId: row.emailId,
  };
}

function softOf(row: EmailRecipientState): Signal<SoftSignal> | undefined {
  const { softSignal, softSignalAt, softSignalSvixId } = row;
  if (softSignal === null || softSignalAt === null || softSignalSvixId === null) {
    return undefined;
  }
  return {
    signal: softSignal,
    at: softSignalAt,
    rank: eventRank(softType[softSignal]),
    svixId: softSignalSvixId,
    emailId: row.emailId,
  };
}

// D6 / D7: a pure function of the recipient's `email_recipients` rows. It reads their signals only,
// never `status`, which is not sticky-monotone (C3, D5). Rows of other keys are skipped.
export function projectRecipient(
  recipientKey: string,
  rows: readonly EmailRecipientState[],
): RecipientState {
  const own = rows.filter((row) => row.recipientKey === recipientKey);
  // D6: the mask from the row with the smallest `emailId`. A key with no row has no address.
  const first = own.reduce<EmailRecipientState | undefined>(
    (best, row) => (best === undefined || row.emailId < best.emailId ? row : best),
    undefined,
  );
  const addressMasked = first?.addressMasked ?? '';

  // 1. Sticky: the highest by sticky precedence; the earliest of that value decides.
  let sticky: Signal<StickySignal> | undefined;
  for (const signal of own.map(stickyOf)) {
    if (
      signal !== undefined &&
      (sticky === undefined ||
        stickyPrecedence[signal.signal] > stickyPrecedence[sticky.signal] ||
        (signal.signal === sticky.signal && compareSignals(signal, sticky) < 0))
    ) {
      sticky = signal;
    }
  }
  if (sticky !== undefined) {
    return {
      recipientKey,
      addressMasked,
      deliverability: sticky.signal,
      since: sticky.at,
      causeEmailId: sticky.emailId,
    };
  }

  // 2. Else soft: the latest decides, so a later delivery clears a soft bounce (D7: every
  // non-`Permanent` bounce is soft, RS-U12 safe either way).
  let soft: Signal<SoftSignal> | undefined;
  for (const signal of own.map(softOf)) {
    if (signal !== undefined && (soft === undefined || compareSignals(signal, soft) > 0)) {
      soft = signal;
    }
  }
  if (soft !== undefined) {
    return {
      recipientKey,
      addressMasked,
      deliverability: soft.signal === 'delivered' ? 'ok' : 'soft_bouncing',
      since: soft.at,
      causeEmailId: soft.emailId,
    };
  }

  // 3. Else `ok`, decided by no event (C9).
  return { recipientKey, addressMasked, deliverability: 'ok', since: null, causeEmailId: null };
}
