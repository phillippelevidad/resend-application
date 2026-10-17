import { z } from 'zod';
import type { EmailEventType } from './email-event-types.ts';

// D11: a field no projection reads keeps its documented type (RS-27–RS-29) but never fails the
// event: a value off that type parses as absent, because a rejected event is a skipped one.
function unread<T extends z.ZodType>(schema: T) {
  return schema.nullish().catch(undefined);
}

// Only `type`, `created_at`, `data.email_id` and `data.to` are required; every object is loose,
// so a field Resend adds never fails a parse (ADR-003). The rest is RS-27's shared set. Optional
// fields also accept `null`: no page says whether Resend omits or nulls an absent value (e.g.
// `broadcast_id` on a non-broadcast send), and a rejected event is a skipped one (D11's why).
const emailEventDataSchema = z.looseObject({
  email_id: z.string(),
  to: z.array(z.string()),
  from: z.string().nullish(),
  subject: z.string().nullish(),
  message_id: unread(z.string()),
  broadcast_id: unread(z.string()),
  template_id: unread(z.string()),
  // Documented as `Record<string, string>` on every webhooks/emails page; the send API takes an
  // array of `{ name, value }` (api-reference/emails/send-email).
  tags: unread(z.record(z.string(), z.string())),
});

// RS-28. `type` and `subType` stay open strings: the examples and RS-35's list disagree (RS-U12).
const bounceSchema = z.looseObject({
  type: z.string().nullish(),
  subType: z.string().nullish(),
  message: unread(z.string()),
  diagnosticCode: unread(z.array(z.string())),
});

// RS-29. No projection reads `click`, `failed` or `suppressed`.
const clickSchema = z.looseObject({
  ipAddress: unread(z.string()),
  link: unread(z.string()),
  timestamp: unread(z.string()),
  userAgent: unread(z.string()),
});

const failedSchema = z.looseObject({
  reason: unread(z.string()),
});

// RS-U19: the object appears in the page's example only, so it MUST stay optional.
const suppressedSchema = z.looseObject({
  message: unread(z.string()),
  type: unread(z.string()),
});

function emailEventMember<T extends EmailEventType, D extends z.ZodType>(type: T, data: D) {
  return z.looseObject({
    type: z.literal(type),
    created_at: z.iso.datetime({ offset: true }),
    data,
  });
}

// Apply only after `webhookEnvelopeSchema` passes and `type` is in `emailEventTypes`; anything
// else is stored raw and skipped by projections. `safeParse` only: core never throws.
export const emailEventSchema = z.discriminatedUnion('type', [
  emailEventMember('email.scheduled', emailEventDataSchema),
  emailEventMember('email.sent', emailEventDataSchema),
  emailEventMember('email.delivered', emailEventDataSchema),
  emailEventMember('email.delivery_delayed', emailEventDataSchema),
  emailEventMember(
    'email.bounced',
    emailEventDataSchema.extend({ bounce: bounceSchema.nullish() }),
  ),
  emailEventMember('email.failed', emailEventDataSchema.extend({ failed: unread(failedSchema) })),
  emailEventMember(
    'email.suppressed',
    emailEventDataSchema.extend({ suppressed: unread(suppressedSchema) }),
  ),
  emailEventMember('email.complained', emailEventDataSchema),
  emailEventMember('email.opened', emailEventDataSchema),
  emailEventMember('email.clicked', emailEventDataSchema.extend({ click: unread(clickSchema) })),
]);

export type EmailEvent = z.infer<typeof emailEventSchema>;
