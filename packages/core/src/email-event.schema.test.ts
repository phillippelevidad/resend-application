import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { emailEventSchema } from './email-event.schema.ts';
import { emailEventTypes } from './email-event-types.ts';
import { webhookEnvelopeSchema } from './webhook-envelope.schema.ts';

type Payload = { [key: string]: unknown; type: string; data: { [key: string]: unknown } };

type Fixture = {
  file: string;
  sourceUrl: string;
  fetchedOn: string;
  substitution: string;
};

const fixturesDir = new URL('./fixtures/resend/', import.meta.url);

const messageIdSubstitution =
  'data.message_id <111-222-333@email.example.com> -> <111-222-333@resend.dev>';

// D12: each Resend docs example, verbatim except for the substitution it records (C1).
const fixtures: readonly Fixture[] = [
  ['scheduled', messageIdSubstitution],
  ['sent', messageIdSubstitution],
  ['delivered', messageIdSubstitution],
  ['delivery-delayed', messageIdSubstitution],
  ['bounced', messageIdSubstitution],
  ['failed', messageIdSubstitution],
  ['suppressed', messageIdSubstitution],
  ['complained', messageIdSubstitution],
  ['opened', messageIdSubstitution],
  ['clicked', messageIdSubstitution],
  [
    'received',
    `${messageIdSubstitution}; data.received_for forwarded@example.com -> delivered@resend.dev`,
  ],
].map(([slug, substitution]) => ({
  file: `email-${slug}.json`,
  sourceUrl: `https://resend.com/docs/webhooks/emails/${slug}.md`,
  fetchedOn: '2026-10-16',
  substitution: substitution ?? '',
}));

const outboundFixtures = fixtures.filter((fixture) => fixture.file !== 'email-received.json');

function loadFixture(file: string): Payload {
  return JSON.parse(readFileSync(new URL(file, fixturesDir), 'utf8'));
}

function isEmailEventType(type: string): boolean {
  return (emailEventTypes as readonly string[]).includes(type);
}

function withData(file: string, change: (data: Payload['data']) => void): Payload {
  const payload = loadFixture(file);
  change(payload.data);
  return payload;
}

describe('Resend fixtures', () => {
  it('the table lists every fixture file on disk, each with its source and fetch date', () => {
    const onDisk = readdirSync(fixturesDir).sort();
    expect(fixtures.map((fixture) => fixture.file).sort()).toEqual(onDisk);
    expect(onDisk).toHaveLength(11);
  });

  it.each(outboundFixtures)('$file, Resend’s documented example, parses typed', ({ file }) => {
    const payload = loadFixture(file);
    expect(webhookEnvelopeSchema.safeParse(payload).success).toBe(true);
    const result = emailEventSchema.safeParse(payload);
    expect(result.success).toBe(true);
    expect(result.data?.type).toBe(payload.type);
  });

  it('email-received.json passes the envelope only, with no typed outbound schema (RS-30)', () => {
    const payload = loadFixture('email-received.json');
    expect(webhookEnvelopeSchema.safeParse(payload).success).toBe(true);
    expect(isEmailEventType(payload.type)).toBe(false);
    expect(emailEventSchema.safeParse(payload).success).toBe(false);
  });
});

describe('webhookEnvelopeSchema', () => {
  it.each(['email.teleported', 'domain.created'])(
    'a %s payload passes the envelope and is kept raw, untyped',
    (type) => {
      const payload = { ...loadFixture('email-sent.json'), type };
      expect(webhookEnvelopeSchema.safeParse(payload).success).toBe(true);
      expect(isEmailEventType(type)).toBe(false);
      expect(emailEventSchema.safeParse(payload).success).toBe(false);
    },
  );
});

describe('emailEventSchema', () => {
  it('an email.sent payload without data.email_id is rejected', () => {
    const payload = withData('email-sent.json', (data) => {
      delete data.email_id;
    });
    expect(emailEventSchema.safeParse(payload).success).toBe(false);
  });

  it('a payload without from, subject, message_id, broadcast_id, template_id and tags still parses (RS-27)', () => {
    const payload = withData('email-delivered.json', (data) => {
      for (const field of [
        'from',
        'subject',
        'message_id',
        'broadcast_id',
        'template_id',
        'tags',
      ]) {
        delete data[field];
      }
    });
    expect(emailEventSchema.safeParse(payload).success).toBe(true);
  });

  it('optional fields and event-specific objects sent as null still parse', () => {
    const payload = withData('email-bounced.json', (data) => {
      for (const field of [
        'from',
        'subject',
        'message_id',
        'broadcast_id',
        'template_id',
        'tags',
        'bounce',
      ]) {
        data[field] = null;
      }
    });
    expect(emailEventSchema.safeParse(payload).success).toBe(true);
  });

  it('fields no schema declares pass and are preserved, top-level and in data', () => {
    const payload = {
      ...withData('email-delivered.json', (data) => {
        data.new_resend_field = { nested: true };
      }),
      new_top_level_field: 'kept',
    };
    const result = emailEventSchema.safeParse(payload);
    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({
      new_top_level_field: 'kept',
      data: { new_resend_field: { nested: true } },
    });
  });

  it('an email.bounced payload without its bounce object still parses', () => {
    const payload = withData('email-bounced.json', (data) => {
      delete data.bounce;
    });
    expect(emailEventSchema.safeParse(payload).success).toBe(true);
  });

  it.each(['Temporary', 'Undetermined', 'SomethingNoPageDocuments'])(
    'data.bounce.type %s passes with the value preserved (RS-U12)',
    (bounceType) => {
      const payload = withData('email-bounced.json', (data) => {
        data.bounce = { ...(data.bounce as object), type: bounceType, subType: bounceType };
      });
      const result = emailEventSchema.safeParse(payload);
      expect(result.success).toBe(true);
      expect(result.data?.data).toMatchObject({
        bounce: { type: bounceType, subType: bounceType },
      });
    },
  );

  // D11: each value breaks the type its page documents (RS-27–RS-29) in a field no projection
  // reads. Before the fix, each one failed the parse and the event was skipped.
  it.each<[name: string, file: string, change: (data: Payload['data']) => void]>([
    [
      'a Permanent bounce with diagnosticCode as a string',
      'email-bounced.json',
      (data) => {
        data.bounce = { ...(data.bounce as object), diagnosticCode: 'smtp; 550 5.1.1 unknown' };
      },
    ],
    [
      'a bounce message that is not a string',
      'email-bounced.json',
      (data) => {
        data.bounce = { ...(data.bounce as object), message: { text: 'Mailbox unavailable.' } };
      },
    ],
    [
      'a tag whose value is not a string',
      'email-bounced.json',
      (data) => {
        data.tags = { category: 'confirm_email', attempt: 2 };
      },
    ],
    [
      'tags in the send API’s array shape',
      'email-delivered.json',
      (data) => {
        data.tags = [{ name: 'category', value: 'confirm_email' }];
      },
    ],
    [
      'message_id, broadcast_id and template_id that are not strings',
      'email-sent.json',
      (data) => {
        data.message_id = 111;
        data.broadcast_id = ['8b146471'];
        data.template_id = true;
      },
    ],
    [
      'a click timestamp that is a number',
      'email-clicked.json',
      (data) => {
        data.click = { ...(data.click as object), timestamp: 1_795_928_457_163 };
      },
    ],
    ['a click object that is a string', 'email-clicked.json', (data) => (data.click = 'clicked')],
    [
      'a failed reason that is an object',
      'email-failed.json',
      (data) => (data.failed = { reason: { code: 'reached_daily_quota' } }),
    ],
    [
      'a suppressed object that is an array',
      'email-suppressed.json',
      (data) => (data.suppressed = ['suppressed']),
    ],
  ])('%s still parses, with type, email_id and to intact', (_name, file, change) => {
    const payload = withData(file, change);
    const result = emailEventSchema.safeParse(payload);
    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({
      type: payload.type,
      data: { email_id: payload.data.email_id, to: payload.data.to },
    });
  });

  // D11: the fields a projection reads keep failing the parse when off-type.
  it.each<[name: string, file: string, change: (data: Payload['data']) => void]>([
    ['a from that is an object', 'email-delivered.json', (data) => (data.from = { name: 'Acme' })],
    ['a subject that is a number', 'email-delivered.json', (data) => (data.subject = 42)],
    ['a bounce object that is a string', 'email-bounced.json', (data) => (data.bounce = 'hard')],
    [
      'a bounce type that is a number',
      'email-bounced.json',
      (data) => (data.bounce = { ...(data.bounce as object), type: 1 }),
    ],
    [
      'a bounce subType that is an array',
      'email-bounced.json',
      (data) => (data.bounce = { ...(data.bounce as object), subType: ['Suppressed'] }),
    ],
  ])('%s, a field a projection reads, is still rejected', (_name, file, change) => {
    expect(emailEventSchema.safeParse(withData(file, change)).success).toBe(false);
  });

  it('a drifted unread field parses as absent, beside the bounce type it rides with', () => {
    const payload = withData('email-bounced.json', (data) => {
      data.bounce = { ...(data.bounce as object), diagnosticCode: 'smtp; 550 5.1.1 unknown' };
      data.tags = { category: 2 };
    });
    const data = emailEventSchema.safeParse(payload).data?.data as Payload['data'] | undefined;
    const bounce = data?.bounce as Payload['data'] | undefined;
    expect(bounce).toMatchObject({ type: 'Permanent', subType: 'Suppressed' });
    expect(bounce?.diagnosticCode).toBeUndefined();
    expect(data?.tags).toBeUndefined();
  });

  it('email.suppressed parses with and without data.suppressed (RS-U19)', () => {
    const withObject = loadFixture('email-suppressed.json');
    const withoutObject = withData('email-suppressed.json', (data) => {
      delete data.suppressed;
    });
    expect(withObject.data.suppressed).toBeDefined();
    expect(emailEventSchema.safeParse(withObject).success).toBe(true);
    expect(emailEventSchema.safeParse(withoutObject).success).toBe(true);
  });
});
