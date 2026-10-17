import fc from 'fast-check';
import type { EmailEventType } from '../email-event-types.ts';
import type { LedgerEvent } from '../ledger-event.ts';
import { normalizeAddress } from '../normalize-address.ts';

// D15: one email's stored events, in lifecycle order (the properties permute them). Everything is
// derived from the run's seed: ids come from `namespace` plus a counter, never `Math.random`.

export type EmailHistoryOptions = {
  // Prefix of every id, so two namespaces never share an email, `svix_id` or `+label`.
  namespace?: string;
  // The counter of this email within a multi-email history (`ledgerHistory`).
  emailIndex?: number;
  // A shared pool of recipient addresses; without it, the email draws its own.
  recipients?: readonly string[];
  minRecipients?: number;
  maxRecipients?: number;
  // Size of the `created_at` pool. Small, so most sets tie on the sort key (RS-U10).
  instants?: number;
};

export type EmailHistory = {
  emailId: string;
  events: LedgerEvent[];
};

// A payload of a known type that fails `emailEventSchema`: stored raw, skipped.
type Malformation = 'no-email-id' | 'to-not-array' | 'bad-created-at';

// One generated event before ids and timestamps are assigned.
type Step = {
  type: string;
  // Indexes into the email's recipients; the event's own `data.to` (RS-27).
  to: readonly number[];
  data: Record<string, unknown>;
  malformed?: Malformation;
};

export const baseInstant = Date.parse('2026-10-16T12:00:00.000Z');

// RS-34: Resend's test addresses only.
export const testLocalParts = ['delivered', 'bounced', 'complained', 'suppressed'] as const;

// C0, DEL and C1 (data-modeling → PII & retention), none of which `trim()` removes, so a control
// character changes the mask but never the recipient key.
export const controlCharacters = ['\u0007', '\u001b', '\u007f', '\u009b'] as const;

// RS-28, RS-35, RS-U12: the documented values, the example's `Temporary`, any string, and none.
// `Permanent` is weighted up, so a `Permanent` and a soft bounce often meet on one recipient (D5).
const bounceTypes = fc.oneof(
  { weight: 4, arbitrary: fc.constant('Permanent') },
  { weight: 3, arbitrary: fc.constantFrom('Transient', 'Temporary', 'Undetermined') },
  { weight: 1, arbitrary: fc.string({ maxLength: 12 }) },
  { weight: 1, arbitrary: fc.constant(null) },
);

// A missing or null `bounce` object is a soft bounce too (D7).
const bounceObject = fc.oneof(
  { weight: 1, arbitrary: fc.constant(undefined) },
  { weight: 1, arbitrary: fc.constant(null) },
  {
    weight: 6,
    arbitrary: fc.record(
      {
        type: bounceTypes,
        subType: fc.constantFrom('General', 'Suppressed', 'MessageRejected', 'MailboxFull', 'x'),
        message: fc.constant('The recipient mail server rejected the email.'),
      },
      { requiredKeys: ['type'] },
    ),
  },
);

// RS-U19: `data.suppressed` present and absent.
const suppressedObject = fc.oneof(
  fc.constant(undefined),
  fc.record({
    message: fc.constant('Recipient is on the suppression list.'),
    type: fc.constant('OnAccountSuppressionList'),
  }),
);

const subjects = fc.string({
  unit: fc.oneof(
    { weight: 6, arbitrary: fc.constantFrom('Y', 'o', 'u', 'r', ' ', 'i', 'n', 'v', 'é') },
    { weight: 2, arbitrary: fc.constantFrom('0', '4', '9') },
    { weight: 1, arbitrary: fc.constantFrom(...controlCharacters) },
  ),
  minLength: 1,
  maxLength: 24,
});

const senders = fc.oneof(
  fc.constant('onboarding@resend.dev'),
  fc
    .tuple(fc.constantFrom('Acme', 'Ac\u001bme', 'Acme 2'), fc.constantFrom('', ' '))
    .map(([name, space]) => `${name}${space}<onboarding@resend.dev>`),
);

// A recipient address: a test local part, an optional `+label` from the namespace and a counter,
// an optional control character. Distinct by recipient key.
function recipientPool(namespace: string, emailIndex: number, min: number, max: number) {
  return fc
    .uniqueArray(
      fc.record({
        local: fc.constantFrom(...testLocalParts),
        label: fc.option(fc.nat(9), { nil: undefined }),
        control: fc.option(fc.constantFrom(...controlCharacters), { nil: undefined }),
      }),
      {
        minLength: min,
        maxLength: max,
        selector: ({ local, label, control }) => `${local}|${label}|${control}`,
      },
    )
    .map((parts) =>
      parts.map(({ local, label, control }) => {
        const tag = label === undefined ? '' : `+${namespace}-${emailIndex}-${label}`;
        return `${local}${control ?? ''}${tag}@resend.dev`;
      }),
    );
}

// The same recipient as Resend might spell it: case and surrounding whitespace vary, the key
// (`normalizeAddress`) does not.
export function spelling(address: string) {
  return fc.constantFrom(address, address.toUpperCase(), ` ${address}\t`);
}

function step(
  type: EmailEventType,
  to: readonly number[],
  data: Record<string, unknown> = {},
): Step {
  return { type, to, data };
}

function toSubset(count: number) {
  const indexes = Array.from({ length: count }, (_, index) => index);
  return fc.subarray(indexes, { minLength: 1 });
}

// One or more bounces, so a `Permanent` and a non-`Permanent` bounce meet on one recipient (D5).
function bounceSteps(count: number, minLength: number) {
  return fc.array(
    fc
      .tuple(toSubset(count), bounceObject)
      .map(([to, bounce]) => step('email.bounced', to, bounce === undefined ? {} : { bounce })),
    { minLength, maxLength: 2 },
  );
}

function lifecycle(count: number): fc.Arbitrary<Step[]> {
  const to = toSubset(count);
  const prefix = fc
    .tuple(fc.boolean(), fc.boolean(), fc.nat(2), to)
    .map(([scheduled, sent, delayed, recipients]) => [
      ...(scheduled ? [step('email.scheduled', recipients)] : []),
      ...(sent ? [step('email.sent', recipients)] : []),
      ...Array.from({ length: delayed }, () => step('email.delivery_delayed', recipients)),
    ]);
  const engagement = fc.array(
    fc.tuple(fc.constantFrom<EmailEventType>('email.opened', 'email.clicked'), to),
    { maxLength: 3 },
  );
  const outcome = fc.oneof(
    // Delivered, engaged, perhaps complained, perhaps bounced after delivery (RS-U11 present).
    fc
      .tuple(to, engagement, fc.option(to, { nil: undefined }), bounceSteps(count, 0))
      .map(([delivered, engaged, complained, lateBounces]) => [
        step('email.delivered', delivered),
        ...engaged.map(([type, recipients]) => step(type, recipients)),
        ...(complained === undefined ? [] : [step('email.complained', complained)]),
        ...lateBounces,
      ]),
    // Every bounce precedes or replaces delivery (RS-U11 absent).
    fc
      .tuple(bounceSteps(count, 1), fc.option(to, { nil: undefined }))
      .map(([bounces, delivered]) => [
        ...bounces,
        ...(delivered === undefined ? [] : [step('email.delivered', delivered)]),
      ]),
    to.map((recipients) => [
      step('email.failed', recipients, { failed: { reason: 'reached_daily_quota' } }),
    ]),
    fc
      .tuple(to, suppressedObject)
      .map(([recipients, suppressed]) => [
        step('email.suppressed', recipients, suppressed === undefined ? {} : { suppressed }),
      ]),
    fc.constant([]),
  );
  // Out-of-lifecycle outcomes and counters, so precedence meets every pairing. `delivered` and
  // `bounced` come only from `outcome`, which keeps the RS-U11 worlds apart in lifecycle order.
  const noise = fc.array(
    fc.tuple(
      fc.constantFrom<EmailEventType>(
        'email.scheduled',
        'email.sent',
        'email.delivery_delayed',
        'email.opened',
        'email.clicked',
        'email.complained',
        'email.suppressed',
        'email.failed',
      ),
      to,
    ),
    { maxLength: 3 },
  );
  // Stored raw and skipped by projections (ADR-004): unknown types, `email.received` (RS-30), another
  // family, and known types whose payload fails the schema.
  const skipped = fc.array(
    fc.oneof(
      fc
        .tuple(fc.constantFrom('email.unknown_new_type', 'email.received', 'contact.created'), to)
        .map(([type, recipients]): Step => ({ type, to: recipients, data: {} })),
      fc
        .tuple(
          fc.constantFrom<EmailEventType>('email.delivered', 'email.bounced', 'email.opened'),
          to,
          fc.constantFrom<Malformation>('no-email-id', 'to-not-array', 'bad-created-at'),
        )
        .map(([type, recipients, malformed]): Step => ({ ...step(type, recipients), malformed })),
    ),
    { maxLength: 2 },
  );
  return fc
    .tuple(prefix, outcome, noise, skipped)
    .map(([before, after, extra, raw]) => [
      ...before,
      ...after,
      ...extra.map(([type, recipients]) => step(type, recipients)),
      ...raw,
    ]);
}

// RS-U10, both worlds: `created_at` that tracks lifecycle order (non-decreasing along it) and
// `created_at` unrelated to it, each drawn from a small pool of instants.
function timestamps(count: number, instants: number): fc.Arbitrary<number[]> {
  const instant = fc.nat(instants - 1).map((offset) => baseInstant + offset * 1000);
  const draws = fc.array(instant, { minLength: count, maxLength: count });
  return fc
    .tuple(fc.boolean(), draws)
    .map(([tracksLifecycle, drawn]) =>
      tracksLifecycle ? [...drawn].sort((a, b) => a - b) : drawn,
    );
}

export function emailHistory(options: EmailHistoryOptions = {}): fc.Arbitrary<EmailHistory> {
  const namespace = options.namespace ?? 'core';
  const emailIndex = options.emailIndex ?? 0;
  const emailId = `${namespace}-email-${emailIndex}`;
  const instants = options.instants ?? 4;
  const pool =
    options.recipients === undefined
      ? recipientPool(namespace, emailIndex, options.minRecipients ?? 1, options.maxRecipients ?? 3)
      : fc.subarray([...options.recipients], {
          minLength: Math.min(options.minRecipients ?? 1, options.recipients.length),
          maxLength: Math.min(options.maxRecipients ?? 3, options.recipients.length),
        });

  return fc.tuple(pool, senders, subjects).chain(([recipients, from, subject]) =>
    lifecycle(recipients.length).chain((steps) =>
      fc
        .tuple(
          timestamps(steps.length, instants),
          fc.tuple(
            ...steps.map((s) =>
              fc.tuple(
                fc.tuple(...s.to.map((index) => spelling(recipients[index] ?? ''))),
                // `from` and `subject` carried, null, or absent (RS-27 lists them, nullish in D11).
                fc.constantFrom('carried', 'null', 'absent'),
              ),
            ),
          ),
        )
        .map(([times, perStep]) => ({
          emailId,
          events: steps.map((s, counter): LedgerEvent => {
            const [to, carries] = perStep[counter] ?? [[], 'absent'];
            const createdAt = new Date(times[counter] ?? baseInstant);
            const shared =
              carries === 'carried'
                ? { from, subject }
                : carries === 'null'
                  ? { from: null, subject: null }
                  : {};
            const data = {
              ...(s.malformed === 'no-email-id' ? {} : { email_id: emailId }),
              to: s.malformed === 'to-not-array' ? to.join(',') : to,
              ...shared,
              ...s.data,
            };
            const badCreatedAt = s.malformed === 'bad-created-at';
            return {
              svixId: `${namespace}-svix-${emailIndex}-${counter}`,
              type: s.type,
              eventCreatedAt: badCreatedAt ? null : createdAt,
              recipientKeys: to.map(normalizeAddress),
              payload: {
                type: s.type,
                created_at: badCreatedAt ? 'not a timestamp' : createdAt.toISOString(),
                data,
              },
            };
          }),
        })),
    ),
  );
}
