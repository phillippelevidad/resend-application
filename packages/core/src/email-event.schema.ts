import { z } from 'zod';
import type { EmailEventType } from './email-event-types.ts';

// Only `type`, `created_at`, `data.email_id` and `data.to` are required; every object is loose,
// so a field Resend adds never fails a parse (ADR-003). The rest is RS-27's shared set. Optional
// fields also accept `null`: no page says whether Resend omits or nulls an absent value (e.g.
// `broadcast_id` on a non-broadcast send), and a rejected event is a skipped one (D11's why).
const emailEventDataSchema = z.looseObject({
  email_id: z.string(),
  to: z.array(z.string()),
  from: z.string().nullish(),
  subject: z.string().nullish(),
  message_id: z.string().nullish(),
  broadcast_id: z.string().nullish(),
  template_id: z.string().nullish(),
  tags: z.record(z.string(), z.string()).nullish(),
});

// RS-28. `type` and `subType` stay open strings: the examples and RS-35's list disagree (RS-U12).
const bounceSchema = z.looseObject({
  type: z.string().nullish(),
  subType: z.string().nullish(),
  message: z.string().nullish(),
  diagnosticCode: z.array(z.string()).nullish(),
});

// RS-29.
const clickSchema = z.looseObject({
  ipAddress: z.string().nullish(),
  link: z.string().nullish(),
  timestamp: z.string().nullish(),
  userAgent: z.string().nullish(),
});

const failedSchema = z.looseObject({
  reason: z.string().nullish(),
});

// RS-U19: the object appears in the page's example only, so it MUST stay optional.
const suppressedSchema = z.looseObject({
  message: z.string().nullish(),
  type: z.string().nullish(),
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
  emailEventMember('email.failed', emailEventDataSchema.extend({ failed: failedSchema.nullish() })),
  emailEventMember(
    'email.suppressed',
    emailEventDataSchema.extend({ suppressed: suppressedSchema.nullish() }),
  ),
  emailEventMember('email.complained', emailEventDataSchema),
  emailEventMember('email.opened', emailEventDataSchema),
  emailEventMember('email.clicked', emailEventDataSchema.extend({ click: clickSchema.nullish() })),
]);

export type EmailEvent = z.infer<typeof emailEventSchema>;
