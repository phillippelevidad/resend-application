import { type EmailEvent, emailEventSchema } from './email-event.schema.ts';
import { emailEventTypes } from './email-event-types.ts';
import type { EmailStatus } from './email-status.schema.ts';
import { eventRank } from './event-rank.ts';
import type { LedgerEvent } from './ledger-event.ts';
import { maskAddress } from './mask-address.ts';
import { maskFrom } from './mask-from.ts';
import { maskText } from './mask-text.ts';
import { normalizeAddress } from './normalize-address.ts';
import type { SoftSignal } from './soft-signal.schema.ts';
import { type StickySignal, stickyPrecedence } from './sticky-signal.schema.ts';

// D4: the `email_recipients` columns plus C3's six signal fields.
export type EmailRecipientState = {
  emailId: string;
  recipientKey: string;
  addressMasked: string;
  status: EmailStatus | null;
  statusAt: Date | null;
  bounceType: string | null;
  bounceSubType: string | null;
  stickySignal: StickySignal | null;
  stickySignalAt: Date | null;
  stickySignalSvixId: string | null;
  softSignal: SoftSignal | null;
  softSignalAt: Date | null;
  softSignalSvixId: string | null;
};

// D4: the `email_state` columns, with the email's recipient rows sorted by `recipientKey`.
export type EmailState = {
  emailId: string;
  status: EmailStatus | null;
  fromMasked: string | null;
  subjectMasked: string | null;
  openCount: number;
  clickCount: number;
  firstOpenedAt: Date | null;
  firstClickedAt: Date | null;
  lastEventAt: Date | null;
  eventCount: number;
  recipients: EmailRecipientState[];
};

// An event that passed every skip rule (D3 step 2), with what the fold reads.
type ProjectedEvent = {
  svixId: string;
  eventCreatedAt: Date;
  rank: number;
  event: EmailEvent;
  recipientKeys: readonly string[];
};

// D5: the deciding event's key, `(precedence(status), bounce.type === 'Permanent')`.
type DecidingKey = { precedence: number; permanent: boolean };

const outcomeStatuses: Readonly<Partial<Record<EmailEvent['type'], EmailStatus>>> = {
  'email.scheduled': 'scheduled',
  'email.sent': 'sent',
  'email.delivery_delayed': 'delivery_delayed',
  'email.delivered': 'delivered',
  'email.complained': 'complained',
  'email.suppressed': 'suppressed',
  'email.failed': 'failed',
  'email.bounced': 'bounced',
};

function isEmailEventType(type: string): boolean {
  return (emailEventTypes as readonly string[]).includes(type);
}

// RS-35, D7: only the exact string `Permanent` is a hard bounce; any other value, or no `bounce`
// object, is soft (RS-U12 safe either way).
function isPermanentBounce(event: EmailEvent): boolean {
  return event.type === 'email.bounced' && event.data.bounce?.type === 'Permanent';
}

// D3 step 2: skip, never throw. Core sits below `packages/shared`'s error class, and ADR-004 stores
// an unprojectable event raw and skips it.
function toProjectedEvent(emailId: string, event: LedgerEvent): ProjectedEvent | undefined {
  const { eventCreatedAt, recipientKeys } = event;
  // An invalid Date is as unusable as a null one, and NaN would break the sort's total order.
  if (eventCreatedAt === null || Number.isNaN(eventCreatedAt.getTime())) {
    return undefined;
  }
  if (!isEmailEventType(event.type)) {
    return undefined;
  }
  const parsed = emailEventSchema.safeParse(event.payload);
  // The stored `type` column is read from the payload, so a row where they differ is not a
  // well-formed stored event.
  if (!parsed.success || parsed.data.type !== event.type) {
    return undefined;
  }
  if (parsed.data.data.email_id !== emailId) {
    return undefined;
  }
  if (recipientKeys === null || recipientKeys.length !== parsed.data.data.to.length) {
    return undefined;
  }
  return {
    svixId: event.svixId,
    eventCreatedAt,
    rank: eventRank(event.type),
    event: parsed.data,
    recipientKeys,
  };
}

// ADR-003: `(event_created_at, rank(type), svix_id)`, compared by code unit so it never depends on
// a locale.
function compareFoldOrder(a: ProjectedEvent, b: ProjectedEvent): number {
  return (
    a.eventCreatedAt.getTime() - b.eventCreatedAt.getTime() ||
    a.rank - b.rank ||
    (a.svixId < b.svixId ? -1 : a.svixId > b.svixId ? 1 : 0)
  );
}

function decidingKey(projected: ProjectedEvent): DecidingKey | undefined {
  const status = outcomeStatuses[projected.event.type];
  if (status === undefined) {
    return undefined;
  }
  return { precedence: projected.rank, permanent: isPermanentBounce(projected.event) };
}

// D5: strictly higher only, so ties keep the earliest in fold order and `statusAt` means "since".
function outranks(candidate: DecidingKey, current: DecidingKey | undefined): boolean {
  if (current === undefined) {
    return true;
  }
  return (
    candidate.precedence > current.precedence ||
    (candidate.precedence === current.precedence && candidate.permanent && !current.permanent)
  );
}

function stickySignalOf(event: EmailEvent): StickySignal | undefined {
  if (event.type === 'email.complained') {
    return 'complained';
  }
  if (event.type === 'email.suppressed') {
    return 'suppressed';
  }
  return isPermanentBounce(event) ? 'hard_bounced' : undefined;
}

function softSignalOf(event: EmailEvent): SoftSignal | undefined {
  if (event.type === 'email.delivered') {
    return 'delivered';
  }
  return event.type === 'email.bounced' && !isPermanentBounce(event) ? 'bounced' : undefined;
}

// The first index naming each key: an event that names one recipient twice names it once.
function namedRecipients(projected: ProjectedEvent): Map<string, number> {
  const named = new Map<string, number>();
  projected.recipientKeys.forEach((key, index) => {
    if (!named.has(key)) {
      named.set(key, index);
    }
  });
  return named;
}

function newRecipientRow(
  emailId: string,
  recipientKey: string,
  address: string,
): EmailRecipientState {
  return {
    emailId,
    recipientKey,
    addressMasked: maskAddress(normalizeAddress(address)),
    status: null,
    statusAt: null,
    bounceType: null,
    bounceSubType: null,
    stickySignal: null,
    stickySignalAt: null,
    stickySignalSvixId: null,
    softSignal: null,
    softSignalAt: null,
    softSignalSvixId: null,
  };
}

// RS-27: a row folds only the events whose own `data.to` names its recipient.
function foldRecipient(
  row: EmailRecipientState,
  projected: ProjectedEvent,
  deciding: Map<string, DecidingKey>,
): void {
  const { event } = projected;
  const key = decidingKey(projected);
  if (key !== undefined && outranks(key, deciding.get(row.recipientKey))) {
    deciding.set(row.recipientKey, key);
    row.status = outcomeStatuses[event.type] ?? null;
    row.statusAt = projected.eventCreatedAt;
    row.bounceType = event.type === 'email.bounced' ? (event.data.bounce?.type ?? null) : null;
    row.bounceSubType =
      event.type === 'email.bounced' ? (event.data.bounce?.subType ?? null) : null;
  }
  // D4: a maximum by sticky precedence, earliest on ties, so adding events never lowers it.
  const sticky = stickySignalOf(event);
  if (
    sticky !== undefined &&
    (row.stickySignal === null || stickyPrecedence[sticky] > stickyPrecedence[row.stickySignal])
  ) {
    row.stickySignal = sticky;
    row.stickySignalAt = projected.eventCreatedAt;
    row.stickySignalSvixId = projected.svixId;
  }
  // D4: the latest in fold order.
  const soft = softSignalOf(event);
  if (soft !== undefined) {
    row.softSignal = soft;
    row.softSignalAt = projected.eventCreatedAt;
    row.softSignalSvixId = projected.svixId;
  }
}

// ADR-003, D3–D5: a pure function of the stored event set. `emailId` is the email the caller holds
// the lock for (ADR-004); an event naming another email is skipped.
export function projectEmail(emailId: string, events: readonly LedgerEvent[]): EmailState {
  // D3 step 3: one `svixId` is one stored row (ADR-004), so the copies are identical.
  const bySvixId = new Map<string, ProjectedEvent>();
  for (const event of events) {
    const projected = toProjectedEvent(emailId, event);
    if (projected !== undefined && !bySvixId.has(projected.svixId)) {
      bySvixId.set(projected.svixId, projected);
    }
  }
  const folded = [...bySvixId.values()].sort(compareFoldOrder);

  const state: EmailState = {
    emailId,
    status: null,
    fromMasked: null,
    subjectMasked: null,
    openCount: 0,
    clickCount: 0,
    firstOpenedAt: null,
    firstClickedAt: null,
    lastEventAt: null,
    eventCount: 0,
    recipients: [],
  };
  let emailDeciding: DecidingKey | undefined;
  const rows = new Map<string, EmailRecipientState>();
  const rowDeciding = new Map<string, DecidingKey>();

  for (const projected of folded) {
    const { event, eventCreatedAt } = projected;
    state.eventCount += 1;
    state.lastEventAt = eventCreatedAt;
    const key = decidingKey(projected);
    if (key !== undefined && outranks(key, emailDeciding)) {
      emailDeciding = key;
      state.status = outcomeStatuses[event.type] ?? null;
    }
    if (state.fromMasked === null && typeof event.data.from === 'string') {
      state.fromMasked = maskFrom(event.data.from);
    }
    if (state.subjectMasked === null && typeof event.data.subject === 'string') {
      state.subjectMasked = maskText(event.data.subject);
    }
    if (event.type === 'email.opened') {
      state.openCount += 1;
      state.firstOpenedAt ??= eventCreatedAt;
    }
    if (event.type === 'email.clicked') {
      state.clickCount += 1;
      state.firstClickedAt ??= eventCreatedAt;
    }
    for (const [recipientKey, index] of namedRecipients(projected)) {
      let row = rows.get(recipientKey);
      if (row === undefined) {
        row = newRecipientRow(emailId, recipientKey, event.data.to[index] ?? '');
        rows.set(recipientKey, row);
      }
      foldRecipient(row, projected, rowDeciding);
    }
  }

  state.recipients = [...rows.values()].sort((a, b) =>
    a.recipientKey < b.recipientKey ? -1 : a.recipientKey > b.recipientKey ? 1 : 0,
  );
  return state;
}
