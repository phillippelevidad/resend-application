import fc from 'fast-check';
import type { EmailEventType } from '../email-event-types.ts';
import type { LedgerEvent } from '../ledger-event.ts';
import { normalizeAddress } from '../normalize-address.ts';
// The test local parts (RS-34), control characters and spellings are `emailHistory`'s own, so the
// two generators cannot drift apart.
import {
  baseInstant,
  controlCharacters,
  type EmailHistory,
  emailHistory,
  spelling,
  testLocalParts,
} from './email-history.ts';

// D15: a multi-email ledger, the input of `projectRecipient` and of `pnpm sim`. Built on
// `emailHistory`, so it inherits every world that generator covers (RS-U10, RS-U11, RS-U12, RS-U19,
// skipped events, control characters). Everything is derived from the run's seed.

export type LedgerHistoryOptions = {
  // Prefix of every id, so two namespaces never share an email, `svix_id` or `+label`.
  namespace?: string;
  // D38: every address `<local>+<namespace>-<n>@resend.dev`, plus the walk probe email. Off by
  // default, so core's properties keep exercising bare addresses; `pnpm sim` always turns it on.
  labelEveryAddress?: boolean;
};

// Shape: one entry per email, sorted by `emailIndex`, then the walk probe when addresses are
// labelled; each email's events in generated order (the properties and `sim` permute them). Ids are
// unique across the whole history.
export type LedgerHistory = {
  emails: EmailHistory[];
};

// The `created_at` pool `emailHistory` draws from by default, so instants tie across emails too and
// `projectRecipient`'s `(at, rank, svix_id)` tie-breaks run.
const instants = 4;

// C3: a sticky event, then a non-sticky one that outranks it in `status` on the same email.
type StickyPair = 'suppressed-then-failed' | 'complained-then-transient';

// One pool for the whole ledger, so recipients are shared across emails. Distinct by recipient key.
// Labelled, the `+<namespace>-<n>` tag is drawn for every address instead of some.
function sharedPool(namespace: string, labelEveryAddress: boolean) {
  const label: fc.Arbitrary<number | undefined> = labelEveryAddress
    ? fc.nat(9)
    : fc.option(fc.nat(9), { nil: undefined });
  return fc
    .uniqueArray(
      fc.record({
        local: fc.constantFrom(...testLocalParts),
        label,
        control: fc.option(fc.constantFrom(...controlCharacters), { nil: undefined }),
      }),
      {
        minLength: 3,
        maxLength: 4,
        selector: ({ local, label, control }) => `${local}|${label}|${control}`,
      },
    )
    .map((parts) =>
      parts.map(({ local, label, control }) => {
        const tag = label === undefined ? '' : `+${namespace}-${label}`;
        return `${local}${control ?? ''}${tag}@resend.dev`;
      }),
    );
}

function pairEvent(
  emailId: string,
  svixId: string,
  type: EmailEventType,
  to: readonly string[],
  createdAt: Date,
  extra: Record<string, unknown>,
): LedgerEvent {
  return {
    svixId,
    type,
    eventCreatedAt: createdAt,
    recipientKeys: to.map(normalizeAddress),
    payload: {
      type,
      created_at: createdAt.toISOString(),
      data: { email_id: emailId, to, ...extra },
    },
  };
}

// The pair's two events, the sticky one first by `created_at` (a tie leaves it first by rank too).
function stickyPair(pool: readonly string[]) {
  return fc
    .tuple(
      fc.constantFrom<StickyPair>('suppressed-then-failed', 'complained-then-transient'),
      fc.subarray([...pool], { minLength: 1 }).chain((to) => fc.tuple(...to.map(spelling))),
      fc.nat(instants - 1),
      fc.nat(instants - 1),
    )
    .map(([kind, to, a, b]) => ({ kind, to, at: [Math.min(a, b), Math.max(a, b)] as const }));
}

function withPair(
  history: EmailHistory,
  emailIndex: number,
  namespace: string,
  pair: fc.Arbitrary<{ kind: StickyPair; to: string[]; at: readonly [number, number] }>,
): fc.Arbitrary<EmailHistory> {
  // One email in three gets a pair, so sticky states do not crowd out the soft ones (D6 step 2).
  const drawPair = fc.oneof(
    { weight: 2, arbitrary: fc.constant(undefined) },
    { weight: 1, arbitrary: pair },
  );
  return drawPair.map((drawn): EmailHistory => {
    if (drawn === undefined) {
      return history;
    }
    const { kind, to, at } = drawn;
    // Counters continue after `emailHistory`'s, so every `svix_id` stays unique.
    const next = history.events.length;
    const id = (offset: number) => `${namespace}-svix-${emailIndex}-${next + offset}`;
    const time = (offset: number) => new Date(baseInstant + offset * 1000);
    const events =
      kind === 'suppressed-then-failed'
        ? [
            pairEvent(history.emailId, id(0), 'email.suppressed', to, time(at[0]), {}),
            pairEvent(history.emailId, id(1), 'email.failed', to, time(at[1]), {
              failed: { reason: 'reached_daily_quota' },
            }),
          ]
        : [
            pairEvent(history.emailId, id(0), 'email.complained', to, time(at[0]), {}),
            pairEvent(history.emailId, id(1), 'email.bounced', to, time(at[1]), {
              bounce: { type: 'Transient', subType: 'MailboxFull', message: 'Mailbox full.' },
            }),
          ];
    return { emailId: history.emailId, events: [...history.events, ...events] };
  });
}

// D38: the walk probe, a fixed email a walker can look up by an address they can type. Its two
// recipients carry the namespace but no `-<n>`, so neither equals a generated address. `email.sent`
// to both, `email.delivered` to the first, a `Permanent` / `General` bounce to the second (RS-27,
// RS-28, RS-35), one second apart in lifecycle order. Nothing here is drawn from the seed.
function walkProbe(namespace: string): EmailHistory {
  const emailId = `${namespace}-probe`;
  const delivered = `delivered+${namespace}@resend.dev`;
  const bounced = `bounced+${namespace}@resend.dev`;
  const shared = { from: 'onboarding@resend.dev', subject: 'Ledger walk probe' };
  const event = (
    counter: number,
    type: EmailEventType,
    to: string[],
    extra: Record<string, unknown> = {},
  ) =>
    pairEvent(
      emailId,
      `${namespace}-svix-probe-${counter}`,
      type,
      to,
      new Date(baseInstant + counter * 1000),
      { ...shared, ...extra },
    );
  return {
    emailId,
    events: [
      event(0, 'email.sent', [delivered, bounced]),
      event(1, 'email.delivered', [delivered]),
      event(2, 'email.bounced', [bounced], {
        bounce: {
          type: 'Permanent',
          subType: 'General',
          message: 'The recipient mail server rejected the email.',
        },
      }),
    ],
  };
}

export function ledgerHistory(options: LedgerHistoryOptions = {}): fc.Arbitrary<LedgerHistory> {
  const namespace = options.namespace ?? 'core';
  const labelEveryAddress = options.labelEveryAddress ?? false;
  const pools = sharedPool(namespace, labelEveryAddress);
  return fc.tuple(pools, fc.integer({ min: 2, max: 3 })).chain(([pool, count]) => {
    // More than half the pool per email, so any two emails draw at least one recipient in common.
    // Each event's `to` is a subset of the draw, so the shared one usually, not always, reaches both
    // emails' projections.
    const minRecipients = Math.floor(pool.length / 2) + 1;
    const pair = stickyPair(pool);
    return (
      fc
        .tuple(
          ...Array.from({ length: count }, (_, emailIndex) =>
            emailHistory({
              namespace,
              emailIndex,
              recipients: pool,
              minRecipients,
              maxRecipients: pool.length,
              instants,
            })
              // D15's minimum: 2 events per email, so `sim --duplicates 0.3` repeats at least one.
              .filter((history) => history.events.length >= 2)
              .chain((history) => withPair(history, emailIndex, namespace, pair)),
          ),
        )
        // The probe is fixed, so appending it draws nothing and leaves the generated emails as they
        // were. Built per value, so no two histories share an event object.
        .map((emails) => ({
          emails: labelEveryAddress ? [...emails, walkProbe(namespace)] : emails,
        }))
    );
  });
}
