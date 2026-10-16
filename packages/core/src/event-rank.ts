import type { EmailEventType } from './email-event-types.ts';

// D1 (owner-ruled 2026-10-16): one constant table, low to high. It is ADR-003's fold tie-break
// `rank(type)` and, restricted to the eight statuses, outcome precedence. Changing it changes
// every stored projection, so it is a rebuild.
const ranks: Readonly<Record<EmailEventType, number>> = {
  'email.scheduled': 0,
  'email.sent': 1,
  'email.delivery_delayed': 2,
  'email.delivered': 3,
  'email.opened': 4,
  'email.clicked': 5,
  'email.complained': 6,
  'email.suppressed': 7,
  'email.failed': 8,
  'email.bounced': 9,
};

// Any other type (`email.received`, another family, an unknown type) ranks last; projections
// skip it anyway.
const otherRank = 10;

export function eventRank(type: string): number {
  return Object.hasOwn(ranks, type) ? ranks[type as EmailEventType] : otherRank;
}
