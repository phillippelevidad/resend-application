import { readFileSync } from 'node:fs';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { emailEventSchema } from './email-event.schema.ts';
import type { LedgerEvent } from './ledger-event.ts';
import { normalizeAddress } from './normalize-address.ts';
import { projectEmail } from './project-email.projection.ts';

type Json = { [key: string]: unknown };

// D11: the fields no projection reads, per event type (RS-27–RS-29). `projectEmail` reads only
// `type`, `data.email_id`, `data.to`, `data.from`, `data.subject` and `data.bounce.type` / `subType`.
const sharedUnread = ['message_id', 'broadcast_id', 'template_id', 'tags'];
const unreadPaths: Readonly<Record<string, readonly string[]>> = {
  scheduled: sharedUnread,
  sent: sharedUnread,
  delivered: sharedUnread,
  'delivery-delayed': sharedUnread,
  bounced: [...sharedUnread, 'bounce.message', 'bounce.diagnosticCode'],
  failed: [...sharedUnread, 'failed', 'failed.reason'],
  suppressed: [...sharedUnread, 'suppressed', 'suppressed.message', 'suppressed.type'],
  complained: sharedUnread,
  opened: sharedUnread,
  clicked: [
    ...sharedUnread,
    'click',
    'click.ipAddress',
    'click.link',
    'click.timestamp',
    'click.userAgent',
  ],
};

function fixture(slug: string): Json & { type: string; created_at: string; data: Json } {
  return JSON.parse(
    readFileSync(new URL(`./fixtures/resend/email-${slug}.json`, import.meta.url), 'utf8'),
  );
}

function stored(payload: ReturnType<typeof fixture>): LedgerEvent {
  return {
    svixId: 'svix-drift',
    type: payload.type,
    eventCreatedAt: new Date(payload.created_at),
    recipientKeys: (payload.data.to as string[]).map(normalizeAddress),
    payload,
  };
}

// Sets `data.<path>`; a path under a parent an earlier drift made a non-object is left alone.
function setPath(data: Json, path: string, value: unknown): void {
  const keys = path.split('.');
  let parent: unknown = data;
  for (const key of keys.slice(0, -1)) {
    parent = (parent as Json)[key];
    if (typeof parent !== 'object' || parent === null || Array.isArray(parent)) {
      return;
    }
  }
  (parent as Json)[keys.at(-1) ?? ''] = value;
}

const drifted = fc.constantFrom(...Object.keys(unreadPaths)).chain((slug) =>
  fc.record({
    slug: fc.constant(slug),
    drifts: fc.array(fc.tuple(fc.constantFrom(...(unreadPaths[slug] ?? [])), fc.jsonValue()), {
      minLength: 1,
    }),
  }),
);

describe('a field no projection reads never fails the event (D11)', () => {
  it('any JSON value in any unread field parses, and projects as the documented example does', () => {
    fc.assert(
      fc.property(drifted, ({ slug, drifts }) => {
        const payload = fixture(slug);
        for (const [path, value] of drifts) {
          setPath(payload.data, path, value);
        }
        expect(emailEventSchema.safeParse(payload).success).toBe(true);
        const emailId = payload.data.email_id as string;
        expect(projectEmail(emailId, [stored(payload)])).toEqual(
          projectEmail(emailId, [stored(fixture(slug))]),
        );
      }),
    );
  });
});
