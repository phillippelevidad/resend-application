import type { EmailEventType } from '../email-event-types.ts';
import type { testLocalParts } from './email-history.ts';

// D39, RS-39: what each Resend test address (RS-32) produced in the owner's Ask-first sends of
// 2026-10-17, in `created_at` order. Only the event types and the bounce's `type` / `subType` are
// kept; no id, timestamp, address or other payload field is captured from a delivery.

export type ObservedEvent = {
  readonly type: EmailEventType;
  readonly bounce?: { readonly type: string; readonly subType: string };
};

export type TestAddressSequences = Readonly<
  Record<(typeof testLocalParts)[number], readonly ObservedEvent[]>
>;

export const testAddressSequences: TestAddressSequences = {
  delivered: [{ type: 'email.sent' }, { type: 'email.delivered' }],
  bounced: [
    { type: 'email.sent' },
    { type: 'email.bounced', bounce: { type: 'Permanent', subType: 'General' } },
  ],
  // The complaint came about 23 ms before the delivery, so `delivered` is observed after it.
  complained: [{ type: 'email.sent' }, { type: 'email.complained' }, { type: 'email.delivered' }],
  // Observed alone, with no `email.sent` before it.
  suppressed: [{ type: 'email.suppressed' }],
};
