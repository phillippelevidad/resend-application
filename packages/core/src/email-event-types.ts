// RS-25: the ten outbound email types. `email.received` (RS-30) is inbound and gets no typed
// schema, so it is deliberately absent here.
export const emailEventTypes = [
  'email.scheduled',
  'email.sent',
  'email.delivered',
  'email.delivery_delayed',
  'email.bounced',
  'email.failed',
  'email.suppressed',
  'email.complained',
  'email.opened',
  'email.clicked',
] as const;

export type EmailEventType = (typeof emailEventTypes)[number];
