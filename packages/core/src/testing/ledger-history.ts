import fc from 'fast-check';
import type { EmailEventType } from '../email-event-types.ts';
import type { LedgerEvent } from '../ledger-event.ts';
import { normalizeAddress } from '../normalize-address.ts';
import { baseInstant, type EmailHistory, emailHistory } from './email-history.ts';

// D15: a multi-email ledger, the input of `projectRecipient` and of `pnpm sim`. Built on
// `emailHistory`, so it inherits every world that generator covers (RS-U10, RS-U11, RS-U12, RS-U19,
// skipped events, control characters). Everything is derived from the run's seed.

export type LedgerHistoryOptions = {
  // Prefix of every id, so two namespaces never share an email, `svix_id` or `+label`.
  namespace?: string;
};

// Shape: one entry per email, sorted by `emailIndex`; each email's events in generated order (the
// properties and `sim` permute them). Ids are unique across the whole history.
export type LedgerHistory = {
  emails: EmailHistory[];
};

// RS-34: Resend's test addresses only.
const testLocalParts = ['delivered', 'bounced', 'complained', 'suppressed'] as const;

// C0, DEL and C1, as in `emailHistory`: they change the mask, never the recipient key.
const controlCharacters = ['\u0007', '\u001b', '\u007f', '\u009b'] as const;

// The `created_at` pool `emailHistory` draws from by default, so instants tie across emails too and
// `projectRecipient`'s `(at, rank, svix_id)` tie-breaks run.
const instants = 4;

// C3: a sticky event, then a non-sticky one that outranks it in `status` on the same email.
type StickyPair = 'suppressed-then-failed' | 'complained-then-transient';

// One pool for the whole ledger, so recipients are shared across emails. Distinct by recipient key.
function sharedPool(namespace: string) {
  return fc
    .uniqueArray(
      fc.record({
        local: fc.constantFrom(...testLocalParts),
        label: fc.option(fc.nat(9), { nil: undefined }),
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

// The same recipient as Resend might spell it; the key (`normalizeAddress`) does not vary.
function spelling(address: string) {
  return fc.constantFrom(address, address.toUpperCase(), ` ${address}\t`);
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

export function ledgerHistory(options: LedgerHistoryOptions = {}): fc.Arbitrary<LedgerHistory> {
  const namespace = options.namespace ?? 'core';
  return fc.tuple(sharedPool(namespace), fc.integer({ min: 2, max: 3 })).chain(([pool, count]) => {
    // More than half the pool per email, so any two emails share at least one recipient.
    const minRecipients = Math.floor(pool.length / 2) + 1;
    const pair = stickyPair(pool);
    return fc
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
      .map((emails) => ({ emails }));
  });
}
